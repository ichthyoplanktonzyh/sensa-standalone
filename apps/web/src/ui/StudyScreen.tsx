import type { ReactElement } from "react";
import type { MemoryOutcomeKind } from "@sensa/learning-kernel";
import { IconButton } from "./icons";
import { Diagnostic } from "./primitives";
import { useSensaAudio } from "./audio";
import { GroundingBind } from "./actions/GroundingBind";
import { BoundaryChoice } from "./actions/BoundaryChoice";
import { RetrievalRepair } from "./actions/RetrievalRepair";
import { TextRecall } from "./actions/TextRecall";
import type { ActionRendererProps, SensaAttemptVerdict } from "./actions/shared";
import type { SensaAppActions, SensaAppState } from "../useSensaApp";
import { todayCounts } from "../derive";
import { activePlan } from "../session";

const outcomeCopy: Readonly<Record<MemoryOutcomeKind, Readonly<{ title: string; body: string; tone: "good" | "support" }>>> = {
  introduced: { title: "连接建立好了", body: "这个意思已经进入你的复习安排，什么时候再出现由记忆状态决定。", tone: "good" },
  independent_retrieval: { title: "自己找回来了", body: "没有借助提示就取回了词形，间隔会相应拉长。", tone: "good" },
  supported_retrieval: { title: "借了一点力找回来了", body: "这次用到了提示，所以会更早再见到它。", tone: "support" },
  transfer_confirmed: { title: "换个场景也认得", body: "在新的语境里也能取回，这个意思已经比较稳。", tone: "good" },
  retrieval_failed: { title: "这次没有找回来", body: "没关系，系统保留了真实结果，会更快安排一次巩固。", tone: "support" },
};

/**
 * The study surface. Which renderer runs is decided by the Action's own kind --
 * the client never sequences the Encounter, never picks the next step, and
 * never falls back to a different renderer when one is unavailable.
 */
export function StudyScreen(props: Readonly<{
  state: SensaAppState;
  actions: SensaAppActions;
  verdict: SensaAttemptVerdict | null;
}>): ReactElement {
  const { state, actions } = props;
  const study = state.study;
  const target = study !== null && study.kind === "action" ? study.target : null;
  const audio = useSensaAudio(
    state.scope,
    target?.encounter.encounterId ?? null,
    target?.action.learningActionId ?? null,
  );
  const plan = state.snapshot === null ? null : activePlan(state.snapshot);
  const counts = state.snapshot === null ? null : todayCounts(state.snapshot, plan);
  const senseId = study === null
    ? null
    : study.kind === "action"
      ? study.target.encounter.senseId
      : study.kind === "rejected" || study.kind === "closed" ? study.senseId : null;

  const rendererProps: ActionRendererProps | null = target === null ? null : {
    target,
    audio,
    busy: state.busy,
    verdict: props.verdict !== null && props.verdict.actionId === target.action.learningActionId
      ? props.verdict
      : null,
    accent: state.snapshot?.meta.preferences.accent ?? "美式",
    pronunciationAutoplay: state.snapshot?.meta.preferences.pronunciationAutoplay ?? false,
    onRespond: (response) => void actions.respond(response),
    onOpenExamples: (assets, index) => actions.openExamples("study", assets, index),
  };

  return (
    <section className="screen study-screen" aria-label="学习">
      <div className="safe-top" />
      <div className="study-body">
        <header className="study-toolbar">
          <IconButton name="close" label="退出本次学习" onClick={() => void actions.exitStudy()} />
          <div className="study-progress">
            {counts === null ? "" : `${Math.min(counts.dailyTarget, counts.introducedToday + 1)} / ${counts.dailyTarget}`}
            <small>
              {target === null
                ? " "
                : target.encounter.kind === "introduction" ? "新学" : "复习"}
            </small>
          </div>
          <div className="study-tools">
            <button
              className="master-button"
              type="button"
              aria-label="标记这个意思已经会了"
              disabled={senseId === null || state.busy}
              onClick={() => senseId !== null && actions.openMasterySheet(senseId)}
            >
              熟
            </button>
            <IconButton
              name="more"
              label="更多学习操作"
              active={state.menuOpen}
              onClick={actions.toggleMenu}
            />
          </div>
        </header>

        {study === null || study.kind === "loading" ? (
          <div className="study-state">
            <div>
              <div className="spinner" />
              <p>正在安排下一个意思…</p>
            </div>
          </div>
        ) : study.kind === "rejected" ? (
          <div className="study-state">
            <div>
              <h2>这个意思暂时无法学习</h2>
              <p>它的学习内容没有通过完整性检查，所以不会用不完整的内容顶替。</p>
              <Diagnostic title="校验失败原因">
                <code>{study.reason}</code>
                <br />
                Sense <code>{study.senseId}</code>
              </Diagnostic>
              <div style={{ marginTop: "18px", display: "grid", gap: "9px" }}>
                <button
                  className="primary-button"
                  type="button"
                  disabled={state.busy}
                  onClick={() => void actions.exitStudy()}
                >
                  退出并返回首页
                </button>
              </div>
            </div>
          </div>
        ) : study.kind === "closed" ? (
          <ClosedEncounter
            outcomeKind={study.outcomeKind}
            lemma={study.item?.lexeme.lemma ?? ""}
            guide={study.item?.sense.guideLabelL1 ?? ""}
            busy={state.busy}
            onContinue={() => void actions.continueAfterEncounter()}
            onStop={() => actions.go("finish")}
          />
        ) : rendererProps === null ? null : (
          <ActionRenderer {...rendererProps} />
        )}

        {state.menuOpen ? (
          <div className="popover" role="menu">
            <button type="button" role="menuitem" onClick={() => actions.go("learning")}>学习偏好</button>
            <button type="button" role="menuitem" onClick={() => void actions.exitStudy()}>退出本次学习</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ActionRenderer(props: ActionRendererProps): ReactElement {
  const key = props.target.action.learningActionId;
  switch (props.target.view.payload.kind) {
    case "grounding_bind": return <GroundingBind key={key} {...props} />;
    case "boundary_discrimination": return <BoundaryChoice key={key} {...props} />;
    case "retrieval_repair": return <RetrievalRepair key={key} {...props} />;
    case "meaning_to_form_recall":
    case "cloze_recall": return <TextRecall key={key} {...props} />;
  }
}

function ClosedEncounter(props: Readonly<{
  outcomeKind: MemoryOutcomeKind | null;
  lemma: string;
  guide: string;
  busy: boolean;
  onContinue: () => void;
  onStop: () => void;
}>): ReactElement {
  const copy = props.outcomeKind === null ? null : outcomeCopy[props.outcomeKind];
  return (
    <>
      <main className="study-main">
        <div style={{ paddingTop: "48px", textAlign: "center" }}>
          <div className="finish-star">✦</div>
          <h1 className="study-title" style={{ textAlign: "center" }}>
            {copy?.title ?? "这个意思结束了"}
          </h1>
          <p className="study-guide" style={{ textAlign: "center" }}>
            {copy?.body ?? "这次的结果已经记录，下一次出现由记忆状态决定。"}
          </p>
          {props.lemma === "" ? null : (
            <div style={{ marginTop: "18px" }}>
              <span className={`outcome-badge ${copy?.tone ?? "good"}`}>
                {props.lemma} · {props.guide}
              </span>
            </div>
          )}
        </div>
      </main>
      <footer className="study-footer">
        <button className="primary-button" type="button" disabled={props.busy} onClick={props.onContinue}>
          继续下一个意思
        </button>
        <button className="secondary-button" type="button" disabled={props.busy} onClick={props.onStop}>
          今天先到这里
        </button>
      </footer>
    </>
  );
}
