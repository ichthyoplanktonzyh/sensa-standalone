import type {RuntimeLearningContent} from '../../../learning/content/learningCatalog';
import {useTranslation} from 'react-i18next';
import { uiClass } from '../../ui/classes';
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
      className={uiClass(`screen lightweight-runtime four-stage-runtime${active ? ' active' : ''}`, "#s-four-stage-runtime")}
      id="s-four-stage-runtime"
      data-anim="fade"
    >
      <header className={uiClass("lightweight-runtime-nav")}>
        <button disabled={execution.busy} type="button" onClick={onExit} aria-label={t('fourStage.exitLearning')}>×</button>
        <span>{session ? t('fourStage.'+presentationLabel[session.presentation]) : t('fourStage.completed')}</span>
        <em>{projection.graduatedTargetIds.length} / {t('fourStage.targetCount',{count:projection.targetCount})}</em>
      </header>

      <main className={uiClass("lightweight-runtime-body")}>
        {execution.notice}
        {session && target && session.phase === 'assessment' && (
          <section className={uiClass("lightweight-runtime-stage lightweight-answer")} key={`${session.sessionOrdinal}:assessment`}>
            <small>{t('fourStage.'+presentationLabel[session.presentation])} · {t('fourStage.credits',{count:completedCredits})}</small>

            {session.presentation === 'meaning_choice' && (
              <>
                <h1>{target.expression}</h1>
                <p>{t('fourStage.chooseMeaning')}</p>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.meaningOptions')}>
                  {recognitionOptions.map((option) => (
                    <button disabled={execution.busy} type="button" key={option.id} onClick={() => execution.onChoice(option.id)}>
                      <strong>{option.textL1}</strong><small>{t('fourStage.choose')}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'context_recall' && (
              <>
                <blockquote>{target.example}</blockquote>
                <h1>{t('fourStage.recognizeContext')}</h1>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.contextResult')}>
                  <button disabled={execution.busy} type="button" className={uiClass("is-again")} onClick={() => settle(false)}>
                    <strong>{t('fourStage.notRecognized')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution.busy} type="button" className={uiClass("is-good")} onClick={() => settle(true)}>
                    <strong>{t('fourStage.recognized')}</strong><small>{t('fourStage.nextStage')}</small>
                  </button>
                </div>
              </>
            )}

            {session.presentation === 'sound_choice' && (
              <>
                <button disabled={execution.busy} type="button" onClick={playPronunciation}>{t('fourStage.play')}</button>
                <h1>{t('fourStage.listenMeaning')}</h1>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.soundOptions')}>
                  {recognitionOptions.map((option) => (
                    <button disabled={execution.busy} type="button" key={option.id} onClick={() => execution.onChoice(option.id)}>
                      <strong>{option.textL1}</strong><small>{t('fourStage.choose')}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'final_recall' && (
              <>
                <small>{t('fourStage.noHint')}</small>
                <h1>{target.expression}</h1>
                <p>{t('fourStage.recognizeFinal')}</p>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.finalResult')}>
                  <button disabled={execution.busy} type="button" className={uiClass("is-again")} onClick={() => settle(false)}>
                    <strong>{t('fourStage.unknown')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution.busy} type="button" className={uiClass("is-good")} onClick={() => settle(true)}>
                    <strong>{t('fourStage.known')}</strong><small>{t('fourStage.finishTarget')}</small>
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className={uiClass("lightweight-runtime-stage lightweight-answer")} key={`${session.sessionOrdinal}:feedback`}>
            <small>{session.result ? t('fourStage.stagePassed') : t('fourStage.stageReset')}</small>
            <h1>{target.expression}</h1>
            <span>{target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>
            <p>{session.result
              ? t('fourStage.feedbackPassed')
              : t('fourStage.feedbackReset')}</p>
            <button disabled={execution.busy} type="button" onClick={continueAfterFeedback}>{t('fourStage.continueLearning')}</button>
          </section>
        )}

        {!session && projection.targetCount > 0 && (
          <section className={uiClass("lightweight-runtime-stage lightweight-complete")} aria-live="polite">
            <span className={uiClass("lightweight-complete-mark")} aria-hidden="true">✓</span>
            <small>{t('fourStage.learningComplete')}</small>
            <h1>{t('fourStage.completeCount',{count:projection.targetCount})}</h1>
            <p>{t('fourStage.scheduled')}</p>
            <button disabled={execution.busy} type="button" onClick={onFinish}>{t('fourStage.finish')}</button>
          </section>
        )}
      </main>
    </section>
  );
}
