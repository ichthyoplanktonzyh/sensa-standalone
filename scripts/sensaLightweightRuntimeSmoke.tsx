import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  initialReviewState,
  transitionReview,
  type ReviewAction,
} from "../apps/web/src/experience/learningRuntime/lightweightReviewState";
import i18n from "../apps/web/src/i18n";
import { runtimeZh, runtimeEn } from "../apps/web/src/i18n/runtime";
import { ExperienceRecallCard } from "../apps/web/src/experience/components/cards/lightweight/ExperienceRecallCard";
import { ExpressionRevealCard } from "../apps/web/src/experience/components/cards/lightweight/ExpressionRevealCard";
import { LightweightReviewRuntimeScreen } from "../apps/web/src/experience/components/learning/LightweightReviewRuntimeScreen";
import type {
  ExperienceRecallCardPresentation,
  ExpressionRevealCardPresentation,
} from "../apps/web/src/experience/learningRuntime/lightweightInitialPresentation";

async function main() {
  let state = initialReviewState(),
    ratings = 0,
    repairs = 0;
  const dispatch = (action: ReviewAction) => {
    const next = transitionReview(state, action, ["a", "b"]);
    state = next.state;
    if (next.rating) ratings++;
    if (next.repaired) repairs++;
  };
  dispatch({ type: "rate", rating: "good" });
  assert.equal(ratings, 0, "cannot rate before reveal");
  dispatch({ type: "reveal" });
  dispatch({ type: "rate", rating: "again" });
  dispatch({ type: "rate", rating: "again" });
  assert.equal(ratings, 1, "rapid repeated rating is ignored");
  assert.equal(state.phase, "repair");
  for (let i = 0; i < 2; i++) {
    dispatch({ type: "retry" });
    dispatch({ type: "reveal" });
    dispatch({ type: "repairResult", restored: false });
  }
  assert.equal(ratings, 1, "repair retries never issue another due outcome");
  dispatch({ type: "retry" });
  dispatch({ type: "reveal" });
  dispatch({ type: "repairResult", restored: true });
  dispatch({ type: "repairResult", restored: true });
  assert.equal(repairs, 1);
  assert.equal(state.index, 1);
  assert.equal(state.results.length, 1);
  dispatch({ type: "reveal" });
  dispatch({ type: "rate", rating: "hard" });
  dispatch({ type: "rate", rating: "good" });
  assert.equal(state.phase, "summary");
  assert.equal(ratings, 2);
  assert.deepEqual(
    state.results.map((r) => r.rating),
    ["again", "hard"],
  );
  assert.equal(
    transitionReview(initialReviewState(), { type: "reveal" }, []).state.phase,
    "recall",
  );
  const flatten = (
    o: Record<string, unknown>,
    p = "",
  ): Record<string, string> =>
    Object.fromEntries(
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "string"
          ? [[p + k, v]]
          : Object.entries(flatten(v as Record<string, unknown>, p + k + ".")),
      ),
    );
  const zh = flatten(runtimeZh),
    en = flatten(runtimeEn);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh))
    assert.deepEqual(
      zh[key].match(/{{[^}]+}}/g) ?? [],
      en[key].match(/{{[^}]+}}/g) ?? [],
      key,
    );
  const recall: ExperienceRecallCardPresentation = {
    kind: "experience_recall",
    presentationKey: "lightweight-experience-recall-card",
    presentationVersion: "v1",
    slots: {
      experienceSketch: {
        scene: "A friend needs an umbrella.",
        senseFocus: "Temporary use with return.",
      },
      auxiliaryCues: [],
    },
  };
  const reveal: ExpressionRevealCardPresentation = {
    kind: "expression_reveal",
    presentationKey: "lightweight-expression-reveal-card",
    presentationVersion: "v1",
    slots: {
      expressionPrimary: { surface: "SECRET_EXPRESSION" },
      senseConfirmation: { meaning: "Temporary use" },
      pronunciation: null,
      languageStructure: null,
      usageGuidance: null,
      sceneBridge: null,
    },
  };
  const noop = () => {};
  for (const locale of ["zh-CN", "en"]) {
    await i18n.changeLanguage(locale);
    const before = renderToStaticMarkup(
      <ExperienceRecallCard presentation={recall} onReveal={noop} />,
    );
    assert.ok(
      !before.includes("SECRET_EXPRESSION"),
      "answer is not leaked before reveal",
    );
    assert.ok(
      before.includes(locale === "en" ? "Show expression" : "显示表达"),
    );
    const after = renderToStaticMarkup(
      <ExpressionRevealCard presentation={reveal} onRate={noop} />,
    );
    assert.ok(after.includes("SECRET_EXPRESSION"));
    assert.ok(!after.includes("<audio"), "missing optional audio is collapsed");
    const empty = renderToStaticMarkup(
      <LightweightReviewRuntimeScreen
        active
        targetIds={[]}
        onExit={noop}
        onRateTarget={noop}
        onCompleteRepair={noop}
        onFinish={noop}
      />,
    );
    assert.ok(
      empty.includes(
        locale === "en" ? "No review to continue" : "当前没有可继续的复习",
      ),
    );
  }
  console.log(
    "Lightweight runtime smoke passed: rating guards, independent repair, empty queue, answer disclosure, optional audio and zh-CN/en copy. No provider calls.",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
