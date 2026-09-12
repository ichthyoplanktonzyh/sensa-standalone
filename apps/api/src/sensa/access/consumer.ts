import {registerLibrarySync} from '../library/sync.js';
import {createModelTurnRoutes,type ModelTurnCompletion} from '../models/turn.js';
import {assertDeletionConfigured,requestAccountDeletion,finishAccountDeletion,type DeleteIdentity} from './deletion.js';
import {serviceTelemetry,type ServiceRequestRecord} from './telemetry.js';
import {ensureAdmission} from './admission.js';
import {learningPackageCatalogSchema} from '@sensa/contracts/sensa';
import {stream} from 'hono/streaming';
import {setAnchorUse} from '../personal/anchorUse.js';
import {setContentMembership} from '../personal/membership.js';
import {processTask} from '../provisioning/tasks.js';
import {generateContent,reviewContent} from '../provisioning/material.js';
import type {ContentGenerator,ContentReviewer} from '../provisioning/material.js';
import {beginLookup,readLookup,finishLookup,acceptSemantic,listMeanings} from '../personal/semantic.js';
import {resolveSemantic,semanticResolverFor} from '../personal/semanticResolver.js';
import {registerReadingRoutes,activeMeaningConnection,readingDailyLimit} from '../reading/service.js';
import type {ReadingCompletion} from '../reading/service.js';
import type {SemanticResolver} from '../personal/semanticResolver.js';
import {semanticLookupInputSchema} from '@sensa/contracts/sensa';
import {extensionVerifier,extensionAuthorizationSchema,extensionExchangeSchema,authorizeExtension,exchangeExtension} from './extension.js';
import {saveIntake,listIntakes,readIntake} from '../personal/intake.js';
import {issueAccountClock,listCheckIns,recordCheckIn} from '../activity/checkin.js';
import {retentionAvailability} from '../runtime/retention.js';
import {applyRuntime,listRuns,runView,currentActivity,initialAvailability,accountDate,startedToday,activitySummary} from '../runtime/initial.js';
import { Hono } from 'hono';
import {readConsumerMedia,bytesDigest} from '../media/consumer.js';
import type {ConsumerMediaReader} from '../media/consumer.js';
import {addPersonalTarget,applyTargetOperation,listCatalog,listTargets,targetView,materialView,authorizeMedia,catalogQuerySchema} from '../curriculum/targets.js';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  consumerVersion, consumerWireVersion, consumerCanonicalizerVersion, canonicalConsumerJson,
  installationInputSchema, accountContextSchema, planViewSchema, consumerPushSchema, librarySyncBlockStoreChars,
  consumerBootstrapSchema, consumerPullSchema,
} from '@sensa/contracts/sensa';
import type { QuantityOperation, QuantityResult, PlanView, ConsumerPush, ConsumerOperation } from '@sensa/contracts/sensa';
import { unsafeTransaction } from '../../database/index.js';
import type { DatabaseExecutor } from '../../database/index.js';
import { ConsumerError, verifyConsumer } from './auth.js';
import type { ConsumerVerifier, ConsumerPrincipal } from './auth.js';

const modelDailyLimit=30;
type Account = { account_id: string; learner_user_id: string; epoch: string; feed_head: string; time_zone: string; session_id: string; now:Date;authorizedInstallationId?:string };
type Transaction = <T>(work: (db: DatabaseExecutor) => Promise<T>) => Promise<T>;
const uuid = z.string().uuid();
const fail = (code: string, latest: {id: string; revision: string}|null = null) => ({ code, retryable: false, retryAfterMs: null, latest, field: null, messageKey: code });
const iso = () => new Date().toISOString();
async function account(db: DatabaseExecutor, identity: ConsumerPrincipal, create?: z.infer<typeof installationInputSchema>, allowRevokedSession = false, now=new Date(), accessOnly=false): Promise<Account> {
  if(create&&identity.installationId&&create.installationId!==identity.installationId)throw new ConsumerError(403,'installation_scope_mismatch');
  await ensureAdmission(db,identity,!!create);
  let row = (await db.query('SELECT * FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE', [identity.issuer,identity.subject])).rows[0];
  if (!row && create) {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)', [id,identity.email]);
    await db.query('INSERT INTO core.learners(learner_user_id) VALUES($1)', [id]);
    row = (await db.query('INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,$2,$3,$4) RETURNING *', [id,identity.issuer,identity.subject,create.timeZone])).rows[0];
  }
  if (!row) throw new ConsumerError(409,'session_initialization_required');
  if(row.lifecycle&&row.lifecycle!=='active')throw new ConsumerError(403,'account_deleted');
  let session = (await db.query('SELECT * FROM sensa_consumer.sessions WHERE account_id=$1 AND provider_session_id=$2', [row.account_id,identity.sessionId])).rows[0];
  if (!session && create) session = (await db.query('INSERT INTO sensa_consumer.sessions(account_id,provider_session_id) VALUES($1,$2) RETURNING *', [row.account_id,identity.sessionId])).rows[0];
  if (!session || (session.revoked && !allowRevokedSession)) throw new ConsumerError(401,'access_revoked');
  if (create && !accessOnly) {
    // Service-only access has no Web learning settings yet.
    if(!(await db.query('SELECT 1 FROM sensa_consumer.installations WHERE account_id=$1 LIMIT 1',[row.account_id])).rows.length && !(await db.query('SELECT 1 FROM sensa_consumer.plans WHERE learner_user_id=$1',[row.learner_user_id])).rows.length){
      await db.query('UPDATE sensa_consumer.accounts SET time_zone=$2 WHERE account_id=$1',[row.account_id,create.timeZone]);row.time_zone=create.timeZone;
    }
    await db.query('INSERT INTO sensa_consumer.installations(id,account_id,platform) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [create.installationId,row.account_id,create.platform]);
    const installation = (await db.query('SELECT account_id FROM sensa_consumer.installations WHERE id=$1', [create.installationId])).rows[0];
    if (installation?.account_id !== row.account_id) throw new ConsumerError(403,'installation_scope_mismatch');
  }
  return { ...row, session_id: session.id,now,authorizedInstallationId:identity.installationId } as Account;
}
async function plan(db: DatabaseExecutor, a: Account): Promise<PlanView|null> {
  const row = (await db.query('SELECT * FROM sensa_consumer.plans WHERE learner_user_id=$1', [a.learner_user_id])).rows[0];
  if (!row) return null;
  const date=accountDate(a.now,a.time_zone),started=await startedToday(db,a);
  return planViewSchema.parse({ id:row.id,revision:String(row.revision),scopeRevision:String(row.scope_revision),
    quantityConfirmed:true,dailyNewLimit:row.daily_new_limit,timeZone:a.time_zone,accountDate:date,newStartedToday:started,newRemaining:Math.max(0,row.daily_new_limit-started) });
}
function query(a: Account, data: unknown) { return { contractVersion:consumerVersion,serverTime:a.now.toISOString(),scopeEpoch:String(a.epoch),projectionRevision:String(a.feed_head),data }; }
async function context(db: DatabaseExecutor, a: Account, installationId: string,clockSessionId?:string) {
  if(a.authorizedInstallationId&&a.authorizedInstallationId!==installationId)throw new ConsumerError(403,'installation_scope_mismatch');
  const found = (await db.query('SELECT id FROM sensa_consumer.installations WHERE id=$1 AND account_id=$2', [installationId,a.account_id])).rows[0];
  if (!found) throw new ConsumerError(403,'installation_scope_mismatch');
  const current = await plan(db,a);
  return accountContextSchema.parse({ accountId:a.account_id,learnerUserId:a.learner_user_id,accountSessionId:a.session_id,
    installationId,accessStatus:'invited',timeZone:a.time_zone,timeZoneRevision:'1',quantityConfirmed:current!==null,plan:current,
    clockGrant:await issueAccountClock(db,a,installationId,clockSessionId),supportedWireVersions:[consumerWireVersion],minClientVersion:'0.1.0' });
}
async function replica(db: DatabaseExecutor, a: Account, replicaId: string, installationId?: string) {
  const row = (await db.query('SELECT * FROM sensa_consumer.installations WHERE replica_id=$1 AND account_id=$2', [replicaId,a.account_id])).rows[0];
  if (a.authorizedInstallationId&&row?.id!==a.authorizedInstallationId)throw new ConsumerError(403,'installation_scope_mismatch');
  if (!row || (installationId && row.id !== installationId)) throw new ConsumerError(403,'replica_scope_mismatch');
  return row;
}
function cursor(a: Account, replicaId: string, head: string) { return `${a.account_id}:${a.epoch}:${replicaId}:${head}`; }
async function digest(operation: ConsumerOperation) {
  const bytes = new TextEncoder().encode(canonicalConsumerJson({wireVersion:consumerWireVersion,canonicalizerVersion:consumerCanonicalizerVersion,operation}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
}
async function execute(db: DatabaseExecutor, a: Account, op: ConsumerOperation): Promise<QuantityResult> {
  const hash=await digest(op);
  const old=(await db.query('SELECT * FROM sensa_consumer.operations WHERE learner_user_id=$1 AND operation_id=$2',[a.learner_user_id,op.operationId])).rows[0];
  if (old) {
    if (old.digest!==hash) return {operationId:op.operationId,status:'rejected',error:fail('operation_id_reuse')};
    const result=old.result as QuantityResult;
    if(result.status==='accepted') return {operationId:op.operationId,status:'replayed',original:'accepted',value:result.value,error:null};
    if(result.status==='conflict'||result.status==='rejected') return {operationId:op.operationId,status:'replayed',original:result.status,value:null,error:result.error};
    throw new Error('Invalid stored result');
  }
  for(const dependency of op.dependsOn) {
    const prior=(await db.query('SELECT result FROM sensa_consumer.operations WHERE learner_user_id=$1 AND operation_id=$2',[a.learner_user_id,dependency])).rows[0];
    if(!prior) return {operationId:op.operationId,status:'retryable',error:{...fail('missing_dependency'),retryable:true}};
    if(prior.result.status!=='accepted') return store({operationId:op.operationId,status:'rejected',error:fail('blocked_by_prior_operation')});
  }
  if(op.kind==='content.set_membership'||op.kind==='personal.set_anchor_use'){
    await db.query('SAVEPOINT domain_operation');
    try{
      const {targetIds,...value}=op.kind==='personal.set_anchor_use'?await setAnchorUse(db,a,op):await setContentMembership(db,a,op);
      await publish(db,a,'meaning' in value?'personal_meaning':'intake','meaning' in value?value.meaning:value.intake);
      for(const id of targetIds)await publish(db,a,'target',await targetView(db,a,id));
      await db.query('RELEASE SAVEPOINT domain_operation');
      return store({operationId:op.operationId,status:'accepted',value:{plan:await plan(db,a),...value}});
    }catch(e){if(!(e instanceof ConsumerError))throw e;await db.query('ROLLBACK TO SAVEPOINT domain_operation');return store({operationId:op.operationId,status:'rejected',error:fail(e.code)});}
  }
  if(op.kind==='semantic.accept'){
    await db.query('SAVEPOINT domain_operation');
    try{const value=await acceptSemantic(db,a,op);if(!value.alreadySaved)await publish(db,a,'personal_meaning',value.meaning);for(const intake of await listIntakes(db,a))if(intake.meaningId===value.meaning.id)await publish(db,a,'intake',intake);await db.query('RELEASE SAVEPOINT domain_operation');return store({operationId:op.operationId,status:'accepted',value:{...value,plan:await plan(db,a)}});}
    catch(error){if(!(error instanceof ConsumerError)||error.status===503)throw error;await db.query('ROLLBACK TO SAVEPOINT domain_operation');return store({operationId:op.operationId,status:'rejected',error:fail(error.code)});}
  }
  if(op.kind==='intake.save'){
    const value=await saveIntake(db,a,op);if(!value.alreadySaved)await publish(db,a,'intake',value.intake);
    return store({operationId:op.operationId,status:'accepted',value:{...value,plan:await plan(db,a)}});
  }
  if(op.kind==='check_in.record'){
    await db.query('SAVEPOINT domain_operation');
    try{const current=await plan(db,a);if(!current)throw new ConsumerError(409,'onboarding_required');const value=await recordCheckIn(db,a,op);if(!value.alreadyRecorded)await publish(db,a,'check_in',value.checkin);await db.query('RELEASE SAVEPOINT domain_operation');return store({operationId:op.operationId,status:'accepted',value:{...value,plan:current}});}
    catch(error){if(!(error instanceof ConsumerError)||error.status===503)throw error;await db.query('ROLLBACK TO SAVEPOINT domain_operation');return store({operationId:op.operationId,status:'rejected',error:fail(error.code)});}
  }
  if(op.kind==='activity.start_or_resume'||op.kind==='activity.next'||op.kind==='activity.pause'||op.kind==='activity.end'||op.kind==='run.record_action'){
    await db.query('SAVEPOINT domain_operation');
    try {
      const runtime=await applyRuntime(db,a,op),next=(await plan(db,a))!;
      if(runtime.run){await publish(db,a,'run',{...runtime.run,offlineGrant:null});await publish(db,a,'target',await targetView(db,a,runtime.run.learningTargetId));}
      await publish(db,a,'activity',runtime.activity);await publish(db,a,'plan',next);
      await db.query('RELEASE SAVEPOINT domain_operation');
      return store({operationId:op.operationId,status:'accepted',value:{plan:next,runtime}});
    }catch(error){
      if(!(error instanceof ConsumerError)||error.status===503)throw error;
      await db.query('ROLLBACK TO SAVEPOINT domain_operation');
      return store({operationId:op.operationId,status:['revision_conflict','stale_step'].includes(error.code)?'conflict':'rejected',error:fail(error.code)});
    }
  }
  if(op.kind==='personal.add_to_learning'||op.kind==='learning.cancel_preparation'||op.kind==='curriculum.add_target'||op.kind==='learning.retry_preparation'||op.kind==='declared_mastery.set'){
    await db.query('SAVEPOINT domain_operation');
    try {
      const value=op.kind==='personal.add_to_learning'?await addPersonalTarget(db,a,op):await applyTargetOperation(db,a,op);const next=(await plan(db,a))!;
      await publish(db,a,'target',value.target);
      await publish(db,a,'plan',next);
      await db.query('RELEASE SAVEPOINT domain_operation');
      return store({operationId:op.operationId,status:'accepted',value:{...value,plan:next}});
    }catch(error){
      if(!(error instanceof ConsumerError)||error.status===503)throw error;
      await db.query('ROLLBACK TO SAVEPOINT domain_operation');
      return store({operationId:op.operationId,status:error.code==='revision_conflict'?'conflict':'rejected',error:fail(error.code)});
    }
  }
  const current=await plan(db,a);
  let result: QuantityResult;
  const expected=op.payload.expectedRevision;
  if ((current?.revision??null)!==expected || (op.kind==='plan.set_quantity' && current?.id!==op.payload.planId)) {
    result={operationId:op.operationId,status:'conflict',error:fail('revision_conflict',current?{id:current.id,revision:current.revision}:null)};
  } else if (op.kind==='plan.confirm_quantity' && current) {
    result={operationId:op.operationId,status:'rejected',error:fail('already_confirmed')};
  } else if (op.kind==='plan.confirm_quantity' && op.payload.timeZone!==a.time_zone) {
    result={operationId:op.operationId,status:'conflict',error:fail('time_zone_conflict')};
  } else {
    await db.query(`INSERT INTO sensa_consumer.plans(learner_user_id,revision,daily_new_limit) VALUES($1,1,$2)
      ON CONFLICT(learner_user_id) DO UPDATE SET revision=sensa_consumer.plans.revision+1,daily_new_limit=EXCLUDED.daily_new_limit`,[a.learner_user_id,op.payload.dailyNewLimit]);
    const next=(await plan(db,a))!;
    await publish(db,a,'plan',next);
    result={operationId:op.operationId,status:'accepted',value:{plan:next}};
  }
  return store(result);
  async function store(result: QuantityResult) {
    await db.query('INSERT INTO sensa_consumer.operations(learner_user_id,operation_id,digest,result) VALUES($1,$2,$3,$4::jsonb)',[a.learner_user_id,op.operationId,hash,JSON.stringify(result)]);
    return result;
  }
}

async function publish(db:DatabaseExecutor,a:Account,entity:string,snapshot:unknown){
  const head=(await db.query('UPDATE sensa_consumer.accounts SET feed_head=feed_head+1 WHERE account_id=$1 RETURNING feed_head',[a.account_id])).rows[0]!.feed_head;
  await db.query('INSERT INTO sensa_consumer.changes(learner_user_id,sequence,snapshot,entity_type) VALUES($1,$2,$3::jsonb,$4)',[a.learner_user_id,head,JSON.stringify(snapshot),entity]);
}

export function createConsumerRoutes(options: {deleteIdentity?:DeleteIdentity;telemetry?:(record:ServiceRequestRecord)=>void;verify?:ConsumerVerifier; transaction?:Transaction;mediaReader?:ConsumerMediaReader;clock?:()=>Date;semanticResolver?:SemanticResolver;contentGenerator?:ContentGenerator;contentReviewer?:ContentReviewer;readingCompletion?:ReadingCompletion;modelTurnCompletion?:ModelTurnCompletion} = {}) {
  const clock=options.clock??(()=>new Date());const app=new Hono(); const transaction=options.transaction??unsafeTransaction; const verify=extensionVerifier(options.verify??verifyConsumer,transaction,clock);
  app.use('*',serviceTelemetry(options.telemetry));
  app.use('*',(c,next)=>bodyLimit({maxSize:c.req.path.endsWith('/sensa/model/turn')?12*1024*1024:c.req.path.endsWith('/sensa/library-sync/blocks/store')?librarySyncBlockStoreChars+1024*1024:256*1024,onError:c=>c.json({code:'body_too_large'},413)})(c,next));
  app.onError((e,c)=> {
    if(e instanceof ConsumerError)return c.json({code:e.code},e.status);
    if(e instanceof z.ZodError || e instanceof SyntaxError)return c.json({code:'invalid_request'},400);
    return c.json({code:'temporarily_unavailable'},503);
  });
  registerLibrarySync(app,async(request,work)=>{const identity=await verify(request);return transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return work(db,{accountId:a.account_id,installationId:identity.installationId,now:a.now});});});
  registerReadingRoutes(app,async(request,work)=>{const identity=await verify(request);return transaction(async db=>work(db,await account(db,identity,undefined,false,clock())));},options.readingCompletion);
  app.route('/sensa/model',createModelTurnRoutes({
    authorize:async request=>{const identity=await verify(request);return transaction(async db=>activeMeaningConnection(db,await account(db,identity,undefined,false,clock())));},
    reserve:async(request,input)=>{const identity=await verify(request);await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());
      const old=(await db.query('SELECT input_digest FROM sensa_consumer.native_semantic_usage WHERE account_id=$1 AND request_id=$2',[a.account_id,input.id])).rows[0];
      if(old)throw new ConsumerError(409,'model_request_consumed');
      const count=(await db.query('SELECT count(*)::int AS n FROM sensa_consumer.native_semantic_usage WHERE account_id=$1 AND created_at>$2',[a.account_id,new Date(a.now.getTime()-86400000)])).rows[0]!.n;
      if(process.env.SENSA_UNLIMITED_MODEL_USAGE!=='true'&&count>=modelDailyLimit)throw new ConsumerError(409,'model_daily_budget');
      await db.query('INSERT INTO sensa_consumer.native_semantic_usage VALUES($1,$2,$3,$4)',[a.account_id,input.id,input.inputDigest,a.now]);
    });},
    complete:options.modelTurnCompletion,
  }));
  app.get('/sensa/packages',async c=>{
    const identity=await verify(c.req.raw);await transaction(async db=>account(db,identity,undefined,false,clock()));
    // Publication catalog is deployment-owned. An absent catalog is genuinely empty.
    const catalog=learningPackageCatalogSchema.parse(JSON.parse(process.env.SENSA_PACKAGE_CATALOG_JSON??'{"items":[]}'));
    c.header('Cache-Control','no-store');return c.json(catalog);
  });
  app.post('/sensa/extension/authorize',async c=>{const identity=await verify(c.req.raw);if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');const input=extensionAuthorizationSchema.parse(await c.req.json());return c.json(await transaction(async db=>authorizeExtension(db,await account(db,identity,undefined,false,clock()),input)));});
  app.post('/sensa/extension/exchange',async c=>{const input=extensionExchangeSchema.parse(await c.req.json());return c.json(await transaction(db=>exchangeExtension(db,input,clock())));});
  // Service access is account-scoped and does not create a learning replica or plan.
  app.get('/sensa/service/status',async c=>{
    const identity=await verify(c.req.raw);
    const result=await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());
      const since=new Date(a.now.getTime()-86400000);
      const reading=Number((await db.query('SELECT count(*)::int AS n FROM sensa_consumer.reading_requests WHERE account_id=$1 AND created_at>$2',[a.account_id,since])).rows[0]!.n);
      const teacher=Number((await db.query('SELECT count(*)::int AS n FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND created_at>$2',[a.learner_user_id,since])).rows[0]!.n);
      const content=Number((await db.query('SELECT count(*)::int AS n FROM sensa_consumer.provisioning_attempts p JOIN sensa_consumer.provisioning_tasks t ON t.id=p.task_id WHERE t.learner_user_id=$1 AND p.started_at>$2',[a.learner_user_id,since])).rows[0]!.n);
      let explanationAvailable=false;
      try{await activeMeaningConnection(db,a);explanationAvailable=true;}catch(e){if(!(e instanceof ConsumerError))throw e;}
      return {authorized:true,explanationAvailable,checkedAt:a.now.toISOString(),windowHours:24,
        usage:[{kind:'reading',used:reading,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:readingDailyLimit},{kind:'teacher',used:teacher,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:modelDailyLimit},{kind:'content',used:content,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:modelDailyLimit}]};
    });
    c.header('Cache-Control','no-store');return c.json(result);
  });
  app.post('/sensa/web/access/session',async c=>{
    const identity=await verify(c.req.raw);const input=z.object({installationId:uuid}).strict().parse(await c.req.json());
    return c.json(await transaction(async db=>{const a=await account(db,identity,{...input,platform:'web',timeZone:'UTC'},false,clock(),true);return {authorized:true,accountId:a.account_id};}));
  });
  app.post('/sensa/account/session',async c=> {
    const identity=await verify(c.req.raw);const input=installationInputSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{const a=await account(db,identity,input,false,clock());return query(a,await context(db,a,input.installationId,input.clockSessionId));}));
  });
  app.get('/sensa/account/session',async c=>{
    const identity=await verify(c.req.raw);const installationId=uuid.parse(c.req.header('x-installation-id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await context(db,a,installationId));}));
  });
  // The unguessable operation ID is a deletion receipt, not authority to start deletion.
  app.post('/sensa/account/deletion/status',async c=>{
    const input=z.object({operationId:uuid}).strict().parse(await c.req.json());
    const identity=await transaction(async db=>(await db.query('SELECT a.issuer,a.subject FROM sensa_consumer.account_deletions d JOIN sensa_consumer.accounts a USING(account_id) WHERE d.operation_id=$1',[input.operationId])).rows[0]);
    if(!identity)throw new ConsumerError(404,'deletion_not_found');
    return c.json(await finishAccountDeletion(transaction,{issuer:String(identity.issuer),subject:String(identity.subject)},input.operationId,options.deleteIdentity));
  });
  app.post('/sensa/account/deletion',async c=>{
    const identity=await verify(c.req.raw);const input=z.object({operationId:uuid,confirmation:z.literal('delete-account')}).strict().parse(await c.req.json());
    if(!options.deleteIdentity)assertDeletionConfigured();
    await transaction(db=>requestAccountDeletion(db,identity,input.operationId,clock()));
    return c.json(await finishAccountDeletion(transaction,identity,input.operationId,options.deleteIdentity));
  });
  app.post('/sensa/account/session/revoke',async c=>{
    const identity=await verify(c.req.raw); z.object({operationId:uuid}).strict().parse(await c.req.json());
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,true,clock());await db.query('UPDATE sensa_consumer.sessions SET revoked=true WHERE id=$1',[a.session_id]);return {revoked:true};}));
  });
  app.post('/sensa/sync/bootstrap',async c=>{
    const identity=await verify(c.req.raw);const input=consumerBootstrapSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());
      if(a.authorizedInstallationId&&a.authorizedInstallationId!==input.installationId)throw new ConsumerError(403,'installation_scope_mismatch');
      const install=(await db.query('SELECT * FROM sensa_consumer.installations WHERE id=$1 AND account_id=$2',[input.installationId,a.account_id])).rows[0];
      if(!install || (input.replicaId && install.replica_id!==input.replicaId))throw new ConsumerError(403,'replica_scope_mismatch');
      return {wireVersion:consumerWireVersion,scopeEpoch:String(a.epoch),replicaId:install.replica_id,
        snapshotId:crypto.randomUUID(),pageCursor:null,syncCursor:cursor(a,install.replica_id,String(a.feed_head)),plan:await plan(db,a),targets:await listTargets(db,a),runs:await listRuns(db,a),activity:await currentActivity(db,a),checkins:await listCheckIns(db,a),intakes:await listIntakes(db,a),meanings:await listMeanings(db,a)};
    }));
  });
  app.post('/sensa/sync/push',async c=>{
    const identity=await verify(c.req.raw);const body=await c.req.json();
    // Authorize even an empty batch; JWT validity alone is not Sensa access.
    const envelope=consumerPushSchema.omit({operations:true}).extend({operations:z.array(z.unknown()).max(50)}).parse(body);
    await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());if(String(a.epoch)!==envelope.scopeEpoch)throw new ConsumerError(409,'bootstrap_required');
      await replica(db,a,envelope.replicaId);
    });
    if(envelope.operations.some(op=>op && typeof op==='object' && 'kind' in op && !['plan.confirm_quantity','plan.set_quantity','curriculum.add_target','learning.retry_preparation','declared_mastery.set','activity.start_or_resume','activity.next','activity.pause','activity.end','run.record_action','check_in.record','intake.save','semantic.accept','personal.add_to_learning','learning.cancel_preparation','content.set_membership','personal.set_anchor_use'].includes(String(op.kind))))throw new ConsumerError(400,'unsupported_operation');
    const input:ConsumerPush=consumerPushSchema.parse(body);
    if(new Set(input.operations.map(o=>o.operationId)).size!==input.operations.length)throw new ConsumerError(400,'duplicate_operation');
    const pending=[...input.operations], ordered:ConsumerOperation[]=[];
    while(pending.length){const i=pending.findIndex(o=>!o.dependsOn.some(d=>pending.some(x=>x.operationId===d)));if(i<0)throw new ConsumerError(400,'dependency_cycle');ordered.push(...pending.splice(i,1));}
    const results:QuantityResult[]=[];
    for(const op of ordered) {try{results.push(await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());if(String(a.epoch)!==input.scopeEpoch)throw new ConsumerError(409,'bootstrap_required');
      if(op.replicaId!==input.replicaId)throw new ConsumerError(403,'replica_scope_mismatch');
      await replica(db,a,input.replicaId,op.installationId);return execute(db,a,op);
    }));}catch(error){if(op.kind!=='check_in.record'||(error instanceof ConsumerError&&error.status!==503))throw error;results.push({operationId:op.operationId,status:'retryable',error:{...fail('temporarily_unavailable'),retryable:true}});}}
    return c.json({wireVersion:consumerWireVersion,results,serverTime:clock().toISOString()});
  });
  app.post('/sensa/sync/pull',async c=>{
    const identity=await verify(c.req.raw);const input=consumerPullSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{
      const a=await account(db,identity,undefined,false,clock());await replica(db,a,input.replicaId);
      const prefix=cursor(a,input.replicaId,'');const last=input.cursor.startsWith(prefix)?input.cursor.slice(prefix.length):'';
      if(input.scopeEpoch!==String(a.epoch)||!/^(0|[1-9][0-9]*)$/u.test(last)||BigInt(last)>BigInt(a.feed_head))throw new ConsumerError(409,'bootstrap_required');
      const rows=(await db.query('SELECT * FROM sensa_consumer.changes WHERE learner_user_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',[a.learner_user_id,last,(input.limit??100)+1])).rows;
      const hasMore=rows.length>(input.limit??100);const page=rows.slice(0,input.limit??100);
      return {wireVersion:consumerWireVersion,scopeEpoch:String(a.epoch),changes:page.map(r=>({sequence:String(r.sequence),entityType:r.entity_type,id:r.entity_type==='target'?r.snapshot.learningTarget.learningTargetId:r.snapshot.id,revision:r.entity_type==='target'?r.snapshot.membership.revision:r.snapshot.revision,action:'upsert',snapshot:r.snapshot})),
        nextCursor:cursor(a,input.replicaId,String(page.at(-1)?.sequence??last)),hasMore,serverTime:iso()};
    }));
  });
  app.post('/sensa/provisioning/:targetId/advance',async c=>{const identity=await verify(c.req.raw),targetId=uuid.parse(c.req.param('targetId'));z.object({}).strict().parse(await c.req.json());await processTask({targetId,generate:options.contentGenerator??generateContent,review:options.contentReviewer??reviewContent,withScope:work=>transaction(async db=>{const a=await account(db,identity,undefined,false,clock());const before=await targetView(db,a,targetId);const result=await work(db,a);const after=await targetView(db,a,targetId);if(before.plan?.revision!==after.plan?.revision)await publish(db,a,'target',after);return result;})});return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await targetView(db,a,targetId));}));});
  for(const path of ['/sensa/semantic/lookups','/sensa/semantic/lookups/stream'])app.post(path,async c=>{
    const identity=await verify(c.req.raw),input=semanticLookupInputSchema.parse(await c.req.json());
    const started=await transaction(async db=>beginLookup(db,await account(db,identity,undefined,false,clock()),input));
    async function resolve(onExplanation?:(text:string)=>Promise<void>){
      if(!started.fresh)return started.view;
      let result=null,failureReason='provider_unavailable';
      try{const connection=options.semanticResolver?null:await transaction(async db=>activeMeaningConnection(db,await account(db,identity,undefined,false,clock())));
        result=await (options.semanticResolver??semanticResolverFor(connection!,options.readingCompletion))(input.snapshot,started.view.focus,onExplanation);
      }catch(error){
        // Only stable service codes cross the boundary; never provider payloads.
        failureReason=error instanceof ConsumerError?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'model_invalid_response':'provider_unavailable';
      }
      return transaction(async db=>finishLookup(db,await account(db,identity,undefined,false,clock()),input.id,result,failureReason));
    }
    if(!path.endsWith('/stream'))return c.json(await resolve());
    c.header('Content-Type','application/x-ndjson');c.header('Cache-Control','no-store');c.header('X-Accel-Buffering','no');
    return stream(c,async output=>{
      let last=0;
      try{
        const result=await resolve(async text=>{if(output.aborted)throw new ConsumerError(503,'reading_interrupted');if(Date.now()-last<100)return;last=Date.now();await transaction(async db=>account(db,identity,undefined,false,clock()));await output.write(JSON.stringify({type:'partial',text})+'\n');});
        await output.write(JSON.stringify({type:'result',value:result})+'\n');
      }catch(e){if(!output.aborted)await output.write(JSON.stringify({type:'error',error:e instanceof ConsumerError?e.code:'provider_unavailable'})+'\n');}
    });
  });
  app.get('/sensa/semantic/lookups/:id',async c=>{const identity=await verify(c.req.raw),id=uuid.parse(c.req.param('id'));return c.json(await transaction(async db=>readLookup(db,await account(db,identity,undefined,false,clock()),id)));});
  app.get('/sensa/intakes/:id/lookup',async c=>{const identity=await verify(c.req.raw),id=uuid.parse(c.req.param('id'));return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock()),intake=await readIntake(db,a,id);const row=(await db.query("SELECT id FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND snapshot=$2::jsonb AND reason IS DISTINCT FROM 'superseded' AND expires_at>$3 ORDER BY created_at DESC,id DESC LIMIT 1",[a.learner_user_id,JSON.stringify(intake.snapshot),a.now])).rows[0];return row?await readLookup(db,a,row.id):null;}));});
  app.get('/sensa/intakes/:id',async c=>{const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await readIntake(db,a,id));}));});
  app.get('/sensa/home',async c=>{
    const identity=await verify(c.req.raw);
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());const current=await plan(db,a);const targets=await listTargets(db,a);
      const runs=await listRuns(db,a),active=runs.filter(r=>r.status==='active'&&r.currentStep);
      const available=Math.min((await initialAvailability(db,a)).length,current?.newRemaining??0),retention=await retentionAvailability(db,a);
      const ready=retention.needs.filter(n=>n.next_eligible_at<=a.now),waiting=retention.needs.filter(n=>n.next_eligible_at>a.now);
      const distinct=new Set([...active.map(r=>r.retentionTargetId),...retention.due.map(r=>r.retention_target_id),...ready.map(r=>r.retention_target_id)]);
      const act=await currentActivity(db,a),summary=act?await activitySummary(db,a,act):null;
      return query(a,{plan:current,targets,runs,activity:act,summary,checkins:await listCheckIns(db,a),counts:{newAvailable:available,initialContinuations:active.filter(r=>r.purpose==='initial_learning').length,dueReviews:retention.due.length+active.filter(r=>r.purpose==='retention_review').length,relearningReady:ready.length,relearningWaiting:waiting.length,distinctExecutableTargets:available+distinct.size},resumeItems:active,emptyReason:!current?'onboarding_required':!targets.length?'no_targets':available||distinct.size?null:waiting.length?'waiting_relearning':targets.some(t=>t.plan?.readiness==='preparing')?'preparing':targets.every(t=>t.plan?.readiness==='blocked')?'blocked':current.newRemaining===0?'daily_limit':'none_due'});
    }));
  });
  app.get('/sensa/check-ins',async c=>{const identity=await verify(c.req.raw);return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await listCheckIns(db,a));}));});
  app.get('/sensa/activities/:id',async c=>{
    const identity=await verify(c.req.raw),id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());const row=(await db.query('SELECT id,revision,mode,status,current_run_id FROM sensa_consumer.activities WHERE id=$1 AND learner_user_id=$2',[id,a.learner_user_id])).rows[0];if(!row)throw new ConsumerError(404,'activity_not_found');return query(a,await activitySummary(db,a,{id:row.id,mode:row.mode,status:row.status,revision:String(row.revision),runId:row.current_run_id}));}));
  });
  app.get('/sensa/runs/:id',async c=>{
    const identity=await verify(c.req.raw),id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await runView(db,a,id));}));
  });
  app.get('/sensa/catalog/targets',async c=>{
    const identity=await verify(c.req.raw);const input=catalogQuerySchema.parse(c.req.query());
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await listCatalog(db,input));}));
  });
  app.get('/sensa/catalog/targets/:id',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await targetView(db,a,id,true));}));
  });
  app.get('/sensa/learning-targets/:id',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await targetView(db,a,id));}));
  });
  app.get('/sensa/materializations/:id',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));
    c.header('Cache-Control','private, no-store');
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return query(a,await materialView(db,a,id));}));
  });
  app.get('/sensa/materializations/:id/media/:digest',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));const digest=z.string().regex(/^[0-9a-f]{64}$/u).parse(c.req.param('digest'));
    const media=await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());return authorizeMedia(db,a,id,digest);});
    const bytes=await (options.mediaReader??readConsumerMedia)(digest);
    if(!bytes||bytes.length!==media.byte_size||await bytesDigest(bytes)!==digest)throw new ConsumerError(503,'media_unavailable');
    return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':media.mime_type,'Cache-Control':'private, no-store','Content-Length':String(bytes.length)}});
  });
  app.get('/sensa/operations/:id',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,false,clock());const row=(await db.query('SELECT result FROM sensa_consumer.operations WHERE learner_user_id=$1 AND operation_id=$2',[a.learner_user_id,id])).rows[0];return row?{state:'known',result:row.result}:{state:'not_found'};}));
  });
  return app;
}
