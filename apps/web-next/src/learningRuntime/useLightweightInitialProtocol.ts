import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createLightweightInitialProtocolRun,
  currentLightweightInitialStep,
  transitionLightweightInitialProtocol,
  type LightweightInitialOutcomeKey,
  type LightweightInitialProtocolRunState,
  type LightweightInitialTransitionResult,
} from './lightweightInitialProtocol';
import type { LightweightInitialLearningMaterialization } from './lightweightInitialContent';

const createRun = (
  retentionTargetId: string,
  materialization: LightweightInitialLearningMaterialization,
): LightweightInitialProtocolRunState =>
  createLightweightInitialProtocolRun({
    protocolRunId: `prototype:${retentionTargetId}:lightweight-study:v2`,
    retentionTargetId,
    learningMaterializationId: materialization.snapshot.learningMaterializationId,
    materialResources: materialization.content.resources,
  });

/** React adapter around the pure protocol runner. */
export const useLightweightInitialProtocol = (
  retentionTargetId: string | null,
  materialization: LightweightInitialLearningMaterialization | null,
) => {
  const [state, setState] = useState<LightweightInitialProtocolRunState | null>(
    () => retentionTargetId && materialization
      ? createRun(retentionTargetId, materialization)
      : null,
  );
  const stateRef = useRef(state);

  useEffect(() => {
    const next = retentionTargetId && materialization
      ? createRun(retentionTargetId, materialization)
      : null;
    stateRef.current = next;
    setState(next);
  }, [retentionTargetId, materialization]);

  const applyOutcome = useCallback((
    outcomeKey: LightweightInitialOutcomeKey,
  ): LightweightInitialTransitionResult | null => {
    const current = stateRef.current;
    if (
      !current
      || current.retentionTargetId !== retentionTargetId
      || current.learningMaterializationId
        !== materialization?.snapshot.learningMaterializationId
      || current.progress.completed
    ) return null;
    const result = transitionLightweightInitialProtocol(current, outcomeKey);
    stateRef.current = result.state;
    setState(result.state);
    return result;
  }, [retentionTargetId, materialization]);

  const activeState = state?.retentionTargetId === retentionTargetId
    && state.learningMaterializationId === materialization?.snapshot.learningMaterializationId
    ? state
    : null;

  return {
    state: activeState,
    step: activeState ? currentLightweightInitialStep(activeState) : null,
    reveal: useCallback(() => applyOutcome('reveal_requested'), [applyOutcome]),
    rate: useCallback((rating: 'again' | 'hard' | 'good') => applyOutcome(rating), [applyOutcome]),
  };
};
