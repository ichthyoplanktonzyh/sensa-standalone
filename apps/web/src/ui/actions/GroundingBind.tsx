import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "../icons";
import { AudioPill, Sentence } from "../primitives";
import { bodyOf, exampleCardsFromAction, firstByRole, pairExamplesWithAudio } from "../assets";
import { acknowledgement, type ActionRendererProps } from "./shared";

/**
 * One `grounding_bind` Action, shown as two pages.
 *
 * The split is presentation only: the server emits a single Action and expects
 * a single acknowledgement, so the second page is where the Attempt is made.
 * The first page may show nothing but the experience sketch -- the Action's own
 * validator rejects a sketch that leaks the word form, and revealing the form,
 * the L1 bridge or the examples early would defeat the same rule from this side.
 */
export function GroundingBind(props: ActionRendererProps): ReactElement {
  const { target, audio } = props;
  const [revealed, setRevealed] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const assets = target.view.assets;
  const experience = bodyOf(firstByRole(assets, "experience_sketch")) ?? "";
  const bridge = bodyOf(firstByRole(assets, "l1_bridge")) ?? "";
  const pronunciation = firstByRole(assets, "pronunciation");
  const pairs = pairExamplesWithAudio(assets);
  const cards = exampleCardsFromAction(assets);
  const lead = cards[0] ?? null;
  const ipa = props.accent === "美式" ? target.item.lexeme.ipaUs : target.item.lexeme.ipaUk;

  useEffect(() => {
    if (!revealed || !props.pronunciationAutoplay || pronunciation === null) return;
    audio.play(pronunciation.asset.learningAssetId);
    // Autoplay is a one-shot on reveal; re-running it on every audio state
    // change would restart the clip whenever playback ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  if (!revealed) {
    return (
      <>
        <main className="study-main">
          <span className="eyebrow">先经历，再揭示</span>
          <h1 className="study-title">先回到这个场景</h1>
          <p className="study-guide">暂时不要找英文词，只感受这段经历里最重要的共同点。</p>
          <article className="scene-card">
            <div className="scene-art" aria-hidden="true" />
            <p>{experience}</p>
            <small>这个阶段不会显示词形、中文连接、目标例句或发音。</small>
          </article>
        </main>
        <footer className="study-footer">
          <button className="primary-button" type="button" onClick={() => setRevealed(true)}>
            把场景和词连起来
          </button>
        </footer>
      </>
    );
  }

  return (
    <>
      <main className="study-main">
        <div className="lexeme-head">
          <span className="eyebrow">这个意思的英文形式</span>
          <h1>{target.item.lexeme.lemma}</h1>
          <div className="pronunciation-row">
            {pronunciation === null ? null : (
              <AudioPill
                label={props.accent}
                playing={audio.state.playingAssetId === pronunciation.asset.learningAssetId}
                loading={audio.state.loadingAssetId === pronunciation.asset.learningAssetId}
                onClick={() => audio.play(pronunciation.asset.learningAssetId)}
              />
            )}
            {ipa === null ? null : <span className="ipa">{ipa}</span>}
          </div>
        </div>

        <section className="sense-focus">
          <span className="sense-label">当前学习的意思</span>
          <h2>{target.item.sense.guideLabelL1}</h2>
        </section>

        <article className="bridge-card">
          <b>中文连接</b>
          <p>{bridge}</p>
        </article>

        {lead === null ? null : (
          <button
            className="example-inline"
            type="button"
            onClick={() => props.onOpenExamples(cards, 0)}
          >
            <b>在动作里的用法 · 共 {cards.length} 条</b>
            <p><Sentence example={lead.example} /></p>
            <small>{lead.example.textL1}</small>
            <span className="open-example"><Icon name="expand" /></span>
          </button>
        )}

        <div className="audio-row">
          {pairs.map((pair, index) => {
            const clip = pair.audio;
            return clip === null ? null : (
              <AudioPill
                key={clip.asset.learningAssetId}
                label={`例句 ${index + 1}`}
                playing={audio.state.playingAssetId === clip.asset.learningAssetId}
                loading={audio.state.loadingAssetId === clip.asset.learningAssetId}
                onClick={() => audio.play(clip.asset.learningAssetId)}
              />
            );
          })}
        </div>

        <div className="scene-recall">
          <button type="button" onClick={() => setSceneOpen((open) => !open)}>
            <span>回看刚才的场景</span>
            <Icon name="chevron" />
          </button>
          {sceneOpen ? <p>{experience}</p> : null}
        </div>

        <p className={`audio-note${audio.state.error === null ? "" : " error"}`}>
          {audio.state.error ?? "发音与例句音频来自当前学习包的已审核资产"}
        </p>
      </main>
      <footer className="study-footer">
        <button
          className="primary-button"
          type="button"
          disabled={props.busy}
          onClick={() => props.onRespond(acknowledgement)}
        >
          我记住了这个连接
        </button>
      </footer>
    </>
  );
}
