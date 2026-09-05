import { uiClass } from '../../ui/classes';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GradedMemoryOutcome } from '@sensa/learning-kernel';
import {
  PROTOTYPE_LEARNING_TARGETS,
  type PrototypeLearningTargetId,
} from '../../learningJourney/prototypeLearning';
import {
  InterleavedFourStageReviewQueue,
  type FourStageReviewAnswer,
  type FourStageReviewSession,
} from '../../learningRuntime/interleavedFourStageProtocol';

interface InterleavedFourStageReviewScreenProps {
  readonly active: boolean;
  readonly targetIds: readonly PrototypeLearningTargetId[];
  readonly relearningTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  readonly onExit: () => void;
  readonly onMemoryOutcome: (
    targetId: PrototypeLearningTargetId,
    outcome: GradedMemoryOutcome,
  ) => void;
  readonly onRelearningComplete: (targetId: PrototypeLearningTargetId) => void;
  readonly onFinish: () => void;
}

export function InterleavedFourStageReviewScreen({
  active,
  targetIds,
  relearningTargetIds,
  onExit,
  onMemoryOutcome,
  onRelearningComplete,
  onFinish,
}: InterleavedFourStageReviewScreenProps) {
  const queueRef = useRef<InterleavedFourStageReviewQueue<PrototypeLearningTargetId> | null>(null);
  const [session, setSession] = useState<FourStageReviewSession<PrototypeLearningTargetId> | null>(null);
  const [done, setDone] = useState(false);
  const runKey = targetIds.map((targetId) =>
    `${targetId}:${relearningTargetIds.has(targetId) ? 'relearning' : 'review'}`).join('|');

  const sync = useCallback((queue: InterleavedFourStageReviewQueue<PrototypeLearningTargetId>) => {
    setSession(queue.getCurrentSession());
    setDone(queue.isDone());
  }, []);

  useEffect(() => {
    const queue = new InterleavedFourStageReviewQueue(targetIds.map((targetId) => ({
      targetId,
      mode: relearningTargetIds.has(targetId) ? 'relearning' as const : 'review' as const,
    })));
    queueRef.current = queue;
    sync(queue);
  }, [runKey, sync]);

  const settle = (answer: FourStageReviewAnswer) => {
    const queue = queueRef.current;
    if (!queue || !session) return;
    const settled = queue.settle(answer);
    if (settled?.memoryOutcome) onMemoryOutcome(settled.targetId, settled.memoryOutcome);
    if (settled?.mode === 'relearning' && answer !== 'forgotten') {
      onRelearningComplete(settled.targetId);
    }
    sync(queue);
  };

  const advance = () => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeFeedback();
    sync(queue);
  };

  const target = session ? PROTOTYPE_LEARNING_TARGETS[session.targetId] : null;

  return (
    <section
      className={uiClass(`screen lightweight-review-runtime four-stage-review-runtime${active ? ' active' : ''}`, "#s-four-stage-review-runtime")}
      id="s-four-stage-review-runtime"
      data-anim="fade"
    >
      <header className={uiClass("lightweight-review-nav")}>
        <button type="button" onClick={onExit} aria-label="暂时退出复习">×</button>
        <div><small>四阶段长期复习</small><strong>{session ? session.ordinal : '完成'}</strong></div>
        <span>FSRS 调度</span>
      </header>

      <main className={uiClass("lightweight-review-body")}>
        {session && target && session.phase === 'assessment' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-recall")}>
            <small>{session.mode === 'review' ? '到期复习 · 三向评价' : '遗忘后的当日重学检查'}</small>
            <h1>{target.expression}</h1>
            <p>{session.mode === 'review'
              ? '先回想这个表达对应的目标意思，再评价当前记忆状态。'
              : '详情修复后再次回想；这里不会产生第二个原 Review Outcome。'}</p>
            <div className={uiClass("lightweight-review-rating")} role="group" aria-label="记忆评价">
              <button type="button" className={uiClass("is-again")} onClick={() => settle('forgotten')}>
                <strong>忘记了</strong><small>{session.mode === 'review' ? 'Again · 进入重学' : '继续重学'}</small>
              </button>
              <button type="button" className={uiClass("is-hard")} onClick={() => settle('vague')}>
                <strong>模糊</strong><small>{session.mode === 'review' ? 'Hard' : '完成重学'}</small>
              </button>
              <button type="button" className={uiClass("is-good")} onClick={() => settle('known')}>
                <strong>认识</strong><small>{session.mode === 'review' ? 'Good' : '完成重学'}</small>
              </button>
            </div>
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-answer")} aria-live="polite">
            <small>{session.mode === 'review' ? '本次 Review 已唯一结算' : '重学反馈'}</small>
            <h1>{target.expression}</h1>
            <span>{target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>
            <p>{session.answer === 'forgotten'
              ? '这个目标已放回队尾。详情负责修复，不会重复更新刚才的 FSRS Outcome。'
              : session.mode === 'review'
                ? `已保留分级结果：${session.memoryOutcome?.grade ?? ''}`
                : '连接已恢复；原先的 Again 结果与调度修订保持不变。'}</p>
            <button type="button" onClick={advance}>继续</button>
          </section>
        )}

        {done && (
          <section className={uiClass("lightweight-review-stage lightweight-review-summary")} aria-live="polite">
            <span className={uiClass("lightweight-review-summary-mark")} aria-hidden="true">✓</span>
            <small>四阶段长期复习完成</small>
            <h1>{targetIds.length} 个目标已处理</h1>
            <p>每个到期目标最多产生一个分级 Memory Outcome。</p>
            <button type="button" onClick={onFinish}>完成并回到首页</button>
          </section>
        )}
      </main>
    </section>
  );
}
