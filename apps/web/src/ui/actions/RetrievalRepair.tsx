import type { ReactElement } from "react";
import { Icon } from "../icons";
import { AudioPill, Sentence } from "../primitives";
import { bodyOf, exampleCardsFromAction, firstByRole } from "../assets";
import { acknowledgement, type ActionRendererProps } from "./shared";

/**
 * A `retrieval_repair` Action: the sense is rebuilt before the learner is asked
 * to retrieve it again. It carries exactly four assets, and showing the word
 * form here is deliberate -- repair is support, not a test.
 */
export function RetrievalRepair(props: ActionRendererProps): ReactElement {
  const { target, audio } = props;
  const assets = target.view.assets;
  const experience = bodyOf(firstByRole(assets, "experience_sketch")) ?? "";
  const bridge = bodyOf(firstByRole(assets, "l1_bridge")) ?? "";
  const cards = exampleCardsFromAction(assets);
  const lead = cards[0] ?? null;
  const exampleAudio = firstByRole(assets, "study_example_audio");

  return (
    <>
      <main className="study-main">
        <span className="eyebrow">换一种方式，再建立一次连接</span>
        <h1 className="study-title">先把场景重新放回心里</h1>
        <p className="study-guide">这次没有对错，只是把“{target.item.sense.guideLabelL1}”重新连回 {target.item.lexeme.lemma}。</p>

        <article className="repair-card">
          <b>刚才的场景</b>
          <p>{experience}</p>
        </article>

        <article className="bridge-card">
          <b>关键区别</b>
          <p>{bridge}</p>
        </article>

        {lead === null ? null : (
          <button
            className="example-inline"
            type="button"
            onClick={() => props.onOpenExamples(cards, 0)}
          >
            <b>再看一个动作里的用法</b>
            <p><Sentence example={lead.example} /></p>
            <small>{lead.example.textL1}</small>
            <span className="open-example"><Icon name="expand" /></span>
          </button>
        )}

        {exampleAudio === null ? null : (
          <div className="audio-row">
            <AudioPill
              label="听这句"
              playing={audio.state.playingAssetId === exampleAudio.asset.learningAssetId}
              loading={audio.state.loadingAssetId === exampleAudio.asset.learningAssetId}
              onClick={() => audio.play(exampleAudio.asset.learningAssetId)}
            />
          </div>
        )}

        {audio.state.error === null ? null : <p className="audio-note error">{audio.state.error}</p>}
      </main>
      <footer className="study-footer">
        <button
          className="primary-button"
          type="button"
          disabled={props.busy}
          onClick={() => props.onRespond(acknowledgement)}
        >
          我准备好了，再试一次
        </button>
      </footer>
    </>
  );
}
