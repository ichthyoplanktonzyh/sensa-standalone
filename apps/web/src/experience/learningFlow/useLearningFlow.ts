import { runtimeCheckpoint } from "../learningRuntime/runtimeCheckpoint";
/**
 * 学习流的状态机入口。App 只通过这里读写流程状态。
 *
 * 用 `useReducer` 而不是 store：这台状态机只服务学习流这一棵子树，
 * 没有跨屏共享的诉求，也不需要在组件之外被读到。放进全局 store 只会让
 * "谁能改它"的边界变模糊，而 reducer 把全部合法转移列在一处。
 */
import { useCallback, useMemo, useReducer } from "react";
import {
  INITIAL_FLOW_STATE,
  demoOf,
  flowReducer,
  type DemoPresentation,
  type FlowMode,
} from "./flowState";

export interface LearningFlow {
  /** 当前流程模式。读取点用它决定数据取自队列还是演示负载。 */
  readonly flowMode: FlowMode;
  /** demo 负载；非 demo 模式为 null。 */
  readonly demo: DemoPresentation | null;
  readonly enterLearn: () => void;
  readonly enterReview: () => void;
  readonly enterDemo: (demo: DemoPresentation) => void;
  /** 在演示内部推进；非 demo 模式下自动空操作。 */
  readonly advanceDemo: (patch: Partial<DemoPresentation>) => void;
}

export function useLearningFlow(): LearningFlow {
  const [state, dispatch] = useReducer(
    flowReducer,
    runtimeCheckpoint.read().structuredMode
      ? { mode: runtimeCheckpoint.read().structuredMode! }
      : INITIAL_FLOW_STATE,
  );

  const enterLearn = useCallback(() => {
    runtimeCheckpoint.update({ structuredMode: "learn" });
    runtimeCheckpoint.afterCommit(() => dispatch({ type: "enterLearn" }));
  }, []);
  const enterReview = useCallback(() => {
    runtimeCheckpoint.update({ structuredMode: "review" });
    runtimeCheckpoint.afterCommit(() => dispatch({ type: "enterReview" }));
  }, []);
  const enterDemo = useCallback(
    (demo: DemoPresentation) => dispatch({ type: "enterDemo", demo }),
    [],
  );
  const advanceDemo = useCallback(
    (patch: Partial<DemoPresentation>) =>
      dispatch({ type: "advanceDemo", patch }),
    [],
  );

  return useMemo(
    (): LearningFlow => ({
      flowMode: state.mode,
      demo: demoOf(state),
      enterLearn,
      enterReview,
      enterDemo,
      advanceDemo,
    }),
    [state, enterLearn, enterReview, enterDemo, advanceDemo],
  );
}
