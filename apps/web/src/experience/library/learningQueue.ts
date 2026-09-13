import { defaultSensaLanguageProfile } from '@sensa/contracts/sensa';
import type { LocalLearningTarget } from '../../data/library/learning';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';

/**
 * What the learner is asked to learn right now.
 *
 * Today's queue and today's new items belong to the language being learned now.
 * The daily limit does not: it is one account-wide quantity, so switching
 * language cannot buy a second allowance of new items for the same day. Both
 * rules are decided here rather than in the hook that renders them, because the
 * second one is easy to break by scoping one line too many.
 */

export interface LearningQueueInput {
  readonly targets: readonly LocalLearningTarget[];
  readonly activeLanguageTag: string;
  readonly readiness: Readonly<Record<string, 'ready' | 'blocked'>>;
  readonly clock: number;
  readonly dailyLimit: number | undefined;
}

export interface LearningQueue {
  /** The targets of the language being learned now. */
  readonly activeTargets: readonly LocalLearningTarget[];
  /** The review queue, in the language being learned. */
  readonly due: readonly LocalLearningTarget[];
  /** Today's new items, in the language being learned and within what is left of
   * the account's daily allowance. */
  readonly initialReady: readonly LocalLearningTarget[];
  /** Counted across every language on purpose: the limit is the account's. */
  readonly startedToday: number;
  readonly remaining: number;
}

/** A target written before the language profile existed is read as the pair the
 * product has always shipped, never as no language. */
export const targetLanguageTag = (target: LocalLearningTarget): string =>
  target.targetLanguageTag ?? defaultSensaLanguageProfile.activeTargetLanguageTag;

const needsReviewAt = (target: LocalLearningTarget, clock: number): number | null => {
  if (target.relearnAt) {
    const relearnAt = Date.parse(target.relearnAt);
    return Number.isFinite(relearnAt) ? relearnAt : null;
  }
  return target.memory ? target.memory.dueAt.getTime() : null;
};

export function resolveLearningQueue({
  targets,
  activeLanguageTag,
  readiness,
  clock,
  dailyLimit,
}: LearningQueueInput): LearningQueue {
  const activeTargets = targets.filter((target) => targetLanguageTag(target) === activeLanguageTag);
  const due = activeTargets
    .filter((target) => !hasDeclaredMasteryOverride(target) && readiness[target.id] === 'ready')
    .filter((target) => {
      const dueAt = needsReviewAt(target, clock);
      return dueAt !== null && dueAt <= clock;
    });
  const startedToday = targets.filter((target) =>
    target.startedAt && new Date(target.startedAt).toDateString() === new Date(clock).toDateString()).length;
  const remaining = Math.max(0, (dailyLimit ?? 20) - startedToday);
  const initialReady = [
    ...activeTargets.filter((target) => !hasDeclaredMasteryOverride(target) && !target.completedAt && target.startedAt && readiness[target.id] === 'ready'),
    ...activeTargets.filter((target) => !hasDeclaredMasteryOverride(target) && !target.completedAt && !target.startedAt && readiness[target.id] === 'ready').slice(0, remaining),
  ];
  return { activeTargets, due, initialReady, startedToday, remaining };
}
