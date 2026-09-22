import {cardText} from '../../i18n/originalCards';
import { personalContentSystem } from '../../personalContent/system';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DictionaryLookupRequest,
} from '../types';
import { audioService } from '../services/audioService';
import { ClickableSentence } from './ClickableSentence';
import type { ExampleScreenProps } from './ExampleScreen';
import { LearningExampleLookup } from './examples/LearningExampleLookup';
import { useImmediateDictionaryLookup } from './useImmediateDictionaryLookup';
import { ExampleCardCarousel } from './examples/ExampleCardCarousel';
import { LearningExampleCard } from './examples/LearningExampleCard';

const stripMarkup = (value: string): string => value.replace(/<[^>]*>/g, '').trim();

export function SensaExampleScreen({
  active,
  curWord,
  initialSenseIdx = 0,
  initialSentenceIdx = 0,
  sentenceSequence,
  screenId = 's-example',
  onClose,
  onOpenDict,
  toast,
}: ExampleScreenProps) {
  const senseDetails = useMemo(() => (
    curWord.senseDetails && curWord.senseDetails.length > 0
      ? curWord.senseDetails
      : [{
          id: curWord.id,
          pos: curWord.senses[0]?.pos || '',
          text: curWord.senses[0]?.items[0] || cardText('currentMeaning'),
          def: curWord.def,
          sentences: curWord.sentences,
        }]
  ), [curWord]);
  const [senseIndex, setSenseIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const [, setPersonalContentRevision] = useState(0);
  const playbackToken = useRef(0);
  const wordIdentity = curWord.id ?? curWord.w;
  const sequenceIdentity = sentenceSequence?.join(',') ?? '';

  const sense = senseDetails[senseIndex] ?? senseDetails[0];
  const availableSentences = sense?.sentences?.length ? sense.sentences : curWord.sentences;
  const sentences = useMemo(() => {
    const requestedIndices = sentenceSequence?.length
      ? Array.from(new Set(sentenceSequence))
      : [initialSentenceIdx];
    const authorized = requestedIndices.flatMap((index) => {
      const item = availableSentences[index];
      return item ? [item] : [];
    });
    return authorized;
  }, [availableSentences, initialSentenceIdx, sentenceSequence]);
  const sentence = sentences[sentenceIndex] ?? sentences[0] ?? null;
  const exampleId = sentence?.exampleId
    ?? `${curWord.id ?? curWord.w}:example:${senseIndex}:${sentence ? availableSentences.indexOf(sentence) : initialSentenceIdx}`;
  const isSaved = personalContentSystem.read({ kind: 'example', exampleId });
  const hasPrevious = sentenceIndex > 0;
  const hasNext = sentenceIndex < sentences.length - 1;

  const stopPlayback = useCallback(() => {
    playbackToken.current += 1;
    audioService.stop();
    setIsPlaying(false);
  }, []);

  const switchSentence = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= sentences.length || nextIndex === sentenceIndex) return;
    stopPlayback();
    setSentenceIndex(nextIndex);
    clearLookup();
    setShowContext(false);
  }, [clearLookup, sentenceIndex, sentences.length, stopPlayback]);

  useEffect(() => {
    const nextSenseIndex = Math.min(
      Math.max(0, initialSenseIdx),
      Math.max(0, senseDetails.length - 1),
    );
    setSenseIndex(nextSenseIndex);
    setSentenceIndex(0);
    setShowTranslation(true);
    setShowContext(false);
    clearLookup();
    if (active) stopPlayback();
    // Sense Versions are immutable in one installed release, so identity—not
    // the presentation object's allocation—controls viewer reset.
  }, [active, clearLookup, initialSenseIdx, initialSentenceIdx, senseDetails.length, sequenceIdentity, stopPlayback, wordIdentity]);

  useEffect(
    () => personalContentSystem.subscribe({ kind: 'example', exampleId }, () => {
      setPersonalContentRevision((revision) => revision + 1);
    }),
    [exampleId],
  );

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeLookup) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, button, a')) return;
      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault();
        switchSentence(sentenceIndex - 1);
      }
      if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        switchSentence(sentenceIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopPlayback();
    };
  }, [activeLookup, active, hasNext, hasPrevious, sentenceIndex, stopPlayback, switchSentence]);

  const playSentence = () => {
    if (!sentence) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const text = stripMarkup(sentence.en);
    if (!sentence.audioUrl && curWord.id && !curWord.id.startsWith('w_')) {
      toast(cardText('thisExampleHasNoPlayableReviewedAudioYet'));
      return;
    }

    const token = playbackToken.current + 1;
    playbackToken.current = token;
    setIsPlaying(true);
    const playback = sentence.audioUrl
      ? sentence.audioUrl.startsWith('/golden-audio/')
        ? audioService.playPackagedAudioUrl(sentence.audioUrl, text, 'us')
        : audioService.playAudioUrl(sentence.audioUrl, text, 'us')
      : audioService.playSentence(text, 'us');
    void playback.catch(() => {
      if (playbackToken.current === token) toast(cardText('audioCouldNotPlayTryAgain'));
    }).finally(() => {
      if (playbackToken.current === token) setIsPlaying(false);
    });
  };

  const close = () => {
    stopPlayback();
    clearLookup();
    onClose();
  };

  return (
    <section
      className={`screen sensa-example-screen${active ? ' active' : ''}`}
      id={screenId}
      data-screen-layer="0.5"
      data-learning-example="true"
      data-anim="slide"
    >
      <header className="sensa-example-topbar">
        <button type="button" onClick={close} aria-label={cardText('returnToLearning')}>
          <svg className="size-[1.375rem] shrink-0" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <div>
          <strong>{curWord.w}</strong>
          <span>{sense?.pos} {sense?.text}</span>
        </div>
        <button
          type="button"
          className={isSaved ? 'is-saved' : ''}
          disabled={!sentence}
          aria-pressed={isSaved}
          onClick={() => { void (async () => {
            try {
              const saved = await personalContentSystem.execute({
                kind: 'set_saved_example',
                operationId: crypto.randomUUID(),
                exampleId,
                saved: !isSaved,
              });
              toast(saved ? cardText('exampleSaved') : cardText('exampleRemovedFromSavedItems'));
            } catch {
              toast(cardText('couldNotSaveThisExampleTryAgain'));
            }
          })(); }}
          aria-label={isSaved ? cardText('unsaveThisExample') : cardText('saveThisExample')}
        >
          <svg className="size-[1.375rem] shrink-0" aria-hidden="true"><use href="#i-star" /></svg>
        </button>
      </header>

      <div className="sensa-example-scroll">
        <ExampleCardCarousel
          itemCount={sentences.length}
          currentIndex={sentenceIndex}
          onIndexChange={switchSentence}
          itemKeys={sentences.map((entry, index) => entry.exampleId ?? String(index))}
        >
          {sentence ? (
            <LearningExampleCard
              sentence={sentence}
              active={active}
              lookupEnabled
              isPlaying={isPlaying}
              onPlay={playSentence}
              showTranslation={showTranslation}
              onToggleTranslation={() => setShowTranslation((visible) => !visible)}
              sense={{
                expression: curWord.w,
                label: [sense?.pos, sense?.text].filter(Boolean).join(' '),
                definition: sense?.def ? stripMarkup(sense.def) : undefined,
              }}
              showContext={showContext}
              onToggleContext={() => setShowContext((visible) => !visible)}
              sentenceContent={(
                <ClickableSentence
                  sentenceHtml={sentence.en}
                  activeTokenIdx={activeLookup?.tokenIdx ?? null}
                  onWordClick={(token, tokenIdx) => {
                    const request: DictionaryLookupRequest = {
                      rawClickedForm: token.text,
                      exampleId,
                      textL2: stripMarkup(sentence.en),
                      clickedStart: token.charStart,
                      clickedEnd: token.charEnd,
                      clickedSurface: token.text,
                    };
                    openLookup({
                      tokenIdx,
                      displayWord: token.cleanWord,
                      load: async (signal) => {
                        const { lookupDictionaryEntry } = await import('../services/quickDict');
                        const entry = await lookupDictionaryEntry(request, { signal });
                        if (!entry) toast(cardText('thisWordIsNotInTheDictionary'));
                        return entry;
                      },
                    });
                  }}
                />
              )}
            />
          ) : (
            <div className="sensa-example-unavailable" role="status">
              <strong>{cardText('thisLearningResourceIsUnavailable')}</strong>
              <p>{cardText('thisMeaningHasNoReviewedExamplesToDisplay')}</p>
            </div>
          )}
        </ExampleCardCarousel>
      </div>

      <footer className="sensa-example-footer">
        <button type="button" onClick={close}>{cardText('returnToLearning')}</button>
        <p>{cardText('viewingPlayingAndSavingDoNotChangeLearning')}</p>
      </footer>

      {active && activeLookup && (
        <LearningExampleLookup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={onOpenDict ? (entry) => {
            clearLookup();
            onOpenDict(entry);
          } : undefined}
        />
      )}
    </section>
  );
}
