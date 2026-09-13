import {localFlowText} from '../../../i18n/localFlowText';
import { useTranslation } from "react-i18next";
import { Check, ArrowRight } from "lucide-react";
import { RuntimeFrame, runtimePrimary } from "./RuntimeFrame";
import { useMemo } from "react";
import type {LearningTargetPresentation} from '../../library/learningPresentation';
import { assembleLightweightInitialPresentation } from "../../learningRuntime/lightweightInitialPresentation";
import type { LightweightInitialLearningMaterialization } from "../../../learning/runtime/lightweightInitialContent";
import {
  LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND,
  type LightweightInitialRating,
  type LightweightProtocolStepInstance,
} from "../../../learning/runtime/lightweightInitialProtocol";
import {
  stepRendererRegistry,
  type LightweightInitialStepRendererProps,
} from "../../learningRuntime/stepRenderers";

interface LightweightRuntimeStartScreenProps {
  readonly tools?: import('react').ReactNode;
  readonly purpose?: 'initial_learning'|'retention_review'|'relearning';
  readonly completionLabel?: string;
  readonly completionDetail?: string;
  readonly active: boolean;
  readonly target:LearningTargetPresentation|null;
  readonly materialization: LightweightInitialLearningMaterialization | null;
  readonly step: LightweightProtocolStepInstance | null;
  readonly completed: boolean;
  readonly hasNextTarget: boolean;
  readonly onExit: () => void;
  readonly onReveal: () => void;
  readonly onRate: (rating: LightweightInitialRating) => void;
  readonly onFinish: () => void;
}
/**
 * Lightweight Initial Runtime shell.
 *
 * It does not own a card phase machine. The protocol runner supplies one Step
 * Instance, the registry supplies its renderer, and completion is a Run result.
 */
export const LightweightRuntimeStartScreen = ({
  tools,
  purpose='initial_learning',
  completionLabel,
  completionDetail,
  active,
  target,
  materialization,
  step,
  completed,
  hasNextTarget,
  onExit,
  onReveal,
  onRate,
  onFinish,
}: LightweightRuntimeStartScreenProps) => {
  const { t } = useTranslation();
  const presentation = useMemo(
    () =>
      step && materialization
        ? assembleLightweightInitialPresentation(step, materialization)
        : null,
    [step, materialization],
  );
  const renderedStep =
    step && presentation
      ? stepRendererRegistry.get<LightweightInitialStepRendererProps>(
          step.definition.stepKind,
        )({
          step,
          presentation,
          onReveal,
          onRate,
        })
      : null;
  const progressStep = completed
    ? 2
    : step?.definition.stepKind === LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
      ? 0
      : 1;

  return (
    <RuntimeFrame
      id="s-lightweight-runtime"
      active={active}
      title={purpose==='initial_learning'?t('runtime.learning'):purpose==='retention_review'?localFlowText('reviewTitle'):localFlowText('relearningTitle')}
      stepLabel={t(
        completed
          ? "runtime.done"
          : progressStep === 0
            ? "runtime.recallStep"
            : "runtime.revealStep",
      )}
      progress={progressStep * 50}
      tools={tools}
      onExit={onExit}
    >
      {!completed && renderedStep}
      {!completed && !renderedStep && (
        <div
          role="alert"
          className="rounded-xl border border-[#e0e5ee] bg-white p-8"
        >
          <h1 className="text-xl font-medium">{t("runtime.unavailable")}</h1>
          <p className="mt-4 text-sm text-[#7b8597]">
            {t("runtime.unavailableHint")}
          </p>
          <button className={`${runtimePrimary} mt-7`} onClick={onExit}>
            {t("runtime.back")}
          </button>
        </div>
      )}
      {completed && target && (
        <section aria-live="polite" className="py-8 text-center">
          <span className="mx-auto mb-7 grid size-14 place-items-center rounded-full bg-[#e9eef8] text-[#526a9b]">
            <Check size={25} strokeWidth={1.4} />
          </span>
          <p className="text-sm text-[#7b8597]">{completionLabel??t("runtime.initialDone")}</p>
          <h1 className="mt-6 break-words text-4xl font-medium tracking-tight sm:text-5xl">
            {target.expression}
          </h1>
          <p className="mt-5 text-base leading-7 text-[#788398]">
            {target.meaning}
          </p>
          <p className="mt-8 text-sm text-[#788398]">
            {completionDetail??t("runtime.scheduled")}
          </p>
          <button
            className={`${runtimePrimary} mt-9 w-full sm:w-auto`}
            onClick={onFinish}
          >
            {t(hasNextTarget ? "runtime.next" : "runtime.home")}
            <ArrowRight size={17} />
          </button>
        </section>
      )}
    </RuntimeFrame>
  );
};
