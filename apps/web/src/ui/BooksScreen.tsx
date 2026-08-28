import { useMemo, useState, type ReactElement } from "react";
import { Icon } from "./icons";
import { UtilityHead } from "./primitives";
import { masteredSenseIds, touchedSenseIds } from "../derive";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

const pageSize = 40;

/**
 * The Book list is drawn entirely from the manifest -- identity and labels, no
 * assets. A Book Version can hold hundreds of members, so the list grows on
 * demand rather than rendering every row, and a package is only fetched when a
 * row is actually opened.
 */
export function BooksScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const [visible, setVisible] = useState(pageSize);
  const snapshot = state.snapshot;
  const mastered = useMemo(
    () => snapshot === null ? new Set<string>() : masteredSenseIds(snapshot),
    [snapshot],
  );
  const touched = useMemo(
    () => snapshot === null ? new Set<string>() : touchedSenseIds(snapshot),
    [snapshot],
  );

  const query = state.bookQuery.trim().toLocaleLowerCase();
  const matches = useMemo(() => query === ""
    ? state.members
    : state.members.filter((member) =>
      `${member.lemma} ${member.guideLabelL1} ${member.partOfSpeech}`
        .toLocaleLowerCase()
        .includes(query)),
  [state.members, query]);

  const shown = matches.slice(0, visible);
  const learned = state.members.filter((member) => touched.has(member.senseId)).length;
  const percentage = state.members.length === 0
    ? 0
    : Math.round((learned / state.members.length) * 100);

  return (
    <section className="screen utility-screen" aria-label="词书">
      <div className="safe-top" />
      <UtilityHead title="在学词书" onBack={actions.back} />
      <div className="utility-body">
        <div className="book-hero card">
          <div className="book-cover">
            <b>SENSA</b>
            <span>Scenes<br />in use</span>
          </div>
          <div className="book-meta">
            <h2>{state.bookTitle === "" ? "还没有在学词书" : state.bookTitle}</h2>
            <p>按单词查看，每个意思分别学习、分别安排复习。</p>
            <div className="big-number">
              <strong>{state.bookSenseCount}</strong>
              <span>个意思<br />{state.bookLexemeCount} 个单词</span>
            </div>
          </div>
        </div>

        <div className="progress-track"><i style={{ width: `${percentage}%` }} /></div>
        <div className="progress-copy">
          <span>已开始 {learned} 个意思</span>
          <span>{percentage}%</span>
        </div>

        <div className="search-box">
          <Icon name="search" />
          <input
            aria-label="搜索单词或意思"
            placeholder="搜索单词或意思"
            value={state.bookQuery}
            onChange={(event) => {
              actions.setBookQuery(event.target.value);
              setVisible(pageSize);
            }}
          />
        </div>

        <div className="section-title">
          <h2>学习范围</h2>
          <span>{matches.length} 个意思</span>
        </div>

        <div className="card list-card">
          {shown.length === 0 ? (
            <div className="empty-state">
              <strong>没有找到匹配的意思</strong>
              <span>可以试试英文词形或中文意思。</span>
            </div>
          ) : (
            <>
              {shown.map((member) => (
                <button
                  key={member.senseId}
                  className="sense-row"
                  type="button"
                  onClick={() => void actions.openSense(member.senseId)}
                >
                  <span>
                    <strong>{member.lemma}</strong>
                    <span className="row-sub">{member.partOfSpeech} · {member.guideLabelL1}</span>
                  </span>
                  <em className={`badge${mastered.has(member.senseId) ? " mastered" : touched.has(member.senseId) ? "" : " quiet"}`}>
                    {mastered.has(member.senseId) ? "已会" : touched.has(member.senseId) ? "在学" : "未开始"}
                  </em>
                </button>
              ))}
              {visible < matches.length ? (
                <button
                  className="list-more"
                  type="button"
                  onClick={() => setVisible((count) => count + pageSize)}
                >
                  显示更多（还有 {matches.length - visible} 个）
                </button>
              ) : null}
            </>
          )}
        </div>

        <p className="plan-note">列表按单词聚合，但每一行的状态都绑定一个具体意思。</p>
      </div>
    </section>
  );
}
