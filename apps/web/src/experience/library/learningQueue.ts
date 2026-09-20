import type { LocalLearningTarget } from '../../data/library/learning';
import type {LocalCurriculumMembership} from '../../learning/runtime/localProtocol';
import type {TargetPlanningOverride} from '../../learning/runtime/targetPlanningOverrides';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {localTargetInRoute} from '../../learning/runtime/localCurriculum';

/**
 * What the learner is asked to learn right now.
 *
 * Queue membership and the daily-new budget both belong to one Language Route.
 * Learning progress remains attached to the shared Learning Target, while the
 * route decides whether that Target belongs in this curriculum today.
 */

export interface LearningQueueTarget {
  readonly id:string;
  readonly curriculumMemberships:readonly Pick<LocalCurriculumMembership,'status'|'languageContext'>[];
  readonly planningOverrides:readonly Pick<TargetPlanningOverride,'kind'>[];
  readonly introducedLanguageRouteId:string|null;
  readonly startedAt:string|null;
  readonly completedAt:string|null;
  readonly memory:{readonly dueAt:Date}|null;
  readonly relearnAt:string|null;
}

export interface LearningQueueInput<Target extends LearningQueueTarget=LocalLearningTarget> {
  readonly targets: readonly Target[];
  readonly languageRouteId: string;
  readonly readiness: Readonly<Record<string, 'ready' | 'blocked'>>;
  readonly clock: number;
  readonly dailyLimit: number | undefined;
}

export interface LearningQueue<Target extends LearningQueueTarget=LocalLearningTarget> {
  /** The targets of the language being learned now. */
  readonly activeTargets: readonly Target[];
  /** The review queue, in the language being learned. */
  readonly due: readonly Target[];
  /** Today's new items within this Route's Study Plan allowance. */
  readonly initialReady: readonly Target[];
  /** Counted only when this Route introduced the Target. */
  readonly startedToday: number;
  readonly remaining: number;
}

export interface InterleavedLearningRetry {
  readonly id: string;
  /** Number of other completed targets before this retry is ready to re-enter. */
  readonly remaining: number;
}

export function advanceInterleavedLearningRetries(
  retries: readonly InterleavedLearningRetry[],
  completedTargetId: string,
  retry: boolean,
  spacing = 2,
): InterleavedLearningRetry[] {
  const advanced = retries
    .filter((candidate) => candidate.id !== completedTargetId)
    .map((candidate) => ({...candidate,remaining:Math.max(0,candidate.remaining - 1)}));
  return retry ? [...advanced,{id:completedTargetId,remaining:Math.max(0,spacing)}] : advanced;
}

export function selectInterleavedLearningTarget<Target extends {readonly id:string}>(input:Readonly<{
  due:readonly Target[];
  initialReady:readonly Target[];
  currentRunTargetIds:readonly string[];
  retries:readonly InterleavedLearningRetry[];
}>):Target|undefined {
  const retryIds=new Set(input.retries.map(retry=>retry.id));
  const currentIds=new Set(input.currentRunTargetIds);
  const retryTarget=(onlyReady:boolean)=>input.retries
    .filter(retry=>!onlyReady||retry.remaining<=0)
    .map(retry=>input.due.find(target=>target.id===retry.id))
    .find((target):target is Target=>!!target);
  return retryTarget(true)
    ??[...input.due,...input.initialReady].find(target=>!currentIds.has(target.id)&&!retryIds.has(target.id))
    ??retryTarget(false);
}

const needsReviewAt = (target: LearningQueueTarget, clock: number): number | null => {
  if (target.relearnAt) {
    const relearnAt = Date.parse(target.relearnAt);
    return Number.isFinite(relearnAt) ? relearnAt : null;
  }
  return target.memory ? target.memory.dueAt.getTime() : null;
};

export function resolveLearningQueue<Target extends LearningQueueTarget>({
  targets,
  languageRouteId,
  readiness,
  clock,
  dailyLimit,
}: LearningQueueInput<Target>): LearningQueue<Target> {
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
export function nextLearningQueueChangeAt<Target extends LearningQueueTarget>(input: LearningQueueInput<Target>): number | null {
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
