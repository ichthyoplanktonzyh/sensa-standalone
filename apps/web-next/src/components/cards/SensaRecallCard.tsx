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
  const [mode, setMode] = useState<RecallMode>('independent');
  const [answer, setAnswer] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MeaningToFormRecallOutcome | null>(null);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const [pronunciationIndex, setPronunciationIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
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
    setOutcome(nextOutcome);
    setMode('result');
    onViewChange();
  };

  const requestFirstLetter = () => {
    setMode('first_letter');
    setAnswer('');
    onViewChange();
  };

  const openChoices = () => {
    setMode('choice');
    setAnswer('');
    onViewChange();
  };

  const submitTextAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
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
    finish(selectedChoice.isTarget ? 'choice' : 'miss');
  };

  const feedback = outcome === 'independent'
    ? {
        tone: 'independent',
        marker: '✓',
        status: '连接闭合',
        title: recall.independentSuccessTitleL1,
        body: recall.independentSuccessBodyL1,
      }
    : outcome === 'first_letter'
    ? {
        tone: 'supported',
        marker: '↗',
        status: '借助一点线索',
        title: recall.supportedSuccessTitleL1,
        body: recall.supportedSuccessBodyL1,
      }
    : outcome === 'choice'
    ? {
        tone: 'supported',
        marker: '↗',
        status: '从形式中认出',
        title: recall.choiceSuccessTitleL1,
        body: recall.choiceSuccessBodyL1,
      }
    : {
        tone: 'repair',
        marker: '•',
        status: '连接需要修复',
        title: recall.repairTitleL1,
        body: recall.repairBodyL1,
      };

  const playPronunciation = () => {
    if (!activePronunciation?.audioUrl) {
      toast('当前学习包没有可用发音');
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
      toast(`正在播放${activeAccentIsUk ? '英式' : '美式'}发音；下次为${nextIsUk ? '英式' : '美式'}`);
      return;
    }
    toast(`正在播放${activeAccentIsUk ? '英式' : '美式'}发音`);
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
      className={`sensa-recall-page is-${mode}`}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className="sensa-recall-heading">
        <span>{isRetention ? '长期复习 · 独立取回' : '主动取回'}</span>
        <h1>
          {isRetention
            ? '从意思想起英文'
            : mode === 'result' ? '英文已经浮现' : '让英文浮现'}
        </h1>
      </header>

      <section className="sensa-recall-cue" aria-label="要取回的意思">
        <span>从这层意思出发</span>
        <p>{recall.cueL1}</p>
        <div className="sensa-recall-trace" aria-label="意思中的关键线索">
          {recall.cueFeatureLabelsL1.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </section>

      {(mode === 'independent' || mode === 'first_letter') && (
        <form className="sensa-recall-form" onSubmit={submitTextAnswer}>
          {mode === 'first_letter' && (
            <div className="sensa-recall-support-state" role="status" aria-live="polite">
              <span aria-hidden="true">↗</span>
              <p><strong>第一个字母已经出现</strong>这次会进入修复，稍后再独立取回</p>
            </div>
          )}
          <label htmlFor="sensa-meaning-to-form-answer">写下对应的英文形式</label>
          {mode === 'first_letter' && (
            <div className="sensa-recall-mask" aria-label={`首字母提示 ${recall.primaryForm[0]}`}>
              {createFirstLetterMask(recall.primaryForm)}
            </div>
          )}
          <div className="sensa-recall-input">
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
          <div className="sensa-recall-primary-actions">
            <button type="submit" disabled={!answer.trim()}>确认</button>
            <button
              type="button"
              onClick={() => {
                if (isRetention) {
                  onViewChange();
                  onComplete('miss', null);
                  return;
                }
                if (mode === 'independent') requestFirstLetter();
                else openChoices();
              }}
            >
              {isRetention
                ? '想不起来，进入修复'
                : mode === 'independent' ? '给我一点线索' : '从几个词里找'}
            </button>
          </div>
        </form>
      )}

      {mode === 'choice' && (
        <section className="sensa-recall-choice-stage">
          <div className="sensa-recall-support-state" role="status" aria-live="polite">
            <span aria-hidden="true">↗</span>
            <p><strong>答案范围已经缩小</strong>现在只需找到对应形式</p>
          </div>
          <div className="sensa-recall-choice-list" role="radiogroup" aria-label="选择英文形式">
            {recall.choiceOptions.map((option) => {
              const selected = option.id === selectedChoiceId;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'is-selected' : ''}
                  key={option.id}
                  onClick={() => setSelectedChoiceId(option.id)}
                >
                  <span>{option.textL2}</span>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="sensa-recall-primary-actions">
            <button type="button" disabled={!selectedChoice} onClick={submitChoice}>确认</button>
            <button type="button" onClick={() => finish('miss')}>直接揭示</button>
          </div>
        </section>
      )}

      {mode === 'result' && outcome && (
        <section
          ref={resultRef}
          tabIndex={-1}
          className={`sensa-recall-result is-${feedback.tone}`}
          aria-live="polite"
        >
          <div className="sensa-recall-result-status">
            <span aria-hidden="true">{feedback.marker}</span>
            <small>{feedback.status}</small>
          </div>
          <div className="sensa-recall-form-reveal">
            <div>
              <h2>{recall.primaryForm}</h2>
              <p>{activePronunciation?.ipa ?? content.ipa}</p>
            </div>
            <button
              type="button"
              onClick={playPronunciation}
              aria-label={`播放${activeAccentIsUk ? '英式' : '美式'}发音`}
            >
              <span>{activeAccentIsUk ? '英' : '美'}</span>
              <svg className="icon" aria-hidden="true"><use href="#i-vol" /></svg>
            </button>
          </div>
          <div className="sensa-recall-result-copy">
            <h3>{feedback.title}</h3>
            <p>{feedback.body}</p>
          </div>
          {outcome !== 'independent' && (
            <button
              type="button"
              className="sensa-recall-repair-action"
              onClick={() => {
                onViewChange();
                setReplayingExperience(true);
              }}
            >
              <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
              <span>回到经验连接</span>
              <svg className="icon" aria-hidden="true"><use href="#i-chev-r" /></svg>
            </button>
          )}
          <div className="sensa-recall-resource-strip" aria-label="当前意思的辅助内容">
            <button type="button" onClick={onOpenExample}>
              <svg className="icon" aria-hidden="true"><use href="#i-bookopen" /></svg>
              例句
            </button>
            <i aria-hidden="true" />
            <button type="button" onClick={() => onOpenDictionary(recall.primaryForm)}>
              <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
              词典
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
        <footer className="sensa-recall-footer">
          <button type="button" onClick={() => onComplete(outcome, null)}>
            {outcome === 'independent' ? '继续学习' : '继续，稍后再取回'}
          </button>
        </footer>
      )}
    </div>
  );
}
