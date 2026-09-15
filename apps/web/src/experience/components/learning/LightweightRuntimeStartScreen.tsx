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
import type { PersonalLearningSceneRevision } from '../../../data/library/contentAnnotations';

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
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
  readonly semanticWorldState?: 'available' | 'update' | 'saved' | 'saving' | null;
  readonly onSaveToSemanticWorld?: () => void;
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
  personalScene,
  onOpenPersonalScene,
  semanticWorldState,
  onSaveToSemanticWorld,
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
          personalScene,
          onOpenPersonalScene,
          semanticWorldState,
          onSaveToSemanticWorld,
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
          className="rounded-card border border-border-subtle bg-surface-panel p-8 shadow-raised"
        >
          <h1 className="text-xl font-medium">{t("runtime.unavailable")}</h1>
          <p className="mt-4 text-sm text-fg-secondary">
            {t("runtime.unavailableHint")}
          </p>
          <button className={`${runtimePrimary} mt-7`} onClick={onExit}>
            {t("runtime.back")}
          </button>
        </div>
      )}
      {completed && target && (
        <section aria-live="polite" className="py-8 text-center">
          <span className="mx-auto mb-7 grid size-14 place-items-center rounded-full bg-accent-soft text-action-primary">
            <Check size={25} strokeWidth={1.4} />
          </span>
          <p className="text-sm text-fg-secondary">{completionLabel??t("runtime.initialDone")}</p>
          <h1 className="mt-6 break-words font-language text-4xl font-medium tracking-tight sm:text-5xl">
            {target.expression}
          </h1>
          <p className="mt-5 text-body text-fg-secondary">
            {target.meaning}
          </p>
          <p className="mt-8 text-sm text-fg-tertiary">
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
