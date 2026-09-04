/**
 * Protocol-local progress is deliberately independent from capabilities,
 * presentation Cards and long-term scheduler state. A Protocol may reference
 * capability objectives from its Checkpoints, but only Checkpoint identities
 * receive run-local credit.
 */
export type ProtocolCheckpointDefinition = Readonly<{
  checkpointId: string;
  capabilityObjectiveIds: readonly string[];
  requiredForCompletion: boolean;
}>;

export type ProtocolCompletionPolicy =
  | Readonly<{ kind: "protocol_completion" }>
  | Readonly<{
      kind: "all_required_checkpoints";
      requireSameProgressEpoch: boolean;
    }>;

export type ProtocolProgressDefinition = Readonly<{
  protocolId: string;
  protocolVersion: string;
  checkpoints: readonly ProtocolCheckpointDefinition[];
  completionPolicy: ProtocolCompletionPolicy;
}>;

export type ProtocolCheckpointCredit = Readonly<{
  status: "unresolved" | "credited" | "failed";
  creditedInEpoch: number | null;
  lastObservationId: string | null;
}>;

export type PendingProtocolRepair = Readonly<{
  checkpointId: string;
  failedActionId: string;
  observationId: string;
}>;

export type ProtocolProgressState = Readonly<{
  protocolRunId: string;
  protocolId: string;
  protocolVersion: string;
  progressEpoch: number;
  checkpointCredits: Readonly<Record<string, ProtocolCheckpointCredit>>;
  pendingRepairs: Readonly<Record<string, PendingProtocolRepair>>;
  reassessmentRequiredCheckpointIds: readonly string[];
  completed: boolean;
  /** decisionId -> canonical decision fingerprint */
  appliedDecisions: Readonly<Record<string, string>>;
}>;

export type ProtocolObservationKind =
  | "instruction_completed"
  | "practice_completed"
  | "checkpoint_satisfied"
  | "checkpoint_not_satisfied"
  | "repair_completed"
  | "protocol_completed";

/**
 * Immutable result of a pinned interaction/grader contract. It records what
 * was observed; it does not grant credit or choose the next step.
 */
export type LearningObservation = Readonly<{
  observationId: string;
  attemptId: string;
  actionId: string;
  kind: ProtocolObservationKind;
  checkpointId: string | null;
  evidenceIds: readonly string[];
}>;

export type ProtocolProgressResetEffect =
  | Readonly<{
      kind: "reset_progress";
      scope: "current";
      checkpointId: string;
    }>
  | Readonly<{
      kind: "reset_progress";
      scope: "declared_set";
      checkpointIds: readonly string[];
    }>
  | Readonly<{
      kind: "reset_progress";
      scope: "run";
    }>;

export type ProtocolTransitionEffect =
  | Readonly<{ kind: "credit_checkpoint"; checkpointId: string }>
  | Readonly<{ kind: "invalidate_checkpoint"; checkpointId: string }>
  | Readonly<{
      kind: "schedule_repair";
      checkpointId: string;
      failedActionId: string;
    }>
  | Readonly<{ kind: "require_reassessment"; checkpointId: string }>
  | ProtocolProgressResetEffect
  | Readonly<{ kind: "advance" }>
  | Readonly<{ kind: "complete" }>;

export type ProtocolTransitionDecision = Readonly<{
  decisionId: string;
  observationId: string;
  progressionPolicyId: string;
  effects: readonly ProtocolTransitionEffect[];
}>;

export type ProtocolProgressionPolicyInput = Readonly<{
  definition: ProtocolProgressDefinition;
  state: ProtocolProgressState;
  observation: LearningObservation;
}>;

/** The only behavior seam exposed by the kernel. */
export interface ProtocolProgressionPolicy {
  readonly progressionPolicyId: string;
  decide(input: ProtocolProgressionPolicyInput): readonly ProtocolTransitionEffect[];
}

export type ProtocolTransitionResult = Readonly<{
  applied: boolean;
  decision: ProtocolTransitionDecision;
  state: ProtocolProgressState;
}>;

const requireIdentity = (value: string, label: string): void => {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`);
};

const checkpointDefinitions = (
  definition: ProtocolProgressDefinition,
): ReadonlyMap<string, ProtocolCheckpointDefinition> => {
  requireIdentity(definition.protocolId, "Protocol identity");
  requireIdentity(definition.protocolVersion, "Protocol version");
  const checkpoints = new Map<string, ProtocolCheckpointDefinition>();
  for (const checkpoint of definition.checkpoints) {
    requireIdentity(checkpoint.checkpointId, "Checkpoint identity");
    if (checkpoints.has(checkpoint.checkpointId)) {
      throw new Error(`Duplicate Protocol Checkpoint identity: ${checkpoint.checkpointId}`);
    }
    checkpoints.set(checkpoint.checkpointId, checkpoint);
  }
  return checkpoints;
};

export function createProtocolProgressState(
  protocolRunId: string,
  definition: ProtocolProgressDefinition,
): ProtocolProgressState {
  requireIdentity(protocolRunId, "Protocol Run identity");
  const checkpoints = checkpointDefinitions(definition);
  return Object.freeze({
    protocolRunId,
    protocolId: definition.protocolId,
    protocolVersion: definition.protocolVersion,
    progressEpoch: 0,
    checkpointCredits: Object.freeze(Object.fromEntries(
      [...checkpoints.keys()].map((checkpointId) => [checkpointId, Object.freeze({
        status: "unresolved" as const,
        creditedInEpoch: null,
        lastObservationId: null,
      })]),
    )),
    pendingRepairs: Object.freeze({}),
    reassessmentRequiredCheckpointIds: Object.freeze([]),
    completed: false,
    appliedDecisions: Object.freeze({}),
  });
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const decisionFingerprint = (decision: ProtocolTransitionDecision): string =>
  JSON.stringify(canonicalize(decision));

const requireMatchingState = (
  definition: ProtocolProgressDefinition,
  state: ProtocolProgressState,
): ReadonlyMap<string, ProtocolCheckpointDefinition> => {
  const checkpoints = checkpointDefinitions(definition);
  if (
    state.protocolId !== definition.protocolId
    || state.protocolVersion !== definition.protocolVersion
  ) {
    throw new Error(
      `Protocol progress ${state.protocolRunId} is pinned to ${state.protocolId}@${state.protocolVersion}.`,
    );
  }
  const stateCheckpointIds = Object.keys(state.checkpointCredits).sort();
  const definitionCheckpointIds = [...checkpoints.keys()].sort();
  if (JSON.stringify(stateCheckpointIds) !== JSON.stringify(definitionCheckpointIds)) {
    throw new Error(`Protocol progress ${state.protocolRunId} does not match its Checkpoint definition.`);
  }
  return checkpoints;
};

const requireCheckpoint = (
  checkpoints: ReadonlyMap<string, ProtocolCheckpointDefinition>,
  checkpointId: string,
): void => {
  if (!checkpoints.has(checkpointId)) {
    throw new Error(`Unknown Protocol Checkpoint: ${checkpointId}`);
  }
};

const isCompletionSatisfied = (
  definition: ProtocolProgressDefinition,
  state: ProtocolProgressState,
): boolean => {
  const completionPolicy = definition.completionPolicy;
  if (completionPolicy.kind === "protocol_completion") return true;
  return definition.checkpoints
    .filter((checkpoint) => checkpoint.requiredForCompletion)
    .every((checkpoint) => {
      const credit = state.checkpointCredits[checkpoint.checkpointId]!;
      return credit.status === "credited"
        && (!completionPolicy.requireSameProgressEpoch
          || credit.creditedInEpoch === state.progressEpoch)
        && state.pendingRepairs[checkpoint.checkpointId] === undefined
        && !state.reassessmentRequiredCheckpointIds.includes(checkpoint.checkpointId);
    });
};

const unresolvedCredit = (
  previous: ProtocolCheckpointCredit,
): ProtocolCheckpointCredit => Object.freeze({
  status: "unresolved",
  creditedInEpoch: null,
  lastObservationId: previous.lastObservationId,
});

/**
 * Validate and atomically apply an immutable Transition Decision. The input
 * state is never mutated. Replaying the same decision is a no-op; reusing its
 * identity for different content is an immutable conflict.
 */
export function applyProtocolTransitionDecision(
  definition: ProtocolProgressDefinition,
  state: ProtocolProgressState,
  decision: ProtocolTransitionDecision,
): ProtocolTransitionResult {
  const checkpoints = requireMatchingState(definition, state);
  requireIdentity(decision.decisionId, "Transition Decision identity");
  requireIdentity(decision.observationId, "Observation identity");
  requireIdentity(decision.progressionPolicyId, "Progression Policy identity");
  const fingerprint = decisionFingerprint(decision);
  const priorFingerprint = state.appliedDecisions[decision.decisionId];
  if (priorFingerprint !== undefined) {
    if (priorFingerprint !== fingerprint) {
      throw new Error(`Transition Decision identity conflict: ${decision.decisionId}`);
    }
    return { applied: false, decision, state };
  }

  // Validate every reference before applying the first effect. This keeps an
  // invalid decision from producing a partial transition.
  for (const effect of decision.effects) {
    switch (effect.kind) {
      case "credit_checkpoint":
      case "invalidate_checkpoint":
      case "schedule_repair":
      case "require_reassessment":
        requireCheckpoint(checkpoints, effect.checkpointId);
        break;
      case "reset_progress":
        if (effect.scope === "current") requireCheckpoint(checkpoints, effect.checkpointId);
        if (effect.scope === "declared_set") {
          if (effect.checkpointIds.length === 0) {
            throw new Error("A declared-set Progress Reset requires at least one Checkpoint.");
          }
          effect.checkpointIds.forEach((checkpointId) => requireCheckpoint(checkpoints, checkpointId));
        }
        break;
      case "advance":
      case "complete":
        break;
    }
  }

  let progressEpoch = state.progressEpoch;
  const credits: Record<string, ProtocolCheckpointCredit> = { ...state.checkpointCredits };
  const pendingRepairs: Record<string, PendingProtocolRepair> = { ...state.pendingRepairs };
  const reassessment = new Set(state.reassessmentRequiredCheckpointIds);
  let completed = state.completed;

  const invalidate = (checkpointId: string): void => {
    credits[checkpointId] = unresolvedCredit(credits[checkpointId]!);
    delete pendingRepairs[checkpointId];
    reassessment.delete(checkpointId);
  };

  for (const effect of decision.effects) {
    switch (effect.kind) {
      case "credit_checkpoint":
        credits[effect.checkpointId] = Object.freeze({
          status: "credited",
          creditedInEpoch: progressEpoch,
          lastObservationId: decision.observationId,
        });
        delete pendingRepairs[effect.checkpointId];
        reassessment.delete(effect.checkpointId);
        break;
      case "invalidate_checkpoint":
        invalidate(effect.checkpointId);
        break;
      case "schedule_repair":
        credits[effect.checkpointId] = Object.freeze({
          status: "failed",
          creditedInEpoch: null,
          lastObservationId: decision.observationId,
        });
        pendingRepairs[effect.checkpointId] = Object.freeze({
          checkpointId: effect.checkpointId,
          failedActionId: effect.failedActionId,
          observationId: decision.observationId,
        });
        reassessment.delete(effect.checkpointId);
        break;
      case "require_reassessment":
        credits[effect.checkpointId] = unresolvedCredit(credits[effect.checkpointId]!);
        delete pendingRepairs[effect.checkpointId];
        reassessment.add(effect.checkpointId);
        break;
      case "reset_progress": {
        const checkpointIds = effect.scope === "run"
          ? [...checkpoints.keys()]
          : effect.scope === "current"
            ? [effect.checkpointId]
            : [...new Set(effect.checkpointIds)];
        if (effect.scope === "run") progressEpoch += 1;
        checkpointIds.forEach(invalidate);
        completed = false;
        break;
      }
      case "advance":
        break;
      case "complete":
        completed = true;
        break;
    }
  }

  const nextState: ProtocolProgressState = Object.freeze({
    ...state,
    progressEpoch,
    checkpointCredits: Object.freeze(credits),
    pendingRepairs: Object.freeze(pendingRepairs),
    reassessmentRequiredCheckpointIds: Object.freeze([...reassessment].sort()),
    completed,
    appliedDecisions: Object.freeze({
      ...state.appliedDecisions,
      [decision.decisionId]: fingerprint,
    }),
  });
  if (completed && !isCompletionSatisfied(definition, nextState)) {
    throw new Error(`Protocol ${definition.protocolId} cannot complete with unresolved Checkpoints.`);
  }
  return { applied: true, decision, state: nextState };
}

export type DecideAndApplyProtocolTransitionInput = Readonly<{
  definition: ProtocolProgressDefinition;
  policy: ProtocolProgressionPolicy;
  state: ProtocolProgressState;
  observation: LearningObservation;
  decisionId: string;
}>;

/**
 * Deep external interface: callers provide one Observation and receive the
 * immutable Decision plus the next state. Policy-specific branching remains
 * behind the progression-policy seam.
 */
export function decideAndApplyProtocolTransition(
  input: DecideAndApplyProtocolTransitionInput,
): ProtocolTransitionResult {
  // A learner correction may invalidate a just-completed local run before its
  // completion is externally committed. No other observation can advance a
  // terminal run.
  if (
    input.state.completed
    && input.observation.kind !== "checkpoint_not_satisfied"
  ) {
    throw new Error(`Protocol Run ${input.state.protocolRunId} is already complete.`);
  }
  requireIdentity(input.observation.observationId, "Observation identity");
  requireIdentity(input.observation.attemptId, "Attempt identity");
  requireIdentity(input.observation.actionId, "Action identity");
  if (input.observation.checkpointId !== null) {
    requireCheckpoint(checkpointDefinitions(input.definition), input.observation.checkpointId);
  }
  const decision: ProtocolTransitionDecision = Object.freeze({
    decisionId: input.decisionId,
    observationId: input.observation.observationId,
    progressionPolicyId: input.policy.progressionPolicyId,
    effects: Object.freeze([...input.policy.decide({
      definition: input.definition,
      state: input.state,
      observation: input.observation,
    })]),
  });
  return applyProtocolTransitionDecision(input.definition, input.state, decision);
}

const requireObservationCheckpoint = (observation: LearningObservation): string => {
  if (observation.checkpointId === null) {
    throw new Error(`Observation ${observation.observationId} requires a Protocol Checkpoint.`);
  }
  return observation.checkpointId;
};

const wouldCompleteAfterCredit = (
  definition: ProtocolProgressDefinition,
  state: ProtocolProgressState,
  checkpointId: string,
): boolean => definition.completionPolicy.kind === "all_required_checkpoints"
  && (() => {
    const completionPolicy = definition.completionPolicy;
    if (completionPolicy.kind !== "all_required_checkpoints") return false;
    return definition.checkpoints
      .filter((checkpoint) => checkpoint.requiredForCompletion)
      .every((checkpoint) => checkpoint.checkpointId === checkpointId
        || (
          state.checkpointCredits[checkpoint.checkpointId]?.status === "credited"
          && (!completionPolicy.requireSameProgressEpoch
            || state.checkpointCredits[checkpoint.checkpointId]?.creditedInEpoch === state.progressEpoch)
        ));
  })();

export type CheckpointFailureReset = "current" | "run";

/**
 * Standard checkpoint policy used by Structured Acquisition and by protocols
 * whose failure resets the entire run. Repair never grants credit; it only
 * makes the failed Checkpoint eligible for an independent reassessment.
 */
export function createCheckpointProgressionPolicy(input: Readonly<{
  progressionPolicyId: string;
  failureReset: CheckpointFailureReset;
}>): ProtocolProgressionPolicy {
  requireIdentity(input.progressionPolicyId, "Progression Policy identity");
  const policy: ProtocolProgressionPolicy = {
    progressionPolicyId: input.progressionPolicyId,
    decide: ({ definition, state, observation }: ProtocolProgressionPolicyInput): readonly ProtocolTransitionEffect[] => {
      switch (observation.kind) {
        case "checkpoint_satisfied": {
          const checkpointId = requireObservationCheckpoint(observation);
          const effects: ProtocolTransitionEffect[] = [
            { kind: "credit_checkpoint", checkpointId },
            { kind: "advance" },
          ];
          if (wouldCompleteAfterCredit(definition, state, checkpointId)) {
            effects.push({ kind: "complete" });
          }
          return effects;
        }
        case "checkpoint_not_satisfied": {
          const checkpointId = requireObservationCheckpoint(observation);
          return [
            input.failureReset === "run"
              ? { kind: "reset_progress", scope: "run" }
              : { kind: "reset_progress", scope: "current", checkpointId },
            {
              kind: "schedule_repair",
              checkpointId,
              failedActionId: observation.actionId,
            },
          ];
        }
        case "repair_completed": {
          const checkpointId = requireObservationCheckpoint(observation);
          return [
            { kind: "require_reassessment", checkpointId },
            { kind: "advance" },
          ];
        }
        case "instruction_completed":
        case "practice_completed":
          return [{ kind: "advance" }];
        case "protocol_completed":
          return [{ kind: "complete" }];
      }
    },
  };
  return Object.freeze(policy);
}

/** A zero-Checkpoint protocol completes only from an explicit completion observation. */
export function createCompletionOnlyProgressionPolicy(
  progressionPolicyId: string,
): ProtocolProgressionPolicy {
  requireIdentity(progressionPolicyId, "Progression Policy identity");
  const policy: ProtocolProgressionPolicy = {
    progressionPolicyId,
    decide: ({ observation }: ProtocolProgressionPolicyInput): readonly ProtocolTransitionEffect[] => observation.kind === "protocol_completed"
      ? [{ kind: "complete" }]
      : [{ kind: "advance" }],
  };
  return Object.freeze(policy);
}
