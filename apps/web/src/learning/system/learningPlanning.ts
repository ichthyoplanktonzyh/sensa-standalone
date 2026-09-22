export interface LearningQueueTarget {
  readonly id: string;
  readonly curriculumMemberships: readonly Readonly<{
    status?: 'active' | 'superseded';
    languageContext: Readonly<{ languageRouteId: string }>;
  }>[];
  readonly planningOverrides: readonly Readonly<{ kind: string }>[];
  readonly introducedLanguageRouteId: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly memory: { readonly dueAt: Date } | null;
  readonly relearnAt: string | null;
}

export interface LearningQueueInput<Target extends LearningQueueTarget = LearningQueueTarget> {
  readonly targets: readonly Target[];
  readonly languageRouteId: string;
  readonly readiness: Readonly<Record<string, 'ready' | 'blocked'>>;
  readonly clock: number;
  readonly dailyLimit: number | undefined;
}

export interface InterleavedLearningRetry {
  readonly id: string;
  readonly remaining: number;
}

export const advanceInterleavedLearningRetries = (
  retries: readonly InterleavedLearningRetry[],
  completedTargetId: string,
  retry: boolean,
  spacing = 2,
): InterleavedLearningRetry[] => {
  const advanced = retries
    .filter((candidate) => candidate.id !== completedTargetId)
    .map((candidate) => ({ ...candidate, remaining: Math.max(0, candidate.remaining - 1) }));
  return retry
    ? [...advanced, { id: completedTargetId, remaining: Math.max(0, spacing) }]
    : advanced;
};

export const selectInterleavedLearningTarget = <Target extends { readonly id: string }>(input: Readonly<{
  due: readonly Target[];
  initialReady: readonly Target[];
  currentRunTargetIds: readonly string[];
  retries: readonly InterleavedLearningRetry[];
}>): Target | undefined => {
  const retryIds = new Set(input.retries.map((retry) => retry.id));
  const currentIds = new Set(input.currentRunTargetIds);
  const retryTarget = (onlyReady: boolean) => input.retries
    .filter((retry) => !onlyReady || retry.remaining <= 0)
    .map((retry) => input.due.find((target) => target.id === retry.id))
    .find((target): target is Target => !!target);
  return retryTarget(true)
    ?? [...input.due, ...input.initialReady]
      .find((target) => !currentIds.has(target.id) && !retryIds.has(target.id))
    ?? retryTarget(false);
};

const hasDeclaredMastery = (target: LearningQueueTarget) => (
  target.planningOverrides.some((override) => override.kind === 'declared_mastery')
);

const needsReviewAt = (target: LearningQueueTarget): number | null => {
  if (target.relearnAt) {
    const relearnAt = Date.parse(target.relearnAt);
    return Number.isFinite(relearnAt) ? relearnAt : null;
  }
  return target.memory ? target.memory.dueAt.getTime() : null;
};

export const resolveLearningQueue = <Target extends LearningQueueTarget>(input: LearningQueueInput<Target>) => {
  const activeTargets = input.targets.filter((target) => (
    target.curriculumMemberships.some((membership) => (
      membership.status !== 'superseded'
      && membership.languageContext.languageRouteId === input.languageRouteId
    ))
  ));
  const due = activeTargets
    .filter((target) => !hasDeclaredMastery(target) && input.readiness[target.id] === 'ready')
    .filter((target) => {
      const dueAt = needsReviewAt(target);
      return dueAt !== null && dueAt <= input.clock;
    });
  const startedToday = input.targets.filter((target) => (
    target.introducedLanguageRouteId === input.languageRouteId
    && target.startedAt
    && new Date(target.startedAt).toDateString() === new Date(input.clock).toDateString()
  )).length;
  const remaining = Math.max(0, (input.dailyLimit ?? 20) - startedToday);
  const initialReady = [
    ...activeTargets.filter((target) => (
      !hasDeclaredMastery(target)
      && !target.completedAt
      && target.startedAt
      && input.readiness[target.id] === 'ready'
    )),
    ...activeTargets.filter((target) => (
      !hasDeclaredMastery(target)
      && !target.completedAt
      && !target.startedAt
      && input.readiness[target.id] === 'ready'
    )).slice(0, remaining),
  ];
  return { activeTargets, due, initialReady, startedToday, remaining };
};

export const nextLearningQueueChangeAt = <Target extends LearningQueueTarget>(
  input: LearningQueueInput<Target>,
): number | null => {
  const queue = resolveLearningQueue(input);
  const futureDue = queue.activeTargets
    .filter((target) => !hasDeclaredMastery(target) && input.readiness[target.id] === 'ready')
    .map(needsReviewAt)
    .filter((value): value is number => value !== null && value > input.clock);
  const nextDay = queue.startedToday > 0
    ? new Date(new Date(input.clock).setHours(24, 0, 0, 0)).getTime()
    : null;
  const candidates = nextDay === null ? futureDue : [...futureDue, nextDay];
  return candidates.length ? Math.min(...candidates) : null;
};
