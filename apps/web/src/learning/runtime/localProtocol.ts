import {materialSourcePin,type LearningSourcePin} from './learningIdentity';
import type {
  InstalledLearningContent,
  SensaFormalPinnedLanguageContext,
  SensaLearningMaterializationSnapshot,
  SensaLightweightInitialMaterializationContent,
} from '@sensa/contracts/sensa';
import {createProtocolProgressState,decideAndApplyProtocolTransition,stableUuid,type GradedMemoryOutcome,type ProtocolObservationKind,type ProtocolProgressDefinition,type ProtocolProgressState,type ProtocolTransitionEffect,type ReviewSchedule,type WorkspaceSchedulerConfig} from '@sensa/learning-kernel';
import type {
  LearningProtocolBinding,
  LearningProtocolPurpose,
  LearningPolicyId,
  RuntimeAdapterId,
} from './policyProfiles';
import {initialCompletionContractOf,orchestrationRegistry,type InitialCompletionContract,type LearningEvidenceLevel} from './orchestrations';
import {protocolPolicyRegistry} from './protocolPolicies';
import type {TargetPlanningOverride} from './targetPlanningOverrides';
import {runBaselineMaterial,pinRunStepMaterial} from './runMaterialPins';

export interface LocalLearningMaterialization {
  readonly snapshot: SensaLearningMaterializationSnapshot;
  readonly content: SensaLightweightInitialMaterializationContent;
}

export interface LocalLearningTargetIdentity {
  readonly learnerUserId:string;
  readonly senseId:string;
  readonly expressionId:string;
  readonly targetLanguageTag:string;
}

/** One independent Curriculum source inside one Language Learning Route.
 * Support Language and material belong here, never to Learning Target identity. */
export interface LocalCurriculumMembership {
  readonly id:string;
  readonly revision:number;
  /** Superseded Book memberships stay addressable for Run replay but no longer
   * place their target in the current Route plan. Missing means active for
   * libraries written before Book release updates existed. */
  readonly status?:'active'|'superseded';
  readonly languageContext:SensaFormalPinnedLanguageContext;
  readonly sourceKind:'sense_learning_package'|'personal_meaning_alignment'|'stable_sense';
  readonly provenance:Readonly<Record<string,unknown>>;
  readonly sourcePin:LearningSourcePin;
  readonly packageKey:string|null;
  readonly assurancePackageKey?:string;
  readonly material:LocalLearningMaterialization;
  readonly createdByOperationId:string;
  readonly createdAt:string;
  readonly updatedAt:string;
}

export interface LocalLearningPolicyAssignment {
  readonly assignmentId:string;
  readonly revision:number;
  readonly scope:'system_default'|'curriculum_source'|'target_override';
  readonly profileId:LearningPolicyId;
  readonly assignedByOperationId:string;
  readonly assignedAt:string;
  readonly provenance:Readonly<Record<string,unknown>>;
}

export interface LocalCommittedLearningPolicy {
  readonly commitmentId:string;
  readonly revision:number;
  readonly assignmentId:string;
  readonly assignmentRevision:number;
  readonly profileId:LearningPolicyId;
  readonly profileVersion:string;
  readonly committedByProtocolRunId:string;
  readonly committedAt:string;
}

export interface LocalResolvedLearningPlanSnapshot {
  readonly resolvedLearningPlanRevisionId:string;
  readonly revision:number;
  readonly learningTargetId:string;
  readonly retentionTargetId:string;
  readonly purpose:LearningProtocolPurpose;
  readonly profileId:LearningPolicyId;
  readonly profileVersion:string;
  readonly protocolBinding:LearningProtocolBinding;
  readonly contentDemands:readonly Readonly<{contentDemandKey:string;definitionVersion:string}>[];
  readonly learningMaterializationIds:readonly string[];
  readonly readiness:'ready';
  readonly resolvedAt:string;
}

export interface LocalLearningTarget {
  id: string;
  retentionId: string;
  identity:LocalLearningTargetIdentity;
  curriculumMemberships:LocalCurriculumMembership[];
  expression: string;
  policyAssignment:LocalLearningPolicyAssignment;
  committedPolicy:LocalCommittedLearningPolicy|null;
  /** Active learner-owned exclusions from planning; never learning evidence. */
  planningOverrides:TargetPlanningOverride[];
  targetLanguageTag: string;
  /** The Route that consumed the one-time initial-learning quota. Progress is
   * still shared when other compatible Routes later include this Target. */
  introducedLanguageRouteId:string|null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  memory: ReviewSchedule | null;
  memoryRevision: number;
  relearnAt: string | null;
  /** Protocol-owned repair state. The scheduler never interprets this value. */
  relearningState: unknown | null;
}

/** Detached adapter input resolved from a Target plus one Curriculum membership. */
export type LocalExecutableLearningTarget=LocalLearningTarget&{
  readonly curriculumMembership:LocalCurriculumMembership;
  readonly packageKey:string|null;
  readonly assurancePackageKey?:string;
  readonly supportLanguageTag:string;
  readonly meaning:string;
  readonly material:LocalLearningMaterialization;
};

export type LocalProtocolStartReason = Readonly<{
  kind:'initial_learning_ready'|'due_review'|'relearning_ready';
  selectionReason:'requested_target'|'cohort_candidate';
  triggerAt:string;
  triggerMemoryRevision:number;
}>;

/** Scheduler-side authority is fixed per Protocol Run, never inferred by a plugin. */
export interface LocalProtocolOutcomePermissions {
  readonly initialLearningCompletion:boolean;
  readonly schedulingHandoff:boolean;
  readonly memoryOutcome:'none'|'due_review'|'independent_relearning_evaluation';
  readonly relearningProgress:boolean;
  readonly relearningCompletion:boolean;
}

export interface LocalLearningRunParticipant {
  retentionBaseline:import('./retentionBaseline').LocalRetentionBaseline;
  protocolRunId:string;
  curriculumMembershipId:string;
  languageContext:SensaFormalPinnedLanguageContext;
  startReason:LocalProtocolStartReason;
  outcomePermissions:LocalProtocolOutcomePermissions;
  /** Audit baseline selected when the Run plan was resolved. It does not freeze
   * every later Step: each presented Step records the material actually used,
   * and a not-yet-acted current Step may be explicitly refreshed. */
  material: string;
  materializations:Record<string,LocalLearningMaterialization>;
  presentedMaterials:Record<string,string>;
  /** First-binding order, independent of object-key serialization. Refreshes
   * replace only the current binding and never reorder earlier Steps. */
  presentationOrder:string[];
  policyCommitment:LocalCommittedLearningPolicy;
  resolvedPlan:LocalResolvedLearningPlanSnapshot;
  progress:ProtocolProgressState;
  memoryRevision: number;
  dueAt: string | null;
  evidenceIds:string[];
}

/** A single opaque state slot owned by the adapter pinned on this Run. */
export interface LocalProtocolState {
  readonly adapterId: RuntimeAdapterId;
  value: unknown;
}

/**
 * Persisted execution envelope within a separately stored Learning Session.
 * Each participant owns one formal Protocol Run;
 * the envelope may interleave several of them without merging their identity,
 * progress, evidence, materialization, or settlement.
 */
export interface LocalLearningRun {
  id: string;
  /** Immutable creation witness; receipts reference facts, not copied Runs. */
  startedByOperationId?:string;
  continuedFromRunId?:string;
  /** Creation activity; a paused Protocol Run can later be visited by another
   * Session without rewriting this origin or any participant material. */
  learningSessionId?:string;
  studyScopeRevisionId?:string;
  /** Primary target used to enter the Run. Every actual member is in targetIds. */
  targetId: string;
  targetIds: string[];
  participants: Record<string, LocalLearningRunParticipant>;
  targetCompletions: Record<string, { at: string; kind: string }>;
  languageContext:SensaFormalPinnedLanguageContext;
  /** Entry intent belongs to the persisted Session, not to the page queue. */
  sessionIntent?:LocalLearningSessionIntent;
  purpose: LearningProtocolPurpose;
  policyProfileId: LearningPolicyId;
  policyProfileVersion: string;
  protocolBinding: LearningProtocolBinding;
  protocolVersion: string;
  protocolState: LocalProtocolState;
  schedulingPolicyId: string;
  schedulingPolicy: WorkspaceSchedulerConfig;
  learnerVisibleClaimBoundary: string;
  ordinal: number;
  revision: number;
  /** Formal lifecycle facts outside Protocol evaluation and settlement. */
  lifecycleEvents:LocalLearningRunLifecycleEvent[];
  startedAt: string;
  completedAt: string | null;
  completionKind?: string;
}

export type LocalLearningRunLifecycleEvent = Readonly<{runRevision:number}> & (
  | Readonly<{
      eventId:string;
      kind:'paused_for_session_switch';
      operationId:string;
      selectedTargetId:string;
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'paused_for_session_end';
      operationId:string;
      learningSessionId:string;
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'resumed_after_session_switch'|'resumed_after_session_end';
      operationId:string;
      interruptionEventId:string;
      sessionIntent:LocalLearningSessionIntent;
      requestedLanguageContext?:SensaFormalPinnedLanguageContext;
      continuedFromRunId?:string;
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'session_intent_selected';
      operationId:string;
      sessionIntent:LocalLearningSessionIntent;
      requestedLanguageContext?:SensaFormalPinnedLanguageContext;
      continuedFromRunId?:string;
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'interrupted_by_planning_override';
      operationId:string;
      targetId:string;
      overrideKind:TargetPlanningOverride['kind'];
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'resumed_after_planning_override';
      operationId:string;
      interruptionEventId:string;
      sessionIntent?:LocalLearningSessionIntent;
      requestedLanguageContext?:SensaFormalPinnedLanguageContext;
      continuedFromRunId?:string;
      at:string;
    }>
  | Readonly<{
      eventId:string;
      kind:'current_step_material_refreshed';
      operationId:string;
      targetId:string;
      stepId:string;
      materializationId:string;
      at:string;
    }>);

export type LocalLearningSessionIntent='mixed'|'review_only';

export const localRunSessionIntent=(run:Pick<LocalLearningRun,'sessionIntent'|'lifecycleEvents'>):LocalLearningSessionIntent=>{
  const selection=[...run.lifecycleEvents].reverse().find(event=>'sessionIntent' in event&&event.sessionIntent!==undefined);
  return selection&&'sessionIntent' in selection?selection.sessionIntent??run.sessionIntent??'mixed':run.sessionIntent??'mixed';
};

export const localRunOpenSessionPause=(run:Pick<LocalLearningRun,'lifecycleEvents'>):Extract<LocalLearningRunLifecycleEvent,{kind:'paused_for_session_switch'|'paused_for_session_end'}>|null=>{
  const resumed=new Set(run.lifecycleEvents.flatMap(event=>event.kind==='resumed_after_session_switch'||event.kind==='resumed_after_session_end'?[event.interruptionEventId]:[]));
  return [...run.lifecycleEvents].reverse().find((event):event is Extract<LocalLearningRunLifecycleEvent,{kind:'paused_for_session_switch'|'paused_for_session_end'}> => (event.kind==='paused_for_session_switch'||event.kind==='paused_for_session_end')&&!resumed.has(event.eventId))??null;
};

/** The latest interruption remains open until a matching resume fact exists. */
export const localRunOpenPlanningInterruption = (
  run:Pick<LocalLearningRun,'lifecycleEvents'>,
):Extract<LocalLearningRunLifecycleEvent,{kind:'interrupted_by_planning_override'}>|null => {
  const resumed = new Set(run.lifecycleEvents.flatMap((event) => (
    event.kind === 'resumed_after_planning_override' ? [event.interruptionEventId] : []
  )));
  return [...run.lifecycleEvents].reverse().find((event): event is Extract<
    LocalLearningRunLifecycleEvent,
    {kind:'interrupted_by_planning_override'}
  > => event.kind === 'interrupted_by_planning_override' && !resumed.has(event.eventId)) ?? null;
};

export interface LocalLearningResource {
  key: string;
  digest: string;
  content: InstalledLearningContent;
  installedAt: string;
}

export type LocalLearningAction =
  | { kind: 'reveal' }
  | { kind: 'rate'; rating: 'again' | 'hard' | 'good' }
  | { kind: 'assurance'; response: unknown }
  | { kind: 'protocol'; response: unknown };

export type LocalProtocolSettlementIntent =
  | Readonly<{
      kind: 'initial_learning_completion';
      completion: InitialCompletionContract;
      /** A completed first encounter may still request an immediate repair pass. */
      relearning?: Readonly<{
        nextEligibleAt: string;
        state: unknown | null;
      }> | null;
    }>
  | Readonly<{
      kind: 'memory_outcome';
      schedulerEligibility: 'due_review' | 'independent_relearning_evaluation';
      outcome: Omit<GradedMemoryOutcome, 'evidenceIds'>;
      relearning: Readonly<{
        nextEligibleAt: string;
        state: unknown | null;
      }> | null;
    }>
  | Readonly<{
      kind: 'relearning_progress';
      nextEligibleAt: string;
      state: unknown | null;
    }>
  | Readonly<{
      kind: 'relearning_completion';
      protocolOutcome: string;
      evidenceLevel: LearningEvidenceLevel;
    }>;

/** Formal settlement passed to persistence after the kernel binds evaluation and Evidence identities. */
export type LocalProtocolSettlement =
  | Readonly<Extract<LocalProtocolSettlementIntent, {kind:'initial_learning_completion'}> & {
      evidenceIds:readonly string[];
    }>
  | Readonly<Extract<LocalProtocolSettlementIntent, {kind:'memory_outcome'}> & {
      evaluationId:string;
      outcome:GradedMemoryOutcome;
    }>
  | Extract<LocalProtocolSettlementIntent, {kind:'relearning_progress'}>
  | Readonly<Extract<LocalProtocolSettlementIntent, {kind:'relearning_completion'}> & {
      evidenceIds:readonly string[];
    }>;

export const localProtocolOutcomePermissions=(purpose:LearningProtocolPurpose,binding:LearningProtocolBinding):LocalProtocolOutcomePermissions=>Object.freeze(
 purpose==='initial_learning'
  ?{initialLearningCompletion:true,schedulingHandoff:true,memoryOutcome:'none',relearningProgress:false,relearningCompletion:false}
  :purpose==='retention_review'
   ?{initialLearningCompletion:false,schedulingHandoff:false,memoryOutcome:'due_review',relearningProgress:false,relearningCompletion:false}
   :{initialLearningCompletion:false,schedulingHandoff:false,memoryOutcome:binding.memoryOutcomePolicyId?'independent_relearning_evaluation':'none',relearningProgress:true,relearningCompletion:true},
);

const settlementAllowed=(permissions:LocalProtocolOutcomePermissions,settlement:LocalProtocolSettlementIntent):boolean=>{
 switch(settlement.kind){
  case 'initial_learning_completion':return permissions.initialLearningCompletion&&permissions.schedulingHandoff;
  case 'memory_outcome':return permissions.memoryOutcome===settlement.schedulerEligibility;
  case 'relearning_progress':return permissions.relearningProgress;
  case 'relearning_completion':return permissions.relearningCompletion;
 }
};

export interface LocalProtocolEvaluationIntent {
  readonly actionIntent:'instruction'|'practice'|'assessment'|'feedback'|'repair';
  readonly observation:Readonly<{
    kind:ProtocolObservationKind;
    checkpointId:string|null;
    valid:boolean;
    result:unknown;
  }>;
  readonly evidenceCandidates:readonly Readonly<{
    basis:string;
    polarity:'positive'|'negative';
    capabilityObjectiveIds:readonly string[];
  }>[];
}

export interface LocalProtocolAuditEffect {
 readonly kind:string;
 readonly payload:unknown;
}

export type LocalProtocolSessionCompletionIntent='complete'|'pause_for_relearning';

/** Untrusted result returned by a Protocol plugin. */
export interface LocalProtocolTransitionIntent {
  readonly protocolEffects: readonly LocalProtocolAuditEffect[];
  readonly evaluation:LocalProtocolEvaluationIntent|null;
  readonly settlement: LocalProtocolSettlementIntent|null;
  readonly sessionCompletion:LocalProtocolSessionCompletionIntent|null;
}

/** Kernel-authorized transition passed to persistence. */
export interface LocalProtocolTransition {
  readonly protocolEffects:readonly LocalProtocolAuditEffect[];
  readonly evaluation:LocalProtocolEvaluationIntent|null;
  readonly settlement:LocalProtocolSettlement|null;
  readonly sessionCompletion:LocalProtocolSessionCompletionIntent|null;
}

export interface LocalProtocolEvaluationFacts {
 readonly step:Readonly<{protocolStepInstanceId:string;protocolRunId:string;stepKey:string;ordinal:number;purpose:LearningProtocolPurpose;learningMaterializationIds:readonly string[]}>;
 readonly action:Readonly<{actionId:string;protocolStepInstanceId:string;protocolRunId:string;actionIntent:LocalProtocolEvaluationIntent['actionIntent'];kind:LocalLearningAction['kind'];issuedAt:string}>;
 readonly attempt:Readonly<{attemptId:string;actionId:string;protocolRunId:string;learnerUserId:string;learningTargetId:string;response:LocalLearningAction;submittedAt:string}>;
 readonly observation:Readonly<{observationId:string;attemptId:string;actionId:string;protocolRunId:string;kind:ProtocolObservationKind;checkpointId:string|null;valid:boolean;result:unknown;evidenceIds:readonly string[];observedAt:string}>;
 readonly evidence:readonly Readonly<{learningEvidenceId:string;observationId:string;attemptId:string;protocolRunId:string;learningTargetId:string;basis:string;polarity:'positive'|'negative';capabilityObjectiveIds:readonly string[];evidenceRuleVersion:string;derivedAt:string}>[];
 readonly evaluation:Readonly<{evaluationId:string;observationId:string;protocolRunId:string;evaluationPolicyId:string;result:unknown;evaluatedAt:string}>;
 readonly transitionDecision:Readonly<{transitionDecisionId:string;protocolRunId:string;observationId:string;progressionPolicyId:string;effects:readonly ProtocolTransitionEffect[];decidedAt:string}>;
}

/** Storage port for a versioned Protocol implementation. It cannot write retention state. */
export interface LocalProtocolExecution {
  readonly cohort?: boolean;
  validate?(target: LocalExecutableLearningTarget, resource: LocalLearningResource | undefined): void;
  activeTargetId?(run: LocalLearningRun): string;
  initialize(
    target: LocalExecutableLearningTarget,
    resource: LocalLearningResource | undefined,
    purpose: LearningProtocolPurpose,
    run: LocalLearningRun,
  ): LocalProtocolState;
  stepId(run: LocalLearningRun): string;
  /** Adapter-internal reducer. Call executeLocalProtocolTransition, never this directly. */
  unsafeTransition(
    target: LocalExecutableLearningTarget,
    run: LocalLearningRun,
    resource: LocalLearningResource | undefined,
    action: LocalLearningAction,
    at: string,
  ): LocalProtocolTransitionIntent;
  replayState(
    target: LocalExecutableLearningTarget,
    resource: LocalLearningResource | undefined,
    saved: LocalLearningRun,
  ): LocalProtocolState;
}

export const localProtocolPluginContractVersion='sensa-local-protocol-plugin-v2' as const;

export interface LocalProtocolExecutionBinding {
 readonly purpose:LearningProtocolPurpose;
 readonly protocolId:string;
 readonly protocolVersion:string;
 readonly localProtocolVersion:string;
}

export interface LocalProtocolPluginManifest {
 readonly contractVersion:typeof localProtocolPluginContractVersion;
 readonly pluginId:string;
 readonly pluginVersion:string;
 readonly displayName:string;
 readonly runtimeAdapterId:RuntimeAdapterId;
 readonly bindings:readonly LocalProtocolExecutionBinding[];
}

export interface LocalProtocolPlugin {
 readonly manifest:LocalProtocolPluginManifest;
 readonly execution:LocalProtocolExecution;
}

export const localRunTargetIds = (run: LocalLearningRun): readonly string[] => run.targetIds;

/** Purpose selection is a Runtime invariant, not a Protocol extension point. */
export const localLearningPurpose = (target: LocalLearningTarget): LearningProtocolPurpose =>
  target.relearnAt
    ? 'relearning'
    : target.completedAt
      ? 'retention_review'
      : 'initial_learning';

/** A materialization can vary by Run, but it cannot redefine Target identity. */
export function assertLocalTargetMaterialIdentity(
  target:LocalLearningTarget,
  material:LocalLearningMaterialization,
):void{
  const provenance=materialSourcePin(material);
  if(
    material.snapshot.learnerUserId!==target.identity.learnerUserId
    || material.snapshot.learningTargetId!==target.id
    || provenance.senseId!==target.identity.senseId
    || provenance.expressionId!==target.identity.expressionId
  )throw new Error('localFlow.resourceInvalid');
}

export const createLocalProtocolState = (
  adapterId: RuntimeAdapterId,
  value: unknown,
): LocalProtocolState => ({ adapterId, value });

export function readLocalProtocolState<T>(
  run: LocalLearningRun,
  adapterId: RuntimeAdapterId,
): T {
  if (run.protocolState.adapterId !== adapterId) throw new Error('localFlow.resourceInvalid');
  return run.protocolState.value as T;
}

const runContractProjection=(run:LocalLearningRun)=>({
 id:run.id,targetId:run.targetId,targetIds:run.targetIds,participants:run.participants,
 startedByOperationId:run.startedByOperationId,
 continuedFromRunId:run.continuedFromRunId,
 learningSessionId:run.learningSessionId,studyScopeRevisionId:run.studyScopeRevisionId,
 targetCompletions:run.targetCompletions,
 languageContext:run.languageContext,sessionIntent:run.sessionIntent,
 purpose:run.purpose,policyProfileId:run.policyProfileId,policyProfileVersion:run.policyProfileVersion,
 protocolBinding:run.protocolBinding,protocolVersion:run.protocolVersion,
 schedulingPolicyId:run.schedulingPolicyId,schedulingPolicy:run.schedulingPolicy,
 learnerVisibleClaimBoundary:run.learnerVisibleClaimBoundary,
 ordinal:run.ordinal,revision:run.revision,startedAt:run.startedAt,
 completedAt:run.completedAt,completionKind:run.completionKind,
 lifecycleEvents:run.lifecycleEvents,
});

const sameValue=(left:unknown,right:unknown):boolean=>JSON.stringify(left)===JSON.stringify(right);
const sameOutcomePermissions=(left:LocalProtocolOutcomePermissions,right:LocalProtocolOutcomePermissions):boolean=>
 left.initialLearningCompletion===right.initialLearningCompletion
 &&left.schedulingHandoff===right.schedulingHandoff
 &&left.memoryOutcome===right.memoryOutcome
 &&left.relearningProgress===right.relearningProgress
 &&left.relearningCompletion===right.relearningCompletion;

export const isJsonValue=(value:unknown):boolean=>{
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(isJsonValue);
 if(typeof value==='object')return Object.getPrototypeOf(value)===Object.prototype&&Object.values(value as Record<string,unknown>).every(child=>child!==undefined&&isJsonValue(child));
 return false;
};

const validateProtocolEvaluation=(run:LocalLearningRun,evaluation:LocalProtocolEvaluationIntent|null):void=>{
 if(!evaluation)return;
 if(!protocolPolicyRegistry.hasEvaluation(run.protocolBinding.evaluationPolicyId))throw new Error(`Unknown Evaluation Policy: ${run.protocolBinding.evaluationPolicyId}`);
 if(!['instruction','practice','assessment','feedback','repair'].includes(evaluation.actionIntent))throw new Error('Invalid Protocol evaluation intent.');
 const checkpointKind=evaluation.observation.kind==='checkpoint_satisfied'||evaluation.observation.kind==='checkpoint_not_satisfied'||evaluation.observation.kind==='repair_completed';
 if(checkpointKind!==(evaluation.observation.checkpointId!==null))throw new Error('Protocol checkpoint Observation identity mismatch.');
 if(!isJsonValue(evaluation.observation.result))throw new Error('Protocol Observation result must be canonical JSON.');
 const requireCheckpoint=(checkpointId:string):void=>{
  if(!run.protocolBinding.checkpointDefinitionIds.includes(checkpointId))throw new Error(`Unknown Protocol Checkpoint: ${checkpointId}`);
 };
 if(evaluation.observation.checkpointId)requireCheckpoint(evaluation.observation.checkpointId);
 if(evaluation.evidenceCandidates.length&&(
  evaluation.actionIntent!=='assessment'||!evaluation.observation.valid
 ))throw new Error('Only a valid assessment Observation may derive Evidence.');
 for(const candidate of evaluation.evidenceCandidates){
  if(!candidate.basis.trim()||!candidate.capabilityObjectiveIds.length||candidate.capabilityObjectiveIds.some(id=>!id.trim()))throw new Error('Invalid Protocol Evidence candidate.');
 }
};

const localProgressDefinition=(binding:LearningProtocolBinding):ProtocolProgressDefinition=>({
 protocolId:binding.protocolId,
 protocolVersion:binding.protocolVersion,
 checkpoints:binding.checkpointDefinitionIds.map(checkpointId=>({checkpointId,capabilityObjectiveIds:[checkpointId],requiredForCompletion:true})),
 completionPolicy:protocolPolicyRegistry.getCompletion(binding.completionPolicyId),
});

export const createLocalProtocolProgress=(protocolRunId:string,binding:LearningProtocolBinding):ProtocolProgressState=>
 createProtocolProgressState(protocolRunId,localProgressDefinition(binding));

export const resetLocalRunParticipantsForReplay=(saved:LocalLearningRun):LocalLearningRun['participants']=>
 Object.fromEntries(Object.entries(saved.participants).map(([id,participant])=>[id,{...participant,materializations:{[participant.material]:structuredClone(runBaselineMaterial(participant))},presentedMaterials:{},presentationOrder:[],evidenceIds:[],progress:createLocalProtocolProgress(participant.protocolRunId,saved.protocolBinding)}]));

const assertLocalProtocolState=(state:LocalProtocolState,adapterId:RuntimeAdapterId):void=>{
 if(state.adapterId!==adapterId||!isJsonValue(state.value))throw new Error('localFlow.resourceInvalid');
};

/** Run a plugin resource probe without exposing the caller's live objects. */
export function validateLocalProtocolResources(
 execution:LocalProtocolExecution,
 target:LocalExecutableLearningTarget,
 resource:LocalLearningResource|undefined,
):void{
 execution.validate?.(structuredClone(target),resource?structuredClone(resource):undefined);
}

/** Initialize only the opaque plugin slot; the execution envelope stays kernel-owned. */
export function initializeLocalProtocolState(input:Readonly<{
 execution:LocalProtocolExecution;
 target:LocalExecutableLearningTarget;
 resource:LocalLearningResource|undefined;
 purpose:LearningProtocolPurpose;
 run:LocalLearningRun;
}>):LocalProtocolState{
 const state=input.execution.initialize(
  structuredClone(input.target),
  input.resource?structuredClone(input.resource):undefined,
  input.purpose,
  structuredClone(input.run),
 );
 assertLocalProtocolState(state,input.run.protocolBinding.runtimeAdapterId);
 return structuredClone(state);
}

/** Resolve adapter navigation against a detached Run snapshot. */
export function localProtocolActiveTargetId(execution:LocalProtocolExecution,run:LocalLearningRun):string{
 const targetId=execution.activeTargetId?.(structuredClone(run))??run.targetId;
 if(!run.targetIds.includes(targetId))throw new Error('localFlow.stepChanged');
 return targetId;
}

/** Resolve a stable plugin Step identity without exposing the live Run. */
export function localProtocolStepId(execution:LocalProtocolExecution,run:LocalLearningRun):string{
 const stepId=execution.stepId(structuredClone(run));
 if(!stepId.trim())throw new Error('localFlow.resourceInvalid');
 return stepId;
}

/** Replay resets formal facts in the kernel and asks the plugin only for opaque state. */
export function replayLocalProtocolRun(input:Readonly<{
 execution:LocalProtocolExecution;
 target:LocalExecutableLearningTarget;
 resource:LocalLearningResource|undefined;
 saved:LocalLearningRun;
}>):LocalLearningRun{
 const run:LocalLearningRun={
  ...structuredClone(input.saved),
  // Actions and lifecycle facts are replayed together in causal revision order.
  // The final material map and lifecycle history are not initial state.
  revision:1,
  lifecycleEvents:[],
  ordinal:1,
  completedAt:null,
  completionKind:undefined,
  targetCompletions:{},
  participants:resetLocalRunParticipantsForReplay(input.saved),
  protocolState:createLocalProtocolState(input.saved.protocolBinding.runtimeAdapterId,null),
 };
 delete run.completionKind;
 const state=input.execution.replayState(
  structuredClone(input.target),
  input.resource?structuredClone(input.resource):undefined,
  structuredClone(input.saved),
 );
 assertLocalProtocolState(state,input.saved.protocolBinding.runtimeAdapterId);
 run.protocolState=structuredClone(state);
 const firstTargetId=localProtocolActiveTargetId(input.execution,run),firstStepId=localProtocolStepId(input.execution,run),participant=run.participants[firstTargetId];
 if(!participant)throw new Error('localFlow.resourceInvalid');
 pinRunStepMaterial(participant,firstStepId,runBaselineMaterial(participant));
 return run;
}

/**
 * The capability-safe Protocol reducer boundary. Adapters work on detached
 * values and may only mutate their opaque Protocol state and return typed
 * evaluation/settlement/lifecycle intents. Formal facts remain kernel-owned.
 */
export function executeLocalProtocolTransition(input:Readonly<{
 execution:LocalProtocolExecution;
 target:LocalExecutableLearningTarget;
 run:LocalLearningRun;
 resource:LocalLearningResource|undefined;
 action:LocalLearningAction;
 at:string;
}>):Readonly<{run:LocalLearningRun;transition:LocalProtocolTransitionIntent}>{
 const sourceParticipant=input.run.participants[input.target.id];
 const expectedStartKind=input.run.purpose==='initial_learning'?'initial_learning_ready':input.run.purpose==='retention_review'?'due_review':'relearning_ready';
 if(!sourceParticipant)throw new Error('localFlow.resourceInvalid');
 const invalidAuthority=[
  sourceParticipant.startReason.kind!==expectedStartKind&&'start_kind',
  sourceParticipant.startReason.selectionReason!==(input.target.id===input.run.targetId?'requested_target':'cohort_candidate')&&'selection',
  sourceParticipant.startReason.triggerAt!==input.run.startedAt&&'trigger_clock',
  sourceParticipant.startReason.triggerMemoryRevision!==sourceParticipant.memoryRevision&&'memory_revision',
  !sameOutcomePermissions(sourceParticipant.outcomePermissions,localProtocolOutcomePermissions(input.run.purpose,input.run.protocolBinding))&&'outcome_permissions',
 ].filter(Boolean);
 if(invalidAuthority.length)throw new Error(`Invalid Protocol Run authority: ${invalidAuthority.join(',')}`);
 const sourceBefore=structuredClone(input.run);
 const contractBefore=runContractProjection(sourceBefore);
 const run=structuredClone(input.run);
 const transition=input.execution.unsafeTransition(
  structuredClone(input.target),
  run,
  input.resource?structuredClone(input.resource):undefined,
  structuredClone(input.action),
  input.at,
 );
 if(!sameValue(input.run,sourceBefore))throw new Error('Protocol adapter mutated source Run state.');
 if(!sameValue(runContractProjection(run),contractBefore))throw new Error('Protocol adapter changed a pinned Run contract.');
 assertLocalProtocolState(run.protocolState,run.protocolBinding.runtimeAdapterId);
 if(!transition||!Array.isArray(transition.protocolEffects)||transition.protocolEffects.some(effect=>!effect||typeof effect.kind!=='string'||!effect.kind.trim()||!isJsonValue(effect.payload)))throw new Error('Invalid Protocol transition result.');
 if(transition.sessionCompletion!==null&&transition.sessionCompletion!=='complete'&&transition.sessionCompletion!=='pause_for_relearning')throw new Error('Invalid Protocol Session completion intent.');
 validateProtocolEvaluation(run,transition.evaluation);
 const participant=run.participants[input.target.id];
 if(!participant||!run.targetIds.includes(input.target.id))throw new Error('localFlow.stepChanged');
 const settlement=transition.settlement;
 if(settlement){
  const relearning=settlement.kind==='relearning_progress'
   ?{nextEligibleAt:settlement.nextEligibleAt,state:settlement.state}
   :(settlement.kind==='memory_outcome'||settlement.kind==='initial_learning_completion')
    ?settlement.relearning
    :null;
  if(relearning&&(!Number.isFinite(Date.parse(relearning.nextEligibleAt))||!isJsonValue(relearning.state)))throw new Error('Relearning state must be canonical JSON.');
  if(!settlementAllowed(participant.outcomePermissions,settlement))throw new Error('localFlow.stepChanged');
  if(input.run.targetCompletions[input.target.id])throw new Error('A Protocol Run may settle only once.');
 }
 return Object.freeze({run,transition:Object.freeze({protocolEffects:Object.freeze([...transition.protocolEffects]),evaluation:transition.evaluation,settlement,sessionCompletion:transition.sessionCompletion})});
}

/** Materialize the formal evaluation pipeline only when the Protocol declares one. */
export function materializeLocalProtocolEvaluation(input:Readonly<{
 operationId:string;
 stepKey:string;
 at:string;
 target:LocalExecutableLearningTarget;
 run:LocalLearningRun;
 action:LocalLearningAction;
 evaluation:LocalProtocolEvaluationIntent|null;
}>):LocalProtocolEvaluationFacts|null{
 if(!input.evaluation)return null;
 const participant=input.run.participants[input.target.id];
 if(!participant)throw new Error('localFlow.stepChanged');
 const protocolRunId=participant.protocolRunId;
 const protocolStepInstanceId=stableUuid(`local-protocol-step:${protocolRunId}:${input.run.ordinal}:${input.stepKey}`);
 const actionId=stableUuid(`local-protocol-action:${input.operationId}`);
 const attemptId=stableUuid(`local-learning-attempt:${input.operationId}`);
 const observationId=stableUuid(`local-learning-observation:${input.operationId}`);
 const evaluationId=stableUuid(`local-learning-evaluation:${input.operationId}`);
 const evidence=Object.freeze(input.evaluation.evidenceCandidates.map((candidate,index)=>Object.freeze({
  learningEvidenceId:stableUuid(`local-learning-evidence:${attemptId}:${input.target.id}:sensa-local-evidence-v1:${candidate.basis}:${index}`),
  observationId,attemptId,protocolRunId,learningTargetId:input.target.id,basis:candidate.basis,polarity:candidate.polarity,
  capabilityObjectiveIds:Object.freeze([...candidate.capabilityObjectiveIds]),evidenceRuleVersion:'sensa-local-evidence-v1',derivedAt:input.at,
 })));
 const evidenceIds=Object.freeze(evidence.map(fact=>fact.learningEvidenceId));
 const observation={observationId,attemptId,actionId,kind:input.evaluation.observation.kind,checkpointId:input.evaluation.observation.checkpointId,evidenceIds} as const;
 const progression=decideAndApplyProtocolTransition({
  definition:localProgressDefinition(input.run.protocolBinding),
  policy:protocolPolicyRegistry.getProgression(input.run.protocolBinding.progressionPolicyId),
  state:participant.progress,
  observation,
  decisionId:stableUuid(`local-protocol-transition:${input.operationId}`),
 });
 participant.progress=progression.state;
 const effects=Object.freeze([...progression.decision.effects]);
  return Object.freeze({
   step:Object.freeze({protocolStepInstanceId,protocolRunId,stepKey:input.stepKey,ordinal:input.run.ordinal,purpose:input.run.purpose,learningMaterializationIds:Object.freeze([input.target.material.snapshot.learningMaterializationId])}),
  action:Object.freeze({actionId,protocolStepInstanceId,protocolRunId,actionIntent:input.evaluation.actionIntent,kind:input.action.kind,issuedAt:input.at}),
  attempt:Object.freeze({attemptId,actionId,protocolRunId,learnerUserId:input.target.identity.learnerUserId,learningTargetId:input.target.id,response:structuredClone(input.action),submittedAt:input.at}),
  observation:Object.freeze({observationId,attemptId,actionId,protocolRunId,kind:input.evaluation.observation.kind,checkpointId:input.evaluation.observation.checkpointId,valid:input.evaluation.observation.valid,result:structuredClone(input.evaluation.observation.result),evidenceIds,observedAt:input.at}),
  evidence,
  evaluation:Object.freeze({evaluationId,observationId,protocolRunId,evaluationPolicyId:input.run.protocolBinding.evaluationPolicyId,result:structuredClone(input.evaluation.observation.result),evaluatedAt:input.at}),
  transitionDecision:Object.freeze({transitionDecisionId:progression.decision.decisionId,protocolRunId,observationId,progressionPolicyId:progression.decision.progressionPolicyId,effects,decidedAt:input.at}),
 });
}

const settlementCompletionKind=(settlement:LocalProtocolSettlementIntent):string|null=>{
 if(settlement.kind==='initial_learning_completion')return settlement.completion.completionKind;
 if(settlement.kind==='relearning_completion')return 'relearning_completion';
 if(settlement.kind==='memory_outcome'&&settlement.schedulerEligibility==='due_review')return 'review_completed';
 return null;
};

const sessionCompletionKind=(run:LocalLearningRun):string=>{
 if(run.purpose==='retention_review')return 'review_completed';
 if(run.purpose==='relearning')return 'relearning_completion';
 return initialCompletionContractOf(orchestrationRegistry.get(run.protocolBinding.orchestrationId)).completionKind;
};

/**
 * Public application boundary for one learner action. It reduces isolated
 * adapter state, materializes the formal evaluation chain, and binds newly
 * created Evidence to the only settlement that may consume it.
 */
export function reduceLocalProtocolAction(input:Readonly<{
 operationId:string;
 stepKey:string;
 at:string;
 execution:LocalProtocolExecution;
 target:LocalExecutableLearningTarget;
 run:LocalLearningRun;
 resource:LocalLearningResource|undefined;
 action:LocalLearningAction;
}>):Readonly<{run:LocalLearningRun;transition:LocalProtocolTransition;facts:LocalProtocolEvaluationFacts|null}>{
 const executed=executeLocalProtocolTransition(input);
 const facts=materializeLocalProtocolEvaluation({...input,run:executed.run,evaluation:executed.transition.evaluation});
 const participant=executed.run.participants[input.target.id];
 if(!participant)throw new Error('localFlow.stepChanged');
 if(facts)participant.evidenceIds=[...new Set([...participant.evidenceIds,...facts.evidence.map(fact=>fact.learningEvidenceId)])];
 const intent=executed.transition.settlement;
 let boundSettlement:LocalProtocolSettlement|null=null;
 if(intent?.kind==='initial_learning_completion')boundSettlement={...intent,evidenceIds:[...participant.evidenceIds]};
 if(intent?.kind==='relearning_completion')boundSettlement={...intent,evidenceIds:[...participant.evidenceIds]};
 if(intent?.kind==='relearning_progress')boundSettlement=intent;
 if(intent?.kind==='memory_outcome'){
  if(!facts||facts.action.actionIntent!=='assessment'||!facts.observation.valid)throw new Error('A Memory Outcome requires a valid formal assessment Evaluation.');
  const policyId=executed.run.protocolBinding.memoryOutcomePolicyId;
  if(!policyId||!protocolPolicyRegistry.hasMemoryOutcome(policyId))throw new Error('A Memory Outcome requires a registered Memory Outcome Policy.');
  boundSettlement={...intent,evaluationId:facts.evaluation.evaluationId,outcome:{...intent.outcome,evidenceIds:facts.evidence.map(fact=>fact.learningEvidenceId)}};
 }
 const completionKind=intent?settlementCompletionKind(intent):null;
 if(completionKind){
  if(!participant.progress.completed)throw new Error('Completion Policy has not completed this Protocol Run.');
  executed.run.targetCompletions[input.target.id]={at:input.at,kind:completionKind};
 }
 const sessionCompletion=executed.transition.sessionCompletion;
 if(sessionCompletion==='pause_for_relearning'){
  if(executed.run.purpose!=='relearning'||intent?.kind!=='relearning_progress'||executed.run.targetIds.length!==1)throw new Error('Only a single-target Relearning progress settlement may pause a Session.');
  executed.run.completedAt=input.at;
  executed.run.completionKind='wait_relearning';
 }else if(sessionCompletion==='complete'){
  for(const targetId of executed.run.targetIds){
   if(!executed.run.participants[targetId]?.progress.completed||!executed.run.targetCompletions[targetId])throw new Error('A Session cannot complete before every Protocol Run completes.');
  }
  executed.run.completedAt=input.at;
  executed.run.completionKind=sessionCompletionKind(executed.run);
 }
 return Object.freeze({run:executed.run,transition:Object.freeze({...executed.transition,settlement:boundSettlement}),facts});
}
