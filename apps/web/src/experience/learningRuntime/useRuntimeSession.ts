/**
 * 学习运行会话的入口。App 只通过这里读写"现在跑着什么"。
 *
 * 与 learningFlow 同样用 useReducer 而不是 store：只服务学习流一棵子树，
 * 全部合法转移列在 runtimeSession.ts 一处。
 */
import { useCallback, useMemo, useReducer } from 'react';
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import type { PrototypeRuntimeSurface } from './runtimeCoordinator';
import {
  INITIAL_RUNTIME_SESSION,
  runtimeSessionReducer,
  type RuntimeSessionState,
  type StructuredRetentionSummary,
  type StructuredRuntimeSummary,
} from './runtimeSession';

export interface RuntimeSession extends RuntimeSessionState {
  readonly startInitialRun: (
    surface: PrototypeRuntimeSurface,
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  readonly finishInitialTarget: (
    surface: PrototypeRuntimeSurface,
    targetId: PrototypeLearningTargetId,
  ) => void;
  readonly finishInitialRun: (surface: PrototypeRuntimeSurface) => void;
  readonly startRetentionRun: (
    surface: PrototypeRuntimeSurface,
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  readonly finishRetentionRun: () => void;
  readonly showInitialSummary: (summary: StructuredRuntimeSummary) => void;
  readonly showRetentionSummary: (summary: StructuredRetentionSummary) => void;
}

export function useRuntimeSession(): RuntimeSession {
  const [state, dispatch] = useReducer(runtimeSessionReducer, INITIAL_RUNTIME_SESSION);

  const startInitialRun = useCallback(
    (
      surface: PrototypeRuntimeSurface,
      targetIds: readonly PrototypeLearningTargetId[],
    ) => dispatch({ type: 'startInitialRun', surface, targetIds }),
    [],
  );
  const finishInitialRun = useCallback(
    (surface: PrototypeRuntimeSurface) => dispatch({ type: 'finishInitialRun', surface }),
    [],
  );
  const finishInitialTarget = useCallback(
    (surface: PrototypeRuntimeSurface, targetId: PrototypeLearningTargetId) =>
      dispatch({ type: 'finishInitialTarget', surface, targetId }),
    [],
  );
  const startRetentionRun = useCallback(
    (
      surface: PrototypeRuntimeSurface,
      targetIds: readonly PrototypeLearningTargetId[],
    ) => dispatch({ type: 'startRetentionRun', surface, targetIds }),
    [],
  );
  const finishRetentionRun = useCallback(
    () => dispatch({ type: 'finishRetentionRun' }),
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

  return useMemo(
    (): RuntimeSession => ({
      ...state,
      startInitialRun,
      finishInitialTarget,
      finishInitialRun,
      startRetentionRun,
      finishRetentionRun,
      showInitialSummary,
      showRetentionSummary,
    }),
    [
      state,
      startInitialRun,
      finishInitialTarget,
      finishInitialRun,
      startRetentionRun,
      finishRetentionRun,
      showInitialSummary,
      showRetentionSummary,
    ],
  );
}
