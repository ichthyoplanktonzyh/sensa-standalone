import assert from "node:assert/strict";
import {
  RuntimeCheckpointStore,
  type RuntimeCheckpoint,
} from "../apps/web/src/experience/learningRuntime/runtimeCheckpoint";
import {
  initialReviewState,
  transitionReview,
  type ReviewAction,
} from "../apps/web/src/experience/learningRuntime/lightweightReviewState";
import {
  INITIAL_JOURNEY,
  journeyReducer,
  journeyFor,
  type JourneyAction,
  type JourneyState,
} from "../apps/web/src/experience/learningJourney/journeyState";
import { resolveLearnerRatedMemoryOutcome } from "../apps/web/src/experience/review/types";
import {
  PROTOTYPE_LEARNING_TARGETS,
  lightweightInitialMaterializationForTarget,
} from "../apps/web/src/experience/learningJourney/prototypeLearning";
import {
  createLightweightInitialProtocolRun,
  transitionLightweightInitialProtocol,
  type LightweightInitialOutcomeKey,
} from "../apps/web/src/experience/learningRuntime/lightweightInitialProtocol";
import {
  INITIAL_RUNTIME_SESSION,
  runtimeSessionReducer,
} from "../apps/web/src/experience/learningRuntime/runtimeSession";

class MemoryStorage {
  values = new Map<string, string>();
  fail = false;
  writes = 0;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw Error("QuotaExceededError");
    this.values.set(key, value);
    this.writes++;
  }
}
const disk = new MemoryStorage();
let checkpoint = new RuntimeCheckpointStore(disk);
const reload = () => {
  checkpoint = new RuntimeCheckpointStore(disk);
  return checkpoint.read();
};
const targetId = "borrow-receive";
const journey = (): JourneyState => {
  const saved = checkpoint.read().journey;
  return saved
    ? {
        ...saved,
        declaredMasteryRetentionTargetIds: new Set(
          saved.declaredMasteryRetentionTargetIds,
        ),
      }
    : INITIAL_JOURNEY;
};
const dispatch = (action: JourneyAction) => {
  const next = journeyReducer(journey(), action);
  checkpoint.update({
    journey: {
      ...next,
      declaredMasteryRetentionTargetIds: [
        ...next.declaredMasteryRetentionTargetIds,
      ],
    },
  });
};
const material = lightweightInitialMaterializationForTarget(
  PROTOTYPE_LEARNING_TARGETS[targetId],
)!;
assert.ok(material);
const freshRun = () =>
  createLightweightInitialProtocolRun({
    protocolRunId: "checkpoint-smoke",
    retentionTargetId: targetId,
    learningMaterializationId: material.snapshot.learningMaterializationId,
    materialResources: material.content.resources,
  });
const restoreProtocol = () =>
  (checkpoint.read().protocols?.[targetId]?.outcomes ?? []).reduce(
    (run, outcome) => transitionLightweightInitialProtocol(run, outcome).state,
    freshRun(),
  );
const step = (outcome: LightweightInitialOutcomeKey) => {
  const next = transitionLightweightInitialProtocol(
    restoreProtocol(),
    outcome,
  ).state;
  checkpoint.update({
    protocols: {
      [targetId]: {
        materializationId: next.learningMaterializationId,
        outcomes: next.completedSteps.map((s) => s.outcomeKey),
      },
    },
  });
};
const policy = INITIAL_JOURNEY.defaultPolicy;
checkpoint.atomic(() => {
  dispatch({ type: "commitPolicies", entries: [{ targetId, policy }] });
  checkpoint.update({
    session: runtimeSessionReducer(INITIAL_RUNTIME_SESSION, {
      type: "startInitialRun",
      surface: "lightweight_initial",
      targetIds: [targetId],
    }),
    lastFlow: "lightweight",
  });
});
step("reveal_requested");
const revealed = restoreProtocol();
reload();
assert.deepEqual(
  restoreProtocol(),
  revealed,
  "reload preserves revealed expression step",
);
step("again");
reload();
assert.equal(restoreProtocol().progress.completed, false);
step("reveal_requested");
const complete: JourneyAction = {
  type: "completeProtocolInitial",
  targetId,
  rating: "good",
  completedAt: "2026-09-07T00:00:00Z",
  nextReviewAt: "2026-09-08T00:00:00Z",
  nextReviewLabel: "next",
  startLightweightRetention: true,
};
let displayed = false;
const before = disk.getItem("learning-checkpoint:v1");
disk.fail = true;
assert.throws(() =>
  checkpoint.atomic(() => {
    step("good");
    dispatch(complete);
    checkpoint.afterCommit(() => {
      displayed = true;
    });
  }),
);
assert.equal(displayed, false);
assert.equal(disk.getItem("learning-checkpoint:v1"), before);
assert.equal(
  restoreProtocol().progress.completed,
  false,
  "failed commit rolls back protocol",
);
assert.equal(
  journeyFor(journey(), targetId).initialCompletion,
  null,
  "failed commit rolls back learner fact",
);
disk.fail = false;
const writes = disk.writes;
checkpoint.atomic(() => {
  step("good");
  dispatch(complete);
  checkpoint.afterCommit(() => {
    displayed = true;
  });
});
assert.equal(
  disk.writes,
  writes + 1,
  "protocol and completion share one durable write",
);
reload();
assert.equal(displayed, true);
assert.equal(restoreProtocol().progress.completed, true);
dispatch({ ...complete, completedAt: "2026-09-09T00:00:00Z" });
assert.equal(
  journeyFor(journey(), targetId).initialCompletion?.completedAt,
  complete.completedAt,
  "initial completion is idempotent",
);

checkpoint.atomic(() => {
  checkpoint.update({
    session: runtimeSessionReducer(checkpoint.read().session!, {
      type: "startRetentionRun",
      surface: "lightweight_retention",
      targetIds: [targetId],
    }),
    pendingMixed: ["lend-give"],
    lastFlow: "lightweightReview",
    reviewGeneration: 1,
    review: { key: "1:" + targetId, state: initialReviewState() },
  });
});
const act = (action: ReviewAction) => {
  const previous = checkpoint.read().review!;
  const next = transitionReview(previous.state, action, [targetId]);
  if (next.state === previous.state) return;
  checkpoint.atomic(() => {
    if (next.rating)
      dispatch({
        type: "recordLightweightReview",
        targetId,
        outcome: resolveLearnerRatedMemoryOutcome(next.rating),
        reviewedAt: "2026-09-07T00:00:00Z",
        nextReviewAt: "2026-09-08T00:00:00Z",
        nextReviewLabel: "next",
      });
    if (next.repaired)
      dispatch({ type: "clearLightweightRelearning", targetId });
    checkpoint.update({ review: { ...previous, state: next.state } });
  });
};
act({ type: "reveal" });
act({ type: "rate", rating: "again" });
reload();
assert.equal(checkpoint.read().review?.state.phase, "repair");
assert.equal(
  journeyFor(journey(), targetId).lightweightRetention?.reviewCount,
  1,
);
assert.deepEqual(checkpoint.read().pendingMixed, ["lend-give"]);
for (let i = 0; i < 2; i++) {
  act({ type: "retry" });
  reload();
  act({ type: "reveal" });
  reload();
  act({ type: "repairResult", restored: i === 1 });
  reload();
}
assert.equal(checkpoint.read().review?.state.phase, "summary");
assert.equal(
  journeyFor(journey(), targetId).lightweightRetention?.relearning,
  false,
);
act({ type: "rate", rating: "good" });
reload();
assert.equal(
  journeyFor(journey(), targetId).lightweightRetention?.reviewCount,
  1,
  "reloaded repair and summary never rate again",
);
checkpoint.atomic(() => {
  checkpoint.update({
    session: runtimeSessionReducer(checkpoint.read().session!, {
      type: "finishRetentionRun",
    }),
  });
  checkpoint.update({
    session: runtimeSessionReducer(checkpoint.read().session!, {
      type: "startInitialRun",
      surface: "lightweight_initial",
      targetIds: ["lend-give"],
    }),
    pendingMixed: null,
    lastFlow: "lightweight",
    review: undefined,
  });
});
reload();
assert.deepEqual(checkpoint.read().session?.initialRuns.lightweight_initial, [
  "lend-give",
]);
assert.equal(checkpoint.read().pendingMixed, null);
assert.equal(checkpoint.read().review, undefined);

const stale = new RuntimeCheckpointStore(disk);
stale.read();
checkpoint.update({ pausedFlow: "lightweight" });
const latest = disk.getItem("learning-checkpoint:v1");
assert.throws(() => stale.update({ pausedFlow: null }), /checkpointConflict/);
assert.equal(
  disk.getItem("learning-checkpoint:v1"),
  latest,
  "stale page cannot overwrite progress",
);
assert.equal(stale.getError(), "checkpointConflict");
disk.values.set(
  "learning-checkpoint:v1",
  latest!.replace('"checksum":"', '"checksum":"broken'),
);
const corrupted = disk.getItem("learning-checkpoint:v1");
const damaged = new RuntimeCheckpointStore(disk);
assert.deepEqual(damaged.read(), {});
assert.equal(damaged.getError(), "checkpointUnreadable");
assert.throws(() => damaged.update({ lastFlow: null }));
assert.equal(
  disk.getItem("learning-checkpoint:v1"),
  corrupted,
  "unreadable original preserved",
);
console.log(
  "Runtime checkpoint smoke passed: protocol reload, atomic completion, storage rollback, repair/review exactly-once, mixed handoff, stale-page conflict and corrupt-record preservation. No browser or provider calls.",
);
