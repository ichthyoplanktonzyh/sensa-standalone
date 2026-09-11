import {localExecutionForRun} from '../../experience/learningRuntime/runtimeCoordinator';
import {localRunBinding,localRunPolicy,localTargetPolicy} from '../../experience/learningRuntime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../../experience/learningRuntime/policyProfiles';
import {localRunTargetIds,type LocalLearningRun,type LocalLearningTarget,type LearningEvent} from './learning';
import {z} from 'zod';
import {sensaLearningMaterializationSnapshotSchema,semanticProposalSchema,sensaContentGenerationRequestSchema,sensaMaterialCandidateBundleSchema,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {libraryTables,type Table} from './store';
import {validatePackage,packageKey} from './packages';
import {validateLightweightInitialMaterialization} from '../../experience/learningRuntime/lightweightInitialContent';
import {providerInputSchema} from './providers';
import {conversationImagesSchema} from './conversationImages';
import {backupEqual} from './backupCodec';
export type BackupRows=Record<Table,{key:string;value:any}[]>;
const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:timestamp,schemaVersion:z.literal(1)}).strict();
export const backupOwnerSchema=z.object({subject:uuid,accountId:uuid,email:z.string().max(500).optional()}).strict();
const fail=()=>{throw new Error('libraryBackup.errors.inconsistent');};
export function validateBackupRows(rows:BackupRows){
 const maps=Object.fromEntries(libraryTables.map(t=>[t,new Map(rows[t].map(r=>[r.key,r.value]))])) as Record<Table,Map<string,any>>;
 const requireRow=(table:Table,id:string)=>maps[table].get(id)??fail();
 const identity=identitySchema.parse(requireRow('meta','identity'));
 const creation=requireRow('operations','00000000-0000-4000-8000-000000000001');if(JSON.parse(creation.input).kind!=='library.create'||!backupEqual(creation.result,identity))fail();
 for(const table of ['drafts','sessions','meanings','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts','providers'] as Table[])for(const {key,value:v} of rows[table]){if(!v||key!==v.id)fail();uuid.parse(key);}
 for(const {value:d} of rows.drafts){uuid.parse(d.id);z.number().int().positive().parse(d.revision);z.string().max(16000).parse(d.text);if(d.images)conversationImagesSchema.parse(d.images);timestamp.parse(d.createdAt);timestamp.parse(d.updatedAt);}
 for(const {value:s} of rows.sessions){const d=requireRow('drafts',s.draftId);if(s.draftRevision>d.revision)fail();if(s.candidate)semanticProposalSchema.parse(s.candidate);if(s.inputImages)conversationImagesSchema.parse(s.inputImages);if(s.contextSummary!==undefined)z.string().min(1).max(16000).parse(s.contextSummary);if(Array.isArray(s.messages))conversationImagesSchema.parse([...(s.inputImages??[]),...s.messages.flatMap((m:any)=>m.images??[])]);if(!Array.isArray(s.messages)||!Number.isInteger(s.revision)||s.revision<1)fail();if(!['idle','waiting','proposal','inflight','failed','stopped','accepted'].includes(s.status))fail();if(s.status==='accepted'&&requireRow('meanings',s.meaningId).sessionId!==s.id)fail();}
 for(const {key,value:v} of rows.identities){z.string().regex(/^[a-f0-9]{64}$/u).parse(key);for(const field of ['senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(v[field]);}
 for(const {value:m} of rows.meanings){z.string().max(16000).parse(m.context);const revision=z.number().int().positive().parse(m.contextRevision??1);if((m.contextHistory?.length??0)!==revision-1)fail();if(m.contextImages)conversationImagesSchema.parse(m.contextImages);if(m.contextHistory)for(const [index,h] of m.contextHistory.entries()){if(h.revision!==index+1)fail();z.string().max(16000).parse(h.text);conversationImagesSchema.parse(h.images);}semanticProposalSchema.parse(m.proposal);for(const key of ['id','senseId','senseVersionId','bindingId','bindingVersionId','contextAnchorId','expressionAnchorId','alignmentId','acceptanceId'])uuid.parse(m[key]);const d=requireRow('drafts',m.draftId),s=requireRow('sessions',m.sessionId);if(m.draftRevision>d.revision||s.meaningId!==m.id||s.status!=='accepted'||!backupEqual(m.proposal,s.candidate)||(m.contextHistory?.[0]?.text??m.context)!==(s.contextSummary??s.input)||!rows.identities.some(({value:v})=>['senseId','senseVersionId','bindingId','bindingVersionId'].every(k=>v[k]===m[k])))fail();}
 for(const {key,value:p} of rows.packages){validatePackage(p.bundle);if(key!==p.key||key!==packageKey(p.bundle))fail();z.string().regex(/^[a-f0-9]{64}$/u).parse(p.digest);}
 for(const {value:p} of rows.providers){const {revision,...fields}=p;providerInputSchema.parse({...fields,expectedRevision:revision-1});}
 for(const {key,value:op} of rows.operations){uuid.parse(key);if(typeof op?.input!=='string')fail();const input=JSON.parse(op.input);if(canonicalConsumerJson(input)!==op.input||typeof input.kind!=='string'||input.kind.startsWith('service.'))fail();timestamp.parse(op.committedAt);}
 for(const {value:t} of rows.personalLearning){const current=requireRow('meanings',t.meaning.id);const version=(current.contextRevision??1)===(t.meaning.contextRevision??1)?{text:current.context,images:current.contextImages??[]}:current.contextHistory?.find((v:any)=>v.revision===(t.meaning.contextRevision??1));if(!version||version.text!==t.meaning.context||!backupEqual(version.images,t.meaning.contextImages??[]))fail();if(current.senseVersionId!==t.meaning.senseVersionId||current.bindingVersionId!==t.meaning.bindingVersionId||!backupEqual(current.proposal,t.meaning.proposal))fail();if(t.attemptId&&requireRow('contentAttempts',t.attemptId).taskId!==t.id)fail();if(t.status==='ready')requireRow('learningTargets',t.targetId);if(!['waiting','generating','reviewing','failed','rejected','stopped','ready'].includes(t.status))fail();}
 for(const {value:a} of rows.contentAttempts){requireRow('personalLearning',a.taskId);if(a.request)sensaContentGenerationRequestSchema.parse(a.request);if(a.bundle){sensaMaterialCandidateBundleSchema.parse(a.bundle);if(!a.request||a.bundle.contentGenerationRequestId!==a.request.contentGenerationRequestId)fail();}if(a.resumedFrom)requireRow('contentAttempts',a.resumedFrom);}
 for(const {value:t} of rows.learningTargets){
  learningPolicyProfileRegistry.get(localTargetPolicy(t));
  if(t.declaredMastery!==undefined){z.boolean().parse(t.declaredMastery);uuid.parse(t.declaredMasteryOperationId);const op=JSON.parse(requireRow('operations',t.declaredMasteryOperationId).input);if(op.kind!=='learning.declareMastery'||op.input.targetId!==t.id||op.input.active!==t.declaredMastery)fail();}
  sensaLearningMaterializationSnapshotSchema.parse(t.material.snapshot);validateLightweightInitialMaterialization(t.material);
  const p=t.material.snapshot.provenance;
  if(t.material.snapshot.learnerUserId!==identity.learnerId||t.material.snapshot.learningTargetId!==t.id||t.id!==stableUuid(`sensa-learning-target:${identity.learnerId}:${p.senseVersionId}:${p.bindingVersionId}`)||t.retentionId!==stableUuid(`sensa-retention:${t.id}`))fail();
  if(t.packageKey){const pack=requireRow('packages',t.packageKey);if(!pack.bundle.entries.some((e:any)=>e.senseVersionId===p.senseVersionId&&e.bindingVersionId===p.bindingVersionId&&backupEqual(e.content,t.material.content)))fail();}else{requireRow('meanings',p.meaningId);const attempt=requireRow('contentAttempts',p.attemptId);if(attempt.status!=='ready'||!(attempt.review?.accepted||(attempt.reviewProvider===null&&attempt.review===null&&attempt.validation?.review===null&&attempt.validation?.validations?.length>0&&attempt.validation.validations.every((v:any)=>v.status==='accepted')))||!backupEqual(attempt.validation?.content,t.material.content))fail();}
  if(t.expression!==t.material.content.resources.find((r:any)=>r.materialRoleKey==='target_expression')?.contentPayload.surface||t.meaning!==t.material.content.resources.find((r:any)=>r.materialRoleKey==='sense_confirmation')?.contentPayload.meaning)fail();
  if(t.assurancePackageKey){const pack=requireRow('packages',t.packageKey);if(!pack.bundle.assurance||!pack.bundle.entries.some((e:any)=>e.assurancePackageKey===t.assurancePackageKey&&e.senseVersionId===p.senseVersionId&&e.bindingVersionId===p.bindingVersionId))fail();}
  if(t.packageKey&&requireRow('packages',t.packageKey).bundle.assurance&&!t.assurancePackageKey)fail();
 }
 // Replay each run once, including every participating Target in a shared cohort.
 const targets=new Map<string,LocalLearningTarget>(rows.learningTargets.map(({value:t})=>[t.id,{...t,memory:null,memoryRevision:0,completedAt:null,relearnAt:null,startedAt:null}]));
 const unfinished=new Set<string>();
 const runs:LocalLearningRun[]=rows.learningRuns.map(r=>r.value).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
 for(const saved of runs){
  const ids=localRunTargetIds(saved);
  if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId))fail();
  const execution=localExecutionForRun(saved),binding=localRunBinding(saved);
  const profile=learningPolicyProfileRegistry.get(localRunPolicy(saved),saved.policyProfileVersion);
  if(saved.protocolBinding&&!backupEqual(saved.protocolBinding,profile.protocols[saved.purpose]))fail();
  if(saved.schedulingPolicy&&!backupEqual(saved.schedulingPolicy,profile.lifecycle.schedulingPolicy))fail();
  if(ids.length>1&&!execution.cohort||saved.targetIds&&!saved.participants)fail();
  if(saved.participants){
   if(!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
   const primary=saved.participants[saved.targetId];if(primary.memoryRevision!==saved.memoryRevision||primary.dueAt!==saved.dueAt||!backupEqual(primary.material,saved.material))fail();
   for(const [id,participant] of Object.entries(saved.participants)){validateLightweightInitialMaterialization(participant.material);if(participant.material.snapshot.learningTargetId!==id||participant.material.snapshot.learnerUserId!==identity.learnerId)fail();}
  }
  timestamp.parse(saved.startedAt);
  if(saved.protocolVersion!==binding.localProtocolVersion)fail();
  for(const id of ids){
   const target=targets.get(id)??fail(),trigger=saved.participants?.[id]??saved;
   if(unfinished.has(id)||execution.purpose(target)!==saved.purpose||trigger.memoryRevision!==target.memoryRevision||trigger.dueAt!==(target.memory?.dueAt.toISOString()??null))fail();
   if(saved.purpose==='retention_review'&&(!target.memory||Date.parse(saved.startedAt)<target.memory.dueAt.getTime())||target.relearnAt&&Date.parse(saved.startedAt)<Date.parse(target.relearnAt))fail();
   target.startedAt??=saved.startedAt;
   const pack=target.packageKey?requireRow('packages',target.packageKey):undefined;
   execution.validate?.(target,pack);
  }
  const primary=targets.get(saved.targetId)??fail();
  const run=execution.replayStart(primary,primary.packageKey?requireRow('packages',primary.packageKey):undefined,saved);
  if(!Object.hasOwn(saved,'completionKind'))delete run.completionKind;
  const events:LearningEvent[]=rows.learningEvents.map(r=>r.value).filter(e=>e.runId===saved.id);
  const byStep=new Map(events.map(e=>[(e.detail as any)?.stepId,e]));if(byStep.size!==events.length)fail();
  for(let index=0;index<events.length;index++){
   const event=byStep.get(execution.stepId(run))??fail();
   const targetId=execution.activeTargetId?.(run)??run.targetId;
   if(!ids.includes(targetId)||event.targetId!==targetId||run.completedAt)fail();
   const target=targets.get(targetId)??fail();
   timestamp.parse(event.at);if(Date.parse(event.at)<Date.parse(run.startedAt))fail();
   const detail=event.detail as any;if(event.kind!==detail.action?.kind)fail();
   const settlement=execution.transition(target,run,target.packageKey?requireRow('packages',target.packageKey):undefined,detail.action,event.at);
   if(!backupEqual(settlement,detail.settlement))fail();run.ordinal++;run.revision++;
  }
  if(!backupEqual(run,saved))fail();if(!run.completedAt)ids.forEach(id=>unfinished.add(id));
 }
 for(const {value:t} of rows.learningTargets)for(const key of ['memory','memoryRevision','startedAt','completedAt','relearnAt'] as const)if(!backupEqual(targets.get(t.id)![key],t[key]))fail();
 for(const {value:r} of rows.learningRuns){requireRow('learningTargets',r.targetId);if(r.material){validateLightweightInitialMaterialization(r.material);if(r.material.snapshot.learningTargetId!==r.targetId||r.material.snapshot.learnerUserId!==identity.learnerId)fail();}}
 for(const {key,value:e} of rows.learningEvents){requireRow('learningRuns',e.runId);const op=JSON.parse(requireRow('operations',key).input);if(op.kind!=='learning.act'||op.input.runId!==e.runId||op.input.at!==e.at||!backupEqual(op.input.action,e.detail.action))fail();}
 const active=maps.meta.get('learning-active');if(active)requireRow('learningRuns',active);if(active&&localRunTargetIds(requireRow('learningRuns',active)).some(id=>requireRow('learningTargets',id).declaredMastery))fail();for(const {key,value:r} of rows.learningRuns)if(!r.completedAt&&key!==active&&!localRunTargetIds(r).some(id=>requireRow('learningTargets',id).declaredMasteryOperationId))fail();
 const quantity=maps.settings.get('learning-daily-limit');if(quantity!==undefined)z.number().int().min(1).max(100).parse(quantity);
 return identity;
}
