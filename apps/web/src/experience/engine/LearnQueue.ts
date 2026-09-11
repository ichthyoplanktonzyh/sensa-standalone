import { encodeQueueSnapshot, decodeQueueSnapshot } from './queueSnapshot';
import {
  createProtocolProgressState,
  decideAndApplyProtocolTransition,
  type LearningObservation,
  type ProtocolProgressDefinition,
} from '@sensa/learning-kernel';
import { protocolPolicyRegistry } from '../learningRuntime/protocolPolicies';
import {
  acquisitionGateActions,
  acquisitionOrchestration,
  actionIntent,
  isIntroduction,
  requiredGatesOf,
  type AcquisitionCandidate,
  type AcquisitionRepairBasis,
  type StepOrchestration,
} from './stepOrchestration';
import { retentionTargetIdOf } from './types';
import type {
  AcquisitionTargetProjection,
  LearningCapability,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  QueueConfig,
  QueueStats,
  SchedulablePackage,
  Session,
  AcquisitionTargetState,
  StructuredAcquisitionProjection,
} from './types';

interface HistorySnapshot<TContent> {
  states: AcquisitionTargetState[];
  sessions: Session<TContent>[];
  currentSession: Session<TContent> | null;
  totalAttempts: number;
  totalCorrect: number;
}

const STRUCTURED_CHECKPOINT_PREFIX = 'structured-acquisition:';
const structuredProgressionPolicy = protocolPolicyRegistry.getProgression(
  'structured-current-checkpoint-reset-v1',
);
const structuredCompletionPolicy = protocolPolicyRegistry.getCompletion(
  'all-required-current-epoch-v1',
);

const checkpointIdFor = (capability: LearningCapability): string =>
  `${STRUCTURED_CHECKPOINT_PREFIX}${capability}`;

const capabilityForCheckpoint = (checkpointId: string): LearningCapability => {
  const capability = checkpointId.startsWith(STRUCTURED_CHECKPOINT_PREFIX)
    ? checkpointId.slice(STRUCTURED_CHECKPOINT_PREFIX.length)
    : '';
  switch (capability) {
    case 'contextual_recognition':
    case 'meaning_to_form_recall':
    case 'novel_context_transfer':
    case 'boundary_discrimination':
      return capability;
    default:
      throw new Error(`Unknown Structured Acquisition Checkpoint: ${checkpointId}`);
  }
};

const progressDefinitionFor = (
  item: SchedulablePackage<unknown>,
): ProtocolProgressDefinition => ({
  protocolId: 'structured-acquisition',
  protocolVersion: 'v1',
  checkpoints: requiredGatesOf(item).map((capability) => ({
    checkpointId: checkpointIdFor(capability),
    capabilityObjectiveIds: [capability],
    requiredForCompletion: true,
  })),
  completionPolicy: structuredCompletionPolicy,
});

const gateStatusFor = (
  state: AcquisitionTargetState,
  capability: LearningCapability,
) => {
  const status = state.protocolProgress.checkpointCredits[checkpointIdFor(capability)]?.status;
  if (status === 'credited') return 'passed' as const;
  if (status === 'failed') return 'failed' as const;
  return 'unresolved' as const;
};

function emptyCounts(): Record<LearningCapability, number> {
  return {
    contextual_recognition: 0,
    meaning_to_form_recall: 0,
    novel_context_transfer: 0,
    boundary_discrimination: 0,
  };
}

function cloneState(state: AcquisitionTargetState): AcquisitionTargetState {
  return {
    ...state,
    repairCounts: { ...state.repairCounts },
    failureCounts: { ...state.failureCounts },
    lastAssessmentActionKey: { ...state.lastAssessmentActionKey },
  };
}

/**
 * Deterministic, Sense-first acquisition scheduler. A Package supplies the
 * immutable content and assessment inventory; this Module owns only the
 * learner-local acquisition projection and the next ScheduledAction.
 *
 * A repair action deliberately has a distinct identity and mode. It can be
 * rendered through the frozen capability cards, but it can never satisfy the
 * Gate that it is repairing. The Catalog normally supplies package-declared
 * repair bindings; the explicit fallback reference only protects alternate
 * or older adapters that have not exposed those bindings.
 */
export class LearnQueue<TContent = unknown> {
  private readonly packages: readonly SchedulablePackage<TContent>[];
  private readonly states: Map<string, AcquisitionTargetState>;
  private readonly minGap: number;
  private readonly progressTarget: number;
  private readonly orchestration: StepOrchestration<AcquisitionCandidate, AcquisitionRepairBasis>;
  private currentSession: Session<TContent> | null = null;
  private sessionHistory: Session<TContent>[] = [];
  private historySnapshots: HistorySnapshot<TContent>[] = [];
  private readonly startTime: number;
  private totalAttempts = 0;
  private totalCorrect = 0;

  public exportCheckpoint(): string {
    return encodeQueueSnapshot({
      packages: this.packages,
      states: this.states,
      minGap: this.minGap,
      progressTarget: this.progressTarget,
      currentSession: this.currentSession,
      sessionHistory: this.sessionHistory,
      historySnapshots: this.historySnapshots,
      startTime: this.startTime,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect
    });
  }

  public static restoreCheckpoint<TContent>(raw: string,

    orchestration = acquisitionOrchestration,
  ): LearnQueue<TContent> {
    const saved = decodeQueueSnapshot<Record<string, unknown>>(raw);
    const queue = new LearnQueue<TContent>([], {}, orchestration);
    const fields = ['packages', 'states', 'minGap', 'progressTarget', 'currentSession', 'sessionHistory', 'historySnapshots', 'startTime', 'totalAttempts', 'totalCorrect'];
    for (const field of fields) {
      if (!(field in saved)) throw Error('Incomplete queue checkpoint');
      Object.assign(queue, {[field]: saved[field]});
    }
    return queue;
  }

  constructor(
    packages: readonly SchedulablePackage<TContent>[],
    config?: QueueConfig,
    orchestration: StepOrchestration<AcquisitionCandidate, AcquisitionRepairBasis>
      = acquisitionOrchestration,
  ) {
    this.assertPackageInventory(packages);
    this.packages = packages;
    this.minGap = Math.max(0, config?.minGap ?? 2);
    this.progressTarget = config?.progressTarget
      ?? packages.reduce((total, item) => total + 1 + item.requiredCapabilities.length, 0);
    this.orchestration = orchestration;
    this.states = new Map(packages.map((item) => [retentionTargetIdOf(item), {
      packageId: item.packageId,
      senseId: item.senseId,
      retentionTargetId: retentionTargetIdOf(item),
      phase: 'new',
      introduced: false,
      declaredMastery: false,
      protocolProgress: createProtocolProgressState(
        `prototype:${retentionTargetIdOf(item)}:structured-acquisition:v1`,
        progressDefinitionFor(item),
      ),
      repairCounts: emptyCounts(),
      failureCounts: emptyCounts(),
      lastAssessmentActionKey: {},
      lastActionOrdinal: -1,
      totalAttempts: 0,
      totalCorrect: 0,
      transferScenarioIndex: 0,
      skipped: false,
    }]));
    this.startTime = Date.now();
    this.next();
  }

  public getCurrentSession(): Session<TContent> | null {
    return this.currentSession;
  }

  public getState(retentionTargetId: string): AcquisitionTargetState | null {
    const state = this.states.get(retentionTargetId);
    return state ? cloneState(state) : null;
  }

  public getProjection(): StructuredAcquisitionProjection {
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
      targets: this.packages.map((item): AcquisitionTargetProjection => {
        const state = this.states.get(retentionTargetIdOf(item))!;
        return {
          packageId: item.packageId,
          senseId: item.senseId,
          retentionTargetId: retentionTargetIdOf(item),
          phase: state.phase,
          introduced: state.introduced,
          declaredMastery: state.declaredMastery,
          graduated: this.isPackageComplete(state),
          gates: this.requiredGates(item).map((capability) => ({
            capability,
            status: gateStatusFor(state, capability),
            repairing: state.protocolProgress.pendingRepairs[checkpointIdFor(capability)] !== undefined,
          })),
        };
      }),
    };
  }

  public getGraduatedRetentionTargetIds(): string[] {
    return this.packages
      .filter((item) => {
        const state = this.states.get(retentionTargetIdOf(item));
        return state !== undefined && this.isPackageComplete(state);
      })
      .map(retentionTargetIdOf);
  }

  public isDone(): boolean {
    return this.packages.every((item) => {
      const state = this.states.get(retentionTargetIdOf(item));
      return state === undefined
        || state.skipped
        || this.isPackageComplete(state);
    });
  }

  /**
   * 推进一步。选谁、出哪一步都由编排插件回答（见 stepOrchestration.ts）：
   * 这里只负责把学习者本地状态投影成候选，并把拿回来的 Step 定义装配成一次
   * 会话。修复依据也在这里算——"哪个 Gate 失败了、失败在哪一步"是本地状态，
   * 不该由插件推断。
   */
  public next(): Session<TContent> | null {
    if (this.currentSession && !this.currentSession.settled) {
      return this.currentSession;
    }
    if (this.isDone()) {
      this.currentSession = null;
      return null;
    }

    const ordinal = this.sessionHistory.length + 1;
    const pending = this.packages.filter((item) => {
      const state = this.states.get(retentionTargetIdOf(item));
      return state !== undefined
        && !state.skipped
        && !this.isPackageComplete(state);
    });
    const selection = this.orchestration.fresh(
      pending.map((item) => this.toCandidate(item)),
      { ordinal, minGap: this.minGap },
    );
    if (!selection) {
      this.currentSession = null;
      return null;
    }
    const chosenPackage = pending.find((item) =>
      retentionTargetIdOf(item) === selection.target.targetKey)!;
    const state = this.states.get(retentionTargetIdOf(chosenPackage))!;
    const definition = selection.definition;
    const intent = actionIntent(definition);
    const action: Session<TContent>['action'] = {
      ...definition,
      intent,
      ordinal,
      totalTarget: this.progressTarget,
      packageId: chosenPackage.packageId,
      senseId: chosenPackage.senseId,
      retentionTargetId: retentionTargetIdOf(chosenPackage),
      content: chosenPackage.content,
      reason: intent === 'repair'
        ? 'repair'
        : definition.kind === 'introduction'
        ? 'new'
        : 'acquisition_ready',
    };
    this.currentSession = {
      index: ordinal,
      totalTarget: this.progressTarget,
      action,
      package: chosenPackage,
      settled: false,
      result: null,
      transferScenarioIndex: state.transferScenarioIndex,
    };
    return this.currentSession;
  }

  public completeIntroduction(): Session<TContent> | null {
    const session = this.requireIntroduction();
    if (!session) return this.currentSession;
    this.captureSnapshot();
    const state = this.states.get(session.action.retentionTargetId)!;
    state.introduced = true;
    state.phase = 'acquiring';
    state.lastActionOrdinal = session.index;
    session.settled = true;
    session.result = null;
    this.pushCompletedSession(session);
    return session;
  }

  public completeRecognition(ok: boolean): Session<TContent> | null {
    return this.completeGate('contextual_recognition', ok);
  }

  public completeMeaningToFormRecall(outcome: MeaningToFormRecallOutcome): Session<TContent> | null {
    return this.completeGate(
      'meaning_to_form_recall',
      outcome === 'independent',
      (session) => { session.recallOutcome = outcome; },
    );
  }

  public completeNovelTransfer(outcome: NovelTransferOutcome): Session<TContent> | null {
    return this.completeGate(
      'novel_context_transfer',
      outcome === 'success',
      (session, state) => {
        session.transferOutcome = outcome;
        if (outcome === 'repair' && session.action.intent !== 'repair') {
          state.transferScenarioIndex += 1;
        }
      },
    );
  }

  public completeBoundary(correct: boolean): Session<TContent> | null {
    return this.completeGate('boundary_discrimination', correct);
  }

  /** Boolean-result convenience used by generic controls; state remains gate-scoped. */
  public settle(ok: boolean, recallOutcome?: Parameters<LearnQueue<TContent>['completeMeaningToFormRecall']>[0]): Session<TContent> | null {
    const action = this.currentSession?.action;
    if (action && isIntroduction(action)) {
      return ok ? this.completeIntroduction() : this.currentSession;
    }
    const capability = action?.capability;
    if (capability === 'contextual_recognition') return this.completeRecognition(ok);
    if (capability === 'meaning_to_form_recall') return recallOutcome === undefined
      ? this.completeGate(capability, ok)
      : this.completeMeaningToFormRecall(recallOutcome);
    if (capability === 'novel_context_transfer') return this.completeNovelTransfer(ok ? 'success' : 'repair');
    if (capability === 'boundary_discrimination') return this.completeBoundary(ok);
    return this.currentSession;
  }

  /**
   * Explicit learner correction. It reopens only the current Gate and
   * schedules a real repair; it never clears unrelated Gate history.
   */
  public markMistake(): void {
    const session = this.currentSession;
    const capability = session?.action.capability ?? null;
    if (!session || capability === null || session.action.intent === 'repair') {
      return;
    }
    const state = this.states.get(session.action.retentionTargetId);
    if (!state) return;
    this.captureSnapshot();
    const wasSettled = session.settled;
    if (!wasSettled) {
      session.settled = true;
      this.totalAttempts += 1;
      state.totalAttempts += 1;
    }
    this.applyObservation(
      session.package,
      state,
      session,
      'checkpoint_not_satisfied',
      capability,
      'learner-correction',
    );
    state.lastAssessmentActionKey[capability] = session.action.actionKey;
    state.failureCounts[capability] += 1;
    state.skipped = false;
    state.phase = 'acquiring';
    state.lastActionOrdinal = session.index;
    session.result = false;
    if (!wasSettled) this.pushCompletedSession(session);
  }

  /**
   * Declared Mastery is an orthogonal, reversible planning exclusion. It
   * must not mutate phase, Gate status, Evidence history or FSRS eligibility.
   */
  public skipCurrent(): void {
    const retentionTargetId = this.currentSession?.action.retentionTargetId;
    if (retentionTargetId) this.setDeclaredMastery(retentionTargetId, true);
  }

  public setDeclaredMastery(retentionTargetId: string, isMastered: boolean): boolean {
    const packageItem = this.packages.find((item) =>
      retentionTargetIdOf(item) === retentionTargetId);
    if (!packageItem) return false;
    const state = this.states.get(retentionTargetIdOf(packageItem))!;
    if (state.declaredMastery === isMastered) return true;
    this.captureSnapshot();
    state.declaredMastery = isMastered;
    state.skipped = isMastered;
    // Intentionally preserve state.phase. In particular, a new or acquiring
    // Sense is not made retaining and never appears in graduation output.
    const session = this.currentSession;
    if (
      isMastered
      && session?.action.retentionTargetId === retentionTargetIdOf(packageItem)
      && !session.settled
    ) {
      session.settled = true;
      session.result = null;
      this.pushCompletedSession(session);
    }
    return true;
  }

  /** Restore the last local transition; no external settlement is performed. */
  public undo(): Session<TContent> | null {
    const snapshot = this.historySnapshots.pop();
    if (!snapshot) return null;
    this.states.clear();
    snapshot.states.forEach((state) => this.states.set(state.retentionTargetId, cloneState(state)));
    this.sessionHistory = snapshot.sessions.map((session) => this.copySession(session));
    this.currentSession = snapshot.currentSession
      ? this.copySession(snapshot.currentSession)
      : null;
    this.totalAttempts = snapshot.totalAttempts;
    this.totalCorrect = snapshot.totalCorrect;
    return this.currentSession;
  }

  public getStats(): QueueStats {
    const masteredTargetCount = this.packages.filter((item) => {
      const state = this.states.get(retentionTargetIdOf(item));
      return state?.skipped || (state !== undefined && this.isPackageComplete(state));
    }).length;
    return {
      sessionsCompleted: this.sessionHistory.length,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy: this.totalAttempts > 0
        ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
        : 100,
      masteredTargetCount,
      totalTargets: this.packages.length,
      startTime: this.startTime,
    };
  }

  private completeGate(
    capability: LearningCapability,
    ok: boolean,
    decorate?: (session: Session<TContent>, state: AcquisitionTargetState) => void,
  ): Session<TContent> | null {
    const session = this.requireCapability(capability);
    if (!session) return this.currentSession;
    const state = this.states.get(session.action.retentionTargetId)!;
    this.captureSnapshot();
    if (session.action.intent === 'repair') {
      this.completeRepair(session, state, capability);
      return session;
    }
    decorate?.(session, state);
    session.settled = true;
    session.result = ok;
    this.totalAttempts += 1;
    state.totalAttempts += 1;
    state.lastAssessmentActionKey[capability] = session.action.actionKey;
    if (ok) {
      this.applyObservation(
        session.package,
        state,
        session,
        'checkpoint_satisfied',
        capability,
        'assessment',
      );
      state.totalCorrect += 1;
      this.totalCorrect += 1;
    } else {
      this.applyObservation(
        session.package,
        state,
        session,
        'checkpoint_not_satisfied',
        capability,
        'assessment',
      );
      state.failureCounts[capability] += 1;
    }
    state.lastActionOrdinal = session.index;
    state.phase = this.isPackageComplete(state) ? 'retaining' : 'acquiring';
    this.pushCompletedSession(session);
    return session;
  }

  private completeRepair(
    session: Session<TContent>,
    state: AcquisitionTargetState,
    capability: LearningCapability,
  ): void {
    // A repair confirms that support was shown, not that the Checkpoint was
    // satisfied. The kernel records the independent reassessment requirement.
    this.applyObservation(
      session.package,
      state,
      session,
      'repair_completed',
      capability,
      'repair',
    );
    state.repairCounts[capability] += 1;
    state.lastActionOrdinal = session.index;
    state.phase = 'acquiring';
    session.settled = true;
    session.result = null;
    this.pushCompletedSession(session);
  }

  private requireCapability(capability: LearningCapability): Session<TContent> | null {
    const session = this.currentSession;
    if (!session || session.settled || session.action.capability !== capability) return null;
    return session;
  }

  private requireIntroduction(): Session<TContent> | null {
    const session = this.currentSession;
    if (!session || session.settled || !isIntroduction(session.action)) return null;
    return session;
  }

  /** 学习者本地状态 → 编排插件看得懂的一条候选。 */
  private toCandidate(item: SchedulablePackage<TContent>): AcquisitionCandidate {
    const state = this.states.get(retentionTargetIdOf(item))!;
    return {
      targetKey: retentionTargetIdOf(item),
      lastStepOrdinal: state.lastActionOrdinal,
      repairBasis: this.repairBasisFor(state),
      inventory: item,
      introduced: state.introduced,
      gateStatus: {
        contextual_recognition: gateStatusFor(state, 'contextual_recognition'),
        meaning_to_form_recall: gateStatusFor(state, 'meaning_to_form_recall'),
        novel_context_transfer: gateStatusFor(state, 'novel_context_transfer'),
        boundary_discrimination: gateStatusFor(state, 'boundary_discrimination'),
      },
      lastAssessmentActionKey: state.lastAssessmentActionKey,
      transferScenarioIndex: state.transferScenarioIndex,
    };
  }

  /** 这条 Target 有没有一份完整、可挂回真实失败的修复依据。 */
  private repairBasisFor(
    state: AcquisitionTargetState,
  ): AcquisitionRepairBasis | null {
    const pendingRepair = Object.values(state.protocolProgress.pendingRepairs)[0];
    if (!pendingRepair) return null;
    const capability = capabilityForCheckpoint(pendingRepair.checkpointId);
    return {
      capability,
      failedActionKey: pendingRepair.failedActionId,
      repairCount: state.repairCounts[capability],
    };
  }

  private requiredGates(item: SchedulablePackage<TContent>): LearningCapability[] {
    return requiredGatesOf(item);
  }

  private isPackageComplete(state: AcquisitionTargetState): boolean {
    return state.introduced && state.protocolProgress.completed;
  }

  private applyObservation(
    item: SchedulablePackage<TContent>,
    state: AcquisitionTargetState,
    session: Session<TContent>,
    kind: LearningObservation['kind'],
    capability: LearningCapability,
    identitySuffix: string,
  ): void {
    const identityBase = [
      state.protocolProgress.protocolRunId,
      session.index,
      session.action.actionKey,
      identitySuffix,
    ].join(':');
    const result = decideAndApplyProtocolTransition({
      definition: progressDefinitionFor(item),
      policy: structuredProgressionPolicy,
      state: state.protocolProgress,
      observation: {
        observationId: `${identityBase}:observation`,
        attemptId: `${identityBase}:attempt`,
        actionId: session.action.actionKey,
        kind,
        checkpointId: checkpointIdFor(capability),
        evidenceIds: kind === 'checkpoint_satisfied'
          ? [`${identityBase}:evidence`]
          : [],
      },
      decisionId: `${identityBase}:decision`,
    });
    state.protocolProgress = result.state;
  }

  private assertPackageInventory(
    packages: readonly SchedulablePackage<TContent>[],
  ): void {
    const retentionTargetIds = new Set<string>();
    packages.forEach((item) => {
      const retentionTargetId = retentionTargetIdOf(item);
      if (retentionTargetId.trim().length === 0) {
        throw new Error(`Package ${item.packageId} has an empty Retention Target identity.`);
      }
      if (retentionTargetIds.has(retentionTargetId)) {
        throw new Error(`Duplicate Retention Target identity: ${retentionTargetId}`);
      }
      retentionTargetIds.add(retentionTargetId);
      if (!item.actions.some(isIntroduction)) {
        throw new Error(`Package ${item.packageId} has no executable Introduction action.`);
      }
      item.requiredCapabilities.forEach((capability) => {
        if (acquisitionGateActions(item, capability).length === 0) {
          throw new Error(`Package ${item.packageId} has no executable action for ${capability}.`);
        }
      });
    });
  }

  private copySession(session: Session<TContent>): Session<TContent> {
    return {
      ...session,
      action: {
        ...session.action,
        repairResourceRef: session.action.repairResourceRef
          ? { ...session.action.repairResourceRef }
          : undefined,
      },
      package: session.package,
    };
  }

  private pushCompletedSession(session: Session<TContent>): void {
    this.sessionHistory.push(this.copySession(session));
  }

  private captureSnapshot(): void {
    this.historySnapshots.push({
      states: [...this.states.values()].map(cloneState),
      sessions: this.sessionHistory.map((session) => this.copySession(session)),
      currentSession: this.currentSession ? this.copySession(this.currentSession) : null,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect,
    });
    if (this.historySnapshots.length > 40) this.historySnapshots.shift();
  }
}
