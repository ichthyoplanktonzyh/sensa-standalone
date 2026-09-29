import {
  defaultSensaLanguageRouteCollection,
  sensaFormalPinnedLanguageContextSchema,
  sensaLanguageRouteCollectionSchema,
  sensaLearningMaterializationSnapshotSchema,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

import {localExecutableTargetForParticipant} from '../../learning/runtime/localCurriculum';
import {assertLocalTargetMaterialIdentity,localLearningPurpose,localProtocolActiveTargetId,localProtocolOutcomePermissions,localProtocolStepId,localRunOpenPlanningInterruption,localRunTargetIds,reduceLocalProtocolAction,replayLocalProtocolRun,validateLocalProtocolResources,type LocalLearningRun,type LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localRunBinding,localRunPolicy,localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {baseContentBeforeSupplement} from '../../contentSupply/provisioning/hybridMaterialization';
import {localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {validateLightweightInitialMaterialization} from '../../contentSupply/provisioning/lightweightInitialContent';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {personalLearningSceneRowId} from '../../personalContent/system/personalContentSystem';
import {backupEqual} from './backupCodec';
import type {BackupRows} from './backupValidation';
import type {LearningEvent} from './learning';
import {validateLearningReconciliationRows} from './learningReconciliation';
import {applyLocalProtocolTransition} from './learningSettlement';
import {packageInstallationSchema} from './packageRecords';
import {curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {LibraryIdentity,LibraryRecordTransition,Operation,Table} from './store';

type RequireRow=(table:Table,id:string)=>any;

export type LearningSystemStateInput={
 rows:BackupRows;
 maps:Record<Table,Map<string,any>>;
 identity:LibraryIdentity;
 routes:Map<string,any>;
 requireRow:RequireRow;
 requirePersonalSource:(source:any)=>unknown;
 validateLanguageContext:(value:unknown)=>any;
 operationInput:(id:string)=>any;
 fail:()=>never;
};

/** Learning owns history validation, deterministic replay, projection checks and reconciliation decisions. */
export function assertLearningSystemState(input:LearningSystemStateInput){
 const {rows,maps,identity,routes,requireRow,requirePersonalSource,validateLanguageContext,operationInput,fail}=input;
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 for(const {key,value:raw} of rows.curriculumEnrollments){
  const enrollment=curriculumEnrollmentSchema.parse(raw);
  if(key!==enrollment.id||enrollment.learnerUserId!==identity.learnerId)fail();
  validateLanguageContext(enrollment.languageContext);
  const operation=operationInput(enrollment.createdByOperationId);
  if(operation&&operation.kind!=='learning.enroll')fail();
  if(enrollment.source.kind==='portable_package'){
   const installation=packageInstallationSchema.parse(requireRow('packageInstallations',enrollment.source.packageKey));
   if(installation.artifact.packageId!==enrollment.source.packageId||installation.artifact.version!==enrollment.source.packageVersion)fail();
  }else{
   const archiveSha256=enrollment.source.publicationArchiveSha256;
   const members=rows.packageInstallations.map(row=>packageInstallationSchema.parse(row.value)).filter(item=>item.artifact.bookArchiveSha256===archiveSha256);
   if(members.length!==enrollment.source.memberCount)fail();
  }
 }
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
    const enrollment=requireRow('curriculumEnrollments',z.string().uuid().parse(membership.provenance.curriculumEnrollmentId));
    if(enrollment.learnerUserId!==identity.learnerId||enrollment.languageContext.languageRouteId!==context.languageRouteId)fail();
    const installation=packageInstallationSchema.parse(requireRow('packageInstallations',membership.packageKey));if(installation.artifact.targetLanguage!==context.targetLanguageTag||installation.artifact.supportLanguage!==context.supportLanguageTag)fail();
    const pack=maps.packageCache.get(membership.packageKey),entry=pack?.content.entries.find((candidate:any)=>candidate.senseVersionId===provenance.senseVersionId&&candidate.bindingVersionId===provenance.bindingVersionId);
    if(pack&&(!entry||pack.content.targetLanguage!==context.targetLanguageTag||pack.content.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag))||entry.assurancePackageKey!==membership.assurancePackageKey))fail();
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
    const participant=saved.participants[event.targetId]??fail(),target=requireRow('learningTargets',event.targetId),presented=participant.presentedMaterials?.[event.stepId];
    if(!ids.includes(event.targetId)||!presented||event.eventId!==stableUuid(`local-run-material-refresh:${saved.id}:${event.operationId}:${event.stepId}`))fail();
    const presentedPackageKey=typeof presented.snapshot.provenance.packageKey==='string'?presented.snapshot.provenance.packageKey:null,portablePack=presentedPackageKey?maps.packageCache.get(presentedPackageKey):undefined;
    if(portablePack?.portableOrigin){
     const packageKey=presentedPackageKey!,refreshedMembership=target.curriculumMemberships.find((candidate:any)=>candidate.packageKey===packageKey&&candidate.languageContext.languageRouteId===participant.languageContext.languageRouteId);
     const sourceMaterializationId=refreshedMembership?.material.snapshot.learningMaterializationId;
     const enrolled=operation?.kind==='learning.enroll'&&(operation.input.key===packageKey
      ||typeof operation.input.publicationArchiveSha256==='string'&&operation.input.publicationArchiveSha256===presented.snapshot.provenance.publicationArchiveSha256);
     if(!sourceMaterializationId||operation&&!enrolled||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
    }else{
     const membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===participant.curriculumMembershipId),attempt=requireRow('contentAttempts',event.operationId),task=requireRow('personalLearning',attempt.taskId),sourceMaterializationId=stableUuid(`sensa-personal-material:${event.operationId}`);
     if(attempt.status!=='ready'||task.targetId!==event.targetId||membership?.sourceKind!=='personal_meaning_alignment'||operation&&(operation.kind!=='personal.prepare'||attempt.taskId!==operation.input.id)||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
    }
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
     const materialPackageKey=z.string().min(1).parse(materialProvenance.packageKey??membership.packageKey),pack=requireRow('packageCache',materialPackageKey),entry=pack.content.entries.find((candidate:any)=>candidate.senseVersionId===materialProvenance.senseVersionId&&candidate.bindingVersionId===materialProvenance.bindingVersionId);
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
   if(Object.hasOwn(saved.targetCompletions,id)&&!progress.completed)fail();
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

const learningTransitionTables=[
 'curriculumEnrollments','learningTargets','learningRuns','learningEvents','learningReconciliations','meta','settings',
] as const satisfies readonly Table[];
type LearningTransitionTable=(typeof learningTransitionTables)[number];

export class LearningSystemInvariantError extends Error{
 constructor(message:string){super(message);this.name='LearningSystemInvariantError';}
}

export type LearningSystemTransitionInput={
 identity:LibraryIdentity;
 operation:Operation;
 changes:readonly LibraryRecordTransition<readonly LearningTransitionTable[]>[];
 read:(table:Table,key:string)=>Promise<unknown|undefined>;
};

const reject=(message:string):never=>{throw new LearningSystemInvariantError(message);};
const requireFact=<T>(value:T|null|undefined,message:string):T=>value??reject(message);
const unchangedExcept=(before:Record<string,unknown>,after:Record<string,unknown>,allowed:readonly string[])=>{
 const omitted=new Set(allowed);
 const project=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!omitted.has(key)));
 return backupEqual(project(before),project(after));
};
const changedByTable=(input:LearningSystemTransitionInput,table:LearningTransitionTable)=>
 input.changes.filter(change=>change.table===table);

async function transitionRoutes(input:LearningSystemTransitionInput){
 const raw=await input.read('settings','language-learning-routes');
 const collection=sensaLanguageRouteCollectionSchema.parse(raw??defaultSensaLanguageRouteCollection);
 return new Map(collection.routes.map(route=>[route.id,route]));
}

async function validateTransitionTarget(
 input:LearningSystemTransitionInput,
 key:string,
 target:LocalLearningTarget,
 routes:Awaited<ReturnType<typeof transitionRoutes>>,
):Promise<void>{
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 if(key!==target.id)reject('Learning Target row key does not match its identity.');
 learningPolicyProfileRegistry.get(localTargetPolicy(target));
 const assignment=target.policyAssignment;
 uuid.parse(assignment.assignmentId);z.number().int().positive().parse(assignment.revision);
 uuid.parse(assignment.assignedByOperationId);timestamp.parse(assignment.assignedAt);
 learningPolicyProfileRegistry.get(assignment.profileId);
 for(const field of ['learnerUserId','senseId','senseVersionId','senseExpressionBindingId','bindingVersionId','targetLanguageTag'] as const)z.string().min(1).parse(target.identity[field]);
 if(target.identity.learnerUserId!==input.identity.learnerId
  ||target.identity.targetLanguageTag!==target.targetLanguageTag
  ||target.id!==stableUuid(`sensa-learning-target:${input.identity.learnerId}:${target.identity.senseVersionId}:${target.identity.bindingVersionId}`)
  ||target.retentionId!==stableUuid(`sensa-retention:${target.id}`))reject('Learning Target identity is inconsistent.');
 timestamp.parse(target.createdAt);
 if(target.startedAt!==null)timestamp.parse(target.startedAt);
 if(target.completedAt!==null)timestamp.parse(target.completedAt);
 if(target.relearnAt!==null)timestamp.parse(target.relearnAt);
 z.number().int().nonnegative().parse(target.memoryRevision);
 if(target.committedPolicy){
  const commitment=target.committedPolicy;
  uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);
  z.number().int().positive().parse(commitment.revision);timestamp.parse(commitment.committedAt);
  const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion);
  if(!target.startedAt||commitment.assignmentId!==assignment.assignmentId||commitment.assignmentRevision!==assignment.revision||profile.profileId!==commitment.profileId)reject('Committed Learning Policy is inconsistent.');
 }else if(target.startedAt)reject('A started Learning Target must pin its policy.');
 z.array(z.object({kind:z.literal('declared_mastery'),source:z.literal('learner'),operationId:uuid,createdAt:timestamp}).strict()).max(1).parse(target.planningOverrides);
 if(!Array.isArray(target.curriculumMemberships)||!target.curriculumMemberships.length||new Set(target.curriculumMemberships.map(item=>item.id)).size!==target.curriculumMemberships.length)reject('Learning Target curriculum memberships are inconsistent.');
 for(const membership of target.curriculumMemberships){
  uuid.parse(membership.id);z.number().int().positive().parse(membership.revision);
  if(membership.status!==undefined&&!['active','superseded'].includes(membership.status))reject('Curriculum membership status is invalid.');
  uuid.parse(membership.createdByOperationId);timestamp.parse(membership.createdAt);timestamp.parse(membership.updatedAt);
  if(Date.parse(membership.updatedAt)<Date.parse(membership.createdAt))reject('Curriculum membership time moved backwards.');
  const context=sensaFormalPinnedLanguageContextSchema.parse(membership.languageContext),route=routes.get(context.languageRouteId);
  if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision||context.targetLanguageTag!==target.targetLanguageTag)reject('Curriculum membership Language Route is invalid.');
  sensaLearningMaterializationSnapshotSchema.parse(membership.material.snapshot);
  validateLightweightInitialMaterialization(membership.material);
  assertLocalTargetMaterialIdentity(target,membership.material);
  if(target.expression!==membership.material.content.resources.find(resource=>resource.materialRoleKey==='target_expression')?.contentPayload.surface)reject('Learning Target expression does not match its material.');
  const provenance=membership.material.snapshot.provenance as Record<string,any>;
  if(membership.sourceKind==='sense_learning_package'){
   const packageKey=requireFact(membership.packageKey,'Published Curriculum package identity is missing.');
   if(membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${context.languageRouteId}:sense_learning_package:${packageKey}`))reject('Published Curriculum membership identity is invalid.');
   const installation=packageInstallationSchema.parse(requireFact(await input.read('packageInstallations',packageKey),'Published Curriculum installation is missing.'));
   const enrollment=curriculumEnrollmentSchema.parse(requireFact(await input.read('curriculumEnrollments',z.string().uuid().parse(membership.provenance.curriculumEnrollmentId)),'Published Curriculum Enrollment is missing.'));
   if(enrollment.learnerUserId!==input.identity.learnerId||enrollment.languageContext.languageRouteId!==context.languageRouteId)reject('Published Curriculum Enrollment is inconsistent.');
   if(installation.artifact.targetLanguage!==context.targetLanguageTag||installation.artifact.supportLanguage!==context.supportLanguageTag)reject('Published Curriculum languages are inconsistent.');
   const pack=await input.read('packageCache',packageKey) as any;
   if(pack){
    const entry=pack.content.entries.find((candidate:any)=>candidate.senseVersionId===provenance.senseVersionId&&candidate.bindingVersionId===provenance.bindingVersionId);
    if(!entry||pack.content.targetLanguage!==context.targetLanguageTag||pack.content.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag))||entry.assurancePackageKey!==membership.assurancePackageKey)reject('Published Curriculum material is inconsistent.');
   }
  }else if(membership.sourceKind==='personal_meaning_alignment'){
   const attempt=requireFact(await input.read('contentAttempts',provenance.attemptId) as any,'Personal material attempt is missing.');
   const task=requireFact(await input.read('personalLearning',attempt.taskId) as any,'Personal learning preparation is missing.');
   const source=membership.provenance as Record<string,any>;
   if(membership.packageKey!==null||membership.assurancePackageKey!==undefined||task.targetId!==target.id||task.curriculumMembershipId!==membership.id||attempt.status!=='ready'||source.personalMeaningId!==task.source.personalMeaningId||source.alignmentId!==task.source.personalMeaningAlignmentId||source.personalMeaningRevisionId!==task.source.personalMeaningRevisionId||source.alignmentBasisReferenceId!==task.source.alignmentBasisReferenceId||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${context.languageRouteId}:personal_meaning_alignment:${source.alignmentId}`)||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag)))reject('Personal Curriculum membership is inconsistent.');
  }else reject('Unknown Curriculum membership source.');
 }
 if(target.introducedLanguageRouteId!==null&&!target.curriculumMemberships.some(membership=>membership.languageContext.languageRouteId===target.introducedLanguageRouteId))reject('Learning Target introduction Route is missing.');
}

function assertMembershipTransition(before:LocalLearningTarget,after:LocalLearningTarget,operation:Operation):void{
 const next=new Map(after.curriculumMemberships.map(membership=>[membership.id,membership]));
 if(next.size!==after.curriculumMemberships.length||before.curriculumMemberships.some(membership=>!next.has(membership.id)))reject('Curriculum memberships are append-only.');
 for(const previous of before.curriculumMemberships){
  const current=next.get(previous.id)!;
  if(backupEqual(previous,current))continue;
  if(current.revision!==previous.revision+1||!unchangedExcept(previous as unknown as Record<string,unknown>,current as unknown as Record<string,unknown>,['revision','status','material','updatedAt']))reject('Curriculum membership revision is invalid.');
  if(operation.kind==='learning.enroll'&&!backupEqual(previous.material,current.material))reject('A Book update cannot rewrite historical material.');
  if(operation.kind==='personal.progress'&&previous.status!==current.status)reject('Personal material refresh cannot change membership lifecycle.');
 }
}

function assertTargetTransition(before:LocalLearningTarget|null,after:LocalLearningTarget,operation:Operation,hasLearningEvent:boolean,newRunTargetIds:ReadonlySet<string>):void{
 if(!before){
  if(!['learning.enroll','learning.materialize','learning.quantity','personal.progress'].includes(operation.kind))reject('Only Curriculum admission may create a Learning Target.');
  if(after.policyAssignment.revision!==1||after.committedPolicy||after.startedAt||after.completedAt||after.memory||after.memoryRevision!==0||after.relearnAt||after.relearningState!==null)reject('A new Learning Target contains manufactured progress.');
  return;
 }
 if(!backupEqual(before.id,after.id)||!backupEqual(before.retentionId,after.retentionId)||!backupEqual(before.identity,after.identity)||before.expression!==after.expression||before.targetLanguageTag!==after.targetLanguageTag||before.createdAt!==after.createdAt)reject('Learning Target identity is immutable.');
 if(after.curriculumMemberships.length<before.curriculumMemberships.length)reject('Curriculum membership history cannot shrink.');
 assertMembershipTransition(before,after,operation);
 if(['learning.enroll','learning.materialize','learning.quantity','personal.progress'].includes(operation.kind)){
  if(!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['curriculumMemberships']))reject('Curriculum admission changed Learning progress.');
  return;
 }
 if(operation.kind==='learning.policy'){
  if(before.startedAt||after.policyAssignment.assignmentId!==before.policyAssignment.assignmentId||after.policyAssignment.revision!==before.policyAssignment.revision+1||!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['policyAssignment']))reject('Learning Policy assignment transition is invalid.');
  return;
 }
 if(operation.kind==='learning.declareMastery'){
  const command=operation.input as any,active=after.planningOverrides.length===1;
  if(command.targetId!==after.id||command.active!==active||!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['planningOverrides']))reject('Declared Mastery transition is invalid.');
  return;
 }
 if(operation.kind==='learning.start'||operation.kind==='learning.continue'){
  if(!newRunTargetIds.has(after.id)||(before.startedAt===null&&after.startedAt===null)||(before.startedAt!==null&&after.startedAt!==before.startedAt)||(before.committedPolicy&&!backupEqual(before.committedPolicy,after.committedPolicy))||!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['committedPolicy','startedAt','introducedLanguageRouteId']))reject('Learning Run start changed unrelated Target facts.');
  return;
 }
 if(operation.kind==='learning.act'){
  if(!hasLearningEvent)reject('Learning projection changed without an Event.');
  return;
 }
 reject('Unsupported Learning Target transition.');
}

async function assertCurriculumEnrollmentTransition(
 input:LearningSystemTransitionInput,
 change:LibraryRecordTransition<readonly LearningTransitionTable[]>,
 routes:Awaited<ReturnType<typeof transitionRoutes>>,
):Promise<void>{
 if(change.after===null)reject('Curriculum Enrollments cannot be deleted.');
 if(input.operation.kind!=='learning.enroll')reject('Only Book enrollment may change Curriculum Enrollment facts.');
 const after=curriculumEnrollmentSchema.parse(change.after) as LocalCurriculumEnrollment;
 if(change.key!==after.id||after.learnerUserId!==input.identity.learnerId||after.status!=='active')reject('Curriculum Enrollment identity is invalid.');
 const route=routes.get(after.languageContext.languageRouteId);
 if(!route||route.targetLanguageTag!==after.languageContext.targetLanguageTag||after.languageContext.languageRouteRevision>route.revision)reject('Curriculum Enrollment Language Route is invalid.');
 if(change.before!==null){
  const before=curriculumEnrollmentSchema.parse(change.before) as LocalCurriculumEnrollment;
  if(before.id!==after.id||before.learnerUserId!==after.learnerUserId||before.createdAt!==after.createdAt||before.createdByOperationId!==after.createdByOperationId||after.revision!==before.revision+1)reject('Curriculum Enrollment revision is invalid.');
 }
 if(after.source.kind==='portable_package'){
  const installation=packageInstallationSchema.parse(requireFact(await input.read('packageInstallations',after.source.packageKey),'Curriculum package installation is missing.'));
  if(installation.artifact.packageId!==after.source.packageId||installation.artifact.version!==after.source.packageVersion)reject('Curriculum package source is inconsistent.');
 }else{
  // Each materialized member is checked again at the Learning Target boundary.
  z.string().regex(/^[a-f0-9]{64}$/u).parse(after.source.publicationArchiveSha256);
 }
}

async function validateTransitionRun(
 input:LearningSystemTransitionInput,
 key:string,
 run:LocalLearningRun,
 routes:Awaited<ReturnType<typeof transitionRoutes>>,
):Promise<void>{
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 if(key!==run.id)reject('Learning Run row key does not match its identity.');
 uuid.parse(run.id);timestamp.parse(run.startedAt);if(run.completedAt!==null)timestamp.parse(run.completedAt);
 z.number().int().positive().parse(run.ordinal);z.number().int().positive().parse(run.revision);
 const context=sensaFormalPinnedLanguageContextSchema.parse(run.languageContext),route=routes.get(context.languageRouteId);
 if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision)reject('Learning Run Language Route is invalid.');
 const ids=localRunTargetIds(run);
 if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(run.targetId)||!backupEqual(Object.keys(run.participants).sort(),[...ids].sort())||!Object.keys(run.targetCompletions).every(id=>ids.includes(id)))reject('Learning Run participants are inconsistent.');
 const execution=localExecutionForRun(run),binding=localRunBinding(run),profile=learningPolicyProfileRegistry.get(localRunPolicy(run),run.policyProfileVersion);
 if(!backupEqual(run.protocolBinding,profile.protocols[run.purpose])||!backupEqual(run.schedulingPolicy,profile.lifecycle.schedulingPolicy)||run.schedulingPolicyId!==profile.lifecycle.schedulingPolicyId||run.learnerVisibleClaimBoundary!==profile.lifecycle.learnerVisibleClaimBoundary||run.protocolVersion!==binding.localProtocolVersion)reject('Learning Run pinned policy is inconsistent.');
 for(const [targetId,participant] of Object.entries(run.participants)){
  const target=requireFact(await input.read('learningTargets',targetId) as LocalLearningTarget|undefined,'Learning Run Target is missing.');
  const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId);
  if(!membership||!backupEqual(participant.languageContext,context))reject('Learning Run participant membership is inconsistent.');
  uuid.parse(participant.protocolRunId);validateLightweightInitialMaterialization(participant.material);assertLocalTargetMaterialIdentity(target,participant.material);
  for(const [stepId,material] of Object.entries(participant.presentedMaterials)){if(!stepId.trim())reject('Learning Step identity is empty.');validateLightweightInitialMaterialization(material);assertLocalTargetMaterialIdentity(target,material);}
  const commitment=participant.policyCommitment,plan=participant.resolvedPlan;
  uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);uuid.parse(plan.resolvedLearningPlanRevisionId);
  const invalidParticipant=[
   !backupEqual(commitment,target.committedPolicy)&&'commitment',
   plan.learningTargetId!==targetId&&'target',
   plan.retentionTargetId!==target.retentionId&&'retention',
   plan.purpose!==run.purpose&&'purpose',
   plan.profileId!==commitment.profileId&&'profile',
   plan.profileVersion!==commitment.profileVersion&&'profile_version',
   plan.readiness!=='ready'&&'readiness',
   !backupEqual(plan.protocolBinding,run.protocolBinding)&&'protocol',
   !backupEqual(plan.contentDemands,run.protocolBinding.contentDemands)&&'demands',
   !backupEqual(plan.learningMaterializationIds,[participant.material.snapshot.learningMaterializationId])&&'materialization',
   participant.progress.protocolRunId!==participant.protocolRunId&&'progress_run',
   participant.progress.protocolId!==run.protocolBinding.protocolId&&'progress_protocol',
   participant.progress.protocolVersion!==run.protocolBinding.protocolVersion&&'progress_version',
   Object.hasOwn(run.targetCompletions,targetId)&&!participant.progress.completed&&'progress_completion',
   participant.startReason.triggerAt!==run.startedAt&&'start_clock',
   participant.startReason.triggerMemoryRevision!==participant.memoryRevision&&'start_memory_revision',
   !backupEqual(participant.outcomePermissions,localProtocolOutcomePermissions(run.purpose,run.protocolBinding))&&'outcome_permissions',
   target.startedAt!==null&&commitment.committedByProtocolRunId===participant.protocolRunId&&target.startedAt!==run.startedAt&&'target_start_clock',
  ].filter(Boolean);
  if(invalidParticipant.length)reject(`Learning Run participant authority is inconsistent: ${invalidParticipant.join(',')}.`);
  const executable=localExecutableTargetForParticipant(target,participant),pack=executable.packageKey?await input.read('packageCache',executable.packageKey) as any:undefined;
  validateLocalProtocolResources(execution,executable,pack);
 }
}

function validateEventFacts(event:LearningEvent,run:LocalLearningRun):void{
 const uuid=z.string().uuid(),facts=event.detail.formalEvaluation;
 if(!facts)return;
 for(const id of [facts.step.protocolStepInstanceId,facts.step.protocolRunId,facts.action.actionId,facts.attempt.attemptId,facts.observation.observationId,facts.evaluation.evaluationId,facts.transitionDecision.transitionDecisionId])uuid.parse(id);
 if(!backupEqual(facts.step.learningMaterializationIds,[event.detail.materializationId])||facts.step.protocolRunId!==run.participants[event.targetId]?.protocolRunId||facts.action.protocolStepInstanceId!==facts.step.protocolStepInstanceId||facts.attempt.actionId!==facts.action.actionId||facts.observation.attemptId!==facts.attempt.attemptId||facts.evaluation.observationId!==facts.observation.observationId||facts.evaluation.protocolRunId!==facts.step.protocolRunId||facts.evaluation.evaluationPolicyId!==run.protocolBinding.evaluationPolicyId||facts.transitionDecision.observationId!==facts.observation.observationId||!backupEqual(facts.observation.evidenceIds,facts.evidence.map(evidence=>evidence.learningEvidenceId)))reject('Learning Event evaluation chain is inconsistent.');
 for(const evidence of facts.evidence){uuid.parse(evidence.learningEvidenceId);if(evidence.observationId!==facts.observation.observationId||evidence.attemptId!==facts.attempt.attemptId||evidence.protocolRunId!==facts.step.protocolRunId||evidence.learningTargetId!==event.targetId)reject('Learning Evidence identity is inconsistent.');}
}

async function assertActionTransition(
 input:LearningSystemTransitionInput,
 event:LearningEvent,
 runChange:LibraryRecordTransition<readonly LearningTransitionTable[]>,
 targetChange:LibraryRecordTransition<readonly LearningTransitionTable[]>|undefined,
):Promise<void>{
 const beforeRun=requireFact(runChange.before as LocalLearningRun|null,'Learning Event has no prior Run.');
 const afterRun=requireFact(runChange.after as LocalLearningRun|null,'Learning Event deleted its Run.');
 const command=input.operation.input as any;
  if(input.operation.kind!=='learning.act'||input.operation.id!==event.id||event.runId!==runChange.key||command.runId!==event.runId||command.at!==event.at||!backupEqual(command.action,event.detail.action))reject('Learning Event does not match its command.');
 const execution=localExecutionForRun(beforeRun),targetId=localProtocolActiveTargetId(execution,beforeRun),stepId=localProtocolStepId(execution,beforeRun);
 const beforeTarget=(targetChange?.before??await input.read('learningTargets',targetId)) as LocalLearningTarget|undefined;
 const afterTarget=(targetChange?.after??await input.read('learningTargets',targetId)) as LocalLearningTarget|undefined;
 if(!beforeTarget||!afterTarget||event.targetId!==targetId||event.detail.stepId!==stepId||beforeRun.completedAt)reject('Learning Event points at the wrong Run step.');
 const priorTarget=requireFact(beforeTarget,'Learning Event prior Target is missing.'),nextTarget=requireFact(afterTarget,'Learning Event Target projection is missing.');
 const participant=beforeRun.participants[targetId],presented=participant?.presentedMaterials[stepId];
 if(!participant||!presented||event.kind!==event.detail.action.kind||event.detail.materializationId!==presented.snapshot.learningMaterializationId||Date.parse(event.at)<Date.parse(beforeRun.startedAt))reject('Learning Event materialization is inconsistent.');
 if(event.detail.personalLearningScene!==null){
  const pinned=z.object({sceneId:z.string().uuid(),revisionId:z.string().uuid(),revision:z.number().int().positive()}).strict().parse(event.detail.personalLearningScene);
  const scene=await input.read('annotations',personalLearningSceneRowId(targetId,participant.languageContext.languageRouteId)) as any;
  const revision=scene?.kind==='learning_scene'&&scene.sceneId===pinned.sceneId?scene.revisions.find((candidate:any)=>candidate.revisionId===pinned.revisionId):undefined;
  if(!revision||revision.revision!==pinned.revision||revision.createdAt>Date.parse(event.at))reject('Learning Event scene reference is inconsistent.');
 }
 const executable=localExecutableTargetForParticipant(priorTarget,participant,presented),pack=executable.packageKey?await input.read('packageCache',executable.packageKey) as any:undefined;
 validateLocalProtocolResources(execution,executable,pack);
 const executed=reduceLocalProtocolAction({operationId:event.id,stepKey:stepId,execution,target:executable,run:beforeRun,resource:pack,action:event.detail.action,at:event.at});
 const applied=applyLocalProtocolTransition({operationId:event.id,stepId,at:event.at,target:priorTarget,run:executed.run,transition:executed.transition});
 if(!backupEqual(executed.facts,event.detail.formalEvaluation)||!backupEqual(applied.record,event.detail.transition)||!backupEqual(applied.target,nextTarget))reject('Learning Event settlement does not reproduce its Target projection.');
 const expected=structuredClone(executed.run);expected.ordinal++;expected.revision++;
 if(!expected.completedAt){
  const nextTargetId=localProtocolActiveTargetId(execution,expected),nextStepId=localProtocolStepId(execution,expected);
  const expectedParticipant=expected.participants[nextTargetId],actualParticipant=afterRun.participants[nextTargetId];
  if(expectedParticipant&&!expectedParticipant.presentedMaterials[nextStepId]){
   const material=actualParticipant?.presentedMaterials[nextStepId];
   if(!material)reject('The next Learning Step has no pinned material.');
   validateLightweightInitialMaterialization(material);
   assertLocalTargetMaterialIdentity(requireFact(await input.read('learningTargets',nextTargetId) as LocalLearningTarget|undefined,'The next Learning Target is missing.'),material);
   expectedParticipant.presentedMaterials[nextStepId]=structuredClone(material);
  }
 }
 if(!backupEqual(expected,afterRun))reject('Learning Event does not reproduce its Run projection.');
 validateEventFacts(event,afterRun);
}

async function assertLifecycleRunTransition(input:LearningSystemTransitionInput,before:LocalLearningRun,after:LocalLearningRun):Promise<void>{
 if(before.completedAt)reject('A completed Learning Run is immutable.');
 if(after.revision!==before.revision+1||after.ordinal!==before.ordinal||after.lifecycleEvents.length!==before.lifecycleEvents.length+1||!backupEqual(before.lifecycleEvents,after.lifecycleEvents.slice(0,-1)))reject('Learning Run lifecycle revision is invalid.');
 const event=after.lifecycleEvents.at(-1)!;
 if(!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['revision','lifecycleEvents','participants']))reject('Learning Run lifecycle changed unrelated facts.');
 if(event.kind==='interrupted_by_planning_override'){
  const command=input.operation.input as any;
  if(event.operationId!==input.operation.id||input.operation.kind!=='learning.declareMastery'||command.active!==true||command.targetId!==event.targetId||event.overrideKind!=='declared_mastery'||event.at!==command.at||!backupEqual(before.participants,after.participants))reject('Learning Run interruption is invalid.');
 }else if(event.kind==='resumed_after_planning_override'){
  const command=input.operation.input as any,open=localRunOpenPlanningInterruption(before);
  if(event.operationId!==input.operation.id||!['learning.start','learning.continue'].includes(input.operation.kind)||!open||event.interruptionEventId!==open.eventId||event.at!==command.at||!backupEqual(before.participants,after.participants))reject('Learning Run resume is invalid.');
 }else if(event.kind==='current_step_material_refreshed'){
  const command=input.operation.input as any;
  const refreshed=after.participants[event.targetId]?.presentedMaterials[event.stepId];
  const personal=input.operation.kind==='personal.progress'&&event.operationId===command.attemptId;
  const portable=input.operation.kind==='learning.enroll'&&event.operationId===input.operation.id
   &&(command.key===refreshed?.snapshot.provenance.packageKey
    ||typeof command.publicationArchiveSha256==='string'&&command.publicationArchiveSha256===refreshed?.snapshot.provenance.publicationArchiveSha256);
  if(!personal&&!portable||event.eventId!==stableUuid(`local-run-material-refresh:${after.id}:${event.operationId}:${event.stepId}`)||event.materializationId!==refreshed?.snapshot.learningMaterializationId)reject('Learning Run material refresh is invalid.');
  const normalized=structuredClone(after),previousMaterial=before.participants[event.targetId]?.presentedMaterials[event.stepId];
  if(!previousMaterial||!normalized.participants[event.targetId])reject('Learning Run material refresh has no prior Step material.');
  normalized.participants[event.targetId]!.presentedMaterials[event.stepId]=structuredClone(previousMaterial);
  if(!backupEqual({...normalized,revision:before.revision,lifecycleEvents:before.lifecycleEvents},before))reject('Learning Run material refresh changed unrelated facts.');
 }else reject('Unknown Learning Run lifecycle event.');
}

function assertStudyPlanTransition(change:LibraryRecordTransition<readonly LearningTransitionTable[]>,operation:Operation,routes:Awaited<ReturnType<typeof transitionRoutes>>):void{
 const before=(change.before??{}) as Record<string,any>,after=requireFact(change.after as Record<string,any>|null,'Study Plans cannot be deleted.');
 if(operation.kind!=='learning.quantity')reject('Only the quantity command may change Study Plans.');
 const changed=Object.keys(after).filter(routeId=>!backupEqual(before[routeId],after[routeId]));
 if(changed.length!==1||Object.keys(before).some(routeId=>!Object.hasOwn(after,routeId)))reject('Study Plan history is inconsistent.');
 const routeId=changed[0]!,plan=after[routeId],previous=before[routeId],route=routes.get(routeId);
 if(!route||plan.languageRouteId!==routeId||plan.routeRevision>route.revision||plan.revision!==(previous?.revision??0)+1||!Number.isInteger(plan.dailyNewSenseLimit)||plan.dailyNewSenseLimit<1||plan.dailyNewSenseLimit>100||!Number.isFinite(Date.parse(plan.updatedAt)))reject('Study Plan revision is invalid.');
}

/**
 * Admits one locally proposed Learning System transaction. Only changed facts
 * and their direct dependencies are read; complete history replay remains the
 * state-admission path used by Sync and backup restore.
 */
export async function assertLearningSystemTransition(input:LearningSystemTransitionInput):Promise<void>{
 const relevant=input.changes.filter(change=>change.table!=='meta'||change.key==='learning-active').filter(change=>change.table!=='settings'||change.key==='language-route-study-plans');
 if(!relevant.length)return;
 const routes=await transitionRoutes(input);
 const targets=changedByTable({...input,changes:relevant},'learningTargets');
 const enrollments=changedByTable({...input,changes:relevant},'curriculumEnrollments');
 const runs=changedByTable({...input,changes:relevant},'learningRuns');
 const events=changedByTable({...input,changes:relevant},'learningEvents');
 const reconciliations=changedByTable({...input,changes:relevant},'learningReconciliations');
 if(reconciliations.length)reject('Learning Reconciliation is created only by replica merge.');
 if(events.length>1)reject('A local command may append only one Learning Event.');
 for(const change of [...enrollments,...targets,...runs,...events])if(change.after===null)reject(`${change.table} facts cannot be physically deleted.`);
 for(const change of enrollments)await assertCurriculumEnrollmentTransition(input,change,routes);
 for(const change of events)if(change.before!==null)reject('Learning Events are append-only.');
 const newRunTargetIds=new Set(runs.filter(change=>change.before===null).flatMap(change=>localRunTargetIds(change.after as LocalLearningRun)));
 for(const change of targets){
  const after=requireFact(change.after as LocalLearningTarget|null,'Learning Target is missing.');
  await validateTransitionTarget(input,change.key,after,routes);
  assertTargetTransition(change.before as LocalLearningTarget|null,after,input.operation,events.length>0,newRunTargetIds);
 }
 for(const change of runs)await validateTransitionRun(input,change.key,requireFact(change.after as LocalLearningRun|null,'Learning Run is missing.'),routes);
 if(events.length){
  const eventChange=events[0]!,event=eventChange.after as LearningEvent;
  if(eventChange.key!==event.id)reject('Learning Event row key does not match its identity.');
  const runChange=runs.find(change=>change.key===event.runId)??reject('Learning Event did not revise its Run.');
  const targetChange=targets.find(change=>change.key===event.targetId);
  await assertActionTransition(input,event,runChange,targetChange);
  if(runs.length!==1)reject('One Learning Event may revise only its own Run.');
 }else for(const change of runs){
  const after=change.after as LocalLearningRun;
  if(change.before===null){
   if(!['learning.start','learning.continue'].includes(input.operation.kind)||after.revision!==1||after.ordinal!==1||after.lifecycleEvents.length)reject('New Learning Run authority is invalid.');
   const primary=requireFact(await input.read('learningTargets',after.targetId) as LocalLearningTarget|undefined,'Learning Run primary Target is missing.'),participant=after.participants[after.targetId];
   const execution=localExecutionForRun(after),executable=localExecutableTargetForParticipant(primary,participant),pack=executable.packageKey?await input.read('packageCache',executable.packageKey) as any:undefined;
   const replayed=replayLocalProtocolRun({execution,target:executable,resource:pack,saved:after});
   if(!backupEqual(replayed,after))reject('New Learning Run cannot be deterministically replayed.');
  }else await assertLifecycleRunTransition(input,change.before as LocalLearningRun,after);
 }
 for(const change of relevant.filter(item=>item.table==='settings'))assertStudyPlanTransition(change,input.operation,routes);
 const activeChange=relevant.find(change=>change.table==='meta'&&change.key==='learning-active');
 if(activeChange?.after===null&&!['learning.finish','learning.continue','learning.declareMastery'].includes(input.operation.kind))reject('Only Learning lifecycle commands may clear the active Run.');
 if(activeChange&&activeChange.after!==null){
  if(!['learning.start','learning.continue'].includes(input.operation.kind))reject('Only Learning start commands may select an active Run.');
  const run=requireFact(await input.read('learningRuns',String(activeChange.after)) as LocalLearningRun|undefined,'Active Learning Run is missing.');
  if(localRunOpenPlanningInterruption(run))reject('Active Learning Run is interrupted.');
  for(const id of localRunTargetIds(run))if(hasDeclaredMasteryOverride(requireFact(await input.read('learningTargets',id) as LocalLearningTarget|undefined,'Active Learning Target is missing.')))reject('Active Learning Run has an excluded Target.');
 }
}

export {learningTransitionTables};
