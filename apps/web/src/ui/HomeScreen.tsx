import type { ReactElement } from "react";
import { Icon } from "./icons";
import { todayCounts } from "../derive";
import { activePlan } from "../session";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function HomeScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const snapshot = state.snapshot;
  const plan = snapshot === null ? null : activePlan(snapshot);
  const counts = snapshot === null ? null : todayCounts(snapshot, plan);
  const now = new Date();
  const dateLabel = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} · ${weekdayNames[now.getDay()]}`;
  const resumable = snapshot?.meta.currentAction ?? null;
  const initial = (state.me?.email ?? "你").slice(0, 1).toUpperCase();

  return (
    <section className="screen home-screen" aria-label="首页">
      <div className="safe-top" />
      <div className="home-body">
        <div className="home-brand">
          <button className="avatar" type="button" onClick={() => actions.go("profile")} aria-label="打开账号与数据">
            {initial}
          </button>
          <div className="brand-lockup">
            <strong>SENSA</strong>
            <small>语境学习</small>
          </div>
        </div>

        <p className="home-date">{dateLabel}</p>

        <div className="home-focus">
          <span className="spark">✦</span>
          <strong>今天，从一个意思开始</strong>
          <span>新学和复习由同一个计划安排</span>
        </div>

        <div className="home-copy">
          <h1>让词语回到它发生的地方</h1>
          <p>先经历，再揭示；先理解，再记住。</p>
        </div>

        <div className="home-spacer" />

        {resumable === null ? null : (
          <button className="home-resume" type="button" onClick={() => void actions.resumeLearning()}>
            <span>
              <b>继续上次没做完的意思</b>
              <span>这个 Encounter 还开着，会从当前这一步继续。</span>
            </span>
            <Icon name="arrow" />
          </button>
        )}

        <div className="today-summary" aria-label="今日学习摘要">
          <div className="summary-cell">
            <strong>{counts?.remainingNew ?? 0}</strong>
            <b>个新意思</b>
            <small>今天仍可学习</small>
          </div>
          <div className="summary-cell">
            <strong>{counts?.dueNow ?? 0}</strong>
            <b>个待复习</b>
            <small>按记忆再次出现</small>
          </div>
        </div>

        <button
          className="primary-button"
          type="button"
          disabled={state.busy || plan === null}
          onClick={() => void actions.startLearning()}
        >
          {plan === null ? "还没有学习计划" : "开始今天的学习"}
        </button>

        <p className="plan-note">
          {state.bookTitle === "" ? "等待学习计划" : state.bookTitle}
          {plan === null ? "" : ` · 每天 ${plan.dailyNewSenseTarget} 个新意思`}
        </p>

        <nav className="home-nav" aria-label="主要导航">
          <button type="button" onClick={() => actions.go("books")}>
            <Icon name="book" /><span>词书</span>
          </button>
          <button type="button" onClick={() => actions.go("content")}>
            <Icon name="layers" /><span>内容</span>
          </button>
          <button type="button" onClick={() => actions.go("learning")}>
            <Icon name="chart" /><span>学习</span>
          </button>
        </nav>
      </div>
    </section>
  );
}
