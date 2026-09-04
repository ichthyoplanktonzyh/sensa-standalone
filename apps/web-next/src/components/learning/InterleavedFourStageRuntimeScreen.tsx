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

interface InterleavedFourStageRuntimeScreenProps {
  readonly active: boolean;
  readonly targetIds: readonly PrototypeLearningTargetId[];
  readonly onExit: () => void;
  readonly onComplete: (items: readonly FourStageCompletionItem[]) => void;
  readonly onFinish: () => void;
}

const presentationLabel = {
  meaning_choice: '第一阶段 · 看词选义',
  context_recall: '第二阶段 · 语境回想',
  sound_choice: '第三阶段 · 听音选义',
  final_recall: '第四阶段 · 终关回想',
} as const;

export function InterleavedFourStageRuntimeScreen({
  active,
  targetIds,
  onExit,
  onComplete,
  onFinish,
}: InterleavedFourStageRuntimeScreenProps) {
  const queueRef = useRef<InterleavedFourStageQueue<PrototypeLearningTargetId> | null>(null);
  const completionReportedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [session, setSession] = useState<FourStageSession<PrototypeLearningTargetId> | null>(null);
  const [projection, setProjection] = useState<FourStageQueueProjection<PrototypeLearningTargetId> | null>(null);
  const runKey = targetIds.join('|');

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
    const queue = new InterleavedFourStageQueue(targetIds, { minGap: 2 });
    queueRef.current = queue;
    completionReportedRef.current = false;
    sync(queue);
  }, [runKey, sync]);

  const target = session ? PROTOTYPE_LEARNING_TARGETS[session.targetId] : null;
  const runtimePackage = useMemo(
    () => target ? runtimePackageForTarget(target) : null,
    [target],
  );
  const recognitionOptions = runtimePackage?.content.recognitionAssessment.options ?? [];
  const completedCredits = session && projection
    ? Object.values(
      projection.targets.find((candidate) => candidate.targetId === session.targetId)
        ?.progress.checkpointCredits ?? {},
    ).filter((credit) => credit.status === 'credited').length
    : 0;

  const settle = (satisfied: boolean) => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.settle(satisfied);
    sync(queue);
  };

  const continueAfterFeedback = () => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeFeedback();
    sync(queue);
  };

  const playPronunciation = () => {
    const audioUrl = runtimePackage?.content.pronunciations.find(
      (pronunciation) => pronunciation.audioUrl,
    )?.audioUrl;
    if (!audioUrl || typeof Audio === 'undefined') return;
    void new Audio(audioUrl).play().catch(() => undefined);
  };

  if (!projection) return null;

  return (
    <section
      className={`screen lightweight-runtime four-stage-runtime${active ? ' active' : ''}`}
      id="s-four-stage-runtime"
      data-anim="fade"
    >
      <header className="lightweight-runtime-nav">
        <button type="button" onClick={onExit} aria-label="暂时退出学习">×</button>
        <span>{session ? presentationLabel[session.presentation] : '四阶段完成'}</span>
        <em>{projection.graduatedTargetIds.length} / {projection.targetCount} 个目标</em>
      </header>

      <main className="lightweight-runtime-body">
        {session && target && session.phase === 'assessment' && (
          <section className="lightweight-runtime-stage lightweight-answer" key={`${session.sessionOrdinal}:assessment`}>
            <small>{presentationLabel[session.presentation]} · 当前连续通过 {completedCredits}/4</small>

            {session.presentation === 'meaning_choice' && (
              <>
                <h1>{target.expression}</h1>
                <p>选择这个表达在当前 Learning Target 中的意思。</p>
                <div className="lightweight-rating" role="group" aria-label="词义选项">
                  {recognitionOptions.map((option) => (
                    <button type="button" key={option.id} onClick={() => settle(option.isCorrect)}>
                      <strong>{option.textL1}</strong><small>选择</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'context_recall' && (
              <>
                <blockquote>{target.example}</blockquote>
                <h1>你在这个语境里认出了当前意思吗？</h1>
                <div className="lightweight-rating" role="group" aria-label="语境回想结果">
                  <button type="button" className="is-again" onClick={() => settle(false)}>
                    <strong>没有认出</strong><small>四阶段清零</small>
                  </button>
                  <button type="button" className="is-good" onClick={() => settle(true)}>
                    <strong>认出来了</strong><small>进入下一阶段</small>
                  </button>
                </div>
              </>
            )}

            {session.presentation === 'sound_choice' && (
              <>
                <button type="button" onClick={playPronunciation}>▶ 播放目标发音</button>
                <h1>只根据声音选择意思</h1>
                <div className="lightweight-rating" role="group" aria-label="听音词义选项">
                  {recognitionOptions.map((option) => (
                    <button type="button" key={option.id} onClick={() => settle(option.isCorrect)}>
                      <strong>{option.textL1}</strong><small>选择</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {session.presentation === 'final_recall' && (
              <>
                <small>无额外提示</small>
                <h1>{target.expression}</h1>
                <p>现在你认识这个表达对应的目标意思吗？</p>
                <div className="lightweight-rating" role="group" aria-label="终关回想结果">
                  <button type="button" className="is-again" onClick={() => settle(false)}>
                    <strong>不认识</strong><small>四阶段清零</small>
                  </button>
                  <button type="button" className="is-good" onClick={() => settle(true)}>
                    <strong>认识</strong><small>完成这个目标</small>
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {session && target && session.phase === 'feedback' && (
          <section className="lightweight-runtime-stage lightweight-answer" key={`${session.sessionOrdinal}:feedback`}>
            <small>{session.result ? '本阶段通过' : '本词四阶段已清零'}</small>
            <h1>{target.expression}</h1>
            <span>{target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>
            <p>{session.result
              ? '详情只负责反馈；本次 Checkpoint credit 已由刚才的评价产生。'
              : '详情用于重新建立连接，不会替你通过；稍后从第一阶段重新评价。'}</p>
            <button type="button" onClick={continueAfterFeedback}>继续穿插学习</button>
          </section>
        )}

        {!session && projection.targetCount > 0 && (
          <section className="lightweight-runtime-stage lightweight-complete" aria-live="polite">
            <span className="lightweight-complete-mark" aria-hidden="true">✓</span>
            <small>四阶段学习完成</small>
            <h1>{projection.targetCount} 个目标已连续通过四阶段</h1>
            <p>每个目标已经独立交接给长期记忆调度。</p>
            <button type="button" onClick={onFinish}>完成并回到首页</button>
          </section>
        )}
      </main>
    </section>
  );
}
