import { runtimeCheckpoint } from "../../learningRuntime/runtimeCheckpoint";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PROTOTYPE_LEARNING_TARGETS,
  experienceGroundingForTarget,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from "../../learningJourney/prototypeLearning";
import {
  initialReviewState,
  transitionReview,
  type ReviewAction,
} from "../../learningRuntime/lightweightReviewState";
import { RuntimeFrame, runtimePrimary } from "./RuntimeFrame";
import { RuntimeRating } from "./RuntimeRating";
interface LightweightReviewRuntimeScreenProps {
  active: boolean;
  targetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
  onRateTarget: (
    id: PrototypeLearningTargetId,
    rating: PrototypeLightweightRating,
  ) => void;
  onCompleteRepair: (id: PrototypeLearningTargetId) => void;
  finishLabel?: string;
  onFinish: () => void;
}
export function LightweightReviewRuntimeScreen({
  active,
  targetIds,
  onExit,
  onRateTarget,
  onCompleteRepair,
  finishLabel,
  onFinish,
}: LightweightReviewRuntimeScreenProps) {
  const { t, i18n } = useTranslation();
  const sessionKey =
    (runtimeCheckpoint.read().reviewGeneration ?? 0) +
    ":" +
    targetIds.join("|");
  const restore = () => {
    const saved = runtimeCheckpoint.read().review;
    return saved?.key === sessionKey ? saved.state : initialReviewState();
  };
  const [state, setState] = useState(restore);
  const stateRef = useRef(state);
  const [error, setError] = useState(false);
  useEffect(() => {
    stateRef.current = restore();
    setState(stateRef.current);
    setError(false);
  }, [sessionKey]);
  const targetId = targetIds[state.index];
  const target = targetId ? PROTOTYPE_LEARNING_TARGETS[targetId] : null;
  const grounding = useMemo(
    () => (target ? experienceGroundingForTarget(target) : null),
    [target],
  );
  const act = (action: ReviewAction) => {
    const previous = stateRef.current;
    const next = transitionReview(previous, action, targetIds);
    if (next.state === previous) return;
    // Reserve the transition synchronously so rapid clicks cannot rate twice.
    stateRef.current = next.state;
    try {
      runtimeCheckpoint.atomic(() => {
        if (next.rating) onRateTarget(targetIds[previous.index]!, next.rating);
        if (next.repaired) onCompleteRepair(targetIds[previous.index]!);
        runtimeCheckpoint.update({
          review: { key: sessionKey, state: next.state },
        });
        runtimeCheckpoint.afterCommit(() => {
          setError(false);
          setState(next.state);
        });
      });
    } catch {
      stateRef.current = previous;
      setError(true);
    }
  };
  const phase = state.phase;
  const progress = targetIds.length
    ? (state.results.length / targetIds.length) * 100
    : 0;
  const summary = phase === "summary";
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(n);
  return (
    <RuntimeFrame
      id="s-lightweight-review-runtime"
      active={active}
      title={t("runtime.review")}
      stepLabel={
        summary
          ? t("runtime.done")
          : t("runtime.position", {
              current: fmt(state.index + 1),
              total: fmt(targetIds.length),
            })
      }
      progress={progress}
      onExit={onExit}
    >
      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {t("runtime.saveError")}
        </p>
      )}
      {!target || !grounding ? (
        <section role="status" className="py-12 text-center">
          <h1 className="text-2xl">{t("runtime.noReview")}</h1>
          <button className={`${runtimePrimary} mt-8`} onClick={onExit}>
            {t("runtime.back")}
          </button>
        </section>
      ) : (
        <>
          {(phase === "recall" || phase === "retry") && (
            <section key={`${phase}:${targetId}`}>
              <p className="mb-4 text-xs text-[#7b8597]">
                {t(
                  phase === "retry"
                    ? "runtime.repairRecall"
                    : "runtime.recallStep",
                )}
              </p>
              <h1 className="text-2xl font-medium leading-10 sm:text-3xl">
                {t("runtime.recallPrompt")}
              </h1>
              <div className="mt-8 rounded-2xl border border-[#e0e5ee] bg-white p-7 sm:p-10">
                <h2 className="text-xl leading-9 text-[#34425c]">
                  {target.meaning}
                </h2>
                {phase === "recall" && (
                  <p className="mt-6 border-t border-[#e7ebf2] pt-6 text-base leading-8 text-[#7b8597]">
                    {grounding.scene}
                  </p>
                )}
              </div>
              <button
                className={`${runtimePrimary} mt-9 w-full`}
                onClick={() => act({ type: "reveal" })}
              >
                {t("runtime.reveal")}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          {(phase === "answer" || phase === "retry_answer") && (
            <section key={`${phase}:${targetId}`} aria-live="polite">
              <p className="mb-5 text-xs text-[#7b8597]">
                {t("runtime.compare")}
              </p>
              <h1 className="break-words text-5xl font-medium tracking-tight text-[#2b3854] sm:text-6xl">
                {target.expression}
              </h1>
              <p className="mt-7 text-xl leading-8">{target.meaning}</p>
              <blockquote className="mt-8 rounded-xl border border-[#e0e5ee] bg-white p-6 text-lg leading-8 text-[#5e6f8a]">
                {target.example}
              </blockquote>
              {phase === "answer" ? (
                <RuntimeRating
                  onRate={(rating) => act({ type: "rate", rating })}
                />
              ) : (
                <div className="mt-9 grid gap-3 sm:grid-cols-2">
                  <button
                    className="min-h-14 rounded-xl border border-[#dce3ef] bg-white px-5 text-sm text-[#697a95]"
                    onClick={() =>
                      act({ type: "repairResult", restored: false })
                    }
                  >
                    {t("runtime.repairAgain")}
                  </button>
                  <button
                    className={runtimePrimary}
                    onClick={() =>
                      act({ type: "repairResult", restored: true })
                    }
                  >
                    {t("runtime.restored")}
                  </button>
                </div>
              )}
            </section>
          )}
          {phase === "repair" && (
            <section>
              <p className="mb-5 text-xs text-[#7b8597]">
                {t("runtime.repair")}
              </p>
              <h1 className="text-2xl font-medium sm:text-3xl">
                {t("runtime.repairTitle")}
              </h1>
              <p className="mt-7 text-lg leading-9 text-[#788398]">
                {grounding.scene}
              </p>
              <div className="mt-8 rounded-xl border border-[#dce3ef] bg-white p-7">
                <strong className="text-3xl font-medium text-[#34425c]">
                  {target.expression}
                </strong>
                <p className="mt-5 leading-8 text-[#788398]">
                  {target.meaning}
                </p>
              </div>
              <button
                className={`${runtimePrimary} mt-9 w-full`}
                onClick={() => act({ type: "retry" })}
              >
                {t("runtime.retryRecall")}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          {summary && (
            <section aria-live="polite">
              <span className="mb-7 grid size-14 place-items-center rounded-full bg-[#e9eef8] text-[#526a9b]">
                <Check size={25} />
              </span>
              <h1 className="text-3xl font-medium">
                {t("runtime.reviewDone")}
              </h1>
              <p className="mt-4 text-sm text-[#788398]">
                {t("runtime.reviewCount", { count: state.results.length })}
              </p>
              <div className="mt-9 divide-y divide-[#e3e8f0] border-y border-[#e3e8f0]">
                {state.results.map((result) => (
                  <div
                    key={result.targetId}
                    className="flex items-center justify-between gap-4 py-5"
                  >
                    <strong className="font-medium">
                      {
                        PROTOTYPE_LEARNING_TARGETS[
                          result.targetId as PrototypeLearningTargetId
                        ].expression
                      }
                    </strong>
                    <span className="text-sm text-[#7b8597]">
                      {t(
                        result.rating === "again"
                          ? "runtime.repaired"
                          : `runtime.ratings.${result.rating}`,
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <button
                className={`${runtimePrimary} mt-9 w-full`}
                onClick={onFinish}
              >
                {finishLabel ?? t("runtime.home")}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
        </>
      )}
    </RuntimeFrame>
  );
}
