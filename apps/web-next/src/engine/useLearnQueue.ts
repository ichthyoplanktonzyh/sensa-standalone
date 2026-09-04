import { useCallback, useRef, useState } from 'react';
import { LearnQueue } from './LearnQueue';
import {
  acquisitionOrchestration,
  type AcquisitionCandidate,
  type AcquisitionRepairBasis,
  type StepOrchestration,
} from './stepOrchestration';
import type {
  LearningCapability,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  QueueConfig,
  QueueStats,
  SchedulablePackage,
  Session,
  StructuredAcquisitionProjection,
} from './types';
import { retentionTargetIdOf } from './types';

const EMPTY_PROJECTION: StructuredAcquisitionProjection = {
  currentAction: null,
  targets: [],
};

export function useLearnQueue<TContent>(
  initialPackages: readonly SchedulablePackage<TContent>[],
  config?: QueueConfig,
  orchestration: StepOrchestration<AcquisitionCandidate, AcquisitionRepairBasis>
    = acquisitionOrchestration,
) {
  const queueRef = useRef<LearnQueue<TContent> | null>(null);
  const [session, setSession] = useState<Session<TContent> | null>(null);
  const [stats, setStats] = useState<QueueStats>(() => ({
    sessionsCompleted: 0,
    totalAttempts: 0,
    correctAttempts: 0,
    accuracy: 100,
    masteredTargetCount: 0,
    totalTargets: initialPackages.length,
    startTime: Date.now(),
  }));
  const [isDone, setIsDone] = useState(false);
  const [projection, setProjection] = useState<StructuredAcquisitionProjection>(EMPTY_PROJECTION);

  const sync = useCallback((queue: LearnQueue<TContent>) => {
    const current = queue.getCurrentSession();
    setSession(current ? { ...current, action: { ...current.action } } : null);
    setStats(queue.getStats());
    setIsDone(queue.isDone());
    setProjection(queue.getProjection());
  }, []);

  const start = useCallback((packagesToLearn: readonly SchedulablePackage<TContent>[] = initialPackages) => {
    const queue = new LearnQueue(packagesToLearn, config, orchestration);
    queueRef.current = queue;
    sync(queue);
    return queue.getCurrentSession();
  }, [config, initialPackages, orchestration, sync]);

  const settle = useCallback((ok: boolean) => {
    const queue = queueRef.current;
    if (!queue) return;
    const settledSession = queue.settle(ok);
    if (settledSession) sync(queue);
  }, [sync]);

  const advance = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.next();
    sync(queue);
  }, [sync]);

  const completeIntroduction = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeIntroduction();
    advance();
  }, [advance]);

  const completeRecognition = useCallback((correct: boolean) => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeRecognition(correct);
    advance();
  }, [advance]);

  const completeMeaningToFormRecall = useCallback((outcome: MeaningToFormRecallOutcome) => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeMeaningToFormRecall(outcome);
    advance();
  }, [advance]);

  const completeBoundary = useCallback((correct: boolean) => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeBoundary(correct);
    advance();
  }, [advance]);

  const completeNovelTransfer = useCallback((outcome: NovelTransferOutcome) => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.completeNovelTransfer(outcome);
    advance();
  }, [advance]);

  const next = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return;
    if (queue.isDone()) {
      sync(queue);
      return;
    }
    advance();
  }, [advance, sync]);

  const undo = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return null;
    const previousSession = queue.undo();
    sync(queue);
    return previousSession;
  }, [sync]);

  const markMistake = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.markMistake();
    sync(queue);
  }, [sync]);

  const markKnown = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return;
    queue.skipCurrent();
    queue.next();
    sync(queue);
  }, [sync]);

  const setDeclaredMastery = useCallback((retentionTargetId: string, isMastered: boolean) => {
    const queue = queueRef.current;
    if (!queue) return false;
    const updated = queue.setDeclaredMastery(retentionTargetId, isMastered);
    if (updated && (!queue.getCurrentSession() || queue.getCurrentSession()?.settled)) queue.next();
    sync(queue);
    return updated;
  }, [sync]);

  const getGraduatedRetentionTargetIds = useCallback(() => {
    return queueRef.current?.getGraduatedRetentionTargetIds() ?? [];
  }, []);

  /** Demo-only presentation override; it still carries a Package, never an ad-hoc content object. */
  const overrideDemo = useCallback((
    demoPackage: SchedulablePackage<TContent>,
    capability: LearningCapability | null,
    demoStep: number,
    total: number,
    transferScenarioIndex = 0,
  ) => {
    const definition = demoPackage.actions.find((action) => action.capability === capability)
      ?? demoPackage.reviewActions.find((action) => action.capability === capability)
      ?? demoPackage.actions[0];
    if (!definition) return;
    const demoSession: Session<TContent> = {
      index: demoStep,
      totalTarget: total,
      package: demoPackage,
      action: {
        ...definition,
        intent: definition.intent ?? 'assessment',
        // 演示绕过队列，但绕不过「谁决定用哪张卡」：它照结构化首学那套编排问。
        stepKind: acquisitionOrchestration.stepKindFor(definition),
        kind: definition.kind,
        ordinal: demoStep,
        totalTarget: total,
        packageId: demoPackage.packageId,
        senseId: demoPackage.senseId,
        retentionTargetId: retentionTargetIdOf(demoPackage),
        content: demoPackage.content,
        reason: definition.kind === 'introduction' ? 'new' : 'acquisition_ready',
      },
      settled: false,
      result: null,
      transferScenarioIndex,
    };
    if (capability === 'novel_context_transfer') demoSession.action = { ...demoSession.action, reason: 'acquisition_ready' };
    setSession(demoSession);
    setIsDone(false);
    setProjection(EMPTY_PROJECTION);
  }, []);

  return {
    session,
    stats,
    isDone,
    projection,
    start,
    settle,
    completeIntroduction,
    completeRecognition,
    completeMeaningToFormRecall,
    completeBoundary,
    completeNovelTransfer,
    next,
    undo,
    markMistake,
    markKnown,
    setDeclaredMastery,
    getGraduatedRetentionTargetIds,
    overrideDemo,
  };
}
