import type {
  LearningCapability,
  QueueConfig,
  RelearningCycle,
  ReviewCandidate,
  SchedulablePackage,
  ScheduledAction,
  ScheduledActionDefinition,
} from './types';
import { reviewOutcomeKey } from './types';
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
  /** Repair uses the existing IntroductionCard and never enters assessment feedback. */
  stage: 'review_assessment' | 'review_feedback' | 'review_repair';
  settled: boolean;
  result: ReviewAssessmentResult | null;
}

export interface ReviewStats {
  /** Compatibility aliases used by the frozen progress surface. */
  totalWords: number;
  totalSenses: number;
  completedWords: number;
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
  status: RetentionRuntimeTargetStatus;
  currentCapability: LearningCapability | null;
  memoryOutcome: ReviewAssessmentResult['memoryOutcome'] | null;
  reviewSettled: boolean;
  relearningCompleted: boolean;
}

export interface RetentionRuntimeProjection {
  currentAction: Readonly<Pick<
    ScheduledAction,
    'packageId' | 'senseId' | 'capability' | 'intent' | 'reason'
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
  lastActionOrdinalBySense: [string, number][];
  currentSession: ReviewSession<TContent> | null;
  runtimeTargets: [string, RetentionRuntimeTargetProjection][];
}

function kindForCapability(capability: LearningCapability | null): ReviewAssessmentKind | null {
  switch (capability) {
    case 'contextual_recognition': return 'context_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_discrimination': return 'boundary_contrast';
    default: return null;
  }
}

function cloneCycle(cycle: RelearningCycle | null | undefined): RelearningCycle | null | undefined {
  return cycle ? { ...cycle } : cycle;
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
    result: session.result ? { ...session.result } : null,
  };
}

function cloneRuntimeTarget(
  target: RetentionRuntimeTargetProjection,
): RetentionRuntimeTargetProjection {
  return { ...target };
}

function isRetentionAssessment(action: ScheduledActionDefinition): boolean {
  const assessmentKind = kindForCapability(action.capability);
  return action.kind === 'retention_review'
    && action.intent !== 'repair'
    && assessmentKind !== null
    && canProduceReviewMemoryOutcome(assessmentKind);
}

function isRelearningAssessment(action: ScheduledActionDefinition): boolean {
  return action.kind === 'relearning_gate'
    && action.intent !== 'repair'
    && kindForCapability(action.capability) !== null;
}

function isPackageRepair(action: ScheduledActionDefinition, capability: LearningCapability): boolean {
  return action.kind === 'acquisition_gate'
    && action.intent === 'repair'
    && action.capability === capability
    && action.repairResourceRef?.source === 'package_declared'
    && Boolean(action.repairResourceRef.key);
}

function inferLegacyCycle<TContent>(candidate: ReviewCandidate<TContent>): RelearningCycle | null {
  const definition = candidate.package.reviewActions.find(isRelearningAssessment);
  if (!definition || definition.capability === null) return null;
  return {
    cycleId: `legacy-relearning:${candidate.package.packageId}:${candidate.dueAt}`,
    packageId: candidate.package.packageId,
    senseId: candidate.package.senseId,
    targetCapability: definition.capability,
    failedReviewOutcomeKey: `legacy-relearning:${candidate.package.packageId}:${candidate.dueAt}`,
    failedReviewActionKey: definition.actionKey,
    stage: 'repair_pending',
    repairCount: 0,
    lastActionOrdinal: -1,
  };
}

function normalizeCandidate<TContent>(candidate: ReviewCandidate<TContent>): ReviewCandidate<TContent> {
  const normalized = cloneCandidate(candidate);
  if (normalized.phase === 'relearning' && !normalized.relearning) {
    normalized.relearning = inferLegacyCycle(normalized);
  }
  return normalized;
}

function hasExecutableReviewAction<TContent>(candidate: ReviewCandidate<TContent>): boolean {
  if (candidate.phase === 'retaining') {
    return candidate.package.reviewActions.some(isRetentionAssessment);
  }
  const cycle = candidate.relearning ?? inferLegacyCycle(candidate);
  if (!cycle) return false;
  if (cycle.stage === 'repair_pending') {
    return candidate.package.repairActions?.some((action) =>
      isPackageRepair(action, cycle.targetCapability)) ?? false;
  }
  return candidate.package.reviewActions.some((action) =>
    isRelearningAssessment(action) && action.capability === cycle.targetCapability);
}

function chooseReviewAction<TContent>(
  actions: readonly ScheduledActionDefinition[],
  candidate: ReviewCandidate<TContent>,
  position: number,
): ScheduledActionDefinition | undefined {
  const preferredCapabilities = candidate.diagnosticFacts?.preferredCapabilities ?? [];
  for (const capability of preferredCapabilities) {
    const preferred = actions.find((action) => action.capability === capability);
    if (preferred) return preferred;
  }

  // FSRS reps/lapses are deliberately absent from this decision. They answer
  // when a Sense is due; diagnostic facts or deterministic inventory rotation
  // answer what the due Review should assess.
  const lastCapability = candidate.diagnosticFacts?.lastCapability;
  const alternatives = lastCapability
    ? actions.filter((action) => action.capability !== lastCapability)
    : actions;
  const pool = alternatives.length > 0 ? alternatives : actions;
  return pool.length > 0 ? pool[position % pool.length] : undefined;
}

/**
 * Review scheduler over due retaining Senses and persisted Relearning cycles.
 * Retention produces one Memory Outcome; Relearning is a separate repair →
 * independent retest state machine and never calls the memory settlement seam.
 */
export class ReviewQueue<TContent = unknown> {
  private pendingQueue: ReviewCandidate<TContent>[];
  private currentSession: ReviewSession<TContent> | null = null;
  private readonly totalInitialCount: number;
  private readonly minGap: number;
  private readonly progressTarget: number;
  private completedCount = 0;
  private actionOrdinal = 0;
  private totalAttempts = 0;
  private totalCorrect = 0;
  private readonly lastActionOrdinalBySense = new Map<string, number>();
  private readonly startTime: number;
  private readonly dependencies: ReviewQueueDependencies<TContent>;
  private readonly runtimeTargets: Map<string, RetentionRuntimeTargetProjection>;
  /** Persists across local undo so replay cannot repeat external settlement. */
  private readonly emittedOutcomeKeys = new Set<string>();
  /** Keep a replayed session aligned with the first durable learner response. */
  private readonly emittedOutcomeResults = new Map<string, ReviewAssessmentResult>();
  private historySnapshots: ReviewSnapshot<TContent>[] = [];

  constructor(
    dueCandidates: readonly ReviewCandidate<TContent>[],
    dependencies: ReviewQueueDependencies<TContent> = {},
    config: QueueConfig = {},
  ) {
    const seenSenseIds = new Set<string>();
    this.pendingQueue = dueCandidates
      .filter((candidate) => {
        const senseId = candidate.package.senseId;
        if (seenSenseIds.has(senseId) || !hasExecutableReviewAction(candidate)) return false;
        seenSenseIds.add(senseId);
        return true;
      })
      .map(normalizeCandidate);
    this.runtimeTargets = new Map(this.pendingQueue.map((candidate) => {
      const cycle = candidate.relearning;
      const status: RetentionRuntimeTargetStatus = candidate.phase === 'retaining'
        ? 'review_pending'
        : cycle?.stage === 'retest_pending'
          ? 'relearning_retest'
          : 'relearning_repair';
      return [candidate.package.senseId, {
        packageId: candidate.package.packageId,
        senseId: candidate.package.senseId,
        status,
        currentCapability: cycle?.targetCapability ?? null,
        memoryOutcome: null,
        reviewSettled: candidate.phase === 'relearning',
        relearningCompleted: false,
      }];
    }));
    this.totalInitialCount = this.pendingQueue.length;
    this.minGap = Math.max(0, Math.floor(config.minGap ?? 2));
    this.progressTarget = Math.max(1, config.progressTarget ?? this.totalInitialCount);
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
    const eligible = this.pendingQueue.filter((candidate) =>
      this.isEligible(candidate.package.senseId, ordinal));
    // If no different Sense can satisfy minGap, this is an explicit safe
    // fallback. The scheduler does not claim that the configured gap was met.
    const candidates = eligible.length > 0 ? eligible : this.pendingQueue;
    const chosenCandidate = this.chooseOldest(candidates);
    if (!chosenCandidate) {
      this.currentSession = null;
      return null;
    }
    const chosenIndex = this.pendingQueue.findIndex((candidate) =>
      candidate.package.packageId === chosenCandidate.package.packageId);
    const candidate = this.pendingQueue.splice(chosenIndex, 1)[0]!;
    const cycle = candidate.phase === 'relearning'
      ? candidate.relearning ?? inferLegacyCycle(candidate)
      : null;
    if (candidate.phase === 'relearning' && cycle) candidate.relearning = cycle;
    const definition = this.nextDefinition(candidate, cycle, ordinal);
    if (!definition) {
      this.pendingQueue.unshift(candidate);
      this.currentSession = null;
      return null;
    }
    const intent = definition.intent ?? 'assessment';
    const assessmentKind = kindForCapability(definition.capability);
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
      stage: intent === 'repair' ? 'review_repair' : 'review_assessment',
      settled: false,
      result: null,
    };
    const runtimeTarget = this.runtimeTargets.get(candidate.package.senseId)!;
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
    const failedCycle = isRetention && !effectiveResult.correct && outcomeKey
      ? this.createRelearningCycle(session, outcomeKey)
      : null;
    const settledResult: ReviewAssessmentResult = {
      ...effectiveResult,
      focusDimension: resolveReviewFocusDimension(session.assessmentKind),
      memoryOutcome: resolveReviewMemoryOutcome(session.assessmentKind, effectiveResult.correct),
      // Only a due retaining assessment can produce a Memory Outcome. A
      // relearning gate is an independent capability retest, not a second
      // memory scheduler input.
      evidenceEligible: isRetention,
    };
    this.captureSnapshot();
    session.settled = true;
    session.result = settledResult;
    session.stage = 'review_feedback';
    this.actionOrdinal = session.action.ordinal;
    this.lastActionOrdinalBySense.set(session.action.senseId, this.actionOrdinal);
    this.totalAttempts += 1;
    if (settledResult.correct) this.totalCorrect += 1;

    if (isRetention) {
      if (settledResult.correct) {
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
      const runtimeTarget = this.runtimeTargets.get(session.action.senseId)!;
      runtimeTarget.status = settledResult.correct ? 'retaining' : 'relearning_repair';
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
      const runtimeTarget = this.runtimeTargets.get(session.action.senseId)!;
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
    this.lastActionOrdinalBySense.set(session.action.senseId, this.actionOrdinal);
    this.pendingQueue.push(session.candidate);
    this.emitRelearningEffect('repair_completed', session.candidate, session.action, nextCycle);
    const runtimeTarget = this.runtimeTargets.get(session.action.senseId)!;
    runtimeTarget.status = 'relearning_retest';
    runtimeTarget.currentCapability = cycle.targetCapability;
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
    const runtimeTarget = this.runtimeTargets.get(session.action.senseId)!;
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
    this.lastActionOrdinalBySense.clear();
    snapshot.lastActionOrdinalBySense.forEach(([senseId, ordinal]) => {
      this.lastActionOrdinalBySense.set(senseId, ordinal);
    });
    this.currentSession = snapshot.currentSession
      ? cloneSession(snapshot.currentSession)
      : null;
    this.runtimeTargets.clear();
    snapshot.runtimeTargets.forEach(([senseId, target]) => {
      this.runtimeTargets.set(senseId, cloneRuntimeTarget(target));
    });
    return this.currentSession;
  }

  public getStats(): ReviewStats {
    return {
      totalWords: this.totalInitialCount,
      totalSenses: this.totalInitialCount,
      completedWords: this.completedCount,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy: this.totalAttempts > 0
        ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
        : 100,
      startTime: this.startTime,
    };
  }

  private nextDefinition(
    candidate: ReviewCandidate<TContent>,
    cycle: RelearningCycle | null,
    ordinal: number,
  ): ScheduledActionDefinition | null {
    if (candidate.phase === 'retaining') {
      const actions = candidate.package.reviewActions.filter(isRetentionAssessment);
      return chooseReviewAction(actions, candidate, ordinal) ?? null;
    }
    if (!cycle) return null;
    if (cycle.stage === 'repair_pending') {
      return this.repairDefinition(candidate.package, cycle);
    }
    const actions = candidate.package.reviewActions.filter((action) =>
      isRelearningAssessment(action) && action.capability === cycle.targetCapability);
    return actions.length > 0
      ? actions[cycle.repairCount % actions.length]
      : null;
  }

  private repairDefinition(
    item: SchedulablePackage<TContent>,
    cycle: RelearningCycle,
  ): ScheduledActionDefinition | null {
    // Relearning must consume an approved Package binding. There is no
    // scheduler-generated content fallback in this queue.
    const declaredRepair = item.repairActions?.find((action) =>
      isPackageRepair(action, cycle.targetCapability));
    if (!declaredRepair) return null;
    return {
      ...declaredRepair,
      actionKey: `${declaredRepair.actionKey}.relearning.${cycle.repairCount + 1}`,
      taskKey: null,
      kind: 'acquisition_gate',
      intent: 'repair',
      repairForActionKey: cycle.failedReviewActionKey,
      repairResourceRef: { ...declaredRepair.repairResourceRef! },
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
      targetCapability: capability,
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
    this.emittedOutcomeResults.set(outcomeKey, { ...result });
    if (this.dependencies.onEffect) {
      this.dependencies.onEffect({
        type: 'retention_outcome',
        outcomeKey,
        candidate: cloneCandidate(candidate),
        action: cloneAction(action),
        result: { ...result },
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

  private isEligible(senseId: string, ordinal: number): boolean {
    const previous = this.lastActionOrdinalBySense.get(senseId) ?? -1;
    return ordinal - previous - 1 >= this.minGap;
  }

  private chooseOldest(
    candidates: readonly ReviewCandidate<TContent>[],
  ): ReviewCandidate<TContent> | null {
    return [...candidates].sort((left, right) => {
      const leftOrdinal = this.lastActionOrdinalBySense.get(left.package.senseId) ?? -1;
      const rightOrdinal = this.lastActionOrdinalBySense.get(right.package.senseId) ?? -1;
      return leftOrdinal - rightOrdinal
        || left.package.packageId.localeCompare(right.package.packageId);
    })[0] ?? null;
  }

  private captureSnapshot(): void {
    this.historySnapshots.push({
      pendingQueue: this.pendingQueue.map(cloneCandidate),
      completedCount: this.completedCount,
      actionOrdinal: this.actionOrdinal,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect,
      lastActionOrdinalBySense: [...this.lastActionOrdinalBySense.entries()],
      currentSession: this.currentSession
        ? cloneSession(this.currentSession)
        : null,
      runtimeTargets: [...this.runtimeTargets.entries()].map(([senseId, target]) => [
        senseId,
        cloneRuntimeTarget(target),
      ]),
    });
    if (this.historySnapshots.length > 40) this.historySnapshots.shift();
  }
}
