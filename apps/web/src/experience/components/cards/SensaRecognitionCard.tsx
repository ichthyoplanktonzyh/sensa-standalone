import {cardText} from '../../../i18n/originalCards';
import { iconClass } from '../../ui/primitives';
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
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10"
      data-assessment-task-key={assessment.taskKey}
    >
      <header>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{isRetention ? cardText('reviewContextRecognition') : cardText('meetItAgain')}</span>
        <h1 className="mt-3 text-page-title font-semibold">{isRetention ? cardText('isThisMeaningStillThere') : cardText('focusOnThisSentence')}</h1>
        <p className="mt-3 text-body-support leading-6 text-fg-secondary">
          {isRetention
            ? cardText('judgeFromTheEnglishContextFirstTranslationAnd')
            : assessment.instructionL1}
        </p>
      </header>

      <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5" aria-label={cardText('currentContext')}>
        <div className="flex items-center gap-2 text-metadata text-fg-tertiary">
          <span className="font-semibold">{assessment.contextLabelL1}</span>
          <i className="size-1.5 rounded-full bg-progress" aria-hidden="true" />
          <small>{submitted ? cardText('answerRevealed') : cardText('meaningHiddenForNow')}</small>
        </div>
        {submitted ? (
          <div className="mt-5 font-language text-xl leading-9">
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
          <p className="mt-5 font-language text-xl leading-9 [&_strong]:text-action-primary">
            {assessment.example.textL2.slice(0, assessment.example.targetStart)}
            <strong>{assessment.example.targetSurface}</strong>
            {assessment.example.textL2.slice(assessment.example.targetEnd)}
          </p>
        )}
        {submitted && (
          <div className="mt-5 border-t border-border-subtle pt-4">
            <p className="text-body-support leading-6 text-fg-secondary">{assessment.example.textL1}</p>
            <span className="mt-2 block text-metadata text-fg-tertiary">{cardText('youCanNowTapWordsForDefinitions')}</span>
          </div>
        )}
      </section>

      <section className="mt-7" aria-labelledby="sensa-recognition-question">
        <h2 className="text-section-title font-semibold" id="sensa-recognition-question">{assessment.questionL1}</h2>
        <div className="mt-4 grid gap-3" role="radiogroup" aria-label={assessment.questionL1}>
          {assessment.options.map((option) => {
            const isSelected = option.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={submitted}
                className={`grid min-h-14 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-control border p-3 text-left focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-100 ${submitted && option.isCorrect ? 'border-feedback-success bg-accent-soft text-feedback-success' : submitted && isSelected && !option.isCorrect ? 'border-feedback-danger bg-surface-subtle text-feedback-danger' : !submitted && isSelected ? 'border-border-strong bg-surface-selected' : submitted ? 'border-border-subtle bg-surface-panel text-fg-tertiary' : 'border-border-subtle bg-surface-panel hover:bg-surface-subtle'}`}
                key={option.id}
                onClick={() => setSelectedId(option.id)}
              >
                <span className="grid size-8 place-items-center rounded-control bg-accent-soft text-metadata font-bold" aria-hidden="true">
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
          className={`mt-6 rounded-card border bg-surface-panel p-5 ${isCorrect ? 'border-feedback-success' : 'border-feedback-warning'}`}
          aria-live="polite"
        >
          <header className="flex items-center gap-3">
            <span className={`grid size-10 place-items-center rounded-control bg-accent-soft text-lg font-bold ${isCorrect ? 'text-feedback-success' : 'text-feedback-warning'}`} aria-hidden="true">{isCorrect ? '✓' : '↗'}</span>
            <div>
              <small className="text-metadata text-fg-tertiary">{isCorrect ? cardText('connectionEstablished') : cardText('repairThisPoint')}</small>
              <h3 className="mt-1 text-body font-semibold">{feedbackTitle}</h3>
            </div>
          </header>
          <p className="mt-4 text-body-support leading-6 text-fg-secondary">{feedbackBody}</p>
          <div className="mt-4 flex flex-wrap gap-2" aria-label={cardText('keyCuesForThisMeaning')}>
            {assessment.featureLabelsL1.map((label) => <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-fg-secondary" key={label}>{label}</span>)}
          </div>
          <button
            type="button"
            className={`mt-5 grid min-h-12 w-full grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border px-4 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${isCorrect ? 'border-border-subtle bg-surface-panel text-fg-primary hover:bg-surface-subtle' : 'border-border-strong bg-accent-soft text-action-primary'}`}
            onClick={() => {
              clearLookup();
              onViewChange();
              setReplayingExperience(true);
            }}
          >
            <svg className={iconClass} aria-hidden="true"><use href="#i-eye" /></svg>
            {isCorrect ? cardText('replayTheMeaningConnection2') : cardText('returnToTheExperience')}
            <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
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

      <footer className="mt-auto pt-8 [&_button]:min-h-12 [&_button]:w-full [&_button]:rounded-control [&_button]:border-0 [&_button]:bg-action-primary [&_button]:px-5 [&_button]:text-control-label [&_button]:font-semibold [&_button]:text-action-on-primary [&_button]:hover:bg-action-primary-hover [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus [&_button]:disabled:opacity-45">
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
