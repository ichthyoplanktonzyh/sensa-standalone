/**
 * 学习运行会话的入口。App 只通过这里读写"现在跑着什么"。
 *
 * 与 learningFlow 同样用 useReducer 而不是 store：只服务学习流一棵子树，
 * 全部合法转移列在 runtimeSession.ts 一处。
 */
import { useCallback, useMemo, useReducer } from 'react';
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import {
  INITIAL_RUNTIME_SESSION,
  runtimeSessionReducer,
  type RuntimeSessionState,
  type StructuredRetentionSummary,
  type StructuredRuntimeSummary,
} from './runtimeSession';

export interface RuntimeSession extends RuntimeSessionState {
  readonly startStructuredInitial: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  readonly startLightweightInitial: (targetId: PrototypeLearningTargetId) => void;
  readonly finishLightweightInitial: () => void;
  readonly startLightweightReview: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  readonly finishLightweightReview: () => void;
  readonly showInitialSummary: (summary: StructuredRuntimeSummary) => void;
  readonly showRetentionSummary: (summary: StructuredRetentionSummary) => void;
  readonly clearRetentionSummary: () => void;
}

export function useRuntimeSession(): RuntimeSession {
  const [state, dispatch] = useReducer(runtimeSessionReducer, INITIAL_RUNTIME_SESSION);

  const startStructuredInitial = useCallback(
    (targetIds: readonly PrototypeLearningTargetId[]) =>
      dispatch({ type: 'startStructuredInitial', targetIds }),
    [],
  );
  const startLightweightInitial = useCallback(
    (targetId: PrototypeLearningTargetId) =>
      dispatch({ type: 'startLightweightInitial', targetId }),
    [],
  );
  const finishLightweightInitial = useCallback(
    () => dispatch({ type: 'finishLightweightInitial' }),
    [],
  );
  const startLightweightReview = useCallback(
    (targetIds: readonly PrototypeLearningTargetId[]) =>
      dispatch({ type: 'startLightweightReview', targetIds }),
    [],
  );
  const finishLightweightReview = useCallback(
    () => dispatch({ type: 'finishLightweightReview' }),
    [],
  );
  const showInitialSummary = useCallback(
    (summary: StructuredRuntimeSummary) => dispatch({ type: 'showInitialSummary', summary }),
    [],
  );
  const showRetentionSummary = useCallback(
    (summary: StructuredRetentionSummary) => dispatch({ type: 'showRetentionSummary', summary }),
    [],
  );
  const clearRetentionSummary = useCallback(
    () => dispatch({ type: 'clearRetentionSummary' }),
    [],
  );

  return useMemo(
    (): RuntimeSession => ({
      ...state,
      startStructuredInitial,
      startLightweightInitial,
      finishLightweightInitial,
      startLightweightReview,
      finishLightweightReview,
      showInitialSummary,
      showRetentionSummary,
      clearRetentionSummary,
    }),
    [
      state,
      startStructuredInitial,
      startLightweightInitial,
      finishLightweightInitial,
      startLightweightReview,
      finishLightweightReview,
      showInitialSummary,
      showRetentionSummary,
      clearRetentionSummary,
    ],
  );
}
