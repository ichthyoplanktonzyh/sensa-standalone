import { uiClass } from '../../ui/classes';
import { useEffect, useMemo, useState } from 'react';
import {
  PROTOTYPE_LEARNING_TARGETS,
  experienceGroundingForTarget,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from '../../learningJourney/prototypeLearning';

type LightweightReviewPhase =
  | 'recall'
  | 'answer'
  | 'repair'
  | 'retry'
  | 'retry_answer'
  | 'summary';

interface LightweightReviewResult {
  targetId: PrototypeLearningTargetId;
  rating: PrototypeLightweightRating;
}

interface LightweightReviewRuntimeScreenProps {
  active: boolean;
  targetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
  onRateTarget: (
    targetId: PrototypeLearningTargetId,
    rating: PrototypeLightweightRating,
  ) => void;
  onCompleteRepair: (targetId: PrototypeLearningTargetId) => void;
  finishLabel?: string;
  onFinish: () => void;
}

const ratingLabel: Record<PrototypeLightweightRating, string> = {
  again: '已修复 · 10 分钟后',
  hard: '费力想起 · 明天',
  good: '顺利想起 · 3 天后',
};

export const LightweightReviewRuntimeScreen = ({
  active,
  targetIds,
  onExit,
  onRateTarget,
  onCompleteRepair,
  finishLabel = '完成并回到首页',
  onFinish,
}: LightweightReviewRuntimeScreenProps) => {
  const [phase, setPhase] = useState<LightweightReviewPhase>('recall');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [repairAttempts, setRepairAttempts] = useState(0);
  const [results, setResults] = useState<LightweightReviewResult[]>([]);
  const sessionKey = targetIds.join('|');

  useEffect(() => {
    setPhase('recall');
    setCurrentIndex(0);
    setRepairAttempts(0);
    setResults([]);
  }, [sessionKey]);

  const targetId = targetIds[currentIndex]!;
  const target = PROTOTYPE_LEARNING_TARGETS[targetId];
  const grounding = useMemo(
    () => experienceGroundingForTarget(target),
    [target],
  );

  const advanceCurrent = (rating: PrototypeLightweightRating) => {
    setResults((current) => [
      ...current,
      { targetId, rating },
    ]);
    setRepairAttempts(0);

    if (currentIndex + 1 < targetIds.length) {
      setCurrentIndex((index) => index + 1);
      setPhase('recall');
      return;
    }
    setPhase('summary');
  };

  const rate = (rating: PrototypeLightweightRating) => {
    onRateTarget(targetId, rating);
    if (rating === 'again') {
      setRepairAttempts(1);
      setPhase('repair');
      return;
    }
    advanceCurrent(rating);
  };

  const completedCount = results.length;
  const lapseCount = results.filter((result) => result.rating === 'again').length;

  return (
    <section
      className={uiClass(`screen lightweight-review-runtime phase-${phase}${active ? ' active' : ''}`, "#s-lightweight-review-runtime")}
      id="s-lightweight-review-runtime"
      data-anim="fade"
    >
      <header className={uiClass("lightweight-review-nav")}>
        <button type="button" onClick={onExit} aria-label="暂时退出复习">×</button>
        <div>
          <small>轻量复习</small>
          <strong>{phase === 'summary' ? '本轮完成' : `${currentIndex + 1} / ${targetIds.length}`}</strong>
        </div>
        <span>学习方式已锁定</span>
      </header>

      <main className={uiClass("lightweight-review-body")}>
        {phase === 'recall' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-recall")} key={`recall-${targetId}`}>
            <small>到期复习 · 独立取回</small>
            <div className={uiClass("lightweight-review-cue")}>
              <span>意思线索</span>
              <h1>{target.meaning}</h1>
              <p>{grounding.scene}</p>
            </div>
            <p>你会用哪个英语表达说出这个意思？</p>
            <button type="button" onClick={() => setPhase('answer')}>显示答案</button>
          </section>
        )}

        {phase === 'answer' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-answer")} key={`answer-${targetId}`} aria-live="polite">
            <small>核对刚才的回想</small>
            <h1>{target.expression}</h1>
            <span>{target.expressionTypeLabel} · {target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>

            <div className={uiClass("lightweight-review-rating")} role="group" aria-label="评价刚才的回想">
              <button type="button" className={uiClass("is-again")} onClick={() => rate('again')}>
                <strong>没想起</strong><small>记录遗忘并修复</small>
              </button>
              <button type="button" className={uiClass("is-hard")} onClick={() => rate('hard')}>
                <strong>想起但费力</strong><small>缩短下次间隔</small>
              </button>
              <button type="button" className={uiClass("is-good")} onClick={() => rate('good')}>
                <strong>顺利想起</strong><small>按正常间隔保持</small>
              </button>
            </div>
          </section>
        )}

        {phase === 'repair' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-repair")} key={`repair-${targetId}-${repairAttempts}`}>
            <small>遗忘修复 · 本次 Review 已记录</small>
            <h1>重新连一次经验与表达</h1>
            <div className={uiClass("lightweight-review-repair-scene")}>
              <span>{grounding.sourceLabel}</span>
              <p>{grounding.scene}</p>
            </div>
            <div className={uiClass("lightweight-review-repair-binding")}>
              <strong>{target.expression}</strong>
              <i aria-hidden="true">↔</i>
              <p>{target.meaning}</p>
            </div>
            <p>这里是在恢复连接，不会再次改写刚才那次到期复习的结果。</p>
            <button type="button" onClick={() => setPhase('retry')}>继续，重新回想</button>
          </section>
        )}

        {phase === 'retry' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-recall is-retry")} key={`retry-${targetId}-${repairAttempts}`}>
            <small>修复后的独立回想</small>
            <div className={uiClass("lightweight-review-cue")}>
              <span>只看意思</span>
              <h1>{target.meaning}</h1>
            </div>
            <p>暂时移开刚才看到的表达，再从意思把它取回来。</p>
            <button type="button" onClick={() => setPhase('retry_answer')}>核对修复结果</button>
          </section>
        )}

        {phase === 'retry_answer' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-retry-result")} key={`retry-answer-${targetId}-${repairAttempts}`} aria-live="polite">
            <small>修复检查 · 不重复评价 Review</small>
            <h1>{target.expression}</h1>
            <p>{target.meaning}</p>
            <div>
              <button
                type="button"
                onClick={() => {
                  setRepairAttempts((attempts) => attempts + 1);
                  setPhase('repair');
                }}
              >
                <strong>还是没连上</strong><small>再修复一次</small>
              </button>
              <button
                type="button"
                className={uiClass("is-restored")}
                onClick={() => {
                  onCompleteRepair(targetId);
                  advanceCurrent('again');
                }}
              >
                <strong>现在想起来了</strong><small>完成本次重学</small>
              </button>
            </div>
          </section>
        )}

        {phase === 'summary' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-summary")} key="summary" aria-live="polite">
            <span className={uiClass("lightweight-review-summary-mark")} aria-hidden="true">✓</span>
            <small>轻量复习完成</small>
            <h1>{completedCount} 个意思已处理</h1>
            <p>{lapseCount > 0 ? `${lapseCount} 个遗忘已完成修复。` : '这轮没有出现需要修复的遗忘。'}</p>
            <div className={uiClass("lightweight-review-summary-list")}>
              {results.map((result) => (
                <div key={result.targetId}>
                  <strong>{PROTOTYPE_LEARNING_TARGETS[result.targetId].expression}</strong>
                  <span>{ratingLabel[result.rating]}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={onFinish}>{finishLabel}</button>
          </section>
        )}
      </main>
    </section>
  );
};
