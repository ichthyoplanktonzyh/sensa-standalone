import type { ReactNode } from 'react';
import { cardText } from '../../../i18n/originalCards';
import type { Sentence, SyncedExampleMediaRender } from '../../types';
import { audioService } from '../../services/audioService';
import { ClickableSentence } from '../ClickableSentence';

interface LearningExampleSense {
  readonly expression: string;
  readonly label: string;
  readonly definition?: string;
}

interface LearningExampleCardProps {
  readonly targetLanguageTag?: string;
  readonly supportLanguageTag?: string;
  readonly sentence: Sentence;
  readonly sentenceContent?: ReactNode;
  readonly active?: boolean;
  readonly compact?: boolean;
  readonly lookupEnabled?: boolean;
  readonly isPlaying?: boolean;
  readonly onPlay?: () => void;
  readonly showTranslation?: boolean;
  readonly onToggleTranslation?: () => void;
  readonly sense?: LearningExampleSense;
  readonly showContext?: boolean;
  readonly onToggleContext?: () => void;
}

function SyncedMediaSurface({ render }: { readonly render: SyncedExampleMediaRender }) {
  return (
    <section className="sensa-example-media" aria-label={cardText('originalAudio', { provider: render.providerLabel })}>
      {render.kind === 'video' ? (
        <video
          controls
          preload="metadata"
          poster={render.posterUrl}
          src={render.playbackUrl}
          onPlay={() => audioService.stop()}
        >
          {cardText('thisBrowserCannotPlayThisReviewedMedia')}
        </video>
      ) : (
        <iframe
          src={render.embedUrl}
          title={cardText('originalAudio', { provider: render.providerLabel })}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      <footer>
        <span>{render.providerLabel}</span>
        {render.rightsLabel && <small>{render.rightsLabel}</small>}
        {render.sourceUrl && (
          <a href={render.sourceUrl} target="_blank" rel="noreferrer">{cardText('viewSource')}</a>
        )}
      </footer>
    </section>
  );
}

/**
 * Shared visual body for reviewed Learning Examples.
 *
 * Optional controls collapse when their corresponding reviewed data or host
 * action is absent. This lets lightweight learning reuse the same example
 * surface without implying that translation, audio, or provenance exists.
 */
export function LearningExampleCard({
  sentence,
  targetLanguageTag,
  supportLanguageTag,
  sentenceContent,
  active = false,
  compact = false,
  lookupEnabled = false,
  isPlaying = false,
  onPlay,
  showTranslation = true,
  onToggleTranslation,
  sense,
  showContext = false,
  onToggleContext,
}: LearningExampleCardProps) {
  const hasSource = !compact && Boolean(sentence.src);
  const hasTranslation = Boolean(sentence.zh);
  const hasContext = Boolean(sentence.contextL2 || sentence.contextL1);

  return (
    <article
      className="sensa-example-viewer sensa-learning-example-card"
      data-compact={compact ? 'true' : undefined}
    >
      {hasSource && (
        <div className="sensa-example-source">
          <div>
            <span>{sentence.sourceKind === 'attested_usage' ? cardText('reviewedAuthenticUsage') : cardText('reviewedLearningExample')}</span>
            <strong>{sentence.src}</strong>
          </div>
          <small>
            {sentence.syncedMedia?.providerLabel
              ?? (sentence.audioUrl ? cardText('textRecordedAudio') : cardText('text'))}
          </small>
        </div>
      )}

      {active && sentence.syncedMedia && <SyncedMediaSurface render={sentence.syncedMedia} />}

      <section className="sensa-example-sentence" aria-label={cardText('currentExample')}>
        {lookupEnabled && <p className="example-lookup-hint">{cardText('tapAWordForItsDefinition')}</p>}
        {onPlay && (
          <button
            type="button"
            className={`sensa-example-play${isPlaying ? ' is-playing' : ''}`}
            onClick={onPlay}
            aria-label={isPlaying ? cardText('stopExampleAudio') : cardText('playExampleAudio')}
          >
            {isPlaying ? (
              <span aria-hidden="true">Ⅱ</span>
            ) : (
              <svg className="size-[1.375rem] shrink-0" aria-hidden="true"><use href="#i-vol" /></svg>
            )}
          </button>
        )}
        <div lang={targetLanguageTag} dir="auto" className="sensa-example-l2">
          {sentenceContent ?? <ClickableSentence sentenceHtml={sentence.en} />}
        </div>
        {hasTranslation && showTranslation && <p lang={supportLanguageTag} dir="auto" className="sensa-example-l1">{sentence.zh}</p>}
        {hasTranslation && onToggleTranslation && (
          <button
            type="button"
            className="sensa-example-translation"
            aria-expanded={showTranslation}
            onClick={onToggleTranslation}
          >
            {showTranslation ? cardText('hideTranslation') : cardText('showTranslation')}
          </button>
        )}
      </section>

      {sense && (
        <section className="sensa-example-sense-anchor">
          <span>{cardText('expressionInThisSentence')}{sense.expression}</span>
          <strong>{sense.label}</strong>
          {sense.definition && (
            <details>
              <summary>{cardText('viewMeaningBoundaries')}</summary>
              <p>{sense.definition}</p>
            </details>
          )}
        </section>
      )}

      {hasContext && onToggleContext && (
        <section className={`sensa-example-context${showContext ? ' is-open' : ''}`}>
          <button type="button" aria-expanded={showContext} onClick={onToggleContext}>
            <span>{cardText('fullContext')}</span>
            <b aria-hidden="true">{showContext ? '−' : '+'}</b>
          </button>
          {showContext && (
            <div>
              {sentence.contextL2 && <p>{sentence.contextL2}</p>}
              {sentence.contextL1 && <small>{sentence.contextL1}</small>}
            </div>
          )}
        </section>
      )}
    </article>
  );
}
