import {sensaLearningMaterializationSnapshotSchema} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

import {localExecutableTargetForParticipant} from '../../../learning/runtime/localCurriculum';
import {localLearningPurpose,localProtocolActiveTargetId,localProtocolOutcomePermissions,localProtocolStepId,localRunOpenPlanningInterruption,reduceLocalProtocolAction,replayLocalProtocolRun,validateLocalProtocolResources} from '../../../learning/runtime/localProtocol';
import {localRunBinding,localRunPolicy,localTargetPolicy} from '../../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../../../learning/runtime/policyProfiles';
import {baseContentBeforeSupplement} from '../../../learning/runtime/resourceSupplement';
import {localExecutionForRun} from '../../../learning/runtime/runtimeCoordinator';
import {validateLightweightInitialMaterialization} from '../../../learning/runtime/lightweightInitialContent';
import {backupEqual} from '../backupCodec';
import type {BackupRows} from '../backupValidation';
import {personalLearningSceneRowId} from '../contentAnnotations';
import {type LearningEvent,localRunTargetIds,type LocalLearningRun,type LocalLearningTarget} from '../learning';
import {validateLearningReconciliationRows} from '../learningReconciliation';
import {applyLocalProtocolTransition} from '../learningSettlement';
import {packageInstallationSchema} from '../packageRecords';
import type {LibraryIdentity,Table} from '../store';
import {hasDeclaredMasteryOverride} from '../../../learning/runtime/targetPlanningOverrides';

type RequireRow=(table:Table,id:string)=>any;

/** Learning owns history validation, deterministic replay, projection checks and reconciliation decisions. */
export function validateLearningReplica(input:{
 rows:BackupRows;
 maps:Record<Table,Map<string,any>>;
 identity:LibraryIdentity;
 routes:Map<string,any>;
 requireRow:RequireRow;
 requirePersonalSource:(source:any)=>unknown;
 validateLanguageContext:(value:unknown)=>any;
 operationInput:(id:string)=>any;
 fail:()=>never;
}){
 const {rows,maps,identity,routes,requireRow,requirePersonalSource,validateLanguageContext,operationInput,fail}=input;
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 for(const {value:target} of rows.learningTargets){
  learningPolicyProfileRegistry.get(localTargetPolicy(target));
  const assignment=target.policyAssignment;
  uuid.parse(assignment.assignmentId);z.number().int().positive().parse(assignment.revision);timestamp.parse(assignment.assignedAt);learningPolicyProfileRegistry.get(assignment.profileId);
  const identityFields=['learnerUserId','senseId','senseVersionId','senseExpressionBindingId','bindingVersionId','targetLanguageTag'] as const;
  for(const field of identityFields)z.string().min(1).parse(target.identity[field]);
  if(target.identity.learnerUserId!==identity.learnerId||target.identity.targetLanguageTag!==target.targetLanguageTag||target.id!==stableUuid(`sensa-learning-target:${identity.learnerId}:${target.identity.senseVersionId}:${target.identity.bindingVersionId}`)||target.retentionId!==stableUuid(`sensa-retention:${target.id}`))fail();
  if(target.committedPolicy){const commitment=target.committedPolicy;uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);z.number().int().positive().parse(commitment.revision);timestamp.parse(commitment.committedAt);const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion);if(!target.startedAt||commitment.assignmentId!==assignment.assignmentId||commitment.assignmentRevision!==assignment.revision||profile.profileId!==commitment.profileId)fail();}else if(target.startedAt)fail();
  z.array(z.object({kind:z.literal('declared_mastery'),source:z.literal('learner'),operationId:uuid,createdAt:timestamp}).strict()).max(1).parse(target.planningOverrides);
  for(const override of target.planningOverrides){const operation=operationInput(override.operationId);if(operation&&(operation.kind!=='learning.declareMastery'||operation.input.targetId!==target.id||operation.input.active!==true||operation.input.at!==override.createdAt))fail();}
  if(!Array.isArray(target.curriculumMemberships)||!target.curriculumMemberships.length||new Set(target.curriculumMemberships.map((membership:any)=>membership.id)).size!==target.curriculumMemberships.length)fail();
  for(const membership of target.curriculumMemberships){
   uuid.parse(membership.id);z.number().int().positive().parse(membership.revision);if(membership.status!==undefined&&!['active','superseded'].includes(membership.status))fail();uuid.parse(membership.createdByOperationId);timestamp.parse(membership.createdAt);timestamp.parse(membership.updatedAt);if(Date.parse(membership.updatedAt)<Date.parse(membership.createdAt))fail();
   const context=validateLanguageContext(membership.languageContext);if(context.targetLanguageTag!==target.targetLanguageTag)fail();
   sensaLearningMaterializationSnapshotSchema.parse(membership.material.snapshot);validateLightweightInitialMaterialization(membership.material);
   const provenance=membership.material.snapshot.provenance;
   if(membership.material.snapshot.learnerUserId!==identity.learnerId||membership.material.snapshot.learningTargetId!==target.id||provenance.senseId!==target.identity.senseId||provenance.senseVersionId!==target.identity.senseVersionId||provenance.bindingId!==target.identity.senseExpressionBindingId||provenance.bindingVersionId!==target.identity.bindingVersionId)fail();
   if(target.expression!==membership.material.content.resources.find((resource:any)=>resource.materialRoleKey==='target_expression')?.contentPayload.surface)fail();
   if(membership.sourceKind==='sense_learning_package'){
    if(!membership.packageKey||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${context.languageRouteId}:sense_learning_package:${membership.packageKey}`))fail();
    const installation=packageInstallationSchema.parse(requireRow('packageInstallations',membership.packageKey));if(installation.artifact.targetLanguage!==context.targetLanguageTag||installation.artifact.supportLanguage!==context.supportLanguageTag)fail();
    if(installation.artifact.kind==='book_release'&&(membership.provenance?.bookId!==installation.artifact.bookId||membership.provenance?.bookVersionId!==installation.artifact.bookVersionId))fail();
    const pack=maps.packageCache.get(membership.packageKey),entry=pack?.bundle.entries.find((candidate:any)=>candidate.senseVersionId===provenance.senseVersionId&&candidate.bindingVersionId===provenance.bindingVersionId);
    if(pack&&(!entry||pack.bundle.targetLanguage!==context.targetLanguageTag||pack.bundle.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag))||entry.assurancePackageKey!==membership.assurancePackageKey))fail();
   }else if(membership.sourceKind==='personal_meaning_alignment'){
    const source=membership.provenance as any,task=rows.personalLearning.find(({value:candidate})=>candidate.targetId===target.id&&candidate.curriculumMembershipId===membership.id)?.value;
    if(membership.packageKey!==null||membership.assurancePackageKey!==undefined||!task||source?.personalMeaningId!==task.source.personalMeaningId||source?.alignmentId!==task.source.personalMeaningAlignmentId||source?.personalMeaningRevisionId!==task.source.personalMeaningRevisionId||source?.alignmentBasisReferenceId!==task.source.alignmentBasisReferenceId||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${context.languageRouteId}:personal_meaning_alignment:${source.alignmentId}`))fail();
    requirePersonalSource(task.source);const attempt=requireRow('contentAttempts',provenance.attemptId);
    if(attempt.taskId!==task.id||attempt.status!=='ready'||!(attempt.review?.accepted||(attempt.reviewProvider===null&&attempt.review===null&&attempt.validation?.review===null&&attempt.validation?.validations?.length>0&&attempt.validation.validations.every((validation:any)=>validation.status==='accepted')))||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag)))fail();
   }else fail();
  }
  if(target.introducedLanguageRouteId!==null&&!target.curriculumMemberships.some((membership:any)=>membership.languageContext.languageRouteId===target.introducedLanguageRouteId))fail();
 }
 const packageCacheComplete=rows.learningTargets.every(({value:target})=>target.curriculumMemberships.every((membership:any)=>membership.sourceKind!=='sense_learning_package'||maps.packageCache.has(membership.packageKey)));
 let historyOnlyRunIds=new Set<string>();
 try{({historyOnlyRunIds}=validateLearningReconciliationRows(rows));}catch{fail();}
 const targets=new Map<string,LocalLearningTarget>(rows.learningTargets.map(({value:target})=>[target.id,{...target,memory:null,memoryRevision:0,completedAt:null,relearnAt:null,relearningState:null,startedAt:null}]));
 const unfinished=new Set<string>(),knownProtocolRunIds=new Set<string>();
 const runs:LocalLearningRun[]=rows.learningRuns.map(row=>row.value).sort((left,right)=>left.startedAt.localeCompare(right.startedAt));
 for(const saved of runs){
  if(historyOnlyRunIds.has(saved.id))continue;
  if(!packageCacheComplete){
   const context=validateLanguageContext(saved.languageContext),ids=localRunTargetIds(saved);
   if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId)||!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
   for(const [id,participant] of Object.entries(saved.participants)){
    const target=requireRow('learningTargets',id),membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===(participant as any).curriculumMembershipId)??fail();
    uuid.parse((participant as any).protocolRunId);if(knownProtocolRunIds.has((participant as any).protocolRunId))fail();knownProtocolRunIds.add((participant as any).protocolRunId);
    if(!backupEqual((participant as any).languageContext,context)||membership.languageContext.languageRouteId!==context.languageRouteId)fail();
    validateLightweightInitialMaterialization((participant as any).material);
   }
   continue;
  }
  const runLanguageContext=validateLanguageContext(saved.languageContext),ids=localRunTargetIds(saved);
  if(!Array.isArray(saved.lifecycleEvents))fail();
  let openInterruption:ReturnType<typeof localRunOpenPlanningInterruption>=null;
  const lifecycleEventIds=new Set<string>();
  for(const event of saved.lifecycleEvents){
   uuid.parse(event.eventId);uuid.parse(event.operationId);timestamp.parse(event.at);if(lifecycleEventIds.has(event.eventId)||Date.parse(event.at)<Date.parse(saved.startedAt))fail();lifecycleEventIds.add(event.eventId);
   const operation=operationInput(event.operationId);
   if(event.kind==='interrupted_by_planning_override'){
    if(openInterruption||event.overrideKind!=='declared_mastery'||!ids.includes(event.targetId)||operation&&(operation.kind!=='learning.declareMastery'||operation.input.targetId!==event.targetId||operation.input.active!==true||operation.input.at!==event.at))fail();
    openInterruption=event;
   }else if(event.kind==='resumed_after_planning_override'){
    if(!openInterruption||event.interruptionEventId!==openInterruption.eventId||operation&&(operation.kind!=='learning.start'||operation.input.at!==event.at||!ids.includes(operation.input.targetId)))fail();
    openInterruption=null;
   }else if(event.kind==='current_step_material_refreshed'){
    const participant=saved.participants[event.targetId]??fail(),target=requireRow('learningTargets',event.targetId),membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===participant.curriculumMembershipId),attempt=requireRow('contentAttempts',event.operationId),task=requireRow('personalLearning',attempt.taskId),sourceMaterializationId=stableUuid(`sensa-personal-material:${event.operationId}`);
    if(attempt.status!=='ready'||task.targetId!==event.targetId||membership?.sourceKind!=='personal_meaning_alignment'||!ids.includes(event.targetId)||!participant.presentedMaterials?.[event.stepId]||operation&&(operation.kind!=='personal.prepare'||attempt.taskId!==operation.input.id)||event.eventId!==stableUuid(`local-run-material-refresh:${saved.id}:${event.operationId}:${event.stepId}`)||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
   }else fail();
  }
  if(localRunOpenPlanningInterruption(saved)?.eventId!==openInterruption?.eventId)fail();
  if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId)||!Object.keys(saved.targetCompletions).every(id=>ids.includes(id)))fail();
  const execution=localExecutionForRun(saved),binding=localRunBinding(saved),profile=learningPolicyProfileRegistry.get(localRunPolicy(saved),saved.policyProfileVersion);
  if(!backupEqual(saved.protocolBinding,profile.protocols[saved.purpose]))fail();
  if(!backupEqual(saved.schedulingPolicy,profile.lifecycle.schedulingPolicy)||saved.schedulingPolicyId!==profile.lifecycle.schedulingPolicyId||saved.learnerVisibleClaimBoundary!==profile.lifecycle.learnerVisibleClaimBoundary)fail();
  if(ids.length>1&&!execution.cohort||!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
  for(const [id,participant] of Object.entries(saved.participants)){
   const target=targets.get(id)??fail();
   const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId)??fail(),samePair=(left:any,right:any)=>left.languageRouteId===right.languageRouteId&&left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;
   if(!backupEqual(participant.languageContext,runLanguageContext)||!samePair(membership.languageContext,participant.languageContext))fail();
   uuid.parse(participant.protocolRunId);if(knownProtocolRunIds.has(participant.protocolRunId))fail();knownProtocolRunIds.add(participant.protocolRunId);
   const validateRunMaterial=(material:typeof participant.material)=>{
    validateLightweightInitialMaterialization(material);const materialProvenance=material.snapshot.provenance as any;
    if(material.snapshot.learningTargetId!==id||material.snapshot.learnerUserId!==identity.learnerId||material.snapshot.protocolPurpose!==saved.purpose||materialProvenance.senseId!==target.identity.senseId||materialProvenance.senseVersionId!==target.identity.senseVersionId||materialProvenance.bindingId!==target.identity.senseExpressionBindingId||materialProvenance.bindingVersionId!==target.identity.bindingVersionId)fail();
    if(membership.sourceKind==='sense_learning_package'){
     const membershipPackageKey=z.string().min(1).parse(membership.packageKey),pack=requireRow('packageCache',membershipPackageKey),entry=pack.bundle.entries.find((candidate:any)=>candidate.senseVersionId===materialProvenance.senseVersionId&&candidate.bindingVersionId===materialProvenance.bindingVersionId);
     if(!entry||!backupEqual(entry.content,baseContentBeforeSupplement(material,participant.languageContext.supportLanguageTag)))fail();
    }else{
     const attempt=requireRow('contentAttempts',materialProvenance.attemptId);if(attempt.status!=='ready'||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(material,participant.languageContext.supportLanguageTag)))fail();
    }
   };
   validateRunMaterial(participant.material);if(!participant.presentedMaterials||typeof participant.presentedMaterials!=='object'||Array.isArray(participant.presentedMaterials))fail();for(const [stepId,material] of Object.entries(participant.presentedMaterials)){if(!stepId.trim())fail();validateRunMaterial(material);}
   const commitment=participant.policyCommitment,plan=participant.resolvedPlan;
   uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);uuid.parse(plan.resolvedLearningPlanRevisionId);
   if(!backupEqual(commitment,target.committedPolicy)||plan.learningTargetId!==id||plan.retentionTargetId!==target.retentionId||plan.purpose!==saved.purpose||plan.profileId!==commitment.profileId||plan.profileVersion!==commitment.profileVersion||plan.readiness!=='ready'||!backupEqual(plan.protocolBinding,saved.protocolBinding)||!backupEqual(plan.contentDemands,saved.protocolBinding.contentDemands)||!backupEqual(plan.learningMaterializationIds,[participant.material.snapshot.learningMaterializationId]))fail();
   const progress=participant.progress;
   if(progress.protocolRunId!==participant.protocolRunId||progress.protocolId!==saved.protocolBinding.protocolId||progress.protocolVersion!==saved.protocolBinding.protocolVersion||!backupEqual(Object.keys(progress.checkpointCredits).sort(),[...saved.protocolBinding.checkpointDefinitionIds].sort()))fail();
   if(progress.completed!==Object.hasOwn(saved.targetCompletions,id))fail();
   const expectedStartKind=saved.purpose==='initial_learning'?'initial_learning_ready':saved.purpose==='retention_review'?'due_review':'relearning_ready';
   if(participant.startReason.kind!==expectedStartKind||participant.startReason.selectionReason!==(id===saved.targetId?'requested_target':'cohort_candidate')||participant.startReason.triggerAt!==saved.startedAt||participant.startReason.triggerMemoryRevision!==participant.memoryRevision||!backupEqual(participant.outcomePermissions,localProtocolOutcomePermissions(saved.purpose,saved.protocolBinding)))fail();
   if(saved.policyProfileId!==commitment.profileId||saved.policyProfileVersion!==commitment.profileVersion||!Array.isArray(participant.evidenceIds)||participant.evidenceIds.some(id=>!uuid.safeParse(id).success))fail();
  }
  timestamp.parse(saved.startedAt);if(saved.protocolVersion!==binding.localProtocolVersion)fail();
  for(const id of ids){
   const target=targets.get(id)??fail(),trigger=saved.participants[id]??fail();
   if(unfinished.has(id)||localLearningPurpose(target)!==saved.purpose||trigger.memoryRevision!==target.memoryRevision||trigger.dueAt!==(target.memory?.dueAt.toISOString()??null))fail();
   if(saved.purpose==='retention_review'&&(!target.memory||Date.parse(saved.startedAt)<target.memory.dueAt.getTime())||target.relearnAt&&Date.parse(saved.startedAt)<Date.parse(target.relearnAt))fail();
   target.startedAt??=saved.startedAt;
   const executable=localExecutableTargetForParticipant(target,trigger),pack=executable.packageKey?requireRow('packageCache',executable.packageKey):undefined;
   validateLocalProtocolResources(execution,executable,pack);
  }
  const primary=targets.get(saved.targetId)??fail(),primaryExecutable=localExecutableTargetForParticipant(primary,saved.participants[saved.targetId]??fail());
  let run=replayLocalProtocolRun({execution,target:primaryExecutable,resource:primaryExecutable.packageKey?requireRow('packageCache',primaryExecutable.packageKey):undefined,saved});
  if(!Object.hasOwn(saved,'completionKind'))delete run.completionKind;
  const events:LearningEvent[]=rows.learningEvents.map(row=>row.value).filter(event=>event.runId===saved.id),byStep=new Map(events.map(event=>[(event.detail as any)?.stepId,event]));if(byStep.size!==events.length)fail();
  for(let index=0;index<events.length;index++){
   const event=byStep.get(localProtocolStepId(execution,run))??fail(),targetId=localProtocolActiveTargetId(execution,run);
   if(!ids.includes(targetId)||event.targetId!==targetId||run.completedAt)fail();
   const target=targets.get(targetId)??fail(),participant=run.participants[targetId]??fail();
   timestamp.parse(event.at);if(Date.parse(event.at)<Date.parse(run.startedAt))fail();
   const detail=event.detail as any,presented=participant.presentedMaterials[detail.stepId]??fail();if(event.kind!==detail.action?.kind||detail.materializationId!==presented.snapshot.learningMaterializationId||!Object.hasOwn(detail,'personalLearningScene'))fail();
   if(detail.personalLearningScene!==null){
    const scene=requireRow('annotations',personalLearningSceneRowId(targetId,participant.languageContext.languageRouteId));
    const pinned=z.object({sceneId:uuid,revisionId:uuid,revision:z.number().int().positive()}).strict().parse(detail.personalLearningScene),sceneRevision=scene.kind==='learning_scene'&&scene.sceneId===pinned.sceneId?scene.revisions.find((candidate:any)=>candidate.revisionId===pinned.revisionId):undefined;
    if(!sceneRevision||sceneRevision.revision!==pinned.revision||sceneRevision.createdAt>Date.parse(event.at))fail();
   }
   const executable=localExecutableTargetForParticipant(target,participant,presented);
   const executed=reduceLocalProtocolAction({operationId:event.id,stepKey:detail.stepId,execution,target:executable,run,resource:executable.packageKey?requireRow('packageCache',executable.packageKey):undefined,action:detail.action,at:event.at});
   const applied=applyLocalProtocolTransition({operationId:event.id,stepId:detail.stepId,at:event.at,target,run:executed.run,transition:executed.transition});
   if(!backupEqual(executed.facts,detail.formalEvaluation)||!backupEqual(applied.record,detail.transition)||executed.facts&&!backupEqual(executed.facts.step.learningMaterializationIds,[detail.materializationId]))fail();targets.set(targetId,applied.target);run=executed.run;run.ordinal++;run.revision++;
  }
  if(!backupEqual(run,saved))fail();if(!run.completedAt)ids.forEach(id=>unfinished.add(id));
 }
 for(const {value:target} of rows.learningTargets)if(target.committedPolicy&&!knownProtocolRunIds.has(target.committedPolicy.committedByProtocolRunId))fail();
 if(packageCacheComplete)for(const {value:target} of rows.learningTargets)for(const key of ['memory','memoryRevision','startedAt','completedAt','relearnAt','relearningState'] as const)if(!backupEqual(targets.get(target.id)![key],target[key]))fail();
 for(const {value:saved} of rows.learningRuns){const context=validateLanguageContext(saved.languageContext);requireRow('learningTargets',saved.targetId);for(const [id,participant] of Object.entries(saved.participants as LocalLearningRun['participants'])){const target=requireRow('learningTargets',id);validateLightweightInitialMaterialization(participant.material);if(participant.material.snapshot.learningTargetId!==id||participant.material.snapshot.learnerUserId!==identity.learnerId||!backupEqual(participant.languageContext,context)||!target.curriculumMemberships.some((membership:any)=>membership.id===participant.curriculumMembershipId&&membership.languageContext.languageRouteId===context.languageRouteId&&membership.languageContext.targetLanguageTag===context.targetLanguageTag&&membership.languageContext.supportLanguageTag===context.supportLanguageTag))fail();}}
 for(const {key,value:event} of rows.learningEvents){
  const eventRun=requireRow('learningRuns',event.runId),operation=operationInput(key),presented=eventRun.participants[event.targetId]?.presentedMaterials?.[event.detail.stepId];if(!presented||event.detail.materializationId!==presented.snapshot.learningMaterializationId||operation&&(operation.kind!=='learning.act'||operation.input.runId!==event.runId||operation.input.at!==event.at||!backupEqual(operation.input.action,event.detail.action)))fail();
  const facts=event.detail.formalEvaluation;if(facts){
   for(const id of [facts.step.protocolStepInstanceId,facts.step.protocolRunId,facts.action.actionId,facts.attempt.attemptId,facts.observation.observationId,facts.evaluation.evaluationId,facts.transitionDecision.transitionDecisionId])uuid.parse(id);
   if(!backupEqual(facts.step.learningMaterializationIds,[event.detail.materializationId])||facts.step.protocolRunId!==eventRun.participants[event.targetId]?.protocolRunId||facts.action.protocolStepInstanceId!==facts.step.protocolStepInstanceId||facts.attempt.actionId!==facts.action.actionId||facts.observation.attemptId!==facts.attempt.attemptId||facts.evaluation.observationId!==facts.observation.observationId||facts.evaluation.protocolRunId!==facts.step.protocolRunId||facts.evaluation.evaluationPolicyId!==eventRun.protocolBinding.evaluationPolicyId||facts.transitionDecision.observationId!==facts.observation.observationId||!backupEqual(facts.observation.evidenceIds,facts.evidence.map((evidence:any)=>evidence.learningEvidenceId)))fail();
   for(const evidence of facts.evidence){uuid.parse(evidence.learningEvidenceId);if(evidence.observationId!==facts.observation.observationId||evidence.attemptId!==facts.attempt.attemptId||evidence.protocolRunId!==facts.step.protocolRunId||evidence.learningTargetId!==event.targetId)fail();}
  }
 }
 const active=maps.meta.get('learning-active');if(active)requireRow('learningRuns',active);if(active&&(localRunOpenPlanningInterruption(requireRow('learningRuns',active))||localRunTargetIds(requireRow('learningRuns',active)).some(id=>hasDeclaredMasteryOverride(requireRow('learningTargets',id)))))fail();for(const {key,value:run} of rows.learningRuns)if(!run.completedAt&&key!==active&&!localRunOpenPlanningInterruption(run))fail();
 const studyPlans=maps.settings.get('language-route-study-plans');if(studyPlans!==undefined){if(!studyPlans||typeof studyPlans!=='object'||Array.isArray(studyPlans))fail();for(const [routeId,plan] of Object.entries(studyPlans as Record<string,any>)){const route=routes.get(routeId);if(!route||plan.languageRouteId!==routeId||plan.routeRevision>route.revision)fail();z.number().int().positive().parse(plan.routeRevision);z.number().int().positive().parse(plan.revision);z.number().int().min(1).max(100).parse(plan.dailyNewSenseLimit);timestamp.parse(plan.updatedAt);}}
}

