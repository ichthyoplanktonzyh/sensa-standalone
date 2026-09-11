import { LearningPreferencesPanel } from '../apps/web/src/experience/components/learning/LearningPreferencesPanel';
import { INITIAL_JOURNEY, journeyReducer, journeyFor } from '../apps/web/src/experience/learningJourney/journeyState';
import { LearnScreen } from '../apps/web/src/experience/components/LearnScreen';
import { storageService } from "../apps/web/src/experience/services/storageService";
import assert from "node:assert/strict";
import React from "react";
import { Window } from "happy-dom";
import { LearnQueue } from "../apps/web/src/experience/engine/LearnQueue";
import {
  ReviewQueue,
  type ReviewSession,
} from "../apps/web/src/experience/engine/ReviewQueue";
import { PROTOTYPE_RUNTIME_PACKAGES } from "../apps/web/src/experience/learningRuntime/prototypeRuntimeFixtures";
import {
  resolveReviewMemoryOutcome,
  type ReviewAssessmentResult,
} from "../apps/web/src/experience/review/types";
import { materializeAssessmentResource } from "../apps/web/src/experience/content/assessmentResources";
import {
  runtimeCheckpoint,
  RuntimeCheckpointStore,
} from "../apps/web/src/experience/learningRuntime/runtimeCheckpoint";
import { AssuranceCard } from "../apps/web/src/experience/components/learning/AssuranceCard";
import { assuranceZh, assuranceEn } from "../apps/web/src/i18n/assurance";
import type {
  StepRendererHost,
  StepRendererProps,
} from "../apps/web/src/experience/learningRuntime/stepRenderers";
import i18n from "../apps/web/src/i18n";

async function main() {
  // DOM simulation only: no browser launched or user browser controlled.
  const window = new Window({ url: "http://localhost:3000" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const result = (
    session: ReviewSession,
    correct: boolean,
  ): ReviewAssessmentResult => ({
    assessmentId: session.action.taskKey + ".action-assessment",
    kind: session.assessmentKind,
    focusDimension: "词形提取",
    correct,
    responseId: null,
    memoryOutcome: resolveReviewMemoryOutcome(session.assessmentKind, correct),
    evidenceEligible: true,
  });

  // Restore every step, including undo history and shared immutable packages.
  let learning = new LearnQueue(PROTOTYPE_RUNTIME_PACKAGES, { minGap: 2 });
  let steps = 0;
  while (!learning.isDone() && steps < 160) {
    const before = learning.getProjection();
    const serialized = learning.exportCheckpoint();
    learning = LearnQueue.restoreCheckpoint(serialized);
    assert.deepEqual(learning.getProjection(), before);
    const session = learning.getCurrentSession()!;
    if (session.action.kind === "introduction") learning.completeIntroduction();
    else
      switch (session.action.capability) {
        case "contextual_recognition":
          learning.completeRecognition(true);
          break;
        case "meaning_to_form_recall":
          learning.completeMeaningToFormRecall("independent");
          break;
        case "novel_context_transfer":
          learning.completeNovelTransfer("success");
          break;
        case "boundary_discrimination":
          learning.completeBoundary(true);
          break;
        default:
          throw Error("Unexpected step");
      }
    learning.next();
    steps++;
  }
  assert.ok(learning.isDone(), "all required gates graduate across reloads");
  assert.ok(
    learning.exportCheckpoint().length < 2_000_000,
    "shared packages keep history compact",
  );
  const restoredDone = LearnQueue.restoreCheckpoint(
    learning.exportCheckpoint(),
  );
  assert.equal(
    restoredDone.getGraduatedRetentionTargetIds().length,
    PROTOTYPE_RUNTIME_PACKAGES.length,
  );
  assert.deepEqual(
    restoredDone.undo(),
    learning.undo(),
    "undo survives reload",
  );

  const pkg = PROTOTYPE_RUNTIME_PACKAGES[0]!;
  let outcomes = 0;
  let review = new ReviewQueue(
    [{ package: pkg, phase: "retaining" as const, dueAt: Date.now() }],
    {
      onEffect: (effect) => {
        if (effect.type === "retention_outcome") outcomes++;
      },
    },
  );
  const reviewReload = () => {
    review = ReviewQueue.restoreCheckpoint(review.exportCheckpoint(), {
      onEffect: (effect) => {
        if (effect.type === "retention_outcome") outcomes++;
      },
    });
  };
  review.settle(result(review.getCurrentSession()!, false));
  reviewReload();
  assert.equal(review.getCurrentSession()?.stepKind, "review_feedback");
  review.settle(result(review.getCurrentSession()!, true));
  assert.equal(outcomes, 1, "settled feedback cannot rate twice after reload");
  review.next();
  reviewReload();
  assert.equal(review.getCurrentSession()?.action.intent, "repair");
  review.completeRepair();
  review.next();
  reviewReload();
  assert.equal(review.getCurrentSession()?.action.intent, "assessment");
  review.settle(result(review.getCurrentSession()!, true));
  review.next();
  reviewReload();
  assert.ok(review.isDone());
  assert.equal(outcomes, 1, "repair and retest do not repeat due outcome");

  // Real local storage seam: failure rolls queue and scheduler facts back together.
  storageService.graduateRetentionTarget(pkg.retentionTargetId!, 0);
  let durable = new ReviewQueue(
    [{ package: pkg, phase: "retaining" as const, dueAt: Date.now() }],
    { onEffect: (effect) => storageService.applyReviewRuntimeEffect(effect) },
  );
  const memoryBefore = JSON.stringify(storageService.getFSRSItems());
  const queueBefore = durable.exportCheckpoint();
  assert.throws(() =>
    runtimeCheckpoint.atomic(() => {
      runtimeCheckpoint.afterRollback(() => {
        durable = ReviewQueue.restoreCheckpoint(queueBefore, {
          onEffect: (effect) => storageService.applyReviewRuntimeEffect(effect),
        });
      });
      durable.settle(result(durable.getCurrentSession()!, false));
      runtimeCheckpoint.update({ reviewQueue: durable.exportCheckpoint() });
      throw Error("simulated failure before durable commit");
    }),
  );
  assert.equal(JSON.stringify(storageService.getFSRSItems()), memoryBefore);
  assert.equal(durable.getCurrentSession()?.settled, false);
  runtimeCheckpoint.atomic(() => {
    durable.settle(result(durable.getCurrentSession()!, false));
    runtimeCheckpoint.update({ reviewQueue: durable.exportCheckpoint() });
  });
  const memoryAfter = JSON.stringify(storageService.getFSRSItems());
  durable = ReviewQueue.restoreCheckpoint(
    runtimeCheckpoint.read().reviewQueue!,
    { onEffect: (effect) => storageService.applyReviewRuntimeEffect(effect) },
  );
  durable.settle(result(durable.getCurrentSession()!, true));
  assert.equal(JSON.stringify(storageService.getFSRSItems()), memoryAfter);

  assert.deepEqual(
    Object.keys(assuranceZh).sort(),
    Object.keys(assuranceEn).sort(),
  );
  await i18n.changeLanguage("en");
  const task = pkg.actions.find(
    (a) => a.capability === "meaning_to_form_recall",
  )!;
  const resource = materializeAssessmentResource({
    packageIdentity: pkg.content,
    content: pkg.content,
    taskKey: task.taskKey,
    kind: "meaning_to_form_recall",
  });
  assert.equal(resource.kind, "meaning_to_form_recall");
  if (resource.kind !== "meaning_to_form_recall")
    throw Error("recall resource required");
  let recorded: string | null = null;
  const host: StepRendererHost = {
    toast: () => {},
    openExample: () => {},
    openDict: () => {},
    openNoteEditor: () => {},
    openSceneEditor: () => {},
    lookupDictionary: async () => null,
    completeIntroduction: () => {},
    completeRecognition: () => {},
    completeMeaningToFormRecall: (value) => {
      recorded = value;
    },
    completeNovelTransfer: () => {},
    completeReviewAssessment: () => {},
    continueReviewFeedback: () => {},
  };
  const props: StepRendererProps = {
    stepKind: "recall",
    ordinal: 1,
    curWord: {} as any,
    content: pkg.content,
    repairContent: null,
    repairResourceRef: null,
    phase: "experience",
    onPhaseChange: () => {},
    assessmentResource: resource,
    reviewSpec: null,
    reviewAssessmentResult: null,
    purpose: "acquisition",
    onCardViewChange: () => {},
    host,
  };
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const mount = async () => {
    await act(async () =>
      root.render(<AssuranceCard {...props} draftKey="smoke-recall" />),
    );
  };
  await mount();
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    assert.ok(button, "button exists: " + label);
    await act(async () => button.click());
  };
  assert.ok(
    !container.textContent!.includes(resource.primaryForm),
    "recall prompt does not reveal answer",
  );
  await click(assuranceEn.firstLetter);
  assert.ok(container.textContent!.includes(assuranceEn.hintUsed));
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  assert.ok(
    container.textContent!.includes(assuranceEn.hintUsed),
    "hint assistance persists after remount",
  );
  await click(assuranceEn.choices);
  const correct = resource.choiceOptions.find((o) => o.isTarget)!;
  const option = [...container.querySelectorAll("[role=radio]")].find((n) =>
    n.textContent!.includes(correct.textL2),
  ) as HTMLElement;
  await act(async () => option.click());
  await click(assuranceEn.submit);
  assert.ok(container.textContent!.includes(assuranceEn.supported));
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  await click(assuranceEn.continueLater);
  assert.equal(
    recorded,
    "choice",
    "reloaded supported recall is not graded independent",
  );
  await act(async () => root.unmount());

  // Opening the example sheet must remove pronunciation controls and stop audio.
  const audios: FakeAudio[]=[];
  class FakeAudio {
    onended:(()=>void)|null=null;
    onerror:(()=>void)|null=null;
    paused=false;
    constructor(public src:string){audios.push(this);}
    play(){return Promise.resolve();}
    pause(){this.paused=true;}
    removeAttribute(){this.src='';}
  }
  Object.assign(globalThis,{Audio:FakeAudio});
  root=createRoot(container);
  const learningScreen=(behind:boolean)=><LearnScreen
    hasTask active isBehind={behind} curWord={{id:'audio-smoke'} as any}
    stage="introduction" step={1} groupSize={4}
    introductionContent={pkg.content} repairContent={null}
    introductionPosition={1} introductionTotal={4} reviewAssessmentPurpose="acquisition"
    onExit={()=>{}} onUndo={()=>{}} onMarkKnown={()=>{}} onOpenMenuMore={()=>{}}
    reviewAssessmentKind={null} reviewAssessmentTaskKey={null} assessmentPackageIdentity={null}
    reviewAssessmentResult={null} repairResourceRef={null} host={host}
  />;
  await act(async()=>root.render(learningScreen(false)));
  await click(assuranceEn.reveal);
  const pronunciation=container.querySelector('button[aria-label^="Play pronunciation"]') as HTMLElement;
  assert.ok(pronunciation,'pronunciation uses an ordinary button');
  assert.equal(container.querySelectorAll('audio[controls]').length,0);
  await act(async()=>pronunciation.click());
  assert.equal(audios.length,1);
  await act(async()=>root.render(learningScreen(true)));
  assert.equal(container.querySelector('button[aria-label^="Play pronunciation"]'),null,'no pronunciation controls remain behind example sheet');
  assert.equal(audios[0].paused,true,'leaving stops the previous audio');
  assert.equal(audios[0].onerror,null,'hidden playback cannot emit an error toast');
  await act(async()=>root.render(learningScreen(false)));
  assert.ok(container.querySelector('button[aria-label^="Play pronunciation"]'),'return restores reveal phase');
  await act(async()=>root.unmount());

  // Preferences stays over the mounted learning UI and does not navigate or replan its queue.
  const locationBefore=window.location.href;
  const queueSnapshot=runtimeCheckpoint.read().learnQueue;
  let preferenceJourney=journeyReducer(INITIAL_JOURNEY,{type:'commitPolicies',entries:[{targetId:'borrow-receive',policy:'high_assurance'}]});
  let preferenceCount=10;
  let closeCount=0;
  root=createRoot(container);
  const preferences=()=> <div>
    <input aria-label="existing answer" defaultValue="unfinished response"/>
    <LearningPreferencesPanel defaultPolicy={preferenceJourney.defaultPolicy} dailyNewCount={preferenceCount}
      onPolicyChange={policy=>{preferenceJourney=journeyReducer(preferenceJourney,{type:'selectDefaultPolicy',policy});}}
      onDailyNewCountChange={count=>{preferenceCount=count;}}
      onClose={()=>{closeCount++;}}
    />
  </div>;
  await act(async()=>root.render(preferences()));
  const originalInput=container.querySelector('input');
  const policyButton=[...container.querySelectorAll('[role=radio]')].find(button=>button.textContent==='Lightweight learning') as HTMLElement;
  await act(async()=>policyButton.click());
  await act(async()=>root.render(preferences()));
  assert.equal(preferenceJourney.defaultPolicy,'lightweight');
  assert.equal(journeyFor(preferenceJourney,'borrow-receive').committedPolicy,'high_assurance');
  assert.equal(container.querySelector('input'),originalInput);
  assert.equal((originalInput as HTMLInputElement).value,'unfinished response');
  const countSelect=container.querySelector('option[value="20"]')?.parentElement as HTMLSelectElement;
  await act(async()=>{countSelect.value='20';countSelect.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(preferenceCount,20);
  await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(closeCount,1);
  assert.equal(window.location.href,locationBefore);
  assert.equal(runtimeCheckpoint.read().learnQueue,queueSnapshot);
  await act(async()=>root.unmount());
  await window.happyDOM.close();
  console.log(
    "High-assurance smoke passed: all acquisition gates across refresh, undo history, review/repair/retest, atomic scheduler rollback, UI answer concealment and persisted hint grading, zh/en parity. No browser or provider calls.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
