import { useEffect, useState, type MouseEvent } from 'react';
import type { LegacyLearningDemoStage, QuickDictEntry, Word } from '../types';
import type { PrototypeIntroductionPackage } from '../content/learningCatalog';
import { personalContentService } from '../services/personalContentService';
import { AudioChoiceCard } from './cards/AudioChoiceCard';
import { DetailCard } from './cards/DetailCard';
import { FinalGateCard } from './cards/FinalGateCard';

/**
 * The old baseline-only stages are kept available for side-panel comparison,
 * but are intentionally isolated from the production LearnScreen. They are
 * not part of the Sensa acquisition or review runtime.
 */
interface LegacyLearningDemoScreenProps {
  active: boolean;
  isBehind: boolean;
  curWord: Word;
  stage: LegacyLearningDemoStage;
  step: number;
  groupSize: number;
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: (
    e: MouseEvent,
    personalContent: PrototypeIntroductionPackage | null,
  ) => void;
  onOpenExample: (idx: number) => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onOpenNoteEditor?: (word: Word | QuickDictEntry | string) => void;
  onOpenSpelling?: (word: Word) => void;
  onNextWord: () => void;
  onMarkMistake: () => void;
  onShowAnswer: () => void;
  onPickOption: (ok: boolean) => void;
  onPickFinalGate: (known: boolean) => void;
  toast: (msg: string) => void;
}

export const LegacyLearningDemoScreen = ({
  active,
  isBehind,
  curWord,
  stage,
  step,
  groupSize,
  onExit,
  onUndo,
  onMarkKnown,
  onOpenMenuMore,
  onOpenExample,
  onOpenDict,
  onOpenNoteEditor,
  onOpenSpelling,
  onNextWord,
  onMarkMistake,
  onShowAnswer,
  onPickOption,
  onPickFinalGate,
  toast,
}: LegacyLearningDemoScreenProps) => {
  const [starred, setStarred] = useState(false);
  const savedSenseId = curWord.id ?? `word:${curWord.w}`;

  useEffect(() => {
    const updateSavedState = () => {
      setStarred(personalContentService.isSenseSaved(savedSenseId));
    };
    updateSavedState();
    return personalContentService.subscribe(updateSavedState);
  }, [savedSenseId]);

  const progressLabel = `${Math.min(step, groupSize)}/${groupSize}`;

  return (
    <section
      className={`screen legacy-learning-demo${active ? ' active' : ''}${isBehind ? ' behind' : ''}`}
      id="s-legacy-learning-demo"
      data-anim="fade"
      data-legacy-stage={stage}
    >
      <div className="h-sp" />

      <div className="lh">
        <button onClick={onExit} aria-label="返回">
          <svg className="icon" style={{ width: 26, height: 26 }}><use href="#i-chev-l" /></svg>
        </button>
        <span className="prog-n" id="legacyLearnProgress">{progressLabel}</span>
        <div className="tools">
          <button
            id="legacyBtnUndo"
            disabled={step <= 1}
            onClick={onUndo}
            aria-label="撤回"
          >
            <svg className="icon"><use href="#i-undo" /></svg>
          </button>
          <button
            id="legacyBtnStar"
            className={starred ? 'on' : ''}
            onClick={() => {
              const next = personalContentService.toggleSense(savedSenseId);
              toast(next ? '已收藏这个义项' : '已取消收藏');
            }}
            aria-label="收藏这个义项"
          >
            <svg
              className="icon"
              style={{
                fill: starred ? '#d9642d' : 'none',
                stroke: starred ? '#d9642d' : 'currentColor',
              }}
            >
              <use href="#i-star" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (onOpenSpelling) {
                onOpenSpelling(curWord);
              } else {
                toast(`开始拼写练习：${curWord.w}`);
              }
            }}
            aria-label="拼写练习"
            title="拼写练习"
          >
            <span className="txt" style={{ fontSize: 17, letterSpacing: '-.5px', borderBottom: '1.6px solid currentColor', paddingBottom: 1 }}>
              abc
            </span>
          </button>
          <button onClick={onMarkKnown} aria-label="声明这个义项已会">
            <span className="txt">熟</span>
          </button>
          <button
            onClick={(event) => onOpenMenuMore(event, null)}
            aria-label="更多"
          >
            <svg className="icon"><use href="#i-dots" /></svg>
          </button>
        </div>
      </div>

      <div className="lscroll" id="legacyLearnScroll">
        {stage === 'audio_choice' && (
          <AudioChoiceCard
            word={curWord}
            onAnswer={onPickOption}
            onShowAnswer={onShowAnswer}
            toast={toast}
          />
        )}

        {stage === 'final_gate' && (
          <FinalGateCard
            word={curWord}
            onAnswer={onPickFinalGate}
            toast={toast}
          />
        )}

        {stage === 'detail' && (
          <DetailCard
            word={curWord}
            onOpenExample={onOpenExample}
            onOpenDict={onOpenDict}
            onOpenNoteEditor={onOpenNoteEditor}
            onNextWord={onNextWord}
            onMarkMistake={onMarkMistake}
            toast={toast}
          />
        )}
      </div>
    </section>
  );
};
