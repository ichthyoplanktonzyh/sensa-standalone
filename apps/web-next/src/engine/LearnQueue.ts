import type {
  AcquisitionTargetProjection,
  AcquisitionGateStatus,
  LearningCapability,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  QueueConfig,
  QueueStats,
  RepairResourceRole,
  SchedulablePackage,
  ScheduledActionDefinition,
  ScheduledActionMode,
  Session,
  SenseAcquisitionState,
  StructuredAcquisitionProjection,
} from './types';

type GateCapability = Exclude<LearningCapability, 'introduction'>;

interface HistorySnapshot<TContent> {
  states: SenseAcquisitionState[];
  sessions: Session<TContent>[];
  currentSession: Session<TContent> | null;
  totalAttempts: number;
  totalCorrect: number;
}

function emptyGateStatus(): Record<GateCapability, AcquisitionGateStatus> {
  return {
    contextual_recognition: 'unresolved',
    meaning_to_form_recall: 'unresolved',
    novel_context_transfer: 'unresolved',
    boundary_discrimination: 'unresolved',
  };
}

function emptyCounts(): Record<GateCapability, number> {
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

function actionMode(definition: ScheduledActionDefinition): ScheduledActionMode {
  return definition.mode ?? 'assessment';
}

function isAssessment(definition: ScheduledActionDefinition): boolean {
  return actionMode(definition) === 'assessment';
}

function repairRoleFor(capability: GateCapability): RepairResourceRole {
  switch (capability) {
    case 'meaning_to_form_recall':
      return 'l1_bridge';
    case 'contextual_recognition':
    case 'novel_context_transfer':
    case 'boundary_discrimination':
      return 'experience_recap';
  }
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
            mode: this.currentSession.action.mode,
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
   * Select one eligible action. When the active window is not full, new
   * Senses fill it first. Once full, the oldest eligible active Sense wins;
   * this gives unfinished cycles fairness instead of repeatedly selecting the
   * first Package in the release. A cooldown fallback is used only when no
   * other Sense can satisfy minGap (for example, a one-Sense fixture).
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
    const active = pending.filter((item) => this.states.get(item.packageId)?.introduced === true);
    const fresh = pending.filter((item) => this.states.get(item.packageId)?.introduced === false);
    const eligibleActive = active.filter((item) =>
      this.isEligible(this.states.get(item.packageId)!, ordinal));
    const eligibleFresh = fresh.filter((item) =>
      this.isEligible(this.states.get(item.packageId)!, ordinal));

    let candidates: readonly SchedulablePackage<TContent>[];
    if (active.length < this.activeWindow && eligibleFresh.length > 0) {
      candidates = eligibleFresh;
    } else if (eligibleActive.length > 0) {
      candidates = eligibleActive;
    } else if (active.length < this.activeWindow && fresh.length > 0) {
      // Fresh Packages have no previous action and are normally always
      // eligible. This branch makes the intent explicit if a future policy
      // adds a fresh-Sense cooldown.
      candidates = fresh;
    } else if (active.length > 0) {
      // No other Sense can satisfy minGap. This is an explicit equivalent
      // cooldown fallback, not an assertion that the gap was met.
      candidates = active;
    } else {
      candidates = fresh;
    }

    const chosenPackage = this.chooseOldest(candidates);
    if (!chosenPackage) {
      this.currentSession = null;
      return null;
    }
    const state = this.states.get(chosenPackage.packageId)!;
    const definition = this.nextDefinition(chosenPackage, state);
    if (!definition) {
      this.currentSession = null;
      return null;
    }
    const mode = actionMode(definition);
    const action: Session<TContent>['action'] = {
      ...definition,
      mode,
      ordinal,
      totalTarget: this.progressTarget,
      packageId: chosenPackage.packageId,
      senseId: chosenPackage.senseId,
      content: chosenPackage.content,
      reason: mode === 'repair'
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
    const session = this.requireCapability('introduction');
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
        if (outcome === 'repair' && session.action.mode !== 'repair') {
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
    const capability = this.currentSession?.action.capability;
    if (capability === 'introduction') {
      return ok ? this.completeIntroduction() : this.currentSession;
    }
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
    if (!session || session.action.capability === 'introduction' || session.action.mode === 'repair') {
      return;
    }
    const state = this.states.get(session.action.packageId);
    if (!state) return;
    this.captureSnapshot();
    const capability = session.action.capability as GateCapability;
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
    capability: GateCapability,
    ok: boolean,
    decorate?: (session: Session<TContent>, state: SenseAcquisitionState) => void,
  ): Session<TContent> | null {
    const session = this.requireCapability(capability);
    if (!session) return this.currentSession;
    const state = this.states.get(session.action.packageId)!;
    this.captureSnapshot();
    if (session.action.mode === 'repair') {
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
    capability: GateCapability,
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

  private nextDefinition(
    item: SchedulablePackage<TContent>,
    state: SenseAcquisitionState,
  ): ScheduledActionDefinition | null {
    if (!state.introduced) {
      return item.actions.find((action) =>
        action.kind === 'introduction' && action.capability === 'introduction' && isAssessment(action)) ?? null;
    }

    const requiredGates = this.requiredGates(item);
    if (state.pendingRepairCapability !== null) {
      return this.repairDefinition(item, state, state.pendingRepairCapability);
    }

    // This branch keeps state recoverable if a persisted/compatibility state
    // contains a failed Gate but predates pendingRepairCapability.
    const failed = requiredGates.find((capability) => state.gateStatus[capability] === 'failed');
    if (failed) return this.repairDefinition(item, state, failed);

    const pending = requiredGates.find((capability) => state.gateStatus[capability] !== 'passed');
    if (!pending) return null;
    const actions = this.gateActions(item, pending);
    if (actions.length === 0) return null;
    if (pending === 'novel_context_transfer') {
      return actions[state.transferScenarioIndex % actions.length] ?? actions[0];
    }
    const previousActionKey = state.lastAssessmentActionKey[pending];
    if (previousActionKey && actions.length > 1) {
      return actions.find((action) => action.actionKey !== previousActionKey) ?? actions[0];
    }
    return actions[0];
  }

  private repairDefinition(
    item: SchedulablePackage<TContent>,
    state: SenseAcquisitionState,
    capability: GateCapability,
  ): ScheduledActionDefinition | null {
    const actions = this.gateActions(item, capability);
    const base = actions.find((action) =>
      action.actionKey === state.pendingRepairForActionKey)
      ?? actions[0];
    if (!base) return null;
    const repairNumber = state.repairCounts[capability] + 1;
    const declaredRepair = item.repairActions?.find((action) =>
      action.capability === capability && action.mode === 'repair');
    if (declaredRepair) {
      return {
        ...declaredRepair,
        actionKey: declaredRepair.actionKey === base.actionKey
          ? `${base.actionKey}.repair.${repairNumber}`
          : declaredRepair.actionKey,
        taskKey: null,
        kind: 'acquisition_gate',
        mode: 'repair',
        repairForActionKey: declaredRepair.repairForActionKey ?? base.actionKey,
        repairResourceRef: declaredRepair.repairResourceRef ?? {
          role: repairRoleFor(capability),
          key: null,
          source: 'scheduler_fallback',
          fallbackReason: 'repair_binding_not_exposed',
        },
      };
    }
    return {
      actionKey: `${base.actionKey}.repair.${repairNumber}`,
      capability,
      taskKey: null,
      kind: 'acquisition_gate',
      mode: 'repair',
      repairForActionKey: base.actionKey,
      repairResourceRef: {
        role: repairRoleFor(capability),
        key: null,
        source: 'scheduler_fallback',
        fallbackReason: 'repair_binding_not_exposed',
      },
    };
  }

  private gateActions(
    item: SchedulablePackage<TContent>,
    capability: GateCapability,
  ): ScheduledActionDefinition[] {
    return item.actions.filter((action) =>
      action.capability === capability
      && action.kind === 'acquisition_gate'
      && isAssessment(action));
  }

  private requiredGates(item: SchedulablePackage<TContent>): GateCapability[] {
    return item.requiredCapabilities.filter(
      (capability, index, all): capability is GateCapability =>
        capability !== 'introduction'
        && all.indexOf(capability) === index,
    );
  }

  private isPackageComplete(
    item: SchedulablePackage<TContent>,
    state: SenseAcquisitionState,
  ): boolean {
    return state.introduced
      && this.requiredGates(item).every((capability) => state.gateStatus[capability] === 'passed');
  }

  /** minGap is the number of other Actions between two appearances. */
  private isEligible(state: SenseAcquisitionState, ordinal: number): boolean {
    return state.lastActionOrdinal < 0
      || ordinal - state.lastActionOrdinal - 1 >= this.minGap;
  }

  private chooseOldest(
    candidates: readonly SchedulablePackage<TContent>[],
  ): SchedulablePackage<TContent> | null {
    return [...candidates].sort((left, right) => {
      const leftState = this.states.get(left.packageId)!;
      const rightState = this.states.get(right.packageId)!;
      return leftState.lastActionOrdinal - rightState.lastActionOrdinal
        || left.packageId.localeCompare(right.packageId);
    })[0] ?? null;
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
      if (!item.actions.some((action) =>
        action.kind === 'introduction' && action.capability === 'introduction' && isAssessment(action))) {
        throw new Error(`Package ${item.packageId} has no executable Introduction action.`);
      }
      const requiredGates = item.requiredCapabilities.filter(
        (capability): capability is GateCapability => capability !== 'introduction',
      );
      requiredGates.forEach((capability) => {
        if (this.gateActions(item, capability).length === 0) {
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
