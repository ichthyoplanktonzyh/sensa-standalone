import assert from "node:assert/strict";
import {
  applyProtocolTransitionDecision,
  createCheckpointProgressionPolicy,
  createCompletionOnlyProgressionPolicy,
  createProtocolProgressState,
  decideAndApplyProtocolTransition,
  type LearningObservation,
  type ProtocolProgressDefinition,
  type ProtocolProgressState,
  type ProtocolProgressionPolicy,
} from "../packages/learning-kernel/src/runtime/protocolProgression.ts";

const structuredDefinition: ProtocolProgressDefinition = {
  protocolId: "structured-acquisition",
  protocolVersion: "v1",
  checkpoints: ["recognition", "recall", "transfer"].map((checkpointId) => ({
    checkpointId,
    capabilityObjectiveIds: [`capability:${checkpointId}`],
    requiredForCompletion: true,
  })),
  completionPolicy: {
    kind: "all_required_checkpoints",
    requireSameProgressEpoch: true,
  },
};

const highAssurancePolicy = createCheckpointProgressionPolicy({
  progressionPolicyId: "structured-current-checkpoint-reset-v1",
  failureReset: "current",
});
const runResetPolicy = createCheckpointProgressionPolicy({
  progressionPolicyId: "run-reset-v1",
  failureReset: "run",
});

let ordinal = 0;
const observe = (
  state: ProtocolProgressState,
  policy: ProtocolProgressionPolicy,
  kind: LearningObservation["kind"],
  checkpointId: string | null,
) => {
  ordinal += 1;
  return decideAndApplyProtocolTransition({
    definition: structuredDefinition,
    policy,
    state,
    observation: {
      observationId: `observation-${ordinal}`,
      attemptId: `attempt-${ordinal}`,
      actionId: `action-${ordinal}`,
      kind,
      checkpointId,
      evidenceIds: kind === "checkpoint_satisfied" ? [`evidence-${ordinal}`] : [],
    },
    decisionId: `decision-${ordinal}`,
  });
};

// Existing high_assurance behavior: one failed Checkpoint does not erase an
// unrelated credit, and repair itself never grants that credit.
let highAssurance = createProtocolProgressState("run-high-assurance", structuredDefinition);
highAssurance = observe(
  highAssurance,
  highAssurancePolicy,
  "checkpoint_satisfied",
  "recognition",
).state;
highAssurance = observe(
  highAssurance,
  highAssurancePolicy,
  "checkpoint_not_satisfied",
  "recall",
).state;
assert.equal(highAssurance.progressEpoch, 0);
assert.equal(highAssurance.checkpointCredits.recognition?.status, "credited");
assert.equal(highAssurance.checkpointCredits.recall?.status, "failed");
assert.equal(highAssurance.pendingRepairs.recall?.failedActionId, `action-${ordinal}`);
highAssurance = observe(
  highAssurance,
  highAssurancePolicy,
  "repair_completed",
  "recall",
).state;
assert.equal(highAssurance.checkpointCredits.recall?.status, "unresolved");
assert(highAssurance.reassessmentRequiredCheckpointIds.includes("recall"));
assert.equal(highAssurance.completed, false);

// The run-reset policy is the primitive required by the future four-stage
// preset: every current credit is invalidated and a new epoch begins.
let runReset = createProtocolProgressState("run-reset", structuredDefinition);
runReset = observe(runReset, runResetPolicy, "checkpoint_satisfied", "recognition").state;
const failedTransition = observe(
  runReset,
  runResetPolicy,
  "checkpoint_not_satisfied",
  "recall",
);
runReset = failedTransition.state;
assert.equal(runReset.progressEpoch, 1);
assert.equal(runReset.checkpointCredits.recognition?.status, "unresolved");
assert.equal(runReset.checkpointCredits.recall?.status, "failed");
assert.equal(Object.keys(runReset.appliedDecisions).length, 2);

// Same identity + same canonical fact is an idempotent replay.
const replay = applyProtocolTransitionDecision(
  structuredDefinition,
  runReset,
  failedTransition.decision,
);
assert.equal(replay.applied, false);
assert.equal(replay.state, runReset);
assert.throws(() => applyProtocolTransitionDecision(
  structuredDefinition,
  runReset,
  {
    ...failedTransition.decision,
    effects: [{ kind: "advance" }],
  },
), /identity conflict/u);

// Finish the reset run. Every required credit belongs to epoch 1.
runReset = observe(runReset, runResetPolicy, "repair_completed", "recall").state;
runReset = observe(runReset, runResetPolicy, "checkpoint_satisfied", "recall").state;
runReset = observe(runReset, runResetPolicy, "checkpoint_satisfied", "recognition").state;
runReset = observe(runReset, runResetPolicy, "checkpoint_satisfied", "transfer").state;
assert.equal(runReset.completed, true);
assert(Object.values(runReset.checkpointCredits).every(
  (credit) => credit.creditedInEpoch === runReset.progressEpoch,
));

// Lightweight is a lawful zero-Checkpoint protocol and completes only from an
// explicit Protocol completion observation.
const lightweightDefinition: ProtocolProgressDefinition = {
  protocolId: "lightweight-study",
  protocolVersion: "v1",
  checkpoints: [],
  completionPolicy: { kind: "protocol_completion" },
};
const lightweightPolicy = createCompletionOnlyProgressionPolicy("completion-only-v1");
let lightweight = createProtocolProgressState("run-lightweight", lightweightDefinition);
lightweight = decideAndApplyProtocolTransition({
  definition: lightweightDefinition,
  policy: lightweightPolicy,
  state: lightweight,
  observation: {
    observationId: "lightweight-observation-1",
    attemptId: "lightweight-attempt-1",
    actionId: "lightweight-action-1",
    kind: "practice_completed",
    checkpointId: null,
    evidenceIds: [],
  },
  decisionId: "lightweight-decision-1",
}).state;
assert.equal(lightweight.completed, false);
assert.deepEqual(lightweight.checkpointCredits, {});
lightweight = decideAndApplyProtocolTransition({
  definition: lightweightDefinition,
  policy: lightweightPolicy,
  state: lightweight,
  observation: {
    observationId: "lightweight-observation-2",
    attemptId: "lightweight-attempt-2",
    actionId: "lightweight-action-2",
    kind: "protocol_completed",
    checkpointId: null,
    evidenceIds: [],
  },
  decisionId: "lightweight-decision-2",
}).state;
assert.equal(lightweight.completed, true);

// Invalid completion is rejected without mutating the input state.
const incomplete = createProtocolProgressState("run-incomplete", structuredDefinition);
assert.throws(() => applyProtocolTransitionDecision(
  structuredDefinition,
  incomplete,
  {
    decisionId: "invalid-completion",
    observationId: "invalid-observation",
    progressionPolicyId: "invalid-policy",
    effects: [{ kind: "complete" }],
  },
), /cannot complete/u);
assert.equal(incomplete.completed, false);
assert.deepEqual(incomplete.appliedDecisions, {});

console.log("protocol-progression kernel smoke OK");
