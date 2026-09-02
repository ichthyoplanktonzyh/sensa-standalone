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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const outcomeRef = useRef<HTMLElement>(null);

  useEffect(() => {
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
    if (!entry) toast('当前 Reference 样本没有这个词');
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
      className={`sensa-recognition-page${submitted ? ' is-submitted' : ''}`}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className="sensa-recognition-heading">
        <span>{isRetention ? '长期复习 · 语境判断' : '再次相遇'}</span>
        <h1>{isRetention ? '这个意思还在吗？' : '只看这一句'}</h1>
        <p>
          {isRetention
            ? '只根据英文语境独立判断；提交后再看译文和解释。'
            : assessment.instructionL1}
        </p>
      </header>

      <section className="sensa-recognition-context" aria-label="当前判断语境">
        <div className="sensa-recognition-context-meta">
          <span>{assessment.contextLabelL1}</span>
          <i aria-hidden="true" />
          <small>{submitted ? '答案已揭示' : '意思暂不揭示'}</small>
        </div>
        {submitted ? (
          <div className="sensa-recognition-sentence is-lookup-enabled">
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
          <p className="sensa-recognition-sentence">
            {assessment.example.textL2.slice(0, assessment.example.targetStart)}
            <strong>{assessment.example.targetSurface}</strong>
            {assessment.example.textL2.slice(assessment.example.targetEnd)}
          </p>
        )}
        {submitted && (
          <div className="sensa-recognition-translation">
            <p>{assessment.example.textL1}</p>
            <span>现在可以点击句中单词查义</span>
          </div>
        )}
      </section>

      <section className="sensa-recognition-judgement" aria-labelledby="sensa-recognition-question">
        <h2 id="sensa-recognition-question">{assessment.questionL1}</h2>
        <div className="sensa-recognition-options" role="radiogroup" aria-label={assessment.questionL1}>
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
                className={classes.join(' ')}
                key={option.id}
                onClick={() => setSelectedId(option.id)}
              >
                <span className="sensa-recognition-choice-mark" aria-hidden="true">
                  {submitted && option.isCorrect ? '✓' : submitted && isSelected ? '×' : ''}
                </span>
                <span>{option.textL1}</span>
                {submitted && option.isCorrect && <small>符合语境</small>}
                {submitted && isSelected && !option.isCorrect && <small>你的选择</small>}
              </button>
            );
          })}
        </div>
      </section>

      {submitted && selectedOption && correctOption && (
        <section
          ref={outcomeRef}
          tabIndex={-1}
          className={`sensa-recognition-outcome ${isCorrect ? 'is-correct' : 'is-repair'}`}
          aria-live="polite"
        >
          <header>
            <span aria-hidden="true">{isCorrect ? '✓' : '↗'}</span>
            <div>
              <small>{isCorrect ? '连接成立' : '只修复这一点'}</small>
              <h3>{feedbackTitle}</h3>
            </div>
          </header>
          <p>{feedbackBody}</p>
          <div className="sensa-recognition-features" aria-label="这个意思的关键线索">
            {assessment.featureLabelsL1.map((label) => <span key={label}>{label}</span>)}
          </div>
          <button
            type="button"
            className={isCorrect ? '' : 'is-emphasized'}
            onClick={() => {
              clearLookup();
              onViewChange();
              setReplayingExperience(true);
            }}
          >
            <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
            {isCorrect ? '回看意思连接' : '回到刚才的体验'}
            <svg className="icon" aria-hidden="true"><use href="#i-chev-r" /></svg>
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

      <footer className="sensa-recognition-footer">
        {!submitted ? (
          <button
            type="button"
            disabled={!selectedOption}
            onClick={() => {
              clearLookup();
              onViewChange();
              if (isRetention) {
                onComplete(isCorrect, selectedOption?.id ?? null);
              } else {
                setSubmitted(true);
              }
            }}
          >
            {isRetention ? '提交这次检验' : '确认判断'}
          </button>
        ) : (
          <button type="button" onClick={() => onComplete(isCorrect, selectedOption?.id ?? null)}>
            {isCorrect ? '继续学习' : '继续，稍后再检验'}
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
