import type {AssuranceState} from './assurance';
import {localExecutionForRun,learningRuntimeCoordinator,type LocalLearningAction} from '../../experience/learningRuntime/runtimeCoordinator';
import {localTargetPolicy} from '../../experience/learningRuntime/localRuntimeBindings';
import {learningPolicyProfileRegistry,type PrototypeLearningPolicy,type LearningProtocolBinding} from '../../experience/learningRuntime/policyProfiles';
import {stableUuid,canonicalJsonDigest,type ReviewSchedule} from '@sensa/learning-kernel';
import {sensaLearningMaterializationSnapshotSchema,sensaLearningConnectionContractVersion,LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningOwner,type InstalledPackage} from './packages';
import {validateLightweightInitialMaterialization,type LightweightInitialLearningMaterialization} from '../../experience/learningRuntime/lightweightInitialContent';
export type LocalLearningTarget={policyProfileId?:PrototypeLearningPolicy;declaredMastery?:boolean;declaredMasteryOperationId?:string;assurancePackageKey?:string;id:string;retentionId:string;packageKey:string|null;expression:string;meaning:string;/** The two languages this target's own text is in. Absent on a target written before the profile existed, which is read as the pair the product shipped. */targetLanguageTag?:string;familiarLanguageTag?:string;material:LightweightInitialLearningMaterialization;createdAt:string;startedAt:string|null;completedAt:string|null;memory:ReviewSchedule|null;memoryRevision:number;relearnAt:string|null};
export type LocalLearningRun={protocolState?:unknown;targetIds?:string[];participants?:Record<string,{material:LightweightInitialLearningMaterialization;memoryRevision:number;dueAt:string|null}>;targetCompletions?:Record<string,{at:string;kind:string}>;schedulingPolicy?:import('@sensa/learning-kernel').WorkspaceSchedulerConfig;lightweight?:import('../../experience/learningRuntime/lightweightInitialProtocol').LightweightInitialProtocolRunState;protocolBinding?:LearningProtocolBinding;policyProfileId?:PrototypeLearningPolicy;policyProfileVersion?:string;assurance?:AssuranceState;material?:LightweightInitialLearningMaterialization;id:string;targetId:string;purpose:'initial_learning'|'retention_review'|'relearning';protocolVersion:string;phase:'recall'|'reveal';ordinal:number;revision:number;startedAt:string;completedAt:string|null;memoryRevision:number;dueAt:string|null;completionKind?:string};
export const localRunTargetIds=(run:LocalLearningRun)=>run.targetIds??[run.targetId];
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:unknown};
export async function enrollPackage(operationId:string,key:string){return command({id:operationId,kind:'learning.enroll',input:{key}},async tx=>{
 const owner=await learningOwner(tx),pack=await tx.get<InstalledPackage>('packages',key);if(!pack)throw new Error('localFlow.downloadFirst');
 const ids:string[]=[];
 for(const e of pack.bundle.entries){
  const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${e.senseVersionId}:${e.bindingVersionId}`);ids.push(id);
  if(await tx.get('learningTargets',id))continue;
  const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-material:${owner.learnerId}:${key}:${id}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'published',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:e.content,contentDigest:canonicalJsonDigest(e.content),validationStatus:'validated',validatorVersion:'sensa-web-package-v1',provenance:{packageId:pack.bundle.id,packageVersion:pack.bundle.version,packageDigest:pack.digest,senseId:e.senseId,senseVersionId:e.senseVersionId,bindingId:e.bindingId,bindingVersionId:e.bindingVersionId},personalAnchorUseGrantIds:[],createdAt:new Date().toISOString()});
  const target:LocalLearningTarget={...(e.assurancePackageKey?{assurancePackageKey:e.assurancePackageKey}:{}),id,retentionId:stableUuid(`sensa-retention:${id}`),packageKey:key,expression:e.expression,meaning:e.meaning,targetLanguageTag:pack.bundle.targetLanguage,familiarLanguageTag:pack.bundle.familiarLanguage,material:{snapshot,content:e.content},createdAt:snapshot.createdAt,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
  target.policyProfileId=localTargetPolicy(target);
  tx.put('learningTargets',id,target);
 }
 return ids;
});}
export const readLearning=()=>readLibrary(async tx=>({targets:await tx.all<LocalLearningTarget>('learningTargets'),runs:await tx.all<LocalLearningRun>('learningRuns'),events:await tx.all<LearningEvent>('learningEvents'),active:await tx.get<string>('meta','learning-active'),dailyLimit:await tx.get<number>('settings','learning-daily-limit')}));
export async function confirmLearningQuantity(operationId:string,dailyLimit:number){return command({id:operationId,kind:'learning.quantity',input:{dailyLimit}},async tx=>{await learningOwner(tx);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new Error('localFlow.quantityRange');tx.put('settings','learning-daily-limit',dailyLimit);return true;});}
const day=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export async function startLearning(operationId:string,targetId:string,dailyLimit:number,at=new Date().toISOString()){return command({id:operationId,kind:'learning.start',input:{targetId,dailyLimit,at}},async tx=>{
 await learningOwner(tx);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isFinite(Date.parse(at)))throw new Error('localFlow.confirmQuantity');
 if(await tx.get('settings','learning-daily-limit')!==dailyLimit)throw new Error('localFlow.confirmNewQuantity');
 const active=await tx.get<string>('meta','learning-active');if(active){const run=await tx.get<LocalLearningRun>('learningRuns',active);if(run)return run;}
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('localFlow.enrollFirst');validateLightweightInitialMaterialization(t.material);if(t.declaredMastery)throw new Error('localFlow.stepChanged');
 const allRuns=await tx.all<LocalLearningRun>('learningRuns');
 const unfinished=allRuns.find(r=>localRunTargetIds(r).includes(targetId)&&!r.completedAt);if(unfinished){for(const id of localRunTargetIds(unfinished))if((await tx.get<LocalLearningTarget>('learningTargets',id))?.declaredMastery)throw new Error('localFlow.stepChanged');tx.put('meta','learning-active',unfinished.id);return unfinished;}
 const profileId=localTargetPolicy(t),profile=learningPolicyProfileRegistry.get(profileId);
 const execution=learningRuntimeCoordinator.localExecutionFor(profileId,'initial_learning');
 const now=new Date(at),purpose=execution.purpose(t),runner=learningRuntimeCoordinator.localExecutionFor(profileId,purpose);
 const pack=t.packageKey?await tx.get<InstalledPackage>('packages',t.packageKey):undefined;
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('localFlow.notDue');
 if(purpose==='initial_learning'&&!t.startedAt&&(await tx.all<LocalLearningTarget>('learningTargets')).filter(v=>v.startedAt&&day(new Date(v.startedAt))===day(now)).length>=dailyLimit)throw new Error('localFlow.dailyLimit');
 const binding=profile.protocols[purpose];if(!binding.localProtocolVersion)throw new Error('localFlow.resourceInvalid');
 const run:LocalLearningRun={schedulingPolicy:structuredClone(profile.lifecycle.schedulingPolicy),protocolBinding:structuredClone(binding),material:t.material,id:crypto.randomUUID(),targetId,purpose,policyProfileId:profileId,policyProfileVersion:profile.profileVersion,protocolVersion:binding.localProtocolVersion,phase:'recall',ordinal:1,revision:1,startedAt:at,completedAt:null,memoryRevision:t.memoryRevision,dueAt:t.memory?.dueAt.toISOString()??null};
 let participants=[t];
 if(runner.cohort){
  const targets=await tx.all<LocalLearningTarget>('learningTargets');
  const remaining=Math.max(0,dailyLimit-targets.filter(v=>v.startedAt&&day(new Date(v.startedAt))===day(now)).length);
  const compatible=[t,...targets.filter(v=>v.id!==t.id)].filter(v=>!v.declaredMastery&&localTargetPolicy(v)===profileId&&execution.purpose(v)===purpose&&!allRuns.some(r=>!r.completedAt&&localRunTargetIds(r).includes(v.id))&&(purpose==='initial_learning'||(v.relearnAt?now>=new Date(v.relearnAt):!!v.memory&&now>=v.memory.dueAt)));
  const selected=new Set(compatible.filter(v=>!v.startedAt).slice(0,remaining).map(v=>v.id));
  const candidates=compatible.filter(v=>v.startedAt||selected.has(v.id)).map(v=>({targetId:v.id,profileId,ready:true,executable:true}));
  const launch=purpose==='initial_learning'?learningRuntimeCoordinator.planInitial(t.id,candidates):learningRuntimeCoordinator.planRetention(candidates).find(v=>v.targetIds.includes(t.id));
  if(!launch?.targetIds.includes(t.id))throw new Error('localFlow.dailyLimit');
  participants=launch.targetIds.map(id=>targets.find(v=>v.id===id)!);
  run.targetIds=participants.map(v=>v.id);
  run.participants=Object.fromEntries(participants.map(v=>[v.id,{material:v.material,memoryRevision:v.memoryRevision,dueAt:v.memory?.dueAt.toISOString()??null}]));
 }
 for(const participant of participants){
  const resources=participant.packageKey?await tx.get<InstalledPackage>('packages',participant.packageKey):undefined;
  runner.validate?.(participant,resources);
 }
 Object.assign(run,runner.initialize(t,pack,purpose,run));
 for(const participant of participants)if(!participant.startedAt){participant.startedAt=at;tx.put('learningTargets',participant.id,participant);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);return run;
});}
export async function actLearning(operationId:string,runId:string,revision:number,action:LocalLearningAction,at=new Date().toISOString()){return command({id:operationId,kind:'learning.act',input:{runId,revision,action,at}},async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('localFlow.stepChanged');
 const execution=localExecutionForRun(run);
 const activeTargetId=execution.activeTargetId?.(run)??run.targetId;
 if(!localRunTargetIds(run).includes(activeTargetId))throw new Error('localFlow.stepChanged');
 const t=(await tx.get<LocalLearningTarget>('learningTargets',activeTargetId))!;
 if(t.declaredMastery)throw new Error('localFlow.stepChanged');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
 const pack=t.packageKey?await tx.get<InstalledPackage>('packages',t.packageKey):undefined;
 const stepId=execution.stepId(run),settlement=execution.transition(t,run,pack,action,at);
 run.ordinal++;run.revision++;tx.put('learningRuns',run.id,run);tx.put('learningTargets',t.id,t);
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{stepId,action,settlement}} satisfies LearningEvent);return run;
});}
export async function finishLearning(operationId:string,runId:string){return command({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('localFlow.finishFirst');if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');return true;});}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,meaning:import('./teacher').LocalMeaning,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null,replace=false){
 const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${meaning.senseVersionId}:${meaning.bindingVersionId}`);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);if(existing&&!replace)return existing;
 const now=new Date().toISOString();
 const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-personal-material:${attemptId}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'on_demand',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:content,contentDigest:canonicalJsonDigest(content),validationStatus:'validated',validatorVersion:'sensa-web-content-v1',provenance:{meaningId:meaning.id,acceptanceId:meaning.acceptanceId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,bindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,attemptId},personalAnchorUseGrantIds:grantId?[grantId]:[],createdAt:now});
 const target:LocalLearningTarget={policyProfileId:'lightweight',id,retentionId:stableUuid(`sensa-retention:${id}`),packageKey:null,expression:meaning.proposal.expression.surface,meaning:meaning.proposal.semanticSpec.coreMeaningFocus,...(meaning.targetLanguageTag?{targetLanguageTag:meaning.targetLanguageTag}:{}),...(meaning.familiarLanguageTag?{familiarLanguageTag:meaning.familiarLanguageTag}:{}),material:{snapshot,content},createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
 if(existing){
  for(const run of await tx.all<LocalLearningRun>('learningRuns'))if(run.targetId===id&&!run.material){run.material=existing.material;tx.put('learningRuns',run.id,run);}
  Object.assign(target,{policyProfileId:localTargetPolicy(existing),declaredMastery:existing.declaredMastery,declaredMasteryOperationId:existing.declaredMasteryOperationId,createdAt:existing.createdAt,startedAt:existing.startedAt,completedAt:existing.completedAt,memory:existing.memory,memoryRevision:existing.memoryRevision,relearnAt:existing.relearnAt});
 }
 validateLightweightInitialMaterialization(target.material);tx.put('learningTargets',id,target);return target;
}

/** A reversible learner declaration changes planning eligibility, never evidence or schedules. */
export async function setLocalDeclaredMastery(operationId:string,targetId:string,active:boolean){
 return command({id:operationId,kind:'learning.declareMastery',input:{targetId,active}},async tx=>{
  await learningOwner(tx);
  const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target)throw new Error('localFlow.enrollFirst');
  target.declaredMastery=active;target.declaredMasteryOperationId=operationId;tx.put('learningTargets',target.id,target);
  const runId=await tx.get<string>('meta','learning-active');
  const run=runId?await tx.get<LocalLearningRun>('learningRuns',runId):null;
  if(active&&run&&localRunTargetIds(run).includes(targetId))tx.delete('meta','learning-active');
  return true;
 });
}

/** Assignment is allowed only before any run; histories and running bindings are immutable. */
export async function selectLocalLearningPolicy(operationId:string,targetId:string,profileId:PrototypeLearningPolicy){
 return command({id:operationId,kind:'learning.policy',input:{targetId,profileId}},async tx=>{
  await learningOwner(tx);const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target||target.startedAt||(await tx.all<LocalLearningRun>('learningRuns')).some(r=>localRunTargetIds(r).includes(targetId)))throw new Error('localFlow.stepChanged');
  const profile=learningPolicyProfileRegistry.get(profileId);
  if(!profile.localSelectable||!target.assurancePackageKey)throw new Error('localFlow.resourceInvalid');
  const pack=target.packageKey?await tx.get<InstalledPackage>('packages',target.packageKey):undefined;
  learningRuntimeCoordinator.localExecutionFor(profileId,'initial_learning').validate?.(target,pack);
  target.policyProfileId=profileId;tx.put('learningTargets',target.id,target);return target;
 });
}
