import {inspectLocalTargetReadiness,localExecutionForRun,learningRuntimeCoordinator,requireLocalTargetReadiness,type LocalLearningAction} from '../../learning/runtime/runtimeCoordinator';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry,type LearningPolicyId} from '../../learning/runtime/policyProfiles';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {sensaLearningMaterializationSnapshotSchema,sensaLearningConnectionContractVersion,LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningOwner,type InstalledPackage} from './packages';
import {validateLightweightInitialMaterialization,type LightweightInitialLearningMaterialization} from '../../learning/runtime/lightweightInitialContent';
import {
  createLocalProtocolState,
  createLocalProtocolProgress,
  initializeLocalProtocolState,
  localProtocolActiveTargetId,
  localProtocolStepId,
  localProtocolOutcomePermissions,
  localRunOpenPlanningInterruption,
  reduceLocalProtocolAction,
  localLearningPurpose,
  localRunTargetIds,
  type LocalCommittedLearningPolicy,
  type LocalLearningRun,
  type LocalLearningMaterialization,
  type LocalLearningPolicyAssignment,
  type LocalProtocolEvaluationFacts,
  type LocalResolvedLearningPlanSnapshot,
  type LocalLearningTarget,
  validateLocalProtocolResources,
} from '../../learning/runtime/localProtocol';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {applyLocalProtocolTransition,type LocalLearningTransitionRecord} from './learningSettlement';

export {localRunTargetIds};
export type {LocalLearningRun,LocalLearningTarget};
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:{stepId:string;action:LocalLearningAction;formalEvaluation:LocalProtocolEvaluationFacts|null;transition:LocalLearningTransitionRecord}};

const createPolicyAssignment=(input:{operationId:string;targetId:string;profileId:LearningPolicyId;scope:LocalLearningPolicyAssignment['scope'];at:string;provenance:Readonly<Record<string,unknown>>}):LocalLearningPolicyAssignment=>({
 assignmentId:stableUuid(`local-policy-assignment:${input.targetId}`),revision:1,scope:input.scope,profileId:input.profileId,
 assignedByOperationId:input.operationId,assignedAt:input.at,provenance:structuredClone(input.provenance),
});

const materialForProtocolRun=(material:LocalLearningMaterialization,purpose:LocalLearningRun['purpose'],protocolRunId:string,at:string):LocalLearningMaterialization=>({
 snapshot:{...structuredClone(material.snapshot),learningMaterializationId:stableUuid(`local-run-materialization:${protocolRunId}`),protocolPurpose:purpose,createdAt:at},
 content:structuredClone(material.content),
});

const commitPolicy=(target:LocalLearningTarget,protocolRunId:string,at:string):LocalCommittedLearningPolicy=>{
 if(target.committedPolicy)return target.committedPolicy;
 const profile=learningPolicyProfileRegistry.get(target.policyAssignment.profileId);
 return {commitmentId:stableUuid(`local-policy-commitment:${target.retentionId}`),revision:1,assignmentId:target.policyAssignment.assignmentId,assignmentRevision:target.policyAssignment.revision,profileId:profile.profileId,profileVersion:profile.profileVersion,committedByProtocolRunId:protocolRunId,committedAt:at};
};

const resolveRunPlan=(target:LocalLearningTarget,commitment:LocalCommittedLearningPolicy,purpose:LocalLearningRun['purpose'],material:LocalLearningMaterialization,at:string):LocalResolvedLearningPlanSnapshot=>{
 const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion),binding=profile.protocols[purpose];
 if(!binding.localProtocolVersion||!profile.lifecycle.schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 return {resolvedLearningPlanRevisionId:stableUuid(`local-resolved-plan:${target.id}:${commitment.commitmentId}:${commitment.revision}:${purpose}:${binding.protocolId}:${binding.protocolVersion}:${material.snapshot.learningMaterializationId}`),revision:1,learningTargetId:target.id,retentionTargetId:target.retentionId,purpose,profileId:profile.profileId,profileVersion:profile.profileVersion,protocolBinding:structuredClone(binding),contentDemands:structuredClone(binding.contentDemands),learningMaterializationIds:[material.snapshot.learningMaterializationId],readiness:'ready',resolvedAt:at};
};

export async function enrollPackage(operationId:string,key:string){return command({id:operationId,kind:'learning.enroll',input:{key}},async tx=>{
 const owner=await learningOwner(tx),pack=await tx.get<InstalledPackage>('packages',key);if(!pack)throw new Error('localFlow.downloadFirst');
 const ids:string[]=[];
 for(const e of pack.bundle.entries){
  const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${e.senseVersionId}:${e.bindingVersionId}`);ids.push(id);
  if(await tx.get('learningTargets',id))continue;
  const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-material:${owner.learnerId}:${key}:${id}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'published',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:e.content,contentDigest:canonicalJsonDigest(e.content),validationStatus:'validated',validatorVersion:'sensa-web-package-v1',provenance:{packageId:pack.bundle.id,packageVersion:pack.bundle.version,packageDigest:pack.digest,senseId:e.senseId,senseVersionId:e.senseVersionId,bindingId:e.bindingId,bindingVersionId:e.bindingVersionId},personalAnchorUseGrantIds:[],createdAt:new Date().toISOString()});
  const profileId=e.assurancePackageKey?'high_assurance':'lightweight';
  const target:LocalLearningTarget={...(e.assurancePackageKey?{assurancePackageKey:e.assurancePackageKey}:{}),id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:e.senseId,senseVersionId:e.senseVersionId,senseExpressionBindingId:e.bindingId,bindingVersionId:e.bindingVersionId,targetLanguageTag:pack.bundle.targetLanguage,familiarLanguageTag:pack.bundle.familiarLanguage,learnerLocale:pack.bundle.familiarLanguage,curriculumProvenance:{kind:'sense_learning_package',packageId:pack.bundle.id,packageVersion:pack.bundle.version,packageDigest:pack.digest}},packageKey:key,expression:e.expression,meaning:e.meaning,policyAssignment:createPolicyAssignment({operationId,targetId:id,profileId,scope:'curriculum_source',at:snapshot.createdAt,provenance:{packageId:pack.bundle.id,packageVersion:pack.bundle.version}}),committedPolicy:null,planningOverrides:[],targetLanguageTag:pack.bundle.targetLanguage,familiarLanguageTag:pack.bundle.familiarLanguage,material:{snapshot,content:e.content},createdAt:snapshot.createdAt,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
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
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('localFlow.enrollFirst');if(hasDeclaredMasteryOverride(t))throw new Error('localFlow.stepChanged');
 const allRuns=await tx.all<LocalLearningRun>('learningRuns');
 const unfinished=allRuns.find(r=>localRunTargetIds(r).includes(targetId)&&!r.completedAt);if(unfinished){
  for(const id of localRunTargetIds(unfinished)){const member=await tx.get<LocalLearningTarget>('learningTargets',id);if(member&&hasDeclaredMasteryOverride(member))throw new Error('localFlow.stepChanged');}
  const interruption=localRunOpenPlanningInterruption(unfinished);
  if(!interruption)throw new Error('localFlow.stepChanged');
  if(Date.parse(at)<Date.parse(interruption.at))throw new Error('localFlow.clockChanged');
  unfinished.lifecycleEvents.push({eventId:stableUuid(`local-run-resume:${unfinished.id}:${operationId}`),kind:'resumed_after_planning_override',operationId,interruptionEventId:interruption.eventId,at});unfinished.revision++;tx.put('learningRuns',unfinished.id,unfinished);
  tx.put('meta','learning-active',unfinished.id);return unfinished;
 }
 const now=new Date(at),purpose=localLearningPurpose(t);
 const pack=t.packageKey?await tx.get<InstalledPackage>('packages',t.packageKey):undefined;
 const readiness=requireLocalTargetReadiness(t,pack,purpose);
 const profileId=readiness.profileId,profile=learningPolicyProfileRegistry.get(profileId,readiness.profileVersion),runner=learningRuntimeCoordinator.localExecutionForBinding(readiness.binding,purpose);
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('localFlow.notDue');
 if(purpose==='initial_learning'&&!t.startedAt&&(await tx.all<LocalLearningTarget>('learningTargets')).filter(v=>v.startedAt&&day(new Date(v.startedAt))===day(now)).length>=dailyLimit)throw new Error('localFlow.dailyLimit');
 const binding=profile.protocols[purpose],schedulingPolicy=profile.lifecycle.schedulingPolicy;if(!binding.localProtocolVersion||!schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 let participants=[t];
 if(runner.cohort){
  const targets=await tx.all<LocalLearningTarget>('learningTargets');
  const remaining=Math.max(0,dailyLimit-targets.filter(v=>v.startedAt&&day(new Date(v.startedAt))===day(now)).length);
  const broadlyCompatible=[t,...targets.filter(v=>v.id!==t.id)].filter(v=>!hasDeclaredMasteryOverride(v)&&localTargetPolicy(v)===profileId&&localLearningPurpose(v)===purpose&&!allRuns.some(r=>!r.completedAt&&localRunTargetIds(r).includes(v.id))&&(purpose==='initial_learning'||(v.relearnAt?now>=new Date(v.relearnAt):!!v.memory&&now>=v.memory.dueAt)));
  const compatible:LocalLearningTarget[]=[];
  for(const candidate of broadlyCompatible){
   const candidateResource=candidate.packageKey?await tx.get<InstalledPackage>('packages',candidate.packageKey):undefined;
   if(inspectLocalTargetReadiness(candidate,candidateResource,purpose).status==='ready')compatible.push(candidate);
  }
  const selected=new Set(compatible.filter(v=>!v.startedAt).slice(0,remaining).map(v=>v.id));
  const candidates=compatible.filter(v=>v.startedAt||selected.has(v.id)).map(v=>({targetId:v.id,profileId,ready:true,executable:true}));
  const launch=purpose==='initial_learning'
   ?learningRuntimeCoordinator.planInitial(t.id,candidates)
   :(purpose==='retention_review'?learningRuntimeCoordinator.planRetention(candidates):learningRuntimeCoordinator.planRelearning(candidates)).find(v=>v.targetIds.includes(t.id));
  if(!launch?.targetIds.includes(t.id))throw new Error('localFlow.dailyLimit');
  participants=launch.targetIds.map(id=>targets.find(v=>v.id===id)!);
 }
 const sessionId=crypto.randomUUID();
 const participantSnapshots:LocalLearningRun['participants']=Object.fromEntries(participants.map(participant=>{
  const protocolRunId=stableUuid(`local-protocol-run:${sessionId}:${participant.id}`);
  const policyCommitment=commitPolicy(participant,protocolRunId,at);
  if(policyCommitment.profileId!==profileId||policyCommitment.profileVersion!==profile.profileVersion)throw new Error('localFlow.resourceInvalid');
  const material=materialForProtocolRun(participant.material,purpose,protocolRunId,at);
  const resolvedPlan=resolveRunPlan(participant,policyCommitment,purpose,material,at);
  participant.committedPolicy=policyCommitment;
  return [participant.id,{protocolRunId,startReason:{kind:purpose==='initial_learning'?'initial_learning_ready':purpose==='retention_review'?'due_review':'relearning_ready',selectionReason:participant.id===targetId?'requested_target':'cohort_candidate',triggerAt:at,triggerMemoryRevision:participant.memoryRevision},outcomePermissions:localProtocolOutcomePermissions(purpose,binding),material,policyCommitment,resolvedPlan,progress:createLocalProtocolProgress(protocolRunId,binding),memoryRevision:participant.memoryRevision,dueAt:participant.memory?.dueAt.toISOString()??null,evidenceIds:[]}];
 }));
 const run:LocalLearningRun={
  id:sessionId,targetId,targetIds:participants.map(v=>v.id),
  participants:participantSnapshots,
  targetCompletions:{},purpose,policyProfileId:profileId,policyProfileVersion:profile.profileVersion,
  protocolBinding:structuredClone(binding),protocolVersion:binding.localProtocolVersion,
  protocolState:createLocalProtocolState(binding.runtimeAdapterId,null),
  schedulingPolicyId:profile.lifecycle.schedulingPolicyId,schedulingPolicy:structuredClone(schedulingPolicy),
  learnerVisibleClaimBoundary:profile.lifecycle.learnerVisibleClaimBoundary,
  ordinal:1,revision:1,lifecycleEvents:[],startedAt:at,completedAt:null,
 };
 for(const participant of participants){
  const resources=participant.packageKey?await tx.get<InstalledPackage>('packages',participant.packageKey):undefined;
  requireLocalTargetReadiness(participant,resources,purpose);
 }
 run.protocolState=initializeLocalProtocolState({execution:runner,target:t,resource:pack,purpose,run});
 for(const participant of participants)if(!participant.startedAt){participant.startedAt=at;tx.put('learningTargets',participant.id,participant);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);return run;
});}
export async function actLearning(operationId:string,runId:string,revision:number,action:LocalLearningAction,at=new Date().toISOString()){return command({id:operationId,kind:'learning.act',input:{runId,revision,action,at}},async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('localFlow.stepChanged');
 const execution=localExecutionForRun(run);
 const activeTargetId=localProtocolActiveTargetId(execution,run);
 const t=(await tx.get<LocalLearningTarget>('learningTargets',activeTargetId))!;
 if(hasDeclaredMasteryOverride(t)||localRunOpenPlanningInterruption(run))throw new Error('localFlow.stepChanged');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
 const pack=t.packageKey?await tx.get<InstalledPackage>('packages',t.packageKey):undefined;
 const stepId=localProtocolStepId(execution,run),executed=reduceLocalProtocolAction({operationId,stepKey:stepId,execution,target:t,run,resource:pack,action,at});
 const nextRun=executed.run;
 const applied=applyLocalProtocolTransition({operationId,stepId,at,target:t,run:nextRun,transition:executed.transition});
 nextRun.ordinal++;nextRun.revision++;tx.put('learningRuns',nextRun.id,nextRun);tx.put('learningTargets',applied.target.id,applied.target);
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{stepId,action,formalEvaluation:executed.facts,transition:applied.record}} satisfies LearningEvent);return nextRun;
});}
export async function finishLearning(operationId:string,runId:string){return command({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('localFlow.finishFirst');if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');return true;});}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,meaning:import('./teacher').LocalMeaning,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null,replace=false){
 const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${meaning.senseVersionId}:${meaning.bindingVersionId}`);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);if(existing&&!replace)return existing;
 const now=new Date().toISOString();
 const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-personal-material:${attemptId}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'on_demand',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:content,contentDigest:canonicalJsonDigest(content),validationStatus:'validated',validatorVersion:'sensa-web-content-v1',provenance:{meaningId:meaning.id,acceptanceId:meaning.acceptanceId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,bindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,attemptId},personalAnchorUseGrantIds:grantId?[grantId]:[],createdAt:now});
 const targetLanguageTag=meaning.targetLanguageTag??'en',familiarLanguageTag=meaning.familiarLanguageTag??'zh-CN';
 const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,senseExpressionBindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,targetLanguageTag,familiarLanguageTag,learnerLocale:familiarLanguageTag,curriculumProvenance:{kind:'personal_meaning_alignment',meaningId:meaning.id,acceptanceId:meaning.acceptanceId}},packageKey:null,expression:meaning.proposal.expression.surface,meaning:meaning.proposal.semanticSpec.coreMeaningFocus,policyAssignment:createPolicyAssignment({operationId:attemptId,targetId:id,profileId:'lightweight',scope:'system_default',at:now,provenance:{kind:'personal_meaning_alignment'}}),committedPolicy:null,planningOverrides:[],...(meaning.targetLanguageTag?{targetLanguageTag:meaning.targetLanguageTag}:{}),...(meaning.familiarLanguageTag?{familiarLanguageTag:meaning.familiarLanguageTag}:{}),material:{snapshot,content},createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
 if(existing){
  Object.assign(target,{policyAssignment:existing.policyAssignment,committedPolicy:existing.committedPolicy,planningOverrides:existing.planningOverrides,createdAt:existing.createdAt,startedAt:existing.startedAt,completedAt:existing.completedAt,memory:existing.memory,memoryRevision:existing.memoryRevision,relearnAt:existing.relearnAt,relearningState:existing.relearningState});
 }
 validateLightweightInitialMaterialization(target.material);tx.put('learningTargets',id,target);return target;
}

/** A reversible learner declaration changes planning eligibility, never evidence or schedules. */
export async function setLocalDeclaredMastery(operationId:string,targetId:string,active:boolean,at=new Date().toISOString()){
 return command({id:operationId,kind:'learning.declareMastery',input:{targetId,active,at}},async tx=>{
  await learningOwner(tx);
  if(!Number.isFinite(Date.parse(at)))throw new Error('localFlow.clockChanged');
  const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target)throw new Error('localFlow.enrollFirst');
  const declared=hasDeclaredMasteryOverride(target);
  if(active&&!declared){target.planningOverrides.push({kind:'declared_mastery',source:'learner',operationId,createdAt:at});tx.put('learningTargets',target.id,target);}
  else if(!active&&declared){target.planningOverrides=target.planningOverrides.filter(override=>override.kind!=='declared_mastery');tx.put('learningTargets',target.id,target);}
  const runId=await tx.get<string>('meta','learning-active');
  const run=runId?await tx.get<LocalLearningRun>('learningRuns',runId):null;
  if(active&&run&&localRunTargetIds(run).includes(targetId)){
   if(Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
   if(!localRunOpenPlanningInterruption(run)){run.lifecycleEvents.push({eventId:stableUuid(`local-run-interruption:${run.id}:${operationId}`),kind:'interrupted_by_planning_override',operationId,targetId,overrideKind:'declared_mastery',at});run.revision++;tx.put('learningRuns',run.id,run);}
   tx.delete('meta','learning-active');
  }
  return true;
 });
}

/** Assignment is allowed only before any run; histories and running bindings are immutable. */
export async function selectLocalLearningPolicy(operationId:string,targetId:string,profileId:LearningPolicyId){
 return command({id:operationId,kind:'learning.policy',input:{targetId,profileId}},async tx=>{
  await learningOwner(tx);const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target||target.startedAt||(await tx.all<LocalLearningRun>('learningRuns')).some(r=>localRunTargetIds(r).includes(targetId)))throw new Error('localFlow.stepChanged');
  const profile=learningPolicyProfileRegistry.get(profileId);
  if(!profile.localSelectable||!target.assurancePackageKey)throw new Error('localFlow.resourceInvalid');
  const pack=target.packageKey?await tx.get<InstalledPackage>('packages',target.packageKey):undefined;
  validateLocalProtocolResources(learningRuntimeCoordinator.localExecutionFor(profileId,'initial_learning'),target,pack);
  target.policyAssignment={assignmentId:target.policyAssignment.assignmentId,revision:target.policyAssignment.revision+1,scope:'target_override',profileId,assignedByOperationId:operationId,assignedAt:new Date().toISOString(),provenance:{kind:'learner_target_override'}};tx.put('learningTargets',target.id,target);return target;
 });
}
