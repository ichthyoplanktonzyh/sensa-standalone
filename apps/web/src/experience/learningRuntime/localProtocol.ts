import type {
  LearningPackageBundle,
  SensaLearningMaterializationSnapshot,
  SensaLightweightInitialMaterializationContent,
} from '@sensa/contracts/sensa';
import {createProtocolProgressState,decideAndApplyProtocolTransition,stableUuid,type GradedMemoryOutcome,type ProtocolObservationKind,type ProtocolProgressDefinition,type ProtocolProgressState,type ProtocolTransitionEffect,type ReviewSchedule,type WorkspaceSchedulerConfig} from '@sensa/learning-kernel';
import type {
  LearningProtocolBinding,
  LearningProtocolPurpose,
  PrototypeLearningPolicy,
  PrototypeRuntimeAdapterId,
} from './policyProfiles';
import type { InitialCompletionContract, LearningEvidenceLevel } from './orchestrations';
import {protocolPolicyRegistry} from './protocolPolicies';

export interface LocalLearningMaterialization {
  readonly snapshot: SensaLearningMaterializationSnapshot;
  readonly content: SensaLightweightInitialMaterializationContent;
}

export interface LocalLearningTargetIdentity {
  readonly learnerUserId:string;
  readonly senseId:string;
  readonly senseVersionId:string;
  readonly senseExpressionBindingId:string;
  readonly bindingVersionId:string;
  readonly targetLanguageTag:string;
  readonly familiarLanguageTag:string;
  readonly learnerLocale:string;
  readonly curriculumProvenance:Readonly<Record<string,unknown>>;
}

export interface LocalLearningPolicyAssignment {
  readonly assignmentId:string;
  readonly revision:number;
  readonly scope:'system_default'|'curriculum_source'|'target_override';
  readonly profileId:PrototypeLearningPolicy;
  readonly assignedByOperationId:string;
  readonly assignedAt:string;
  readonly provenance:Readonly<Record<string,unknown>>;
}

export interface LocalCommittedLearningPolicy {
  readonly commitmentId:string;
  readonly revision:number;
  readonly assignmentId:string;
  readonly assignmentRevision:number;
  readonly profileId:PrototypeLearningPolicy;
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
  readonly profileId:PrototypeLearningPolicy;
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
  packageKey: string | null;
  expression: string;
  meaning: string;
  policyAssignment:LocalLearningPolicyAssignment;
  committedPolicy:LocalCommittedLearningPolicy|null;
  declaredMastery?: boolean;
  declaredMasteryOperationId?: string;
  assurancePackageKey?: string;
  targetLanguageTag?: string;
  familiarLanguageTag?: string;
  material: LocalLearningMaterialization;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  memory: ReviewSchedule | null;
  memoryRevision: number;
  relearnAt: string | null;
  /** Protocol-owned repair state. The scheduler never interprets this value. */
  relearningState: unknown | null;
}

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
  protocolRunId:string;
  startReason:LocalProtocolStartReason;
  outcomePermissions:LocalProtocolOutcomePermissions;
  material: LocalLearningMaterialization;
  policyCommitment:LocalCommittedLearningPolicy;
  resolvedPlan:LocalResolvedLearningPlanSnapshot;
  progress:ProtocolProgressState;
  memoryRevision: number;
  dueAt: string | null;
  evidenceIds:string[];
}

/** A single opaque state slot owned by the adapter pinned on this Run. */
export interface LocalProtocolState {
  readonly adapterId: PrototypeRuntimeAdapterId;
  value: unknown;
}

/**
 * Persisted Session envelope. Each participant owns one formal Protocol Run;
 * the envelope may interleave several of them without merging their identity,
 * progress, evidence, materialization, or settlement.
 */
export interface LocalLearningRun {
  id: string;
  /** Primary target used to enter the Run. Every actual member is in targetIds. */
  targetId: string;
  targetIds: string[];
  participants: Record<string, LocalLearningRunParticipant>;
  targetCompletions: Record<string, { at: string; kind: string }>;
  purpose: LearningProtocolPurpose;
  policyProfileId: PrototypeLearningPolicy;
  policyProfileVersion: string;
  protocolBinding: LearningProtocolBinding;
  protocolVersion: string;
  protocolState: LocalProtocolState;
  schedulingPolicyId: string;
  schedulingPolicy: WorkspaceSchedulerConfig;
  learnerVisibleClaimBoundary: string;
  ordinal: number;
  revision: number;
  startedAt: string;
  completedAt: string | null;
  completionKind?: string;
}

export interface LocalLearningResource {
  key: string;
  digest: string;
  bundle: LearningPackageBundle;
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
      evidenceIds: readonly string[];
    }>
  | Readonly<{
      kind: 'memory_outcome';
      schedulerEligibility: 'due_review' | 'independent_relearning_evaluation';
      evaluationId: string;
      outcome: GradedMemoryOutcome;
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
      evidenceIds: readonly string[];
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

export interface LocalProtocolTransition {
  readonly protocolEffects: readonly LocalProtocolAuditEffect[];
  readonly evaluation:LocalProtocolEvaluationIntent|null;
  readonly settlement: LocalProtocolSettlementIntent | null;
}

export interface LocalProtocolEvaluationFacts {
 readonly step:Readonly<{protocolStepInstanceId:string;protocolRunId:string;stepKey:string;ordinal:number;purpose:LearningProtocolPurpose;learningMaterializationIds:readonly string[]}>;
 readonly action:Readonly<{actionId:string;protocolStepInstanceId:string;protocolRunId:string;actionIntent:LocalProtocolEvaluationIntent['actionIntent'];kind:LocalLearningAction['kind'];issuedAt:string}>;
 readonly attempt:Readonly<{attemptId:string;actionId:string;protocolRunId:string;learnerUserId:string;learningTargetId:string;response:LocalLearningAction;submittedAt:string}>;
 readonly observation:Readonly<{observationId:string;attemptId:string;actionId:string;protocolRunId:string;kind:ProtocolObservationKind;checkpointId:string|null;valid:boolean;result:unknown;evidenceIds:readonly string[];observedAt:string}>;
 readonly evidence:readonly Readonly<{learningEvidenceId:string;observationId:string;attemptId:string;protocolRunId:string;learningTargetId:string;basis:string;polarity:'positive'|'negative';capabilityObjectiveIds:readonly string[];evidenceRuleVersion:string;derivedAt:string}>[];
 readonly transitionDecision:Readonly<{transitionDecisionId:string;protocolRunId:string;observationId:string;progressionPolicyId:string;effects:readonly ProtocolTransitionEffect[];decidedAt:string}>;
}

/** Storage port for a versioned Protocol implementation. It cannot write retention state. */
export interface LocalProtocolExecution {
  readonly cohort?: boolean;
  validate?(target: LocalLearningTarget, resource: LocalLearningResource | undefined): void;
  activeTargetId?(run: LocalLearningRun): string;
  initialize(
    target: LocalLearningTarget,
    resource: LocalLearningResource | undefined,
    purpose: LearningProtocolPurpose,
    run: LocalLearningRun,
  ): LocalProtocolState;
  stepId(run: LocalLearningRun): string;
  /** Adapter-internal reducer. Call executeLocalProtocolTransition, never this directly. */
  unsafeTransition(
    target: LocalLearningTarget,
    run: LocalLearningRun,
    resource: LocalLearningResource | undefined,
    action: LocalLearningAction,
    at: string,
  ): LocalProtocolTransition;
  replayStart(
    target: LocalLearningTarget,
    resource: LocalLearningResource | undefined,
    saved: LocalLearningRun,
  ): LocalLearningRun;
}

export const localProtocolPluginContractVersion='sensa-local-protocol-plugin-v1' as const;

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
 readonly runtimeAdapterId:PrototypeRuntimeAdapterId;
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
  material:LocalLearningMaterialization=target.material,
):void{
  const provenance=material.snapshot.provenance;
  if(
    material.snapshot.learnerUserId!==target.identity.learnerUserId
    || material.snapshot.learningTargetId!==target.id
    || provenance.senseId!==target.identity.senseId
    || provenance.senseVersionId!==target.identity.senseVersionId
    || provenance.bindingId!==target.identity.senseExpressionBindingId
    || provenance.bindingVersionId!==target.identity.bindingVersionId
  )throw new Error('localFlow.resourceInvalid');
}

export const createLocalProtocolState = (
  adapterId: PrototypeRuntimeAdapterId,
  value: unknown,
): LocalProtocolState => ({ adapterId, value });

export function readLocalProtocolState<T>(
  run: LocalLearningRun,
  adapterId: PrototypeRuntimeAdapterId,
): T {
  if (run.protocolState.adapterId !== adapterId) throw new Error('localFlow.resourceInvalid');
  return run.protocolState.value as T;
}

const runContractProjection=(run:LocalLearningRun)=>({
 id:run.id,targetId:run.targetId,targetIds:run.targetIds,participants:run.participants,
 purpose:run.purpose,policyProfileId:run.policyProfileId,policyProfileVersion:run.policyProfileVersion,
 protocolBinding:run.protocolBinding,protocolVersion:run.protocolVersion,
 schedulingPolicyId:run.schedulingPolicyId,schedulingPolicy:run.schedulingPolicy,
 learnerVisibleClaimBoundary:run.learnerVisibleClaimBoundary,
 ordinal:run.ordinal,revision:run.revision,startedAt:run.startedAt,
});

const sameValue=(left:unknown,right:unknown):boolean=>JSON.stringify(left)===JSON.stringify(right);
const sameOutcomePermissions=(left:LocalProtocolOutcomePermissions,right:LocalProtocolOutcomePermissions):boolean=>
 left.initialLearningCompletion===right.initialLearningCompletion
 &&left.schedulingHandoff===right.schedulingHandoff
 &&left.memoryOutcome===right.memoryOutcome
 &&left.relearningProgress===right.relearningProgress
 &&left.relearningCompletion===right.relearningCompletion;

const isJsonValue=(value:unknown):boolean=>{
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(isJsonValue);
 if(typeof value==='object')return Object.getPrototypeOf(value)===Object.prototype&&Object.values(value as Record<string,unknown>).every(child=>child!==undefined&&isJsonValue(child));
 return false;
};

const validateProtocolEvaluation=(run:LocalLearningRun,evaluation:LocalProtocolEvaluationIntent|null):void=>{
 if(!evaluation)return;
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
 Object.fromEntries(Object.entries(saved.participants).map(([id,participant])=>[id,{...participant,evidenceIds:[],progress:createLocalProtocolProgress(participant.protocolRunId,saved.protocolBinding)}]));

/**
 * The capability-safe Protocol reducer boundary. Adapters work on detached
 * values and may only return Protocol-owned state/completion mutations plus a
 * typed settlement intent. All pinned Run inputs remain immutable.
 */
export function executeLocalProtocolTransition(input:Readonly<{
 execution:LocalProtocolExecution;
 target:LocalLearningTarget;
 run:LocalLearningRun;
 resource:LocalLearningResource|undefined;
 action:LocalLearningAction;
 at:string;
}>):Readonly<{run:LocalLearningRun;transition:LocalProtocolTransition}>{
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
 if(run.protocolState.adapterId!==run.protocolBinding.runtimeAdapterId||!isJsonValue(run.protocolState.value))throw new Error('localFlow.resourceInvalid');
 if(!transition||!Array.isArray(transition.protocolEffects)||transition.protocolEffects.some(effect=>!effect||typeof effect.kind!=='string'||!effect.kind.trim()||!isJsonValue(effect.payload)))throw new Error('Invalid Protocol transition result.');
 validateProtocolEvaluation(run,transition.evaluation);
 const participant=run.participants[input.target.id];
 if(!participant||!run.targetIds.includes(input.target.id))throw new Error('localFlow.stepChanged');
 const settlement=transition.settlement;
 if(settlement){
  if((settlement.kind==='relearning_progress'||settlement.kind==='memory_outcome'&&settlement.relearning)&&!isJsonValue(settlement.kind==='relearning_progress'?settlement.state:settlement.relearning?.state))throw new Error('Relearning state must be canonical JSON.');
  if(!settlementAllowed(participant.outcomePermissions,settlement))throw new Error('localFlow.stepChanged');
  if(input.run.targetCompletions[input.target.id])throw new Error('A Protocol Run may settle only once.');
  const requiresCompletion=settlement.kind==='initial_learning_completion'
   || settlement.kind==='relearning_completion'
   || settlement.kind==='memory_outcome'&&settlement.schedulerEligibility==='due_review';
  if(requiresCompletion&&!run.targetCompletions[input.target.id])throw new Error('A completing Protocol settlement requires a target completion.');
  const completion=run.targetCompletions[input.target.id];
  if(completion&&completion.at!==input.at)throw new Error('Protocol completion and settlement clocks disagree.');
 }
 return Object.freeze({run,transition:Object.freeze({protocolEffects:Object.freeze([...transition.protocolEffects]),evaluation:transition.evaluation,settlement})});
}

/** Materialize the formal evaluation pipeline only when the Protocol declares one. */
export function materializeLocalProtocolEvaluation(input:Readonly<{
 operationId:string;
 stepKey:string;
 at:string;
 target:LocalLearningTarget;
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
  step:Object.freeze({protocolStepInstanceId,protocolRunId,stepKey:input.stepKey,ordinal:input.run.ordinal,purpose:input.run.purpose,learningMaterializationIds:Object.freeze([...participant.resolvedPlan.learningMaterializationIds])}),
  action:Object.freeze({actionId,protocolStepInstanceId,protocolRunId,actionIntent:input.evaluation.actionIntent,kind:input.action.kind,issuedAt:input.at}),
  attempt:Object.freeze({attemptId,actionId,protocolRunId,learnerUserId:input.target.identity.learnerUserId,learningTargetId:input.target.id,response:structuredClone(input.action),submittedAt:input.at}),
  observation:Object.freeze({observationId,attemptId,actionId,protocolRunId,kind:input.evaluation.observation.kind,checkpointId:input.evaluation.observation.checkpointId,valid:input.evaluation.observation.valid,result:structuredClone(input.evaluation.observation.result),evidenceIds,observedAt:input.at}),
  evidence,
  transitionDecision:Object.freeze({transitionDecisionId:progression.decision.decisionId,protocolRunId,observationId,progressionPolicyId:progression.decision.progressionPolicyId,effects,decidedAt:input.at}),
 });
}

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
 target:LocalLearningTarget;
 run:LocalLearningRun;
 resource:LocalLearningResource|undefined;
 action:LocalLearningAction;
}>):Readonly<{run:LocalLearningRun;transition:LocalProtocolTransition;facts:LocalProtocolEvaluationFacts|null}>{
 const executed=executeLocalProtocolTransition(input);
 const facts=materializeLocalProtocolEvaluation({...input,run:executed.run,evaluation:executed.transition.evaluation});
 const participant=executed.run.participants[input.target.id];
 if(!participant)throw new Error('localFlow.stepChanged');
 if(facts)participant.evidenceIds=[...new Set([...participant.evidenceIds,...facts.evidence.map(fact=>fact.learningEvidenceId)])];
 const settlement=executed.transition.settlement;
 let boundSettlement=settlement;
 if(settlement?.kind==='initial_learning_completion')boundSettlement={...settlement,evidenceIds:[...participant.evidenceIds]};
 if(settlement?.kind==='relearning_completion')boundSettlement={...settlement,evidenceIds:[...participant.evidenceIds]};
 if(settlement?.kind==='memory_outcome')boundSettlement={...settlement,outcome:{...settlement.outcome,evidenceIds:facts?.evidence.map(fact=>fact.learningEvidenceId)??[]}};
 const completesProtocol=settlement?.kind==='initial_learning_completion'||settlement?.kind==='relearning_completion'||settlement?.kind==='memory_outcome'&&settlement.schedulerEligibility==='due_review';
 if(completesProtocol&&!participant.progress.completed)throw new Error('Completion Policy has not completed this Protocol Run.');
 if(executed.run.completedAt&&executed.run.completionKind!=='wait_relearning')for(const targetId of executed.run.targetIds){
  if(!executed.run.participants[targetId]?.progress.completed||!executed.run.targetCompletions[targetId])throw new Error('A Session cannot complete before every Protocol Run completes.');
 }
 return Object.freeze({run:executed.run,transition:Object.freeze({...executed.transition,settlement:boundSettlement}),facts});
}
