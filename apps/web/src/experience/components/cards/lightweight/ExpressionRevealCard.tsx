import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExpressionRevealCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import type { LightweightInitialRating } from "../../../../learning/runtime/lightweightInitialProtocol";
import { RuntimeRating } from "../../learning/RuntimeRating";
import { Check } from "lucide-react";
import type { PersonalLearningSceneRevision } from "../../../../data/library/contentAnnotations";
interface ExpressionRevealCardProps {
  readonly initial?: boolean;
  readonly presentation: ExpressionRevealCardPresentation;
  readonly onRate: (rating: LightweightInitialRating) => void;
  readonly semanticWorldState?: 'available' | 'update' | 'saved' | 'saving' | null;
  readonly onSaveToSemanticWorld?: () => void;
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
}
export function ExpressionRevealCard({
  presentation,
  initial = true,
  onRate,
  semanticWorldState = null,
  onSaveToSemanticWorld,
  personalScene,
  onOpenPersonalScene,
}: ExpressionRevealCardProps) {
  const { t } = useTranslation();
  const [audioFailed, setAudioFailed] = useState(false);
  const {
    expressionPrimary,
    senseConfirmation,
    pronunciation,
    languageStructure,
    usageGuidance,
    sceneBridge,
  } = presentation.slots;
  return (
    <section
      aria-live="polite"
      aria-labelledby="lightweight-expression-reveal-title"
    >
      <p className="mb-5 text-metadata text-fg-tertiary">{t("runtime.compare")}</p>
      <h1
        id="lightweight-expression-reveal-title"
        className="break-words font-language text-learning-expression font-medium tracking-tight text-action-primary sm:text-6xl"
      >
        {expressionPrimary.surface}
      </h1>
      {languageStructure && (
        <p className="mt-4 text-learning-support text-fg-tertiary">
          {[
            languageStructure.expressionTypeLabel,
            languageStructure.partOfSpeech,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="mt-7 text-learning-sense">{senseConfirmation.meaning}</p>
      {pronunciation && (
        <div className="mt-5 space-y-3 text-learning-support text-fg-tertiary">
          <span>
            {[pronunciation.accentLabel, pronunciation.phoneticNotation]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {pronunciation.audioUrl && (
            <audio
              aria-label={t("runtime.audio")}
              className="h-10 w-full max-w-sm"
              controls
              preload="none"
              src={pronunciation.audioUrl}
              onError={() => setAudioFailed(true)}
            />
          )}{" "}
          {audioFailed && <p role="status">{t("runtime.audioError")}</p>}
        </div>
      )}
      {usageGuidance && (
        <blockquote className="mt-8 rounded-card border border-border-subtle bg-surface-panel p-6 text-lg leading-8 text-fg-secondary shadow-raised">
          {usageGuidance.example}
        </blockquote>
      )}
      {sceneBridge && (
        <details className="mt-6 text-learning-support text-fg-secondary">
          <summary className="min-h-11 cursor-pointer py-3">
            {t("runtime.context")}
          </summary>
          <p className="leading-7">{sceneBridge.text}</p>
        </details>
      )}
      {(onOpenPersonalScene || semanticWorldState && onSaveToSemanticWorld) && (
        <div className="mt-7 flex flex-wrap gap-3">
          {onOpenPersonalScene && (
            <button
              type="button"
              onClick={onOpenPersonalScene}
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
            >
              {t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}
            </button>
          )}
          {semanticWorldState && onSaveToSemanticWorld && (
            <button
              type="button"
              disabled={semanticWorldState === 'saved' || semanticWorldState === 'saving'}
              onClick={onSaveToSemanticWorld}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-panel px-4 text-sm text-action-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-70"
            >
              {semanticWorldState === 'saved' && <Check size={17}/>}
              {t(semanticWorldState === 'saved' ? "runtime.savedToSemanticWorld" : semanticWorldState === 'saving' ? "runtime.savingToSemanticWorld" : semanticWorldState === 'update' ? "runtime.updateSemanticWorld" : "runtime.saveToSemanticWorld")}
            </button>
          )}
        </div>
      )}
      <RuntimeRating initial={initial} onRate={onRate} />
    </section>
  );
}
