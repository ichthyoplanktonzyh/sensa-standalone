import {
  acquisitionGateActions,
  acquisitionOrchestration,
  actionIntent,
  isIntroduction,
  requiredGatesOf,
  type AcquisitionCandidate,
  type AcquisitionRepairBasis,
} from './stepOrchestration';
import type {
  AcquisitionTargetProjection,
  AcquisitionGateStatus,
  LearningCapability,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  QueueConfig,
  QueueStats,
  SchedulablePackage,
  Session,
  SenseAcquisitionState,
  StructuredAcquisitionProjection,
} from './types';

interface HistorySnapshot<TContent> {
  states: SenseAcquisitionState[];
  sessions: Session<TContent>[];
  currentSession: Session<TContent> | null;
  totalAttempts: number;
  totalCorrect: number;
}

function emptyGateStatus(): Record<LearningCapability, AcquisitionGateStatus> {
  return {
    contextual_recognition: 'unresolved',
    meaning_to_form_recall: 'unresolved',
    novel_context_transfer: 'unresolved',
    boundary_discrimination: 'unresolved',
  };
}

function emptyCounts(): Record<LearningCapability, number> {
  return {
    contextual_recognition: 0,
    meaning_to_form_recall: 0,
    novel_context_transfer: 0,
    boundary_discrimination: 0,
  };
}

function cloneState(state: SenseAcquisitionState): SenseAcquisitionState {
  return {
    ...state,
    gateStatus: { ...state.gateStatus },
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
  private readonly states: Map<string, SenseAcquisitionState>;
  private readonly activeWindow: number;
  private readonly minGap: number;
  private readonly progressTarget: number;
  private currentSession: Session<TContent> | null = null;
  private sessionHistory: Session<TContent>[] = [];
  private historySnapshots: HistorySnapshot<TContent>[] = [];
  private readonly startTime: number;
  private totalAttempts = 0;
  private totalCorrect = 0;

  constructor(
    packages: readonly SchedulablePackage<TContent>[],
    config?: QueueConfig,
  ) {
    this.assertPackageInventory(packages);
    this.packages = packages;
    this.activeWindow = Math.max(
      1,
      Math.min(config?.activeWindow ?? 3, Math.max(1, packages.length)),
    );
    this.minGap = Math.max(0, config?.minGap ?? 2);
    this.progressTarget = config?.progressTarget
      ?? packages.reduce((total, item) => total + 1 + item.requiredCapabilities.length, 0);
    this.states = new Map(packages.map((item) => [item.packageId, {
      packageId: item.packageId,
      senseId: item.senseId,
      phase: 'new',
      introduced: false,
      declaredMastery: false,
      gateStatus: emptyGateStatus(),
      pendingRepairCapability: null,
      pendingRepairForActionKey: null,
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

  public getState(packageOrSenseId: string): SenseAcquisitionState | null {
    const packageItem = this.packages.find((item) =>
      item.packageId === packageOrSenseId || item.senseId === packageOrSenseId);
    const state = packageItem
      ? this.states.get(packageItem.packageId)
      : this.states.get(packageOrSenseId);
    return state ? cloneState(state) : null;
  }

  public getProjection(): StructuredAcquisitionProjection {
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
      targets: this.packages.map((item): AcquisitionTargetProjection => {
        const state = this.states.get(item.packageId)!;
        return {
          packageId: item.packageId,
          senseId: item.senseId,
          phase: state.phase,
          introduced: state.introduced,
          declaredMastery: state.declaredMastery,
          graduated: this.isPackageComplete(item, state),
          gates: this.requiredGates(item).map((capability) => ({
            capability,
            status: state.gateStatus[capability],
            repairing: state.pendingRepairCapability === capability,
          })),
        };
      }),
    };
  }

  /** Initial Acquisition Graduation is distinct from a declared-mastery skip. */
  public getGraduatedSenseIds(): string[] {
    return this.packages
      .filter((item) => {
        const state = this.states.get(item.packageId);
        return state !== undefined && this.isPackageComplete(item, state);
      })
      .map((item) => item.senseId);
  }

  public isDone(): boolean {
    return this.packages.every((item) => {
      const state = this.states.get(item.packageId);
      return state === undefined
        || state.skipped
        || this.isPackageComplete(item, state);
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
      const state = this.states.get(item.packageId);
      return state !== undefined
        && !state.skipped
        && !this.isPackageComplete(item, state);
    });
    const selection = acquisitionOrchestration.fresh(
      pending.map((item) => this.toCandidate(item)),
      { ordinal, activeWindow: this.activeWindow, minGap: this.minGap },
    );
    if (!selection) {
      this.currentSession = null;
      return null;
    }
    const chosenPackage = pending.find((item) =>
      item.packageId === selection.target.targetKey)!;
    const state = this.states.get(chosenPackage.packageId)!;
    const definition = selection.definition;
    const intent = actionIntent(definition);
    const action: Session<TContent>['action'] = {
      ...definition,
      intent,
      ordinal,
      totalTarget: this.progressTarget,
      packageId: chosenPackage.packageId,
      senseId: chosenPackage.senseId,
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
    const state = this.states.get(session.action.packageId)!;
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

  /** Compatibility path for the frozen controls; state remains gate-scoped. */
  public settle(ok: boolean): Session<TContent> | null {
    const action = this.currentSession?.action;
    if (action && isIntroduction(action)) {
      return ok ? this.completeIntroduction() : this.currentSession;
    }
    const capability = action?.capability;
    if (capability === 'contextual_recognition') return this.completeRecognition(ok);
    if (capability === 'meaning_to_form_recall') return this.completeGate(capability, ok);
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
    const state = this.states.get(session.action.packageId);
    if (!state) return;
    this.captureSnapshot();
    const wasSettled = session.settled;
    if (!wasSettled) {
      session.settled = true;
      this.totalAttempts += 1;
      state.totalAttempts += 1;
    }
    state.gateStatus[capability] = 'failed';
    state.pendingRepairCapability = capability;
    state.pendingRepairForActionKey = session.action.actionKey;
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
    const packageId = this.currentSession?.action.packageId;
    if (packageId) this.setDeclaredMastery(packageId, true);
  }

  public setDeclaredMastery(packageOrSenseId: string, isMastered: boolean): boolean {
    const packageItem = this.packages.find((item) =>
      item.packageId === packageOrSenseId || item.senseId === packageOrSenseId);
    if (!packageItem) return false;
    const state = this.states.get(packageItem.packageId)!;
    if (state.declaredMastery === isMastered) return true;
    this.captureSnapshot();
    state.declaredMastery = isMastered;
    state.skipped = isMastered;
    // Intentionally preserve state.phase. In particular, a new or acquiring
    // Sense is not made retaining and never appears in graduation output.
    const session = this.currentSession;
    if (isMastered && session?.action.packageId === packageItem.packageId && !session.settled) {
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
    snapshot.states.forEach((state) => this.states.set(state.packageId, cloneState(state)));
    this.sessionHistory = snapshot.sessions.map((session) => this.copySession(session));
    this.currentSession = snapshot.currentSession
      ? this.copySession(snapshot.currentSession)
      : null;
    this.totalAttempts = snapshot.totalAttempts;
    this.totalCorrect = snapshot.totalCorrect;
    return this.currentSession;
  }

  public getStats(): QueueStats {
    const masteredCount = this.packages.filter((item) => {
      const state = this.states.get(item.packageId);
      return state?.skipped || (state !== undefined && this.isPackageComplete(item, state));
    }).length;
    return {
      sessionsCompleted: this.sessionHistory.length,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy: this.totalAttempts > 0
        ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
        : 100,
      masteredCount,
      totalSenses: this.packages.length,
      totalWords: this.packages.length,
      startTime: this.startTime,
    };
  }

  private completeGate(
    capability: LearningCapability,
    ok: boolean,
    decorate?: (session: Session<TContent>, state: SenseAcquisitionState) => void,
  ): Session<TContent> | null {
    const session = this.requireCapability(capability);
    if (!session) return this.currentSession;
    const state = this.states.get(session.action.packageId)!;
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
      state.gateStatus[capability] = 'passed';
      state.pendingRepairCapability = null;
      state.pendingRepairForActionKey = null;
      state.totalCorrect += 1;
      this.totalCorrect += 1;
    } else {
      state.gateStatus[capability] = 'failed';
      state.pendingRepairCapability = capability;
      state.pendingRepairForActionKey = session.action.actionKey;
      state.failureCounts[capability] += 1;
    }
    state.lastActionOrdinal = session.index;
    state.phase = this.isPackageComplete(session.package, state) ? 'retaining' : 'acquiring';
    this.pushCompletedSession(session);
    return session;
  }

  private completeRepair(
    session: Session<TContent>,
    state: SenseAcquisitionState,
    capability: LearningCapability,
  ): void {
    state.pendingRepairCapability = null;
    state.pendingRepairForActionKey = null;
    // A repair confirms that support was shown, not that the Gate was solved.
    // The next independently assessed action must retest the unresolved Gate.
    state.gateStatus[capability] = 'unresolved';
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
    const state = this.states.get(item.packageId)!;
    return {
      targetKey: item.packageId,
      lastStepOrdinal: state.lastActionOrdinal,
      repairBasis: this.repairBasisFor(item, state),
      inventory: item,
      introduced: state.introduced,
      gateStatus: state.gateStatus,
      lastAssessmentActionKey: state.lastAssessmentActionKey,
      transferScenarioIndex: state.transferScenarioIndex,
    };
  }

  /**
   * 这条 Target 有没有待修复的依据。
   *
   * 第二项回退让状态可恢复：某份持久化/兼容状态里可能有失败的 Gate，却早于
   * `pendingRepairCapability` 这个字段。
   */
  private repairBasisFor(
    item: SchedulablePackage<TContent>,
    state: SenseAcquisitionState,
  ): AcquisitionRepairBasis | null {
    const capability = state.pendingRepairCapability
      ?? requiredGatesOf(item).find((gate) => state.gateStatus[gate] === 'failed')
      ?? null;
    if (capability === null) return null;
    return {
      capability,
      failedActionKey: state.pendingRepairForActionKey,
      repairCount: state.repairCounts[capability],
    };
  }

  private requiredGates(item: SchedulablePackage<TContent>): LearningCapability[] {
    return requiredGatesOf(item);
  }

  private isPackageComplete(
    item: SchedulablePackage<TContent>,
    state: SenseAcquisitionState,
  ): boolean {
    return state.introduced
      && this.requiredGates(item).every((capability) => state.gateStatus[capability] === 'passed');
  }

  private assertPackageInventory(
    packages: readonly SchedulablePackage<TContent>[],
  ): void {
    const packageIds = new Set<string>();
    const senseIds = new Set<string>();
    packages.forEach((item) => {
      if (packageIds.has(item.packageId)) throw new Error(`Duplicate Package identity: ${item.packageId}`);
      if (senseIds.has(item.senseId)) throw new Error(`Duplicate Sense identity: ${item.senseId}`);
      packageIds.add(item.packageId);
      senseIds.add(item.senseId);
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
