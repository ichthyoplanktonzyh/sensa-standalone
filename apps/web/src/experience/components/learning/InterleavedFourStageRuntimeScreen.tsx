import type {RuntimeLearningContent} from '../../../learning/content/learningCatalog';
import {useTranslation} from 'react-i18next';
import { fadeScreenClass } from '../../ui/primitives';
import {useEffect,useRef} from 'react';
import {
  type FourStageQueueProjection,
  type FourStageSession,
} from '../../../learning/runtime/interleavedFourStageProtocol';

export interface FourStageTargetPresentation {expression:string;meaning:string;example:string;partOfSpeech:string}
export interface FourStageInitialExecution {
  session:FourStageSession<string>|null;
  projection:FourStageQueueProjection<string>;
  target:FourStageTargetPresentation|null;
  content:RuntimeLearningContent|null;
  busy:boolean;
  notice?:import('react').ReactNode;
  onChoice:(id:string)=>void;
  onSelfReport:(known:boolean)=>void;
  onContinue:()=>void;
}
interface InterleavedFourStageRuntimeScreenProps {
  readonly execution:FourStageInitialExecution;
  readonly active: boolean;
  readonly onExit: () => void;
  readonly onFinish: () => void;
}

const presentationLabel = {
  meaning_choice: 'meaningChoice',
  context_recall: 'contextRecall',
  sound_choice: 'soundChoice',
  final_recall: 'finalRecall',
} as const;

export function InterleavedFourStageRuntimeScreen({
  active,
  execution,
  onExit,
  onFinish,
}: InterleavedFourStageRuntimeScreenProps) {
  const {t}=useTranslation();
  const session=execution.session;
  const projection=execution.projection;
  const target=execution.target;
  const runtimeContent=execution.content;
  const recognitionOptions = runtimeContent?.recognitionAssessment.options ?? [];
  const completedCredits = session && projection
    ? Object.values(
      projection.targets.find((candidate) => candidate.targetId === session.targetId)
        ?.progress.checkpointCredits ?? {},
    ).filter((credit) => credit.status === 'credited').length
    : 0;

  const settle = (satisfied: boolean) => {
    execution.onSelfReport(satisfied);
  };

  const continueAfterFeedback = () => {
    execution.onContinue();
  };

  const audioRef=useRef<HTMLAudioElement|null>(null);
  useEffect(()=>{if(!active)audioRef.current?.pause();return()=>{audioRef.current?.pause();};},[active,session?.sessionOrdinal]);
  const playPronunciation = () => {
    const audioUrl = runtimeContent?.pronunciations.find(
      (pronunciation) => pronunciation.audioUrl,
    )?.audioUrl;
    if (!audioUrl || typeof Audio === 'undefined') return;
    audioRef.current?.pause();
    const audio=new Audio(audioUrl);audioRef.current=audio;
    void audio.play().catch(() => undefined);
  };

  if (!projection) return null;

  return (
    <section
      className={`${fadeScreenClass(active, 'z-40')} flex flex-col overflow-hidden`}
      id="s-four-stage-runtime"
      data-anim="fade"
      aria-hidden={!active}
    >
      <header className="relative z-[1] grid min-h-20 grid-cols-[2.75rem_1fr_auto] items-center gap-3 border-b border-border-subtle bg-surface-canvas/95 px-6 py-4">
        <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-xl text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={onExit} aria-label={t('fourStage.exitLearning')}>×</button>
        <span className="text-center text-control-label font-semibold">{session ? t('fourStage.'+presentationLabel[session.presentation]) : t('fourStage.completed')}</span>
        <em className="text-metadata not-italic text-fg-secondary">{projection.graduatedTargetIds.length} / {t('fourStage.targetCount',{count:projection.targetCount})}</em>
      </header>

      <main className="relative z-[1] mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 py-8 [scrollbar-width:thin] sm:px-10">
        {execution.notice}
        {session && target && session.phase === 'assessment' && (
          <section className="flex min-h-full flex-1 flex-col" key={`${session.sessionOrdinal}:assessment`}>
            <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{t('fourStage.'+presentationLabel[session.presentation])} · {t('fourStage.credits',{count:completedCredits})}</small>

            {session.presentation === 'meaning_choice' && (
              <>
                <h1 className="mt-8 font-language text-learning-expression font-semibold">{target.expression}</h1>
                <p className="mt-4 text-body-support text-fg-secondary">{t('fourStage.chooseMeaning')}</p>
                <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3" role="group" aria-label={t('fourStage.meaningOptions')}>
                  {recognitionOptions.map((option) => (
                    <button className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" key={option.id} onClick={() => execution.onChoice(option.id)}>
                      <strong>{option.textL1}</strong><small>{t('fourStage.choose')}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'context_recall' && (
              <>
                <blockquote className="mt-8 rounded-card bg-surface-subtle p-6 font-language text-lg leading-8">{target.example}</blockquote>
                <h1 className="mt-8 text-page-title font-semibold">{t('fourStage.recognizeContext')}</h1>
                <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-2" role="group" aria-label={t('fourStage.contextResult')}>
                  <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-feedback-danger focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle(false)}>
                    <strong>{t('fourStage.notRecognized')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-strong bg-accent-soft p-3 text-feedback-success focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle(true)}>
                    <strong>{t('fourStage.recognized')}</strong><small>{t('fourStage.nextStage')}</small>
                  </button>
                </div>
              </>
            )}

            {session.presentation === 'sound_choice' && (
              <>
                <button disabled={execution.busy} type="button" onClick={playPronunciation}>{t('fourStage.play')}</button>
                <h1 className="mt-8 text-page-title font-semibold">{t('fourStage.listenMeaning')}</h1>
                <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3" role="group" aria-label={t('fourStage.soundOptions')}>
                  {recognitionOptions.map((option) => (
                    <button className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" key={option.id} onClick={() => execution.onChoice(option.id)}>
                      <strong>{option.textL1}</strong><small>{t('fourStage.choose')}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'final_recall' && (
              <>
                <small>{t('fourStage.noHint')}</small>
                <h1 className="mt-8 font-language text-learning-expression font-semibold">{target.expression}</h1>
                <p className="mt-4 text-body-support text-fg-secondary">{t('fourStage.recognizeFinal')}</p>
                <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-2" role="group" aria-label={t('fourStage.finalResult')}>
                  <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-panel p-3 text-feedback-danger focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle(false)}>
                    <strong>{t('fourStage.unknown')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution.busy} type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border border-border-strong bg-accent-soft p-3 text-feedback-success focus-visible:outline-2 focus-visible:outline-focus" onClick={() => settle(true)}>
                    <strong>{t('fourStage.known')}</strong><small>{t('fourStage.finishTarget')}</small>
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className="flex min-h-full flex-1 flex-col items-center text-center" key={`${session.sessionOrdinal}:feedback`}>
            <small>{session.result ? t('fourStage.stagePassed') : t('fourStage.stageReset')}</small>
            <h1 className="mt-8 font-language text-learning-expression font-semibold">{target.expression}</h1>
            <span className="mt-2 text-metadata text-fg-tertiary">{target.partOfSpeech}</span>
            <p className="mt-5 text-body text-fg-secondary">{target.meaning}</p>
            <blockquote className="mt-5 w-full rounded-card bg-surface-subtle p-6 text-left font-language text-lg leading-8">{target.example}</blockquote>
            <p className="mt-5 text-body-support text-fg-secondary">{session.result
              ? t('fourStage.feedbackPassed')
              : t('fourStage.feedbackReset')}</p>
            <button className="mt-auto min-h-12 w-full rounded-control bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={continueAfterFeedback}>{t('fourStage.continueLearning')}</button>
          </section>
        )}

        {!session && projection.targetCount > 0 && (
          <section className="flex min-h-full flex-1 flex-col items-center justify-center text-center" aria-live="polite">
            <span className="mb-5 grid size-15 place-items-center rounded-card bg-accent-soft text-2xl font-bold text-feedback-success" aria-hidden="true">✓</span>
            <small>{t('fourStage.learningComplete')}</small>
            <h1 className="mt-3 text-page-title font-semibold">{t('fourStage.completeCount',{count:projection.targetCount})}</h1>
            <p className="mt-3 text-body-support text-fg-secondary">{t('fourStage.scheduled')}</p>
            <button className="mt-8 min-h-12 w-full rounded-control bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" disabled={execution.busy} type="button" onClick={onFinish}>{t('fourStage.finish')}</button>
          </section>
        )}
      </main>
    </section>
  );
}
