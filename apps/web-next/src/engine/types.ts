/**
 * Runtime scheduling vocabulary. These types intentionally contain no
 * presentation model: a Sense Package is the content identity and a
 * ScheduledAction is the unit selected by planning.
 */
export type LearningCapability =
  | 'contextual_recognition'
  | 'meaning_to_form_recall'
  | 'novel_context_transfer'
  | 'boundary_discrimination';

/**
 * 一个 Step 的意图。这是领域闭集：编排插件可以自由定义 Step 的形式，但必须用
 * 这组词声明含义，因为**只有 `assessment` 能产生 Evidence 与 Memory Outcome**。
 * 没有它，多个插件会各自解释"什么叫学会了"。
 *
 * `introduction` 原先是 LearningCapability 的一个取值，这让类型说了假话：讲解
 * 不是一条能力——它不进 Gate、不产生 Evidence、也没有对应的 Assessment Resource。
 * 代价是三处 `Exclude<LearningCapability, 'introduction'>` 别名，和十余处
 * `capability === 'introduction'` 判断。现在它是 `intent: 'instruction'`，
 * 讲解步的 `capability` 就是 null——它确实不练任何能力。
 *
 * 今天只产出 instruction / assessment / repair 三种；`practice` 是给编排插件
 * 预留的第四种意图：练但不取证。
 */
export type LearningStepIntent =
  | 'instruction'
  | 'practice'
  | 'assessment'
  | 'repair';

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

/**
 * 这一步渲染哪张卡。见 learningRuntime/stepRenderers.tsx 的注册表。
 *
 * 与 `intent` 是两条轴，不能互相替代：`intent` 是领域闭集，回答"这一步算不算
 * 取证"；`stepKind` 是插件自由的，回答"渲染哪张卡"。同一条能力在不同编排下
 * 渲染成不同的卡——`contextual_recognition` 在首学是 `recognition`
 * （RecognitionCard），在到期复习是 `review_assessment`
 * （SensaReviewAssessmentCard）——所以它推不出来，只能由产出这一步的编排回答。
 *
 * 内置七种在联合里列出只为补全提示；类型本身对插件开放（`string & {}` 是
 * TypeScript 里"已知值 + 任意字符串"的写法，直接写 `string` 会让字面量提示
 * 全部消失）。真正的闭合发生在注册表：查不到就抛错。
 */
export type BuiltinLearningStepKind =
  | 'introduction'
  | 'recognition'
  | 'recall'
  | 'transfer'
  | 'review_assessment'
  | 'review_feedback'
  | 'review_repair';

export type LearningStepKind = BuiltinLearningStepKind | (string & {});

export interface ScheduledActionDefinition {
  actionKey: string;
  /** 这一步练的是哪条能力。讲解步不练任何能力，所以是 null。 */
  capability: LearningCapability | null;
  taskKey: string | null;
  kind: ScheduledActionKind;
  /** Content adapters default ordinary definitions to assessment. */
  intent?: LearningStepIntent;
  /**
   * 目录声明里没有这一项：卡片由编排决定，不由内容决定。产出这一步的编排
   * 盖章之后，类型收窄为 `OrchestratedStepDefinition`。
   */
  stepKind?: LearningStepKind;
  /** Present only for a scheduler-created repair action. */
  repairForActionKey?: string;
  repairResourceRef?: RepairResourceReference;
}

/**
 * 编排产出的一步：`intent` 与 `stepKind` 都已确定。
 *
 * 两个字段在 `ScheduledActionDefinition` 上是可选的，因为内容目录声明的是
 * 「有哪些可选动作」，不是「这次出哪一步」。编排盖章之后它们才成立，于是
 * 下游不必再为「万一没有」写回退。
 */
export interface OrchestratedStepDefinition extends ScheduledActionDefinition {
  intent: LearningStepIntent;
  stepKind: LearningStepKind;
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

export interface ScheduledAction<TContent = unknown> extends OrchestratedStepDefinition {
  ordinal: number;
  totalTarget: number;
  packageId: string;
  senseId: string;
  content: TContent;
  reason: ScheduledActionReason;
}

export type MeaningToFormRecallOutcome =
  | 'independent'
  | 'first_letter'
  | 'choice'
  | 'miss';

export type NovelTransferOutcome = 'success' | 'repair';

export type AcquisitionGateStatus = 'unresolved' | 'passed' | 'failed';

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
  targetCapability: LearningCapability;
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
  preferredCapabilities?: readonly LearningCapability[];
  lastCapability?: LearningCapability;
}

export interface SenseAcquisitionState {
  packageId: string;
  senseId: string;
  phase: 'new' | 'acquiring' | 'retaining' | 'relearning';
  introduced: boolean;
  declaredMastery: boolean;
  gateStatus: Record<LearningCapability, AcquisitionGateStatus>;
  /** A failed gate must receive a repair before it can be independently retested. */
  pendingRepairCapability: LearningCapability | null;
  pendingRepairForActionKey: string | null;
  repairCounts: Record<LearningCapability, number>;
  failureCounts: Record<LearningCapability, number>;
  lastAssessmentActionKey: Partial<Record<LearningCapability, string>>;
  lastActionOrdinal: number;
  totalAttempts: number;
  totalCorrect: number;
  transferScenarioIndex: number;
  skipped: boolean;
}

export interface AcquisitionGateProjection {
  capability: LearningCapability;
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
    'packageId' | 'senseId' | 'capability' | 'intent' | 'reason'
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
