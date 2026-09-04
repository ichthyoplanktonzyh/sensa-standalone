import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createLightweightInitialProtocolRun,
  currentLightweightInitialStep,
  transitionLightweightInitialProtocol,
  type LightweightInitialOutcomeKey,
  type LightweightInitialProtocolRunState,
  type LightweightInitialTransitionResult,
} from './lightweightInitialProtocol';

const createRun = (retentionTargetId: string): LightweightInitialProtocolRunState =>
  createLightweightInitialProtocolRun({
    protocolRunId: `prototype:${retentionTargetId}:lightweight-study:v2`,
    retentionTargetId,
  });

/** React adapter around the pure protocol runner. */
export const useLightweightInitialProtocol = (retentionTargetId: string | null) => {
  const [state, setState] = useState<LightweightInitialProtocolRunState | null>(
    () => retentionTargetId ? createRun(retentionTargetId) : null,
  );
  const stateRef = useRef(state);

  useEffect(() => {
    const next = retentionTargetId ? createRun(retentionTargetId) : null;
    stateRef.current = next;
    setState(next);
  }, [retentionTargetId]);

  const applyOutcome = useCallback((
    outcomeKey: LightweightInitialOutcomeKey,
  ): LightweightInitialTransitionResult | null => {
    const current = stateRef.current;
    if (
      !current
      || current.retentionTargetId !== retentionTargetId
      || current.progress.completed
    ) return null;
    const result = transitionLightweightInitialProtocol(current, outcomeKey);
    stateRef.current = result.state;
    setState(result.state);
    return result;
  }, [retentionTargetId]);

  const activeState = state?.retentionTargetId === retentionTargetId ? state : null;

  return {
    state: activeState,
    step: activeState ? currentLightweightInitialStep(activeState) : null,
    reveal: useCallback(() => applyOutcome('reveal_requested'), [applyOutcome]),
    rate: useCallback((rating: 'again' | 'hard' | 'good') => applyOutcome(rating), [applyOutcome]),
  };
};
