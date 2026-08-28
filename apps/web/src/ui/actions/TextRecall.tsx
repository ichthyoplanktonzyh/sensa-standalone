import { useState, type ReactElement } from "react";
import { bodyOf, exampleOf, firstByRole } from "../assets";
import { maskedSentence } from "../primitives";
import type { ActionRendererProps } from "./shared";

/**
 * The two retrieval Actions that take a typed answer.
 *
 * Neither may show the word form: `meaning_to_form_recall` carries only the
 * experience sketch, and `cloze_recall` carries only the masked quiz example --
 * both checked for leaks before they get here. Giving up submits an empty
 * answer rather than skipping, because a failed retrieval is a real fact the
 * scheduler is entitled to, and silently skipping would falsify the record.
 */
export function TextRecall(props: ActionRendererProps): ReactElement {
  const { target } = props;
  const [answer, setAnswer] = useState("");
  const payload = target.view.payload;
  const verdict = props.verdict;
  const locked = props.busy || verdict !== null;

  if (payload.kind !== "meaning_to_form_recall" && payload.kind !== "cloze_recall") return <></>;

  const submit = (value: string): void => {
    if (locked) return;
    props.onRespond({ kind: "text_input", answer: value });
  };

  const cue = payload.kind === "meaning_to_form_recall"
    ? bodyOf(firstByRole(target.view.assets, "experience_sketch"))
    : null;
  const quiz = payload.kind === "cloze_recall"
    ? exampleOf(firstByRole(target.view.assets, "quiz_example"))
    : null;

  return (
    <>
      <main className="study-main">
        <span className="eyebrow">{payload.kind === "cloze_recall" ? "放进一个新场景" : "把意思变回词形"}</span>
        <h1 className="study-title">把这个意思找回来</h1>
        <p className="study-guide">
          {payload.kind === "cloze_recall"
            ? "输入最自然的英文词形，拼写不必完全一致的变化形式也可以。"
            : payload.prompt}
        </p>

        {cue === null ? null : (
          <article className="scene-card">
            <div className="scene-art" aria-hidden="true" />
            <p>{cue}</p>
            <small>这段场景就是要找回的那个意思。</small>
          </article>
        )}

        {quiz === null ? null : (
          <article className="cloze-card">
            <p>{maskedSentence(payload.kind === "cloze_recall" ? payload.maskedText : "")}</p>
            <small>{quiz.textL1}</small>
          </article>
        )}

        <form
          className="answer-row"
          onSubmit={(event) => {
            event.preventDefault();
            submit(answer);
          }}
        >
          <input
            aria-label="输入英文词"
            placeholder="输入英文词"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={answer}
            disabled={locked}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <button type="submit" disabled={locked || answer.trim() === ""}>确认</button>
        </form>

        {verdict === null ? null : (
          <div className={`feedback ${verdict.isCorrect === true ? "good" : "bad"}`}>
            <b>{verdict.isCorrect === true ? `找回来了：${target.item.lexeme.lemma}` : "这次没有找回来"}</b>
            {verdict.isCorrect === true
              ? `词形和“${target.item.sense.guideLabelL1}”重新连在了一起。`
              : "接下来会换一种方式再连一次。"}
          </div>
        )}
      </main>
      <footer className="study-footer">
        <button
          className="secondary-button"
          type="button"
          disabled={locked}
          onClick={() => submit("")}
        >
          不会，回到连接
        </button>
      </footer>
    </>
  );
}
