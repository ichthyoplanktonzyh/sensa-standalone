import { useRef, type ReactElement } from "react";
import { IconButton } from "./icons";
import { Sentence } from "./primitives";
import { useSensaAudio } from "./audio";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";

const swipeThreshold = 48;

/** The full-screen example carousel, reachable from study and from browsing. */
export function ExampleScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
}>): ReactElement {
  const { state, actions } = props;
  const view = state.example;
  const target = state.study !== null && state.study.kind === "action" ? state.study.target : null;
  const audio = useSensaAudio(
    state.scope,
    target?.encounter.encounterId ?? null,
    target?.action.learningActionId ?? null,
  );
  const startX = useRef<number | null>(null);

  if (view === null) return <></>;
  const card = view.cards[view.index];
  if (card === undefined) return <></>;
  const example = card.example;
  const playable = view.origin === "study" && card.audioAssetId !== null;

  return (
    <section className="screen example-screen" aria-label="全屏例句卡">
      <div className="safe-top" />
      <div className="example-shell">
        <article
          className="example-card"
          role="group"
          aria-roledescription="例句轮播"
          aria-label={`第 ${view.index + 1} 条例句，共 ${view.cards.length} 条`}
          onPointerDown={(event) => { startX.current = event.clientX; }}
          onPointerUp={(event) => {
            const from = startX.current;
            startX.current = null;
            if (from === null) return;
            const delta = event.clientX - from;
            if (Math.abs(delta) < swipeThreshold) return;
            actions.moveExample(delta < 0 ? 1 : -1);
          }}
        >
          <div className="example-visual">
            <span className="example-source">{card.source} · {view.index + 1}/{view.cards.length}</span>
            <IconButton
              name="close"
              label="关闭例句卡"
              className="example-close"
              onClick={actions.closeExamples}
            />
            <div className="example-sentence">
              <p><Sentence example={example} /></p>
              {view.translationVisible ? <small>{example.textL1}</small> : null}
            </div>
            <div className="example-tools">
              <span className="example-source">{example.sceneDomain.replace("_", " · ")}</span>
              <div className="dots" aria-hidden="true">
                {view.cards.map((item, index) => (
                  <i key={item.example.learningAssetId} className={index === view.index ? "active" : ""} />
                ))}
              </div>
              {playable && card.audioAssetId !== null ? (
                <IconButton
                  name={audio.state.playingAssetId === card.audioAssetId ? "pause" : "volume"}
                  label={audio.state.playingAssetId === card.audioAssetId ? "暂停例句音频" : "播放例句音频"}
                  active={audio.state.playingAssetId === card.audioAssetId}
                  onClick={() => audio.play(card.audioAssetId!)}
                />
              ) : <span style={{ width: "42px" }} />}
            </div>
          </div>

          <div className="example-detail">
            {audio.state.error === null ? null : <p className="translation-copy">{audio.state.error}</p>}
            {view.translationVisible
              ? <p className="translation-copy">{example.textL1}</p>
              : (
                <button
                  className="translation-toggle"
                  type="button"
                  onClick={() => actions.toggleExampleDetail("translationVisible")}
                >
                  查看中文连接
                </button>
              )}
            {view.contextVisible && example.contextL2 !== null ? (
              <p className="context-copy">
                <b>完整上下文</b><br />
                {example.contextL2}
                {example.contextL1 === null ? null : <><br /><br />{example.contextL1}</>}
              </p>
            ) : null}
            {example.disambiguatingCue === null ? null : (
              <p className="example-meta">辨义线索：{example.disambiguatingCue}</p>
            )}
            {example.collocations.length === 0 ? null : (
              <p className="example-meta">常见搭配：{example.collocations.join("、")}</p>
            )}
            {view.origin === "sense" ? (
              <p className="example-meta">例句音频在学习过程中提供，浏览时不发放媒体授权。</p>
            ) : null}
            <div className="example-detail-actions">
              <button type="button" onClick={() => actions.toggleExampleDetail("translationVisible")}>
                {view.translationVisible ? "隐藏中文" : "显示中文"}
              </button>
              <button
                type="button"
                disabled={example.contextL2 === null}
                onClick={() => actions.toggleExampleDetail("contextVisible")}
              >
                {example.contextL2 === null
                  ? "没有上下文"
                  : view.contextVisible ? "收起上下文" : "查看上下文"}
              </button>
            </div>
          </div>
        </article>

        <div className="swipe-hint">向左滑下一条 · 向右滑上一条</div>
        <div className="example-bottom">
          <button type="button" disabled={view.index === 0} onClick={() => actions.moveExample(-1)}>
            上一例句
          </button>
          <button
            type="button"
            disabled={view.index === view.cards.length - 1}
            onClick={() => actions.moveExample(1)}
          >
            下一例句
          </button>
        </div>
        <div className="sr-only" aria-live="polite">
          当前是第 {view.index + 1} 条例句，共 {view.cards.length} 条
        </div>
      </div>
    </section>
  );
}
