import { useState, useEffect, useRef, type MouseEvent } from 'react';
import type { Word, LearningStage, QuickDictEntry } from '../types';
import { ChoiceCard } from './cards/ChoiceCard';
import { RecallCard } from './cards/RecallCard';
import { AudioChoiceCard } from './cards/AudioChoiceCard';
import { FinalGateCard } from './cards/FinalGateCard';
import { ReviewRecallCard, type ReviewAnswerType } from './cards/ReviewRecallCard';
import { DetailCard } from './cards/DetailCard';

interface LearnScreenProps {
  active: boolean;
  isBehind: boolean;
  curWord: Word;
  stage: LearningStage;
  step: number;
  groupSize: number;
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: (e: MouseEvent) => void;
  onOpenExample: (idx: number) => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onOpenNoteEditor?: (word: Word) => void;
  onOpenSpelling?: (word: Word) => void;
  onNextWord: () => void;
  onMarkMistake: () => void;
  onShowAnswer: () => void;
  onPickOption: (ok: boolean) => void;
  onPickRecall: (known: boolean) => void;
  onPickFinalGate: (known: boolean) => void;
  onPickReviewRecall?: (type: ReviewAnswerType) => void;
  toast: (msg: string) => void;
}

export const LearnScreen = ({
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
  onPickRecall,
  onPickFinalGate,
  onPickReviewRecall,
  toast,
}: LearnScreenProps) => {
  const [starred, setStarred] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 词或阶段切换时，将滚动容器置顶
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [curWord, stage, step]);

  return (
    <section
      className={`screen${active ? ' active' : ''}${isBehind ? ' behind' : ''}`}
      id="s-learn"
      data-anim="fade"
    >
      <div className="h-sp" />

      {/* 顶部工具栏 */}
      <div className="lh">
        <button onClick={onExit} aria-label="返回">
          <svg className="icon" style={{ width: 26, height: 26 }}><use href="#i-chev-l" /></svg>
        </button>
        <span className="prog-n" id="lhProg">{step}/{groupSize}</span>
        <div className="tools">
          <button
            id="btnUndo"
            disabled={step <= 1}
            onClick={onUndo}
            aria-label="撤回"
          >
            <svg className="icon"><use href="#i-undo" /></svg>
          </button>
          <button
            id="btnStar"
            className={starred ? 'on' : ''}
            onClick={() => {
              const next = !starred;
              setStarred(next);
              toast(next ? '已加入单词本' : '已移出单词本');
            }}
            aria-label="收藏"
          >
            <svg
              className="icon"
              style={{
                fill: starred ? '#f2701c' : 'none',
                stroke: starred ? '#f2701c' : 'currentColor',
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
          <button onClick={onMarkKnown}><span className="txt">熟</span></button>
          <button onClick={onOpenMenuMore} aria-label="更多"><svg className="icon"><use href="#i-dots" /></svg></button>
        </div>
      </div>

      {/* 核心卡片渲染视口 */}
      <div className="lscroll" id="lScroll" ref={scrollRef}>
        {stage === 'choice' && (
          <ChoiceCard
            word={curWord}
            onAnswer={onPickOption}
            onShowAnswer={onShowAnswer}
            toast={toast}
          />
        )}

        {stage === 'recall' && (
          <RecallCard
            word={curWord}
            onAnswer={onPickRecall}
            onOpenDict={onOpenDict}
            toast={toast}
          />
        )}

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

        {stage === 'review_recall' && (
          <ReviewRecallCard
            word={curWord}
            onAnswer={(type) => {
              if (onPickReviewRecall) {
                onPickReviewRecall(type);
              }
            }}
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
