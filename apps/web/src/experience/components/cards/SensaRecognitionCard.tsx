import {cardText} from '../../../i18n/originalCards';
import { uiClass } from '../../ui/classes';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
  SentenceToken,
} from '../../types';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import type { RecognitionCardProps } from './RecognitionCard';
import { ExperienceRenderer } from './ExperienceRenderer';

export function SensaRecognitionCard({
  execution,
  content,
  assessment,
  purpose = 'acquisition',
  onComplete,
  onOpenDictionary,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  onViewChange,
  toast,
}: RecognitionCardProps) {
  const isRetention = purpose === 'retention';
  const [selectedId, setSelectedId] = useState<string | null>(execution?.feedback?.answer ?? null);
  const [submitted, setSubmitted] = useState(!!execution?.feedback);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const outcomeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (execution) return;
    setSelectedId(null);
    setSubmitted(false);
    setReplayingExperience(false);
    clearLookup();
  }, [assessment.taskKey, clearLookup]);

  useEffect(() => {
    if (!submitted) return;
    const frame = requestAnimationFrame(() => {
      outcomeRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [submitted]);

  const selectedOption = useMemo(
    () => assessment.options.find((option) => option.id === selectedId) ?? null,
    [assessment.options, selectedId],
  );
  const correctOption = useMemo(
    () => assessment.options.find((option) => option.isCorrect) ?? null,
    [assessment.options],
  );
  const isCorrect = selectedOption?.isCorrect === true;
  const feedbackTitle = isCorrect
    ? assessment.successTitleL1
    : selectedOption?.feedbackTitleL1;
  const feedbackBody = isCorrect
    ? assessment.successBodyL1
    : selectedOption?.feedbackBodyL1;
  const sentenceHtml = `${assessment.example.textL2.slice(0, assessment.example.targetStart)}<b>${assessment.example.targetSurface}</b>${assessment.example.textL2.slice(assessment.example.targetEnd)}`;

  const lookupToken = async (
    token: SentenceToken,
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const request: DictionaryLookupRequest = {
      rawClickedForm: token.text,
      exampleId: assessment.example.exampleKey,
      textL2: assessment.example.textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: token.text,
    };
    const entry = await lookupDictionary(request, options);
    if (!entry) toast(cardText('thisWordIsNotInTheCurrentReference'));
    return entry;
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
      className={uiClass(`sensa-recognition-page${submitted ? ' is-submitted' : ''}`)}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className={uiClass("sensa-recognition-heading")}>
        <span>{isRetention ? cardText('reviewContextRecognition') : cardText('meetItAgain')}</span>
        <h1>{isRetention ? cardText('isThisMeaningStillThere') : cardText('focusOnThisSentence')}</h1>
        <p>
          {isRetention
            ? cardText('judgeFromTheEnglishContextFirstTranslationAnd')
            : assessment.instructionL1}
        </p>
      </header>

      <section className={uiClass("sensa-recognition-context")} aria-label={cardText('currentContext')}>
        <div className={uiClass("sensa-recognition-context-meta")}>
          <span>{assessment.contextLabelL1}</span>
          <i aria-hidden="true" />
          <small>{submitted ? cardText('answerRevealed') : cardText('meaningHiddenForNow')}</small>
        </div>
        {submitted ? (
          <div className={uiClass("sensa-recognition-sentence is-lookup-enabled")}>
            <ClickableSentence
              sentenceHtml={sentenceHtml}
              activeTokenIdx={activeLookup?.tokenIdx ?? null}
              onWordClick={(token, tokenIdx) => {
                openLookup({
                  tokenIdx,
                  displayWord: token.cleanWord,
                  load: (signal) => lookupToken(
                    token,
                    { signal },
                  ),
                });
              }}
            />
          </div>
        ) : (
          <p className={uiClass("sensa-recognition-sentence")}>
            {assessment.example.textL2.slice(0, assessment.example.targetStart)}
            <strong>{assessment.example.targetSurface}</strong>
            {assessment.example.textL2.slice(assessment.example.targetEnd)}
          </p>
        )}
        {submitted && (
          <div className={uiClass("sensa-recognition-translation")}>
            <p>{assessment.example.textL1}</p>
            <span>{cardText('youCanNowTapWordsForDefinitions')}</span>
          </div>
        )}
      </section>

      <section className={uiClass("sensa-recognition-judgement")} aria-labelledby="sensa-recognition-question">
        <h2 id="sensa-recognition-question">{assessment.questionL1}</h2>
        <div className={uiClass("sensa-recognition-options")} role="radiogroup" aria-label={assessment.questionL1}>
          {assessment.options.map((option) => {
            const isSelected = option.id === selectedId;
            const classes = ['sensa-recognition-option'];
            if (!submitted && isSelected) classes.push('is-selected');
            if (submitted && option.isCorrect) classes.push('is-correct');
            if (submitted && isSelected && !option.isCorrect) classes.push('is-wrong');
            if (submitted && !option.isCorrect && !isSelected) classes.push('is-muted');
            return (
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={submitted}
                className={uiClass(classes.join(' '))}
                key={option.id}
                onClick={() => setSelectedId(option.id)}
              >
                <span className={uiClass("sensa-recognition-choice-mark")} aria-hidden="true">
                  {submitted && option.isCorrect ? '✓' : submitted && isSelected ? '×' : ''}
                </span>
                <span>{option.textL1}</span>
                {submitted && option.isCorrect && <small>{cardText('fitsTheContext')}</small>}
                {submitted && isSelected && !option.isCorrect && <small>{cardText('yourChoice')}</small>}
              </button>
            );
          })}
        </div>
      </section>

      {submitted && selectedOption && correctOption && (
        <section
          ref={outcomeRef}
          tabIndex={-1}
          className={uiClass(`sensa-recognition-outcome ${isCorrect ? 'is-correct' : 'is-repair'}`)}
          aria-live="polite"
        >
          <header>
            <span aria-hidden="true">{isCorrect ? '✓' : '↗'}</span>
            <div>
              <small>{isCorrect ? cardText('connectionEstablished') : cardText('repairThisPoint')}</small>
              <h3>{feedbackTitle}</h3>
            </div>
          </header>
          <p>{feedbackBody}</p>
          <div className={uiClass("sensa-recognition-features")} aria-label={cardText('keyCuesForThisMeaning')}>
            {assessment.featureLabelsL1.map((label) => <span key={label}>{label}</span>)}
          </div>
          <button
            type="button"
            className={uiClass(isCorrect ? '' : 'is-emphasized')}
            onClick={() => {
              clearLookup();
              onViewChange();
              setReplayingExperience(true);
            }}
          >
            <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-eye" /></svg>
            {isCorrect ? cardText('replayTheMeaningConnection2') : cardText('returnToTheExperience')}
            <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </section>
      )}

      {submitted && (
        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="compact"
        />
      )}

      <footer className={uiClass("sensa-recognition-footer")}>
        {!submitted ? (
          <button
            type="button"
            disabled={!selectedOption}
            onClick={() => {
              clearLookup();
              onViewChange();
              if (execution) {
                execution.submit(selectedOption?.id ?? null);
              } else if (isRetention) {
                onComplete(isCorrect, selectedOption?.id ?? null);
              } else {
                setSubmitted(true);
              }
            }}
          >
            {isRetention ? cardText('submitThisCheck') : cardText('confirmYourChoice')}
          </button>
        ) : (
          <button type="button" onClick={() => execution ? execution.continue() : onComplete(isCorrect, selectedOption?.id ?? null)}>
            {isCorrect ? cardText('continueLearning') : cardText('continueAndCheckAgainLater')}
          </button>
        )}
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
