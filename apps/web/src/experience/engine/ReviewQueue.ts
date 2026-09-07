import { encodeQueueSnapshot, decodeQueueSnapshot } from './queueSnapshot';
import { memoryOutcomeExposesForgetting } from '@sensa/learning-kernel';
import {
  isPackageRepair,
  isRelearningAssessment,
  isRetentionAssessment,
  retentionOrchestration,
  reviewAssessmentKindFor,
  type RetentionCandidate,
  type RetentionRepairBasis,
  type StepOrchestration,
} from './stepOrchestration';
import type {
  LearningCapability,
  LearningStepKind,
  QueueConfig,
  RelearningCycle,
  ReviewCandidate,
  SchedulablePackage,
  ScheduledAction,
} from './types';
import { retentionTargetIdOf, reviewOutcomeKey } from './types';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
} from '../review/types';
import {
  canProduceReviewMemoryOutcome,
  resolveReviewFocusDimension,
  resolveReviewMemoryOutcome,
} from '../review/types';

export interface ReviewSession<TContent = unknown> {
  index: number;
  totalTarget: number;
  candidate: ReviewCandidate<TContent>;
  package: SchedulablePackage<TContent>;
  action: ScheduledAction<TContent>;
  assessmentKind: ReviewAssessmentKind;
  /**
   * 这次复习当前渲染哪张卡。开局照抄编排盖的章；结算之后转到反馈卡——
   * 反馈不是编排产出的新一步，是同一步结算后的相位，所以只有这里能写它。
   * 修复步用讲解卡，永远不进反馈。
   */
  stepKind: LearningStepKind;
  settled: boolean;
  result: ReviewAssessmentResult | null;
}

export interface ReviewStats {
  totalTargets: number;
  completedTargets: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
  startTime: number;
}

export type RetentionRuntimeTargetStatus =
  | 'review_pending'
  | 'reviewing'
  | 'relearning_repair'
  | 'relearning_retest'
  | 'retaining'
  | 'declared_mastery';

export interface RetentionRuntimeTargetProjection {
  packageId: string;
  senseId: string;
  retentionTargetId: string;
  status: RetentionRuntimeTargetStatus;
  currentCapability: LearningCapability | null;
  memoryOutcome: ReviewAssessmentResult['memoryOutcome'] | null;
  reviewSettled: boolean;
  relearningCompleted: boolean;
}

export interface RetentionRuntimeProjection {
  currentAction: Readonly<Pick<
    ScheduledAction,
    'packageId' | 'senseId' | 'retentionTargetId' | 'capability' | 'intent' | 'reason'
  >> | null;
  targets: readonly RetentionRuntimeTargetProjection[];
}

export type RelearningEffectEvent =
  | 'repair_completed'
  | 'retest_failed'
  | 'retest_passed';

export interface ReviewRetentionEffect<TContent = unknown> {
  type: 'retention_outcome';
  outcomeKey: string;
  candidate: ReviewCandidate<TContent>;
  action: ScheduledAction<TContent>;
  result: ReviewAssessmentResult;
  /** Non-null only when this failed retention outcome opened Relearning. */
  relearningCycle: RelearningCycle | null;
}

export interface ReviewRelearningEffect<TContent = unknown> {
  type: 'relearning_progress';
  event: RelearningEffectEvent;
  candidate: ReviewCandidate<TContent>;
  action: ScheduledAction<TContent>;
  cycle: RelearningCycle;
}

export type ReviewRuntimeEffect<TContent = unknown> =
  | ReviewRetentionEffect<TContent>
  | ReviewRelearningEffect<TContent>;

export interface ReviewQueueDependencies<TContent = unknown> {
  /** The single local runtime effect seam for retention and Relearning commits. */
  onEffect?: (effect: ReviewRuntimeEffect<TContent>) => void;
}

interface ReviewSnapshot<TContent> {
  pendingQueue: ReviewCandidate<TContent>[];
  completedCount: number;
  actionOrdinal: number;
  totalAttempts: number;
  totalCorrect: number;
  lastActionOrdinalByRetentionTarget: [string, number][];
  currentSession: ReviewSession<TContent> | null;
  runtimeTargets: [string, RetentionRuntimeTargetProjection][];
}

function cloneCycle(cycle: RelearningCycle | null | undefined): RelearningCycle | null | undefined {
  return cycle
    ? { ...cycle, repairTarget: { ...cycle.repairTarget } }
    : cycle;
}

function cloneCandidate<TContent>(candidate: ReviewCandidate<TContent>): ReviewCandidate<TContent> {
  return {
    ...candidate,
    relearning: cloneCycle(candidate.relearning),
    memoryFacts: candidate.memoryFacts ? { ...candidate.memoryFacts } : undefined,
    diagnosticFacts: candidate.diagnosticFacts
      ? {
          ...candidate.diagnosticFacts,
          preferredCapabilities: candidate.diagnosticFacts.preferredCapabilities
            ? [...candidate.diagnosticFacts.preferredCapabilities]
            : undefined,
        }
      : undefined,
  };
}

function cloneAction<TContent>(action: ScheduledAction<TContent>): ScheduledAction<TContent> {
  return {
    ...action,
    repairResourceRef: action.repairResourceRef
      ? { ...action.repairResourceRef }
      : undefined,
  };
}

function cloneSession<TContent>(session: ReviewSession<TContent>): ReviewSession<TContent> {
  return {
    ...session,
    candidate: cloneCandidate(session.candidate),
    action: cloneAction(session.action),
    result: session.result ? cloneReviewResult(session.result) : null,
  };
}

function cloneReviewResult(result: ReviewAssessmentResult): ReviewAssessmentResult {
  return {
    ...result,
    memoryOutcome: result.memoryOutcome
      ? { ...result.memoryOutcome, evidenceIds: [...result.memoryOutcome.evidenceIds] }
      : null,
  };
}

function cloneRuntimeTarget(
  target: RetentionRuntimeTargetProjection,
): RetentionRuntimeTargetProjection {
  return { ...target };
}

function normalizeCandidate<TContent>(candidate: ReviewCandidate<TContent>): ReviewCandidate<TContent> {
  return cloneCandidate(candidate);
}

function hasExecutableReviewAction<TContent>(candidate: ReviewCandidate<TContent>): boolean {
  if (candidate.phase === 'retaining') {
    return candidate.package.reviewActions.some(isRetentionAssessment);
  }
  const cycle = candidate.relearning;
  if (!cycle) return false;
  const capability = cycle.repairTarget.kind === 'capability'
    ? cycle.repairTarget.capability
    : null;
  if (!capability) return false;
  if (cycle.stage === 'repair_pending') {
    return candidate.package.repairActions?.some((action) =>
      isPackageRepair(action, capability)) ?? false;
  }
  return candidate.package.reviewActions.some((action) =>
    isRelearningAssessment(action) && action.capability === capability);
}

/**
 * Review scheduler over due Retention Targets and persisted Relearning cycles.
 * Retention produces one Memory Outcome; Relearning is a separate repair →
 * independent retest state machine and never calls the memory settlement seam.
 */
export class ReviewQueue<TContent = unknown> {
  private pendingQueue: ReviewCandidate<TContent>[];
  private currentSession: ReviewSession<TContent> | null = null;
  private readonly totalInitialCount: number;
  private readonly minGap: number;
  private readonly progressTarget: number;
  private readonly orchestration: StepOrchestration<RetentionCandidate, RetentionRepairBasis>;
  private completedCount = 0;
  private actionOrdinal = 0;
  private totalAttempts = 0;
  private totalCorrect = 0;
  private readonly lastActionOrdinalByRetentionTarget = new Map<string, number>();
  private readonly startTime: number;
  private readonly dependencies: ReviewQueueDependencies<TContent>;
  private readonly runtimeTargets: Map<string, RetentionRuntimeTargetProjection>;
  /** Persists across local undo so replay cannot repeat external settlement. */
  private readonly emittedOutcomeKeys = new Set<string>();
  /** Keep a replayed session aligned with the first durable learner response. */
  private readonly emittedOutcomeResults = new Map<string, ReviewAssessmentResult>();
  private historySnapshots: ReviewSnapshot<TContent>[] = [];

  public exportCheckpoint(): string {
    return encodeQueueSnapshot({
      pendingQueue: this.pendingQueue,
      currentSession: this.currentSession,
      totalInitialCount: this.totalInitialCount,
      minGap: this.minGap,
      progressTarget: this.progressTarget,
      completedCount: this.completedCount,
      actionOrdinal: this.actionOrdinal,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect,
      lastActionOrdinalByRetentionTarget: this.lastActionOrdinalByRetentionTarget,
      startTime: this.startTime,
      runtimeTargets: this.runtimeTargets,
      emittedOutcomeKeys: this.emittedOutcomeKeys,
      emittedOutcomeResults: this.emittedOutcomeResults,
      historySnapshots: this.historySnapshots
    });
  }

  public static restoreCheckpoint<TContent>(raw: string,
    dependencies: ReviewQueueDependencies<TContent> = {},
    orchestration = retentionOrchestration,
  ): ReviewQueue<TContent> {
    const saved = decodeQueueSnapshot<Record<string, unknown>>(raw);
    const queue = new ReviewQueue<TContent>([], dependencies, {}, orchestration);
    const fields = ['pendingQueue', 'currentSession', 'totalInitialCount', 'minGap', 'progressTarget', 'completedCount', 'actionOrdinal', 'totalAttempts', 'totalCorrect', 'lastActionOrdinalByRetentionTarget', 'startTime', 'runtimeTargets', 'emittedOutcomeKeys', 'emittedOutcomeResults', 'historySnapshots'];
    for (const field of fields) {
      if (!(field in saved)) throw Error('Incomplete queue checkpoint');
      Object.assign(queue, {[field]: saved[field]});
    }
    return queue;
  }

  constructor(
    dueCandidates: readonly ReviewCandidate<TContent>[],
    dependencies: ReviewQueueDependencies<TContent> = {},
    config: QueueConfig = {},
    orchestration: StepOrchestration<RetentionCandidate, RetentionRepairBasis>
      = retentionOrchestration,
  ) {
    const seenRetentionTargetIds = new Set<string>();
    for (const candidate of dueCandidates) {
      const retentionTargetId = retentionTargetIdOf(candidate.package);
      if (retentionTargetId.trim().length === 0) {
        throw new Error(`Package ${candidate.package.packageId} has an empty Retention Target identity.`);
      }
      if (seenRetentionTargetIds.has(retentionTargetId)) {
        throw new Error(`Duplicate Retention Target identity: ${retentionTargetId}`);
      }
      seenRetentionTargetIds.add(retentionTargetId);
      if (candidate.phase === 'relearning' && !candidate.relearning) {
        throw new Error(
          `Relearning candidate ${retentionTargetIdOf(candidate.package)} lacks a Relearning Cycle.`,
        );
      }
      if (
        candidate.relearning
        && candidate.relearning.retentionTargetId !== retentionTargetIdOf(candidate.package)
      ) {
        throw new Error(
          `Relearning Cycle ${candidate.relearning.cycleId} belongs to another Retention Target.`,
        );
      }
    }
    this.pendingQueue = dueCandidates
      .filter(hasExecutableReviewAction)
      .map(normalizeCandidate);
    this.runtimeTargets = new Map(this.pendingQueue.map((candidate) => {
      const cycle = candidate.relearning;
      const status: RetentionRuntimeTargetStatus = candidate.phase === 'retaining'
        ? 'review_pending'
        : cycle?.stage === 'retest_pending'
          ? 'relearning_retest'
          : 'relearning_repair';
      const retentionTargetId = retentionTargetIdOf(candidate.package);
      return [retentionTargetId, {
        packageId: candidate.package.packageId,
        senseId: candidate.package.senseId,
        retentionTargetId,
        status,
        currentCapability: cycle?.repairTarget.kind === 'capability'
          ? cycle.repairTarget.capability
          : null,
        memoryOutcome: null,
        reviewSettled: candidate.phase === 'relearning',
        relearningCompleted: false,
      }];
    }));
    this.totalInitialCount = this.pendingQueue.length;
    this.minGap = Math.max(0, Math.floor(config.minGap ?? 2));
    this.progressTarget = Math.max(1, config.progressTarget ?? this.totalInitialCount);
    this.orchestration = orchestration;
    this.startTime = Date.now();
    this.dependencies = dependencies;
    this.next();
  }

  public getCurrentSession(): ReviewSession<TContent> | null {
    return this.currentSession;
  }

  public isDone(): boolean {
    return this.pendingQueue.length === 0 && this.currentSession === null;
  }

  public getProjection(): RetentionRuntimeProjection {
    return {
      currentAction: this.currentSession
        ? {
            packageId: this.currentSession.action.packageId,
            senseId: this.currentSession.action.senseId,
            retentionTargetId: this.currentSession.action.retentionTargetId,
            capability: this.currentSession.action.capability,
            intent: this.currentSession.action.intent,
            reason: this.currentSession.action.reason,
          }
        : null,
      targets: [...this.runtimeTargets.values()].map(cloneRuntimeTarget),
    };
  }

  public next(): ReviewSession<TContent> | null {
    if (this.currentSession && !this.currentSession.settled) {
      return this.currentSession;
    }
    if (this.pendingQueue.length === 0) {
      this.currentSession = null;
      return null;
    }

    const ordinal = this.actionOrdinal + 1;
    // 选谁、出哪一步都由编排插件回答（见 stepOrchestration.ts）；这里只把
    // 到期队列投影成候选，并把拿回来的 Step 定义装配成一次复习会话。
    const selection = this.orchestration.fresh(
      this.pendingQueue.map((candidate) => this.toCandidate(candidate)),
      { ordinal, minGap: this.minGap },
    );
    if (!selection) {
      this.currentSession = null;
      return null;
    }
    const chosenIndex = this.pendingQueue.findIndex((candidate) =>
      retentionTargetIdOf(candidate.package) === selection.target.targetKey);
    const candidate = this.pendingQueue.splice(chosenIndex, 1)[0]!;
    const cycle = candidate.phase === 'relearning' ? candidate.relearning : null;
    if (candidate.phase === 'relearning' && cycle) candidate.relearning = cycle;
    const definition = selection.definition;
    const intent = definition.intent ?? 'assessment';
    const assessmentKind = reviewAssessmentKindFor(definition.capability);
    if (!assessmentKind) {
      this.pendingQueue.unshift(candidate);
      this.currentSession = null;
      return null;
    }
    const action: ScheduledAction<TContent> = {
      ...definition,
      intent,
      ordinal,
      totalTarget: this.progressTarget,
      packageId: candidate.package.packageId,
      senseId: candidate.package.senseId,
      retentionTargetId: retentionTargetIdOf(candidate.package),
      content: candidate.package.content,
      reason: intent === 'repair'
        ? 'repair'
        : candidate.phase === 'relearning'
        ? 'relearning'
        : 'due',
    };
    this.currentSession = {
      index: ordinal,
      totalTarget: this.progressTarget,
      candidate,
      package: candidate.package,
      action,
      assessmentKind,
      stepKind: definition.stepKind,
      settled: false,
      result: null,
    };
    const runtimeTarget = this.runtimeTargets.get(retentionTargetIdOf(candidate.package))!;
    runtimeTarget.status = candidate.phase === 'retaining'
      ? 'reviewing'
      : intent === 'repair'
        ? 'relearning_repair'
        : 'relearning_retest';
    runtimeTarget.currentCapability = definition.capability;
    return this.currentSession;
  }

  public settle(result: ReviewAssessmentResult): ReviewSession<TContent> | null {
    const session = this.currentSession;
    if (!session || session.settled) return session;
    if (session.action.intent === 'repair') {
      throw new Error('A repair Action must be completed through completeRepair().');
    }
    if (result.kind !== session.assessmentKind) {
      throw new Error(`Review result kind ${result.kind} does not match ${session.assessmentKind}.`);
    }

    const candidateBeforeSettlement = cloneCandidate(session.candidate);
    const isRetention = session.candidate.phase === 'retaining'
      && session.action.kind === 'retention_review'
      && canProduceReviewMemoryOutcome(session.assessmentKind);
    const isRelearningRetest = session.candidate.phase === 'relearning'
      && session.action.kind === 'relearning_gate';
    const outcomeKey = isRetention
      ? reviewOutcomeKey(session.candidate, session.action)
      : null;
    // An undo can reopen the local assessment after the external outcome has
    // already been emitted. If the learner changes the answer on replay,
    // retain the first response locally as well; the persisted guard cannot
    // roll a Memory Outcome back or replace it with a second one.
    const effectiveResult = outcomeKey
      ? this.emittedOutcomeResults.get(outcomeKey) ?? result
      : result;
    const canonicalMemoryOutcome = isRetention
      ? resolveReviewMemoryOutcome(session.assessmentKind, effectiveResult.correct)
      : null;
    const requiresRelearning = canonicalMemoryOutcome !== null
      && memoryOutcomeExposesForgetting(canonicalMemoryOutcome);
    const failedCycle = isRetention && requiresRelearning && outcomeKey
      ? this.createRelearningCycle(session, outcomeKey)
      : null;
    const settledResult: ReviewAssessmentResult = {
      ...effectiveResult,
      focusDimension: resolveReviewFocusDimension(session.assessmentKind),
      memoryOutcome: canonicalMemoryOutcome,
      // Only a due retaining assessment can produce a Memory Outcome. A
      // relearning gate is an independent capability retest, not a second
      // memory scheduler input.
      evidenceEligible: isRetention,
    };
    this.captureSnapshot();
    session.settled = true;
    session.result = settledResult;
    session.stepKind = 'review_feedback';
    this.actionOrdinal = session.action.ordinal;
    this.lastActionOrdinalByRetentionTarget.set(
      session.action.retentionTargetId,
      this.actionOrdinal,
    );
    this.totalAttempts += 1;
    if (settledResult.correct) this.totalCorrect += 1;

    if (isRetention) {
      if (!requiresRelearning) {
        this.completedCount += 1;
      } else if (failedCycle) {
        session.candidate.phase = 'relearning';
        session.candidate.relearning = failedCycle;
        this.pendingQueue.push(session.candidate);
      }
      this.emitRetentionEffect(
        outcomeKey!,
        candidateBeforeSettlement,
        session.action,
        settledResult,
        failedCycle,
      );
      const runtimeTarget = this.runtimeTargets.get(session.action.retentionTargetId)!;
      runtimeTarget.status = requiresRelearning ? 'relearning_repair' : 'retaining';
      runtimeTarget.currentCapability = session.action.capability;
      runtimeTarget.memoryOutcome = settledResult.memoryOutcome;
      runtimeTarget.reviewSettled = true;
    } else if (isRelearningRetest) {
      const cycle = candidateBeforeSettlement.relearning;
      if (!cycle) return session;
      if (settledResult.correct) {
        session.candidate.phase = 'retaining';
        session.candidate.relearning = null;
        this.completedCount += 1;
        this.emitRelearningEffect('retest_passed', candidateBeforeSettlement, session.action, cycle);
      } else {
        const nextCycle: RelearningCycle = {
          ...cycle,
          stage: 'repair_pending',
        };
        session.candidate.phase = 'relearning';
        session.candidate.relearning = nextCycle;
        this.pendingQueue.push(session.candidate);
        this.emitRelearningEffect('retest_failed', candidateBeforeSettlement, session.action, nextCycle);
      }
      const runtimeTarget = this.runtimeTargets.get(session.action.retentionTargetId)!;
      runtimeTarget.status = settledResult.correct ? 'retaining' : 'relearning_repair';
      runtimeTarget.currentCapability = session.action.capability;
      runtimeTarget.relearningCompleted = settledResult.correct;
    }
    return session;
  }

  /**
   * Complete a scheduler-created repair. Showing the Package resource is not
   * an assessment, so this transition produces no Memory Outcome, Evidence or
   * FSRS update. The next queued appearance is the independent retest.
   */
  public completeRepair(): ReviewSession<TContent> | null {
    const session = this.currentSession;
    if (!session || session.settled || session.action.intent !== 'repair') return session;
    const cycle = session.candidate.relearning;
    if (!cycle) return session;
    this.captureSnapshot();
    const nextCycle: RelearningCycle = {
      ...cycle,
      stage: 'retest_pending',
      repairCount: cycle.repairCount + 1,
      lastActionOrdinal: session.action.ordinal,
    };
    session.candidate.phase = 'relearning';
    session.candidate.relearning = nextCycle;
    session.settled = true;
    session.result = null;
    this.actionOrdinal = session.action.ordinal;
    this.lastActionOrdinalByRetentionTarget.set(
      session.action.retentionTargetId,
      this.actionOrdinal,
    );
    this.pendingQueue.push(session.candidate);
    this.emitRelearningEffect('repair_completed', session.candidate, session.action, nextCycle);
    const runtimeTarget = this.runtimeTargets.get(session.action.retentionTargetId)!;
    runtimeTarget.status = 'relearning_retest';
    runtimeTarget.currentCapability = cycle.repairTarget.kind === 'capability'
      ? cycle.repairTarget.capability
      : null;
    return session;
  }

  /**
   * Interrupt the current Encounter because its Retention Target received an
   * active Declared Mastery. This is a planning exclusion, so it emits no
   * learner response, Review Outcome, Relearning effect or scheduling write.
   */
  public excludeCurrentForDeclaredMastery(): ReviewSession<TContent> | null {
    const session = this.currentSession;
    if (!session) return null;
    this.captureSnapshot();
    const interrupted = cloneSession(session);
    const runtimeTarget = this.runtimeTargets.get(session.action.retentionTargetId)!;
    runtimeTarget.status = 'declared_mastery';
    runtimeTarget.currentCapability = null;
    this.currentSession = null;
    return interrupted;
  }

  /** Restore local state only; never call the external Memory Outcome twice. */
  public undo(): ReviewSession<TContent> | null {
    const snapshot = this.historySnapshots.pop();
    if (!snapshot) return null;
    this.pendingQueue = snapshot.pendingQueue.map(cloneCandidate);
    this.completedCount = snapshot.completedCount;
    this.actionOrdinal = snapshot.actionOrdinal;
    this.totalAttempts = snapshot.totalAttempts;
    this.totalCorrect = snapshot.totalCorrect;
    this.lastActionOrdinalByRetentionTarget.clear();
    snapshot.lastActionOrdinalByRetentionTarget.forEach(([retentionTargetId, ordinal]) => {
      this.lastActionOrdinalByRetentionTarget.set(retentionTargetId, ordinal);
    });
    this.currentSession = snapshot.currentSession
      ? cloneSession(snapshot.currentSession)
      : null;
    this.runtimeTargets.clear();
    snapshot.runtimeTargets.forEach(([retentionTargetId, target]) => {
      this.runtimeTargets.set(retentionTargetId, cloneRuntimeTarget(target));
    });
    return this.currentSession;
  }

  public getStats(): ReviewStats {
    return {
      totalTargets: this.totalInitialCount,
      completedTargets: this.completedCount,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy: this.totalAttempts > 0
        ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
        : 100,
      startTime: this.startTime,
    };
  }

  /**
   * 一条到期候选 → 编排插件看得懂的候选。
   *
   * 三种去向互斥：retaining 出到期复习，`repairBasis` 出定向修复，`retest`
   * 出修复后的独立重测。三者都不成立（重学但没有 cycle）时插件出不了步，
   * 与落地前 `nextDefinition` 返回 null 一致。
   */
  private toCandidate(candidate: ReviewCandidate<TContent>): RetentionCandidate {
    const cycle = candidate.phase === 'relearning' ? candidate.relearning : null;
    const repairCapability = cycle?.repairTarget.kind === 'capability'
      ? cycle.repairTarget.capability
      : null;
    return {
      targetKey: retentionTargetIdOf(candidate.package),
      lastStepOrdinal: this.lastActionOrdinalByRetentionTarget.get(
        retentionTargetIdOf(candidate.package),
      ) ?? -1,
      repairBasis: cycle?.stage === 'repair_pending' && repairCapability
        ? {
            capability: repairCapability,
            failedReviewActionKey: cycle.failedReviewActionKey,
            repairCount: cycle.repairCount,
          } satisfies RetentionRepairBasis
        : null,
      inventory: candidate.package,
      retaining: candidate.phase === 'retaining',
      retest: cycle?.stage === 'retest_pending' && repairCapability
        ? { capability: repairCapability, repairCount: cycle.repairCount }
        : null,
      diagnosticFacts: candidate.diagnosticFacts,
    };
  }

  private createRelearningCycle(
    session: ReviewSession<TContent>,
    outcomeKey: string,
  ): RelearningCycle | null {
    const capability = session.action.capability;
    if (capability === null) return null;
    return {
      cycleId: outcomeKey,
      packageId: session.candidate.package.packageId,
      senseId: session.candidate.package.senseId,
      retentionTargetId: retentionTargetIdOf(session.candidate.package),
      repairTarget: { kind: 'capability', capability },
      failedReviewOutcomeKey: outcomeKey,
      failedReviewActionKey: session.action.actionKey,
      stage: 'repair_pending',
      repairCount: 0,
      lastActionOrdinal: session.action.ordinal,
    };
  }

  private emitRetentionEffect(
    outcomeKey: string,
    candidate: ReviewCandidate<TContent>,
    action: ScheduledAction<TContent>,
    result: ReviewAssessmentResult,
    relearningCycle: RelearningCycle | null,
  ): void {
    if (this.emittedOutcomeKeys.has(outcomeKey)) return;
    this.emittedOutcomeKeys.add(outcomeKey);
    this.emittedOutcomeResults.set(outcomeKey, cloneReviewResult(result));
    if (this.dependencies.onEffect) {
      this.dependencies.onEffect({
        type: 'retention_outcome',
        outcomeKey,
        candidate: cloneCandidate(candidate),
        action: cloneAction(action),
        result: cloneReviewResult(result),
        relearningCycle: cloneCycle(relearningCycle) ?? null,
      });
    }
  }

  private emitRelearningEffect(
    event: RelearningEffectEvent,
    candidate: ReviewCandidate<TContent>,
    action: ScheduledAction<TContent>,
    cycle: RelearningCycle,
  ): void {
    this.dependencies.onEffect?.({
      type: 'relearning_progress',
      event,
      candidate: cloneCandidate(candidate),
      action: cloneAction(action),
      cycle: { ...cycle },
    });
  }

  private captureSnapshot(): void {
    this.historySnapshots.push({
      pendingQueue: this.pendingQueue.map(cloneCandidate),
      completedCount: this.completedCount,
      actionOrdinal: this.actionOrdinal,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect,
      lastActionOrdinalByRetentionTarget: [
        ...this.lastActionOrdinalByRetentionTarget.entries(),
      ],
      currentSession: this.currentSession
        ? cloneSession(this.currentSession)
        : null,
      runtimeTargets: [...this.runtimeTargets.entries()].map(([retentionTargetId, target]) => [
        retentionTargetId,
        cloneRuntimeTarget(target),
      ]),
    });
    if (this.historySnapshots.length > 40) this.historySnapshots.shift();
  }
}
