import { useEffect, useMemo, useState } from 'react';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type {
  DictionaryLookup,
  QuickDictEntry,
  SentenceToken,
} from '../../types';
import type { RecognitionAssessmentResource } from '../../content/assessmentResources';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import { ExperienceRenderer } from './ExperienceRenderer';
import { SensaRecognitionCard } from './SensaRecognitionCard';

export type RecognitionPresentation = 'sensa' | 'baseline';
export type AssessmentPurpose = 'acquisition' | 'retention';

export interface RecognitionCardProps {
  content: PrototypeIntroductionPackage;
  /** Exact Assessment Resource selected by the current Action. */
  assessment: RecognitionAssessmentResource;
  presentation?: RecognitionPresentation;
  purpose?: AssessmentPurpose;
  onComplete: (correct: boolean, responseId?: string | null) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

function BaselineRecognitionCard({
  content,
  assessment,
  onComplete,
  onOpenDictionary,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  onViewChange,
  toast,
}: RecognitionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    setSelectedId(null);
    setSubmitted(false);
    setReplayingExperience(false);
    clearLookup();
  }, [assessment.taskKey, clearLookup]);

  const selectedOption = useMemo(
    () => assessment.options.find((option) => option.id === selectedId) ?? null,
    [assessment.options, selectedId],
  );
  const correctOption = useMemo(
    () => assessment.options.find((option) => option.isCorrect) ?? null,
    [assessment.options],
  );

  const beforeTarget = assessment.example.textL2.slice(0, assessment.example.targetStart);
  const afterTarget = assessment.example.textL2.slice(assessment.example.targetEnd);
  const sentenceHtml = `${beforeTarget}<b>${assessment.example.targetSurface}</b>${afterTarget}`;
  const isCorrect = selectedOption?.isCorrect === true;
  const feedbackTitle = isCorrect
    ? assessment.successTitleL1
    : selectedOption?.feedbackTitleL1;
  const feedbackBody = isCorrect
    ? assessment.successBodyL1
    : selectedOption?.feedbackBodyL1;

  const lookupToken = async (token: SentenceToken): Promise<QuickDictEntry | null> => {
    const entry = await lookupDictionary(token.cleanWord);
    if (!token.isTarget) {
      if (!entry) toast('当前词典没有这个词');
      return entry;
    }
    const baseEntry = entry ?? {
      word: content.lemma,
      phonetic: content.ipa,
      senses: [],
      hasFullDetail: false,
    };

    const otherSenses = baseEntry.hasFullDetail
      ? baseEntry.senses.filter((sense) => sense.text !== content.guideLabelL1)
      : [];
    return {
      ...baseEntry,
      id: content.senseKey,
      word: content.lemma,
      phonetic: content.ipa,
      senses: [
        { pos: '本句中', text: `${content.partOfSpeech} ${content.guideLabelL1}` },
        ...otherSenses,
      ],
      hasFullDetail: true,
    };
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
    <div className="recognition-page" data-assessment-task-key={assessment.taskKey}>
      <div className="recognition-heading">
        <span>语境判断</span>
        <h1>看懂这句话</h1>
        <p>{assessment.instructionL1}</p>
      </div>

      <section className="recognition-context" aria-label="判断语境">
        <div className="recognition-context-label">
          <span>{assessment.contextLabelL1}</span>
          <i aria-hidden="true" />
        </div>
        {submitted ? (
          <div className="recognition-sentence recognition-sentence-lookup">
            <ClickableSentence
              sentenceHtml={sentenceHtml}
              activeTokenIdx={activeLookup?.tokenIdx ?? null}
              onWordClick={(token, tokenIdx) => {
                openLookup({
                  tokenIdx,
                  displayWord: token.cleanWord,
                  load: () => lookupToken(token),
                });
              }}
            />
          </div>
        ) : (
          <p className="recognition-sentence">
            {beforeTarget}
            <strong>{assessment.example.targetSurface}</strong>
            {afterTarget}
          </p>
        )}
        {submitted && <p className="recognition-translation">{assessment.example.textL1}</p>}
        {submitted && <span className="recognition-lookup-hint">点击句中单词可查义</span>}
      </section>

      <h2 className="recognition-question">{assessment.questionL1}</h2>

      <div className="recognition-options" role="radiogroup" aria-label={assessment.questionL1}>
        {assessment.options.map((option, index) => {
          const isSelected = option.id === selectedId;
          const classes = ['recognition-option'];
          if (!submitted && isSelected) classes.push('selected');
          if (submitted && option.isCorrect) classes.push('right');
          if (submitted && isSelected && !option.isCorrect) classes.push('wrong');
          if (submitted && !option.isCorrect && !isSelected) classes.push('mute');

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
              <span className="recognition-option-index" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="recognition-option-text">{option.textL1}</span>
              {submitted && option.isCorrect && (
                <span className="recognition-option-status" aria-label="正确">✓</span>
              )}
              {submitted && isSelected && !option.isCorrect && (
                <span className="recognition-option-status" aria-label="不正确">×</span>
              )}
            </button>
          );
        })}
      </div>

      {submitted && selectedOption && correctOption && (
        <section
          className={`recognition-feedback ${isCorrect ? 'correct' : 'repair'}`}
          aria-live="polite"
        >
          <div className="recognition-feedback-title">
            <span aria-hidden="true">{isCorrect ? '✓' : '↗'}</span>
            <strong>{feedbackTitle}</strong>
          </div>
          <p>{feedbackBody}</p>
          <div className="recognition-feature-row" aria-label="这个意思的关键线索">
            {assessment.featureLabelsL1.map((label) => <span key={label}>{label}</span>)}
          </div>
          <button
            type="button"
            className={`recognition-replay-button${isCorrect ? '' : ' emphasized'}`}
            onClick={() => {
              clearLookup();
              onViewChange();
              setReplayingExperience(true);
            }}
          >
            <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
            {isCorrect ? '回看意思连接' : '回看刚才的体验'}
            <svg className="icon recognition-replay-chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
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

      <div className="lfoot recognition-footer" id="lFoot">
        {!submitted ? (
          <button
            type="button"
            className="fbtn green"
            disabled={!selectedOption}
            onClick={() => setSubmitted(true)}
          >
            确认判断<i />
          </button>
        ) : (
          <button
            type="button"
            className="fbtn green"
            onClick={() => onComplete(isCorrect)}
          >
            {isCorrect ? '继续学习' : '我知道了，继续'}<i />
          </button>
        )}
      </div>

      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={(word) => {
            clearLookup();
            onOpenDictionary(word);
          }}
        />
      )}
    </div>
  );
}

export function RecognitionCard(props: RecognitionCardProps) {
  if (
    props.assessment.packageKey !== props.content.packageKey
    || props.assessment.senseKey !== props.content.senseKey
  ) {
    throw new Error('Recognition card resource does not match the selected Package.');
  }
  return props.presentation === 'baseline'
    ? <BaselineRecognitionCard {...props} />
    : <SensaRecognitionCard {...props} />;
}
