import {cardText} from '../../../i18n/originalCards';
import { useEffect, useRef, useState } from 'react';
import type { RuntimeLearningContent } from '../../../learning/content/learningCatalog';
import type {
  DictionaryLookup,
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
} from '../../types';
import { audioService } from '../../services/audioService';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import { ExperienceRenderer } from './ExperienceRenderer';

export type IntroductionPhase = 'experience' | 'reveal';

interface IntroductionCardProps {
  content: RuntimeLearningContent;
  phase: IntroductionPhase;
  mode?: 'introduction' | 'repair_replay';
  repairPurpose?: 'acquisition' | 'retention';
  onPhaseChange: (phase: IntroductionPhase) => void;
  onComplete: () => void;
  onOpenExample: (sentenceIndex?: number) => void;
  onOpenDictionary: (word?: string | QuickDictEntry) => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  toast: (message: string) => void;
}

const SoundIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 10v4h3l4 3V7L8 10H5Z" />
    <path d="M15 9.2c1.4 1.5 1.4 4.1 0 5.6M17.8 6.8c2.8 2.9 2.8 7.5 0 10.4" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

const OpenIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5H5v14h14v-3M12 5h7v7M19 5l-8 8" />
  </svg>
);

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 8H3V4" />
    <path d="M4 8a8 8 0 1 1-1 7" />
  </svg>
);

export function IntroductionCard({
  content,
  phase,
  mode = 'introduction',
  repairPurpose = 'retention',
  onPhaseChange,
  onComplete,
  onOpenExample,
  onOpenDictionary,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  toast,
}: IntroductionCardProps) {
  const isRepairReplay = mode === 'repair_replay';
  const repairContext = repairPurpose === 'acquisition'
    ? {
        title: cardText('targetedRepairDuringLearning'),
        body: cardText('rebuildThisConnectionThenCheckItIndependentlyAgain'),
      }
    : {
        title: cardText('replayAfterReview'),
        body: cardText('rebuildTheMeaningConnectionWithoutGradingThisReview'),
      };
  const continuationLabel = !isRepairReplay
    ? cardText('continueAndMeetItAgainLater')
    : repairPurpose === 'acquisition'
    ? cardText('finishRepairAndCheckAgainLater')
    : cardText('returnToReviewFeedback');
  const lookupExampleToken = async (
    token: {
      text: string;
      cleanWord: string;
      charStart: number;
      charEnd: number;
    },
    exampleId: string,
    textL2: string,
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const request: DictionaryLookupRequest = {
      rawClickedForm: token.text,
      exampleId,
      textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: token.text,
    };
    const entry = await lookupDictionary(request, options);
    if (!entry) {
      toast(cardText('thisWordIsNotInTheCurrentReference'));
    }
    return entry;
  };
  const revealHeadingRef = useRef<HTMLHeadingElement>(null);
  const [pronunciationIndex, setPronunciationIndex] = useState(0);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    clearLookup();
    setPronunciationIndex(0);
    if (phase !== 'reveal') return;
    const frame = requestAnimationFrame(() => revealHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [clearLookup, content.senseKey, phase]);

  if (phase === 'reveal') {
    const example = content.studyExample;
    const exampleHtml = `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
    const primaryPattern = content.supportTabs.flatMap((support) => support.patterns)[0] ?? null;
    const visibleCollocations = primaryPattern?.commonCollocations.slice(0, 2) ?? [];
    const activePronunciation = content.pronunciations[pronunciationIndex]
      ?? content.pronunciations[0]
      ?? null;

    const playPronunciation = (index: number, announceNext = false) => {
      const pronunciation = content.pronunciations[index];
      if (!pronunciation) return;
      const isUk = pronunciation.accentLocale === 'en-GB';
      const accent = isUk ? 'uk' : 'us';
      if (pronunciation.audioUrl) {
        void audioService.playPackagedAudioUrl(
          pronunciation.audioUrl,
          content.lemma,
          accent,
        );
      }

      if (!announceNext || content.pronunciations.length < 2) {
        toast(cardText('playing',{accent:isUk ? cardText('british') : cardText('american')}));
        return;
      }

      const nextIndex = (index + 1) % content.pronunciations.length;
      const nextIsUk = content.pronunciations[nextIndex]?.accentLocale === 'en-GB';
      setPronunciationIndex(nextIndex);
      toast(cardText('playingNext',{accent:isUk ? cardText('british') : cardText('american'),next:nextIsUk ? cardText('british') : cardText('american')}));
    };

    const activeIsUk = activePronunciation?.accentLocale === 'en-GB';
    const nextPronunciation = content.pronunciations.length > 1
      ? content.pronunciations[(pronunciationIndex + 1) % content.pronunciations.length]
      : activePronunciation;
    const nextIsUk = nextPronunciation?.accentLocale === 'en-GB';

    return (
      <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col overflow-hidden px-6 py-8 text-fg-primary sm:px-10">

        {isRepairReplay && (
          <div className="mb-6 flex items-start gap-3 rounded-control bg-accent-soft p-4" role="status">
            <span className="text-feedback-warning" aria-hidden="true">↺</span>
            <p className="text-body-support leading-6 text-fg-secondary"><strong className="mr-1 text-fg-primary">{repairContext.title}</strong>{repairContext.body}</p>
          </div>
        )}

        <header>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-language text-learning-expression font-semibold" ref={revealHeadingRef} tabIndex={-1}>{content.lemma}</h1>
            {activePronunciation && (
              <div>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-control border-0 bg-accent-soft px-4 text-control-label font-semibold text-action-primary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus"
                  type="button"
                  onClick={() => playPronunciation(pronunciationIndex, true)}
                  aria-label={cardText('play',{accent:activeIsUk ? cardText('british') : cardText('american'),ipa:activePronunciation.ipa})}
                  title={cardText('playTapAgainToSwitchAccent')}
                >
                  <span>{activeIsUk ? cardText('uk') : cardText('us')}</span>
                  <b className="font-language font-medium">{activePronunciation.ipa}</b>
                  <SoundIcon />
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-start justify-between gap-4 border-b border-border-subtle pb-6">
            <div>
              <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{content.partOfSpeech}</span>
              <h2 className="mt-2 text-section-title font-semibold">{content.guideLabelL1}</h2>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-3 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => onPhaseChange('experience')}
            >
              <ReplayIcon />{cardText('replayExperience')}</button>
          </div>
        </header>

        <section className="mt-6 rounded-card bg-accent-soft p-5" aria-labelledby="intro-reveal-bridge-title">
          <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary" id="intro-reveal-bridge-title">{cardText('coreMeaning')}</span>
          <p className="mt-3 text-body leading-7 text-fg-primary">{content.l1Bridge}</p>
        </section>

        {primaryPattern?.usageRestriction && (
          <section className="mt-4 rounded-control border border-border-subtle bg-surface-panel p-4" aria-label={cardText('usageBoundariesForThisSense')}>
            <span className="text-metadata font-bold uppercase tracking-wide text-feedback-warning">{cardText('boundary')}</span>
            <p className="mt-2 text-body-support leading-6 text-fg-secondary">{primaryPattern.usageRestriction}</p>
          </section>
        )}

        <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5" aria-labelledby="intro-reveal-example-title">
          <div className="flex items-center justify-between gap-4">
            <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary" id="intro-reveal-example-title">{cardText('putItInASentence')}</span>
            <div className="flex gap-2 [&_button]:grid [&_button]:size-11 [&_button]:place-items-center [&_button]:rounded-control [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-action-primary [&_button]:hover:bg-accent-soft [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus">
              {example.audioUrl && (
                <button
                  type="button"
                  onClick={() => {
                    void audioService.playPackagedAudioUrl(example.audioUrl!, example.textL2, 'us');
                    toast(cardText('playingTheLearningExample'));
                  }}
                  aria-label={cardText('playLearningExample')}
                >
                  <SoundIcon />
                </button>
              )}
              <button type="button" onClick={() => onOpenExample(0)} aria-label={cardText('viewTheFullExample')}>
                <OpenIcon />
              </button>
            </div>
          </div>
          <div className="mt-4 font-language text-xl leading-9">
            <ClickableSentence
              sentenceHtml={exampleHtml}
              activeTokenIdx={activeLookup?.tokenIdx ?? null}
              onWordClick={(token, tokenIdx) => {
                openLookup({
                  tokenIdx,
                  displayWord: token.cleanWord,
                  load: (signal) => lookupExampleToken(
                    token,
                    example.exampleKey,
                    example.textL2,
                    { signal },
                  ),
                });
              }}
            />
          </div>
          <p className="mt-4 text-body-support leading-6 text-fg-secondary">{example.textL1}</p>
        </section>

        {primaryPattern && (
          <details className="mt-5 rounded-card border border-border-subtle bg-surface-panel px-5">
            <summary className="flex min-h-12 cursor-pointer items-center text-control-label font-semibold text-fg-secondary">{cardText('moreUsage')}</summary>
            <div className="pb-5">
              <p className="text-body-support leading-6 text-fg-secondary">{content.l1Bridge}</p>
              <strong className="mt-4 block font-language text-lg">{primaryPattern.canonicalPattern}</strong>
              {(primaryPattern.registerLabel || primaryPattern.domainLabel) && (
                <small className="mt-2 block text-metadata text-fg-tertiary">{primaryPattern.registerLabel ?? primaryPattern.domainLabel}</small>
              )}
              {visibleCollocations.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 [&>*]:min-h-10 [&>*]:rounded-control [&>*]:border [&>*]:border-border-subtle [&>*]:bg-surface-subtle [&>*]:px-3 [&>*]:text-control-label [&>*]:text-fg-secondary" aria-label={cardText('relatedExamples')}>
                  {visibleCollocations.map((collocation) => collocation.exampleIndex >= 0 ? (
                    <button
                      type="button"
                      key={collocation.text}
                      onClick={() => onOpenExample(collocation.exampleIndex)}
                    >
                      {collocation.text}<ArrowIcon />
                    </button>
                  ) : (
                    <span key={collocation.text}>{collocation.text}</span>
                  ))}
                </div>
              )}
              {primaryPattern.usageRestriction && (
                <p className="mt-4 rounded-control bg-accent-soft p-3 text-body-support leading-6 text-fg-secondary">{primaryPattern.usageRestriction}</p>
              )}
            </div>
          </details>
        )}

        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="compact"
        />

        <footer className="mt-auto pt-8">
          <button type="button" className="flex min-h-14 w-full items-center justify-between rounded-control border-0 bg-action-primary px-5 text-body font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" onClick={onComplete}>
            <span>{continuationLabel}</span>
            <ArrowIcon />
          </button>
        </footer>

        {activeLookup && (
          <QuickDictPopup
            entry={activeLookup.entry}
            onClose={clearLookup}
            toast={toast}
            onViewDetail={(word, contextualEntry) => {
              clearLookup();
              onOpenDictionary(contextualEntry ?? word);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <ExperienceRenderer
      experience={content.experience}
      mode={isRepairReplay ? 'replay' : 'introduction'}
      replayAction={isRepairReplay ? 'reveal' : undefined}
      onPrimaryAction={() => onPhaseChange('reveal')}
    />
  );
}
