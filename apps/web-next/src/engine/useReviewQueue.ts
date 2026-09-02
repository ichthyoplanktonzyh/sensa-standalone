import { useCallback, useRef, useState } from 'react';
import {
  ReviewQueue,
  type ReviewQueueDependencies,
  type ReviewSession,
  type ReviewStats,
  type RetentionRuntimeProjection,
} from './ReviewQueue';
import type { ReviewAssessmentResult } from '../review/types';
import type { QueueConfig, ReviewCandidate } from './types';

const EMPTY_RETENTION_PROJECTION: RetentionRuntimeProjection = {
  currentAction: null,
  targets: [],
};

/**
 * React adapter for the pure ReviewQueue. The queue owns ordering and
 * settlement guards; persistence (Memory Outcome/FSRS/Relearning projection)
 * is supplied through one effect seam and is therefore never created by the
 * queue itself.
 */
export function useReviewQueue<TContent = unknown>(
  onEffect?: ReviewQueueDependencies<TContent>['onEffect'],
  config?: QueueConfig,
) {
  const queueRef = useRef<ReviewQueue<TContent> | null>(null);
  const effectHandlerRef = useRef(onEffect);
  effectHandlerRef.current = onEffect;
  const [session, setSession] = useState<ReviewSession<TContent> | null>(null);
  const [stats, setStats] = useState<ReviewStats>(() => ({
    totalWords: 0,
    totalSenses: 0,
    completedWords: 0,
    totalAttempts: 0,
    correctAttempts: 0,
    accuracy: 100,
    startTime: Date.now(),
  }));
  const [isDone, setIsDone] = useState(true);
  const [projection, setProjection] = useState<RetentionRuntimeProjection>(
    EMPTY_RETENTION_PROJECTION,
  );

  const sync = useCallback((queue: ReviewQueue<TContent>) => {
    const current = queue.getCurrentSession();
    setSession(current ? { ...current, action: { ...current.action } } : null);
    setStats(queue.getStats());
    setIsDone(queue.isDone());
    setProjection(queue.getProjection());
  }, []);

  const start = useCallback((candidates: readonly ReviewCandidate<TContent>[]) => {
    const dependencies: ReviewQueueDependencies<TContent> = {
      onEffect: (effect) => effectHandlerRef.current?.(effect),
    };
    const queue = new ReviewQueue(candidates, dependencies, config);
    queueRef.current = queue;
    sync(queue);
    return queue.getCurrentSession();
  }, [config, sync]);

  const completeRepair = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return null;
    const completed = queue.completeRepair();
    if (completed) {
      // Repair has no feedback/result screen; immediately continue through the
      // same queue seam so the scheduler can apply interference spacing before
      // the independent relearning gate.
      queue.next();
      sync(queue);
    }
    return completed;
  }, [sync]);

  const settle = useCallback((result: ReviewAssessmentResult) => {
    const queue = queueRef.current;
    if (!queue) return null;
    const settled = queue.settle(result);
    sync(queue);
    return settled;
  }, [sync]);

  const next = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return null;
    const nextSession = queue.next();
    sync(queue);
    return nextSession;
  }, [sync]);

  const undo = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return null;
    const previous = queue.undo();
    sync(queue);
    return previous;
  }, [sync]);

  const excludeCurrentForDeclaredMastery = useCallback(() => {
    const queue = queueRef.current;
    if (!queue) return null;
    const interrupted = queue.excludeCurrentForDeclaredMastery();
    queue.next();
    sync(queue);
    return interrupted;
  }, [sync]);

  return {
    session,
    stats,
    isDone,
    projection,
    start,
    settle,
    completeRepair,
    excludeCurrentForDeclaredMastery,
    next,
    undo,
  };
}
