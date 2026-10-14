import {replicaWork} from './replicaWork';
import {assertSavedLearningEvent,assertSavedRunState,savedRetentionStateSchema} from './savedLearningState';
import {stableLearningTargetId,materialSourcePin,sameLearningSourcePin} from '../../learning/runtime/learningIdentity';
import {
  defaultSensaLanguageRouteCollection,
  sensaFormalPinnedLanguageContextSchema,
  sensaLanguageRouteCollectionSchema,
  sensaLearningMaterializationSnapshotSchema,
} from '@sensa/contracts/sensa';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {z} from 'zod';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import {assertReadyContentAttempt} from './contentAttemptEvidence';

import {localExecutableTargetForParticipant} from '../../learning/runtime/localCurriculum';
import {assertLocalTargetMaterialIdentity,localLearningPurpose,localProtocolActiveTargetId,localProtocolOutcomePermissions,localProtocolStepId,localRunOpenPlanningInterruption,localRunTargetIds,reduceLocalProtocolAction,replayLocalProtocolRun,validateLocalProtocolResources,type LocalLearningRun,type LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localRunBinding,localRunPolicy,localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {baseContentBeforeSupplement} from '../../contentSupply/provisioning/hybridMaterialization';
import {localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {validateLightweightInitialMaterialization} from '../../contentSupply/provisioning/lightweightInitialContent';
import {materialReadyAt} from '../../contentSupply/provisioning/materialReadiness';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {personalLearningSceneRowId} from '../../personalContent/system/personalContentSystem';
import {findSceneRevision} from '../../personalContent/system/sceneConflictHistory';
import {backupEqual,encodeBackupValue} from './backupCodec';
import {retentionBaseline,retentionReplayFields,initialRetentionBaseline,type LocalRetentionBaseline} from '../../learning/runtime/retentionBaseline';
import {findLibraryRow,everyLibraryRow,type LibraryRecordRows,type LibraryRecordLookups} from './libraryRecordReader';
import type {LearningEvent,LearningStepPresentation} from './learning';
import {validateLearningReconciliationRecordSteps,validateSavedLearningReconciliationSteps} from './learningReconciliation';
import {applyLocalProtocolTransition} from './learningSettlement';
import {packageInstallationSchema} from './packageRecords';
import {assertPublishedCurriculumSource,publishedMaterialMembership} from './publishedCurriculumSources';
import {curriculumEnrollmentSchema,assertDirectEnrollmentSource,assertOneActiveBookSteps,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import {assertResolvedBookRange} from './bookPlans';
import {resolveDirectLearningSource,directLearningReferenceSchema} from '../../learning/system/directLearningSource';
import {assertDirectTaskEnrollment,assertDirectAttemptSource} from './directProvisioningAssertions';
import type {LibraryIdentity,LibraryRecordTransition,Operation,Table} from './store';
import {localRunOpenSessionPause,localRunSessionIntent} from '../../learning/runtime/localProtocol';
import {verifyLearningRunReceiptFacts,verifyLearningSelectionWitness,lawfulLearningPredecessor,assertLearningContinuationPurpose,sameLearningSessionDirection} from './learningCommandReceipt';
import {runMaterial,runBaselineMaterial,runStepMaterial,runMaterialById,pinRunStepMaterial,validateRunMaterialPins} from '../../learning/runtime/runMaterialPins';
import {studyScopeSchema,learningSessionSchema,activeLearningSessionKey,type LocalStudyScope,type LocalStudyScopeMember,type LocalLearningSession} from './studyScopes';
import type {LearningPolicyId} from '../../learning/runtime/policyProfiles';
import {curriculumSourceEligibility} from '../../learning/runtime/curriculumEligibility';
import {supplementalMembershipStateSchema,supplementalSourceDescriptor,assertSupplementalStateSource,type SupplementalMembershipState} from './supplementalMemberships';
import {DEFAULT_DAILY_NEW_SENSE_LIMIT} from './studyPlans';
import {runSynchronously} from '../../experience/personalMeaningJourney/cooperative';

type RequireRow=(table:Table,id:string)=>any;

function assertMaterialAdmissionTime(material:ReturnType<typeof runBaselineMaterial>,membership:LocalLearningTarget['curriculumMemberships'][number],attempt?:any):void{
 materialReadyAt(material);
 const ready=material.snapshot.provenance.sourceReadyAt as string;
 if(Date.parse(ready)<Date.parse(membership.createdAt)||Date.parse(ready)>Date.parse(membership.updatedAt))reject('Learning material was not admitted by its Curriculum source at that instant.');
 if(!membership.packageKey){
  assertReadyContentAttempt(attempt);
  if(attempt.status!=='ready'||attempt.readyAt!==ready)reject('Learning material differs from its Content Attempt admission time.');
 }
}

function assertRunMaterialPresentedBy(material:ReturnType<typeof runBaselineMaterial>,run:LocalLearningRun,at:string):void{
 materialReadyAt(material);
 const created=Date.parse(material.snapshot.createdAt),presented=Date.parse(at);
 if(!Number.isFinite(presented)||created<Date.parse(run.startedAt)||created>presented)reject('Learning material did not exist at its presentation.');
}

/** The Action witnesses the binding created at its successor, not whatever
 * the final saved map happens to contain after later material refreshes. */
function replayNextPresentation(run:LocalLearningRun,execution:ReturnType<typeof localExecutionForRun>,witness:LearningStepPresentation|null,source:LocalLearningRun,at:string):void{
 if(run.completedAt){if(witness!==null)reject('A completed Learning Run cannot present another Step.');return;}
 const next=z.object({targetId:z.string().uuid(),stepId:z.string().min(1),material:z.string().regex(/^[a-f0-9]{64}$/u)}).strict().parse(witness);
 const targetId=localProtocolActiveTargetId(execution,run),stepId=localProtocolStepId(execution,run),participant=run.participants[targetId];
 if(next.targetId!==targetId||next.stepId!==stepId||!participant||participant.presentedMaterials[stepId]&&participant.presentedMaterials[stepId]!==next.material)reject('Learning successor presentation differs from its Protocol Step.');
 const material=runMaterial(source.participants[targetId]!,next.material);
 assertRunMaterialPresentedBy(material,run,at);
 pinRunStepMaterial(participant,stepId,material);
}

function baselineBindsSelectedMembership(run:LocalLearningRun,target:LocalLearningTarget,participant:LocalLearningRun['participants'][string]):boolean{
 const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId),material=runBaselineMaterial(participant),provenance=material.snapshot.provenance;
 if(!membership||material.snapshot.createdAt!==run.startedAt||(provenance.packageKey??null)!==membership.packageKey)return false;
 if(typeof provenance.curriculumMembershipId==='string'&&provenance.curriculumMembershipId!==membership.id)return false;
 const supplement=provenance.resourceSupplement as {operationId?:string}|undefined;
 const sourceId=supplement?.operationId?stableUuid(`supplement-material:${supplement.operationId}`):provenance.packageKey
  ?stableUuid(`sensa-material:${target.identity.learnerUserId}:${provenance.packageKey}:${target.id}${typeof provenance.curriculumMembershipId==='string'?`:${provenance.curriculumMembershipId}`:''}${typeof provenance.materializationOperationId==='string'?`:${provenance.materializationOperationId}`:''}`)
  :typeof provenance.attemptId==='string'?stableUuid(`sensa-personal-material:${provenance.attemptId}`):null;
 return sourceId!==null&&material.snapshot.learningMaterializationId===stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceId}`);
}
const samePinnedDirection=(left:any,right:any)=>left?.languageRouteId===right?.languageRouteId&&left?.targetLanguageTag===right?.targetLanguageTag&&left?.supportLanguageTag===right?.supportLanguageTag;

function assertDirectPublishedMembership(enrollment:LocalCurriculumEnrollment,target:LocalLearningTarget,membership:LocalLearningTarget['curriculumMemberships'][number],archiveDigest:string):void{
 if(enrollment.source.kind!=='stable_sense'||membership.sourceKind!=='stable_sense'||membership.provenance.kind!=='stable_sense')return reject('Direct membership source is inconsistent.');
 const {selection}=enrollment.source,reference=selection.reference;
 if(!selection.publishedContent||selection.publishedContent.packageKey!==membership.packageKey||selection.publishedContent.archiveDigest!==archiveDigest
   ||membership.material.snapshot.provenance.packageKey!==membership.packageKey||membership.material.snapshot.provenance.packageDigest!==archiveDigest
   ||!backupEqual(membership.languageContext,enrollment.languageContext)
   ||reference.senseId!==target.identity.senseId||reference.expressionId!==target.identity.expressionId||!sameLearningSourcePin(reference,materialSourcePin(membership.material))
   ||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${membership.languageContext.languageRouteId}:stable_sense:${enrollment.id}`))reject('Direct membership differs from the explicitly selected connection.');
}
function assertDirectGeneratedMembership(enrollment:LocalCurriculumEnrollment,target:LocalLearningTarget,membership:LocalLearningTarget['curriculumMemberships'][number],task:any,attempt:any):void{
 const selection=assertDirectTaskEnrollment(task,enrollment),provenance=membership.material.snapshot.provenance;
 assertDirectAttemptSource(attempt,task,selection,target.identity.learnerUserId);
 if(membership.sourceKind!=='stable_sense'||membership.packageKey!==null||membership.assurancePackageKey!==undefined||task.status!=='ready'||task.targetId!==target.id||task.curriculumMembershipId!==membership.id
   ||membership.provenance.kind!=='stable_sense'||provenance.kind!=='stable_sense'||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${membership.languageContext.languageRouteId}:stable_sense:${enrollment.id}`)
   ||selection.reference.senseId!==target.identity.senseId||selection.reference.expressionId!==target.identity.expressionId||!sameLearningSourcePin(selection.reference,materialSourcePin(membership.material))
   ||membership.provenance.curriculumEnrollmentId!==enrollment.id||membership.provenance.sourceDigest!==selection.sourceDigest
   ||provenance.curriculumEnrollmentId!==enrollment.id||provenance.sourceDigest!==selection.sourceDigest||membership.material.snapshot.personalAnchorUseGrantIds.length
   ||!backupEqual(membership.languageContext,enrollment.languageContext)||attempt.taskId!==task.id||attempt.status!=='ready'
   ||!(attempt.review?.accepted||(attempt.reviewProvider===null&&attempt.review===null&&attempt.validation?.review===null&&attempt.validation?.validations?.length>0&&attempt.validation.validations.every((validation:any)=>validation.status==='accepted')))
   ||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(membership.material,membership.languageContext.supportLanguageTag)))reject('Direct generated membership was not admitted from its fixed source.');
}

export type LearningSystemStateInput={
 rows:LibraryRecordRows;
 maps:LibraryRecordLookups;
 identity:LibraryIdentity;
 routes:Map<string,any>;
 requireRow:RequireRow;
 requirePersonalSource:(source:any)=>unknown;
 validateLanguageContext:(value:unknown)=>any;
 operationInput:(id:string)=>any;
 fail:()=>never;
 /** Only immutable, decoded-once admission inputs may reuse content validation. */
 validateMaterial?:typeof validateLightweightInitialMaterialization;
 /** Snapshot-scoped identity and Session-switch predicates, never a history closure. */
 syncScope?:{
  assertProtocolOwner:(protocolId:string,runId:string,targetId:string)=>void;
  hasProtocolRunId:(protocolId:string,targetId:string)=>boolean;
  sessionStarted:(operationId:string,at:string,exceptId:string)=>boolean;
 };
};

/** Stored identity and direct pins, without proving historical outcomes. */
function assertSavedEventReferences(input:LearningSystemStateInput,event:LearningEvent,eventRun:LocalLearningRun):void{
 const {identity,requireRow,operationInput,fail}=input;const uuid=z.string().uuid();
   try{assertSavedLearningEvent(event,eventRun,identity.learnerId,requireRow('learningTargets',event.targetId).retentionId,fail);}catch{fail();}
   const operation=operationInput(event.id),participant=eventRun.participants[event.targetId]??fail(),presented=runStepMaterial(participant,event.detail.stepId);if(event.detail.materializationId!==presented.snapshot.learningMaterializationId||operation&&(operation.kind!=='learning.act'||operation.input.runId!==event.runId||operation.input.revision!==event.detail.runRevision||operation.input.at!==event.at||!backupEqual(operation.input.action,event.detail.action)))fail();
   assertRunMaterialPresentedBy(presented,eventRun,event.at);
   // A non-contributing learning branch still records what the learner saw.
   // Validate its historical Scene pins before skipping scheduling replay.
   if(!Object.hasOwn(event.detail,'personalLearningScene'))fail();
   if(event.detail.personalLearningScene!==null){
    const scene=requireRow('annotations',personalLearningSceneRowId(event.targetId,participant.languageContext.languageRouteId));
    const pinned=z.object({sceneId:uuid,revisionId:uuid,revision:z.number().int().positive()}).strict().parse(event.detail.personalLearningScene),sceneRevision=scene.kind==='learning_scene'?findSceneRevision(scene,pinned):undefined;
    if(!sceneRevision||sceneRevision.revision!==pinned.revision||sceneRevision.createdAt>Date.parse(event.at))fail();
   }
   if(!Object.hasOwn(event.detail,'nextPresentation'))fail();
   if(event.detail.nextPresentation!==null){
    const next=z.object({targetId:z.string().uuid(),stepId:z.string().min(1),material:z.string().regex(/^[a-f0-9]{64}$/u)}).strict().parse(event.detail.nextPresentation);
    assertRunMaterialPresentedBy(runMaterial(eventRun.participants[next.targetId]??fail(),next.material),eventRun,event.at);
   }
   const facts=event.detail.formalEvaluation;if(facts){
    for(const id of [facts.step.protocolStepInstanceId,facts.step.protocolRunId,facts.action.actionId,facts.attempt.attemptId,facts.observation.observationId,facts.evaluation.evaluationId,facts.transitionDecision.transitionDecisionId])uuid.parse(id);
    if(!backupEqual(facts.step.learningMaterializationIds,[event.detail.materializationId])||facts.step.protocolRunId!==eventRun.participants[event.targetId]?.protocolRunId||facts.action.protocolStepInstanceId!==facts.step.protocolStepInstanceId||facts.attempt.actionId!==facts.action.actionId||facts.observation.attemptId!==facts.attempt.attemptId||facts.evaluation.observationId!==facts.observation.observationId||facts.evaluation.protocolRunId!==facts.step.protocolRunId||facts.evaluation.evaluationPolicyId!==eventRun.protocolBinding.evaluationPolicyId||facts.transitionDecision.observationId!==facts.observation.observationId||!backupEqual(facts.observation.evidenceIds,facts.evidence.map((evidence:any)=>evidence.learningEvidenceId)))fail();
    for(const evidence of facts.evidence){uuid.parse(evidence.learningEvidenceId);if(evidence.observationId!==facts.observation.observationId||evidence.attemptId!==facts.attempt.attemptId||evidence.protocolRunId!==facts.step.protocolRunId||evidence.learningTargetId!==event.targetId)fail();}
   }
}

function assertSavedStudyPlans(input:LearningSystemStateInput):void{
 const {maps,routes,fail}=input;const timestamp=z.string().datetime({offset:true});
 const studyPlans=maps.settings.get('language-route-study-plans');if(studyPlans!==undefined){if(!studyPlans||typeof studyPlans!=='object'||Array.isArray(studyPlans))fail();for(const [routeId,plan] of Object.entries(studyPlans as Record<string,any>)){const route=routes.get(routeId);if(!route||plan.languageRouteId!==routeId||plan.routeRevision>route.revision)fail();z.number().int().positive().parse(plan.routeRevision);z.number().int().positive().parse(plan.revision);z.number().int().min(1).max(100).parse(plan.dailyNewSenseLimit);timestamp.parse(plan.updatedAt);}}
}

function* assertSavedRunReferences(input:LearningSystemStateInput,saved:LocalLearningRun,knownProtocolRunIds:Set<string>,protocolTargets?:Map<string,string>):Generator<void,void>{
 const {maps,requireRow,validateLanguageContext,fail}=input;const uuid=z.string().uuid();
 const validateMaterial=input.validateMaterial??validateLightweightInitialMaterialization;
 const runLanguageContext=validateLanguageContext(saved.languageContext),ids=localRunTargetIds(saved);
  if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId)||!Object.keys(saved.targetCompletions).every(id=>ids.includes(id)))fail();
  const execution=localExecutionForRun(saved),binding=localRunBinding(saved),profile=learningPolicyProfileRegistry.get(localRunPolicy(saved),saved.policyProfileVersion);
  if(!backupEqual(saved.protocolBinding,profile.protocols[saved.purpose]))fail();
  if(!backupEqual(saved.schedulingPolicy,profile.lifecycle.schedulingPolicy)||saved.schedulingPolicyId!==profile.lifecycle.schedulingPolicyId||saved.learnerVisibleClaimBoundary!==profile.lifecycle.learnerVisibleClaimBoundary)fail();
  if(ids.length>1&&!execution.cohort||!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
  for(const [id,participant] of Object.entries(saved.participants)){
   const target=requireRow('learningTargets',id) as LocalLearningTarget;
   const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId)??fail(),samePair=(left:any,right:any)=>left.languageRouteId===right.languageRouteId&&left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;
   if(!backupEqual(participant.languageContext,runLanguageContext)||!samePair(membership.languageContext,participant.languageContext))fail();
   if(!baselineBindsSelectedMembership(saved,target,participant))fail();
   uuid.parse(participant.protocolRunId);input.syncScope?.assertProtocolOwner(participant.protocolRunId,saved.id,id);if(knownProtocolRunIds.has(participant.protocolRunId))fail();knownProtocolRunIds.add(participant.protocolRunId);protocolTargets?.set(participant.protocolRunId,id);
   const validateRunMaterial=(material:ReturnType<typeof runBaselineMaterial>)=>{
    validateMaterial(material);const materialProvenance=material.snapshot.provenance as any;
    assertLocalTargetMaterialIdentity(target,material);if(material.snapshot.protocolPurpose!==saved.purpose)fail();
    if(materialProvenance.packageKey){
     const materialPackageKey=z.string().min(1).parse(materialProvenance.packageKey),pack=maps.packageCache.get(materialPackageKey),installation=packageInstallationSchema.parse(requireRow('packageInstallations',materialPackageKey));
     const source=publishedMaterialMembership(target,material,participant.languageContext);if(!source)fail();
     assertMaterialAdmissionTime(material,source!);
     if(!sameLearningSourcePin(source!.sourcePin,materialSourcePin(material)))fail();
     if(materialProvenance.packageDigest!==installation.artifact.digest)fail();
     if(pack){const entry=pack.content.entries.find((candidate:any)=>candidate.senseVersionId===materialProvenance.senseVersionId&&candidate.bindingVersionId===materialProvenance.bindingVersionId);if(!entry||!sameLearningSourcePin(entry,materialSourcePin(material))||!backupEqual(entry.content,baseContentBeforeSupplement(material,participant.languageContext.supportLanguageTag)))fail();}
    }else{
     const attempt=requireRow('contentAttempts',materialProvenance.attemptId),task=requireRow('personalLearning',attempt.taskId);
     const source=target.curriculumMemberships.find(member=>member.id===task.curriculumMembershipId)??fail();assertMaterialAdmissionTime(material,source,attempt);if(!sameLearningSourcePin(task.source,materialSourcePin(material)))fail();
     if(task.targetId!==id||!target.curriculumMemberships.some(member=>member.id===task.curriculumMembershipId)||!samePinnedDirection(attempt.fixedInput?.languageContext,participant.languageContext)||attempt.status!=='ready'||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(material,participant.languageContext.supportLanguageTag)))fail();
     if(material===runBaselineMaterial(participant)&&task.curriculumMembershipId!==participant.curriculumMembershipId)fail();
    }
   };
   for(const material of validateRunMaterialPins(participant))validateRunMaterial(material);
   const commitment=participant.policyCommitment,plan=participant.resolvedPlan;
   uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);uuid.parse(plan.resolvedLearningPlanRevisionId);
   if(commitment.commitmentId!==stableUuid(`local-policy-commitment:${target.retentionId}`)||commitment.revision!==1||commitment.assignmentId!==target.policyAssignment.assignmentId||commitment.assignmentRevision!==target.policyAssignment.revision||commitment.profileId!==target.policyAssignment.profileId||commitment.committedByProtocolRunId===participant.protocolRunId&&commitment.committedAt!==saved.startedAt)fail();
   if(plan.learningTargetId!==id||plan.retentionTargetId!==target.retentionId||plan.purpose!==saved.purpose||plan.profileId!==commitment.profileId||plan.profileVersion!==commitment.profileVersion||plan.readiness!=='ready'||!backupEqual(plan.protocolBinding,saved.protocolBinding)||!backupEqual(plan.contentDemands,saved.protocolBinding.contentDemands)||!backupEqual(plan.learningMaterializationIds,[runBaselineMaterial(participant).snapshot.learningMaterializationId]))fail();
   const progress=participant.progress;
   if(progress.protocolRunId!==participant.protocolRunId||progress.protocolId!==saved.protocolBinding.protocolId||progress.protocolVersion!==saved.protocolBinding.protocolVersion||!backupEqual(Object.keys(progress.checkpointCredits).sort(),[...saved.protocolBinding.checkpointDefinitionIds].sort()))fail();
   if(Object.hasOwn(saved.targetCompletions,id)&&!progress.completed)fail();
   const expectedStartKind=saved.purpose==='initial_learning'?'initial_learning_ready':saved.purpose==='retention_review'?'due_review':'relearning_ready';
   if(participant.startReason.kind!==expectedStartKind||participant.startReason.selectionReason!==(id===saved.targetId?'requested_target':'cohort_candidate')||participant.startReason.triggerAt!==saved.startedAt||participant.startReason.triggerMemoryRevision!==participant.memoryRevision||!backupEqual(participant.outcomePermissions,localProtocolOutcomePermissions(saved.purpose,saved.protocolBinding)))fail();
   if(saved.policyProfileId!==commitment.profileId||saved.policyProfileVersion!==commitment.profileVersion||!Array.isArray(participant.evidenceIds)||participant.evidenceIds.some(id=>!uuid.safeParse(id).success))fail();
  }

  if(saved.protocolVersion!==binding.localProtocolVersion)fail();
}

function* assertSavedLearningReferences(input:LearningSystemStateInput):Generator<void,void>{
 const {rows,maps,identity,requireRow,validateLanguageContext,fail}=input;
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 const knownProtocolRunIds=new Set<string>(),protocolTargets=new Map<string,string>();
 for(const {value:raw} of rows.learningRuns){
  const saved=raw as LocalLearningRun;yield;replicaWork('admission.savedRun');assertSavedRunState(saved,fail);
  yield*assertSavedRunReferences(input,saved,knownProtocolRunIds,protocolTargets);
  for(const field of ['startedByOperationId','continuedFromRunId'] as const)if(saved[field]!==undefined)uuid.parse(saved[field]);
  if(saved.continuedFromRunId&&!lawfulLearningPredecessor(requireRow('learningRuns',saved.continuedFromRunId),saved.languageContext,saved.startedAt,saved.sessionIntent??'mixed',saved.id))fail();
  if(!Array.isArray(saved.lifecycleEvents))fail();const eventIds=new Set<string>();let revision=0;
  for(const event of saved.lifecycleEvents){
   yield;z.enum(['paused_for_session_switch','paused_for_session_end','resumed_after_session_switch','resumed_after_session_end','session_intent_selected','interrupted_by_planning_override','resumed_after_planning_override','current_step_material_refreshed']).parse(event.kind);uuid.parse(event.eventId);uuid.parse(event.operationId);timestamp.parse(event.at);
   if(eventIds.has(event.eventId)||Date.parse(event.at)<Date.parse(saved.startedAt)||event.runRevision<=revision||event.runRevision>=saved.revision)fail();eventIds.add(event.eventId);revision=event.runRevision;
   if('continuedFromRunId' in event&&event.continuedFromRunId)requireRow('learningRuns',event.continuedFromRunId);
   if('learningSessionId' in event&&event.learningSessionId)requireRow('learningSessions',event.learningSessionId);
  }
 }
 for(const {value:target} of rows.learningTargets){yield;const id=target.committedPolicy?.committedByProtocolRunId;if(id&&!(input.syncScope?input.syncScope.hasProtocolRunId(id,target.id):protocolTargets.get(id)===target.id))fail();}
 for(const {value:run} of rows.learningRuns)for(const [targetId,p]of Object.entries(run.participants) as Array<[string,any]>){yield;if(!(input.syncScope?input.syncScope.hasProtocolRunId(p.policyCommitment.committedByProtocolRunId,targetId):protocolTargets.get(p.policyCommitment.committedByProtocolRunId)===targetId))fail();}
 for(const {value:event} of rows.learningEvents){yield;replicaWork('admission.savedEvent');assertSavedEventReferences(input,event,requireRow('learningRuns',event.runId));}
 yield*validateSavedLearningReconciliationSteps({get:(table,key)=>maps[table].get(key),has:(table,key)=>maps[table].has(key),entries:table=>rows[table]});
 const active=maps.meta.get('learning-active');if(active){const run=requireRow('learningRuns',active);if(localRunOpenPlanningInterruption(run)||localRunOpenSessionPause(run))fail();}
 yield*assertStudyScopeStateSteps(input);
}

/** Learning owns history validation, deterministic replay, projection checks and reconciliation decisions. */
export function* assertLearningSystemStateSteps(input:LearningSystemStateInput,mode:'audit'|'restore'|'sync'='audit'):Generator<void,void>{
 const {rows,maps,identity,routes,requireRow,requirePersonalSource,validateLanguageContext,operationInput,fail}=input;
 const validateMaterial=input.validateMaterial??validateLightweightInitialMaterialization;
 const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
 for(const {key,value} of rows.supplementalMembershipStates){
  yield;
  const state=supplementalMembershipStateSchema.parse(value);
  if(key!==state.id||state.learnerUserId!==identity.learnerId)fail();
  validateLanguageContext(state.languageContext);
  assertSupplementalStateSource(state,supplementalSourceDescriptor(state.source,requireRow(state.source.kind==='stable_sense'?'curriculumEnrollments':'personalLearning',state.source.id),identity.learnerId));
  const creation=operationInput(state.createdByOperationId),latest=operationInput(state.changedByOperationId);
  if(creation&&(creation.kind!=='learning.changeSupplementalMembership'||creation.input.active!==false||creation.input.expectedRevision!==0||!backupEqual(creation.input.source,state.source)))fail();
  if(latest&&(latest.kind!=='learning.changeSupplementalMembership'||latest.input.active!==(state.status==='active')||latest.input.expectedRevision!==state.revision-1||!backupEqual(latest.input.source,state.source)))fail();
 }
 for(const {key,value:raw} of rows.curriculumEnrollments){
  yield;
  const enrollment=curriculumEnrollmentSchema.parse(raw);
  if(key!==enrollment.id||enrollment.learnerUserId!==identity.learnerId)fail();
  validateLanguageContext(enrollment.languageContext);
  const operation=operationInput(enrollment.createdByOperationId);
  if(operation&&operation.kind!==(enrollment.source.kind==='stable_sense'?'learning.enrollDirect':'learning.enroll'))fail();
  if(enrollment.source.kind==='portable_package'){
   const installation=packageInstallationSchema.parse(requireRow('packageInstallations',enrollment.source.packageKey));
   if(installation.artifact.packageId!==enrollment.source.packageId||installation.artifact.version!==enrollment.source.packageVersion)fail();
  }else if(enrollment.source.kind==='stable_sense'){
   if(enrollment.source.selection.targetLanguageTag!==enrollment.languageContext.targetLanguageTag)fail();
   assertDirectEnrollmentSource(enrollment.source.selection,(table,key)=>maps[table].get(key));
  }else{
   const archiveSha256=enrollment.source.publicationArchiveSha256;
   const source=enrollment.source;
   type Installation=z.infer<typeof packageInstallationSchema>;
   const members:Array<{installation:Installation;reference:NonNullable<Installation['artifact']['bookMemberships']>[number]|undefined}>=[];
   for(const row of rows.packageInstallations){
    const item=packageInstallationSchema.parse(row.value);
    const reference=item.artifact.bookMemberships?.find(member=>member.archiveSha256===archiveSha256);
    if(reference||item.artifact.bookArchiveSha256===archiveSha256)members.push({installation:item,reference});
    yield;
   }
   if(members.length!==source.memberCount||members.some(({installation,reference})=>
    installation.artifact.targetLanguage!==enrollment.languageContext.targetLanguageTag
    ||installation.artifact.supportLanguage!==enrollment.languageContext.supportLanguageTag
    ||reference&&(reference.bookId!==source.bookId||reference.bookVersionId!==source.bookVersionId||reference.memberCount!==source.memberCount)))fail();
   const positions=members.flatMap(({reference})=>reference?[reference.memberIndex]:[]);
   if(new Set(positions).size!==positions.length)fail();
   if(enrollment.bookPlan&&enrollment.bookPlan.range.selection.kind!=='all'){
    const packages=[];
    for(const member of members){const pack=maps.packageCache.get(member.installation.key);if(pack)packages.push(pack);yield;}
    assertResolvedBookRange(enrollment.bookPlan.range,members.map(member=>member.installation),packages);
   }
  }
 }
 yield*assertOneActiveBookSteps({*[Symbol.iterator](){for(const row of rows.curriculumEnrollments)yield curriculumEnrollmentSchema.parse(row.value);}});
 for(const {value:target} of rows.learningTargets){
  yield;replicaWork('admission.savedTarget');
  try{savedRetentionStateSchema.parse(retentionBaseline(target));timestamp.parse(target.createdAt);}catch{fail();}
  learningPolicyProfileRegistry.get(localTargetPolicy(target));
  const assignment=target.policyAssignment;
  uuid.parse(assignment.assignmentId);z.number().int().positive().parse(assignment.revision);timestamp.parse(assignment.assignedAt);learningPolicyProfileRegistry.get(assignment.profileId);
  const identityFields=['learnerUserId','senseId','expressionId','targetLanguageTag'] as const;
  for(const field of identityFields)z.string().min(1).parse(target.identity[field]);
  if(target.identity.learnerUserId!==identity.learnerId||target.identity.targetLanguageTag!==target.targetLanguageTag||target.id!==stableLearningTargetId(identity.learnerId,target.identity.senseId,target.identity.expressionId)||target.retentionId!==stableUuid(`sensa-retention:${target.id}`))fail();
  if(target.committedPolicy){const commitment=target.committedPolicy;uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);z.number().int().positive().parse(commitment.revision);timestamp.parse(commitment.committedAt);const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion);if(!target.startedAt||commitment.assignmentId!==assignment.assignmentId||commitment.assignmentRevision!==assignment.revision||profile.profileId!==commitment.profileId)fail();}else if(target.startedAt)fail();
  z.array(z.object({kind:z.literal('declared_mastery'),source:z.literal('learner'),operationId:uuid,createdAt:timestamp}).strict()).max(1).parse(target.planningOverrides);
  for(const override of target.planningOverrides){const operation=operationInput(override.operationId);if(operation&&(operation.kind!=='learning.declareMastery'||operation.input.targetId!==target.id||operation.input.active!==true||operation.input.at!==override.createdAt))fail();}
  if(!Array.isArray(target.curriculumMemberships)||!target.curriculumMemberships.length||new Set(target.curriculumMemberships.map((membership:any)=>membership.id)).size!==target.curriculumMemberships.length)fail();
  for(const membership of target.curriculumMemberships){
   uuid.parse(membership.id);z.number().int().positive().parse(membership.revision);if(membership.status!==undefined&&!['active','superseded'].includes(membership.status))fail();uuid.parse(membership.createdByOperationId);timestamp.parse(membership.createdAt);timestamp.parse(membership.updatedAt);if(Date.parse(membership.updatedAt)<Date.parse(membership.createdAt))fail();
   const context=validateLanguageContext(membership.languageContext);if(context.targetLanguageTag!==target.targetLanguageTag)fail();
   sensaLearningMaterializationSnapshotSchema.parse(membership.material.snapshot);validateMaterial(membership.material);
   assertMaterialAdmissionTime(membership.material,membership,membership.packageKey?undefined:requireRow('contentAttempts',membership.material.snapshot.provenance.attemptId));
   learningSupportMeaning(membership.material.content.resources,context.supportLanguageTag);
   const provenance=membership.material.snapshot.provenance;
   if(!sameLearningSourcePin(membership.sourcePin,materialSourcePin(membership.material)))fail();
   assertLocalTargetMaterialIdentity(target,membership.material);
   if(membership.sourceKind==='sense_learning_package'||membership.sourceKind==='stable_sense'&&membership.packageKey!==null){
    if(!membership.packageKey)fail();
    const enrollment=requireRow('curriculumEnrollments',z.string().uuid().parse(membership.provenance.curriculumEnrollmentId));
    if(enrollment.learnerUserId!==identity.learnerId||enrollment.languageContext.languageRouteId!==context.languageRouteId)fail();
    const installation=packageInstallationSchema.parse(requireRow('packageInstallations',membership.packageKey));if(installation.artifact.targetLanguage!==context.targetLanguageTag||installation.artifact.supportLanguage!==context.supportLanguageTag)fail();
    assertPublishedCurriculumSource(target,membership,enrollment,installation);
    if(membership.sourceKind==='stable_sense')assertDirectPublishedMembership(enrollment,target,membership,installation.artifact.digest);
    const pack=maps.packageCache.get(membership.packageKey),entry=pack?.content.entries.find((candidate:any)=>candidate.senseVersionId===provenance.senseVersionId&&candidate.bindingVersionId===provenance.bindingVersionId);
    if(pack&&(!entry||!sameLearningSourcePin(entry,materialSourcePin(membership.material))||pack.content.targetLanguage!==context.targetLanguageTag||pack.content.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag))||entry.assurancePackageKey!==membership.assurancePackageKey))fail();
   }else if(membership.sourceKind==='stable_sense'){
    const attempt=requireRow('contentAttempts',provenance.attemptId),task=requireRow('personalLearning',attempt.taskId);
    const enrollment=curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',task.source.enrollmentId));
    assertDirectGeneratedMembership(enrollment,target,membership,task,attempt);
   }else if(membership.sourceKind==='personal_meaning_alignment'){
    const source=membership.provenance as any,attempt=requireRow('contentAttempts',provenance.attemptId),task=requireRow('personalLearning',attempt.taskId);
    if(membership.packageKey!==null||membership.assurancePackageKey!==undefined||!task||source?.personalMeaningId!==task.source.personalMeaningId||source?.alignmentId!==task.source.personalMeaningAlignmentId||source?.personalMeaningRevisionId!==task.source.personalMeaningRevisionId||source?.alignmentBasisReferenceId!==task.source.alignmentBasisReferenceId||membership.id!==stableUuid(`local-curriculum-membership:${target.id}:${context.languageRouteId}:personal_meaning_alignment:${source.alignmentId}`))fail();
    requirePersonalSource(task.source);
    assertReadyContentAttempt(attempt);
    if(attempt.taskId!==task.id||attempt.status!=='ready'||!(attempt.review?.accepted||(attempt.reviewProvider===null&&attempt.review===null&&attempt.validation?.review===null&&attempt.validation?.validations?.length>0&&attempt.validation.validations.every((validation:any)=>validation.status==='accepted')))||!backupEqual(attempt.validation?.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag)))fail();
   }else fail();
  }
  if(target.introducedLanguageRouteId!==null&&!target.curriculumMemberships.some((membership:any)=>membership.languageContext.languageRouteId===target.introducedLanguageRouteId))fail();
 }
 if(mode==='sync'){assertSavedStudyPlans(input);yield*assertSavedLearningReferences(input);return;}
 const packageCacheComplete=everyLibraryRow(rows.learningTargets,({value:target})=>target.curriculumMemberships.every((membership:any)=>!membership.packageKey||maps.packageCache.has(membership.packageKey)));
 let historyOnlyRunIds=new Set<string>();
 try{({historyOnlyRunIds}=yield*validateLearningReconciliationRecordSteps({get:(table,key)=>maps[table].get(key),has:(table,key)=>maps[table].has(key),entries:table=>rows[table]}));}catch{fail();}
 // Conflict continuity still needs the existing audit of the affected Target
 // lineage: stored Scheduling Decisions do not carry complete output Memory.
 const auditTargets=new Set<string>();
 for(const {value:decision} of rows.learningReconciliations)auditTargets.add(decision.targetId);
 let expanded=true;while(expanded){expanded=false;for(const {value:run} of rows.learningRuns)if(run.targetIds.some((id:string)=>auditTargets.has(id)))for(const id of run.targetIds)if(!auditTargets.has(id)){auditTargets.add(id);expanded=true;}}
 const auditRun=(run:LocalLearningRun)=>mode==='audit'||run.targetIds.some(id=>auditTargets.has(id));
 const restoredRevisions=new Map<string,number>();
 const replayFields=retentionReplayFields;
 type TargetReplay=Pick<LocalLearningTarget,typeof replayFields[number]>;
 const replayStates=new Map<string,TargetReplay>();
 const causalStates=new Set<string>();
 const runStates=new Map<string,Map<string,{before:string;after:string}>>();
 const effectiveCommitments=new Map<string,LocalLearningTarget['committedPolicy']>();
 const causalKey=(targetId:string,state:LocalRetentionBaseline,commitment:LocalLearningTarget['committedPolicy'])=>canonicalJsonDigest(encodeBackupValue({targetId,state,commitment}));
 for(const {key} of rows.learningTargets){const state=initialRetentionBaseline();replayStates.set(key,state);effectiveCommitments.set(key,null);causalStates.add(causalKey(key,state,null));yield;}
 const unfinished=new Set<string>(),knownProtocolRunIds=new Set<string>();
 const unreplayedTargets=new Set<string>();
 const eventKeysByRun=new Map<string,string[]>();
 for(const {key,value:event} of rows.learningEvents){if(!maps.learningRuns.has(event.runId))fail();const keys=eventKeysByRun.get(event.runId)??[];keys.push(key);eventKeysByRun.set(event.runId,keys);yield;}
 // Wall time alone is not a causal order: a Review may hand off Relearning
 // within the same millisecond. The pinned memory revision orders settlement;
 // a repair completion follows same-instant repair attempts without settling
 // that originating Review again.
 const replayRevision=(run:LocalLearningRun)=>Math.min(...Object.values(run.participants).map(participant=>participant.memoryRevision));
 const replayPurpose=(run:LocalLearningRun)=>run.purpose==='initial_learning'?0:run.purpose==='retention_review'?1:run.completionKind==='wait_relearning'?2:3;
 const runs:Array<{key:string;startedAt:number;revision:number;purpose:number}>=[];
 for(const {key,value:run} of rows.learningRuns){runs.push({key,startedAt:Date.parse(run.startedAt),revision:replayRevision(run),purpose:replayPurpose(run)});yield;}
 runs.sort((left,right)=>left.startedAt-right.startedAt||left.revision-right.revision||left.purpose-right.purpose||left.key.localeCompare(right.key));yield;
 const active=maps.meta.get('learning-active');
 type RestoreAction={targetId:string;at:string;stepId:string;materializationId:string;nextPresentation:LearningEvent['detail']['nextPresentation'];evidenceIds:string[];retention:LearningEvent['detail']['transition']['retention']};
 type ActionHeader={key:string;revision:number;at:string;restore?:RestoreAction};
 function* assertStoredRunFacts(saved:LocalLearningRun,actionKeys:readonly string[]):Generator<void,ActionHeader[]>{
  const headers:ActionHeader[]=[];
  const context=validateLanguageContext(saved.languageContext);requireRow('learningTargets',saved.targetId);
  for(const [id,participant] of Object.entries(saved.participants)){
   const target=requireRow('learningTargets',id),baseline=runBaselineMaterial(participant);validateMaterial(baseline);
   if(baseline.snapshot.learningTargetId!==id||baseline.snapshot.learnerUserId!==identity.learnerId||!backupEqual(participant.languageContext,context)||!target.curriculumMemberships.some((membership:any)=>membership.id===participant.curriculumMembershipId&&membership.languageContext.languageRouteId===context.languageRouteId&&membership.languageContext.targetLanguageTag===context.targetLanguageTag&&membership.languageContext.supportLanguageTag===context.supportLanguageTag))fail();
   yield;
  }
  for(const key of actionKeys){
   replicaWork('admission.eventFactRead');const event=requireRow('learningEvents',key) as LearningEvent;
   assertSavedEventReferences(input,event,saved);
   headers.push({key,revision:event.detail.runRevision,at:event.at,...(!auditRun(saved)?{restore:{targetId:event.targetId,at:event.at,stepId:event.detail.stepId,materializationId:event.detail.materializationId,nextPresentation:event.detail.nextPresentation,evidenceIds:event.detail.formalEvaluation?.evidence.map(fact=>fact.learningEvidenceId)??[],retention:event.detail.transition.retention}}:{})});yield;
  }
  if(!saved.completedAt&&saved.id!==active&&!localRunOpenPlanningInterruption(saved)&&!localRunOpenSessionPause(saved))fail();
  return headers;
 }
 const pendingRuns=[...runs];
 while(pendingRuns.length){
  // A clock can order unrelated branches differently. Select by an exact,
  // already replayed causal input rather than interpreting wall time as ancestry.
  const index=pendingRuns.findIndex(header=>{const candidate=requireRow('learningRuns',header.key) as LocalLearningRun;
   if(!auditRun(candidate))return true;
   // Structured cacheless restore retains its explicitly limited admission
   // contract until its exact runtime resource has been restored.
   if(!packageCacheComplete&&candidate.protocolBinding.runtimeAdapterId!=='lightweight')return true;
   return Object.entries(candidate.participants).every(([id,participant])=>{
   const baseline=participant.retentionBaseline;
   if(!baseline||!backupEqual(Object.keys(baseline).sort(),[...replayFields].sort()))return false;
   const commitment=participant.policyCommitment;
   return causalStates.has(causalKey(id,baseline,commitment))
    ||commitment.committedByProtocolRunId===participant.protocolRunId&&causalStates.has(causalKey(id,baseline,null));
  });});
  if(index<0)fail();const header=pendingRuns.splice(index,1)[0]!;
  yield;
  const saved=requireRow('learningRuns',header.key) as LocalLearningRun;
  try{assertSavedRunState(saved,fail);}catch{fail();}
  const audit=auditRun(saved);
  const deferredStructured=!packageCacheComplete&&saved.protocolBinding.runtimeAdapterId!=='lightweight';
  if(deferredStructured&&historyOnlyRunIds.has(saved.id))fail();
  if(audit&&!historyOnlyRunIds.has(saved.id)&&!deferredStructured)for(const [id,participant] of Object.entries(saved.participants)){
   if(!backupEqual(participant.retentionBaseline,replayStates.get(id)))fail();
   const prior=effectiveCommitments.get(id);
   if(prior?!backupEqual(prior,participant.policyCommitment):participant.policyCommitment.committedByProtocolRunId!==participant.protocolRunId)fail();
  }
  try{for(const participant of Object.values(saved.participants)){validateRunMaterialPins(participant);yield;}}catch{fail();}
  const eventHeaders=yield*assertStoredRunFacts(saved,eventKeysByRun.get(saved.id)??[]);
  const storedRevisions=[...eventHeaders.map(event=>event.revision),...saved.lifecycleEvents.map(event=>event.runRevision)];
  if(new Set(storedRevisions).size!==storedRevisions.length||saved.revision!==1+storedRevisions.length||saved.ordinal!==1+eventHeaders.length||storedRevisions.some(revision=>!Number.isSafeInteger(revision)||revision<1||revision>=saved.revision))fail();
  // Only this Run's participant bodies and Action facts remain decoded during
  // replay. The cross-Run state consists of the small retention projection.
  const targets=new Map<string,LocalLearningTarget>();
  for(const id of localRunTargetIds(saved)){const participant=saved.participants[id]??fail();targets.set(id,{...requireRow('learningTargets',id),...structuredClone(participant.retentionBaseline),committedPolicy:participant.policyCommitment});}
  const runLanguageContext=validateLanguageContext(saved.languageContext),ids=localRunTargetIds(saved);
  try{for(const field of ['startedByOperationId','continuedFromRunId'] as const)if(Object.hasOwn(saved,field))uuid.parse(saved[field]);}catch{fail();}
  if(saved.continuedFromRunId!==undefined){
   if(!lawfulLearningPredecessor(requireRow('learningRuns',saved.continuedFromRunId),saved.languageContext,saved.startedAt,saved.sessionIntent??'mixed',saved.id))fail();
  }
  if(saved.startedByOperationId!==undefined){
   uuid.parse(saved.startedByOperationId);const operation=operationInput(saved.startedByOperationId);
   if(operation&&(!['learning.start','learning.continue'].includes(operation.kind)||!ids.includes(operation.input.targetId)||operation.input.at!==saved.startedAt))fail();
   const creationContextMatches=!operation||(saved.learningSessionId?sameLearningSessionDirection(saved.languageContext,operation.input.languageContext):backupEqual(saved.languageContext,operation.input.languageContext));
   if(operation&&(!creationContextMatches||(saved.sessionIntent??'mixed')!==(operation.kind==='learning.continue'?localRunSessionIntent(requireRow('learningRuns',operation.input.runId)):operation.input.sessionIntent??'mixed')||saved.continuedFromRunId!==(operation.kind==='learning.continue'?operation.input.runId:undefined)))fail();
  }
  if(!Array.isArray(saved.lifecycleEvents))fail();
  let openInterruption:ReturnType<typeof localRunOpenPlanningInterruption>=null;
  let openPause:ReturnType<typeof localRunOpenSessionPause>=null;
  if(saved.sessionIntent!==undefined&&!['mixed','review_only'].includes(saved.sessionIntent)||localRunSessionIntent(saved)==='review_only'&&saved.purpose==='initial_learning')fail();
  const lifecycleEventIds=new Set<string>();
  let previousLifecycleRevision=0;
  for(const event of saved.lifecycleEvents){
   uuid.parse(event.eventId);uuid.parse(event.operationId);timestamp.parse(event.at);if(lifecycleEventIds.has(event.eventId)||Date.parse(event.at)<Date.parse(saved.startedAt)||!Number.isSafeInteger(event.runRevision)||event.runRevision<=previousLifecycleRevision)fail();lifecycleEventIds.add(event.eventId);previousLifecycleRevision=event.runRevision;
   const operation=operationInput(event.operationId);
   if(['resumed_after_session_switch','resumed_after_session_end','session_intent_selected','resumed_after_planning_override'].includes(event.kind)){
    const selection=event as Extract<LocalLearningRun['lifecycleEvents'][number],{kind:'resumed_after_session_switch'|'resumed_after_session_end'|'session_intent_selected'|'resumed_after_planning_override'}>;
    try{verifyLearningSelectionWitness(saved,selection,selection.continuedFromRunId?requireRow('learningRuns',selection.continuedFromRunId):undefined);validateLanguageContext(selection.requestedLanguageContext);}catch{fail();}
    if(operation&&(!backupEqual(selection.requestedLanguageContext,operation.input.languageContext)||selection.continuedFromRunId!==(operation.kind==='learning.continue'?operation.input.runId:undefined)))fail();
   }
   if(event.kind==='paused_for_session_switch'){
    if(openPause||openInterruption||ids.includes(event.selectedTargetId)||operation&&(!['learning.start','learning.continue'].includes(operation.kind)||operation.input.targetId!==event.selectedTargetId||operation.input.at!==event.at))fail();
    openPause=event;
   }else if(event.kind==='paused_for_session_end'){
    const session=learningSessionSchema.parse(requireRow('learningSessions',event.learningSessionId));
    if(openPause||openInterruption||event.eventId!==stableUuid(`local-run-session-end:${saved.id}:${event.operationId}`)||!session.runIds.includes(saved.id)||session.endReason!=='learner_ended'||session.endedByOperationId!==event.operationId||session.endedAt!==event.at||eventHeaders.some(action=>action.revision<event.runRevision&&Date.parse(action.at)>Date.parse(event.at))||saved.lifecycleEvents.some(previous=>previous.runRevision<event.runRevision&&Date.parse(previous.at)>Date.parse(event.at))||operation&&(operation.kind!=='learning.endSession'||operation.input.runId!==saved.id||operation.input.expectedRevision!==event.runRevision||operation.input.at!==event.at))fail();
    openPause=event;
   }else if(event.kind==='resumed_after_session_switch'||event.kind==='resumed_after_session_end'){
    if(!openPause||event.kind!==(openPause.kind==='paused_for_session_end'?'resumed_after_session_end':'resumed_after_session_switch')||event.interruptionEventId!==openPause.eventId||!['mixed','review_only'].includes(event.sessionIntent)||event.sessionIntent==='review_only'&&saved.purpose==='initial_learning'||Date.parse(event.at)<Date.parse(openPause.at)||operation&&(!['learning.start','learning.continue'].includes(operation.kind)||!ids.includes(operation.input.targetId)||operation.input.at!==event.at||(operation.input.sessionIntent??event.sessionIntent)!==event.sessionIntent))fail();
    openPause=null;
   }else if(event.kind==='session_intent_selected'){
    if(openPause||openInterruption||!['mixed','review_only'].includes(event.sessionIntent)||event.sessionIntent==='review_only'&&saved.purpose==='initial_learning'||operation&&(operation.kind!=='learning.start'||!ids.includes(operation.input.targetId)||operation.input.at!==event.at||operation.input.sessionIntent!==event.sessionIntent))fail();
   }else if(event.kind==='interrupted_by_planning_override'){
   if(openInterruption||event.overrideKind!=='declared_mastery'||!ids.includes(event.targetId)||operation&&(operation.kind!=='learning.declareMastery'||operation.input.targetId!==event.targetId||operation.input.active!==true||operation.input.at!==event.at))fail();
   openInterruption=event;
   }else if(event.kind==='resumed_after_planning_override'){
    if(event.sessionIntent!==undefined&&(!['mixed','review_only'].includes(event.sessionIntent)||event.sessionIntent==='review_only'&&saved.purpose==='initial_learning'||operation&&event.sessionIntent!==(operation.input.sessionIntent??event.sessionIntent)))fail();
    if(!openInterruption||event.interruptionEventId!==openInterruption.eventId||operation&&(!['learning.start','learning.continue'].includes(operation.kind)||operation.input.at!==event.at||!ids.includes(operation.input.targetId)))fail();
   openInterruption=null;
   }else if(event.kind==='current_step_material_refreshed'){
    const participant=saved.participants[event.targetId]??fail(),target=requireRow('learningTargets',event.targetId),presented=runMaterialById(participant,event.materializationId);
    if(!participant.presentedMaterials[event.stepId])fail();
    if(!ids.includes(event.targetId)||!presented||event.eventId!==stableUuid(`local-run-material-refresh:${saved.id}:${event.operationId}:${event.stepId}`))fail();
    assertRunMaterialPresentedBy(presented,saved,event.at);
    const presentedPackageKey=typeof presented.snapshot.provenance.packageKey==='string'?presented.snapshot.provenance.packageKey:null;
    if(presentedPackageKey){
     const packageKey=presentedPackageKey!,refreshedMembership=publishedMaterialMembership(target,presented,participant.languageContext);
     const sourceMaterializationId=refreshedMembership?.material.snapshot.learningMaterializationId;
     const enrolled=operation?.kind==='learning.enroll'&&(operation.input.key===packageKey
      ||typeof operation.input.publicationArchiveSha256==='string'&&operation.input.publicationArchiveSha256===presented.snapshot.provenance.publicationArchiveSha256);
     if(!sourceMaterializationId||operation&&!enrolled||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
    }else{
     const membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===participant.curriculumMembershipId),attempt=requireRow('contentAttempts',event.operationId),task=requireRow('personalLearning',attempt.taskId),sourceMaterializationId=stableUuid(`sensa-personal-material:${event.operationId}`);
     if(attempt.status!=='ready'||task.targetId!==event.targetId||membership?.sourceKind!=='personal_meaning_alignment'||operation&&(operation.kind!=='personal.prepare'||attempt.taskId!==operation.input.id)||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
    }
   }else fail();
   yield;
  }
  if(localRunOpenPlanningInterruption(saved)?.eventId!==openInterruption?.eventId)fail();
  if(localRunOpenSessionPause(saved)?.eventId!==openPause?.eventId)fail();
  if(!packageCacheComplete&&saved.protocolBinding.runtimeAdapterId!=='lightweight'){
   if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId)||!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
   for(const [id,participant] of Object.entries(saved.participants)){
    const target=requireRow('learningTargets',id),membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===participant.curriculumMembershipId)??fail();
    uuid.parse(participant.protocolRunId);if(knownProtocolRunIds.has(participant.protocolRunId))fail();knownProtocolRunIds.add(participant.protocolRunId);
    if(!backupEqual(participant.languageContext,runLanguageContext)||membership.languageContext.languageRouteId!==runLanguageContext.languageRouteId)fail();
    if(!baselineBindsSelectedMembership(saved,target,participant))fail();
    for(const material of validateRunMaterialPins(participant)){
     validateMaterial(material);assertLocalTargetMaterialIdentity(target,material);
     if(material.snapshot.protocolPurpose!==saved.purpose)fail();
     const provenance=material.snapshot.provenance,packageKey=provenance.packageKey?z.string().min(1).parse(provenance.packageKey):null;
     const attempt=packageKey?undefined:requireRow('contentAttempts',z.string().uuid().parse(provenance.attemptId)),task=attempt?requireRow('personalLearning',attempt.taskId):undefined;
     const source=(packageKey?publishedMaterialMembership(target,material,participant.languageContext):target.curriculumMemberships.find((candidate:LocalLearningTarget['curriculumMemberships'][number])=>candidate.id===task?.curriculumMembershipId))??fail();
     assertMaterialAdmissionTime(material,source,attempt);if(!sameLearningSourcePin(source.sourcePin,materialSourcePin(material))||task&&!sameLearningSourcePin(task.source,materialSourcePin(material)))fail();
     if(packageKey&&provenance.packageDigest!==packageInstallationSchema.parse(requireRow('packageInstallations',packageKey)).artifact.digest)fail();
    }
    unreplayedTargets.add(id);
   }
   continue;
  }
  yield*assertSavedRunReferences(input,saved,knownProtocolRunIds);
  const execution=localExecutionForRun(saved),binding=localRunBinding(saved),profile=learningPolicyProfileRegistry.get(localRunPolicy(saved),saved.policyProfileVersion);
  for(const id of ids){
   const target=targets.get(id)??fail(),trigger=saved.participants[id]??fail();
   if(unfinished.has(id)||localLearningPurpose(target)!==saved.purpose||trigger.memoryRevision!==target.memoryRevision||trigger.dueAt!==(target.memory?.dueAt.toISOString()??null))fail();
   if(saved.purpose==='retention_review'&&(!target.memory||Date.parse(saved.startedAt)<target.memory.dueAt.getTime())||target.relearnAt&&Date.parse(saved.startedAt)<Date.parse(target.relearnAt))fail();
   target.startedAt??=saved.startedAt;
   const executable=localExecutableTargetForParticipant(target,trigger),pack=executable.packageKey?maps.packageCache.get(executable.packageKey):undefined;
   validateLocalProtocolResources(execution,executable,pack);
  }
  if(!audit){
   // Stored revisions/presentation witnesses certify causal/reference closure,
   // not that today's algorithm produces the recorded outcomes or Memory.
   const revisions=new Map<number,{action:RestoreAction}|{lifecycle:LocalLearningRun['lifecycleEvents'][number]}>();
   for(const event of eventHeaders){if(revisions.has(event.revision)||!event.restore)fail();revisions.set(event.revision,{action:event.restore!});yield;}
   for(const event of saved.lifecycleEvents){if(revisions.has(event.runRevision))fail();revisions.set(event.runRevision,{lifecycle:event});yield;}
   if(saved.revision!==1+revisions.size||saved.ordinal!==1+eventHeaders.length)fail();
   const presentations=new Map(ids.map(id=>[id,{map:{} as Record<string,string>,order:[] as string[],acted:new Set<string>(),evidence:[] as string[],completion:null as null|{at:string;kind:string}}]));
   const bind=(id:string,step:string,material:string,refresh=false)=>{const state=presentations.get(id)??fail();if(state.acted.has(step)||!refresh&&state.map[step]&&state.map[step]!==material)fail();if(!state.map[step])state.order.push(step);state.map[step]=material;};
   // Each participant's first binding is its retained planning baseline.
   for(const id of ids){const p=saved.participants[id]!,first=p.presentationOrder[0];if(first)bind(id,first,p.material);const revision=restoredRevisions.get(id)??0;if(p.memoryRevision!==revision)fail();restoredRevisions.set(id,revision);}
   let previousAt=Date.parse(saved.startedAt),paused=false;
   for(let revision=1;revision<saved.revision;revision++){
    const item=revisions.get(revision)??fail();
    if('lifecycle' in item){const event=item.lifecycle;if(Date.parse(event.at)<previousAt||saved.completedAt&&Date.parse(event.at)>Date.parse(saved.completedAt))fail();previousAt=Date.parse(event.at);
     if(event.kind==='current_step_material_refreshed'){const p=saved.participants[event.targetId]??fail(),material=runMaterialById(p,event.materializationId);bind(event.targetId,event.stepId,Object.entries(p.materializations).find(([,body])=>body===material)?.[0]??fail(),true);}
     if(event.kind.startsWith('paused_')||event.kind==='interrupted_by_planning_override')paused=true;
     if(event.kind.startsWith('resumed_'))paused=false;
    }else{
     replicaWork('admission.eventSummaryReuse');const event=item.action,state=presentations.get(event.targetId)??fail();
     if(paused||Date.parse(event.at)<previousAt||!state.map[event.stepId]||runMaterial(saved.participants[event.targetId]!,state.map[event.stepId]!).snapshot.learningMaterializationId!==event.materializationId)fail();previousAt=Date.parse(event.at);state.acted.add(event.stepId);
     const retention=event.retention,current=restoredRevisions.get(event.targetId)!;
     state.evidence=[...new Set([...state.evidence,...event.evidenceIds])];
     if(state.completion)fail();
     if(retention?.kind==='initial_learning_completion'){if(!backupEqual(retention.handoff.evidenceIds,state.evidence))fail();state.completion={at:event.at,kind:retention.completion.completionKind};}
     if(retention?.kind==='relearning_completion'){if(!backupEqual(retention.completion.evidenceIds,state.evidence))fail();state.completion={at:event.at,kind:'relearning_completion'};}
     if(retention?.kind==='memory_outcome'&&saved.purpose==='retention_review')state.completion={at:event.at,kind:'review_completed'};
     if(retention?.kind==='initial_learning_completion'){if(current!==0)fail();restoredRevisions.set(event.targetId,1);}
     if(retention?.kind==='memory_outcome'){if(retention.schedulingDecision.priorMemoryRevision!==current)fail();restoredRevisions.set(event.targetId,retention.schedulingDecision.resultingMemoryRevision);}
     const next=event.nextPresentation;if(next)bind(next.targetId,next.stepId,next.material);
    }
    yield;
   }
   for(const id of ids){const p=saved.participants[id]!,state=presentations.get(id)!;if(!backupEqual(state.map,p.presentedMaterials)||!backupEqual(state.order,p.presentationOrder)||!backupEqual(state.evidence,p.evidenceIds)||!backupEqual(state.completion,saved.targetCompletions[id]??null))fail();}
   if(saved.completedAt){
    const last=revisions.get(saved.revision-1)??fail();const terminal='action' in last?last.action:fail();
    if(terminal.at!==saved.completedAt||terminal.nextPresentation!==null)fail();
    if(saved.completionKind==='wait_relearning'){if(saved.purpose!=='relearning'||ids.length!==1||terminal.retention?.kind!=='relearning_progress')fail();}
    else if(ids.some(id=>!saved.participants[id]!.progress.completed||!saved.targetCompletions[id]||saved.targetCompletions[id]!.kind!==saved.completionKind))fail();
   }else ids.forEach(id=>unfinished.add(id));
   continue;
  }
  const primary=targets.get(saved.targetId)??fail(),primaryExecutable=localExecutableTargetForParticipant(primary,saved.participants[saved.targetId]??fail());
  let run=replayLocalProtocolRun({execution,target:primaryExecutable,resource:primaryExecutable.packageKey?maps.packageCache.get(primaryExecutable.packageKey):undefined,saved});
  if(!Object.hasOwn(saved,'completionKind'))delete run.completionKind;
  const byRevision=new Map<number,{actionKey:string}|{lifecycle:LocalLearningRun['lifecycleEvents'][number]}>();
  for(const event of eventHeaders){const revision=event.revision;if(!Number.isSafeInteger(revision)||revision<1||byRevision.has(revision))fail();byRevision.set(revision,{actionKey:event.key});yield;}
  for(const event of saved.lifecycleEvents){if(byRevision.has(event.runRevision))fail();byRevision.set(event.runRevision,{lifecycle:event});yield;}
  if(!Number.isSafeInteger(saved.revision)||saved.revision!==1+byRevision.size)fail();
  for(let revision=1;revision<saved.revision;revision++){
   yield;
   const item=byRevision.get(revision)??fail();if(run.revision!==revision)fail();
   if('lifecycle' in item){
    const event=item.lifecycle;if(run.completedAt)fail();
    if(event.kind==='current_step_material_refreshed'){
     const targetId=localProtocolActiveTargetId(execution,run),stepId=localProtocolStepId(execution,run),participant=run.participants[targetId];
     if(event.targetId!==targetId||event.stepId!==stepId||!participant?.presentedMaterials[stepId])fail();
     const material=runMaterialById(saved.participants[targetId]!,event.materializationId);
     if(Date.parse(material.snapshot.createdAt)>Date.parse(event.at)||Date.parse(material.snapshot.createdAt)<Date.parse(run.startedAt))fail();
     pinRunStepMaterial(participant,stepId,material);
    }
    run.lifecycleEvents.push(structuredClone(event));run.revision++;continue;
   }
   const event=requireRow('learningEvents',item.actionKey) as LearningEvent,targetId=localProtocolActiveTargetId(execution,run);
   if(!ids.includes(targetId)||event.targetId!==targetId||run.completedAt)fail();
   const target=targets.get(targetId)??fail(),participant=run.participants[targetId]??fail();
   timestamp.parse(event.at);if(Date.parse(event.at)<Date.parse(run.startedAt))fail();
   const detail=event.detail as any;
   if(detail.stepId!==localProtocolStepId(execution,run)||!Object.hasOwn(detail,'nextPresentation')||localRunOpenPlanningInterruption(run)||localRunOpenSessionPause(run))fail();
   const presented=runStepMaterial(participant,detail.stepId);if(event.kind!==detail.action?.kind||detail.materializationId!==presented.snapshot.learningMaterializationId||Date.parse(presented.snapshot.createdAt)>Date.parse(event.at)||!Object.hasOwn(detail,'personalLearningScene'))fail();
   const executable=localExecutableTargetForParticipant(target,participant,presented);
   const executed=reduceLocalProtocolAction({operationId:event.id,stepKey:detail.stepId,execution,target:executable,run,resource:executable.packageKey?maps.packageCache.get(executable.packageKey):undefined,action:detail.action,at:event.at});
   const applied=applyLocalProtocolTransition({operationId:event.id,stepId:detail.stepId,at:event.at,target,run:executed.run,transition:executed.transition});
   if(!backupEqual(executed.facts,detail.formalEvaluation)||!backupEqual(applied.record,detail.transition)||executed.facts&&!backupEqual(executed.facts.step.learningMaterializationIds,[detail.materializationId]))fail();targets.set(targetId,applied.target);run=executed.run;run.ordinal++;run.revision++;
   try{replayNextPresentation(run,execution,detail.nextPresentation,saved,event.at);}catch{fail();}
  }
  if(!backupEqual(run,saved))fail();if(!run.completedAt)ids.forEach(id=>unfinished.add(id));
  const states=new Map<string,{before:string;after:string}>();
  for(const [id,target] of targets){const state=retentionBaseline(target),participant=saved.participants[id]!,after=causalKey(id,state,target.committedPolicy);states.set(id,{before:causalKey(id,participant.retentionBaseline,participant.policyCommitment),after});causalStates.add(after);if(!historyOnlyRunIds.has(saved.id)){replayStates.set(id,state);effectiveCommitments.set(id,target.committedPolicy);}}
  runStates.set(saved.id,states);
 }
 // Superseded decisions remain audit facts. Their applied Runs must describe
 // one possible continuous branch, even after they cease driving today's state.
 for(const {value:decision} of rows.learningReconciliations){
  if(decision.algorithm==='latest-completed-learning-branch-v3'){
   // These exact before/after digests already exist for the explicit business
   // audit. They are never built by ordinary saved-state sync admission.
   const excluded=new Set<string>(decision.supersededDecisionIds.flatMap((id:string)=>requireRow('learningReconciliations',id).historyOnlyRunIds));
   const ids=[...decision.appliedRunIds,...decision.historyOnlyRunIds].filter((id:string)=>!excluded.has(id)) as string[];
   const inputs=new Set(ids.map(id=>runStates.get(id)?.get(decision.targetId)?.before??fail()));
   const heads:Array<LocalLearningRun>=[];
   for(const id of ids){const state=runStates.get(id)?.get(decision.targetId)??fail();if(state.before===state.after||!inputs.has(state.after))heads.push(requireRow('learningRuns',id));yield;}
   heads.sort((a,b)=>Date.parse(a.completedAt!)-Date.parse(b.completedAt!)||(a.id<b.id?-1:a.id>b.id?1:0));
   if(heads.at(-1)?.id!==decision.selectedRunId)fail();
  }
  const transitions=decision.appliedRunIds.map((id:string)=>runStates.get(id)?.get(decision.targetId)??fail()) as Array<{before:string;after:string}>;
  const outputs=new Set(transitions.filter(row=>row.before!==row.after).map(row=>row.after)),roots=new Set(transitions.filter(row=>!outputs.has(row.before)).map(row=>row.before));
  if(roots.size!==1)fail();let cursor=[...roots][0]!;const remaining=[...transitions];
  while(remaining.length){let index=remaining.findIndex(row=>row.before===cursor&&row.after===cursor);if(index<0)index=remaining.findIndex(row=>row.before===cursor);if(index<0)fail();cursor=remaining.splice(index,1)[0]!.after;yield;}
 }
 for(const {value:target} of rows.learningTargets){if((mode==='audit'||auditTargets.has(target.id))&&!unreplayedTargets.has(target.id)&&!backupEqual(target.committedPolicy,effectiveCommitments.get(target.id))||target.committedPolicy&&!knownProtocolRunIds.has(target.committedPolicy.committedByProtocolRunId))fail();yield;}
 for(const {value:target} of rows.learningTargets){if(mode==='restore'&&!auditTargets.has(target.id)&&!unreplayedTargets.has(target.id)&&target.memoryRevision!==(restoredRevisions.get(target.id)??0))fail();if((mode==='audit'||auditTargets.has(target.id))&&!unreplayedTargets.has(target.id))for(const key of replayFields)if(!backupEqual(replayStates.get(target.id)![key],target[key]))fail();yield;}
 if(active){const run=requireRow('learningRuns',active);if(localRunOpenPlanningInterruption(run)||localRunOpenSessionPause(run)||localRunTargetIds(run).some(id=>hasDeclaredMasteryOverride(requireRow('learningTargets',id))))fail();}
 for(const {key,value:operation} of rows.operations){
  if(operation.result?.format==='sensa-learning-run-receipt-v1'){
   const request=operationInput(key);try{verifyLearningRunReceiptFacts({id:key,kind:request.kind,input:request.input},operation.result,maps.learningRuns.get(operation.result.id),maps.learningEvents.get(key),request.kind==='learning.continue'?maps.learningRuns.get(request.input.runId):undefined);}catch{fail();}
  }
  yield;
 }
 assertSavedStudyPlans(input);
 yield*assertStudyScopeStateSteps(input);
}

export function assertLearningSystemState(input:LearningSystemStateInput):void{runSynchronously(assertLearningSystemStateSteps(input));}

const learningTransitionTables=[
 'curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','meta','settings',
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
 scopeMember?:(scopeId:string,targetId:string)=>Promise<LocalStudyScopeMember|null>;
 latestActionAt?:(runId:string)=>Promise<string|null>;
 capturedScopeIds?:readonly string[];
};

function assertScopeMember(member:LocalStudyScopeMember,scope:LocalStudyScope,target:LocalLearningTarget):void{
 if(member.targetId!==target.id||member.retentionTargetId!==target.retentionId||member.senseId!==target.identity.senseId||member.expressionId!==target.identity.expressionId||member.policy.assignmentId!==target.policyAssignment.assignmentId||member.policy.assignmentRevision>target.policyAssignment.revision)reject('Study Scope Target identity is inconsistent.');
 const profile=learningPolicyProfileRegistry.get(member.policy.profileId as LearningPolicyId,member.policy.profileVersion);
 for(const source of member.sources){
  const original=requireFact(target.curriculumMemberships.find(item=>item.id===source.membershipId),'Study Scope source is missing.');
  if(!sameLearningSourcePin(source.sourcePin,materialSourcePin(original.material))||original.sourceKind!==source.sourceKind||original.packageKey!==source.packageKey||original.revision<source.membershipRevision||!sameLearningSessionDirection(original.languageContext,scope.languageContext)||source.enrollmentId!==(typeof original.provenance.curriculumEnrollmentId==='string'?original.provenance.curriculumEnrollmentId:null)||original.revision===source.membershipRevision&&!backupEqual(original.provenance,source.provenance))reject('Study Scope source identity is inconsistent.');
  const snapshot={...original,status:source.membershipStatus,provenance:source.provenance};
  if(source.supplementalState&&(source.supplementalState.id!==source.membershipId||source.supplementalState.targetId!==target.id||source.supplementalState.status!=='active'||source.supplementalState.languageContext.languageRouteId!==scope.languageContext.languageRouteId||source.supplementalState.languageContext.targetLanguageTag!==scope.languageContext.targetLanguageTag))reject('Study Scope supplemental decision is inconsistent.');
  const caps=curriculumSourceEligibility(snapshot,source.enrollmentId?scope.enrollments.find(enrollment=>enrollment.id===source.enrollmentId):undefined,!!target.startedAt&&Date.parse(target.startedAt)<=Date.parse(scope.createdAt));
  if(source.introduce!==caps.introduce||source.ongoing!==(caps.introduce||caps.ongoing))reject('Study Scope source purpose is inconsistent.');
  for(const plan of source.plans){
   const {revisionId,...reference}=plan,binding=profile.protocols[plan.purpose];
   if(revisionId!==stableUuid(`local-scope-plan:${target.id}:${source.membershipId}:${canonicalJsonDigest(reference)}`)||plan.protocolId!==binding.protocolId||plan.protocolVersion!==binding.protocolVersion||plan.runtimeAdapterId!==binding.runtimeAdapterId||!backupEqual(plan.contentDemands,binding.contentDemands))reject('Study Scope plan does not resolve its effective Policy.');
   if(original.revision===source.membershipRevision&&plan.readiness==='ready'&&!plan.materializationIds.every(id=>id===original.material.snapshot.learningMaterializationId))reject('Study Scope plan references another materialization.');
  }
 }
}

/** The origin selection proves why the first Run was selected or resumed.
 * Later Runs have their own selection and must not inherit this inventory. */
function validSessionOrigin(session:LocalLearningSession,scope:LocalStudyScope,run:LocalLearningRun):boolean{
 return sameLearningSessionDirection(run.languageContext,session.languageContext)
  &&(session.intent!=='review_only'||run.purpose!=='initial_learning')
  &&run.targetIds.every(id=>scope.members.some(member=>member.targetId===id&&member.policy.profileId===run.policyProfileId&&member.policy.profileVersion===run.policyProfileVersion&&member.sources.some(source=>source.plans.some(plan=>plan.purpose===run.purpose&&plan.readiness==='ready'))))
  &&(run.startedByOperationId===session.startedByOperationId&&run.startedAt===session.startedAt&&run.sessionIntent===session.intent
   ||run.lifecycleEvents.some(event=>event.operationId===session.startedByOperationId&&event.at===session.startedAt&&'sessionIntent' in event&&event.sessionIntent===session.intent&&'requestedLanguageContext' in event&&backupEqual(event.requestedLanguageContext,session.languageContext)&&['session_intent_selected','resumed_after_session_switch','resumed_after_session_end','resumed_after_planning_override'].includes(event.kind)));
}

function* assertStudyScopeStateSteps(input:LearningSystemStateInput):Generator<void,void>{
 const {rows,maps,identity,requireRow,validateLanguageContext,fail}=input;
 for(const row of rows.studyScopes){
  yield;
  const scope=studyScopeSchema.parse(row.value);
  if(row.key!==scope.id||scope.learnerUserId!==identity.learnerId)fail();validateLanguageContext(scope.languageContext);
  for(const source of scope.enrollments){const current=curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',source.id));if(source.learnerUserId!==identity.learnerId||current.revision<source.revision||current.revision===source.revision&&!backupEqual(current,source))fail();}
  for(const source of scope.members.flatMap(member=>member.sources))if(source.supplementalState){const current=supplementalMembershipStateSchema.parse(requireRow('supplementalMembershipStates',source.supplementalState.id)),saved=source.supplementalState;if(current.revision<saved.revision||current.revision===saved.revision&&!backupEqual(current,saved)||current.createdByOperationId!==saved.createdByOperationId||!backupEqual(current.source,saved.source))fail();}
  for(const member of scope.members){assertScopeMember(member,scope,requireRow('learningTargets',member.targetId));yield;}
 }
 for(const row of rows.learningSessions){
  yield;
  const session=learningSessionSchema.parse(row.value),scope=studyScopeSchema.parse(requireRow('studyScopes',session.scopeRevisionId));
  if(row.key!==session.id||session.learnerUserId!==identity.learnerId||scope.learnerUserId!==session.learnerUserId||!backupEqual(session.languageContext,scope.languageContext)||session.dailyNewSenseLimit!==scope.dailyNewSenseLimit||Date.parse(session.startedAt)<Date.parse(scope.createdAt))fail();
  for(const id of session.runIds){const run=requireRow('learningRuns',id) as LocalLearningRun;if(!run.learningSessionId||!run.studyScopeRevisionId||run.learningSessionId!==session.id&&!validSessionOrigin(session,scope,run))fail();if(!sameLearningSessionDirection(run.languageContext,session.languageContext))fail();const selected=run.studyScopeRevisionId?studyScopeSchema.parse(requireRow('studyScopes',run.studyScopeRevisionId)):scope;for(const targetId of run.targetIds)if(!selected.members.some(member=>member.targetId===targetId))fail();}
  if(!validSessionOrigin(session,scope,requireRow('learningRuns',session.runIds[0]!) as LocalLearningRun))fail();
  if(session.endedAt){
   if(session.endReason==='learner_finished'){
    const last=requireRow('learningRuns',session.runIds.at(-1)!) as LocalLearningRun;
    if(!last.completedAt||Date.parse(session.endedAt)<Date.parse(last.completedAt))fail();
   }else if(session.endReason==='learner_ended'){
    if(!session.runIds.some(id=>(requireRow('learningRuns',id) as LocalLearningRun).lifecycleEvents.some(event=>event.kind==='paused_for_session_end'&&event.learningSessionId===session.id&&event.operationId===session.endedByOperationId&&event.at===session.endedAt)))fail();
   }else if(session.endReason==='session_switch'){
    if(input.syncScope?!input.syncScope.sessionStarted(session.endedByOperationId!,session.endedAt,session.id):!findLibraryRow(rows.learningSessions,({value:next})=>next.id!==session.id&&next.startedByOperationId===session.endedByOperationId&&next.startedAt===session.endedAt))fail();
   }else if(session.endReason==='planning_override'){
    if(!session.runIds.some(id=>(requireRow('learningRuns',id) as LocalLearningRun).lifecycleEvents.some(event=>event.kind==='interrupted_by_planning_override'&&event.operationId===session.endedByOperationId&&event.at===session.endedAt)))fail();
   }else fail();
  }
 }
 for(const {value:run} of rows.learningRuns){
  yield;
  if(!run.learningSessionId&&!run.studyScopeRevisionId)continue;
  const session=learningSessionSchema.parse(requireRow('learningSessions',run.learningSessionId)),scope=studyScopeSchema.parse(requireRow('studyScopes',run.studyScopeRevisionId));
  if(!session.runIds.includes(run.id)||!backupEqual(run.languageContext,session.languageContext)||!backupEqual(scope.languageContext,run.languageContext)||scope.dailyNewSenseLimit!==session.dailyNewSenseLimit)fail();
  for(const [targetId,participant] of Object.entries(run.participants as LocalLearningRun['participants'])){const member=scope.members.find(member=>member.targetId===targetId),source=member?.sources.find(source=>source.membershipId===participant.curriculumMembershipId);if(!source||member!.policy.profileId!==run.policyProfileId||member!.policy.profileVersion!==run.policyProfileVersion||!source.plans.some(plan=>plan.purpose===run.purpose&&plan.readiness==='ready'))fail();}
 }
 const active=maps.meta.get(activeLearningSessionKey);
 if(active){
  const session=learningSessionSchema.parse(requireRow('learningSessions',active));if(session.endedAt||session.activeRunId!==maps.meta.get('learning-active'))fail();
  const run=requireRow('learningRuns',session.activeRunId!) as LocalLearningRun;
  for(const id of run.targetIds){const target=requireRow('learningTargets',id) as LocalLearningTarget;if(!target.committedPolicy||target.committedPolicy.profileId!==run.policyProfileId||target.committedPolicy.profileVersion!==run.policyProfileVersion)fail();}
 }
 else {const activeRun=maps.meta.get('learning-active');if(activeRun&&(requireRow('learningRuns',activeRun) as LocalLearningRun).learningSessionId)fail();}
}

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
 for(const field of ['learnerUserId','senseId','expressionId','targetLanguageTag'] as const)z.string().min(1).parse(target.identity[field]);
 if(target.identity.learnerUserId!==input.identity.learnerId
  ||target.identity.targetLanguageTag!==target.targetLanguageTag
  ||target.id!==stableLearningTargetId(input.identity.learnerId,target.identity.senseId,target.identity.expressionId)
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
  assertMaterialAdmissionTime(membership.material,membership,membership.packageKey?undefined:await input.read('contentAttempts',membership.material.snapshot.provenance.attemptId as string));
  learningSupportMeaning(membership.material.content.resources,context.supportLanguageTag);
  if(!sameLearningSourcePin(membership.sourcePin,materialSourcePin(membership.material)))reject('Curriculum material has another admitted source.');
  assertLocalTargetMaterialIdentity(target,membership.material);
  const provenance=membership.material.snapshot.provenance as Record<string,any>;
  if(membership.sourceKind==='sense_learning_package'||membership.sourceKind==='stable_sense'&&membership.packageKey!==null){
   const packageKey=requireFact(membership.packageKey,'Published Curriculum package identity is missing.');
   const installation=packageInstallationSchema.parse(requireFact(await input.read('packageInstallations',packageKey),'Published Curriculum installation is missing.'));
   const enrollment=curriculumEnrollmentSchema.parse(requireFact(await input.read('curriculumEnrollments',z.string().uuid().parse(membership.provenance.curriculumEnrollmentId)),'Published Curriculum Enrollment is missing.'));
   if(enrollment.learnerUserId!==input.identity.learnerId||enrollment.languageContext.languageRouteId!==context.languageRouteId)reject('Published Curriculum Enrollment is inconsistent.');
   if(installation.artifact.targetLanguage!==context.targetLanguageTag||installation.artifact.supportLanguage!==context.supportLanguageTag)reject('Published Curriculum languages are inconsistent.');
   assertPublishedCurriculumSource(target,membership,enrollment,installation);
   if(membership.sourceKind==='stable_sense')assertDirectPublishedMembership(enrollment,target,membership,installation.artifact.digest);
   const pack=await input.read('packageCache',packageKey) as any;
   if(pack){
    const entry=pack.content.entries.find((candidate:any)=>candidate.senseVersionId===provenance.senseVersionId&&candidate.bindingVersionId===provenance.bindingVersionId);
    if(!entry||!sameLearningSourcePin(entry,materialSourcePin(membership.material))||pack.content.targetLanguage!==context.targetLanguageTag||pack.content.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,baseContentBeforeSupplement(membership.material,context.supportLanguageTag))||entry.assurancePackageKey!==membership.assurancePackageKey)reject('Published Curriculum material is inconsistent.');
   }
  }else if(membership.sourceKind==='stable_sense'){
   const attempt=requireFact(await input.read('contentAttempts',provenance.attemptId) as any,'Direct material attempt is missing.');
   const task=requireFact(await input.read('personalLearning',attempt.taskId) as any,'Direct content preparation is missing.');
   const enrollment=curriculumEnrollmentSchema.parse(await input.read('curriculumEnrollments',task.source.enrollmentId));
   assertDirectGeneratedMembership(enrollment,target,membership,task,attempt);
  }else if(membership.sourceKind==='personal_meaning_alignment'){
   const attempt=requireFact(await input.read('contentAttempts',provenance.attemptId) as any,'Personal material attempt is missing.');
   assertReadyContentAttempt(attempt);
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
  if(!sameLearningSourcePin(materialSourcePin(previous.material),materialSourcePin(current.material)))reject('Curriculum source versions are immutable.');
  if(current.revision!==previous.revision+1||!unchangedExcept(previous as unknown as Record<string,unknown>,current as unknown as Record<string,unknown>,['revision','status','material','updatedAt']))reject('Curriculum membership revision is invalid.');
  if(operation.kind==='learning.enroll'&&!backupEqual(previous.material,current.material))reject('A Book update cannot rewrite historical material.');
  if(operation.kind==='personal.progress'&&previous.status!==current.status)reject('Personal material refresh cannot change membership lifecycle.');
 }
}

function assertTargetTransition(before:LocalLearningTarget|null,after:LocalLearningTarget,operation:Operation,hasLearningEvent:boolean,newRunTargetIds:ReadonlySet<string>):void{
 if(!before){
  if(!['learning.enroll','learning.materialize','learning.quantity','learning.prepareDirect','personal.progress'].includes(operation.kind))reject('Only Curriculum admission may create a Learning Target.');
  if(after.policyAssignment.revision!==1||after.committedPolicy||after.startedAt||after.completedAt||after.memory||after.memoryRevision!==0||after.relearnAt||after.relearningState!==null)reject('A new Learning Target contains manufactured progress.');
  return;
 }
 if(!backupEqual(before.id,after.id)||!backupEqual(before.retentionId,after.retentionId)||!backupEqual(before.identity,after.identity)||before.expression!==after.expression||before.targetLanguageTag!==after.targetLanguageTag||before.createdAt!==after.createdAt)reject('Learning Target identity is immutable.');
 if(after.curriculumMemberships.length<before.curriculumMemberships.length)reject('Curriculum membership history cannot shrink.');
 assertMembershipTransition(before,after,operation);
 if(['learning.enroll','learning.materialize','learning.quantity','learning.prepareDirect','personal.progress'].includes(operation.kind)){
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
 const after=curriculumEnrollmentSchema.parse(change.after) as LocalCurriculumEnrollment;
 if(input.operation.kind!==(after.source.kind==='stable_sense'?'learning.enrollDirect':'learning.enroll')&&!(after.source.kind==='published_book'&&input.operation.kind==='learning.bookPlan'))reject('Only explicit Curriculum enrollment or Book planning may change Enrollment facts.');
 if(change.key!==after.id||after.learnerUserId!==input.identity.learnerId||after.status!=='active')reject('Curriculum Enrollment identity is invalid.');
 const route=routes.get(after.languageContext.languageRouteId);
 if(!route||route.targetLanguageTag!==after.languageContext.targetLanguageTag||after.languageContext.languageRouteRevision>route.revision)reject('Curriculum Enrollment Language Route is invalid.');
 if(change.before!==null){
  const before=curriculumEnrollmentSchema.parse(change.before) as LocalCurriculumEnrollment;
  if(before.id!==after.id||before.learnerUserId!==after.learnerUserId||before.createdAt!==after.createdAt||before.createdByOperationId!==after.createdByOperationId||after.revision!==before.revision+1)reject('Curriculum Enrollment revision is invalid.');
  if(after.source.kind==='stable_sense')reject('A direct enrollment cannot silently replace its accepted source.');
  if(input.operation.kind==='learning.bookPlan'){
   const command=input.operation.input as {enrollmentId:string;expectedRevision:number;mode:string;selection:unknown;languageContext:unknown};
   const plan=requireFact(after.bookPlan,'Book planning is missing its resolved Range.');
   if(!unchangedExcept(before,after,['revision','bookPlan','updatedAt'])||plan.changedByOperationId!==input.operation.id||plan.revision!==(before.bookPlan?.revision??0)+1||plan.updatedAt!==after.updatedAt)reject('Book planning changed immutable source facts.');
   if(after.id===command.enrollmentId){
    if(command.expectedRevision!==before.revision||command.mode!==plan.mode||!backupEqual(command.selection,plan.range.selection)||!sameLearningSessionDirection(after.languageContext,sensaFormalPinnedLanguageContextSchema.parse(command.languageContext)))reject('Book planning differs from the reviewed selection.');
    if(before.bookPlan&&backupEqual(command.selection,before.bookPlan.range.selection)&&!backupEqual(before.bookPlan.range,plan.range))reject('Mode-only changes must retain the original Range snapshot.');
   }else{
    const selected=curriculumEnrollmentSchema.parse(await input.read('curriculumEnrollments',command.enrollmentId));
    if(command.mode!=='active'||selected.bookPlan?.mode!=='active'||selected.bookPlan.changedByOperationId!==input.operation.id||plan.mode!=='maintenance'||(before.bookPlan?.mode??'active')!=='active'||before.languageContext.languageRouteId!==sensaFormalPinnedLanguageContextSchema.parse(command.languageContext).languageRouteId||before.bookPlan&&!backupEqual(before.bookPlan.range,plan.range))reject('Activating a Book may only maintain the previous active source.');
   }
  }
 }else if(input.operation.kind==='learning.bookPlan'){
  reject('Book planning cannot create an Enrollment.');
 }
 if(after.source.kind==='portable_package'){
  const installation=packageInstallationSchema.parse(requireFact(await input.read('packageInstallations',after.source.packageKey),'Curriculum package installation is missing.'));
  if(installation.artifact.packageId!==after.source.packageId||installation.artifact.version!==after.source.packageVersion)reject('Curriculum package source is inconsistent.');
 }else if(after.source.kind==='stable_sense'){
  const {selection}=after.source;
  const reviewed=z.object({reference:directLearningReferenceSchema,expectedDigest:z.string().regex(/^[a-f0-9]{64}$/u),languageContext:sensaFormalPinnedLanguageContextSchema}).parse(input.operation.input);
  if(selection.targetLanguageTag!==after.languageContext.targetLanguageTag)reject('Direct Curriculum source language is inconsistent.');
  const source=await resolveDirectLearningSource({get:(table,key)=>input.read(table,key)},selection.reference,selection.sourceDigest);
  const reviewedSource=await resolveDirectLearningSource({get:(table,key)=>input.read(table,key)},reviewed.reference,reviewed.expectedDigest);
  if(after.createdByOperationId!==input.operation.id||!backupEqual(source,selection)||!backupEqual(reviewedSource,selection)||reviewed.expectedDigest!==selection.sourceDigest
    ||!backupEqual(reviewed.languageContext,after.languageContext))reject('Direct Curriculum source was not the reviewed selection.');
 }else{
  // Each materialized member is checked again at the Learning Target boundary.
  z.string().regex(/^[a-f0-9]{64}$/u).parse(after.source.publicationArchiveSha256);
  if(after.bookPlan&&after.bookPlan.range.selection.kind!=='all'){
   const keys=[...new Set(after.bookPlan.range.members.map(member=>member.packageKey))];
   const installations=await Promise.all(keys.map(async key=>packageInstallationSchema.parse(requireFact(await input.read('packageInstallations',key),'Book Range installation is missing.'))));
   const packages=(await Promise.all(keys.map(key=>input.read('packageCache',key)))).filter(Boolean) as any[];
   assertResolvedBookRange(after.bookPlan.range,installations,packages);
  }
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
 if(run.sessionIntent!==undefined&&!['mixed','review_only'].includes(run.sessionIntent)||localRunSessionIntent(run)==='review_only'&&run.purpose==='initial_learning')reject('Review-only Sessions cannot introduce initial learning.');
 const context=sensaFormalPinnedLanguageContextSchema.parse(run.languageContext),route=routes.get(context.languageRouteId);
 if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision)reject('Learning Run Language Route is invalid.');
 const ids=localRunTargetIds(run);
 if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(run.targetId)||!backupEqual(Object.keys(run.participants).sort(),[...ids].sort())||!Object.keys(run.targetCompletions).every(id=>ids.includes(id)))reject('Learning Run participants are inconsistent.');
 const execution=localExecutionForRun(run),binding=localRunBinding(run),profile=learningPolicyProfileRegistry.get(localRunPolicy(run),run.policyProfileVersion);
 if(!backupEqual(run.protocolBinding,profile.protocols[run.purpose])||!backupEqual(run.schedulingPolicy,profile.lifecycle.schedulingPolicy)||run.schedulingPolicyId!==profile.lifecycle.schedulingPolicyId||run.learnerVisibleClaimBoundary!==profile.lifecycle.learnerVisibleClaimBoundary||run.protocolVersion!==binding.localProtocolVersion)reject('Learning Run pinned policy is inconsistent.');
 for(const [targetId,participant] of Object.entries(run.participants)){
  const target=requireFact(await input.read('learningTargets',targetId) as LocalLearningTarget|undefined,'Learning Run Target is missing.');
  const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId);
  if(!membership||!backupEqual(participant.languageContext,context)||!samePinnedDirection(membership.languageContext,participant.languageContext))reject('Learning Run participant membership is inconsistent.');
  if(!baselineBindsSelectedMembership(run,target,participant))reject('Learning Run baseline differs from its selected source.');
  uuid.parse(participant.protocolRunId);
  for(const material of validateRunMaterialPins(participant)){
   validateLightweightInitialMaterialization(material);assertLocalTargetMaterialIdentity(target,material);
   const provenance=material.snapshot.provenance,attempt=provenance.packageKey?undefined:await input.read('contentAttempts',provenance.attemptId as string) as any;
   const task=attempt?await input.read('personalLearning',attempt.taskId) as any:undefined;
   const source=provenance.packageKey?publishedMaterialMembership(target,material,participant.languageContext):target.curriculumMemberships.find(candidate=>candidate.id===task?.curriculumMembershipId);
   if(!source)reject('Learning material has no admitted Curriculum source.');
   assertMaterialAdmissionTime(material,source!,attempt);
   if(!sameLearningSourcePin(source!.sourcePin,materialSourcePin(material))||task&&!sameLearningSourcePin(task.source,materialSourcePin(material)))reject('Run material has another accepted source.');
  }
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
   !backupEqual(plan.learningMaterializationIds,[runBaselineMaterial(participant).snapshot.learningMaterializationId])&&'materialization',
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
  if(input.operation.kind!=='learning.act'||input.operation.id!==event.id||event.runId!==runChange.key||command.runId!==event.runId||command.revision!==beforeRun.revision||event.detail.runRevision!==beforeRun.revision||command.at!==event.at||!backupEqual(command.action,event.detail.action))reject('Learning Event does not match its command.');
 const execution=localExecutionForRun(beforeRun),targetId=localProtocolActiveTargetId(execution,beforeRun),stepId=localProtocolStepId(execution,beforeRun);
 const beforeTarget=(targetChange?.before??await input.read('learningTargets',targetId)) as LocalLearningTarget|undefined;
 const afterTarget=(targetChange?.after??await input.read('learningTargets',targetId)) as LocalLearningTarget|undefined;
 if(!beforeTarget||!afterTarget||event.targetId!==targetId||event.detail.stepId!==stepId||beforeRun.completedAt||localRunOpenPlanningInterruption(beforeRun)||localRunOpenSessionPause(beforeRun))reject('Learning Event points at the wrong Run step.');
 const priorTarget=requireFact(beforeTarget,'Learning Event prior Target is missing.'),nextTarget=requireFact(afterTarget,'Learning Event Target projection is missing.');
 const participant=beforeRun.participants[targetId],presented=participant?.presentedMaterials[stepId]?runStepMaterial(participant,stepId):undefined;
 if(!participant||!presented||event.kind!==event.detail.action.kind||event.detail.materializationId!==presented.snapshot.learningMaterializationId||Date.parse(event.at)<Date.parse(beforeRun.startedAt)||Date.parse(presented.snapshot.createdAt)>Date.parse(event.at))reject('Learning Event materialization is inconsistent.');
 if(event.detail.personalLearningScene!==null){
  const pinned=z.object({sceneId:z.string().uuid(),revisionId:z.string().uuid(),revision:z.number().int().positive()}).strict().parse(event.detail.personalLearningScene);
  const scene=await input.read('annotations',personalLearningSceneRowId(targetId,participant.languageContext.languageRouteId)) as any;
  const revision=scene?.kind==='learning_scene'&&scene.sceneId===pinned.sceneId?scene.revisions.find((candidate:any)=>candidate.revisionId===pinned.revisionId):undefined;
  if(!revision||revision.revision!==pinned.revision||revision.createdAt>Date.parse(event.at))reject('Learning Event scene reference is inconsistent.');
 }
 const executable=localExecutableTargetForParticipant(priorTarget,participant,presented),pack=executable.packageKey?await input.read('packageCache',executable.packageKey) as any:undefined;
 validateLocalProtocolResources(execution,executable,pack);
 // This is authority replay, not a second user-facing calculation: the write
 // proposal is admitted only when the canonical reducer reproduces every
 // persisted fact and projection from the command plus prior state.
 const executed=reduceLocalProtocolAction({operationId:event.id,stepKey:stepId,execution,target:executable,run:beforeRun,resource:pack,action:event.detail.action,at:event.at});
 const applied=applyLocalProtocolTransition({operationId:event.id,stepId,at:event.at,target:priorTarget,run:executed.run,transition:executed.transition});
 if(!backupEqual(executed.facts,event.detail.formalEvaluation)||!backupEqual(applied.record,event.detail.transition)||!backupEqual(applied.target,nextTarget))reject('Learning Event settlement does not reproduce its Target projection.');
 const expected=structuredClone(executed.run);expected.ordinal++;expected.revision++;
 replayNextPresentation(expected,execution,event.detail.nextPresentation,afterRun,event.at);
 if(!expected.completedAt){const nextTargetId=localProtocolActiveTargetId(execution,expected),material=runStepMaterial(expected.participants[nextTargetId]!,localProtocolStepId(execution,expected));validateLightweightInitialMaterialization(material);assertLocalTargetMaterialIdentity(requireFact(await input.read('learningTargets',nextTargetId) as LocalLearningTarget|undefined,'The next Learning Target is missing.'),material);}
 if(!backupEqual(expected,afterRun))reject('Learning Event does not reproduce its Run projection.');
 validateEventFacts(event,afterRun);
}

async function assertLifecycleRunTransition(input:LearningSystemTransitionInput,before:LocalLearningRun,after:LocalLearningRun):Promise<void>{
 if(before.completedAt)reject('A completed Learning Run is immutable.');
 if(after.revision!==before.revision+1||after.ordinal!==before.ordinal||after.lifecycleEvents.length!==before.lifecycleEvents.length+1||!backupEqual(before.lifecycleEvents,after.lifecycleEvents.slice(0,-1)))reject('Learning Run lifecycle revision is invalid.');
 const event=after.lifecycleEvents.at(-1)!;
 if(event.runRevision!==before.revision)reject('Learning lifecycle fact differs from its causal Run revision.');
 if(['resumed_after_session_switch','resumed_after_session_end','session_intent_selected','resumed_after_planning_override'].includes(event.kind)){
  const selection=event as Extract<LocalLearningRun['lifecycleEvents'][number],{kind:'resumed_after_session_switch'|'resumed_after_session_end'|'session_intent_selected'|'resumed_after_planning_override'}>,command=input.operation.input as any;
  verifyLearningSelectionWitness(after,selection,selection.continuedFromRunId?await input.read('learningRuns',selection.continuedFromRunId) as LocalLearningRun|undefined:undefined);
  if(!backupEqual(selection.requestedLanguageContext,command.languageContext)||selection.continuedFromRunId!==(input.operation.kind==='learning.continue'?command.runId:undefined))reject('Learning Session selection witness differs from its entry command.');
 }
 if(!unchangedExcept(before as unknown as Record<string,unknown>,after as unknown as Record<string,unknown>,['revision','lifecycleEvents','participants']))reject('Learning Run lifecycle changed unrelated facts.');
 if(event.kind==='paused_for_session_switch'){
  const command=input.operation.input as any;
  if(event.operationId!==input.operation.id||!['learning.start','learning.continue'].includes(input.operation.kind)||command.targetId!==event.selectedTargetId||event.at!==command.at||localRunTargetIds(before).includes(event.selectedTargetId)||localRunOpenSessionPause(before)||localRunOpenPlanningInterruption(before)||!backupEqual(before.participants,after.participants))reject('Learning Session pause is invalid.');
 }else if(event.kind==='paused_for_session_end'){
  const command=input.operation.input as {runId:string;expectedRevision:number;at:string};
  const session=learningSessionSchema.parse(await input.read('learningSessions',event.learningSessionId));
  const readLatestActionAt=input.latestActionAt??reject('Ending a Session requires its accepted Action time.');
  const latestActionAt=await readLatestActionAt(before.id);
  if(latestActionAt&&Date.parse(event.at)<Date.parse(latestActionAt)||before.lifecycleEvents.some(previous=>Date.parse(previous.at)>Date.parse(event.at)))reject('A Session cannot end before its accepted work.');
  if(event.operationId!==input.operation.id||input.operation.kind!=='learning.endSession'||command.runId!==before.id||command.expectedRevision!==before.revision||event.eventId!==stableUuid(`local-run-session-end:${before.id}:${input.operation.id}`)||event.at!==command.at||session.endedByOperationId!==input.operation.id||session.endedAt!==event.at||session.endReason!=='learner_ended'||!session.runIds.includes(before.id)||localRunOpenSessionPause(before)||localRunOpenPlanningInterruption(before)||!backupEqual(before.participants,after.participants))reject('Explicit Learning Session end is invalid.');
 }else if(event.kind==='resumed_after_session_switch'||event.kind==='resumed_after_session_end'){
  const command=input.operation.input as any,open=localRunOpenSessionPause(before);
  if(event.operationId!==input.operation.id||!['learning.start','learning.continue'].includes(input.operation.kind)||!open||event.kind!==(open.kind==='paused_for_session_end'?'resumed_after_session_end':'resumed_after_session_switch')||event.interruptionEventId!==open.eventId||event.at!==command.at||Date.parse(event.at)<Date.parse(open.at)||!localRunTargetIds(before).includes(command.targetId)||event.sessionIntent!==(command.sessionIntent??event.sessionIntent)||!backupEqual(before.participants,after.participants))reject('Learning Session resume is invalid.');
 }else if(event.kind==='session_intent_selected'){
  const command=input.operation.input as any;
  if(event.operationId!==input.operation.id||input.operation.kind!=='learning.start'||!localRunTargetIds(before).includes(command.targetId)||event.at!==command.at||event.sessionIntent!==command.sessionIntent||localRunOpenSessionPause(before)||localRunOpenPlanningInterruption(before)||!backupEqual(before.participants,after.participants))reject('Learning Session intent selection is invalid.');
 }else if(event.kind==='interrupted_by_planning_override'){
  const command=input.operation.input as any;
  if(event.operationId!==input.operation.id||input.operation.kind!=='learning.declareMastery'||command.active!==true||command.targetId!==event.targetId||event.overrideKind!=='declared_mastery'||event.at!==command.at||!backupEqual(before.participants,after.participants))reject('Learning Run interruption is invalid.');
 }else if(event.kind==='resumed_after_planning_override'){
  const command=input.operation.input as any,open=localRunOpenPlanningInterruption(before);
  if(event.operationId!==input.operation.id||!['learning.start','learning.continue'].includes(input.operation.kind)||!open||event.interruptionEventId!==open.eventId||event.at!==command.at||!backupEqual(before.participants,after.participants))reject('Learning Run resume is invalid.');
  if(event.sessionIntent!==undefined&&(!['mixed','review_only'].includes(event.sessionIntent)||event.sessionIntent!==(command.sessionIntent??event.sessionIntent)))reject('Learning Session resume intent is invalid.');
 }else if(event.kind==='current_step_material_refreshed'){
  const execution=localExecutionForRun(before);
  if(event.targetId!==localProtocolActiveTargetId(execution,before)||event.stepId!==localProtocolStepId(execution,before))reject('Only the current unacted Learning Step may refresh its material.');
  const command=input.operation.input as any;
  const refreshed=after.participants[event.targetId]?.presentedMaterials[event.stepId]?runStepMaterial(after.participants[event.targetId]!,event.stepId):undefined;
  const personal=input.operation.kind==='personal.progress'&&event.operationId===command.attemptId;
  const portable=input.operation.kind==='learning.enroll'&&event.operationId===input.operation.id
   &&(command.key===refreshed?.snapshot.provenance.packageKey
    ||typeof command.publicationArchiveSha256==='string'&&command.publicationArchiveSha256===refreshed?.snapshot.provenance.publicationArchiveSha256);
  if(!personal&&!portable||event.eventId!==stableUuid(`local-run-material-refresh:${after.id}:${event.operationId}:${event.stepId}`)||event.materializationId!==refreshed?.snapshot.learningMaterializationId)reject('Learning Run material refresh is invalid.');
  const expected=structuredClone(before);
  if(!before.participants[event.targetId]?.presentedMaterials[event.stepId]||!refreshed)reject('Learning Run material refresh has no prior Step material.');
  if(Date.parse(refreshed!.snapshot.createdAt)>Date.parse(event.at)||Date.parse(refreshed!.snapshot.createdAt)<Date.parse(before.startedAt))reject('Learning refreshed material did not exist at its lifecycle fact.');
  pinRunStepMaterial(expected.participants[event.targetId]!,event.stepId,refreshed!);expected.revision=after.revision;expected.lifecycleEvents=after.lifecycleEvents;
  if(!backupEqual(expected,after))reject('Learning Run material refresh changed unrelated facts.');
 }else reject('Unknown Learning Run lifecycle event.');
}

function assertStudyPlanTransition(change:LibraryRecordTransition<readonly LearningTransitionTable[]>,operation:Operation,routes:Awaited<ReturnType<typeof transitionRoutes>>):void{
 const before=(change.before??{}) as Record<string,any>,after=requireFact(change.after as Record<string,any>|null,'Study Plans cannot be deleted.');
 const changed=Object.keys(after).filter(routeId=>!backupEqual(before[routeId],after[routeId]));
 if(changed.length!==1||Object.keys(before).some(routeId=>!Object.hasOwn(after,routeId)))reject('Study Plan history is inconsistent.');
 const routeId=changed[0]!,plan=after[routeId],previous=before[routeId],route=routes.get(routeId);
 if(operation.kind!=='learning.quantity'){
  const command=operation.input as {languageContext:z.infer<typeof sensaFormalPinnedLanguageContextSchema>;dailyLimit:number;at:string};
  if(!['learning.start','learning.continue'].includes(operation.kind)||previous!==undefined||command.dailyLimit!==DEFAULT_DAILY_NEW_SENSE_LIMIT||plan.dailyNewSenseLimit!==DEFAULT_DAILY_NEW_SENSE_LIMIT||routeId!==command.languageContext.languageRouteId||plan.routeRevision!==command.languageContext.languageRouteRevision||plan.updatedAt!==command.at)reject('A start may only initialize its missing default Study Plan.');
 }
 if(!route||plan.languageRouteId!==routeId||plan.routeRevision>route.revision||plan.revision!==(previous?.revision??0)+1||!Number.isInteger(plan.dailyNewSenseLimit)||plan.dailyNewSenseLimit<1||plan.dailyNewSenseLimit>100||!Number.isFinite(Date.parse(plan.updatedAt)))reject('Study Plan revision is invalid.');
}

/**
 * Admits one locally proposed Learning System transaction. Only changed facts
 * and their direct dependencies are read; complete history replay remains the
 * state-admission path used by Sync and backup restore.
 */
export async function assertLearningSystemTransition(input:LearningSystemTransitionInput):Promise<void>{
 const relevant=input.changes.filter(change=>change.table!=='meta'||['learning-active',activeLearningSessionKey].includes(change.key)).filter(change=>change.table!=='settings'||change.key==='language-route-study-plans');
 if(!relevant.length)return;
 if(['learning.start','learning.continue','learning.act','learning.endSession'].includes(input.operation.kind)){
  const at=Date.parse((input.operation.input as {at?:string}).at??'');
  if(!Number.isFinite(at)||at>Date.now())reject('Learning commands cannot manufacture future eligibility.');
 }
 const routes=await transitionRoutes(input);
 const decisions=changedByTable({...input,changes:relevant},'supplementalMembershipStates');
 if(decisions.length){
  if(input.operation.kind!=='learning.changeSupplementalMembership'||decisions.length!==1||relevant.length!==1)reject('Supplemental governance may change only its explicit source decision.');
  const command=input.operation.input as {source:SupplementalMembershipState['source'];expectedRevision:number;active:boolean;languageContext:SupplementalMembershipState['languageContext']};
  const change=decisions[0]!,after=supplementalMembershipStateSchema.parse(change.after),before=change.before?supplementalMembershipStateSchema.parse(change.before):null;
  const descriptor=supplementalSourceDescriptor(after.source,await input.read(after.source.kind==='stable_sense'?'curriculumEnrollments':'personalLearning',after.source.id),input.identity.learnerId);
  assertSupplementalStateSource(after,descriptor);const route=routes.get(after.languageContext.languageRouteId);if(!route||route.targetLanguageTag!==after.languageContext.targetLanguageTag||after.languageContext.languageRouteRevision>route.revision)reject('Supplemental Membership Language Route is invalid.');
  if(change.after===null||change.key!==after.id||after.learnerUserId!==input.identity.learnerId||!backupEqual(command.source,after.source)||command.expectedRevision!==(before?.revision??0)||after.revision!==command.expectedRevision+1||after.status!==(command.active?'active':'removed')||!sameLearningSessionDirection(command.languageContext,after.languageContext)||after.changedByOperationId!==input.operation.id||Date.parse(after.updatedAt)>Date.now())reject('Supplemental governance has no explicit learner witness.');
  if(before){if(!unchangedExcept(before,after,['revision','status','languageContext','changedByOperationId','updatedAt'])||before.languageContext.languageRouteId!==after.languageContext.languageRouteId||before.languageContext.targetLanguageTag!==after.languageContext.targetLanguageTag||before.status===after.status)reject('Supplemental source identity is immutable.');}
  else if(after.createdByOperationId!==input.operation.id)reject('Supplemental withdrawal has no creation witness.');
 }
 const targets=changedByTable({...input,changes:relevant},'learningTargets');
 const enrollments=changedByTable({...input,changes:relevant},'curriculumEnrollments');
 const runs=changedByTable({...input,changes:relevant},'learningRuns');
 const events=changedByTable({...input,changes:relevant},'learningEvents');
 const reconciliations=changedByTable({...input,changes:relevant},'learningReconciliations');
 const scopes=changedByTable({...input,changes:relevant},'studyScopes'),sessions=changedByTable({...input,changes:relevant},'learningSessions');
 if(input.operation.kind==='learning.endSession'){
  const command=input.operation.input as {runId:string;expectedRevision:number;at:string};
  const runFocus=relevant.find(change=>change.table==='meta'&&change.key==='learning-active'),sessionFocus=relevant.find(change=>change.table==='meta'&&change.key===activeLearningSessionKey);
  if(runs.length!==1||sessions.length!==1||scopes.length||targets.length||events.length||enrollments.length||reconciliations.length||relevant.some(change=>change.table==='settings')||runs[0]!.key!==command.runId||runFocus?.before!==command.runId||runFocus.after!==null||sessionFocus?.before!==sessions[0]!.key||sessionFocus.after!==null)reject('Ending a Session must preserve work and atomically clear both active pointers.');
 }
 for(const change of scopes){
  if(change.after===null||change.before!==null&&!backupEqual(change.before,change.after))reject('Study Scopes are immutable.');
  const scope=studyScopeSchema.parse(change.after);
  if(change.key!==scope.id||scope.learnerUserId!==input.identity.learnerId||change.before===null&&(!['learning.start','learning.continue'].includes(input.operation.kind)||scope.createdByOperationId!==input.operation.id||scope.createdAt!==(input.operation.input as {at:string}).at||!input.capturedScopeIds?.includes(scope.id)))reject('Study Scope has no selected-Run capture witness.');
 }
 for(const change of sessions){
  if(change.after===null||!['learning.start','learning.continue','learning.finish','learning.endSession','learning.declareMastery'].includes(input.operation.kind))reject('Learning Session lifecycle authority is invalid.');
  const session=learningSessionSchema.parse(change.after);
  if(change.key!==session.id||session.learnerUserId!==input.identity.learnerId)reject('Learning Session identity is invalid.');
  if(change.before===null){
   const scope=studyScopeSchema.parse(await input.read('studyScopes',session.scopeRevisionId));
   if(!['learning.start','learning.continue'].includes(input.operation.kind)||session.revision!==1||session.startedByOperationId!==input.operation.id||session.startedAt!==(input.operation.input as {at:string}).at||session.endedAt||session.runIds.length!==1||session.activeRunId!==session.runIds[0]||!backupEqual(session.languageContext,scope.languageContext)||session.dailyNewSenseLimit!==scope.dailyNewSenseLimit)reject('Learning Session creation is invalid.');
   const firstRun=await input.read('learningRuns',session.runIds[0]!) as LocalLearningRun|undefined;
   if(!firstRun||!validSessionOrigin(session,scope,firstRun))reject('Learning Session origin selection is invalid.');
  }else{
   const before=learningSessionSchema.parse(change.before);
   if(before.endedAt||session.revision!==before.revision+1||!unchangedExcept(before,session,['revision','runIds','activeRunId','endedAt','endedByOperationId','endReason'])||!backupEqual(session.runIds.slice(0,before.runIds.length),before.runIds)||session.runIds.length>before.runIds.length+1)reject('Learning Session changed its frozen arrangement.');
   if(session.endedAt){
    if(session.endedByOperationId!==input.operation.id||!backupEqual(before.runIds,session.runIds)||!before.activeRunId)reject('Learning Session end witness is invalid.');
    const last=await input.read('learningRuns',before.activeRunId!) as LocalLearningRun|undefined;
    const command=input.operation.input as {runId?:string;targetId?:string;expectedRevision?:number;at?:string};
    if(session.endReason==='learner_finished'&&(input.operation.kind!=='learning.finish'||command.runId!==before.activeRunId||!last?.completedAt||Date.parse(session.endedAt)<Date.parse(last.completedAt))
     ||session.endReason==='learner_ended'&&(input.operation.kind!=='learning.endSession'||command.runId!==before.activeRunId||session.endedAt!==command.at||!last||last.completedAt||last.revision!==Number(command.expectedRevision)+1||!last.lifecycleEvents.some(event=>event.kind==='paused_for_session_end'&&event.learningSessionId===session.id&&event.operationId===input.operation.id&&event.at===session.endedAt))
     ||session.endReason==='session_switch'&&(!['learning.start','learning.continue'].includes(input.operation.kind)||session.endedAt!==command.at)
     ||session.endReason==='planning_override'&&(input.operation.kind!=='learning.declareMastery'||!last||!command.targetId||!localRunTargetIds(last).includes(command.targetId)||!last.lifecycleEvents.some(event=>event.kind==='interrupted_by_planning_override'&&event.operationId===input.operation.id&&event.at===session.endedAt))
     ||session.endReason==='plan_change')reject('Learning Session end reason lacks its command witness.');
   }
   if(!session.endedAt&&!['learning.start','learning.continue'].includes(input.operation.kind))reject('Only explicit Run selection may move Session focus.');
  }
 }
 if(reconciliations.length)reject('Learning Reconciliation is created only by replica merge.');
 if(events.length>1)reject('A local command may append only one Learning Event.');
 for(const change of [...enrollments,...scopes,...sessions,...targets,...runs,...events])if(change.after===null)reject(`${change.table} facts cannot be physically deleted.`);
 for(const change of enrollments)await assertCurriculumEnrollmentTransition(input,change,routes);
 for(const change of events)if(change.before!==null)reject('Learning Events are append-only.');
 const newRunTargetIds=new Set(runs.filter(change=>change.before===null).flatMap(change=>localRunTargetIds(change.after as LocalLearningRun)));
 for(const change of targets){
  const after=requireFact(change.after as LocalLearningTarget|null,'Learning Target is missing.');
  if(input.operation.kind==='learning.prepareDirect'){
   const request=z.object({enrollmentId:z.string().uuid()}).parse(input.operation.input),before=change.before as LocalLearningTarget|null;
   const added=after.curriculumMemberships.filter(item=>!before?.curriculumMemberships.some(previous=>previous.id===item.id));
   if(added.length!==1||added[0]!.sourceKind!=='stable_sense'||added[0]!.provenance.curriculumEnrollmentId!==request.enrollmentId||added[0]!.createdByOperationId!==input.operation.id)reject('Direct preparation may admit only its selected Curriculum connection.');
  }
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
   const request=input.operation.input as any;
   if(after.startedByOperationId!==input.operation.id)reject('New Learning Run has no immutable creation witness.');
   const previous=input.operation.kind==='learning.continue'?requireFact(await input.read('learningRuns',request.runId) as LocalLearningRun|undefined,'Preceding Learning Run is missing.'):undefined;
   if(previous)assertLearningContinuationPurpose(request,previous,after);
   const intent=previous?localRunSessionIntent(previous):request.sessionIntent??'mixed';
   if(after.startedAt!==request.at||!(after.learningSessionId?sameLearningSessionDirection(after.languageContext,request.languageContext):backupEqual(after.languageContext,request.languageContext))||after.continuedFromRunId!==(previous?.id)||previous&&!lawfulLearningPredecessor(previous,after.languageContext,after.startedAt,intent,after.id))reject('Learning continuation has no lawful completed predecessor.');
   if((after.sessionIntent??'mixed')!==intent)reject('Learning Session intent differs from its entry command.');
   const primary=requireFact(await input.read('learningTargets',after.targetId) as LocalLearningTarget|undefined,'Learning Run primary Target is missing.'),participant=after.participants[after.targetId];
   if(request.requiredPurpose!==undefined&&(!primary.relearnAt||primary.memoryRevision!==previous?.participants[after.targetId]?.memoryRevision||input.changes.find(change=>change.table==='meta'&&change.key==='learning-active')?.before!==previous?.id))reject('Relearning retry no longer has the same pending repair.');
   const execution=localExecutionForRun(after),executable=localExecutableTargetForParticipant(primary,participant),pack=executable.packageKey?await input.read('packageCache',executable.packageKey) as any:undefined;
   const replayed=replayLocalProtocolRun({execution,target:executable,resource:pack,saved:after});
   const initialTargetId=localProtocolActiveTargetId(execution,replayed),initialStepId=localProtocolStepId(execution,replayed);
   for(const [targetId,pin] of Object.entries(after.participants)){
    const target=requireFact(await input.read('learningTargets',targetId) as LocalLearningTarget|undefined,'Learning Run Target is missing.'),membership=requireFact(target.curriculumMemberships.find(member=>member.id===pin.curriculumMembershipId),'Learning Run source is missing.');
    const targetChange=targets.find(change=>change.key===targetId),before=targetChange?.before as LocalLearningTarget|undefined;
    if(!backupEqual(pin.retentionBaseline,retentionBaseline(before??target)))reject('New Learning Run must pin its exact pre-command retention state.');
    const expected={snapshot:{...membership.material.snapshot,learningMaterializationId:stableUuid(`local-run-materialization:${pin.protocolRunId}:${membership.material.snapshot.learningMaterializationId}`),protocolPurpose:after.purpose,createdAt:after.startedAt},content:membership.material.content};
    if(!backupEqual(runBaselineMaterial(pin),expected)||!backupEqual(Object.keys(pin.materializations),[pin.material])||!backupEqual(pin.presentedMaterials,targetId===initialTargetId?{[initialStepId]:pin.material}:{})||!backupEqual(pin.presentationOrder,targetId===initialTargetId?[initialStepId]:[]))reject('New Learning Run must begin with its selected baseline and initial presentation.');
   }
   if(!backupEqual(replayed,after))reject('New Learning Run cannot be deterministically replayed.');
  }else await assertLifecycleRunTransition(input,change.before as LocalLearningRun,after);
 }
 for(const change of relevant.filter(item=>item.table==='settings'))assertStudyPlanTransition(change,input.operation,routes);
 const activeChange=relevant.find(change=>change.table==='meta'&&change.key==='learning-active');
 if(activeChange?.before&&activeChange.after!==activeChange.before){
  const previous=requireFact(await input.read('learningRuns',String(activeChange.before)) as LocalLearningRun|undefined,'Previous Learning Run is missing.');
  if(!previous.completedAt&&!localRunOpenPlanningInterruption(previous)&&localRunOpenSessionPause(previous)?.operationId!==input.operation.id)reject('Changing Session focus must preserve a lawful pause of the previous Run.');
 }
 if(activeChange?.after===null&&!['learning.finish','learning.continue','learning.endSession','learning.declareMastery'].includes(input.operation.kind))reject('Only Learning lifecycle commands may clear the active Run.');
 if(activeChange&&activeChange.after!==null){
  if(!['learning.start','learning.continue'].includes(input.operation.kind))reject('Only Learning start commands may select an active Run.');
  const run=requireFact(await input.read('learningRuns',String(activeChange.after)) as LocalLearningRun|undefined,'Active Learning Run is missing.');
  if(localRunOpenPlanningInterruption(run)||localRunOpenSessionPause(run))reject('Active Learning Run is interrupted.');
  for(const id of localRunTargetIds(run))if(hasDeclaredMasteryOverride(requireFact(await input.read('learningTargets',id) as LocalLearningTarget|undefined,'Active Learning Target is missing.')))reject('Active Learning Run has an excluded Target.');
 }
 for(const change of runs){
  const run=change.after as LocalLearningRun;if(!run.learningSessionId&&!run.studyScopeRevisionId)continue;
  const origin=learningSessionSchema.parse(await input.read('learningSessions',run.learningSessionId!));
  if(!origin.runIds.includes(run.id)||!backupEqual(origin.languageContext,run.languageContext))reject('Learning Run lost its Session origin.');
  if(change.before===null)for(const [targetId,participant] of Object.entries(run.participants)){
   const selected=studyScopeSchema.parse(await input.read('studyScopes',run.studyScopeRevisionId!));
   if(!backupEqual(selected.languageContext,run.languageContext)||selected.dailyNewSenseLimit!==origin.dailyNewSenseLimit)reject('Learning Run selection changed its Session context or quota.');
   const member=input.scopeMember?await input.scopeMember(selected.id,targetId):(selected.members.find(member=>member.targetId===targetId)??null);
   if(!member||member.policy.profileId!==run.policyProfileId||member.policy.profileVersion!==run.policyProfileVersion||!member.sources.some(source=>source.membershipId===participant.curriculumMembershipId&&source.plans.some(plan=>plan.purpose===run.purpose&&plan.readiness==='ready')))reject('Learning Run is outside its frozen Study Scope.');
  }
 }
 if(relevant.some(change=>change.table==='meta'&&change.key===activeLearningSessionKey)||sessions.length){
  const activeSession=await input.read('meta',activeLearningSessionKey),activeRun=await input.read('meta','learning-active');
  if(activeSession){const session=learningSessionSchema.parse(await input.read('learningSessions',String(activeSession)));if(session.endedAt||session.activeRunId!==activeRun)reject('Active Learning Session has no coherent Run focus.');}
 }
}

export {learningTransitionTables};
