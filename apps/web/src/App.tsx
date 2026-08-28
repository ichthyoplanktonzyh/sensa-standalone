import type { ReactElement } from "react";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/utility.css";
import "./styles/study.css";
import "./styles/example.css";
import { useSensaApp } from "./useSensaApp";
import { BusyVeil, Toast } from "./ui/primitives";
import { HomeScreen } from "./ui/HomeScreen";
import { BooksScreen } from "./ui/BooksScreen";
import { ContentScreen, LearningScreen, ProfileScreen } from "./ui/LibraryScreens";
import { StudyScreen } from "./ui/StudyScreen";
import { SenseScreen } from "./ui/SenseScreen";
import { ExampleScreen } from "./ui/ExampleScreen";
import { FinishScreen } from "./ui/FinishScreen";

export function App(): ReactElement {
  const { state, actions } = useSensaApp();

  if (state.phase !== "ready") {
    return (
      <div className="app-shell">
        <div className="app-frame">
          <div className="boot">
            <div>
              {state.phase === "loading" ? (
                <>
                  <div className="spinner" />
                  <h1>正在准备你的学习范围</h1>
                  <p>正在同步学习记录，并取回在学词书的索引。</p>
                </>
              ) : (
                <>
                  <h1>暂时打不开</h1>
                  <p>{state.fatal}</p>
                  <button className="secondary-button" type="button" onClick={() => void actions.reload()}>
                    重试
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <Surface />
        {state.sheet === null ? null : (
          <>
            <button
              className="scrim"
              type="button"
              aria-label="取消"
              onClick={actions.closeSheet}
            />
            <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
              <div className="sheet-handle" />
              <h2 id="sheet-title">这个意思你已经会了吗？</h2>
              <span className="target">{state.sheet.lemma} · {state.sheet.guide}</span>
              <p>
                标记后，不再安排这个意思的新学或复习。{state.sheet.lemma} 的其他意思不受影响，
                之后可以在“我的内容”里恢复。
                {state.sheet.encounter === null
                  ? ""
                  : "当前这次学习会被取消，不产生作答、证据或记忆结果。"}
              </p>
              <div className="sheet-actions">
                <button className="cancel" type="button" onClick={actions.closeSheet}>取消</button>
                <button
                  className="confirm"
                  type="button"
                  autoFocus
                  disabled={state.busy}
                  onClick={() => {
                    const sheet = state.sheet;
                    if (sheet === null) return;
                    void actions.setMastery(sheet.senseId, true, sheet.encounter);
                  }}
                >
                  标记为已会
                </button>
              </div>
            </section>
          </>
        )}
        {state.toast === null ? null : <Toast text={state.toast} />}
        {state.busy && state.surface !== "study" ? <BusyVeil /> : null}
      </div>
    </div>
  );

  function Surface(): ReactElement {
    switch (state.surface) {
      case "home": return <HomeScreen state={state} actions={actions} />;
      case "books": return <BooksScreen state={state} actions={actions} />;
      case "content": return <ContentScreen state={state} actions={actions} />;
      case "learning": return <LearningScreen state={state} actions={actions} />;
      case "profile": return <ProfileScreen state={state} actions={actions} />;
      case "study": return <StudyScreen state={state} actions={actions} verdict={state.verdict} />;
      case "example": return <ExampleScreen state={state} actions={actions} />;
      case "sense": return <SenseScreen state={state} actions={actions} />;
      case "finish": return <FinishScreen state={state} actions={actions} />;
    }
  }
}
