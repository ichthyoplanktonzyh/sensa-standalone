import type { LocalLearningTarget } from '../../data/library/learning';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {localTargetInRoute} from '../../learning/runtime/localCurriculum';

/**
 * What the learner is asked to learn right now.
 *
 * Queue membership and the daily-new budget both belong to one Language Route.
 * Learning progress remains attached to the shared Learning Target, while the
 * route decides whether that Target belongs in this curriculum today.
 */

export interface LearningQueueInput {
  readonly targets: readonly LocalLearningTarget[];
  readonly languageRouteId: string;
  readonly readiness: Readonly<Record<string, 'ready' | 'blocked'>>;
  readonly clock: number;
  readonly dailyLimit: number | undefined;
}

export interface LearningQueue {
  /** The targets of the language being learned now. */
  readonly activeTargets: readonly LocalLearningTarget[];
  /** The review queue, in the language being learned. */
  readonly due: readonly LocalLearningTarget[];
  /** Today's new items within this Route's Study Plan allowance. */
  readonly initialReady: readonly LocalLearningTarget[];
  /** Counted only when this Route introduced the Target. */
  readonly startedToday: number;
  readonly remaining: number;
}

const needsReviewAt = (target: LocalLearningTarget, clock: number): number | null => {
  if (target.relearnAt) {
    const relearnAt = Date.parse(target.relearnAt);
    return Number.isFinite(relearnAt) ? relearnAt : null;
  }
  return target.memory ? target.memory.dueAt.getTime() : null;
};

export function resolveLearningQueue({
  targets,
  languageRouteId,
  readiness,
  clock,
  dailyLimit,
}: LearningQueueInput): LearningQueue {
  const activeTargets = targets.filter((target) => localTargetInRoute(target,languageRouteId));
  const due = activeTargets
    .filter((target) => !hasDeclaredMasteryOverride(target) && readiness[target.id] === 'ready')
    .filter((target) => {
      const dueAt = needsReviewAt(target, clock);
      return dueAt !== null && dueAt <= clock;
    });
  const startedToday = targets.filter((target) =>
    target.introducedLanguageRouteId===languageRouteId
    && target.startedAt
    && new Date(target.startedAt).toDateString() === new Date(clock).toDateString()).length;
  const remaining = Math.max(0, (dailyLimit ?? 20) - startedToday);
  const initialReady = [
    ...activeTargets.filter((target) => !hasDeclaredMasteryOverride(target) && !target.completedAt && target.startedAt && readiness[target.id] === 'ready'),
    ...activeTargets.filter((target) => !hasDeclaredMasteryOverride(target) && !target.completedAt && !target.startedAt && readiness[target.id] === 'ready').slice(0, remaining),
  ];
  return { activeTargets, due, initialReady, startedToday, remaining };
}

/**
 * The queue changes only when a due/relearning instant arrives or today's
 * introduction budget rolls into a new local day. Callers can sleep until that
 * boundary instead of waking the whole application on a fixed interval.
 */
export function nextLearningQueueChangeAt(input: LearningQueueInput): number | null {
  const queue = resolveLearningQueue(input);
  const futureDue = queue.activeTargets
    .filter((target) => !hasDeclaredMasteryOverride(target) && input.readiness[target.id] === 'ready')
    .map((target) => needsReviewAt(target, input.clock))
    .filter((value): value is number => value !== null && value > input.clock);
  const nextDay = queue.startedToday > 0
    ? new Date(new Date(input.clock).setHours(24, 0, 0, 0)).getTime()
    : null;
  const candidates = nextDay === null ? futureDue : [...futureDue, nextDay];
  return candidates.length ? Math.min(...candidates) : null;
}
