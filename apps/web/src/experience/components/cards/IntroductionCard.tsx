import {cardText} from '../../../i18n/originalCards';
import { uiClass } from '../../ui/classes';
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
      <div className={uiClass(`intro-reveal-page is-compact${isRepairReplay ? ' is-review-replay' : ''}`)}>
        <div className={uiClass("intro-reveal-field")} aria-hidden="true">
          <i /><i /><i />
        </div>

        {isRepairReplay && (
          <div className={uiClass("intro-review-replay-context")} role="status">
            <span aria-hidden="true">↺</span>
            <p><strong>{repairContext.title}</strong>{repairContext.body}</p>
          </div>
        )}

        <header className={uiClass("intro-reveal-identity intro-reveal-identity-compact")}>
          <div className={uiClass("intro-reveal-form-row")}>
            <h1 ref={revealHeadingRef} tabIndex={-1}>{content.lemma}</h1>
            {activePronunciation && (
              <div className={uiClass("intro-reveal-pronunciations is-combined")}>
                <button
                  type="button"
                  onClick={() => playPronunciation(pronunciationIndex, true)}
                  aria-label={cardText('play',{accent:activeIsUk ? cardText('british') : cardText('american'),ipa:activePronunciation.ipa})}
                  title={cardText('playTapAgainToSwitchAccent')}
                >
                  <span>{activeIsUk ? cardText('uk') : cardText('us')}</span>
                  <b>{activePronunciation.ipa}</b>
                  <SoundIcon />
                </button>
              </div>
            )}
          </div>

          <div className={uiClass("intro-reveal-sense intro-reveal-sense-compact")}>
            <div>
              <span>{content.partOfSpeech}</span>
              <h2>{content.guideLabelL1}</h2>
            </div>
            <button
              type="button"
              className={uiClass("intro-compact-recap")}
              onClick={() => onPhaseChange('experience')}
            >
              <ReplayIcon />{cardText('replayExperience')}</button>
          </div>
        </header>

        <section className={uiClass("intro-reveal-bridge intro-reveal-bridge-compact")} aria-labelledby="intro-reveal-bridge-title">
          <span className={uiClass("intro-reveal-section-label", "#intro-reveal-bridge-title")} id="intro-reveal-bridge-title">{cardText('coreMeaning')}</span>
          <p>{content.l1Bridge}</p>
        </section>

        {primaryPattern?.usageRestriction && (
          <section className={uiClass("intro-compact-boundary")} aria-label={cardText('usageBoundariesForThisSense')}>
            <span>{cardText('boundary')}</span>
            <p>{primaryPattern.usageRestriction}</p>
          </section>
        )}

        <section className={uiClass("intro-reveal-example intro-reveal-example-compact")} aria-labelledby="intro-reveal-example-title">
          <div className={uiClass("intro-reveal-example-head")}>
            <span className={uiClass("intro-reveal-section-label", "#intro-reveal-example-title")} id="intro-reveal-example-title">{cardText('putItInASentence')}</span>
            <div>
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
          <div className={uiClass("intro-reveal-example-l2")}>
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
          <p>{example.textL1}</p>
        </section>

        {primaryPattern && (
          <details className={uiClass("intro-compact-more")}>
            <summary>{cardText('moreUsage')}</summary>
            <div>
              <p className={uiClass("intro-compact-full-bridge")}>{content.l1Bridge}</p>
              <strong>{primaryPattern.canonicalPattern}</strong>
              {(primaryPattern.registerLabel || primaryPattern.domainLabel) && (
                <small>{primaryPattern.registerLabel ?? primaryPattern.domainLabel}</small>
              )}
              {visibleCollocations.length > 0 && (
                <div className={uiClass("intro-reveal-collocations")} aria-label={cardText('relatedExamples')}>
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
                <p className={uiClass("intro-compact-more-boundary")}>{primaryPattern.usageRestriction}</p>
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

        <footer className={uiClass("intro-reveal-footer intro-reveal-footer-compact")}>
          <button type="button" className={uiClass("intro-reveal-continue")} onClick={onComplete}>
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
