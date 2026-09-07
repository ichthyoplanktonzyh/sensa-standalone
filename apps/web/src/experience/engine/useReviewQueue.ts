import { runtimeCheckpoint } from "../learningRuntime/runtimeCheckpoint";
import { useCallback, useRef, useState } from "react";
import {
  ReviewQueue,
  type ReviewQueueDependencies,
  type ReviewSession,
  type ReviewStats,
  type RetentionRuntimeProjection,
} from "./ReviewQueue";
import type { ReviewAssessmentResult } from "../review/types";
import type { QueueConfig, ReviewCandidate } from "./types";
import {
  retentionOrchestration,
  type RetentionCandidate,
  type RetentionRepairBasis,
  type StepOrchestration,
} from "./stepOrchestration";

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
  onEffect?: ReviewQueueDependencies<TContent>["onEffect"],
  config?: QueueConfig,
  orchestration: StepOrchestration<
    RetentionCandidate,
    RetentionRepairBasis
  > = retentionOrchestration,
) {
  const effectHandlerRef = useRef(onEffect);
  effectHandlerRef.current = onEffect;
  const restore = (raw: string) =>
    ReviewQueue.restoreCheckpoint<TContent>(
      raw,
      {
        onEffect: (effect) => effectHandlerRef.current?.(effect),
      },
      orchestration,
    );
  const queueRef = useRef<ReviewQueue<TContent> | null | undefined>(undefined);
  if (queueRef.current === undefined)
    queueRef.current = runtimeCheckpoint.read().reviewQueue
      ? restore(runtimeCheckpoint.read().reviewQueue!)
      : null;

  const [session, setSession] = useState<ReviewSession<TContent> | null>(
    () => queueRef.current?.getCurrentSession() ?? null,
  );
  const [stats, setStats] = useState<ReviewStats>(
    () =>
      queueRef.current?.getStats() ?? {
        totalTargets: 0,
        completedTargets: 0,
        totalAttempts: 0,
        correctAttempts: 0,
        accuracy: 100,
        startTime: Date.now(),
      },
  );
  const [isDone, setIsDone] = useState(
    () => queueRef.current?.isDone() ?? true,
  );
  const [projection, setProjection] = useState<RetentionRuntimeProjection>(
    () => queueRef.current?.getProjection() ?? EMPTY_RETENTION_PROJECTION,
  );

  const sync = useCallback((queue: ReviewQueue<TContent>) => {
    runtimeCheckpoint.update({ reviewQueue: queue.exportCheckpoint() });
    runtimeCheckpoint.afterCommit(() => {
      const current = queue.getCurrentSession();
      setSession(
        current ? { ...current, action: { ...current.action } } : null,
      );
      setStats(queue.getStats());
      setIsDone(queue.isDone());
      setProjection(queue.getProjection());
    });
  }, []);

  const transact = <T>(work: () => T): T => {
    const before = queueRef.current?.exportCheckpoint();
    try {
      return runtimeCheckpoint.atomic(() => {
        runtimeCheckpoint.afterRollback(() => {
          queueRef.current = before ? restore(before) : null;
        });
        return work();
      });
    } catch (error) {
      queueRef.current = before ? restore(before) : null;
      throw error;
    }
  };

  const start = useCallback(
    (candidates: readonly ReviewCandidate<TContent>[]) => {
      return transact(() => {
        const dependencies: ReviewQueueDependencies<TContent> = {
          onEffect: (effect) => effectHandlerRef.current?.(effect),
        };
        const queue = new ReviewQueue(
          candidates,
          dependencies,
          config,
          orchestration,
        );
        queueRef.current = queue;
        sync(queue);
        return queue.getCurrentSession();
      });
    },
    [config, orchestration, sync],
  );

  const completeRepair = useCallback(() => {
    return transact(() => {
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
    });
  }, [sync]);

  const settle = useCallback(
    (result: ReviewAssessmentResult) => {
      return transact(() => {
        const queue = queueRef.current;
        if (!queue) return null;
        const settled = queue.settle(result);
        sync(queue);
        return settled;
      });
    },
    [sync],
  );

  const next = useCallback(() => {
    return transact(() => {
      const queue = queueRef.current;
      if (!queue) return null;
      const nextSession = queue.next();
      sync(queue);
      return nextSession;
    });
  }, [sync]);

  const undo = useCallback(() => {
    return transact(() => {
      const queue = queueRef.current;
      if (!queue) return null;
      const previous = queue.undo();
      sync(queue);
      return previous;
    });
  }, [sync]);

  const excludeCurrentForDeclaredMastery = useCallback(() => {
    return transact(() => {
      const queue = queueRef.current;
      if (!queue) return null;
      const interrupted = queue.excludeCurrentForDeclaredMastery();
      queue.next();
      sync(queue);
      return interrupted;
    });
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
