import {cardText} from '../../../i18n/originalCards';
import { iconClass } from '../../ui/primitives';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MeaningToFormRecallOutcome } from '../../../learning/engine/types';
import { audioService } from '../../services/audioService';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import type { RecallCardProps } from './RecallCard';
import { ExperienceRenderer } from './ExperienceRenderer';

type RecallMode = 'independent' | 'first_letter' | 'choice' | 'result';

function normalizeForm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function createFirstLetterMask(form: string): string {
  return form
    .split('')
    .map((character, index) => (
      index === 0 || !/[a-z]/i.test(character) ? character : '_'
    ))
    .join(' ');
}

export function SensaRecallCard({
  execution,
  content,
  assessment,
  purpose = 'acquisition',
  onComplete,
  onOpenDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  onViewChange,
  toast,
}: RecallCardProps) {
  const isRetention = purpose === 'retention';
  const recall = assessment;
  const [mode, setMode] = useState<RecallMode>(execution?.feedback ? 'result' : execution?.mode ?? 'independent');
  const [answer, setAnswer] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MeaningToFormRecallOutcome | null>(execution?.feedback ? execution.feedback.correct ? execution.mode : 'miss' : null);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const [pronunciationIndex, setPronunciationIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (execution) return;
    setMode('independent');
    setAnswer('');
    setSelectedChoiceId(null);
    setOutcome(null);
    setReplayingExperience(false);
    setPronunciationIndex(0);
  }, [assessment.taskKey]);

  useEffect(() => {
    if (mode === 'independent' || mode === 'first_letter') {
      inputRef.current?.focus();
      return;
    }
    if (mode !== 'result') return;
    const frame = requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  const acceptedForms = useMemo(
    () => new Set(recall.acceptedForms.map(normalizeForm)),
    [recall.acceptedForms],
  );
  const selectedChoice = useMemo(
    () => recall.choiceOptions.find((option) => option.id === selectedChoiceId) ?? null,
    [recall.choiceOptions, selectedChoiceId],
  );
  const activePronunciation = content.pronunciations[pronunciationIndex]
    ?? content.pronunciations[0]
    ?? null;
  const activeAccentIsUk = activePronunciation?.accentLocale === 'en-GB';

  const finish = (nextOutcome: MeaningToFormRecallOutcome) => {
    if (execution) { execution.submit(null); return; }
    setOutcome(nextOutcome);
    setMode('result');
    onViewChange();
  };

  const requestFirstLetter = () => {
    if (execution) { execution.hint('first_letter'); return; }
    setMode('first_letter');
    setAnswer('');
    onViewChange();
  };

  const openChoices = () => {
    if (execution) { execution.hint('choice'); return; }
    setMode('choice');
    setAnswer('');
    onViewChange();
  };

  const submitTextAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
    if (execution) { execution.submit(answer); return; }
    const normalizedAnswer = normalizeForm(answer);
    if (isRetention) {
      onViewChange();
      onComplete(
        acceptedForms.has(normalizedAnswer) ? 'independent' : 'miss',
        normalizedAnswer,
      );
      return;
    }
    if (acceptedForms.has(normalizedAnswer)) {
      finish(mode === 'independent' ? 'independent' : 'first_letter');
      return;
    }
    if (mode === 'independent') {
      requestFirstLetter();
    } else {
      openChoices();
    }
  };

  const submitChoice = () => {
    if (!selectedChoice) return;
    if (execution) { execution.submit(selectedChoice.id); return; }
    finish(selectedChoice.isTarget ? 'choice' : 'miss');
  };

  const feedback = outcome === 'independent'
    ? {
        tone: 'independent',
        marker: '✓',
        status: cardText('connectionComplete'),
        title: recall.independentSuccessTitleL1,
        body: recall.independentSuccessBodyL1,
      }
    : outcome === 'first_letter'
    ? {
        tone: 'supported',
        marker: '↗',
        status: cardText('withALittleHelp'),
        title: recall.supportedSuccessTitleL1,
        body: recall.supportedSuccessBodyL1,
      }
    : outcome === 'choice'
    ? {
        tone: 'supported',
        marker: '↗',
        status: cardText('recognizedFromChoices'),
        title: recall.choiceSuccessTitleL1,
        body: recall.choiceSuccessBodyL1,
      }
    : {
        tone: 'repair',
        marker: '•',
        status: cardText('theConnectionNeedsRepair'),
        title: recall.repairTitleL1,
        body: recall.repairBodyL1,
      };

  const playPronunciation = () => {
    if (!activePronunciation?.audioUrl) {
      toast(cardText('thisPackageHasNoAvailablePronunciation'));
      return;
    }
    const accent = activeAccentIsUk ? 'uk' : 'us';
    void audioService.playPackagedAudioUrl(
      activePronunciation.audioUrl,
      recall.primaryForm,
      accent,
    );
    if (content.pronunciations.length > 1) {
      const nextIndex = (pronunciationIndex + 1) % content.pronunciations.length;
      const nextIsUk = content.pronunciations[nextIndex]?.accentLocale === 'en-GB';
      setPronunciationIndex(nextIndex);
      toast(cardText('playingNext',{accent:activeAccentIsUk ? cardText('british') : cardText('american'),next:nextIsUk ? cardText('british') : cardText('american')}));
      return;
    }
    toast(cardText('playing',{accent:activeAccentIsUk ? cardText('british') : cardText('american')}));
  };

  if (replayingExperience) {
    return (
      <ExperienceRenderer
        experience={content.experience}
        mode="replay"
        onPrimaryAction={() => {
          onViewChange();
          setReplayingExperience(false);
        }}
      />
    );
  }

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10"
      data-assessment-task-key={assessment.taskKey}
    >
      <header>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{isRetention ? cardText('reviewIndependentRecall') : cardText('activeRecall')}</span>
        <h1 className="mt-3 text-page-title font-semibold">
          {isRetention
            ? cardText('recallTheEnglishExpression')
            : mode === 'result' ? cardText('theEnglishExpressionIsHere') : cardText('bringTheExpressionToMind')}
        </h1>
      </header>

      <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5" aria-label={cardText('meaningToRecall')}>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('startFromThisMeaning')}</span>
        <p className="mt-3 text-body leading-7">{recall.cueL1}</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label={cardText('keyMeaningCues')}>
          {recall.cueFeatureLabelsL1.map((label) => (
            <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-fg-secondary" key={label}>{label}</span>
          ))}
        </div>
      </section>

      {(mode === 'independent' || mode === 'first_letter') && (
        <form className="mt-7" onSubmit={submitTextAnswer}>
          {mode === 'first_letter' && (
            <div className="mb-5 flex items-start gap-3 rounded-control bg-accent-soft p-4" role="status" aria-live="polite">
              <span className="text-feedback-warning" aria-hidden="true">↗</span>
              <p className="text-body-support leading-6 text-fg-secondary"><strong className="mr-1 text-fg-primary">{cardText('theFirstLetterIsShown')}</strong>{cardText('repairThisConnectionThenRecallItIndependentlyLater')}</p>
            </div>
          )}
          <label htmlFor="sensa-meaning-to-form-answer">{cardText('writeTheEnglishExpression')}</label>
          {mode === 'first_letter' && (
            <div className="mt-4 font-language text-2xl tracking-widest text-action-primary" aria-label={cardText('firstLetter',{letter:recall.primaryForm[0]})}>
              {createFirstLetterMask(recall.primaryForm)}
            </div>
          )}
          <div className="relative mt-3">
            <input
              className="min-h-14 w-full rounded-control border border-border-strong bg-surface-panel px-4 pr-12 font-language text-xl text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-2 focus-visible:outline-focus"
              ref={inputRef}
              id="sensa-meaning-to-form-answer"
              type="text"
              value={answer}
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="done"
              spellCheck={false}
              placeholder="English"
              onChange={(event) => setAnswer(event.currentTarget.value)}
            />
            {answer && (
              <button
                className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
                type="button"
                aria-label={cardText('clearInput')}
                onClick={() => {
                  setAnswer('');
                  inputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1.5fr_1fr] [&_button]:min-h-12 [&_button]:rounded-control [&_button]:px-4 [&_button]:text-control-label [&_button]:font-semibold [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus">
            <button className="border-0 bg-action-primary text-action-on-primary hover:bg-action-primary-hover disabled:opacity-45" type="submit" disabled={!answer.trim()}>{cardText('confirm')}</button>
            <button
              className="border border-border-strong bg-surface-panel text-fg-secondary hover:bg-surface-subtle"
              type="button"
              onClick={() => {
                if (isRetention) {
                  onViewChange();
                  if (execution) execution.submit(null); else onComplete('miss', null);
                  return;
                }
                if (mode === 'independent') requestFirstLetter();
                else openChoices();
              }}
            >
              {isRetention
                ? cardText('iCannotRecallItBeginRepair')
                : mode === 'independent' ? cardText('giveMeAClue') : cardText('showSomeWords')}
            </button>
          </div>
        </form>
      )}

      {mode === 'choice' && (
        <section className="mt-7">
          <div className="mb-5 flex items-start gap-3 rounded-control bg-accent-soft p-4" role="status" aria-live="polite">
            <span className="text-feedback-warning" aria-hidden="true">↗</span>
            <p className="text-body-support leading-6 text-fg-secondary"><strong className="mr-1 text-fg-primary">{cardText('theChoicesAreNarrowedDown')}</strong>{cardText('findTheMatchingForm')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={cardText('chooseTheEnglishForm')}>
            {recall.choiceOptions.map((option) => {
              const selected = option.id === selectedChoiceId;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`flex min-h-14 items-center justify-between gap-3 rounded-control border p-4 text-left font-language text-lg focus-visible:outline-2 focus-visible:outline-focus ${selected ? 'border-border-strong bg-surface-selected text-action-primary' : 'border-border-subtle bg-surface-panel hover:bg-surface-subtle'}`}
                  key={option.id}
                  onClick={() => setSelectedChoiceId(option.id)}
                >
                  <span>{option.textL2}</span>
                  <i className={`size-3 rounded-full border ${selected ? 'border-action-primary bg-action-primary' : 'border-border-strong'}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1.5fr_1fr]">
            <button className="min-h-12 rounded-control border-0 bg-action-primary px-4 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" type="button" disabled={!selectedChoice} onClick={submitChoice}>{cardText('confirm')}</button>
            <button className="min-h-12 rounded-control border border-border-strong bg-surface-panel px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={() => finish('miss')}>{cardText('revealTheAnswer')}</button>
          </div>
        </section>
      )}

      {mode === 'result' && outcome && (
        <section
          ref={resultRef}
          tabIndex={-1}
          className="mt-7 rounded-card border border-border-subtle bg-surface-panel p-5"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-control bg-accent-soft text-lg font-bold text-feedback-success" aria-hidden="true">{feedback.marker}</span>
            <small className="text-control-label font-semibold text-fg-secondary">{feedback.status}</small>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 rounded-control bg-surface-subtle p-4">
            <div>
              <h2 className="font-language text-3xl font-semibold">{recall.primaryForm}</h2>
              <p className="mt-1 font-language text-body-support text-fg-secondary">{activePronunciation?.ipa ?? content.ipa}</p>
            </div>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-control border-0 bg-accent-soft px-3 text-control-label font-semibold text-action-primary focus-visible:outline-2 focus-visible:outline-focus"
              type="button"
              onClick={playPronunciation}
              aria-label={cardText('play',{accent:activeAccentIsUk ? cardText('british') : cardText('american'),ipa:''})}
            >
              <span>{activeAccentIsUk ? cardText('uk') : cardText('us')}</span>
              <svg className={iconClass} aria-hidden="true"><use href="#i-vol" /></svg>
            </button>
          </div>
          <div className="mt-5">
            <h3 className="text-section-title font-semibold">{feedback.title}</h3>
            <p className="mt-2 text-body-support leading-6 text-fg-secondary">{feedback.body}</p>
          </div>
          {outcome !== 'independent' && (
            <button
              type="button"
              className="mt-5 grid min-h-12 w-full grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border border-border-strong bg-accent-soft px-4 text-control-label font-semibold text-action-primary focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => {
                onViewChange();
                setReplayingExperience(true);
              }}
            >
              <svg className={iconClass} aria-hidden="true"><use href="#i-eye" /></svg>
              <span>{cardText('returnToTheExperience2')}</span>
              <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
          )}
          <div className="mt-5 grid grid-cols-2 divide-x divide-border-subtle border-t border-border-subtle pt-4 [&_button]:inline-flex [&_button]:min-h-11 [&_button]:items-center [&_button]:justify-center [&_button]:gap-2 [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-control-label [&_button]:font-semibold [&_button]:text-fg-secondary [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus" aria-label={cardText('resourcesForThisMeaning')}>
            <button type="button" onClick={onOpenExample}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-bookopen" /></svg>{cardText('examples')}</button>
            <button type="button" onClick={() => onOpenDictionary(recall.primaryForm)}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-search" /></svg>{cardText('dictionary')}</button>
          </div>
        </section>
      )}

      {mode === 'result' && outcome && (
        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="compact"
        />
      )}

      {mode === 'result' && outcome && (
        <footer className="mt-auto pt-8">
          <button className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={() => execution ? execution.continue() : onComplete(outcome, null)}>
            {outcome === 'independent' ? cardText('continueLearning') : cardText('continueAndRecallAgainLater')}
          </button>
        </footer>
      )}
    </div>
  );
}
