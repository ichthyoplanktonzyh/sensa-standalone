/**
 * 学习运行会话的入口。App 只通过这里读写"现在跑着什么"。
 *
 * 通过本机检查点保存运行记录，只服务学习流一棵子树，
 * 全部合法转移列在 runtimeSession.ts 一处。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { runtimeCheckpoint } from "./runtimeCheckpoint";
import type { PrototypeLearningTargetId } from "../learningJourney/prototypeLearning";
import type { PrototypeRuntimeSurface } from "./runtimeCoordinator";
import {
  INITIAL_RUNTIME_SESSION,
  runtimeSessionReducer,
  type RuntimeSessionState,
  type RuntimeSessionAction,
  type StructuredRetentionSummary,
  type StructuredRuntimeSummary,
} from "./runtimeSession";

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
  const [state, setState] = useState(
    () => runtimeCheckpoint.read().session ?? INITIAL_RUNTIME_SESSION,
  );
  const current = useRef(state);
  const dispatch = useCallback((action: RuntimeSessionAction) => {
    if (
      (action.type === "startInitialRun" ||
        action.type === "startRetentionRun") &&
      action.surface === "structured_session"
    )
      runtimeCheckpoint.update({
        structuredGeneration:
          (runtimeCheckpoint.read().structuredGeneration ?? 0) + 1,
        cardDraft: undefined,
        lastFlow: "study",
      });
    const next = runtimeSessionReducer(
      runtimeCheckpoint.read().session ?? current.current,
      action,
    );
    const activeFlow =
      action.type === "startInitialRun" &&
      action.surface === "lightweight_initial"
        ? "lightweight"
        : action.type === "startRetentionRun" &&
            action.surface === "lightweight_retention"
          ? "lightweightReview"
          : undefined;
    runtimeCheckpoint.update({
      session: next,
      ...(action.type === "startRetentionRun"
        ? {
            reviewGeneration:
              (runtimeCheckpoint.read().reviewGeneration ?? 0) + 1,
          }
        : {}),
      ...(activeFlow
        ? { lastFlow: activeFlow as "lightweight" | "lightweightReview" }
        : {}),
      ...(action.type === "startRetentionRun" ||
      action.type === "finishRetentionRun"
        ? { review: undefined }
        : {}),
    });
    runtimeCheckpoint.afterCommit(() => {
      current.current = next;
      setState(next);
    });
  }, []);

  const startInitialRun = useCallback(
    (
      surface: PrototypeRuntimeSurface,
      targetIds: readonly PrototypeLearningTargetId[],
    ) => dispatch({ type: "startInitialRun", surface, targetIds }),
    [],
  );
  const finishInitialRun = useCallback(
    (surface: PrototypeRuntimeSurface) =>
      dispatch({ type: "finishInitialRun", surface }),
    [],
  );
  const finishInitialTarget = useCallback(
    (surface: PrototypeRuntimeSurface, targetId: PrototypeLearningTargetId) =>
      dispatch({ type: "finishInitialTarget", surface, targetId }),
    [],
  );
  const startRetentionRun = useCallback(
    (
      surface: PrototypeRuntimeSurface,
      targetIds: readonly PrototypeLearningTargetId[],
    ) => dispatch({ type: "startRetentionRun", surface, targetIds }),
    [],
  );
  const finishRetentionRun = useCallback(
    () => dispatch({ type: "finishRetentionRun" }),
    [],
  );
  const showInitialSummary = useCallback(
    (summary: StructuredRuntimeSummary) =>
      dispatch({ type: "showInitialSummary", summary }),
    [],
  );
  const showRetentionSummary = useCallback(
    (summary: StructuredRetentionSummary) =>
      dispatch({ type: "showRetentionSummary", summary }),
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
