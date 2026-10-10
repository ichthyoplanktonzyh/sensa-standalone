import {prepareLearningResourceFacts} from '../resources/supplements.js';
import {
  librarySyncBlockStoreChars,
  semanticLookupInputSchema,
  sensaAgentConnectionEventListSchema,
  sensaAgentConnectionExchangeSchema,
  sensaAgentConnectionListSchema,
  sensaAgentConnectionRevokeSchema,
  sensaAgentConnectionSetupCreateSchema,
  sensaLanguageForDeclaredTag,
} from '@sensa/contracts/sensa';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {stream} from 'hono/streaming';
import {z} from 'zod';
import type {DatabaseExecutor} from '../../database/index.js';
import {unsafeTransaction} from '../../database/index.js';
import {createModelTurnRoutes,type ModelTurnCompletion,type ModelTurnReservation} from '../models/turn.js';
import {failModelRequestAfterExecution,failModelRequestBeforeExecution,markModelRequestRunning,reserveModelRequest,succeedModelRequest,type ModelBudgetKind} from '../models/requests.js';
import {beginLookup,finishLookup,readLookup} from '../personal/semantic.js';
import {semanticResolverFor,type SemanticResolver} from '../personal/semanticResolver.js';
import {activeMeaningConnection,connectionSelector,readingDailyLimit,registerReadingRoutes,type ReadingCompletion} from '../reading/service.js';
import {registerLibrarySync} from '../library/sync.js';
import {registerIntakeDelivery} from '../library/intakeDelivery.js';
import {ensureAdmission} from './admission.js';
import {ConsumerError,verifyConsumer,type ConsumerPrincipal,type ConsumerVerifier} from './auth.js';
import {assertDeletionConfigured,finishAccountDeletion,requestAccountDeletion,type DeleteIdentity} from './deletion.js';
import {authorizeExtension,exchangeExtension,extensionVerifier} from './extension.js';
import {agentVerifier,createAgentConnectionSetup,exchangeAgentConnectionSetup,listAgentConnectionEvents,listAgentConnections,revokeAgentConnection} from './agent.js';
import {sensaExtensionAuthorizationSchema,sensaExtensionExchangeSchema} from '@sensa/contracts/sensa';
import {serviceTelemetry,setTelemetryError,setTelemetryFailure,type ServiceRequestRecord} from './telemetry.js';
import {registerBrowserTelemetry,type BrowserTelemetrySink,type BrowserTelemetryRateLimiter} from './browserTelemetry.js';
import {readLearningContentRegistry} from './learningContentRegistry.js';
import {synthesizeEdgeSpeech} from '../speech/edgeTts.js';
import {createStreamAuthorizationGate} from './streamAuthorization.js';
import {releaseCommit} from '../releaseIdentity.js';

const modelDailyLimit=30;
const uuid=z.string().uuid();

/** Reference resolution runs once per looked-up word, so it has its own pool. */
const referenceDailyLimit=()=>{
  const value=Number(process.env.SENSA_REFERENCE_DAILY_LIMIT);
  return Number.isInteger(value)&&value>0?value:300;
};

type Account={
  account_id:string;
  learner_user_id:string;
  epoch:string;
  session_id:string;
  now:Date;
};

type Transaction=<T>(work:(db:DatabaseExecutor)=>Promise<T>)=>Promise<T>;

async function account(db:DatabaseExecutor,identity:ConsumerPrincipal,create=false,allowRevokedSession=false,now=new Date()):Promise<Account>{
  await ensureAdmission(db,identity,create);
  let row=(await db.query('SELECT * FROM sensa_consumer.accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE',[identity.issuer,identity.subject])).rows[0];
  if(!row&&create){
    const id=crypto.randomUUID();
    await db.query('INSERT INTO core.accounts(account_id,email) VALUES($1,$2)',[id,identity.email]);
    await db.query('INSERT INTO core.learners(learner_user_id) VALUES($1)',[id]);
    row=(await db.query("INSERT INTO sensa_consumer.accounts(account_id,learner_user_id,issuer,subject,time_zone) VALUES($1,$1,$2,$3,'UTC') RETURNING *",[id,identity.issuer,identity.subject])).rows[0];
  }
  if(!row)throw new ConsumerError(409,'session_initialization_required');
  if(row.lifecycle&&row.lifecycle!=='active')throw new ConsumerError(403,'account_deleted');
  let session=(await db.query('SELECT * FROM sensa_consumer.sessions WHERE account_id=$1 AND provider_session_id=$2',[row.account_id,identity.sessionId])).rows[0];
  if(!session&&create)session=(await db.query('INSERT INTO sensa_consumer.sessions(account_id,provider_session_id) VALUES($1,$2) RETURNING *',[row.account_id,identity.sessionId])).rows[0];
  if(!session||(session.revoked&&!allowRevokedSession))throw new ConsumerError(401,'access_revoked');
  return {...row,session_id:session.id,now} as Account;
}

/** Mid-stream revocation probe. It deliberately avoids account row locks; the
 * opening and final state transitions still use account() inside transactions. */
async function assertStreamAuthorization(db:DatabaseExecutor,identity:ConsumerPrincipal):Promise<void>{
  const row=(await db.query(`SELECT a.lifecycle,s.revoked
    FROM sensa_consumer.accounts a
    JOIN sensa_consumer.sessions s ON s.account_id=a.account_id
    WHERE a.issuer=$1 AND a.subject=$2 AND s.provider_session_id=$3`,[
      identity.issuer,identity.subject,identity.sessionId,
    ])).rows[0];
  if(!row||row.lifecycle&&row.lifecycle!=='active'||row.revoked)throw new ConsumerError(401,'access_revoked');
}

export type ConsumerRoutesOptions={
  deleteIdentity?:DeleteIdentity;
  telemetry?:(record:ServiceRequestRecord)=>void;
  browserTelemetry?:BrowserTelemetrySink;
  browserTelemetryOrigins?:readonly string[];
  browserTelemetryRateLimiter?:BrowserTelemetryRateLimiter;
  verify?:ConsumerVerifier;
  transaction?:Transaction;
  clock?:()=>Date;
  semanticResolver?:SemanticResolver;
  readingCompletion?:ReadingCompletion;
  modelTurnCompletion?:ModelTurnCompletion;
  publisherSubjects?:readonly string[];
  learningContentRegistry?:()=>ReturnType<typeof readLearningContentRegistry>;
};

export function createConsumerRoutes(options:ConsumerRoutesOptions={}){
  const clock=options.clock??(()=>new Date());
  const app=new Hono();
  app.get('/sensa/release',context=>{
    context.header('Cache-Control','no-store');
    return context.json({format:'sensa-api-release-v1',commit:releaseCommit});
  });
  const transaction=options.transaction??unsafeTransaction;
  const verify=extensionVerifier(options.verify??verifyConsumer,transaction,clock);
  const verifyAgent=agentVerifier(verify,transaction,clock);
  const publisherSubjects=new Set((options.publisherSubjects??process.env.SENSA_PUBLISHER_SUBJECTS?.split(',')??[])
    .map(subject=>subject.trim()).filter(Boolean).map(subject=>uuid.parse(subject)));

  app.use('*',serviceTelemetry(options.telemetry));
  app.use('*',(context,next)=>bodyLimit({
    maxSize:['/sensa/model/turn','/sensa/model/turn/stream'].includes(context.req.path)?12*1024*1024:context.req.path.endsWith('/sensa/library-sync/blocks/store')?librarySyncBlockStoreChars+1024*1024:256*1024,
    onError:c=>{setTelemetryError(c,'body_too_large');return c.json({code:'body_too_large'},413);},
  })(context,next));
  app.onError((error,context)=>{
    if(error instanceof ConsumerError){setTelemetryError(context,error.code);return context.json({code:error.code},error.status);}
    if(error instanceof z.ZodError||error instanceof SyntaxError){setTelemetryError(context,'invalid_request');return context.json({code:'invalid_request'},400);}
    setTelemetryError(context,'temporarily_unavailable');
    setTelemetryFailure(context,error);
    return context.json({code:'temporarily_unavailable'},503);
  });

  app.post('/sensa/speech/edge-tts',async context=>{
    const identity=await verify(context.req.raw);
    await transaction(db=>account(db,identity,false,false,clock()));
    const input=z.object({
      surface:z.string().trim().min(1).max(500),
      languageTag:z.string().min(2).max(20),
      voice:z.string().regex(/^[A-Za-z0-9-]{1,80}$/u),
      locale:z.string().regex(/^[A-Za-z]{2,3}-[A-Za-z0-9-]{2,20}$/u),
    }).strict().parse(await context.req.json());
    const language=sensaLanguageForDeclaredTag(input.languageTag);
    if(!language?.asTarget||language.speechLocale!==input.locale
      ||!input.voice.startsWith(`${input.locale}-`))throw new ConsumerError(400,'speech_language_unavailable');
    let audio:Buffer;
    try{audio=await synthesizeEdgeSpeech(input,AbortSignal.timeout(45_000));}
    catch{throw new ConsumerError(503,'speech_unavailable');}
    context.header('Cache-Control','no-store');
    return context.json({audioBase64:audio.toString('base64')});
  });

  app.post('/sensa/resource-facts',async context=>{
    const identity=await verify(context.req.raw);
    await transaction(async db=>{await account(db,identity,false,false,clock());});
    return context.json(await prepareLearningResourceFacts(await context.req.json()));
  });

  registerBrowserTelemetry(app,options.browserTelemetry,{allowedOrigins:options.browserTelemetryOrigins,limiter:options.browserTelemetryRateLimiter});

  registerLibrarySync(app,async(request,work)=>{
    const identity=await verify(request);
    return transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      return work(db,{accountId:current.account_id,installationId:identity.installationId,now:current.now});
    });
  });
  registerIntakeDelivery(app,async(request,work)=>{
    const identity=await verify(request);
    return transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      return work(db,{accountId:current.account_id,installationId:identity.installationId,now:current.now});
    });
  },async(request,work)=>{
    const identity=await verifyAgent(request);
    if(!identity.agentConnectionId||!identity.agentLabel)throw new ConsumerError(403,'agent_authorization_required');
    return transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      return work(db,{accountId:current.account_id,agentConnectionId:identity.agentConnectionId,agentLabel:identity.agentLabel,now:current.now});
    });
  });
  registerReadingRoutes(app,async(request,work)=>{
    const identity=await verify(request);
    return transaction(async db=>work(db,await account(db,identity,false,false,clock())));
  },async request=>{
    const identity=await verify(request);
    await transaction(db=>assertStreamAuthorization(db,identity));
  },options.readingCompletion);

  app.route('/sensa/model',createModelTurnRoutes({
    authorize:async request=>{
      const identity=await verify(request);
      return transaction(async db=>({select:await connectionSelector(db,await account(db,identity,false,false,clock()))}));
    },
    reserve:async(request,input,select):Promise<ModelTurnReservation>=>{
      const identity=await verify(request);
      let selected:ReturnType<typeof select>|undefined;
      const admitted=await transaction(async db=>{
        const current=await account(db,identity,false,false,clock());
        const budgetKind:ModelBudgetKind=input.purpose==='reference'?'reference':input.purpose==='content'||input.purpose==='review'?'content':'semantic';
        const limit=budgetKind==='reference'?referenceDailyLimit():modelDailyLimit;
        const reservation=await reserveModelRequest(db,current.account_id,{...input,budgetKind},current.now,limit,()=>{selected=select();});
        return {reservation,accountId:current.account_id};
      });
      if(admitted.reservation.kind==='replay')return admitted.reservation;
      if(!selected)throw new ConsumerError(503,'model_connection_unavailable');
      const run=(work:(db:DatabaseExecutor)=>Promise<void>)=>transaction(work);
      return {
       kind:'execute',connection:selected,
       markRunning:()=>run(db=>markModelRequestRunning(db,admitted.accountId,input.id,input.inputDigest,clock())),
       succeed:response=>run(db=>succeedModelRequest(db,admitted.accountId,input.id,input.inputDigest,response,clock())),
       failBeforeExecution:code=>run(db=>failModelRequestBeforeExecution(db,admitted.accountId,input.id,input.inputDigest,code,clock())),
       failAfterExecution:(code,unknown)=>run(db=>failModelRequestAfterExecution(db,admitted.accountId,input.id,input.inputDigest,code,unknown,clock())),
      };
    },
    complete:options.modelTurnCompletion,
  }));

  // Registry descriptors and immutable artifact URLs are public discovery data;
  // account, library-sync and publisher authority stay on their protected routes.
  app.get('/sensa/packages',async context=>{
    const catalog=await (options.learningContentRegistry??readLearningContentRegistry)();
    if('format' in catalog){
      const etag=`"${catalog.revision}"`;
      context.header('ETag',etag);
      context.header('Cache-Control','public, max-age=300');
      if(context.req.header('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'public, max-age=300'}});
    }else context.header('Cache-Control','no-store');
    return context.json(catalog);
  });

  app.post('/sensa/extension/authorize',async context=>{
    const identity=await verify(context.req.raw);
    if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');
    const input=sensaExtensionAuthorizationSchema.parse(await context.req.json());
    return context.json(await transaction(async db=>authorizeExtension(db,await account(db,identity,false,false,clock()),input)));
  });
  app.post('/sensa/extension/exchange',async context=>{
    const input=sensaExtensionExchangeSchema.parse(await context.req.json());
    return context.json(await transaction(db=>exchangeExtension(db,input,clock())));
  });

  app.post('/sensa/agent/connection-setups',async context=>{
    context.header('Cache-Control','no-store');
    const identity=await verify(context.req.raw);
    if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');
    const input=sensaAgentConnectionSetupCreateSchema.parse(await context.req.json());
    return context.json(await transaction(async db=>createAgentConnectionSetup(db,await account(db,identity,false,false,clock()),input)));
  });
  app.post('/sensa/agent/connection-setups/exchange',async context=>{
    context.header('Cache-Control','no-store');
    const input=sensaAgentConnectionExchangeSchema.parse(await context.req.json());
    return context.json(await transaction(db=>exchangeAgentConnectionSetup(db,input,clock())));
  });
  app.get('/sensa/agent/connections',async context=>{
    context.header('Cache-Control','no-store');
    const identity=await verify(context.req.raw);
    if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');
    return context.json(await transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      return sensaAgentConnectionListSchema.parse({connections:await listAgentConnections(db,current.account_id,current.now)});
    }));
  });
  app.post('/sensa/agent/connections/revoke',async context=>{
    context.header('Cache-Control','no-store');
    const identity=await verify(context.req.raw);
    if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');
    const input=sensaAgentConnectionRevokeSchema.parse(await context.req.json());
    await transaction(async db=>revokeAgentConnection(db,await account(db,identity,false,false,clock()),input.connectionId));
    return context.json({revoked:true as const,connectionId:input.connectionId});
  });
  app.get('/sensa/agent/connection-events',async context=>{
    context.header('Cache-Control','no-store');
    const identity=await verify(context.req.raw);
    if(identity.installationId)throw new ConsumerError(403,'web_authorization_required');
    return context.json(await transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      return sensaAgentConnectionEventListSchema.parse({events:await listAgentConnectionEvents(db,current.account_id)});
    }));
  });

  app.get('/sensa/service/status',async context=>{
    const identity=await verify(context.req.raw);
    const result=await transaction(async db=>{
      const current=await account(db,identity,false,false,clock());
      const since=new Date(current.now.getTime()-86400000);
      const reading=Number((await db.query('SELECT count(*)::int AS n FROM sensa_consumer.reading_requests WHERE account_id=$1 AND created_at>$2',[current.account_id,since])).rows[0]!.n);
      const executed=`((state='reserved' AND reserved_at>$2) OR (state IN ('running','succeeded','failed_after_execution','execution_unknown') AND execution_started_at>$2))`;
      const reference=Number((await db.query(`SELECT count(*)::int AS n FROM sensa_consumer.model_requests WHERE account_id=$1 AND budget_kind='reference' AND ${executed}`,[current.account_id,since])).rows[0]!.n);
      const teacher=Number((await db.query(`SELECT ((SELECT count(*) FROM sensa_consumer.semantic_lookups WHERE learner_user_id=$1 AND created_at>$3)+(SELECT count(*) FROM sensa_consumer.model_requests WHERE account_id=$2 AND budget_kind='semantic' AND ((state='reserved' AND reserved_at>$3) OR (state IN ('running','succeeded','failed_after_execution','execution_unknown') AND execution_started_at>$3))))::int AS n`,[current.learner_user_id,current.account_id,since])).rows[0]!.n);
      const content=Number((await db.query(`SELECT count(*)::int AS n FROM sensa_consumer.model_requests WHERE account_id=$1 AND budget_kind='content' AND ${executed}`,[current.account_id,since])).rows[0]!.n);
      let explanationAvailable=false;
      try{await activeMeaningConnection(db,current);explanationAvailable=true;}catch(error){if(!(error instanceof ConsumerError))throw error;}
      return {authorized:true,explanationAvailable,checkedAt:current.now.toISOString(),windowHours:24,usage:[
        {kind:'reading',used:reading,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:readingDailyLimit},
        {kind:'reference',used:reference,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:referenceDailyLimit()},
        {kind:'teacher',used:teacher,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:modelDailyLimit},
        {kind:'content',used:content,limit:process.env.SENSA_UNLIMITED_MODEL_USAGE==='true'?null:modelDailyLimit},
      ]};
    });
    context.header('Cache-Control','no-store');
    return context.json(result);
  });

  app.post('/sensa/web/access/session',async context=>{
    const identity=await verify(context.req.raw);
    z.object({installationId:uuid}).strict().parse(await context.req.json());
    return context.json(await transaction(async db=>{
      const current=await account(db,identity,true,false,clock());
      return {
        authorized:true,
        accountId:current.account_id,
        capabilities:{publishLearningContent:publisherSubjects.has(identity.subject)},
      };
    }));
  });

  app.post('/sensa/account/deletion/status',async context=>{
    const input=z.object({operationId:uuid}).strict().parse(await context.req.json());
    const identity=await transaction(async db=>(await db.query('SELECT a.issuer,a.subject FROM sensa_consumer.account_deletions d JOIN sensa_consumer.accounts a USING(account_id) WHERE d.operation_id=$1',[input.operationId])).rows[0]);
    if(!identity)throw new ConsumerError(404,'deletion_not_found');
    return context.json(await finishAccountDeletion(transaction,{issuer:String(identity.issuer),subject:String(identity.subject)},input.operationId,options.deleteIdentity));
  });
  app.post('/sensa/account/deletion',async context=>{
    const identity=await verify(context.req.raw);
    const input=z.object({operationId:uuid,confirmation:z.literal('delete-account')}).strict().parse(await context.req.json());
    if(!options.deleteIdentity)assertDeletionConfigured();
    await transaction(db=>requestAccountDeletion(db,identity,input.operationId,clock()));
    return context.json(await finishAccountDeletion(transaction,identity,input.operationId,options.deleteIdentity));
  });

  for(const path of ['/sensa/semantic/lookups','/sensa/semantic/lookups/stream'])app.post(path,async context=>{
    const identity=await verify(context.req.raw);
    const input=semanticLookupInputSchema.parse(await context.req.json());
    const started=await transaction(async db=>beginLookup(db,await account(db,identity,false,false,clock()),input));
    async function resolve(onExplanation?:(text:string)=>Promise<void>){
      if(!started.fresh)return started.view;
      let result=null;
      let failureReason='provider_unavailable';
      try{
        const connection=options.semanticResolver?null:await transaction(async db=>activeMeaningConnection(db,await account(db,identity,false,false,clock())));
        result=await (options.semanticResolver??semanticResolverFor(connection!,options.readingCompletion))(input.snapshot,input.languages,started.view.focus,onExplanation);
      }catch(error){
        failureReason=error instanceof ConsumerError?error.code:error instanceof z.ZodError||error instanceof SyntaxError?'model_invalid_response':'provider_unavailable';
      }
      return transaction(async db=>finishLookup(db,await account(db,identity,false,false,clock()),input.id,result,failureReason));
    }
    if(!path.endsWith('/stream'))return context.json(await resolve());
    context.header('Content-Type','application/x-ndjson');
    context.header('Cache-Control','no-store');
    context.header('X-Accel-Buffering','no');
    return stream(context,async output=>{
      let last=0;
      const revalidate=createStreamAuthorizationGate(()=>transaction(db=>assertStreamAuthorization(db,identity)));
      try{
        const result=await resolve(async text=>{
          if(output.aborted)throw new ConsumerError(503,'reading_interrupted');
          if(Date.now()-last<100)return;
          last=Date.now();
          await revalidate();
          await output.write(JSON.stringify({type:'partial',text})+'\n');
        });
        await output.write(JSON.stringify({type:'result',value:result})+'\n');
      }catch(error){
        if(!output.aborted)await output.write(JSON.stringify({type:'error',error:error instanceof ConsumerError?error.code:'provider_unavailable'})+'\n');
      }
    });
  });
  app.get('/sensa/semantic/lookups/:id',async context=>{
    const identity=await verify(context.req.raw);
    const id=uuid.parse(context.req.param('id'));
    return context.json(await transaction(async db=>readLookup(db,await account(db,identity,false,false,clock()),id)));
  });

  return app;
}
