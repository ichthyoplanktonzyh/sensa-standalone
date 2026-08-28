import { useMemo, type ReactElement } from "react";
import { Icon } from "./icons";
import { SettingRow, Switch, UtilityHead } from "./primitives";
import {
  blockedOutbox,
  currentWeek,
  describeOperation,
  masteredSenseIds,
  outboxHealth,
  studyStreak,
  todayCounts,
  touchedSenseIds,
} from "../derive";
import { activePlan } from "../session";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

const weekHeads = ["一", "二", "三", "四", "五", "六", "日"] as const;
const pacingOptions = [5, 10, 15, 20, 30] as const;

function labelFor(
  state: SensaAppState,
  senseId: string,
): Readonly<{ lemma: string; guide: string }> {
  const member = state.members.find((item) => item.senseId === senseId);
  return {
    lemma: member?.lemma ?? senseId.slice(0, 8),
    guide: member?.guideLabelL1 ?? "这个意思",
  };
}

/** "My content": what this learner has actually touched, declared or is owed. */
export function ContentScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const snapshot = state.snapshot;
  const mastered = useMemo(
    () => snapshot === null ? new Set<string>() : masteredSenseIds(snapshot),
    [snapshot],
  );
  const touched = useMemo(
    () => snapshot === null ? new Set<string>() : touchedSenseIds(snapshot),
    [snapshot],
  );
  const recent = useMemo(() => snapshot === null ? [] : snapshot.encounters
    .filter((encounter) => encounter.status === "completed")
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .reduce<string[]>((senses, encounter) => {
      if (!senses.includes(encounter.senseId) && senses.length < 12) senses.push(encounter.senseId);
      return senses;
    }, []),
  [snapshot]);
  const due = useMemo(() => {
    if (snapshot === null) return [];
    const now = Date.now();
    return snapshot.memoryStates
      .filter((state) => state.dueAt !== null && Date.parse(state.dueAt) <= now && !mastered.has(state.senseId))
      .sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? ""))
      .slice(0, 20);
  }, [snapshot, mastered]);
  const masteredList = [...mastered];

  return (
    <section className="screen utility-screen" aria-label="我的内容">
      <div className="safe-top" />
      <UtilityHead title="我的内容" onBack={actions.back} />
      <div className="utility-body">
        <div className="content-grid">
          <div className="metric-card card">
            <strong>{recent.length}</strong>
            <b>最近学过</b>
            <small>按具体意思记录</small>
          </div>
          <div className="metric-card card">
            <strong>{touched.size}</strong>
            <b>全部已开始</b>
            <small>不等于全部稳定</small>
          </div>
        </div>

        <div className="section-title"><h2>最近学过</h2><span>{recent.length} 个</span></div>
        <div className="card list-card">
          {recent.length === 0 ? (
            <div className="empty-state">
              <strong>还没有学习记录</strong>
              <span>完成第一个意思后会出现在这里。</span>
            </div>
          ) : recent.map((senseId) => {
            const label = labelFor(state, senseId);
            return (
              <button
                key={senseId}
                className="content-row tappable"
                type="button"
                onClick={() => void actions.openSense(senseId)}
              >
                <span>
                  <strong>{label.lemma}</strong>
                  <span className="row-sub">{label.guide}</span>
                </span>
                <Icon name="arrow" />
              </button>
            );
          })}
        </div>

        <div className="section-title"><h2>已会的意思</h2><span>{masteredList.length} 个</span></div>
        <div className="card list-card">
          {masteredList.length === 0 ? (
            <div className="empty-state">
              <strong>还没有标记为已会的意思</strong>
              <span>学习时点击“熟”，会出现在这里。</span>
            </div>
          ) : masteredList.map((senseId) => {
            const label = labelFor(state, senseId);
            return (
              <div key={senseId} className="content-row">
                <span>
                  <strong>{label.lemma}</strong>
                  <span className="row-sub">{label.guide} · 不再安排</span>
                </span>
                <button
                  className="badge mastered"
                  type="button"
                  disabled={state.busy}
                  onClick={() => void actions.setMastery(senseId, false, null)}
                >
                  恢复安排
                </button>
              </div>
            );
          })}
        </div>

        <div className="section-title"><h2>已经到期</h2><span>{due.length} 个</span></div>
        <div className="card list-card">
          {due.length === 0 ? (
            <div className="empty-state">
              <strong>目前没有到期的复习</strong>
              <span>什么时候再出现，由记忆状态决定。</span>
            </div>
          ) : due.map((memory) => {
            const label = labelFor(state, memory.senseId);
            return (
              <button
                key={memory.senseMemoryStateId}
                className="content-row tappable"
                type="button"
                onClick={() => void actions.openSense(memory.senseId)}
              >
                <span>
                  <strong>{label.lemma}</strong>
                  <span className="row-sub">{label.guide} · 复习 {memory.reps} 次 · 遗忘 {memory.lapses} 次</span>
                </span>
                <Icon name="arrow" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function LearningScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const snapshot = state.snapshot;
  const plan = snapshot === null ? null : activePlan(snapshot);
  const counts = snapshot === null ? null : todayCounts(snapshot, plan);
  const week = snapshot === null ? [] : currentWeek(snapshot);
  const streak = snapshot === null ? 0 : studyStreak(snapshot);
  const touched = snapshot === null ? new Set<string>() : touchedSenseIds(snapshot);
  const preferences = snapshot?.meta.preferences ?? null;
  const showPlan = state.learningTab === "plan";

  return (
    <section className="screen utility-screen" aria-label="我的学习">
      <div className="safe-top" />
      <UtilityHead title="我的学习" onBack={actions.back} />
      <div className="utility-body">
        <div className="tabs">
          <button
            className={showPlan ? "active" : ""}
            type="button"
            onClick={() => actions.setLearningTab("plan")}
          >
            我的学习
          </button>
          <button
            className={showPlan ? "" : "active"}
            type="button"
            onClick={() => actions.setLearningTab("preferences")}
          >
            学习偏好
          </button>
        </div>

        {showPlan ? (
          <>
            <div className="plan-card card">
              <small>ACTIVE PLAN</small>
              <h2>{state.bookTitle === "" ? "还没有在学词书" : state.bookTitle}</h2>
              <p>统一安排新意思与到期复习。</p>
              <div className="plan-stats">
                <div><b>{counts?.dailyTarget ?? 0}</b><span>每日新学</span></div>
                <div><b>{touched.size}</b><span>已开始意思</span></div>
                <div><b>{counts?.dueNow ?? 0}</b><span>待复习</span></div>
              </div>
            </div>
            <div className="calendar card">
              <div className="section-title" style={{ marginTop: 0 }}>
                <h2>本周</h2>
                <span>{streak === 0 ? "今天还没开始" : `连续学习 ${streak} 天`}</span>
              </div>
              <div className="week">{weekHeads.map((day) => <span key={day}>{day}</span>)}</div>
              <div className="week">
                {week.map((day) => (
                  <b key={day.date} className={day.isToday ? "today" : day.studied ? "studied" : ""}>
                    {day.dayOfMonth}
                  </b>
                ))}
              </div>
            </div>
            <p className="plan-note">
              今天已完成 {counts?.completedToday ?? 0} 个意思，其中新学 {counts?.introducedToday ?? 0} 个。
            </p>
          </>
        ) : preferences === null ? null : (
          <>
            <div className="card list-card">
              <SettingRow
                label="单词发音"
                value={preferences.accent}
                onClick={() => void actions.savePreferences({
                  ...preferences,
                  accent: preferences.accent === "美式" ? "英式" : "美式",
                })}
              />
              <SettingRow
                label="揭示后自动发音"
                value={<Switch on={preferences.pronunciationAutoplay} />}
                onClick={() => void actions.savePreferences({
                  ...preferences,
                  pronunciationAutoplay: !preferences.pronunciationAutoplay,
                })}
              />
              <SettingRow
                label="例句卡自动播放"
                value={<Switch on={preferences.exampleAutoplay} />}
                onClick={() => void actions.savePreferences({
                  ...preferences,
                  exampleAutoplay: !preferences.exampleAutoplay,
                })}
              />
              <SettingRow
                label="例句卡默认显示中文"
                value={<Switch on={preferences.translationDefault} />}
                onClick={() => void actions.savePreferences({
                  ...preferences,
                  translationDefault: !preferences.translationDefault,
                })}
              />
            </div>

            <div className="section-title"><h2>每日新学意思</h2><span>影响计划安排</span></div>
            <div className="card list-card">
              {pacingOptions.map((option) => (
                <SettingRow
                  key={option}
                  label={`${option} 个`}
                  value={plan?.dailyNewSenseTarget === option ? <Icon name="check" /> : ""}
                  disabled={state.busy || plan === null}
                  onClick={() => void actions.setDailyTarget(option)}
                />
              ))}
            </div>
            <p className="plan-note">改动会作为一次同步操作提交，服务端接受后才生效。</p>
          </>
        )}
      </div>
    </section>
  );
}

export function ProfileScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const snapshot = state.snapshot;
  const health = snapshot === null ? null : outboxHealth(snapshot);
  const blocked = snapshot === null ? [] : blockedOutbox(snapshot);
  const lastSyncAt = snapshot?.meta.lastSyncAt ?? null;
  const initial = (state.me?.email ?? "你").slice(0, 1).toUpperCase();

  return (
    <section className="screen utility-screen" aria-label="账号与数据">
      <div className="safe-top" />
      <UtilityHead title="账号与数据" onBack={actions.back} />
      <div className="utility-body">
        <div className="profile-hero">
          <div className="profile-avatar">{initial}</div>
          <h2>Sensa 学习者</h2>
          <p>{state.me?.email ?? state.me?.learnerUserId ?? ""}</p>
        </div>

        <div className="card list-card">
          <SettingRow
            label="立即同步"
            value={lastSyncAt === null ? "尚未同步" : new Date(lastSyncAt).toLocaleString()}
            disabled={state.busy}
            onClick={() => void actions.runSync()}
          />
          <SettingRow
            label="等待上传的记录"
            value={health === null ? "" : `${health.pending} 条`}
          />
          <SettingRow
            label="需要处理的记录"
            value={health === null ? "" : `${health.blocked + health.unreadable} 条`}
          />
        </div>

        {blocked.length === 0 && (snapshot?.invalidOutbox.length ?? 0) === 0 ? null : (
          <>
            <div className="section-title">
              <h2>需要处理的记录</h2>
              <span>{blocked.length + (snapshot?.invalidOutbox.length ?? 0)} 条</span>
            </div>
            <div className="card list-card">
              {blocked.map((record) => (
                <div key={record.operationId} className="content-row">
                  <span>
                    <strong>{describeOperation(record)}</strong>
                    <span className="row-sub">
                      {new Date(record.occurredAt).toLocaleString()}
                      {record.error === null ? "" : ` · ${record.error.message}`}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="badge"
                      type="button"
                      disabled={state.busy}
                      onClick={() => void actions.retryBlocked(record.operationId)}
                    >
                      重试
                    </button>
                    <button
                      className="badge quiet"
                      type="button"
                      disabled={state.busy}
                      onClick={() => void actions.discardBlocked(record.operationId)}
                    >
                      丢弃
                    </button>
                  </span>
                </div>
              ))}
              {(snapshot?.invalidOutbox ?? []).map((record, index) => (
                <div key={record.operationId ?? `unreadable-${index}`} className="content-row">
                  <span>
                    <strong>无法读取的记录</strong>
                    <span className="row-sub">{record.reason}</span>
                  </span>
                  <em className="badge quiet">已保留</em>
                </div>
              ))}
            </div>
            <p className="plan-note">
              这些是你做过、但服务端还没有接受的操作。原样保留，重试或丢弃由你决定。
            </p>
          </>
        )}

        <div className="section-title"><h2>本机数据</h2><span>只影响这台设备</span></div>
        <div className="card list-card">
          <SettingRow
            label="清空本机数据并重新同步"
            value={<Icon name="refresh" />}
            disabled={state.busy}
            onClick={() => void actions.resetLocalData()}
          />
        </div>
        <p className="plan-note">
          清空会丢弃尚未上传的作答。服务端已接受的学习记录不受影响。
        </p>

        <div className="section-title"><h2>运行信息</h2><span>用于排查问题</span></div>
        <div className="card list-card">
          <SettingRow label="学习范围" value={state.scope?.workspaceId.slice(0, 8) ?? ""} />
          <SettingRow label="本机副本" value={state.scope?.replicaId.slice(0, 8) ?? ""} />
          <SettingRow label="界面语言" value={state.me?.locale ?? ""} />
        </div>
      </div>
    </section>
  );
}
