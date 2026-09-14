import {inspectLocalTargetReadiness,localExecutionForRun,learningRuntimeCoordinator,requireLocalTargetReadiness,type LocalLearningAction} from '../../learning/runtime/runtimeCoordinator';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry,type LearningPolicyId} from '../../learning/runtime/policyProfiles';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,sensaLearningMaterializationSnapshotSchema,sensaLearningConnectionContractVersion,LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,learningBundleBookId,learningBundleBookVersionId,learningBundleVersionLabel,learningBundleContentReleaseId,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {command,readLibrary,requestCloudCheckpoint,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningOwner,type InstalledPackage} from './packages';
import {validateLightweightInitialMaterialization,type LightweightInitialLearningMaterialization} from '../../learning/runtime/lightweightInitialContent';
import {
  createLocalProtocolState,
  createLocalProtocolProgress,
  assertLocalTargetMaterialIdentity,
  initializeLocalProtocolState,
  localProtocolActiveTargetId,
  localProtocolStepId,
  localProtocolOutcomePermissions,
  localRunOpenPlanningInterruption,
  reduceLocalProtocolAction,
  localLearningPurpose,
  localRunTargetIds,
  type LocalCommittedLearningPolicy,
  type LocalCurriculumMembership,
  type LocalLearningRun,
  type LocalLearningMaterialization,
  type LocalLearningPolicyAssignment,
  type LocalProtocolEvaluationFacts,
  type LocalResolvedLearningPlanSnapshot,
  type LocalLearningTarget,
  validateLocalProtocolResources,
} from '../../learning/runtime/localProtocol';
import {localCurriculumMembershipForContext,localExecutableTarget,localExecutableTargetForParticipant,upsertLocalCurriculumMembership} from '../../learning/runtime/localCurriculum';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {applyLocalProtocolTransition,type LocalLearningTransitionRecord} from './learningSettlement';
import {requireLanguageRouteContext} from './language';

export {localRunTargetIds};
export type {LocalLearningRun,LocalLearningTarget};
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:{stepId:string;materializationId:string;action:LocalLearningAction;formalEvaluation:LocalProtocolEvaluationFacts|null;transition:LocalLearningTransitionRecord}};
export type LocalStudyPlan={languageRouteId:string;routeRevision:number;revision:number;dailyNewSenseLimit:number;updatedAt:string};

const STUDY_PLANS_KEY='language-route-study-plans';
const readStudyPlans=async(tx:LibraryTransaction):Promise<Record<string,LocalStudyPlan>>=>await tx.get('settings',STUDY_PLANS_KEY)??{};

const createPolicyAssignment=(input:{operationId:string;targetId:string;profileId:LearningPolicyId;scope:LocalLearningPolicyAssignment['scope'];at:string;provenance:Readonly<Record<string,unknown>>}):LocalLearningPolicyAssignment=>({
 assignmentId:stableUuid(`local-policy-assignment:${input.targetId}`),revision:1,scope:input.scope,profileId:input.profileId,
 assignedByOperationId:input.operationId,assignedAt:input.at,provenance:structuredClone(input.provenance),
});

const curriculumMembership=(input:{
 operationId:string;targetId:string;sourceKey:string;languageContext:SensaFormalPinnedLanguageContext;
 sourceKind:LocalCurriculumMembership['sourceKind'];provenance:Readonly<Record<string,unknown>>;
 packageKey:string|null;assurancePackageKey?:string;material:LocalLearningMaterialization;at:string;previous?:LocalCurriculumMembership;
}):LocalCurriculumMembership=>({
 id:stableUuid(`local-curriculum-membership:${input.targetId}:${input.languageContext.languageRouteId}:${input.sourceKind}:${input.sourceKey}`),
 revision:(input.previous?.revision??0)+1,
 status:'active',
 languageContext:sensaFormalPinnedLanguageContextSchema.parse(input.languageContext),sourceKind:input.sourceKind,
 provenance:structuredClone(input.provenance),packageKey:input.packageKey,
 ...(input.assurancePackageKey?{assurancePackageKey:input.assurancePackageKey}:{}),material:structuredClone(input.material),
 createdByOperationId:input.previous?.createdByOperationId??input.operationId,createdAt:input.previous?.createdAt??input.at,updatedAt:input.at,
});

const materialForProtocolRun=(material:LocalLearningMaterialization,purpose:LocalLearningRun['purpose'],protocolRunId:string,at:string):LocalLearningMaterialization=>({
 snapshot:{...structuredClone(material.snapshot),learningMaterializationId:stableUuid(`local-run-materialization:${protocolRunId}:${material.snapshot.learningMaterializationId}`),protocolPurpose:purpose,createdAt:at},
 content:structuredClone(material.content),
});

const sameRunLanguagePair=(left:SensaFormalPinnedLanguageContext,right:SensaFormalPinnedLanguageContext)=>
 left.languageRouteId===right.languageRouteId&&left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;

/** Bind the current Step to the newest compatible material. Once bound, normal
 * navigation leaves it untouched; an explicit personal-material publication
 * may replace the still-current, not-yet-acted Step and increments Run revision. */
async function bindCurrentStepMaterial(tx:LibraryTransaction,run:LocalLearningRun,at:string,replace=false,operationId?:string):Promise<boolean>{
 if(run.completedAt)return false;
 const execution=localExecutionForRun(run),targetId=localProtocolActiveTargetId(execution,run),participant=run.participants[targetId];
 if(!participant)throw new Error('localFlow.stepChanged');
 const stepId=localProtocolStepId(execution,run);
 const previous=participant.presentedMaterials[stepId];
 if(!replace&&previous)return false;
 const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!target)throw new Error('localFlow.enrollFirst');
 const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId&&sameRunLanguagePair(candidate.languageContext,participant.languageContext));
 const material=membership?materialForProtocolRun(membership.material,run.purpose,participant.protocolRunId,at):structuredClone(participant.material);
 assertLocalTargetMaterialIdentity(target,material);validateLightweightInitialMaterialization(material);
 const executable=localExecutableTargetForParticipant(target,participant,material),pack=executable.packageKey?await tx.get<InstalledPackage>('packages',executable.packageKey):undefined;
 validateLocalProtocolResources(execution,executable,pack);
 participant.presentedMaterials[stepId]=material;
 if(replace){
  if(!previous||!operationId)throw new Error('localFlow.resourceInvalid');
  run.lifecycleEvents.push({eventId:stableUuid(`local-run-material-refresh:${run.id}:${operationId}:${stepId}`),kind:'current_step_material_refreshed',operationId,targetId,stepId,materializationId:material.snapshot.learningMaterializationId,at});
 }
 return true;
}

async function refreshCurrentStepsForMaterial(tx:LibraryTransaction,targetId:string,at:string,operationId:string):Promise<void>{
 for(const run of await tx.all<LocalLearningRun>('learningRuns')){
  if(run.completedAt||!localRunTargetIds(run).includes(targetId))continue;
  const execution=localExecutionForRun(run);
  if(localProtocolActiveTargetId(execution,run)!==targetId)continue;
  if(await bindCurrentStepMaterial(tx,run,at,true,operationId)){run.revision++;tx.put('learningRuns',run.id,run);}
 }
}

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

export async function enrollPackage(operationId:string,key:string,languageContext:SensaFormalPinnedLanguageContext){return command({id:operationId,kind:'learning.enroll',input:{key,languageContext}},async tx=>{
 const owner=await learningOwner(tx),context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
 const pack=await tx.get<InstalledPackage>('packages',key);if(!pack)throw new Error('localFlow.downloadFirst');
 if(pack.bundle.targetLanguage!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
 if(pack.bundle.supportLanguage!==context.supportLanguageTag)throw new Error('localFlow.routeSupportMismatch');
 const bookId=learningBundleBookId(pack.bundle),bookVersionId=learningBundleBookVersionId(pack.bundle),packageVersion=learningBundleVersionLabel(pack.bundle),contentReleaseId=learningBundleContentReleaseId(pack.bundle),now=new Date().toISOString();
 if(bookVersionId){
  for(const target of await tx.all<LocalLearningTarget>('learningTargets')){
   let changed=false;
   const curriculumMemberships=target.curriculumMemberships.map(membership=>{
    if(membership.status==='superseded'||membership.sourceKind!=='sense_learning_package'||membership.languageContext.languageRouteId!==context.languageRouteId||membership.languageContext.targetLanguageTag!==context.targetLanguageTag||membership.languageContext.supportLanguageTag!==context.supportLanguageTag||membership.provenance.bookId!==bookId||membership.provenance.bookVersionId===bookVersionId)return membership;
    changed=true;
    return {...membership,status:'superseded' as const,revision:membership.revision+1,updatedAt:now};
   });
   if(changed)tx.put('learningTargets',target.id,{...target,curriculumMemberships});
  }
 }
 const ids:string[]=[];
 for(const e of pack.bundle.entries){
  const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${e.senseVersionId}:${e.bindingVersionId}`);ids.push(id);
  const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-material:${owner.learnerId}:${key}:${id}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'published',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:e.content,contentDigest:canonicalJsonDigest(e.content),validationStatus:'validated',validatorVersion:'sensa-web-package-v1',provenance:{bookId,bookVersionId,contentReleaseId,packageVersion,packageDigest:pack.digest,senseId:e.senseId,senseVersionId:e.senseVersionId,bindingId:e.bindingId,bindingVersionId:e.bindingVersionId},personalAnchorUseGrantIds:[],createdAt:now});
  const profileId=e.assurancePackageKey?'high_assurance':'lightweight';
  const source={kind:'sense_learning_package',bookId,bookVersionId,contentReleaseId,packageVersion,packageDigest:pack.digest};
  const material={snapshot,content:e.content};
  const existing=await tx.get<LocalLearningTarget>('learningTargets',id);
  if(existing&&(existing.identity.learnerUserId!==owner.learnerId||existing.identity.senseVersionId!==e.senseVersionId||existing.identity.bindingVersionId!==e.bindingVersionId||existing.targetLanguageTag!==pack.bundle.targetLanguage||existing.expression!==e.expression))throw new Error('localFlow.invalidTarget');
  const membership=curriculumMembership({operationId,targetId:id,sourceKey:key,languageContext:context,sourceKind:'sense_learning_package',provenance:source,packageKey:key,assurancePackageKey:e.assurancePackageKey,material,at:snapshot.createdAt});
  if(existing){
   if(existing.curriculumMemberships.some(candidate=>candidate.id===membership.id))continue;
   tx.put('learningTargets',id,upsertLocalCurriculumMembership(existing,membership));continue;
  }
  const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:e.senseId,senseVersionId:e.senseVersionId,senseExpressionBindingId:e.bindingId,bindingVersionId:e.bindingVersionId,targetLanguageTag:pack.bundle.targetLanguage},curriculumMemberships:[membership],expression:e.expression,policyAssignment:createPolicyAssignment({operationId,targetId:id,profileId,scope:'curriculum_source',at:snapshot.createdAt,provenance:{bookId,bookVersionId,contentReleaseId,packageVersion}}),committedPolicy:null,planningOverrides:[],targetLanguageTag:pack.bundle.targetLanguage,introducedLanguageRouteId:null,createdAt:snapshot.createdAt,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
  tx.put('learningTargets',id,target);
 }
 return ids;
});}
export const readLearning=()=>readLibrary(async tx=>({targets:await tx.all<LocalLearningTarget>('learningTargets'),runs:await tx.all<LocalLearningRun>('learningRuns'),events:await tx.all<LearningEvent>('learningEvents'),active:await tx.get<string>('meta','learning-active'),studyPlans:await readStudyPlans(tx)}));
export async function confirmLearningQuantity(operationId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number){return command({id:operationId,kind:'learning.quantity',input:{languageContext,dailyLimit}},async tx=>{await learningOwner(tx);const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new Error('localFlow.quantityRange');const plans=await readStudyPlans(tx),previous=plans[context.languageRouteId];plans[context.languageRouteId]={languageRouteId:context.languageRouteId,routeRevision:context.languageRouteRevision,revision:(previous?.revision??0)+1,dailyNewSenseLimit:dailyLimit,updatedAt:new Date().toISOString()};tx.put('settings',STUDY_PLANS_KEY,plans);return true;});}
const day=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export async function startLearning(operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at=new Date().toISOString()){return command({id:operationId,kind:'learning.start',input:{targetId,languageContext,dailyLimit,at}},async tx=>{
 await learningOwner(tx);const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isFinite(Date.parse(at)))throw new Error('localFlow.confirmQuantity');
 const plan=(await readStudyPlans(tx))[context.languageRouteId];if(plan?.dailyNewSenseLimit!==dailyLimit)throw new Error('localFlow.confirmNewQuantity');
 const active=await tx.get<string>('meta','learning-active');if(active){const run=await tx.get<LocalLearningRun>('learningRuns',active);if(run)return run;}
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('localFlow.enrollFirst');if(hasDeclaredMasteryOverride(t))throw new Error('localFlow.stepChanged');
 const selectedMembership=localCurriculumMembershipForContext(t,context);if(!selectedMembership)throw new Error('localFlow.routeMembershipMissing');
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
 const pack=selectedMembership.packageKey?await tx.get<InstalledPackage>('packages',selectedMembership.packageKey):undefined;
 const readiness=requireLocalTargetReadiness(t,selectedMembership,pack,purpose);
 const profileId=readiness.profileId,profile=learningPolicyProfileRegistry.get(profileId,readiness.profileVersion),runner=learningRuntimeCoordinator.localExecutionForBinding(readiness.binding,purpose);
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('localFlow.notDue');
 if(purpose==='initial_learning'&&!t.startedAt&&(await tx.all<LocalLearningTarget>('learningTargets')).filter(v=>v.introducedLanguageRouteId===context.languageRouteId&&v.startedAt&&day(new Date(v.startedAt))===day(now)).length>=dailyLimit)throw new Error('localFlow.dailyLimit');
 const binding=profile.protocols[purpose],schedulingPolicy=profile.lifecycle.schedulingPolicy;if(!binding.localProtocolVersion||!schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 let participants=[t];
 if(runner.cohort){
  const targets=await tx.all<LocalLearningTarget>('learningTargets');
  const remaining=Math.max(0,dailyLimit-targets.filter(v=>v.introducedLanguageRouteId===context.languageRouteId&&v.startedAt&&day(new Date(v.startedAt))===day(now)).length);
  const broadlyCompatible=[t,...targets.filter(v=>v.id!==t.id)].filter(v=>!hasDeclaredMasteryOverride(v)&&!!localCurriculumMembershipForContext(v,context)&&localTargetPolicy(v)===profileId&&localLearningPurpose(v)===purpose&&!allRuns.some(r=>!r.completedAt&&localRunTargetIds(r).includes(v.id))&&(purpose==='initial_learning'||(v.relearnAt?now>=new Date(v.relearnAt):!!v.memory&&now>=v.memory.dueAt)));
  const compatible:LocalLearningTarget[]=[];
  for(const candidate of broadlyCompatible){
   const candidateMembership=localCurriculumMembershipForContext(candidate,context)!;
   const candidateResource=candidateMembership.packageKey?await tx.get<InstalledPackage>('packages',candidateMembership.packageKey):undefined;
   if(inspectLocalTargetReadiness(candidate,candidateMembership,candidateResource,purpose).status==='ready')compatible.push(candidate);
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
  const membership=localCurriculumMembershipForContext(participant,context);if(!membership)throw new Error('localFlow.routeMembershipMissing');
  const protocolRunId=stableUuid(`local-protocol-run:${sessionId}:${participant.id}`);
  const policyCommitment=commitPolicy(participant,protocolRunId,at);
  if(policyCommitment.profileId!==profileId||policyCommitment.profileVersion!==profile.profileVersion)throw new Error('localFlow.resourceInvalid');
  const material=materialForProtocolRun(membership.material,purpose,protocolRunId,at);
  const resolvedPlan=resolveRunPlan(participant,policyCommitment,purpose,material,at);
  participant.committedPolicy=policyCommitment;
  return [participant.id,{protocolRunId,curriculumMembershipId:membership.id,languageContext:context,startReason:{kind:purpose==='initial_learning'?'initial_learning_ready':purpose==='retention_review'?'due_review':'relearning_ready',selectionReason:participant.id===targetId?'requested_target':'cohort_candidate',triggerAt:at,triggerMemoryRevision:participant.memoryRevision},outcomePermissions:localProtocolOutcomePermissions(purpose,binding),material,presentedMaterials:{},policyCommitment,resolvedPlan,progress:createLocalProtocolProgress(protocolRunId,binding),memoryRevision:participant.memoryRevision,dueAt:participant.memory?.dueAt.toISOString()??null,evidenceIds:[]}];
 }));
 const run:LocalLearningRun={
  id:sessionId,targetId,targetIds:participants.map(v=>v.id),
  participants:participantSnapshots,
  targetCompletions:{},languageContext:context,purpose,policyProfileId:profileId,policyProfileVersion:profile.profileVersion,
  protocolBinding:structuredClone(binding),protocolVersion:binding.localProtocolVersion,
  protocolState:createLocalProtocolState(binding.runtimeAdapterId,null),
  schedulingPolicyId:profile.lifecycle.schedulingPolicyId,schedulingPolicy:structuredClone(schedulingPolicy),
  learnerVisibleClaimBoundary:profile.lifecycle.learnerVisibleClaimBoundary,
  ordinal:1,revision:1,lifecycleEvents:[],startedAt:at,completedAt:null,
 };
 for(const participant of participants){
  const membership=localCurriculumMembershipForContext(participant,context)!;
  const resources=membership.packageKey?await tx.get<InstalledPackage>('packages',membership.packageKey):undefined;
  requireLocalTargetReadiness(participant,membership,resources,purpose);
 }
 run.protocolState=initializeLocalProtocolState({execution:runner,target:localExecutableTarget(t,selectedMembership),resource:pack,purpose,run});
 await bindCurrentStepMaterial(tx,run,at);
 for(const participant of participants)if(!participant.startedAt){participant.startedAt=at;participant.introducedLanguageRouteId=context.languageRouteId;tx.put('learningTargets',participant.id,participant);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);return run;
});}
export async function actLearning(operationId:string,runId:string,revision:number,action:LocalLearningAction,at=new Date().toISOString()){return command({id:operationId,kind:'learning.act',input:{runId,revision,action,at}},async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('localFlow.stepChanged');
 const execution=localExecutionForRun(run);
 const activeTargetId=localProtocolActiveTargetId(execution,run);
 const t=(await tx.get<LocalLearningTarget>('learningTargets',activeTargetId))!;
 await bindCurrentStepMaterial(tx,run,at);
 const stepId=localProtocolStepId(execution,run),participant=run.participants[activeTargetId]!,presentedMaterial=participant.presentedMaterials[stepId];
 if(!presentedMaterial)throw new Error('localFlow.resourceInvalid');
 const executable=localExecutableTargetForParticipant(t,participant,presentedMaterial);
 if(hasDeclaredMasteryOverride(t)||localRunOpenPlanningInterruption(run))throw new Error('localFlow.stepChanged');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
 const pack=executable.packageKey?await tx.get<InstalledPackage>('packages',executable.packageKey):undefined;validateLocalProtocolResources(execution,executable,pack);
 const executed=reduceLocalProtocolAction({operationId,stepKey:stepId,execution,target:executable,run,resource:pack,action,at});
 const nextRun=executed.run;
 const applied=applyLocalProtocolTransition({operationId,stepId,at,target:t,run:nextRun,transition:executed.transition});
 nextRun.ordinal++;nextRun.revision++;if(!nextRun.completedAt)await bindCurrentStepMaterial(tx,nextRun,at);tx.put('learningRuns',nextRun.id,nextRun);tx.put('learningTargets',applied.target.id,applied.target);
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{stepId,materializationId:presentedMaterial.snapshot.learningMaterializationId,action,formalEvaluation:executed.facts,transition:applied.record}} satisfies LearningEvent);return nextRun;
});}
export async function finishLearning(operationId:string,runId:string){const result=await command({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('localFlow.finishFirst');if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');return true;});requestCloudCheckpoint();return result;}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,meaning:import('./teacher').LocalMeaning,languageContext:SensaFormalPinnedLanguageContext,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null,replace=false){
 const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${meaning.senseVersionId}:${meaning.bindingVersionId}`);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);
 const now=new Date().toISOString();
 const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-personal-material:${attemptId}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'on_demand',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:content,contentDigest:canonicalJsonDigest(content),validationStatus:'validated',validatorVersion:'sensa-web-content-v1',provenance:{meaningId:meaning.id,acceptanceId:meaning.acceptanceId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,bindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,attemptId},personalAnchorUseGrantIds:grantId?[grantId]:[],createdAt:now});
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext),targetLanguageTag=meaning.targetLanguageTag;
 if(targetLanguageTag!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
 const material={snapshot,content};validateLightweightInitialMaterialization(material);
 const membershipId=stableUuid(`local-curriculum-membership:${id}:${context.languageRouteId}:personal_meaning_alignment:${meaning.alignmentId}`);
 const previous=existing?.curriculumMemberships.find(candidate=>candidate.id===membershipId);
 if(existing&&previous&&!replace)return existing;
 const membership=curriculumMembership({operationId:attemptId,targetId:id,sourceKey:meaning.alignmentId,languageContext:context,sourceKind:'personal_meaning_alignment',provenance:{kind:'personal_meaning_alignment',meaningId:meaning.id,acceptanceId:meaning.acceptanceId,alignmentId:meaning.alignmentId},packageKey:null,material,at:now,previous});
 if(existing){const next=upsertLocalCurriculumMembership(existing,membership);tx.put('learningTargets',id,next);if(replace)await refreshCurrentStepsForMaterial(tx,id,now,attemptId);return next;}
 const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,senseExpressionBindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,targetLanguageTag},curriculumMemberships:[membership],expression:meaning.proposal.expression.surface,policyAssignment:createPolicyAssignment({operationId:attemptId,targetId:id,profileId:'lightweight',scope:'system_default',at:now,provenance:{kind:'personal_meaning_alignment'}}),committedPolicy:null,planningOverrides:[],targetLanguageTag,introducedLanguageRouteId:null,createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
 tx.put('learningTargets',id,target);return target;
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
export async function selectLocalLearningPolicy(operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,profileId:LearningPolicyId){
 return command({id:operationId,kind:'learning.policy',input:{targetId,languageContext,profileId}},async tx=>{
  await learningOwner(tx);const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target||target.startedAt||(await tx.all<LocalLearningRun>('learningRuns')).some(r=>localRunTargetIds(r).includes(targetId)))throw new Error('localFlow.stepChanged');
  const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
  const membership=localCurriculumMembershipForContext(target,context);if(!membership)throw new Error('localFlow.routeMembershipMissing');
  const profile=learningPolicyProfileRegistry.get(profileId);
  if(!profile.localSelectable||!membership.assurancePackageKey)throw new Error('localFlow.resourceInvalid');
  const pack=membership.packageKey?await tx.get<InstalledPackage>('packages',membership.packageKey):undefined;
  validateLocalProtocolResources(learningRuntimeCoordinator.localExecutionFor(profileId,'initial_learning'),localExecutableTarget(target,membership),pack);
  target.policyAssignment={assignmentId:target.policyAssignment.assignmentId,revision:target.policyAssignment.revision+1,scope:'target_override',profileId,assignedByOperationId:operationId,assignedAt:new Date().toISOString(),provenance:{kind:'learner_target_override'}};tx.put('learningTargets',target.id,target);return target;
 });
}
