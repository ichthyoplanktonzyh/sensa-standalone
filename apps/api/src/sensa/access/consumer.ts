import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  consumerVersion, consumerWireVersion, consumerCanonicalizerVersion, canonicalConsumerJson,
  installationInputSchema, accountContextSchema, planViewSchema, consumerPushSchema,
  consumerBootstrapSchema, consumerPullSchema,
} from '@sensa/contracts/sensa';
import type { QuantityOperation, QuantityResult, PlanView, ConsumerPush } from '@sensa/contracts/sensa';
import { unsafeTransaction } from '../../database/index.js';
import type { DatabaseExecutor } from '../../database/index.js';
import { ConsumerError, verifyConsumer } from './auth.js';
import type { ConsumerVerifier, ConsumerPrincipal } from './auth.js';

type Account = { account_id: string; learner_user_id: string; epoch: string; feed_head: string; time_zone: string; session_id: string };
type Transaction = <T>(work: (db: DatabaseExecutor) => Promise<T>) => Promise<T>;
const uuid = z.string().uuid();
const fail = (code: string, latest: {id: string; revision: string}|null = null) => ({ code, retryable: false, retryAfterMs: null, latest, field: null, messageKey: code });
const iso = () => new Date().toISOString();
async function account(db: DatabaseExecutor, identity: ConsumerPrincipal, create?: z.infer<typeof installationInputSchema>, allowRevokedSession = false): Promise<Account> {
  const invite = (await db.query('SELECT revoked FROM sensa_consumer.invitations WHERE issuer=$1 AND subject=$2 FOR UPDATE', [identity.issuer,identity.subject])).rows[0];
  if (!invite || invite.revoked) throw new ConsumerError(403, 'invite_required');
  let row = (await db.query('SELECT * FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE', [identity.issuer,identity.subject])).rows[0];
  if (!row && create) {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)', [id,identity.email]);
    await db.query('INSERT INTO core.learners(learner_user_id) VALUES($1)', [id]);
    row = (await db.query('INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,$2,$3,$4) RETURNING *', [id,identity.issuer,identity.subject,create.timeZone])).rows[0];
  }
  if (!row) throw new ConsumerError(409,'session_initialization_required');
  let session = (await db.query('SELECT * FROM sensa_consumer.sessions WHERE account_id=$1 AND provider_session_id=$2', [row.account_id,identity.sessionId])).rows[0];
  if (!session && create) session = (await db.query('INSERT INTO sensa_consumer.sessions(account_id,provider_session_id) VALUES($1,$2) RETURNING *', [row.account_id,identity.sessionId])).rows[0];
  if (!session || (session.revoked && !allowRevokedSession)) throw new ConsumerError(401,'access_revoked');
  if (create) {
    await db.query('INSERT INTO sensa_consumer.installations(id,account_id,platform) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING', [create.installationId,row.account_id,create.platform]);
    const installation = (await db.query('SELECT account_id FROM sensa_consumer.installations WHERE id=$1', [create.installationId])).rows[0];
    if (installation?.account_id !== row.account_id) throw new ConsumerError(403,'installation_scope_mismatch');
  }
  return { ...row, session_id: session.id } as Account;
}
async function plan(db: DatabaseExecutor, a: Account): Promise<PlanView|null> {
  const row = (await db.query('SELECT * FROM sensa_consumer.plans WHERE learner_user_id=$1', [a.learner_user_id])).rows[0];
  if (!row) return null;
  const date = (await db.query("SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS day", [a.time_zone])).rows[0]!.day;
  return planViewSchema.parse({ id:row.id,revision:String(row.revision),scopeRevision:String(row.scope_revision),
    quantityConfirmed:true,dailyNewLimit:row.daily_new_limit,timeZone:a.time_zone,accountDate:date,newStartedToday:0,newRemaining:row.daily_new_limit });
}
function query(a: Account, data: unknown) { return { contractVersion:consumerVersion,serverTime:iso(),scopeEpoch:String(a.epoch),projectionRevision:String(a.feed_head),data }; }
async function context(db: DatabaseExecutor, a: Account, installationId: string) {
  const found = (await db.query('SELECT id FROM sensa_consumer.installations WHERE id=$1 AND account_id=$2', [installationId,a.account_id])).rows[0];
  if (!found) throw new ConsumerError(403,'installation_scope_mismatch');
  const current = await plan(db,a);
  return accountContextSchema.parse({ accountId:a.account_id,learnerUserId:a.learner_user_id,accountSessionId:a.session_id,
    installationId,accessStatus:'invited',timeZone:a.time_zone,timeZoneRevision:'1',quantityConfirmed:current!==null,plan:current,
    supportedWireVersions:[consumerWireVersion],minClientVersion:'0.1.0' });
}
async function replica(db: DatabaseExecutor, a: Account, replicaId: string, installationId?: string) {
  const row = (await db.query('SELECT * FROM sensa_consumer.installations WHERE replica_id=$1 AND account_id=$2', [replicaId,a.account_id])).rows[0];
  if (!row || (installationId && row.id !== installationId)) throw new ConsumerError(403,'replica_scope_mismatch');
  return row;
}
function cursor(a: Account, replicaId: string, head: string) { return `${a.account_id}:${a.epoch}:${replicaId}:${head}`; }
async function digest(operation: QuantityOperation) {
  const bytes = new TextEncoder().encode(canonicalConsumerJson({wireVersion:consumerWireVersion,canonicalizerVersion:consumerCanonicalizerVersion,operation}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
}
async function execute(db: DatabaseExecutor, a: Account, op: QuantityOperation): Promise<QuantityResult> {
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
    const head=(await db.query('UPDATE sensa_consumer.accounts SET feed_head=feed_head+1 WHERE account_id=$1 RETURNING feed_head',[a.account_id])).rows[0]!.feed_head;
    await db.query('INSERT INTO sensa_consumer.changes(learner_user_id,sequence,snapshot) VALUES($1,$2,$3::jsonb)',[a.learner_user_id,head,JSON.stringify(next)]);
    result={operationId:op.operationId,status:'accepted',value:{plan:next}};
  }
  return store(result);
  async function store(result: QuantityResult) {
    await db.query('INSERT INTO sensa_consumer.operations(learner_user_id,operation_id,digest,result) VALUES($1,$2,$3,$4::jsonb)',[a.learner_user_id,op.operationId,hash,JSON.stringify(result)]);
    return result;
  }
}

export function createConsumerRoutes(options: {verify?:ConsumerVerifier; transaction?:Transaction} = {}) {
  const app=new Hono(); const verify=options.verify??verifyConsumer; const transaction=options.transaction??unsafeTransaction;
  app.use('*',bodyLimit({maxSize:256*1024,onError:c=>c.json({code:'body_too_large'},413)}));
  app.onError((e,c)=> {
    if(e instanceof ConsumerError)return c.json({code:e.code},e.status);
    if(e instanceof z.ZodError || e instanceof SyntaxError)return c.json({code:'invalid_request'},400);
    console.error('Consumer request failed',e instanceof Error?e.name:'unknown');
    return c.json({code:'temporarily_unavailable'},503);
  });
  app.post('/sensa/account/session',async c=> {
    const identity=await verify(c.req.raw);const input=installationInputSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{const a=await account(db,identity,input);return query(a,await context(db,a,input.installationId));}));
  });
  app.get('/sensa/account/session',async c=>{
    const identity=await verify(c.req.raw);const installationId=uuid.parse(c.req.header('x-installation-id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity);return query(a,await context(db,a,installationId));}));
  });
  app.post('/sensa/account/session/revoke',async c=>{
    const identity=await verify(c.req.raw); z.object({operationId:uuid}).strict().parse(await c.req.json());
    return c.json(await transaction(async db=>{const a=await account(db,identity,undefined,true);await db.query('UPDATE sensa_consumer.sessions SET revoked=true WHERE id=$1',[a.session_id]);return {revoked:true};}));
  });
  app.post('/sensa/sync/bootstrap',async c=>{
    const identity=await verify(c.req.raw);const input=consumerBootstrapSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{
      const a=await account(db,identity);
      const install=(await db.query('SELECT * FROM sensa_consumer.installations WHERE id=$1 AND account_id=$2',[input.installationId,a.account_id])).rows[0];
      if(!install || (input.replicaId && install.replica_id!==input.replicaId))throw new ConsumerError(403,'replica_scope_mismatch');
      return {wireVersion:consumerWireVersion,scopeEpoch:String(a.epoch),replicaId:install.replica_id,
        snapshotId:crypto.randomUUID(),pageCursor:null,syncCursor:cursor(a,install.replica_id,String(a.feed_head)),plan:await plan(db,a)};
    }));
  });
  app.post('/sensa/sync/push',async c=>{
    const identity=await verify(c.req.raw);const body=await c.req.json();
    // Authorize even an empty batch; JWT validity alone is not Sensa access.
    const envelope=consumerPushSchema.omit({operations:true}).extend({operations:z.array(z.unknown()).max(50)}).parse(body);
    await transaction(async db=>{
      const a=await account(db,identity);if(String(a.epoch)!==envelope.scopeEpoch)throw new ConsumerError(409,'bootstrap_required');
      await replica(db,a,envelope.replicaId);
    });
    if(envelope.operations.some(op=>op && typeof op==='object' && 'kind' in op && !['plan.confirm_quantity','plan.set_quantity'].includes(String(op.kind))))throw new ConsumerError(400,'unsupported_operation');
    const input:ConsumerPush=consumerPushSchema.parse(body);
    if(new Set(input.operations.map(o=>o.operationId)).size!==input.operations.length)throw new ConsumerError(400,'duplicate_operation');
    const pending=[...input.operations], ordered:QuantityOperation[]=[];
    while(pending.length){const i=pending.findIndex(o=>!o.dependsOn.some(d=>pending.some(x=>x.operationId===d)));if(i<0)throw new ConsumerError(400,'dependency_cycle');ordered.push(...pending.splice(i,1));}
    const results:QuantityResult[]=[];
    for(const op of ordered) results.push(await transaction(async db=>{
      const a=await account(db,identity);if(String(a.epoch)!==input.scopeEpoch)throw new ConsumerError(409,'bootstrap_required');
      if(op.replicaId!==input.replicaId)throw new ConsumerError(403,'replica_scope_mismatch');
      await replica(db,a,input.replicaId,op.installationId);return execute(db,a,op);
    }));
    return c.json({wireVersion:consumerWireVersion,results,serverTime:iso()});
  });
  app.post('/sensa/sync/pull',async c=>{
    const identity=await verify(c.req.raw);const input=consumerPullSchema.parse(await c.req.json());
    return c.json(await transaction(async db=>{
      const a=await account(db,identity);await replica(db,a,input.replicaId);
      const prefix=cursor(a,input.replicaId,'');const last=input.cursor.startsWith(prefix)?input.cursor.slice(prefix.length):'';
      if(input.scopeEpoch!==String(a.epoch)||!/^(0|[1-9][0-9]*)$/u.test(last)||BigInt(last)>BigInt(a.feed_head))throw new ConsumerError(409,'bootstrap_required');
      const rows=(await db.query('SELECT * FROM sensa_consumer.changes WHERE learner_user_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',[a.learner_user_id,last,(input.limit??100)+1])).rows;
      const hasMore=rows.length>(input.limit??100);const page=rows.slice(0,input.limit??100);
      return {wireVersion:consumerWireVersion,scopeEpoch:String(a.epoch),changes:page.map(r=>({sequence:String(r.sequence),entityType:'plan',id:r.snapshot.id,revision:r.snapshot.revision,action:'upsert',snapshot:r.snapshot})),
        nextCursor:cursor(a,input.replicaId,String(page.at(-1)?.sequence??last)),hasMore,serverTime:iso()};
    }));
  });
  app.get('/sensa/home',async c=>{
    const identity=await verify(c.req.raw);
    return c.json(await transaction(async db=>{const a=await account(db,identity);const current=await plan(db,a);return query(a,{plan:current,counts:{newAvailable:0,initialContinuations:0,dueReviews:0,relearningReady:0,relearningWaiting:0,distinctExecutableTargets:0},resumeItems:[],emptyReason:current?'no_targets':'onboarding_required'});}));
  });
  app.get('/sensa/operations/:id',async c=>{
    const identity=await verify(c.req.raw);const id=uuid.parse(c.req.param('id'));
    return c.json(await transaction(async db=>{const a=await account(db,identity);const row=(await db.query('SELECT result FROM sensa_consumer.operations WHERE learner_user_id=$1 AND operation_id=$2',[a.learner_user_id,id])).rows[0];return row?{state:'known',result:row.result}:{state:'not_found'};}));
  });
  return app;
}
