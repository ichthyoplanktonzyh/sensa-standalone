import type {FourStageTargetPresentation} from './InterleavedFourStageRuntimeScreen';
import {useTranslation} from 'react-i18next';
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

export interface FourStageReviewExecution {
 session:FourStageReviewSession<string>|null;target:FourStageTargetPresentation|null;
 done:boolean;targetCount:number;busy:boolean;notice?:import('react').ReactNode;
 onAnswer:(answer:FourStageReviewAnswer)=>void;onContinue:()=>void;
}
interface InterleavedFourStageReviewScreenProps {
 readonly execution?:FourStageReviewExecution;
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
  execution,
  targetIds,
  relearningTargetIds,
  onExit,
  onMemoryOutcome,
  onRelearningComplete,
  onFinish,
}: InterleavedFourStageReviewScreenProps) {
  const {t}=useTranslation();
  const queueRef = useRef<InterleavedFourStageReviewQueue<PrototypeLearningTargetId> | null>(null);
  const [previewSession, setSession] = useState<FourStageReviewSession<PrototypeLearningTargetId> | null>(null);
  const [previewDone, setDone] = useState(false);
  const session=execution?execution.session:previewSession;
  const done=execution?execution.done:previewDone;
  const runKey = targetIds.map((targetId) =>
    `${targetId}:${relearningTargetIds.has(targetId) ? 'relearning' : 'review'}`).join('|');

  const sync = useCallback((queue: InterleavedFourStageReviewQueue<PrototypeLearningTargetId>) => {
    setSession(queue.getCurrentSession());
    setDone(queue.isDone());
  }, []);

  useEffect(() => {
    if(execution)return;
    const queue = new InterleavedFourStageReviewQueue(targetIds.map((targetId) => ({
      targetId,
      mode: relearningTargetIds.has(targetId) ? 'relearning' as const : 'review' as const,
    })));
    queueRef.current = queue;
    sync(queue);
  }, [runKey, sync]);

  const settle = (answer: FourStageReviewAnswer) => {
    if(execution){execution.onAnswer(answer);return;}
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
    if(execution){execution.onContinue();return;}
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeFeedback();
    sync(queue);
  };

  const target = execution?execution.target:previewSession ? PROTOTYPE_LEARNING_TARGETS[previewSession.targetId] : null;

  return (
    <section
      className={uiClass(`screen lightweight-review-runtime four-stage-review-runtime${active ? ' active' : ''}`, "#s-four-stage-review-runtime")}
      id="s-four-stage-review-runtime"
      data-anim="fade"
    >
      <header className={uiClass("lightweight-review-nav")}>
        <button disabled={execution?.busy} type="button" onClick={onExit} aria-label={t('fourStage.exitReview')}>×</button>
        <div><small>{t('fourStage.reviewTitle')}</small><strong>{session ? session.ordinal : t('fourStage.done')}</strong></div>
        <span>{t('fourStage.schedule')}</span>
      </header>

      <main className={uiClass("lightweight-review-body")}>
        {execution?.notice}
        {session && target && session.phase === 'assessment' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-recall")}>
            <small>{session.mode === 'review' ? t('fourStage.dueReview') : t('fourStage.relearning')}</small>
            <h1>{target.expression}</h1>
            <p>{session.mode === 'review'
              ? t('fourStage.reviewPrompt')
              : t('fourStage.relearnPrompt')}</p>
            <div className={uiClass("lightweight-review-rating")} role="group" aria-label={t('fourStage.rating')}>
              <button disabled={execution?.busy} type="button" className={uiClass("is-again")} onClick={() => settle('forgotten')}>
                <strong>{t('fourStage.forgotten')}</strong><small>{session.mode === 'review' ? t('fourStage.again') : t('fourStage.continueRelearning')}</small>
              </button>
              <button disabled={execution?.busy} type="button" className={uiClass("is-hard")} onClick={() => settle('vague')}>
                <strong>{t('fourStage.vague')}</strong><small>{session.mode === 'review' ? 'Hard' : t('fourStage.finishRelearning')}</small>
              </button>
              <button disabled={execution?.busy} type="button" className={uiClass("is-good")} onClick={() => settle('known')}>
                <strong>{t('fourStage.known')}</strong><small>{session.mode === 'review' ? 'Good' : t('fourStage.finishRelearning')}</small>
              </button>
            </div>
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className={uiClass("lightweight-review-stage lightweight-review-answer")} aria-live="polite">
            <small>{session.mode === 'review' ? t('fourStage.reviewSaved') : t('fourStage.relearnFeedback')}</small>
            <h1>{target.expression}</h1>
            <span>{target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>
            <p>{session.answer === 'forgotten'
              ? t('fourStage.requeued')
              : session.mode === 'review'
                ? t('fourStage.grade',{grade:session.memoryOutcome?.grade??''})
                : t('fourStage.relearnSaved')}</p>
            <button disabled={execution?.busy} type="button" onClick={advance}>{t('fourStage.continue')}</button>
          </section>
        )}

        {done && (
          <section className={uiClass("lightweight-review-stage lightweight-review-summary")} aria-live="polite">
            <span className={uiClass("lightweight-review-summary-mark")} aria-hidden="true">✓</span>
            <small>{t('fourStage.reviewComplete')}</small>
            <h1>{t('fourStage.reviewCount',{count:execution?.targetCount??targetIds.length})}</h1>
            <p>{t('fourStage.reviewSummary')}</p>
            <button disabled={execution?.busy} type="button" onClick={onFinish}>{t('fourStage.finish')}</button>
          </section>
        )}
      </main>
    </section>
  );
}
