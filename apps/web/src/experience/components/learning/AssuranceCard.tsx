import { PronunciationButtons } from './PronunciationButtons';
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  RotateCcw,
  BookOpen,
  StickyNote,
  Volume2,
} from "lucide-react";
import type { StepRendererProps } from "../../learningRuntime/stepRenderers";
import { runtimeCheckpoint } from "../../learningRuntime/runtimeCheckpoint";
import type { MeaningToFormRecallOutcome } from "../../engine/types";
import { resolveReviewMemoryOutcome } from "../../review/types";
import { ClickableSentence } from "../ClickableSentence";
import { QuickDictPopup } from "../QuickDictPopup";
import { useImmediateDictionaryLookup } from "../useImmediateDictionaryLookup";
import type { PrototypeLearningExample } from "../../content/learningCatalog";
import { runtimePrimary } from "./RuntimeFrame";

export const assurancePanel =
  "rounded-2xl border border-[#e0e5ee] bg-white p-6 sm:p-8";
export const assuranceSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#dce3ef] bg-white px-4 text-sm text-[#546582] hover:bg-[#f3f5f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9] disabled:opacity-40";
interface Draft {
  answer: string;
  selected: string | null;
  mode: "independent" | "first_letter" | "choice";
  result: MeaningToFormRecallOutcome | "success" | "uncertain" | null;
  revealed: boolean;
  replay: boolean;
  force: number;
  textScene: boolean;
}
const initialDraft = (): Draft => ({
  answer: "",
  selected: null,
  mode: "independent",
  result: null,
  revealed: false,
  replay: false,
  force: 0,
  textScene: false,
});
export function AssuranceCard(props: StepRendererProps & { draftKey: string }) {
  const { t } = useTranslation();
  const {
    host,
    assessmentResource: resource,
    stepKind,
    reviewAssessmentResult: reviewResult,
  } = props;
  const content =
    stepKind === "review_repair" ? props.repairContent : props.content;
  const saved = runtimeCheckpoint.read().cardDraft;
  const [draft, setDraft] = useState<Draft>(() =>
    saved?.key === props.draftKey ? (saved.value as Draft) : initialDraft(),
  );
  useEffect(() => {
    if (props.stepKind === "introduction" || props.stepKind === "review_repair")
      props.onPhaseChange(draft.revealed ? "reveal" : "experience");
  }, [props.stepKind, props.onPhaseChange, draft.revealed]);
  const ref = useRef(draft);
  const advanced = useRef(false);
  const [error, setError] = useState(false);
  const { activeLookup, openLookup, clearLookup } =
    useImmediateDictionaryLookup();
  const patch = (value: Partial<Draft>) => {
    const next = { ...ref.current, ...value };
    runtimeCheckpoint.update({
      cardDraft: { key: props.draftKey, value: next },
    });
    runtimeCheckpoint.afterCommit(() => {
      ref.current = next;
      setDraft(next);
    });
  };
  const run = (action: () => void) => {
    try {
      runtimeCheckpoint.atomic(action);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const advance = (action: () => void) => {
    if (advanced.current) return;
    run(() => {
      advanced.current = true;
      runtimeCheckpoint.afterRollback(() => {
        advanced.current = false;
      });
      action();
    });
  };
  if (!content) return <p>{t("assurance.noTask")}</p>;
  const introduction =
    stepKind === "introduction" || stepKind === "review_repair";
  const repair = stepKind === "review_repair";
  const reviewing = stepKind === "review_assessment";
  const feedback = !!reviewResult || draft.result !== null;
  const correct =
    reviewResult?.correct ??
    (draft.result === "independent" || draft.result === "success");
  const supported =
    draft.result === "first_letter" || draft.result === "choice";
  const experience = content.experience;
  const activeState =
    experience.kind === "interaction"
      ? (experience.states.find((s) => s.value === draft.force) ??
        experience.states[0])
      : null;
  const settle = (result: Draft["result"], responseId: string | null) => {
    if (ref.current.result || reviewResult) return;
    if (reviewing && props.reviewSpec) {
      host.completeReviewAssessment({
        assessmentId: props.reviewSpec.id,
        kind: props.reviewSpec.kind,
        focusDimension: props.reviewSpec.focusDimension,
        correct: result === "independent" || result === "success",
        responseId,
        memoryOutcome: resolveReviewMemoryOutcome(
          props.reviewSpec.kind,
          result === "independent" || result === "success",
        ),
        evidenceEligible: props.reviewSpec.evidenceEligible,
      });
    } else patch({ result });
  };
  const complete = () => {
    if (reviewResult) {
      host.continueReviewFeedback();
      return;
    }
    if (stepKind === "recognition")
      host.completeRecognition(draft.result === "success");
    else if (stepKind === "recall")
      host.completeMeaningToFormRecall(
        draft.result as MeaningToFormRecallOutcome,
      );
    else if (stepKind === "transfer")
      host.completeNovelTransfer(
        draft.result === "success" ? "success" : "repair",
      );
    else if (props.reviewSpec)
      host.completeReviewAssessment({
        assessmentId: props.reviewSpec.id,
        kind: props.reviewSpec.kind,
        focusDimension: props.reviewSpec.focusDimension,
        correct: draft.result === "success",
        responseId: draft.selected,
        memoryOutcome: resolveReviewMemoryOutcome(
          props.reviewSpec.kind,
          draft.result === "success",
        ),
        evidenceEligible: props.reviewSpec.evidenceEligible,
      });
  };
  const example: PrototypeLearningExample | undefined =
    resource?.kind === "novel_context_transfer"
      ? resource.scenario.revealExample
      : resource?.kind === "context_recognition" ||
          resource?.kind === "boundary_contrast"
        ? resource.example
        : content.studyExample;
  const sentence = (text: string, lookup: boolean, exampleKey: string) =>
    lookup ? (
      <ClickableSentence
        sentenceHtml={text}
        activeTokenIdx={activeLookup?.tokenIdx ?? null}
        onWordClick={(token, tokenIdx) => {
          if (
            !feedback &&
            !introduction &&
            token.cleanWord.toLocaleLowerCase() ===
              content.lemma.toLocaleLowerCase()
          ) {
            host.toast(t("assurance.targetHidden"));
            return;
          }
          openLookup({
            tokenIdx,
            displayWord: token.cleanWord,
            load: (signal) =>
              host.lookupDictionary(
                {
                  rawClickedForm: token.text,
                  exampleId: exampleKey,
                  textL2: text,
                  clickedStart: token.charStart,
                  clickedEnd: token.charEnd,
                  clickedSurface: token.text,
                },
                { signal },
              ),
          });
        }}
      />
    ) : (
      text
    );
  const exampleView = example && (
    <div className={assurancePanel}>
      <div className="text-xl leading-9">
        {sentence(example.textL2, true, example.exampleKey)}
      </div>
      <p className="mt-4 text-sm leading-7 text-[#788398]">{example.textL1}</p>
    </div>
  );
  const supports = (
    <div className="mt-7 flex flex-wrap gap-2">
      <button
        className={assuranceSecondary}
        onClick={() => run(() => patch({ replay: true }))}
      >
        <RotateCcw size={16} />
        {t("assurance.replay")}
      </button>
      <button
        className={assuranceSecondary}
        onClick={() => host.openDict(content.lemma)}
      >
        <BookOpen size={16} />
        {t("assurance.dictionary")}
      </button>
      <button
        className={assuranceSecondary}
        onClick={() =>
          host.openNoteEditor(
            content.lemma,
            content.senseKey,
            content.guideLabelL1,
          )
        }
      >
        <StickyNote size={16} />
        {t("assurance.note")}
      </button>
      <button
        className={assuranceSecondary}
        onClick={() => host.openSceneEditor(content)}
      >
        {t("assurance.personalScene")}
      </button>
      <button
        className={assuranceSecondary}
        onClick={() => host.openExample(0, 0)}
      >
        {t("assurance.example")}
      </button>
    </div>
  );
  const scene = (
    <section>
      <h1 className="mb-8 text-2xl font-medium leading-10 sm:text-3xl">
        {t(draft.replay ? "assurance.replay" : "assurance.experienceTitle")}
      </h1>
      <div className={assurancePanel}>
        <p className="mb-5 text-xs text-[#788398]">
          {experience.stageCaptionL1}
        </p>
        {experience.kind === "text" ? (
          <p className="text-xl leading-10">{experience.sceneL1}</p>
        ) : draft.textScene && experience.fallbackTextSceneL1 ? (
          <p className="text-xl leading-10">{experience.fallbackTextSceneL1}</p>
        ) : (
          <>
            <p className="mb-7 text-base leading-8">
              {experience.instructionL1}
            </p>
            <div className="mb-7 flex flex-wrap gap-2" aria-hidden="true">
              {experience.states.map((state) => (
                <span
                  key={state.value}
                  className={`rounded-lg px-4 py-3 text-sm ${state === activeState ? "bg-[#e9eef8] text-[#303f76]" : "bg-[#f6f7fa] text-[#8993a5]"}`}
                >
                  {state.labelL1}
                </span>
              ))}
            </div>
            <label className="block text-sm text-[#68748d]">
              {experience.controlLabelL1}
              <input
                type="range"
                className="my-5 block min-h-11 w-full accent-[#5268a9]"
                min={experience.minimum}
                max={experience.maximum}
                step={experience.step}
                value={activeState?.value ?? experience.minimum}
                aria-valuetext={activeState?.labelL1}
                onChange={(e) =>
                  run(() => patch({ force: Number(e.target.value) }))
                }
              />
            </label>
            <p className="min-h-20 text-xl leading-9" aria-live="polite">
              {activeState?.feedbackL1}
            </p>
          </>
        )}
      </div>
      {experience.kind === "interaction" && experience.fallbackTextSceneL1 && (
        <button
          className="mt-4 min-h-11 text-sm text-[#68748d]"
          onClick={() => run(() => patch({ textScene: !draft.textScene }))}
        >
          {t(
            draft.textScene
              ? "assurance.interactiveScene"
              : "assurance.textScene",
          )}
        </button>
      )}
      <button
        className={`${runtimePrimary} mt-8 w-full`}
        onClick={() =>
          run(() => {
            if (draft.replay) patch({ replay: false });
            else {
              patch({ revealed: true });
              props.onPhaseChange("reveal");
            }
          })
        }
      >
        {t(draft.replay ? "assurance.back" : "assurance.reveal")}
        <ArrowRight size={17} />
      </button>
    </section>
  );
  let body;
  if (draft.replay || (introduction && !draft.revealed)) body = scene;
  else if (introduction)
    body = (
      <section>
        <p className="mb-5 text-sm text-[#788398]">
          {t(repair ? "assurance.repair" : "assurance.revealTitle")}
        </p>
        <h1 className="break-words text-5xl font-medium tracking-tight sm:text-6xl">
          {content.lemma}
        </h1>
        <div className="my-6 flex flex-wrap items-center gap-4 text-sm text-[#68748d]">
          <span>
            {content.partOfSpeech} · {content.ipa}
          </span>
          <PronunciationButtons items={content.pronunciations} onError={()=>host.toast(t('assurance.audioUnavailable'))}/>

        </div>
        <p className="mb-8 text-xl leading-9">{content.guideLabelL1}</p>
        <p className="mb-7 text-base leading-8 text-[#68748d]">
          {content.definitionL2}
        </p>
        {exampleView}
        <details className="mt-6 rounded-xl border border-[#e0e5ee] bg-white p-5">
          <summary className="cursor-pointer text-sm text-[#68748d]">
            {t("assurance.usage")}
          </summary>
          <p className="mt-5 text-sm leading-8">{content.l1Bridge}</p>
          {content.supportTabs
            .flatMap((tab) => tab.patterns)
            .map((pattern) => (
              <div
                key={pattern.canonicalPattern}
                className="mt-5 space-y-3 text-sm"
              >
                <strong>{pattern.canonicalPattern}</strong>
                <p className="text-[#788398]">
                  {[pattern.registerLabel, pattern.domainLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {pattern.commonCollocations.map((c) =>
                    c.exampleIndex >= 0 ? (
                      <button
                        key={c.text}
                        className={assuranceSecondary}
                        onClick={() => host.openExample(0, c.exampleIndex)}
                      >
                        {c.text}
                      </button>
                    ) : (
                      <span key={c.text}>{c.text}</span>
                    ),
                  )}
                </div>
                {pattern.usageRestriction && (
                  <p className="leading-7 text-[#788398]">
                    {pattern.usageRestriction}
                  </p>
                )}
              </div>
            ))}
        </details>
        {supports}
        <button
          className={`${runtimePrimary} mt-9 w-full`}
          onClick={() => advance(() => host.completeIntroduction())}
        >
          {t(repair ? "assurance.completeRepair" : "assurance.continue")}
          <ArrowRight size={17} />
        </button>
      </section>
    );
  else if (feedback) {
    const selected =
      resource?.kind === "novel_context_transfer"
        ? resource.scenario.options.find(
            (o) => o.id === (reviewResult?.responseId ?? draft.selected),
          )
        : resource?.kind === "context_recognition" ||
            resource?.kind === "boundary_contrast"
          ? resource.options.find(
              (o) => o.id === (reviewResult?.responseId ?? draft.selected),
            )
          : null;
    const feedbackBody =
      resource?.kind === "meaning_to_form_recall"
        ? supported
          ? resource.supportedSuccessBodyL1
          : correct
            ? resource.independentSuccessBodyL1
            : resource.repairBodyL1
        : selected?.feedbackBodyL1;
    const correctOption =
      resource?.kind === "novel_context_transfer"
        ? resource.scenario.options.find((o) => o.isCorrect)
        : resource?.kind === "context_recognition" ||
            resource?.kind === "boundary_contrast"
          ? resource.options.find((o) => o.isCorrect)
          : null;
    const labelOf = (option: typeof selected) =>
      option ? ("textL1" in option ? option.textL1 : option.labelL1) : null;
    body = (
      <section aria-live="polite">
        <span className="mb-6 inline-flex size-12 items-center justify-center rounded-full bg-[#e9eef8] text-[#5268a9]">
          {correct ? <Check size={23} /> : <RotateCcw size={21} />}
        </span>
        <h1 className="text-3xl font-medium">
          {t(
            supported
              ? "assurance.supported"
              : correct
                ? "assurance.correct"
                : "assurance.retry",
          )}
        </h1>
        {selected && (
          <p className="mt-5 text-sm text-[#788398]">
            {t("assurance.yourChoice")} · {labelOf(selected)}
          </p>
        )}
        {!correct && correctOption && (
          <p className="mt-4 text-base leading-8">
            {t("assurance.correctChoice")} · {labelOf(correctOption)}
          </p>
        )}
        {feedbackBody && (
          <p className="mt-5 text-base leading-8 text-[#68748d]">
            {feedbackBody}
          </p>
        )}
        <div className="my-8 border-y border-[#e0e5ee] py-6">
          <p className="text-3xl font-medium">{content.lemma}</p>
          <p className="mt-3 text-base text-[#68748d]">
            {content.guideLabelL1}
          </p>
        </div>
        {exampleView}
        {supports}
        <button
          className={`${runtimePrimary} mt-9 w-full`}
          onClick={() => advance(complete)}
        >
          {t(correct ? "assurance.continue" : "assurance.continueLater")}
          <ArrowRight size={17} />
        </button>
      </section>
    );
  } else if (resource) {
    const recall = resource.kind === "meaning_to_form_recall" ? resource : null;
    const transfer =
      resource.kind === "novel_context_transfer" ? resource.scenario : null;
    const question = recall
      ? recall.cueL1
      : transfer
        ? transfer.questionL1
        : resource.kind === "context_recognition" ||
            resource.kind === "boundary_contrast"
          ? resource.questionL1
          : "";
    const options = recall
      ? recall.choiceOptions.map((o) => ({
          id: o.id,
          label: o.textL2,
          isCorrect: o.isTarget,
        }))
      : transfer
        ? transfer.options.map((o) => ({
            id: o.id,
            label: o.labelL1,
            isCorrect: o.isCorrect,
          }))
        : resource.kind === "context_recognition" ||
            resource.kind === "boundary_contrast"
          ? resource.options.map((o) => ({
              id: o.id,
              label: o.textL1,
              isCorrect: o.isCorrect,
            }))
          : [];
    const submit = () => {
      if (recall && draft.mode !== "choice") {
        const answer = draft.answer.trim().toLocaleLowerCase();
        if (!answer) return;
        const accepted = recall.acceptedForms.some(
          (f) => f.trim().toLocaleLowerCase() === answer,
        );
        if (accepted)
          settle(
            draft.mode === "independent" ? "independent" : "first_letter",
            answer,
          );
        else if (reviewing) settle("miss", answer);
        else
          patch({
            mode: draft.mode === "independent" ? "first_letter" : "choice",
            answer: "",
          });
      } else {
        const selected = options.find((o) => o.id === draft.selected);
        if (selected)
          settle(
            selected.isCorrect ? (recall ? "choice" : "success") : "miss",
            selected.id,
          );
      }
    };
    body = (
      <section data-assessment-task-key={resource.taskKey}>
        <h1 className="mb-8 text-2xl font-medium leading-10 sm:text-3xl">
          {t(
            recall
              ? "assurance.recallTitle"
              : transfer
                ? "assurance.transferTitle"
                : resource.kind === "boundary_contrast"
                  ? "assurance.boundaryTitle"
                  : "assurance.recognitionTitle",
          )}
        </h1>
        {transfer ? (
          <div className={assurancePanel}>
            <p className="mb-5 text-xs text-[#788398]">
              {transfer.sceneLabelL1}
            </p>
            <p className="text-lg leading-9">{transfer.setupL1}</p>
            <div className="mt-6 border-t border-[#e5e8ef] pt-6 text-lg leading-9 text-[#68748d]">
              {sentence(transfer.setupL2, true, transfer.id)}
            </div>
          </div>
        ) : recall ? (
          <div className={assurancePanel}>
            <p className="text-xl leading-9">{recall.cueL1}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {recall.cueFeatureLabelsL1.map((label) => (
                <span
                  key={label}
                  className="rounded-md bg-[#f3f5f9] px-3 py-2 text-xs text-[#788398]"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className={assurancePanel}>
            {resource.kind === "boundary_contrast" && (
              <p className="mb-6 text-base leading-8 text-[#788398]">
                {content.guideLabelL1} / {resource.contrastSenseL1}
              </p>
            )}
            <div className="text-xl leading-10">
              {example &&
                sentence(
                  example.textL2,
                  resource.kind === "boundary_contrast",
                  example.exampleKey,
                )}
            </div>
          </div>
        )}
        {!recall && <h2 className="mt-8 mb-5 text-lg leading-8">{question}</h2>}
        {recall && draft.mode !== "choice" ? (
          <form
            className="mt-7"
            onSubmit={(e) => {
              e.preventDefault();
              run(submit);
            }}
          >
            <label
              className="text-sm text-[#68748d]"
              htmlFor="assurance-answer"
            >
              {t("assurance.answer")}
            </label>
            {draft.mode === "first_letter" && (
              <p className="my-4 tracking-[.35em] text-[#5268a9]">
                {recall.primaryForm
                  .split("")
                  .map((c, i) => (i === 0 || !/[a-z]/i.test(c) ? c : "_"))
                  .join(" ")}
              </p>
            )}
            <input
              id="assurance-answer"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-3 min-h-16 w-full rounded-xl border border-[#d8dfec] bg-white px-5 text-xl outline-none focus:border-[#5268a9] focus:ring-2 focus:ring-[#e5eaf5]"
              value={draft.answer}
              placeholder={t("assurance.answerPlaceholder")}
              onChange={(e) => run(() => patch({ answer: e.target.value }))}
            />
            <button
              type="submit"
              disabled={!draft.answer.trim()}
              className={`${runtimePrimary} mt-7 w-full`}
            >
              {t("assurance.submit")}
            </button>
          </form>
        ) : (
          <>
            <div className="grid gap-3" role="radiogroup" aria-label={question}>
              {options.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.selected === option.id}
                  className={`flex min-h-16 items-center gap-4 rounded-xl border p-5 text-left text-base transition-colors ${draft.selected === option.id ? "border-[#5268a9] bg-[#edf1fa] text-[#303f76]" : "border-[#e0e5ee] bg-white hover:bg-[#f6f7fa]"}`}
                  onClick={() => run(() => patch({ selected: option.id }))}
                >
                  <span className="text-xs text-[#8993a5]">
                    {String.fromCharCode(65 + index)}
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
            <button
              disabled={!draft.selected}
              className={`${runtimePrimary} mt-7 w-full`}
              onClick={() => run(submit)}
            >
              {t("assurance.submit")}
            </button>
          </>
        )}
        {recall && draft.mode !== "independent" && (
          <p className="mt-4 text-sm text-[#788398]">
            {t("assurance.hintUsed")}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {recall && !reviewing && draft.mode === "independent" && (
            <button
              className={assuranceSecondary}
              onClick={() =>
                run(() => patch({ mode: "first_letter", answer: "" }))
              }
            >
              {t("assurance.firstLetter")}
            </button>
          )}
          {recall && !reviewing && draft.mode === "first_letter" && (
            <button
              className={assuranceSecondary}
              onClick={() => run(() => patch({ mode: "choice", answer: "" }))}
            >
              {t("assurance.choices")}
            </button>
          )}
          <button
            className="min-h-11 px-4 text-sm text-[#788398]"
            onClick={() =>
              run(() => settle(transfer ? "uncertain" : "miss", null))
            }
          >
            {t(transfer ? "assurance.uncertain" : "assurance.unknown")}
          </button>
        </div>
      </section>
    );
  }
  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {t("runtime.saveError")}
        </p>
      )}
      {body}
      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={host.toast}
          onViewDetail={(word, entry) => {
            clearLookup();
            host.openDict(entry ?? word);
          }}
        />
      )}
    </div>
  );
}
