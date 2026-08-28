import { useState, type ReactElement } from "react";
import { boundaryOf, firstByRole } from "../assets";
import type { ActionRendererProps } from "./shared";

/**
 * A `boundary_discrimination` Action. The two choices, their order and their
 * texts are all frozen in the Action payload; correctness is the server's
 * answer, so nothing here compares the choice against the Package. The verdict
 * banner only appears once that answer has come back.
 */
export function BoundaryChoice(props: ActionRendererProps): ReactElement {
  const { target } = props;
  const [chosen, setChosen] = useState<"choice_a" | "choice_b" | null>(null);
  const payload = target.view.payload;
  if (payload.kind !== "boundary_discrimination") return <></>;
  const contrast = boundaryOf(firstByRole(target.view.assets, "boundary"));
  const verdict = props.verdict;

  return (
    <>
      <main className="study-main">
        <span className="eyebrow">分清相近的意思</span>
        <h1 className="study-title">哪一句表达“{target.item.sense.guideLabelL1}”？</h1>
        <p className="study-guide">选择与当前意思最接近的一句。</p>
        <div className="choice-list" role="radiogroup" aria-label="边界辨析选项">
          {payload.choices.map((choice, index) => (
            <button
              key={choice.choiceId}
              type="button"
              role="radio"
              aria-checked={chosen === choice.choiceId}
              className={`choice-button${chosen === choice.choiceId ? " selected" : ""}`}
              disabled={props.busy || verdict !== null}
              onClick={() => setChosen(choice.choiceId)}
            >
              <strong>{index === 0 ? "A" : "B"}</strong>
              <span>{choice.text}</span>
            </button>
          ))}
        </div>
        {verdict === null ? null : (
          <div className={`feedback ${verdict.isCorrect === true ? "good" : "bad"}`}>
            <b>{verdict.isCorrect === true ? "分清了" : "这里容易混"}</b>
            {contrast === null ? null : contrast.distinguishingFeature}
          </div>
        )}
      </main>
      <footer className="study-footer">
        <button
          className="primary-button"
          type="button"
          disabled={chosen === null || props.busy || verdict !== null}
          onClick={() => {
            if (chosen === null) return;
            props.onRespond({ kind: "single_choice", choiceId: chosen });
          }}
        >
          确认
        </button>
      </footer>
    </>
  );
}
