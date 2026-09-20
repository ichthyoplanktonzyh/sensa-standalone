import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pause, Volume2 } from "lucide-react";
import type { ExpressionRevealCardPresentation } from "../../../learningRuntime/lightweightInitialPresentation";
import type { LightweightInitialRating } from "../../../../learning/runtime/lightweightInitialProtocol";
import type { PersonalLearningSceneRevision } from "../../../../data/library/contentAnnotations";
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
  readonly onRate: (rating: LightweightInitialRating) => void;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const examplePlaybackToken = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingExampleId, setPlayingExampleId] = useState<string | null>(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const {
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
  const currentExample = exampleSentences[exampleIndex] ?? exampleSentences[0] ?? null;
  const expressionMetadata = [
    pronunciation?.accentLabel,
    pronunciation?.phoneticNotation,
    languageStructure?.expressionTypeLabel,
    languageStructure?.partOfSpeech,
  ].filter((item): item is string => Boolean(item));

  useEffect(() => {
    setExampleIndex((index) => Math.min(index, Math.max(0, exampleSentences.length - 1)));
  }, [exampleSentences.length]);

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

  const selectExample = (index: number) => {
    if (index !== exampleIndex) stopExamplePlayback();
    clearLookup();
    setExampleIndex(index);
  };

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (activeLookup || document.querySelector(`[role="${'dialog'}"]`)) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' && exampleIndex > 0) {
        event.preventDefault();
        selectExample(exampleIndex - 1);
        return;
      }
      if (event.key === 'ArrowRight' && exampleIndex < exampleSentences.length - 1) {
        event.preventDefault();
        selectExample(exampleIndex + 1);
        return;
      }
      if (event.key === ' ') {
        if (!pronunciation?.audioUrl && !currentExample?.audioUrl) return;
        event.preventDefault();
        if (playingExampleId) stopExamplePlayback();
        else if (pronunciation?.audioUrl) togglePronunciation();
        else if (currentExample) toggleExamplePlayback(currentExample);
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
  }, [active, activeLookup, currentExample, exampleIndex, exampleSentences.length, onRate, playingExampleId, pronunciation?.audioUrl]);

  return (
    <section
      className="sensa-expression-reveal sensa-lightweight-card"
      aria-live="polite"
      aria-label={t("runtime.revealStep")}
    >
      <div className="sensa-expression-hero">
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

        {expressionMetadata.length > 0 && (
          <div className="sensa-expression-metadata" aria-label={expressionMetadata.join(" · ")}>
            {expressionMetadata.map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
        {audioFailed && <p className="mt-3 text-sm text-fg-secondary" role="status">{t("runtime.audioError")}</p>}

        <p className="sensa-expression-meaning">{senseConfirmation.meaning}</p>

        {sceneBridge && <p className="sensa-expression-scene-bridge">{sceneBridge.text}</p>}

        {languageStructure?.usagePattern && (
          <div className="sensa-expression-structure">
            <span>{t("runtime.usagePattern")}</span>
            <strong>{languageStructure.usagePattern}</strong>
          </div>
        )}
        {languageStructure?.contrastNote && (
          <p className="sensa-expression-contrast"><span>{t("runtime.contrastNote")}</span>{languageStructure.contrastNote}</p>
        )}
      </div>

      {currentExample && (
        <div className="sensa-expression-examples">
          <ExampleCardCarousel
            itemCount={exampleSentences.length}
            currentIndex={exampleIndex}
            onIndexChange={selectExample}
            itemKeys={usageExamples.map((usage) => usage.resourceKey)}
            className="sensa-lightweight-examples"
          >
            <LearningExampleCard
              sentence={currentExample}
              compact
              lookupEnabled
              isPlaying={playingExampleId === currentExample.exampleId}
              onPlay={currentExample.audioUrl
                ? () => toggleExamplePlayback(currentExample)
                : undefined}
              sentenceContent={(
                <ClickableSentence sentenceHtml={currentExample.en} activeTokenIdx={activeLookup?.tokenIdx ?? null} onWordClick={(token,tokenIdx)=>{
                  const request:DictionaryLookupRequest={rawClickedForm:token.text,exampleId:currentExample.exampleId!,textL2:stripMarkup(currentExample.en),clickedStart:token.charStart,clickedEnd:token.charEnd,clickedSurface:token.text};
                  openLookup({tokenIdx,displayWord:token.cleanWord,load:async(signal)=>{const entry=await lookupDictionary(request,{signal});if(!entry)toast(cardText('thisWordIsNotInTheDictionary'));return entry;}});
                }}/>
              )}
            />
          </ExampleCardCarousel>
        </div>
      )}

      {(onOpenPersonalScene || semanticWorldState && onSaveToSemanticWorld) && (
        <div className="sensa-expression-personal-actions">
          {onOpenPersonalScene && (
            <button
              type="button"
              onClick={onOpenPersonalScene}
              className="min-h-11 px-1 text-sm text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {t(personalScene ? "runtime.editMyScene" : "runtime.addMyScene")}
            </button>
          )}
          {semanticWorldState && onSaveToSemanticWorld && (
            <button
              type="button"
              disabled={semanticWorldState === 'saved' || semanticWorldState === 'saving'}
              onClick={onSaveToSemanticWorld}
              className="inline-flex min-h-11 items-center gap-2 px-1 text-sm text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:no-underline disabled:opacity-70"
            >
              {semanticWorldState === 'saved' && <Check size={17}/>}
              {t(semanticWorldState === 'saved' ? "runtime.savedToSemanticWorld" : semanticWorldState === 'saving' ? "runtime.savingToSemanticWorld" : semanticWorldState === 'update' ? "runtime.updateSemanticWorld" : "runtime.saveToSemanticWorld")}
            </button>
          )}
        </div>
      )}

      <RuntimeRating initial={initial} showDescriptions={false} onRate={onRate} />
      {activeLookup && <LearningExampleLookup entry={activeLookup.entry} onClose={clearLookup} toast={toast} onViewDetail={(entry)=>{clearLookup();onOpenDictionary(entry);}}/>}
    </section>
  );
}
