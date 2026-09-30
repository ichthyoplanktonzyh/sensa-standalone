import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';

import { contentSupplySystem, type ContentSupplyRuntimePackage } from '../../contentSupply/system';
import { readHomeLearningRecords } from '../../data/library/store';
import { readLearningOverview } from '../../data/library/learning';
import { localFlowText } from '../../i18n/localFlowText';
import { assuranceContent, assuranceView, localAssuranceState } from '../protocols/assurance';
import { fourStageContent, fourStageQueue } from '../protocols/fourStage';
import { toReviewSpec } from '../content/reviewCards';
import { resolveReviewMemoryOutcome } from '../review/types';
import {
  localCurriculumMeaning,
  localCurriculumMembershipForContext,
  localCurriculumMembershipForRoute,
  localExecutableTargetForParticipant,
  localLastPresentedMaterial,
  localPresentedMaterial,
} from '../runtime/localCurriculum';
import {
  localLightweightPhase,
  localLightweightStep,
} from '../runtime/lightweightInitialProtocol';
import {
  localProtocolActiveTargetId,
  localProtocolStepId,
  type LocalCurriculumMembership,
  type LocalLearningMaterialization,
  type LocalLearningRun,
  type LocalLearningTarget,
} from '../runtime/localProtocol';
import { localRunBinding, localRunPolicy, localTargetPolicy } from '../runtime/localRuntimeBindings';
import {
  learningPolicyProfileRegistry,
  type LearningPolicyId,
} from '../runtime/policyProfiles';
import { learningRuntimeCoordinator, localExecutionForRun, inspectLocalTargetReadiness } from '../runtime/runtimeCoordinator';
import { hasDeclaredMasteryOverride } from '../runtime/targetPlanningOverrides';
import {
  nextLearningQueueChangeAt,
  resolveLearningQueue,
  selectInterleavedLearningTarget,
  type InterleavedLearningRetry,
} from './learningPlanning';
import type {
  FourStageReviewSessionProjection,
  LearningFourStageInitialRuntimeProjection,
  LearningFourStageReviewRuntimeProjection,
  LearningHomeProjection,
  LearningLightweightRuntimeProjection,
  LearningPersonalEnrollmentIndex,
  LearningPolicy,
  LearningPolicyOption,
  LearningReadiness,
  LearningRecordProjection,
  LearningRuntimeProjection,
  LearningSemanticMemoryProjection,
  LearningStructuredRuntimeProjection,
  LearningTargetPresentation,
  LearningTargetProjection,
  LearningWorkspaceProjection,
} from './learningReadModels';

const policyOptions: readonly LearningPolicyOption[] = Object.freeze(
  learningPolicyProfileRegistry.list().map((profile) => Object.freeze({
    id: profile.profileId,
    localSelectable: profile.localSelectable === true,
  })),
);

const selectablePolicies = policyOptions
  .filter((option) => option.localSelectable)
  .map((option) => option.id);

const packageFor = (
  packages: readonly ContentSupplyRuntimePackage[],
  membership: LocalCurriculumMembership | undefined,
) => membership?.packageKey
  ? packages.find((candidate) => candidate.key === membership.packageKey)
  : undefined;

const targetExample = (material: LocalLearningMaterialization): string => {
  const value = material.content.resources.find((resource) => (
    resource.materialRoleKey === 'usage_guidance'
  ))?.contentPayload.example;
  return typeof value === 'string' ? value : '';
};

const targetPresentation = (
  target: LocalLearningTarget,
  membership: LocalCurriculumMembership,
  readiness: LearningReadiness,
  material: LocalLearningMaterialization = membership.material,
): LearningTargetPresentation => ({
  targetId: target.id,
  expression: target.expression,
  meaning: localCurriculumMeaning({ ...membership, material }),
  targetLanguageTag: target.targetLanguageTag,
  supportLanguageTag: membership.languageContext.supportLanguageTag,
  example: targetExample(material),
  partOfSpeech: '',
  expressionTypeLabel: localFlowText('expression'),
  sourceKind: membership.packageKey ? 'book' : 'personal_semantic_world',
  sourceLabel: membership.packageKey
    ? localFlowText('downloadedPackages')
    : localFlowText('semanticWorld'),
  runtimeSenseId: null,
  personalExperienceGrounding: null,
  policy: localTargetPolicy(target),
  lightweightReadiness: {
    status: readiness,
    label: readiness === 'ready' ? localFlowText('downloaded') : localFlowText('prepareResources'),
    detail: readiness === 'ready' ? localFlowText('resourcesLocal') : localFlowText('resourceInvalid'),
  },
});

export const projectLearningTarget = (
  target: LocalLearningTarget,
  membership: LocalCurriculumMembership,
  readiness: LearningReadiness,
  clock: number,
  material: LocalLearningMaterialization = membership.material,
  pack?: ContentSupplyRuntimePackage,
): LearningTargetProjection => {
  const policy = localTargetPolicy(target);
  const declaredMastery = hasDeclaredMasteryOverride(target);
  const reviewAt = target.relearnAt
    ? Date.parse(target.relearnAt)
    : target.memory?.dueAt.getTime() ?? Number.POSITIVE_INFINITY;
  const reviewDue = Number.isFinite(reviewAt) && reviewAt <= clock;
  const personalMeaningId = typeof membership.provenance.personalMeaningId === 'string'
    ? membership.provenance.personalMeaningId
    : null;
  const state = declaredMastery ? 'declared_mastery'
    : target.relearnAt ? 'relearning'
      : target.completedAt && reviewDue ? 'review_due'
        : target.completedAt ? 'completed'
          : target.startedAt ? 'committed'
            : readiness;
  return {
    targetId: target.id,
    presentation: targetPresentation(target, membership, readiness, material),
    state,
    preparation: readiness,
    policy,
    committedPolicy: target.committedPolicy?.profileId ?? null,
    allowedPolicies: membership.assurancePackageKey && !target.startedAt
      ? selectablePolicies
      : [policy],
    started: target.startedAt !== null,
    completed: target.completedAt !== null,
    reviewDue,
    relearning: target.relearnAt !== null,
    declaredMastery,
    nextReviewAt: target.memory?.dueAt.toISOString() ?? null,
    curriculumMembershipId: membership.id,
    languageContext: structuredClone(membership.languageContext),
    packageKey: membership.packageKey,
    publicationArchiveSha256:typeof membership.provenance.publicationArchiveSha256==='string'
      ?membership.provenance.publicationArchiveSha256
      :null,
    assurancePackageKey: membership.assurancePackageKey ?? null,
    material: structuredClone(material),
    studyContent: pack && membership.assurancePackageKey
      ? assuranceContent(pack, membership.assurancePackageKey)?.template.content ?? null
      : null,
    identity: {
      senseId: target.identity.senseId,
      senseVersionId: target.identity.senseVersionId,
      bindingId: target.identity.senseExpressionBindingId,
      bindingVersionId: target.identity.bindingVersionId,
    },
    personalMeaningId,
  };
};

const recordProjection = (
  runs: readonly LocalLearningRun[],
  targets: readonly LocalLearningTarget[],
): LearningRecordProjection[] => runs
  .filter((run) => run.completedAt && run.completionKind !== 'wait_relearning')
  .flatMap((run) => run.targetIds.map((targetId) => {
    const target = targets.find((candidate) => candidate.id === targetId);
    const participant = run.participants[targetId];
    const material = participant ? localLastPresentedMaterial(participant) : undefined;
    const meaning = material?.content.resources.find((resource) => (
      resource.materialRoleKey === 'sense_confirmation'
    ))?.contentPayload.meaning;
    return {
      recordId: `${run.id}:${targetId}`,
      targetId,
      expression: target?.expression ?? '',
      languageTag: target?.targetLanguageTag ?? '',
      ...(typeof meaning === 'string' ? { meaning } : {}),
      occurredAt: run.targetCompletions?.[targetId]?.at ?? run.completedAt!,
      kind: run.purpose,
      label: localFlowText(run.purpose === 'initial_learning'
        ? 'initialRecord'
        : run.purpose === 'retention_review' ? 'reviewRecord' : 'relearningRecord'),
      detail: localFlowText('localRecord'),
    };
  }))
  .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

const runtimeTarget = (
  run: LocalLearningRun,
  targets: readonly LocalLearningTarget[],
) => {
  const execution = localExecutionForRun(run);
  const activeTargetId = run.completedAt
    ? run.targetId
    : localProtocolActiveTargetId(execution, run);
  const target = targets.find((candidate) => candidate.id === activeTargetId);
  const participant = target ? run.participants[target.id] : undefined;
  if (!target || !participant) throw new Error('localFlow.resourceInvalid');
  const stepId = run.completedAt ? null : localProtocolStepId(execution, run);
  const material = run.completedAt
    ? localLastPresentedMaterial(participant)
    : stepId ? localPresentedMaterial(participant, stepId) : participant.material;
  const executable = localExecutableTargetForParticipant(target, participant, material);
  return { target, participant, material, executable };
};

const projectRuntime = (
  run: LocalLearningRun,
  targets: readonly LocalLearningTarget[],
  packages: readonly ContentSupplyRuntimePackage[],
  clock: number,
): LearningRuntimeProjection => {
  const { target, participant, material, executable } = runtimeTarget(run, targets);
  const membership = executable.curriculumMembership;
  const pack = executable.packageKey
    ? packages.find((candidate) => candidate.key === executable.packageKey)
    : undefined;
  const targetView = projectLearningTarget(target, membership, 'ready', clock, material, pack);
  const surface = learningRuntimeCoordinator.adapterForBinding(localRunBinding(run)).surfaceFor(run.purpose);
  const base = {
    runId: run.id,
    revision: run.revision,
    purpose: run.purpose,
    completed: run.completedAt !== null,
    policy: localRunPolicy(run),
    targetIds: [...run.targetIds],
    currentTargetId: target.id,
  } as const;

  if (surface === 'lightweight_initial' || surface === 'lightweight_retention') {
    const step = localLightweightStep(run, target, material);
    return {
      ...base,
      kind: 'lightweight',
      capabilities: ['toast', 'dictionary', 'personal_scenes', 'personal_content_menu', 'declared_mastery'],
      target: targetView,
      phase: localLightweightPhase(run) === 'reveal' ? 'reveal' : 'experience',
      step: step ? { ...structuredClone(step), materialization: structuredClone(material) } : null,
    } satisfies LearningLightweightRuntimeProjection;
  }

  if (surface === 'structured_session') {
    if (!pack) throw new Error('localFlow.resourceInvalid');
    const view = assuranceView(run, pack);
    const state = localAssuranceState(run);
    const content = view?.content ?? null;
    const resource = view?.resource ?? null;
    const reviewSpec = resource && content ? toReviewSpec(resource, content) : null;
    const reviewResult = reviewSpec && state.feedback ? {
      assessmentId: reviewSpec.id,
      kind: reviewSpec.kind,
      focusDimension: reviewSpec.focusDimension,
      correct: state.feedback.correct,
      responseId: state.feedback.answer || null,
      memoryOutcome: run.purpose === 'initial_learning'
        ? null
        : resolveReviewMemoryOutcome(reviewSpec.kind, state.feedback.correct),
      evidenceEligible: run.purpose !== 'initial_learning' && reviewSpec.evidenceEligible,
    } : null;
    return {
      ...base,
      kind: 'structured',
      capabilities: ['toast', 'dictionary', 'notes', 'personal_scenes', 'personal_content_menu', 'declared_mastery'],
      target: targetView,
      content,
      stepKind: view?.stepKind ?? null,
      action: view ? {
        ordinal: view.action.ordinal,
        totalTarget: view.action.totalTarget,
        intent: view.action.intent,
        repairResourceRef: view.action.repairResourceRef ?? null,
      } : null,
      resource,
      state: structuredClone(state),
      reviewSpec,
      reviewResult,
    } satisfies LearningStructuredRuntimeProjection;
  }

  const queue = fourStageQueue(run);
  const session = queue.getCurrentSession();
  const sessionTarget = session
    ? targets.find((candidate) => candidate.id === session.targetId)
    : undefined;
  const sessionParticipant = sessionTarget ? run.participants[sessionTarget.id] : undefined;
  const sessionMaterial = sessionParticipant
    ? localLastPresentedMaterial(sessionParticipant)
    : undefined;
  const sessionExecutable = sessionTarget && sessionParticipant
    ? localExecutableTargetForParticipant(sessionTarget, sessionParticipant, sessionMaterial)
    : undefined;
  const sessionPack = sessionExecutable?.packageKey
    ? packages.find((candidate) => candidate.key === sessionExecutable.packageKey)
    : undefined;
  const content = sessionExecutable ? fourStageContent(sessionExecutable, sessionPack) : null;
  const targetCard = sessionExecutable && content ? {
    expression: sessionExecutable.expression,
    meaning: sessionExecutable.meaning,
    example: content.learningExamples[0]?.textL2 ?? '',
    partOfSpeech: '',
  } : null;
  if (surface === 'interleaved_four_stage') {
    const projection = 'getProjection' in queue ? queue.getProjection() : null;
    const currentProgress = session && projection
      ? projection.targets.find((candidate) => candidate.targetId === session.targetId)?.progress
      : null;
    return {
      ...base,
      kind: 'four_stage_initial',
      capabilities: [],
      session: session as LearningFourStageInitialRuntimeProjection['session'],
      target: targetCard,
      content,
      targetCount: projection?.targetCount ?? run.targetIds.length,
      completedTargetCount: projection?.graduatedTargetIds.length ?? 0,
      currentTargetCheckpointCredits: currentProgress
        ? Object.values(currentProgress.checkpointCredits).filter((credit) => credit.status === 'credited').length
        : 0,
    } satisfies LearningFourStageInitialRuntimeProjection;
  }
  if (surface === 'interleaved_four_stage_review') {
    return {
      ...base,
      kind: 'four_stage_review',
      capabilities: [],
      session: session as FourStageReviewSessionProjection | null,
      target: targetCard,
      targetCount: run.targetIds.length,
    } satisfies LearningFourStageReviewRuntimeProjection;
  }
  throw new Error(`Unknown Learning Runtime presentation: ${surface}`);
};

const workspaceReadiness = (
  targets: readonly LocalLearningTarget[],
  packages: readonly ContentSupplyRuntimePackage[],
  context: SensaFormalPinnedLanguageContext,
) => Object.fromEntries(targets.map((target) => {
  const membership = localCurriculumMembershipForContext(target, context);
  return [target.id, inspectLocalTargetReadiness(
    target,
    membership,
    packageFor(packages, membership),
  ).status];
})) as Readonly<Record<string, 'ready' | 'blocked'>>;

export async function readLearningWorkspaceProjection(input: Readonly<{
  languageContext: SensaFormalPinnedLanguageContext;
  clock: number;
  retries: readonly InterleavedLearningRetry[];
}>): Promise<LearningWorkspaceProjection> {
  const snapshot=await readLearningOverview();
  const packageKeys=snapshot.targets.flatMap(target=>{
    const membership=localCurriculumMembershipForContext(target,input.languageContext);
    return membership?.assurancePackageKey&&membership.packageKey?[membership.packageKey]:[];
  });
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys});
  const readiness = workspaceReadiness(snapshot.targets, packages, input.languageContext);
  const dailyLimit = snapshot.studyPlans[input.languageContext.languageRouteId]?.dailyNewSenseLimit;
  const queue = resolveLearningQueue({
    targets: snapshot.targets,
    languageRouteId: input.languageContext.languageRouteId,
    readiness,
    clock: input.clock,
    dailyLimit,
  });
  const activeRun = snapshot.runs.find((run) => run.id === snapshot.active) ?? null;
  const nextTarget = selectInterleavedLearningTarget({
    due: queue.due,
    initialReady: queue.initialReady,
    currentRunTargetIds: activeRun?.targetIds ?? [],
    retries: input.retries,
  });
  const targets = queue.activeTargets.flatMap((target) => {
    const membership = localCurriculumMembershipForContext(target, input.languageContext);
    return membership
      ? [projectLearningTarget(
        target,
        membership,
        readiness[target.id] ?? 'blocked',
        input.clock,
        membership.material,
        packageFor(packages, membership),
      )]
      : [];
  });
  return {
    enrollments:snapshot.enrollments.filter(enrollment=>
      enrollment.status==='active'
      &&enrollment.languageContext.languageRouteId===input.languageContext.languageRouteId
      &&enrollment.languageContext.targetLanguageTag===input.languageContext.targetLanguageTag
      &&enrollment.languageContext.supportLanguageTag===input.languageContext.supportLanguageTag)
      .map(enrollment=>({enrollmentId:enrollment.id,languageRouteId:enrollment.languageContext.languageRouteId,source:structuredClone(enrollment.source)})),
    targets,
    queue: {
      activeTargetIds: queue.activeTargets.map((target) => target.id),
      dueTargetIds: queue.due.map((target) => target.id),
      initialReadyTargetIds: queue.initialReady.map((target) => target.id),
      nextTargetId: nextTarget?.id ?? null,
      nextChangeAt: nextLearningQueueChangeAt({
        targets: snapshot.targets,
        languageRouteId: input.languageContext.languageRouteId,
        readiness,
        clock: input.clock,
        dailyLimit,
      }),
    },
    runtime: activeRun ? projectRuntime(activeRun, snapshot.targets, packages, input.clock) : null,
    activeRunId: activeRun?.id ?? null,
    dailyLimit: dailyLimit ?? null,
    records: recordProjection(snapshot.runs, snapshot.targets),
    policyOptions,
  };
}

export const effectiveHomeLearningPolicy = (
  target: Awaited<ReturnType<typeof readHomeLearningRecords>>['targets'][number],
): LearningPolicy => target.committedPolicy?.profileId ?? target.policyAssignment.profileId;

export const homeLearningReadiness = (
  target: Awaited<ReturnType<typeof readHomeLearningRecords>>['targets'][number],
  membership: Awaited<ReturnType<typeof readHomeLearningRecords>>['targets'][number]['curriculumMemberships'][number] | undefined,
  availablePackageKeys: ReadonlySet<string>,
): 'ready' | 'blocked' => {
  if (!membership || membership.material.snapshot.validationStatus !== 'validated') return 'blocked';
  const profileId = effectiveHomeLearningPolicy(target);
  const supported = policyOptions.some((option) => option.id === profileId);
  if (!supported) return 'blocked';
  if (profileId !== 'lightweight' && (
    !membership.packageKey
    || !availablePackageKeys.has(membership.packageKey)
    || !membership.assurancePackageKey
  )) return 'blocked';
  return 'ready';
};

export async function readLearningHomeProjection(input: Readonly<{
  languageRouteId: string;
  clock: number;
}>): Promise<LearningHomeProjection> {
  const stored = await readHomeLearningRecords(input.languageRouteId);
  const availablePackageKeys = new Set(stored.availablePackageKeys);
  const readiness = Object.fromEntries(stored.targets.map((target) => {
    const membership = localCurriculumMembershipForRoute(target, input.languageRouteId);
    return [target.id, homeLearningReadiness(target, membership, availablePackageKeys)];
  })) as Readonly<Record<string, 'ready' | 'blocked'>>;
  const queue = resolveLearningQueue({
    targets: stored.targets,
    languageRouteId: input.languageRouteId,
    readiness,
    clock: input.clock,
    dailyLimit: stored.dailyLimit,
  });
  const nextTarget = queue.due[0] ?? queue.initialReady[0] ?? null;
  return {
    activeRunId: stored.activeRun?.id ?? null,
    dailyLimit: stored.dailyLimit ?? null,
    readyInitialCount: queue.initialReady.length,
    reviewDueCount: queue.due.length,
    mixedReadyCount: queue.initialReady.length + queue.due.length,
    nextTargetId: stored.activeRun?.targetId ?? nextTarget?.id ?? null,
    nextReviewTargetId: stored.activeRun?.targetId ?? queue.due[0]?.id ?? null,
    nextChangeAt: nextLearningQueueChangeAt({
      targets: stored.targets,
      languageRouteId: input.languageRouteId,
      readiness,
      clock: input.clock,
      dailyLimit: stored.dailyLimit,
    }),
    nextTargetPolicy: nextTarget
      ? (nextTarget.committedPolicy?.profileId ?? nextTarget.policyAssignment.profileId)
      : null,
    policyOptions,
  };
}

export async function readLearningPersonalEnrollmentIndex(): Promise<LearningPersonalEnrollmentIndex> {
  const snapshot = await readLearningOverview();
  return {
    targets: snapshot.targets.map((target) => ({
      targetId: target.id,
      curriculumMembershipIds: target.curriculumMemberships.map((membership) => membership.id),
    })),
  };
}

export async function readLearningSemanticMemoryProjection(): Promise<LearningSemanticMemoryProjection> {
  const snapshot = await readLearningOverview();
  return {
    targets: snapshot.targets.map((target) => ({
      targetId: target.id,
      senseId: target.identity.senseId,
      declaredMastery: hasDeclaredMasteryOverride(target),
      memory: target.memory ? {
        dueAt: target.memory.dueAt,
        fsrsCardState: target.memory.fsrsCardState,
        fsrsLastReviewedAt: target.memory.fsrsLastReviewedAt,
        fsrsStability: target.memory.fsrsStability,
        reps: target.memory.reps,
      } : null,
    })),
  };
}

export const currentLearningPolicyOptions = () => policyOptions;

export const removeRetryTarget = (
  retries: readonly InterleavedLearningRetry[],
  targetId: string,
) => retries.filter((retry) => retry.id !== targetId);

export type { InterleavedLearningRetry } from './learningPlanning';
