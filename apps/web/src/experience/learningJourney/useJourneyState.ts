/**
 * 学习旅程状态的入口。App 只通过这里读写每条 Target 的进度。
 *
 * 全部合法转移列在 journeyState.ts；纯 reducer 的结果与运行步骤一起提交本机检查点。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { runtimeCheckpoint } from "../learningRuntime/runtimeCheckpoint";
import {
  INITIAL_JOURNEY,
  journeyReducer,
  type JourneyAction,
  type JourneyState,
} from "./journeyState";

export interface JourneyStore {
  readonly journey: JourneyState;
  readonly dispatchJourney: (action: JourneyAction) => void;
}

export function useJourneyState(): JourneyStore {
  const [journey, setJourney] = useState(() => {
    const saved = runtimeCheckpoint.read().journey;
    return saved
      ? {
          ...saved,
          declaredMasteryRetentionTargetIds: new Set(
            saved.declaredMasteryRetentionTargetIds,
          ),
        }
      : INITIAL_JOURNEY;
  });
  const current = useRef(journey);
  const dispatchJourney = useCallback((action: JourneyAction) => {
    const saved = runtimeCheckpoint.read().journey;
    const base = saved
      ? {
          ...saved,
          declaredMasteryRetentionTargetIds: new Set(
            saved.declaredMasteryRetentionTargetIds,
          ),
        }
      : current.current;
    const next = journeyReducer(base, action);
    runtimeCheckpoint.update({
      journey: {
        ...next,
        declaredMasteryRetentionTargetIds: [
          ...next.declaredMasteryRetentionTargetIds,
        ],
      },
    });
    runtimeCheckpoint.afterCommit(() => {
      current.current = next;
      setJourney(next);
    });
  }, []);
  return useMemo(
    () => ({ journey, dispatchJourney }),
    [journey, dispatchJourney],
  );
}
