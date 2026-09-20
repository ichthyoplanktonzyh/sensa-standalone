import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localTargetInRoute} from '../../learning/runtime/localCurriculum';

export interface HomeLearningMembershipRecord {
  readonly status?: 'active' | 'superseded';
  readonly languageContext: LocalLearningTarget['curriculumMemberships'][number]['languageContext'];
  readonly packageKey: string | null;
  readonly assurancePackageKey?: string;
  readonly material: {
    readonly snapshot: {
      readonly validationStatus: LocalLearningTarget['curriculumMemberships'][number]['material']['snapshot']['validationStatus'];
    };
  };
}

/** Compact scheduling facts returned across the SQLite Worker seam. */
export interface HomeLearningTargetRecord {
  readonly id: string;
  readonly curriculumMemberships: readonly HomeLearningMembershipRecord[];
  readonly policyAssignment: Pick<LocalLearningTarget['policyAssignment'], 'profileId'>;
  readonly committedPolicy: Pick<NonNullable<LocalLearningTarget['committedPolicy']>, 'profileId'> | null;
  readonly planningOverrides: readonly Pick<LocalLearningTarget['planningOverrides'][number], 'kind'>[];
  readonly introducedLanguageRouteId: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly memory: { readonly dueAt: Date } | null;
  readonly relearnAt: string | null;
}

export interface HomeLearningStorageProjection {
  readonly targets: readonly HomeLearningTargetRecord[];
  readonly availablePackageKeys: readonly string[];
  readonly activeRun: Pick<LocalLearningRun, 'id' | 'targetId'> | null;
  readonly dailyLimit: number | undefined;
}

type StudyPlanRecord = Readonly<Record<string, { readonly dailyNewSenseLimit?: unknown }>>;

export function createHomeLearningTargetRecord(
  target: LocalLearningTarget,
): HomeLearningTargetRecord {
  return {
    id: target.id,
    curriculumMemberships: target.curriculumMemberships.map((membership) => ({
      ...(membership.status ? { status: membership.status } : {}),
      languageContext: membership.languageContext,
      packageKey: membership.packageKey,
      ...(membership.assurancePackageKey
        ? { assurancePackageKey: membership.assurancePackageKey }
        : {}),
      material: {
        snapshot: { validationStatus: membership.material.snapshot.validationStatus },
      },
    })),
    policyAssignment: { profileId: target.policyAssignment.profileId },
    committedPolicy: target.committedPolicy
      ? { profileId: target.committedPolicy.profileId }
      : null,
    planningOverrides: target.planningOverrides.map(({ kind }) => ({ kind })),
    introducedLanguageRouteId: target.introducedLanguageRouteId,
    startedAt: target.startedAt,
    completedAt: target.completedAt,
    memory: target.memory ? { dueAt: target.memory.dueAt } : null,
    relearnAt: target.relearnAt,
  };
}

const sameLocalDay = (value: string, clock: number): boolean => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    && parsed.toDateString() === new Date(clock).toDateString();
};

export function createHomeLearningStorageProjection(input: {
  readonly targets: readonly LocalLearningTarget[];
  readonly availablePackageKeys: readonly string[];
  readonly activeRun: LocalLearningRun | null;
  readonly studyPlans: StudyPlanRecord;
  readonly languageRouteId: string;
  readonly clock?: number;
}): HomeLearningStorageProjection {
  const dailyLimit = input.studyPlans[input.languageRouteId]?.dailyNewSenseLimit;
  const clock = input.clock ?? Date.now();
  const targets = input.targets.filter((target) => (
    localTargetInRoute(target, input.languageRouteId)
    || target.introducedLanguageRouteId === input.languageRouteId
      && !!target.startedAt
      && sameLocalDay(target.startedAt, clock)
  ));
  const neededPackageKeys = new Set(targets.flatMap((target) => (
    target.curriculumMemberships
      .filter((membership) => membership.status !== 'superseded'
        && membership.languageContext.languageRouteId === input.languageRouteId)
      .flatMap((membership) => membership.packageKey ? [membership.packageKey] : [])
  )));
  return {
    targets: targets.map(createHomeLearningTargetRecord),
    availablePackageKeys: input.availablePackageKeys.filter((key) => neededPackageKeys.has(key)),
    activeRun: input.activeRun
      ? { id: input.activeRun.id, targetId: input.activeRun.targetId }
      : null,
    dailyLimit: typeof dailyLimit === 'number' && Number.isInteger(dailyLimit)
      ? dailyLimit
      : undefined,
  };
}
