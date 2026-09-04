import type { ExpressionRevealCardPresentation } from '../../../learningRuntime/lightweightInitialPresentation';
import type { LightweightInitialRating } from '../../../learningRuntime/lightweightInitialProtocol';

interface ExpressionRevealCardProps {
  readonly presentation: ExpressionRevealCardPresentation;
  readonly onRate: (rating: LightweightInitialRating) => void;
}

export const ExpressionRevealCard = ({
  presentation,
  onRate,
}: ExpressionRevealCardProps) => {
  const {
    expressionPrimary,
    senseConfirmation,
    pronunciation,
    languageStructure,
    usageGuidance,
    sceneBridge,
  } = presentation.slots;
  const structureLabel = languageStructure
    ? [languageStructure.expressionTypeLabel, languageStructure.partOfSpeech]
        .filter((value): value is string => value !== null)
        .join(' · ')
    : null;

  return (
    <section
      className="lightweight-runtime-stage lightweight-expression-reveal"
      aria-live="polite"
      aria-labelledby="lightweight-expression-reveal-title"
    >
      <div className="lightweight-expression-primary">
        <h1 id="lightweight-expression-reveal-title">{expressionPrimary.surface}</h1>
      </div>

      {structureLabel && (
        <div className="lightweight-language-structure-slot">{structureLabel}</div>
      )}

      <div className="lightweight-sense-confirmation">
        <p>{senseConfirmation.meaning}</p>
      </div>

      {pronunciation && (
        <div className="lightweight-pronunciation-slot">
          {pronunciation.audioUrl && <audio controls src={pronunciation.audioUrl} />}
          {pronunciation.accentLabel && <span>{pronunciation.accentLabel}</span>}
          {pronunciation.phoneticNotation && <i>{pronunciation.phoneticNotation}</i>}
        </div>
      )}
      {usageGuidance && (
        <blockquote className="lightweight-usage-slot">{usageGuidance.example}</blockquote>
      )}
      {sceneBridge && (
        <div className="lightweight-scene-bridge-slot">{sceneBridge.text}</div>
      )}

      <div className="lightweight-rating" role="group" aria-label="评价刚才的回想">
        <button type="button" className="is-again" onClick={() => onRate('again')}>
          <strong>没想起</strong><small>再回想一次</small>
        </button>
        <button type="button" className="is-hard" onClick={() => onRate('hard')}>
          <strong>想起但费力</strong><small>完成本次学习</small>
        </button>
        <button type="button" className="is-good" onClick={() => onRate('good')}>
          <strong>顺利想起</strong><small>完成本次学习</small>
        </button>
      </div>
    </section>
  );
};
