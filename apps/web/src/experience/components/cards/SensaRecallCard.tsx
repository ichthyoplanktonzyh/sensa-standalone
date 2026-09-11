import {cardText} from '../../../i18n/originalCards';
import { uiClass } from '../../ui/classes';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MeaningToFormRecallOutcome } from '../../engine/types';
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
      className={uiClass(`sensa-recall-page is-${mode}`)}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className={uiClass("sensa-recall-heading")}>
        <span>{isRetention ? cardText('reviewIndependentRecall') : cardText('activeRecall')}</span>
        <h1>
          {isRetention
            ? cardText('recallTheEnglishExpression')
            : mode === 'result' ? cardText('theEnglishExpressionIsHere') : cardText('bringTheExpressionToMind')}
        </h1>
      </header>

      <section className={uiClass("sensa-recall-cue")} aria-label={cardText('meaningToRecall')}>
        <span>{cardText('startFromThisMeaning')}</span>
        <p>{recall.cueL1}</p>
        <div className={uiClass("sensa-recall-trace")} aria-label={cardText('keyMeaningCues')}>
          {recall.cueFeatureLabelsL1.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </section>

      {(mode === 'independent' || mode === 'first_letter') && (
        <form className={uiClass("sensa-recall-form")} onSubmit={submitTextAnswer}>
          {mode === 'first_letter' && (
            <div className={uiClass("sensa-recall-support-state")} role="status" aria-live="polite">
              <span aria-hidden="true">↗</span>
              <p><strong>{cardText('theFirstLetterIsShown')}</strong>{cardText('repairThisConnectionThenRecallItIndependentlyLater')}</p>
            </div>
          )}
          <label htmlFor="sensa-meaning-to-form-answer">{cardText('writeTheEnglishExpression')}</label>
          {mode === 'first_letter' && (
            <div className={uiClass("sensa-recall-mask")} aria-label={cardText('firstLetter',{letter:recall.primaryForm[0]})}>
              {createFirstLetterMask(recall.primaryForm)}
            </div>
          )}
          <div className={uiClass("sensa-recall-input")}>
            <input
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
          <div className={uiClass("sensa-recall-primary-actions")}>
            <button type="submit" disabled={!answer.trim()}>{cardText('confirm')}</button>
            <button
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
        <section className={uiClass("sensa-recall-choice-stage")}>
          <div className={uiClass("sensa-recall-support-state")} role="status" aria-live="polite">
            <span aria-hidden="true">↗</span>
            <p><strong>{cardText('theChoicesAreNarrowedDown')}</strong>{cardText('findTheMatchingForm')}</p>
          </div>
          <div className={uiClass("sensa-recall-choice-list")} role="radiogroup" aria-label={cardText('chooseTheEnglishForm')}>
            {recall.choiceOptions.map((option) => {
              const selected = option.id === selectedChoiceId;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={uiClass(selected ? 'is-selected' : '')}
                  key={option.id}
                  onClick={() => setSelectedChoiceId(option.id)}
                >
                  <span>{option.textL2}</span>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className={uiClass("sensa-recall-primary-actions")}>
            <button type="button" disabled={!selectedChoice} onClick={submitChoice}>{cardText('confirm')}</button>
            <button type="button" onClick={() => finish('miss')}>{cardText('revealTheAnswer')}</button>
          </div>
        </section>
      )}

      {mode === 'result' && outcome && (
        <section
          ref={resultRef}
          tabIndex={-1}
          className={uiClass(`sensa-recall-result is-${feedback.tone}`)}
          aria-live="polite"
        >
          <div className={uiClass("sensa-recall-result-status")}>
            <span aria-hidden="true">{feedback.marker}</span>
            <small>{feedback.status}</small>
          </div>
          <div className={uiClass("sensa-recall-form-reveal")}>
            <div>
              <h2>{recall.primaryForm}</h2>
              <p>{activePronunciation?.ipa ?? content.ipa}</p>
            </div>
            <button
              type="button"
              onClick={playPronunciation}
              aria-label={cardText('play',{accent:activeAccentIsUk ? cardText('british') : cardText('american'),ipa:''})}
            >
              <span>{activeAccentIsUk ? cardText('uk') : cardText('us')}</span>
              <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-vol" /></svg>
            </button>
          </div>
          <div className={uiClass("sensa-recall-result-copy")}>
            <h3>{feedback.title}</h3>
            <p>{feedback.body}</p>
          </div>
          {outcome !== 'independent' && (
            <button
              type="button"
              className={uiClass("sensa-recall-repair-action")}
              onClick={() => {
                onViewChange();
                setReplayingExperience(true);
              }}
            >
              <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-eye" /></svg>
              <span>{cardText('returnToTheExperience2')}</span>
              <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
          )}
          <div className={uiClass("sensa-recall-resource-strip")} aria-label={cardText('resourcesForThisMeaning')}>
            <button type="button" onClick={onOpenExample}>
              <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-bookopen" /></svg>{cardText('examples')}</button>
            <i aria-hidden="true" />
            <button type="button" onClick={() => onOpenDictionary(recall.primaryForm)}>
              <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-search" /></svg>{cardText('dictionary')}</button>
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
        <footer className={uiClass("sensa-recall-footer")}>
          <button type="button" onClick={() => execution ? execution.continue() : onComplete(outcome, null)}>
            {outcome === 'independent' ? cardText('continueLearning') : cardText('continueAndRecallAgainLater')}
          </button>
        </footer>
      )}
    </div>
  );
}
