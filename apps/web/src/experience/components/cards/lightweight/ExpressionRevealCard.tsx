import {learningResourceDefinition} from '@sensa/contracts/sensa';
import {learningResourceLabel} from '../../../../i18n/resourceLabel';
import {LearningResource} from '../../learning/LearningResource';
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookHeart, Check, Pause, SquarePen, Volume2 } from "lucide-react";
import type { ExpressionRevealCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import type { LearningLightweightRating } from "../../../../learning/system";
import type { PersonalLearningSceneRevision } from "../../../../personalContent/system";
import type { DictionaryLookup, DictionaryLookupRequest, QuickDictEntry, Sentence } from "../../../types";
import { audioService } from "../../../services/audioService";
import { RuntimeRating } from "../../learning/RuntimeRating";
import { ExampleCardCarousel } from "../../examples/ExampleCardCarousel";
import { LearningExampleCard } from "../../examples/LearningExampleCard";
import { LearningExampleLookup } from "../../examples/LearningExampleLookup";
import { ClickableSentence } from "../../ClickableSentence";
import { useImmediateDictionaryLookup } from "../../useImmediateDictionaryLookup";
import { cardText } from "../../../../i18n/originalCards";

const stripMarkup = (value: string): string => value.replace(/<[^>]*>/gu, "").trim();

interface ExpressionRevealCardProps {
  readonly initial?: boolean;
  readonly active: boolean;
  readonly presentation: ExpressionRevealCardPresentation;
  readonly onRate: (rating: LearningLightweightRating) => void;
  readonly semanticWorldState?: 'available' | 'update' | 'saved' | 'saving' | null;
  readonly onSaveToSemanticWorld?: () => void;
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
  readonly onOpenDictionary: (word: string | QuickDictEntry) => void;
  readonly lookupDictionary: DictionaryLookup;
  readonly toast: (message: string) => void;
}

export function ExpressionRevealCard({
  presentation,
  active,
  initial = true,
  onRate,
  semanticWorldState = null,
  onSaveToSemanticWorld,
  personalScene,
  onOpenPersonalScene,
  onOpenDictionary,
  lookupDictionary,
  toast,
}: ExpressionRevealCardProps) {
  const { t } = useTranslation();
  const cardId = useId();
  const usagePatternLabelId = `${cardId}-usage-pattern`;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const examplePlaybackToken = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingExampleId, setPlayingExampleId] = useState<string | null>(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const [additionalExampleIndex, setAdditionalExampleIndex] = useState(0);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const {
    categoryResources,
    expressionPrimary,
    senseConfirmation,
    pronunciation,
    languageStructure,
    usageExamples,
    sceneBridge,
  } = presentation.slots;
  const exampleSentences = useMemo<readonly Sentence[]>(() => usageExamples.map((usage) => ({
    exampleId: usage.resourceKey,
    src: '',
    theme: '',
    en: usage.example,
    zh: usage.translation ?? '',
    audioUrl: usage.audioUrl ?? undefined,
    sourceKind: 'learning_example',
  })), [usageExamples]);
  const sceneExample = exampleSentences[0] ?? null;
  const additionalExamples = exampleSentences.slice(1);
  const currentAdditionalExample = additionalExamples[additionalExampleIndex] ?? additionalExamples[0] ?? null;
  const hasPersonalScene = Boolean(personalScene);
  const expressionMetadata = Array.from(new Set([
    pronunciation?.phoneticNotation,
    languageStructure?.expressionTypeLabel ?? languageStructure?.partOfSpeech,
  ].filter((item): item is string => Boolean(item))));

  useEffect(() => {
    setAdditionalExampleIndex((index) => Math.min(index, Math.max(0, additionalExamples.length - 1)));
  }, [additionalExamples.length]);

  useEffect(() => {
    setIsPlaying(false);
    setAudioFailed(false);
    return () => {
      examplePlaybackToken.current += 1;
      audioService.stop();
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    };
  }, [pronunciation?.audioUrl]);

  const togglePronunciation = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      audio.currentTime = 0;
      setIsPlaying(false);
      return;
    }
    examplePlaybackToken.current += 1;
    audioService.stop();
    setPlayingExampleId(null);
    setAudioFailed(false);
    void audio.play().then(() => setIsPlaying(true)).catch(() => {
      setIsPlaying(false);
      setAudioFailed(true);
    });
  };

  const stopExamplePlayback = () => {
    examplePlaybackToken.current += 1;
    audioService.stop();
    setPlayingExampleId(null);
  };

  const toggleExamplePlayback = (sentence: Sentence) => {
    const exampleId = sentence.exampleId;
    if (!exampleId || !sentence.audioUrl) return;
    if (playingExampleId === exampleId) {
      stopExamplePlayback();
      return;
    }
    const expressionAudio = audioRef.current;
    if (expressionAudio) {
      expressionAudio.pause();
      expressionAudio.currentTime = 0;
    }
    setIsPlaying(false);
    const token = examplePlaybackToken.current + 1;
    examplePlaybackToken.current = token;
    setPlayingExampleId(exampleId);
    void audioService.playPackagedAudioUrl(
      sentence.audioUrl,
      sentence.en.replace(/<[^>]*>/gu, ''),
      'us',
    ).finally(() => {
      if (examplePlaybackToken.current === token) setPlayingExampleId(null);
    });
  };

  const selectAdditionalExample = (index: number) => {
    if (index !== additionalExampleIndex) stopExamplePlayback();
    clearLookup();
    setAdditionalExampleIndex(index);
  };

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (activeLookup || document.querySelector(`[role="${'dialog'}"]`)) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) return;
      if (event.key === ' ') {
        if (!pronunciation?.audioUrl && !sceneExample?.audioUrl) return;
        event.preventDefault();
        if (playingExampleId) stopExamplePlayback();
        else if (pronunciation?.audioUrl) togglePronunciation();
        else if (sceneExample) toggleExamplePlayback(sceneExample);
        return;
      }
      const rating = event.key === '1' ? 'again' : event.key === '2' ? 'hard' : event.key === '3' ? 'good' : null;
      if (rating) {
        event.preventDefault();
        onRate(rating);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, activeLookup, onRate, playingExampleId, pronunciation?.audioUrl, sceneExample]);

  const renderExample = (sentence: Sentence) => (
    <LearningExampleCard
      sentence={sentence}
      compact
      isPlaying={playingExampleId === sentence.exampleId}
      onPlay={sentence.audioUrl
        ? () => toggleExamplePlayback(sentence)
        : undefined}
      sentenceContent={(
        <ClickableSentence
          sentenceHtml={sentence.en}
          activeTokenIdx={activeLookup?.tokenIdx ?? null}
          onWordClick={(token, tokenIdx) => {
            const request: DictionaryLookupRequest = {
              rawClickedForm: token.text,
              exampleId: sentence.exampleId!,
              textL2: stripMarkup(sentence.en),
              clickedStart: token.charStart,
              clickedEnd: token.charEnd,
              clickedSurface: token.text,
            };
            openLookup({
              tokenIdx,
              displayWord: token.cleanWord,
              load: async (signal) => {
                const entry = await lookupDictionary(request, { signal });
                if (!entry) toast(cardText('thisWordIsNotInTheDictionary'));
                return entry;
              },
            });
          }}
        />
      )}
    />
  );

  return (
    <section
      className="sensa-expression-reveal sensa-lightweight-card flex w-full flex-col gap-5"
      aria-live="polite"
      aria-label={t("runtime.revealStep")}
    >
      <div className="sensa-expression-hero">
        <header className="sensa-expression-heading">
          <div className="flex items-start gap-4">
            <h1 className="min-w-0 flex-1 break-words font-language text-learning-expression font-medium tracking-tight text-action-primary sm:text-6xl">
              {expressionPrimary.surface}
            </h1>
            {pronunciation?.audioUrl && (
              <>
                <audio
                  ref={audioRef}
                  hidden
                  preload="none"
                  src={pronunciation.audioUrl}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => {
                    setIsPlaying(false);
                    setAudioFailed(true);
                  }}
                />
                <div className="flex shrink-0 flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={togglePronunciation}
                    className={`sensa-expression-audio grid size-12 place-items-center rounded-card text-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${isPlaying ? "is-playing bg-action-primary text-action-on-primary" : "bg-accent-soft hover:bg-surface-selected"}`}
                    aria-label={t(isPlaying ? "runtime.stopAudio" : "runtime.audio")}
                  >
                    {isPlaying ? <Pause size={20} /> : <Volume2 size={20} />}
                  </button>
                  <kbd className="sensa-shortcut-hint" aria-hidden="true">Space</kbd>
                </div>
              </>
            )}
          </div>

          {expressionPrimary.spokenForm && expressionPrimary.spokenForm!==expressionPrimary.surface && <p className="mt-3 font-language text-base text-fg-secondary">{expressionPrimary.spokenForm}</p>}
          {expressionMetadata.length > 0 && (
            <p className="sensa-expression-metadata" aria-label={expressionMetadata.join(" · ")}>
              {expressionMetadata.join(" · ")}
            </p>
          )}
          {audioFailed && <p className="mt-3 text-sm text-fg-secondary" role="status">{t("runtime.audioError")}</p>}
          <p className="sensa-expression-meaning">{senseConfirmation.meaning}</p>
        </header>

        {sceneBridge && (
          <p className="sensa-expression-scene-bridge mt-7 border-l-2 border-action-primary pl-4 text-base leading-7 text-fg-secondary">
            {sceneBridge.text}
          </p>
        )}

        {languageStructure?.usagePattern && (
          <section className="sensa-expression-structure mt-6 grid gap-2 border-t border-border-subtle pt-5" aria-labelledby={usagePatternLabelId}>
            <h2 id={usagePatternLabelId} className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{t("runtime.usagePattern")}</h2>
            <p className="font-language text-base font-semibold leading-7 text-action-primary">{languageStructure.usagePattern}</p>
          </section>
        )}
      </div>

      {sceneExample && sceneExample.en.trim() !== expressionPrimary.surface.trim() && (
        <div className="sensa-expression-scene-example pb-5" aria-label={t("runtime.sceneExample")}>
          {renderExample(sceneExample)}
        </div>
      )}

      {additionalExamples.length > 0 && (
        <div className="sensa-expression-disclosures border-y border-border-subtle">
          <details className="sensa-expression-disclosure">
            <summary>{t("runtime.moreExamples")}</summary>
            <div className="sensa-expression-more">
              {additionalExamples.length > 0 && currentAdditionalExample && (
              <div className="sensa-expression-additional-examples">
                <ExampleCardCarousel
                  itemCount={additionalExamples.length}
                  currentIndex={additionalExampleIndex}
                  onIndexChange={selectAdditionalExample}
                  itemKeys={usageExamples.slice(1).map((usage) => usage.resourceKey)}
                  className="sensa-lightweight-examples"
                >
                  {renderExample(currentAdditionalExample)}
                </ExampleCardCarousel>
              </div>
              )}

            </div>
          </details>
        </div>
      )}

      {languageStructure?.contrastNote && <details className="sensa-expression-disclosure"><summary>{t('runtime.contrastNote')}</summary><p className="text-sm leading-7 text-fg-secondary">{languageStructure.contrastNote}</p></details>}

      {(onOpenPersonalScene || hasPersonalScene && semanticWorldState && onSaveToSemanticWorld) && (
        <div className="sensa-expression-personal-actions">
          {onOpenPersonalScene && (
            <button
              type="button"
              onClick={onOpenPersonalScene}
              className="sensa-personal-action sensa-personal-action-scene inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-4 text-sm font-medium text-fg-secondary hover:bg-surface-subtle hover:text-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
              {t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}
            </button>
          )}
          {hasPersonalScene && semanticWorldState && onSaveToSemanticWorld && (
            <button
              type="button"
              disabled={semanticWorldState === 'saved' || semanticWorldState === 'saving'}
              onClick={onSaveToSemanticWorld}
              className="sensa-personal-action sensa-personal-action-semantic inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-accent-soft px-4 text-sm font-medium text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-70"
            >
              {semanticWorldState === 'saved'
                ? <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                : <BookHeart size={16} strokeWidth={1.75} aria-hidden="true" />}
              {t(semanticWorldState === 'saved'
                ? "runtime.savedToSemanticWorld"
                : semanticWorldState === 'saving'
                  ? "runtime.savingToSemanticWorld"
                  : semanticWorldState === 'update'
                    ? "runtime.updateSemanticWorld"
                    : "runtime.saveToSemanticWorld")}
            </button>
          )}
        </div>
      )}

      {categoryResources?.map(resource=><details key={resource.resourceKey} className="sensa-expression-disclosure"><summary>{learningResourceLabel(resource.materialRoleKey)}</summary><LearningResource resource={resource}/></details>)}
      <RuntimeRating initial={initial} showDescriptions={false} onRate={onRate} />
      {activeLookup && (
        <LearningExampleLookup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={(entry) => {
            clearLookup();
            onOpenDictionary(entry);
          }}
        />
      )}
    </section>
  );
}
