import type { ReactElement } from "react";
import { masteredSenseIds, todayCounts } from "../derive";
import { activePlan } from "../session";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

export function FinishScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const snapshot = state.snapshot;
  const plan = snapshot === null ? null : activePlan(snapshot);
  const counts = snapshot === null ? null : todayCounts(snapshot, plan);
  const mastered = snapshot === null ? 0 : masteredSenseIds(snapshot).size;
  const finish = state.finish;
  const canContinue = plan !== null && (counts?.remainingNew ?? 0) + (counts?.dueNow ?? 0) > 0;

  return (
    <section className="screen finish-screen" aria-label="本次学习结束">
      <div className="safe-top" />
      <div className="finish-body">
        <div className="finish-star">✦</div>
        <h1>{(state.completedThisRun > 0) ? "今天的连接建立好了" : "这次没有新的安排"}</h1>
        <p>
          {finish?.detail ?? "什么时候再出现，由你的记忆状态决定。你不需要管理算法。"}
        </p>

        <div className="finish-stats">
          <div>
            <strong>{state.completedThisRun}</strong>
            <span>本次完成</span>
          </div>
          <div>
            <strong>{counts?.completedToday ?? 0}</strong>
            <span>今天完成</span>
          </div>
          <div>
            <strong>{mastered}</strong>
            <span>标记已会</span>
          </div>
        </div>

        <div className="finish-actions">
          <button className="primary-button" type="button" onClick={() => actions.go("home")}>
            回到首页
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={state.busy || !canContinue}
            onClick={() => void actions.startLearning()}
          >
            {canContinue ? "继续学习" : "今天已经排完了"}
          </button>
        </div>
      </div>
    </section>
  );
}
