import type {FourStageTargetPresentation} from './InterleavedFourStageRuntimeScreen';
import {useTranslation} from 'react-i18next';
import { SensaPageLayout } from '../../ui/SensaPageLayouts';
import {
  type FourStageReviewAnswer,
  type FourStageReviewSession,
} from '../../../learning/runtime/interleavedFourStageProtocol';

export interface FourStageReviewExecution {
 session:FourStageReviewSession<string>|null;target:FourStageTargetPresentation|null;
 done:boolean;targetCount:number;busy:boolean;notice?:import('react').ReactNode;
 onAnswer:(answer:FourStageReviewAnswer)=>void;onContinue:()=>void;
}
interface InterleavedFourStageReviewScreenProps {
 readonly execution:FourStageReviewExecution;
  readonly active: boolean;
  readonly onExit: () => void;
  readonly onFinish: () => void;
}

export function InterleavedFourStageReviewScreen({
  active,
  execution,
  onExit,
  onFinish,
}: InterleavedFourStageReviewScreenProps) {
  const {t}=useTranslation();
  const session=execution.session;
  const done=execution.done;

  const settle = (answer: FourStageReviewAnswer) => {
    execution.onAnswer(answer);
  };

  const advance = () => {
    execution.onContinue();
  };

  const target=execution.target;
  const progressValue = execution.targetCount > 0
    ? Math.round(
        (Math.min(
          execution.targetCount,
          Math.max(0, session?.ordinal ?? (done ? execution.targetCount : 0)),
        ) / execution.targetCount) * 100,
      )
    : 0;

  return (
    <SensaPageLayout
      family="learning-runtime"
      className={`screen sensa-motion-screen sensa-motion-screen-fade z-40 ${active ? 'active visible pointer-events-auto opacity-100' : 'invisible pointer-events-none opacity-0'}`}
      id="s-four-stage-review-runtime"
      data-anim="fade"
      aria-hidden={!active}
      regions={{
        header: (
          <>
            <div className="flex flex-col"><small className="text-metadata text-fg-tertiary">{t('fourStage.reviewTitle')}</small><strong className="text-control-label">{session ? session.ordinal : t('fourStage.done')}</strong></div>
            <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">{t('fourStage.schedule')}</span>
          </>
        ),
        tools: <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-xl text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={onExit} aria-label={t('fourStage.exitReview')}>×</button>,
        progress: (
          <div role="progressbar" aria-label={t('runtime.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
            <svg className="h-full w-full" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
              <rect width={progressValue} height="1" className="fill-progress" />
            </svg>
          </div>
        ),
        primary: (
          <>
        {execution.notice}
        {session && target && session.phase === 'assessment' && (
          <section className="flex min-h-full flex-1 flex-col items-center text-center">
            <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{session.mode === 'review' ? t('fourStage.dueReview') : t('fourStage.relearning')}</small>
            <h1 className="mt-8 font-language text-learning-expression font-semibold">{target.expression}</h1>
            <p className="mt-5 max-w-md text-body-support leading-6 text-fg-secondary">{session.mode === 'review'
              ? t('fourStage.reviewPrompt')
              : t('fourStage.relearnPrompt')}</p>
            <div className="mt-auto grid w-full gap-3 pt-8 sm:grid-cols-3" role="group" aria-label={t('fourStage.rating')}>
              <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-feedback-danger focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle('forgotten')}>
                <strong>{t('fourStage.forgotten')}</strong><small>{session.mode === 'review' ? t('fourStage.again') : t('fourStage.continueRelearning')}</small>
              </button>
              <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-feedback-warning focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle('vague')}>
                <strong>{t('fourStage.vague')}</strong><small>{session.mode === 'review' ? 'Hard' : t('fourStage.finishRelearning')}</small>
              </button>
              <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-strong bg-accent-soft p-3 text-feedback-success focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle('known')}>
                <strong>{t('fourStage.known')}</strong><small>{session.mode === 'review' ? 'Good' : t('fourStage.finishRelearning')}</small>
              </button>
            </div>
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className="flex min-h-full flex-1 flex-col items-center text-center" aria-live="polite">
            <small>{session.mode === 'review' ? t('fourStage.reviewSaved') : t('fourStage.relearnFeedback')}</small>
            <h1 className="mt-8 font-language text-learning-expression font-semibold">{target.expression}</h1>
            <span className="mt-2 text-metadata text-fg-tertiary">{target.partOfSpeech}</span>
            <p className="mt-5 text-body text-fg-secondary">{target.meaning}</p>
            <blockquote className="mt-5 w-full rounded-card bg-surface-subtle p-6 text-left font-language text-lg leading-8">{target.example}</blockquote>
            <p className="mt-5 text-body-support text-fg-secondary">{session.answer === 'forgotten'
              ? t('fourStage.requeued')
              : session.mode === 'review'
                ? t('fourStage.grade',{grade:session.memoryOutcome?.grade??''})
                : t('fourStage.relearnSaved')}</p>
            <button className="mt-auto min-h-12 w-full rounded-control bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={advance}>{t('fourStage.continue')}</button>
          </section>
        )}

        {done && (
          <section className="flex min-h-full flex-1 flex-col items-center justify-center text-center" aria-live="polite">
            <span className="mb-5 grid size-15 place-items-center rounded-card bg-accent-soft text-2xl font-bold text-feedback-success" aria-hidden="true">✓</span>
            <small>{t('fourStage.reviewComplete')}</small>
            <h1 className="mt-3 text-page-title font-semibold">{t('fourStage.reviewCount',{count:execution.targetCount})}</h1>
            <p className="mt-3 text-body-support text-fg-secondary">{t('fourStage.reviewSummary')}</p>
            <button className="mt-8 min-h-12 w-full rounded-control bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={onFinish}>{t('fourStage.finish')}</button>
          </section>
        )}
          </>
        ),
      }}
    />
  );
}
