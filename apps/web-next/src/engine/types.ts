/**
 * Runtime scheduling vocabulary. These types intentionally contain no
 * presentation model: a Sense Package is the content identity and a
 * ScheduledAction is the unit selected by planning.
 */
export type LearningCapability =
  | 'introduction'
  | 'contextual_recognition'
  | 'meaning_to_form_recall'
  | 'novel_context_transfer'
  | 'boundary_discrimination';

export type ScheduledActionKind =
  | 'introduction'
  | 'acquisition_gate'
  | 'retention_review'
  | 'relearning_gate';

export type ScheduledActionReason =
  | 'new'
  | 'acquisition_ready'
  | 'repair'
  | 'due'
  | 'relearning';

/**
 * A repair is a learning intervention, not an assessment.  Keeping this
 * distinction on the scheduled action lets the frozen presentation layer
 * reuse its existing capability card without letting the queue turn a
 * reveal/rebinding step into Evidence.
 */
export type ScheduledActionMode = 'assessment' | 'repair';

export type RepairResourceRole =
  | 'experience_recap'
  | 'learning_example'
  | 'l1_bridge'
  | 'sense_features';

export interface RepairResourceReference {
  role: RepairResourceRole;
  /** Null means the current catalog adapter has not exposed its binding yet. */
  key: string | null;
  source: 'package_declared' | 'scheduler_fallback';
  fallbackReason?: 'repair_binding_not_exposed';
}

export interface ScheduledActionDefinition {
  actionKey: string;
  capability: LearningCapability;
  taskKey: string | null;
  kind: ScheduledActionKind;
  /** Content adapters default ordinary definitions to assessment. */
  mode?: ScheduledActionMode;
  /** Present only for a scheduler-created repair action. */
  repairForActionKey?: string;
  repairResourceRef?: RepairResourceReference;
}

export interface SchedulablePackage<TContent = unknown> {
  packageId: string;
  senseId: string;
  content: TContent;
  requiredCapabilities: readonly LearningCapability[];
  actions: readonly ScheduledActionDefinition[];
  /** Optional package-declared repair bindings exposed by the content adapter. */
  repairActions?: readonly ScheduledActionDefinition[];
  reviewActions: readonly ScheduledActionDefinition[];
}

export interface ScheduledAction<TContent = unknown> extends ScheduledActionDefinition {
  ordinal: number;
  totalTarget: number;
  packageId: string;
  senseId: string;
  content: TContent;
  reason: ScheduledActionReason;
  mode: ScheduledActionMode;
}

export type MeaningToFormRecallOutcome =
  | 'independent'
  | 'first_letter'
  | 'choice'
  | 'miss';

export type NovelTransferOutcome = 'success' | 'repair';

export type AcquisitionGateStatus = 'unresolved' | 'passed' | 'failed';

export type ReviewCapability = Exclude<LearningCapability, 'introduction'>;

export type RelearningCycleStage = 'repair_pending' | 'retest_pending';

/**
 * Learner-local recovery progress. This is deliberately separate from the
 * FSRS memory projection: a Relearning Cycle describes which capability needs
 * repair and retest, while FSRS continues to describe only the long-term
 * schedule produced by the failed Review.
 */
export interface RelearningCycle {
  cycleId: string;
  packageId: string;
  senseId: string;
  targetCapability: ReviewCapability;
  failedReviewOutcomeKey: string;
  failedReviewActionKey: string;
  stage: RelearningCycleStage;
  repairCount: number;
  lastActionOrdinal: number;
}

/**
 * Non-scheduling memory facts that may help Semantic Policy choose a review
 * assessment. FSRS fields such as reps/lapses remain due-state inputs only;
 * they must not select the assessment kind.
 */
export interface ReviewMemoryFacts {
  lastOutcome?: 'independent_retrieval' | 'transfer_confirmed' | 'retrieval_failed';
  failureCount?: number;
}

/**
 * Optional policy/diagnostic hints supplied by the authoritative learner
 * state. They are intentionally separate from the FSRS due projection.
 */
export interface ReviewDiagnosticFacts {
  preferredCapabilities?: readonly ReviewCapability[];
  lastCapability?: ReviewCapability;
}

export interface SenseAcquisitionState {
  packageId: string;
  senseId: string;
  phase: 'new' | 'acquiring' | 'retaining' | 'relearning';
  introduced: boolean;
  declaredMastery: boolean;
  gateStatus: Record<ReviewCapability, AcquisitionGateStatus>;
  /** A failed gate must receive a repair before it can be independently retested. */
  pendingRepairCapability: ReviewCapability | null;
  pendingRepairForActionKey: string | null;
  repairCounts: Record<ReviewCapability, number>;
  failureCounts: Record<ReviewCapability, number>;
  lastAssessmentActionKey: Partial<Record<ReviewCapability, string>>;
  lastActionOrdinal: number;
  totalAttempts: number;
  totalCorrect: number;
  transferScenarioIndex: number;
  skipped: boolean;
}

export interface AcquisitionGateProjection {
  capability: ReviewCapability;
  status: AcquisitionGateStatus;
  repairing: boolean;
}

export interface AcquisitionTargetProjection {
  packageId: string;
  senseId: string;
  phase: SenseAcquisitionState['phase'];
  introduced: boolean;
  declaredMastery: boolean;
  graduated: boolean;
  gates: readonly AcquisitionGateProjection[];
}

/**
 * Read-only interface from the Structured Acquisition scheduler to its shell.
 * The shell can explain the current work without learning the queue's Maps,
 * cooldown rules or mutable state shape.
 */
export interface StructuredAcquisitionProjection {
  currentAction: Readonly<Pick<
    ScheduledAction,
    'packageId' | 'senseId' | 'capability' | 'mode' | 'reason'
  >> | null;
  targets: readonly AcquisitionTargetProjection[];
}

export interface Session<TContent = unknown> {
  index: number;
  totalTarget: number;
  action: ScheduledAction<TContent>;
  package: SchedulablePackage<TContent>;
  settled: boolean;
  result: boolean | null;
  transferScenarioIndex: number;
  recallOutcome?: MeaningToFormRecallOutcome;
  transferOutcome?: NovelTransferOutcome;
}

export interface QueueStats {
  sessionsCompleted: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
  masteredCount: number;
  totalSenses: number;
  /** Compatibility alias used by the frozen progress surface. */
  totalWords: number;
  startTime: number;
}

export interface QueueConfig {
  /** Maximum number of concurrently acquiring Senses. */
  activeWindow?: number;
  /** Number of other Actions that must occur before another Sense appears. */
  minGap?: number;
  /** Optional display estimate. Scheduling completion never depends on it. */
  progressTarget?: number;
}

export interface ReviewCandidate<TContent = unknown> {
  package: SchedulablePackage<TContent>;
  dueAt: number;
  /** FSRS facts are carried for due/projection context, never action choice. */
  reps: number;
  lapses: number;
  phase: 'retaining' | 'relearning';
  /** Persisted recovery progress; required for a targeted Relearning path. */
  relearning?: RelearningCycle | null;
  memoryFacts?: ReviewMemoryFacts;
  diagnosticFacts?: ReviewDiagnosticFacts;
}

/**
 * Stable identity for the one Memory Outcome belonging to one due Review.
 * It intentionally excludes the learner response and wall-clock time so a
 * duplicate submit, undo/replay, queue reconstruction or reload resolves to
 * the same persistence guard. The Action is accepted by the helper so call
 * sites cannot derive identity from a learner response; Policy may rotate
 * that Action without changing the due Review identity.
 */
export function reviewOutcomeKey(
  candidate: Pick<ReviewCandidate, 'package' | 'dueAt'>,
  _action: Pick<ScheduledActionDefinition, 'actionKey'>,
): string {
  void _action;
  return [
    'sensa-review-v1',
    candidate.package.packageId,
    candidate.package.senseId,
    String(candidate.dueAt),
  ].map((part) => encodeURIComponent(part)).join(':');
}
