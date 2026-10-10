import type {LocalLearningRun,LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';

export interface HomeLearningMembershipRecord {
  readonly id?:string;
  readonly provenance?:Readonly<Record<string,unknown>>;
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
  readonly committedPolicy: Pick<NonNullable<LocalLearningTarget['committedPolicy']>, 'profileId'> & {readonly profileVersion?:string} | null;
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
  readonly enrollments?:readonly LocalCurriculumEnrollment[];
  readonly sourceEligibility?:Readonly<Record<string,import('../../learning/runtime/curriculumEligibility').CurriculumSourceEligibility>>;
}

type StudyPlanRecord = Readonly<Record<string, { readonly dailyNewSenseLimit?: unknown }>>;

export function createHomeLearningTargetRecord(
  target: LocalLearningTarget,
): HomeLearningTargetRecord {
  return {
    id: target.id,
    curriculumMemberships: target.curriculumMemberships.map((membership) => ({
      id:membership.id,
      ...(membership.provenance?{provenance:{curriculumEnrollmentId:membership.provenance.curriculumEnrollmentId,publicationArchiveSha256:membership.provenance.publicationArchiveSha256,senseVersionId:membership.material.snapshot.provenance?.senseVersionId??membership.provenance.senseVersionId,bindingVersionId:membership.material.snapshot.provenance?.bindingVersionId??membership.provenance.bindingVersionId}}:{}),
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
      ? { profileId: target.committedPolicy.profileId,profileVersion:target.committedPolicy.profileVersion }
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
  readonly enrollments?:readonly LocalCurriculumEnrollment[];
}): HomeLearningStorageProjection {
  const dailyLimit = input.studyPlans[input.languageRouteId]?.dailyNewSenseLimit;
  const clock = input.clock ?? Date.now();
  const enrollmentMap=new Map((input.enrollments??[]).map(enrollment=>[enrollment.id,enrollment]));
  const targets = input.targets.filter((target) => (
    target.curriculumMemberships.some(member=>{
      if(member.languageContext.languageRouteId!==input.languageRouteId)return false;
      if(member.status!=='superseded')return true;
      const id=member.provenance?.curriculumEnrollmentId,enrollment=typeof id==='string'?enrollmentMap.get(id):undefined;
      return !!target.startedAt&&enrollment?.source.kind==='published_book'&&enrollment.status==='active'&&enrollment.bookPlan?.mode!=='paused';
    })
    || target.introducedLanguageRouteId === input.languageRouteId
      && !!target.startedAt
      && sameLocalDay(target.startedAt, clock)
  ));
  const neededPackageKeys = new Set(targets.flatMap((target) => (
    target.curriculumMemberships
      .filter((membership) => membership.languageContext.languageRouteId === input.languageRouteId)
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
    ...(input.enrollments?{enrollments:input.enrollments}:{}),
  };
}
