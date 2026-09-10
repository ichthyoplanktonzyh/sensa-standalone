import {z} from 'zod';
import {sensaLearningMaterializationSnapshotSchema,semanticProposalSchema,sensaContentGenerationRequestSchema,sensaMaterialCandidateBundleSchema,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {consumerRunStepId,transitionConsumerRun,decideConsumerSettlement,stableUuid} from '@sensa/learning-kernel';
import {libraryTables,type Table} from './store';
import {validatePackage,packageKey} from './packages';
import {validateLightweightInitialMaterialization} from '../../experience/learningRuntime/lightweightInitialContent';
import {providerInputSchema} from './providers';
import {backupEqual} from './backupCodec';
export type BackupRows=Record<Table,{key:string;value:any}[]>;
const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:timestamp,schemaVersion:z.literal(1)}).strict();
export const backupOwnerSchema=z.object({subject:uuid,accountId:uuid,email:z.string().max(500).optional()}).strict();
const fail=()=>{throw new Error('备份记录不完整或彼此不一致，未恢复任何资料。');};
export function validateBackupRows(rows:BackupRows){
 const maps=Object.fromEntries(libraryTables.map(t=>[t,new Map(rows[t].map(r=>[r.key,r.value]))])) as Record<Table,Map<string,any>>;
 const requireRow=(table:Table,id:string)=>maps[table].get(id)??fail();
 const identity=identitySchema.parse(requireRow('meta','identity'));
 const creation=requireRow('operations','00000000-0000-4000-8000-000000000001');if(JSON.parse(creation.input).kind!=='library.create'||!backupEqual(creation.result,identity))fail();
 for(const table of ['drafts','sessions','meanings','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts','providers'] as Table[])for(const {key,value:v} of rows[table]){if(!v||key!==v.id)fail();uuid.parse(key);}
 for(const {value:d} of rows.drafts){uuid.parse(d.id);z.number().int().positive().parse(d.revision);z.string().max(16000).parse(d.text);timestamp.parse(d.createdAt);timestamp.parse(d.updatedAt);}
 for(const {value:s} of rows.sessions){const d=requireRow('drafts',s.draftId);if(s.draftRevision>d.revision)fail();if(s.candidate)semanticProposalSchema.parse(s.candidate);if(!Array.isArray(s.messages)||!Number.isInteger(s.revision)||s.revision<1)fail();if(!['idle','waiting','proposal','inflight','failed','stopped','accepted'].includes(s.status))fail();if(s.status==='accepted'&&requireRow('meanings',s.meaningId).sessionId!==s.id)fail();}
 for(const {key,value:v} of rows.identities){z.string().regex(/^[a-f0-9]{64}$/u).parse(key);for(const field of ['senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(v[field]);}
 for(const {value:m} of rows.meanings){semanticProposalSchema.parse(m.proposal);for(const key of ['id','senseId','senseVersionId','bindingId','bindingVersionId','contextAnchorId','expressionAnchorId','alignmentId','acceptanceId'])uuid.parse(m[key]);const d=requireRow('drafts',m.draftId),s=requireRow('sessions',m.sessionId);if(m.draftRevision>d.revision||s.meaningId!==m.id||s.status!=='accepted'||!backupEqual(m.proposal,s.candidate)||m.context!==s.input||!rows.identities.some(({value:v})=>['senseId','senseVersionId','bindingId','bindingVersionId'].every(k=>v[k]===m[k])))fail();}
 for(const {key,value:p} of rows.packages){validatePackage(p.bundle);if(key!==p.key||key!==packageKey(p.bundle))fail();z.string().regex(/^[a-f0-9]{64}$/u).parse(p.digest);}
 for(const {value:p} of rows.providers){const {revision,...fields}=p;providerInputSchema.parse({...fields,expectedRevision:revision-1});}
 for(const {key,value:op} of rows.operations){uuid.parse(key);if(typeof op?.input!=='string')fail();const input=JSON.parse(op.input);if(canonicalConsumerJson(input)!==op.input||typeof input.kind!=='string'||input.kind.startsWith('service.'))fail();timestamp.parse(op.committedAt);}
 for(const {value:t} of rows.personalLearning){if(!backupEqual(requireRow('meanings',t.meaning.id),t.meaning))fail();if(t.attemptId&&requireRow('contentAttempts',t.attemptId).taskId!==t.id)fail();if(t.status==='ready')requireRow('learningTargets',t.targetId);if(!['waiting','generating','reviewing','failed','rejected','stopped','ready'].includes(t.status))fail();}
 for(const {value:a} of rows.contentAttempts){requireRow('personalLearning',a.taskId);if(a.request)sensaContentGenerationRequestSchema.parse(a.request);if(a.bundle){sensaMaterialCandidateBundleSchema.parse(a.bundle);if(!a.request||a.bundle.contentGenerationRequestId!==a.request.contentGenerationRequestId)fail();}if(a.resumedFrom)requireRow('contentAttempts',a.resumedFrom);}
 for(const {value:t} of rows.learningTargets){
  sensaLearningMaterializationSnapshotSchema.parse(t.material.snapshot);validateLightweightInitialMaterialization(t.material);
  const p=t.material.snapshot.provenance;
  if(t.material.snapshot.learnerUserId!==identity.learnerId||t.material.snapshot.learningTargetId!==t.id||t.id!==stableUuid(`sensa-learning-target:${identity.learnerId}:${p.senseVersionId}:${p.bindingVersionId}`)||t.retentionId!==stableUuid(`sensa-retention:${t.id}`))fail();
  if(t.packageKey){const pack=requireRow('packages',t.packageKey);if(!pack.bundle.entries.some((e:any)=>e.senseVersionId===p.senseVersionId&&e.bindingVersionId===p.bindingVersionId&&backupEqual(e.content,t.material.content)))fail();}else{requireRow('meanings',p.meaningId);const attempt=requireRow('contentAttempts',p.attemptId);if(attempt.status!=='ready'||!attempt.review?.accepted||!backupEqual(attempt.validation?.content,t.material.content))fail();}
  if(t.expression!==t.material.content.resources.find((r:any)=>r.materialRoleKey==='target_expression')?.contentPayload.surface||t.meaning!==t.material.content.resources.find((r:any)=>r.materialRoleKey==='sense_confirmation')?.contentPayload.meaning)fail();
  // Replay events to check that the saved schedule agrees with its runtime history.
  let memory:any=null,memoryRevision=0,completedAt:string|null=null,relearnAt:string|null=null,startedAt:string|null=null;
  const runs=rows.learningRuns.map(r=>r.value).filter(r=>r.targetId===t.id).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  for(const run of runs){timestamp.parse(run.startedAt);if(startedAt===null)startedAt=run.startedAt;const purpose=relearnAt?'relearning':completedAt?'retention_review':'initial_learning';const protocol=purpose==='initial_learning'?'consumer-initial-v1':purpose==='retention_review'?'consumer-review-v1':'consumer-relearning-v1';
   if(run.purpose!==purpose||run.protocolVersion!==protocol||run.memoryRevision!==memoryRevision||run.dueAt!==(memory?.dueAt.toISOString()??null))fail();
   if(purpose==='retention_review'&&Date.parse(run.startedAt)<memory.dueAt.getTime()||relearnAt&&Date.parse(run.startedAt)<Date.parse(relearnAt))fail();
   const events=rows.learningEvents.map(r=>r.value).filter(e=>e.runId===run.id);const byStep=new Map(events.map(e=>[e.detail?.stepId,e]));if(byStep.size!==events.length)fail();
   let phase:'recall'|'reveal'='recall',ended:string|null=null,kind:string|undefined;
   for(let ordinal=1;ordinal<=events.length;ordinal++){if(ended)fail();const event=byStep.get(consumerRunStepId(run.id,ordinal,phase,protocol));if(!event||event.targetId!==t.id)fail();timestamp.parse(event.at);if(Date.parse(event.at)<Date.parse(run.startedAt))fail();
    const action=z.discriminatedUnion('kind',[z.object({kind:z.literal('reveal')}).strict(),z.object({kind:z.literal('rate'),rating:z.enum(['again','hard','good'])}).strict()]).parse(event.detail.action);if(event.kind!==action.kind)fail();const next=transitionConsumerRun(protocol,phase,action);let decision:any=null;
    if(action.kind==='rate'){const common={retentionTargetId:t.retentionId,protocolVersion:protocol,rating:action.rating,occurredAt:new Date(event.at)};decision=purpose==='retention_review'?decideConsumerSettlement({...common,purpose,memory:{revision:String(memoryRevision),dueAt:memory.dueAt,schedule:{...memory,cardId:t.retentionId}},trigger:{memoryRevision:String(run.memoryRevision),dueAt:new Date(run.dueAt)}}):decideConsumerSettlement({...common,purpose});
     if(decision.kind==='study_completion'||decision.kind==='review_completed'){memory=decision.schedule;memoryRevision++;if(decision.kind==='study_completion')completedAt=event.at;else relearnAt=decision.nextEligibleAt?.toISOString()??null;}if(decision.kind==='wait_relearning')relearnAt=decision.nextEligibleAt.toISOString();if(decision.kind==='relearning_completion')relearnAt=null;
    }
    if(!backupEqual(decision,event.detail.settlement))fail();if(next==='completed'||next==='waiting'){ended=event.at;kind=decision.kind;}else phase=next;
   }
   if(run.phase!==phase||run.ordinal!==events.length+1||run.revision!==events.length+1||run.completedAt!==ended||run.completionKind!==kind)fail();
   if(!ended&&runs.at(-1)!==run)fail();
  }
  if(!backupEqual(memory,t.memory)||memoryRevision!==t.memoryRevision||startedAt!==t.startedAt||completedAt!==t.completedAt||relearnAt!==t.relearnAt)fail();
 }
 for(const {value:r} of rows.learningRuns)requireRow('learningTargets',r.targetId);
 for(const {key,value:e} of rows.learningEvents){requireRow('learningRuns',e.runId);const op=JSON.parse(requireRow('operations',key).input);if(op.kind!=='learning.act'||op.input.runId!==e.runId||op.input.at!==e.at||!backupEqual(op.input.action,e.detail.action))fail();}
 const active=maps.meta.get('learning-active');if(active)requireRow('learningRuns',active);const unfinished=rows.learningRuns.filter(r=>!r.value.completedAt);if(unfinished.length>1||unfinished.length===1&&unfinished[0].key!==active)fail();
 const quantity=maps.settings.get('learning-daily-limit');if(quantity!==undefined)z.number().int().min(1).max(100).parse(quantity);
 return identity;
}
