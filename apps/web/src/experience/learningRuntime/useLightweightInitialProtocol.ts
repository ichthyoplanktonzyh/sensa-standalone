import { runtimeCheckpoint } from "./runtimeCheckpoint";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLightweightInitialProtocolRun,
  currentLightweightInitialStep,
  transitionLightweightInitialProtocol,
  type LightweightInitialOutcomeKey,
  type LightweightInitialProtocolRunState,
  type LightweightInitialTransitionResult,
} from "./lightweightInitialProtocol";
import type { LightweightInitialLearningMaterialization } from "./lightweightInitialContent";

const createRun = (
  retentionTargetId: string,
  materialization: LightweightInitialLearningMaterialization,
): LightweightInitialProtocolRunState =>
  createLightweightInitialProtocolRun({
    protocolRunId: `prototype:${retentionTargetId}:lightweight-study:v2`,
    retentionTargetId,
    learningMaterializationId:
      materialization.snapshot.learningMaterializationId,
    materialResources: materialization.content.resources,
  });

const restoreRun = (
  id: string,
  materialization: LightweightInitialLearningMaterialization,
) => {
  let run = createRun(id, materialization);
  const checkpoint = runtimeCheckpoint.read().protocols?.[id];
  if (checkpoint) {
    if (checkpoint.materializationId !== run.learningMaterializationId)
      return null;
    for (const outcome of checkpoint.outcomes)
      run = transitionLightweightInitialProtocol(run, outcome).state;
  }
  return run;
};

/** React adapter around the pure protocol runner. */
export const useLightweightInitialProtocol = (
  retentionTargetId: string | null,
  materialization: LightweightInitialLearningMaterialization | null,
) => {
  const [state, setState] = useState<LightweightInitialProtocolRunState | null>(
    () =>
      retentionTargetId && materialization
        ? restoreRun(retentionTargetId, materialization)
        : null,
  );
  const stateRef = useRef(state);

  useEffect(() => {
    const next =
      retentionTargetId && materialization
        ? restoreRun(retentionTargetId, materialization)
        : null;
    stateRef.current = next;
    setState(next);
  }, [retentionTargetId, materialization]);

  const applyOutcome = useCallback(
    (
      outcomeKey: LightweightInitialOutcomeKey,
    ): LightweightInitialTransitionResult | null => {
      const current = stateRef.current;
      if (
        !current ||
        current.retentionTargetId !== retentionTargetId ||
        current.learningMaterializationId !==
          materialization?.snapshot.learningMaterializationId ||
        current.progress.completed
      )
        return null;
      const result = transitionLightweightInitialProtocol(current, outcomeKey);
      runtimeCheckpoint.update({
        protocols: {
          ...runtimeCheckpoint.read().protocols,
          [retentionTargetId!]: {
            materializationId: result.state.learningMaterializationId,
            outcomes: result.state.completedSteps.map(
              (step) => step.outcomeKey,
            ),
          },
        },
      });
      runtimeCheckpoint.afterCommit(() => {
        stateRef.current = result.state;
        setState(result.state);
      });
      return result;
    },
    [retentionTargetId, materialization],
  );

  const activeState =
    state?.retentionTargetId === retentionTargetId &&
    state.learningMaterializationId ===
      materialization?.snapshot.learningMaterializationId
      ? state
      : null;

  return {
    state: activeState,
    step: activeState ? currentLightweightInitialStep(activeState) : null,
    reveal: useCallback(() => applyOutcome("reveal_requested"), [applyOutcome]),
    rate: useCallback(
      (rating: "again" | "hard" | "good") => applyOutcome(rating),
      [applyOutcome],
    ),
  };
};
