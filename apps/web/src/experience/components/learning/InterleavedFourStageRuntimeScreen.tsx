import type {PrototypeIntroductionPackage} from '../../content/learningCatalog';
import {useTranslation} from 'react-i18next';
import { uiClass } from '../../ui/classes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROTOTYPE_LEARNING_TARGETS,
  runtimePackageForTarget,
  type PrototypeLearningTargetId,
} from '../../learningJourney/prototypeLearning';
import {
  InterleavedFourStageQueue,
  type FourStageQueueProjection,
  type FourStageSession,
} from '../../learningRuntime/interleavedFourStageProtocol';

export interface FourStageCompletionItem {
  readonly targetId: PrototypeLearningTargetId;
  readonly mistakeCount: number;
}

export interface FourStageTargetPresentation {expression:string;meaning:string;example:string;partOfSpeech:string}
export interface FourStageInitialExecution {
  session:FourStageSession<string>|null;
  projection:FourStageQueueProjection<string>;
  target:FourStageTargetPresentation|null;
  content:PrototypeIntroductionPackage|null;
  busy:boolean;
  notice?:import('react').ReactNode;
  onChoice:(id:string)=>void;
  onSelfReport:(known:boolean)=>void;
  onContinue:()=>void;
}
interface InterleavedFourStageRuntimeScreenProps {
  readonly execution?:FourStageInitialExecution;
  readonly active: boolean;
  readonly targetIds: readonly PrototypeLearningTargetId[];
  readonly onExit: () => void;
  readonly onComplete: (items: readonly FourStageCompletionItem[]) => void;
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
  targetIds,
  onExit,
  onComplete,
  onFinish,
}: InterleavedFourStageRuntimeScreenProps) {
  const {t}=useTranslation();
  const queueRef = useRef<InterleavedFourStageQueue<PrototypeLearningTargetId> | null>(null);
  const completionReportedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [previewSession, setSession] = useState<FourStageSession<PrototypeLearningTargetId> | null>(null);
  const [previewProjection, setProjection] = useState<FourStageQueueProjection<PrototypeLearningTargetId> | null>(null);
  const runKey = targetIds.join('|');
  const session=execution?execution.session:previewSession;
  const projection=execution?execution.projection:previewProjection;

  const sync = useCallback((queue: InterleavedFourStageQueue<PrototypeLearningTargetId>) => {
    const nextProjection = queue.getProjection();
    setSession(nextProjection.currentSession);
    setProjection(nextProjection);
    if (queue.isDone() && !completionReportedRef.current) {
      completionReportedRef.current = true;
      onCompleteRef.current(nextProjection.targets.map((target) => ({
        targetId: target.targetId,
        mistakeCount: target.mistakes,
      })));
    }
  }, []);

  useEffect(() => {
    if(execution)return;
    const queue = new InterleavedFourStageQueue(targetIds, { minGap: 2 });
    queueRef.current = queue;
    completionReportedRef.current = false;
    sync(queue);
  }, [runKey, sync]);

  const previewTarget=previewSession?PROTOTYPE_LEARNING_TARGETS[previewSession.targetId]:null;
  const target = execution?execution.target:previewTarget;
  const runtimePackage = useMemo(
    () => previewTarget ? runtimePackageForTarget(previewTarget) : null,
    [previewTarget],
  );
  const runtimeContent=execution?execution.content:runtimePackage?.content;
  const recognitionOptions = runtimeContent?.recognitionAssessment.options ?? [];
  const completedCredits = session && projection
    ? Object.values(
      projection.targets.find((candidate) => candidate.targetId === session.targetId)
        ?.progress.checkpointCredits ?? {},
    ).filter((credit) => credit.status === 'credited').length
    : 0;

  const settle = (satisfied: boolean) => {
    if(execution){execution.onSelfReport(satisfied);return;}
    const queue = queueRef.current;
    if (!queue) return;
    queue.settle(satisfied);
    sync(queue);
  };

  const continueAfterFeedback = () => {
    if(execution){execution.onContinue();return;}
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeFeedback();
    sync(queue);
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
        <button disabled={execution?.busy} type="button" onClick={onExit} aria-label={t('fourStage.exitLearning')}>×</button>
        <span>{session ? t('fourStage.'+presentationLabel[session.presentation]) : t('fourStage.completed')}</span>
        <em>{projection.graduatedTargetIds.length} / {t('fourStage.targetCount',{count:projection.targetCount})}</em>
      </header>

      <main className={uiClass("lightweight-runtime-body")}>
        {execution?.notice}
        {session && target && session.phase === 'assessment' && (
          <section className={uiClass("lightweight-runtime-stage lightweight-answer")} key={`${session.sessionOrdinal}:assessment`}>
            <small>{t('fourStage.'+presentationLabel[session.presentation])} · {t('fourStage.credits',{count:completedCredits})}</small>

            {session.presentation === 'meaning_choice' && (
              <>
                <h1>{target.expression}</h1>
                <p>{t('fourStage.chooseMeaning')}</p>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.meaningOptions')}>
                  {recognitionOptions.map((option) => (
                    <button disabled={execution?.busy} type="button" key={option.id} onClick={() => execution?execution.onChoice(option.id):settle(option.isCorrect)}>
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
                  <button disabled={execution?.busy} type="button" className={uiClass("is-again")} onClick={() => settle(false)}>
                    <strong>{t('fourStage.notRecognized')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution?.busy} type="button" className={uiClass("is-good")} onClick={() => settle(true)}>
                    <strong>{t('fourStage.recognized')}</strong><small>{t('fourStage.nextStage')}</small>
                  </button>
                </div>
              </>
            )}

            {session.presentation === 'sound_choice' && (
              <>
                <button disabled={execution?.busy} type="button" onClick={playPronunciation}>{t('fourStage.play')}</button>
                <h1>{t('fourStage.listenMeaning')}</h1>
                <div className={uiClass("lightweight-rating")} role="group" aria-label={t('fourStage.soundOptions')}>
                  {recognitionOptions.map((option) => (
                    <button disabled={execution?.busy} type="button" key={option.id} onClick={() => execution?execution.onChoice(option.id):settle(option.isCorrect)}>
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
                  <button disabled={execution?.busy} type="button" className={uiClass("is-again")} onClick={() => settle(false)}>
                    <strong>{t('fourStage.unknown')}</strong><small>{t('fourStage.reset')}</small>
                  </button>
                  <button disabled={execution?.busy} type="button" className={uiClass("is-good")} onClick={() => settle(true)}>
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
            <button disabled={execution?.busy} type="button" onClick={continueAfterFeedback}>{t('fourStage.continueLearning')}</button>
          </section>
        )}

        {!session && projection.targetCount > 0 && (
          <section className={uiClass("lightweight-runtime-stage lightweight-complete")} aria-live="polite">
            <span className={uiClass("lightweight-complete-mark")} aria-hidden="true">✓</span>
            <small>{t('fourStage.learningComplete')}</small>
            <h1>{t('fourStage.completeCount',{count:projection.targetCount})}</h1>
            <p>{t('fourStage.scheduled')}</p>
            <button disabled={execution?.busy} type="button" onClick={onFinish}>{t('fourStage.finish')}</button>
          </section>
        )}
      </main>
    </section>
  );
}
