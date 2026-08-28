import { useMemo, type ReactElement } from "react";
import { Icon } from "./icons";
import { Diagnostic, Sentence, UtilityHead } from "./primitives";
import { exampleCardsFromPackage } from "./assets";
import { effectiveMastery } from "../features/mastery/declaredMastery";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

/**
 * Browsing one Sense. This is not an Encounter: nothing here produces an
 * Attempt, Evidence or a Memory Outcome, and no media capability is issued, so
 * the screen says so instead of showing controls that cannot work.
 */
export function SenseScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const detail = state.detail;
  const item = detail?.item ?? null;
  const cards = useMemo(
    () => item === null ? [] : exampleCardsFromPackage(item.learningAssets),
    [item],
  );

  if (detail === null) return <></>;

  const mastered = state.snapshot !== null && effectiveMastery(state.snapshot, detail.senseId);
  const bridge = item?.learningAssets.find((asset) => asset.kind === "l1_bridge") ?? null;
  const sketch = item?.learningAssets.find((asset) => asset.kind === "experience_sketch") ?? null;
  const ipa = item === null
    ? null
    : state.snapshot?.meta.preferences.accent === "英式" ? item.lexeme.ipaUk : item.lexeme.ipaUs;

  return (
    <section className="screen utility-screen" aria-label="意思详情">
      <div className="safe-top" />
      <UtilityHead title={detail.member?.lemma ?? item?.lexeme.lemma ?? "意思详情"} onBack={actions.back} />
      <div className="utility-body">
        <div className="lexeme-head">
          <span className="eyebrow">意思详情 · 浏览不会计入学习</span>
          <h1>{item?.lexeme.lemma ?? detail.member?.lemma ?? ""}</h1>
          {ipa === null || ipa === undefined ? null : (
            <div className="pronunciation-row"><span className="ipa">{ipa}</span></div>
          )}
        </div>

        <section className="sense-focus">
          <span className="sense-label">这个意思</span>
          <h2>{item?.sense.guideLabelL1 ?? detail.member?.guideLabelL1 ?? ""}</h2>
        </section>

        {detail.error !== null ? (
          <Diagnostic title="内容暂时取不到">
            {detail.error}
          </Diagnostic>
        ) : item === null ? (
          <div className="card" style={{ padding: "26px", textAlign: "center", marginTop: "14px" }}>
            <p className="study-guide">正在取这个意思的学习内容…</p>
          </div>
        ) : (
          <>
            {item.sense.definitionL2 === "" ? null : (
              <article className="bridge-card">
                <b>英文释义</b>
                <p>{item.sense.definitionL2}</p>
              </article>
            )}

            {bridge === null || bridge.kind !== "l1_bridge" ? null : (
              <article className="bridge-card">
                <b>中文连接</b>
                <p>{bridge.body}</p>
              </article>
            )}

            {sketch === null || sketch.kind !== "experience_sketch" ? null : (
              <article className="bridge-card">
                <b>这个意思发生的场景</b>
                <p>{sketch.body}</p>
              </article>
            )}

            {cards.length === 0 ? null : (
              <button
                className="example-inline"
                type="button"
                onClick={() => actions.openExamples("sense", cards, 0)}
              >
                <b>{cards[0]!.source} · 共 {cards.length} 条</b>
                <p><Sentence example={cards[0]!.example} /></p>
                <small>{cards[0]!.example.textL1}</small>
                <span className="open-example"><Icon name="expand" /></span>
              </button>
            )}

            {item.usagePatterns.length === 0 ? null : (
              <>
                <div className="section-title"><h2>用法</h2><span>{item.usagePatterns.length} 个</span></div>
                <div className="card list-card">
                  {item.usagePatterns.map((pattern) => (
                    <div key={pattern.usagePatternId} className="content-row">
                      <span>
                        <strong>{pattern.canonicalPattern}</strong>
                        <span className="row-sub">
                          {pattern.commonCollocations.length === 0
                            ? (pattern.registerLabel ?? pattern.domainLabel ?? "常见结构")
                            : pattern.commonCollocations.join("、")}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: "16px" }}>
              <button
                className="secondary-button"
                type="button"
                disabled={state.busy}
                onClick={() => mastered
                  ? void actions.setMastery(detail.senseId, false, null)
                  : actions.openMasterySheet(detail.senseId)}
              >
                {mastered ? "恢复安排这个意思" : "标记这个意思已经会了"}
              </button>
            </div>
            <p className="plan-note">同一个单词的其他意思拥有独立进度。</p>
          </>
        )}
      </div>
    </section>
  );
}
