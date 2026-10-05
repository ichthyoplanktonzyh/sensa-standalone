import {localFlowText} from '../../../i18n/localFlowText';
import { useTranslation } from "react-i18next";
import { Check, ArrowRight, RotateCcw } from "lucide-react";
import { RuntimeFrame, runtimePrimary } from "./RuntimeFrame";
import { useEffect, useMemo, useRef } from "react";
import type {LearningLightweightRating,LearningLightweightStepProjection,LearningTargetPresentation} from '../../../learning/system';
import {LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND} from '../../../learning/system';
import { assembleLightweightInitialPresentation } from "../../learningRuntime/lightweightInitialPresentation";
import type { LightweightInitialLearningMaterialization } from "../../../contentSupply/provisioning/lightweightInitialContent";
import {
  stepRendererRegistry,
  type LightweightInitialStepRendererProps,
} from "../../learningRuntime/stepRenderers";
import type { PersonalLearningSceneRevision } from '../../../personalContent/system';
import type {DictionaryLookup,QuickDictEntry} from '../../types';

interface LightweightRuntimeStartScreenProps {
  readonly tools?: import('react').ReactNode;
  readonly support?: import('react').ReactNode;
  readonly purpose?: 'initial_learning'|'retention_review'|'relearning';
  readonly active: boolean;
  readonly busy?: boolean;
  readonly completionKey?: string | null;
  readonly target:LearningTargetPresentation|null;
  readonly materialization: LightweightInitialLearningMaterialization | null;
  readonly step: LearningLightweightStepProjection | null;
  readonly completed: boolean;
  readonly needsRelearning: boolean;
  readonly onRetryRelearning: () => void;
  readonly hasNextTarget: boolean;
  readonly onExit: () => void;
  readonly onReveal: () => void;
  readonly onRate: (rating: LearningLightweightRating) => void;
  readonly onFinish: () => void;
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
  readonly semanticWorldState?: 'available' | 'update' | 'saved' | 'saving' | null;
  readonly onSaveToSemanticWorld?: () => void;
  readonly onOpenDictionary: (word: string | QuickDictEntry) => void;
  readonly lookupDictionary: DictionaryLookup;
  readonly toast: (message: string) => void;
}
/**
 * Lightweight Initial Runtime shell.
 *
 * It does not own a card phase machine. The protocol runner supplies one Step
 * Instance, the registry supplies its renderer, and completion is a Run result.
 */
export const LightweightRuntimeStartScreen = ({
  tools,
  support,
  purpose='initial_learning',
  active,
  busy = false,
  completionKey = null,
  target,
  materialization,
  step,
  completed,
  needsRelearning,
  onRetryRelearning,
  hasNextTarget,
  onExit,
  onReveal,
  onRate,
  onFinish,
  personalScene,
  onOpenPersonalScene,
  semanticWorldState,
  onSaveToSemanticWorld,
  onOpenDictionary,
  lookupDictionary,
  toast,
}: LightweightRuntimeStartScreenProps) => {
  const { t } = useTranslation();
  const advancedCompletion = useRef<string | null>(null);
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
          active,
          presentation,
          personalScene,
          onOpenPersonalScene,
          semanticWorldState,
          onSaveToSemanticWorld,
          onOpenDictionary,
          lookupDictionary,
          toast,
          onReveal,
          onRate,
        })
      : null;
  const progressStep = completed
    ? 2
    : step?.definition.stepKind === LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND
      ? 0
      : 1;

  useEffect(() => {
    if (!active || busy || !completed || needsRelearning || !hasNextTarget || !completionKey) return;
    if (advancedCompletion.current === completionKey) return;
    advancedCompletion.current = completionKey;
    onFinish();
  }, [active, busy, completed, needsRelearning, completionKey, hasNextTarget, onFinish]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector(`[role="${'dialog'}"]`)) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      const interactive = !!element?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]');
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
        return;
      }
      if (event.key !== 'Enter' || interactive || busy) return;
      if (!completed && step?.definition.stepKind === LEARNING_LIGHTWEIGHT_EXPERIENCE_RECALL_STEP_KIND) {
        event.preventDefault();
        onReveal();
      } else if (completed && needsRelearning) {
        event.preventDefault();
        onRetryRelearning();
      } else if (completed && !hasNextTarget) {
        event.preventDefault();
        onFinish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, busy, completed, needsRelearning, hasNextTarget, onExit, onFinish, onRetryRelearning, onReveal, step?.definition.stepKind]);

  return (
    <RuntimeFrame
      id="s-lightweight-runtime"
      active={active}
      title={purpose==='initial_learning'?t('runtime.learning'):purpose==='retention_review'?localFlowText('reviewTitle'):localFlowText('relearningTitle')}
      stepLabel={needsRelearning?t('runtime.relearningRetryTitle'):t(
        completed
          ? "runtime.done"
          : purpose === 'initial_learning' && progressStep === 0
            ? "runtime.experienceStep"
            : purpose === 'initial_learning'
              ? "runtime.bindingStep"
              : progressStep === 0
            ? "runtime.recallStep"
            : "runtime.revealStep",
      )}
      progress={needsRelearning?null:completed ? 100 : (progressStep + 1) * 50}
      tools={tools}
      onExit={onExit}
      pauseShortcut="Esc"
    >
      {!completed && renderedStep && <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">{renderedStep}</fieldset>}
      {!completed && renderedStep && support && <div className="mt-4">{support}</div>}
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
      {completed && !needsRelearning && hasNextTarget && <div className="min-h-[24rem]" aria-hidden="true" />}
      {completed && (needsRelearning || !hasNextTarget) && target && (
        <section aria-live="polite" className="sensa-runtime-summary py-8 text-center">
          <span className="mx-auto mb-7 grid size-14 place-items-center rounded-full bg-accent-soft text-action-primary">
            {needsRelearning?<RotateCcw size={25} strokeWidth={1.4}/>:<Check size={25} strokeWidth={1.4} />}
          </span>
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{needsRelearning?t('runtime.relearningRetryTitle'):t("runtime.done")}</h1>
          <button
            className={`${runtimePrimary} mt-9 w-full sm:w-auto`}
            disabled={busy}
            onClick={needsRelearning?onRetryRelearning:onFinish}
          >
            {needsRelearning?t('runtime.relearningRetryAction'):t("runtime.home")}
            <ArrowRight size={17} />
            <kbd className="sensa-shortcut-hint" aria-hidden="true">↵</kbd>
          </button>
          {needsRelearning&&<button className="mt-5 inline-flex min-h-11 items-center rounded-control px-4 text-sm text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40" disabled={busy} onClick={onExit}>{t('runtime.relearningBackHome')}</button>}
        </section>
      )}
    </RuntimeFrame>
  );
};
