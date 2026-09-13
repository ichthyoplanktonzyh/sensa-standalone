import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExpressionRevealCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import type { LightweightInitialRating } from "../../../../learning/runtime/lightweightInitialProtocol";
import { RuntimeRating } from "../../learning/RuntimeRating";
interface ExpressionRevealCardProps {
  readonly initial?: boolean;
  readonly presentation: ExpressionRevealCardPresentation;
  readonly onRate: (rating: LightweightInitialRating) => void;
}
export function ExpressionRevealCard({
  presentation,
  initial = true,
  onRate,
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
      <p className="mb-5 text-xs text-[#7c879a]">{t("runtime.compare")}</p>
      <h1
        id="lightweight-expression-reveal-title"
        className="break-words text-5xl font-medium leading-tight tracking-tight text-[#2b3854] sm:text-6xl"
      >
        {expressionPrimary.surface}
      </h1>
      {languageStructure && (
        <p className="mt-4 text-sm text-[#7d879a]">
          {[
            languageStructure.expressionTypeLabel,
            languageStructure.partOfSpeech,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="mt-7 text-xl leading-8">{senseConfirmation.meaning}</p>
      {pronunciation && (
        <div className="mt-5 space-y-3 text-sm text-[#7d879a]">
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
        <blockquote className="mt-8 rounded-xl border border-[#e1e6ef] bg-white p-6 text-lg leading-8 text-[#4d5e7a]">
          {usageGuidance.example}
        </blockquote>
      )}
      {sceneBridge && (
        <details className="mt-6 text-sm text-[#79859a]">
          <summary className="min-h-11 cursor-pointer py-3">
            {t("runtime.context")}
          </summary>
          <p className="leading-7">{sceneBridge.text}</p>
        </details>
      )}
      <RuntimeRating initial={initial} onRate={onRate} />
    </section>
  );
}
