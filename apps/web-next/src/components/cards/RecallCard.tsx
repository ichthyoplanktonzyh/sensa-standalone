import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MeaningToFormRecallAssessmentResource } from '../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type { MeaningToFormRecallOutcome } from '../../engine/types';
import { audioService } from '../../services/audioService';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { ExperienceRenderer } from './ExperienceRenderer';
import { SensaRecallCard } from './SensaRecallCard';

export type RecallPresentation = 'sensa' | 'baseline';

export interface RecallCardProps {
  content: PrototypeIntroductionPackage;
  /** Exact Assessment Resource selected by the current Action. */
  assessment: MeaningToFormRecallAssessmentResource;
  presentation?: RecallPresentation;
  purpose?: 'acquisition' | 'retention';
  onComplete: (outcome: MeaningToFormRecallOutcome, responseId?: string | null) => void;
  onOpenDictionary: (word: string) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  onViewChange: () => void;
  toast: (message: string) => void;
}

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

function BaselineRecallCard({
  content,
  assessment,
  onComplete,
  onOpenDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  onViewChange,
  toast,
}: RecallCardProps) {
  const recall = assessment;
  const [mode, setMode] = useState<RecallMode>('independent');
  const [answer, setAnswer] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MeaningToFormRecallOutcome | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMode('independent');
    setAnswer('');
    setSelectedChoiceId(null);
    setOutcome(null);
    setTransitionMessage(null);
    setReplayingExperience(false);
  }, [assessment.taskKey]);

  useEffect(() => {
    if (mode === 'independent' || mode === 'first_letter') {
      inputRef.current?.focus();
    }
  }, [mode]);

  const acceptedForms = useMemo(
    () => new Set(recall.acceptedForms.map(normalizeForm)),
    [recall.acceptedForms],
  );
  const selectedChoice = useMemo(
    () => recall.choiceOptions.find((option) => option.id === selectedChoiceId) ?? null,
    [recall.choiceOptions, selectedChoiceId],
  );
  const primaryPronunciation = content.pronunciations.find(
    (pronunciation) => pronunciation.accentLocale === 'en-US',
  ) ?? content.pronunciations[0];

  const finish = (nextOutcome: MeaningToFormRecallOutcome) => {
    setOutcome(nextOutcome);
    setMode('result');
    setTransitionMessage(null);
    onViewChange();
  };

  const requestFirstLetter = () => {
    setMode('first_letter');
    setAnswer('');
    setTransitionMessage('给你第一个字母，再从这个意思往英文找一次。');
  };

  const openChoices = () => {
    setMode('choice');
    setAnswer('');
    setTransitionMessage('再缩小一点范围：从几个英文形式中找到它。');
  };

  const submitTextAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;

    if (acceptedForms.has(normalizeForm(answer))) {
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
    finish(selectedChoice.isTarget ? 'choice' : 'miss');
  };

  const feedback = outcome === 'independent'
    ? {
        tone: 'independent',
        icon: '✓',
        label: '独立回想',
        title: recall.independentSuccessTitleL1,
        body: recall.independentSuccessBodyL1,
      }
    : outcome === 'first_letter'
    ? {
        tone: 'supported',
        icon: '↗',
        label: '首字母提示',
        title: recall.supportedSuccessTitleL1,
        body: recall.supportedSuccessBodyL1,
      }
    : outcome === 'choice'
    ? {
        tone: 'repair',
        icon: '↗',
        label: '选词修复',
        title: recall.choiceSuccessTitleL1,
        body: recall.choiceSuccessBodyL1,
      }
    : {
        tone: 'repair',
        icon: '•',
        label: '连接修复',
        title: recall.repairTitleL1,
        body: recall.repairBodyL1,
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
    <div className="recall-page" data-assessment-task-key={assessment.taskKey}>
      <header className="recall-heading">
        <span>意思 → 英文</span>
        <h1>从意思想起表达</h1>
        <p>
          {mode === 'choice'
            ? '现在只需要认出对应的英文形式'
            : mode === 'result'
            ? '这次连接的结果已经记录'
            : '先自己回想；需要时再逐步减少难度'}
        </p>
      </header>

      <section className="recall-cue-card" aria-label="要表达的意思">
        <span className="recall-cue-label">要表达的意思</span>
        <p>{recall.cueL1}</p>
        <div className="recall-cue-features" aria-label="意思线索">
          {recall.cueFeatureLabelsL1.map((label, index) => (
            <span key={label}>
              {label}
              {index < recall.cueFeatureLabelsL1.length - 1 && <i aria-hidden="true">→</i>}
            </span>
          ))}
        </div>
      </section>

      {mode !== 'result' && transitionMessage && (
        <p className="recall-transition-message" role="status" aria-live="polite">
          <span aria-hidden="true">↗</span>{transitionMessage}
        </p>
      )}

      {(mode === 'independent' || mode === 'first_letter') && (
        <form className="recall-answer-form" onSubmit={submitTextAnswer}>
          <label htmlFor="meaning-to-form-answer">
            {mode === 'independent' ? '输入对应的英文词' : '根据首字母补全英文词'}
          </label>
          {mode === 'first_letter' && (
            <div className="recall-letter-mask" aria-label={`首字母提示 ${recall.primaryForm[0]}`}>
              {createFirstLetterMask(recall.primaryForm)}
            </div>
          )}
          <div className="recall-input-shell">
            <input
              ref={inputRef}
              id="meaning-to-form-answer"
              type="text"
              value={answer}
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="done"
              spellCheck={false}
              placeholder="在这里输入英文"
              onChange={(event) => setAnswer(event.currentTarget.value)}
            />
            {answer && (
              <button
                type="button"
                className="recall-clear-input"
                aria-label="清空输入"
                onClick={() => {
                  setAnswer('');
                  inputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
          <button type="submit" className="recall-submit-button" disabled={!answer.trim()}>
            确认表达
          </button>
          <button
            type="button"
            className="recall-support-button"
            onClick={mode === 'independent' ? requestFirstLetter : openChoices}
          >
            <svg className="icon" aria-hidden="true"><use href="#i-bulb" /></svg>
            {mode === 'independent' ? '提示一下' : '还是想不起来，改为选词'}
          </button>
        </form>
      )}

      {mode === 'choice' && (
        <section className="recall-choice-section">
          <h2>哪个英文词表达这个意思？</h2>
          <div className="recall-choice-grid" role="radiogroup" aria-label="选择英文表达">
            {recall.choiceOptions.map((option) => {
              const selected = option.id === selectedChoiceId;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`recall-choice${selected ? ' selected' : ''}`}
                  key={option.id}
                  onClick={() => setSelectedChoiceId(option.id)}
                >
                  <span>{option.textL2}</span>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="recall-submit-button"
            disabled={!selectedChoice}
            onClick={submitChoice}
          >
            确认选择
          </button>
          <button type="button" className="recall-support-button" onClick={() => finish('miss')}>
            直接看答案
          </button>
        </section>
      )}

      {mode === 'result' && outcome && (
        <section className={`recall-result ${feedback.tone}`} aria-live="polite">
          <div className="recall-result-status">
            <span aria-hidden="true">{feedback.icon}</span>
            <strong>{feedback.label}</strong>
          </div>
          <div className="recall-form-reveal">
            <div>
              <h2>{recall.primaryForm}</h2>
              <p>{content.ipa}</p>
            </div>
            <button
              type="button"
              aria-label={`播放 ${recall.primaryForm} 的发音`}
              onClick={() => {
                if (primaryPronunciation?.audioUrl) {
                  void audioService.playPackagedAudioUrl(
                    primaryPronunciation.audioUrl,
                    recall.primaryForm,
                    'us',
                  );
                }
                toast('播放美式发音');
              }}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-vol" /></svg>
            </button>
          </div>
          <span className="recall-sense-label">{content.partOfSpeech} {content.guideLabelL1}</span>
          <h3>{feedback.title}</h3>
          <p className="recall-result-body">{feedback.body}</p>

          <div className="recall-result-actions">
            <button
              type="button"
              className={outcome === 'independent' ? '' : 'emphasized'}
              onClick={() => {
                onViewChange();
                setReplayingExperience(true);
              }}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
              回看刚才的体验
              <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
            <button type="button" onClick={onOpenExample}>
              <svg className="icon" aria-hidden="true"><use href="#i-bookopen" /></svg>
              查看学习例句
              <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
            <button type="button" onClick={() => onOpenDictionary(recall.primaryForm)}>
              <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
              查看完整词典
              <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
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
        <div className="lfoot recall-footer" id="lFoot">
          <button type="button" className="fbtn green" onClick={() => onComplete(outcome)}>
            {outcome === 'independent' ? '继续学习' : '我知道了，稍后再试'}<i />
          </button>
        </div>
      )}
    </div>
  );
}

export function RecallCard(props: RecallCardProps) {
  if (
    props.assessment.packageKey !== props.content.packageKey
    || props.assessment.senseKey !== props.content.senseKey
  ) {
    throw new Error('Recall card resource does not match the selected Package.');
  }
  return props.presentation === 'baseline'
    ? <BaselineRecallCard {...props} />
    : <SensaRecallCard {...props} />;
}
