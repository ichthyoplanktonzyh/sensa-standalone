import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';
import {learningSupportMeaning,lightweightStepRequirements} from '@sensa/contracts/sensa';

import { contentSupplySystem, type ContentSupplyRuntimePackage } from '../../contentSupply/system';
import { readHomeLearningRecords,readLibrary,readLearningHistoryPage,readRuntimeLearningCandidates,readLearningManagementSummary,readLocalLibraryRevision } from '../../data/library/store';
import {stableUuid} from '@sensa/learning-kernel';
import type {LocalCurriculumEnrollment} from '../../data/library/curriculumEnrollments';
import { readLearningOverview } from '../../data/library/learningOverview';
import {readStudyPlans} from '../../data/library/studyPlans';
import {sameLearningSessionDirection} from '../../data/library/learningCommandReceipt';
import {planningMembershipForContext,curriculumSourceEligibility} from '../runtime/curriculumEligibility';
import {runBaselineMaterial} from '../runtime/runMaterialPins';
import { localFlowText } from '../../i18n/localFlowText';
import '../../i18n/learningResources';
import i18n from '../../i18n';
import { assuranceContent, assuranceView, localAssuranceState } from '../protocols/assurance';
import { fourStageContent, fourStageQueue } from '../protocols/fourStage';
import { toReviewSpec } from '../content/reviewCards';
import { resolveReviewMemoryOutcome } from '../review/types';
import {
  localCurriculumMeaning,
  localCurriculumMembershipForContext,
  localExecutableTargetForParticipant,
  localLastPresentedMaterial,
  localPresentedMaterial,
} from '../runtime/localCurriculum';
import {
  localLightweightPhase,
  localLightweightAdoptedExperience,
  localLightweightStep,
} from '../runtime/lightweightInitialProtocol';
import {
  localProtocolActiveTargetId,
  localProtocolStepId,
  localRunSessionIntent,
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
  LearningRuntimeWorkspaceProjection,
  LearningSemanticMemoryProjection,
  LearningStructuredRuntimeProjection,
  LearningTargetPresentation,
  LearningTargetProjection,
  LearningTargetDetailProjection,
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
    resource.materialRoleKey === 'scene_realization'
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
  sourceKind: membership.provenance.kind==='stable_sense'?'direct':membership.packageKey ? 'book' : 'personal_semantic_world',
  sourceLabel: membership.provenance.kind==='stable_sense'?i18n.t('study.sources.direct',{ns:'learning'}):membership.packageKey
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
): LearningRecordProjection[] => {
  const byTargetId=new Map(targets.map(target=>[target.id,target]));
  return runs
  .filter((run) => run.completedAt && run.completionKind !== 'wait_relearning')
  .flatMap((run) => run.targetIds.map((targetId) => {
    const target = byTargetId.get(targetId);
    const participant = run.participants[targetId];
    const material = participant ? localLastPresentedMaterial(participant) : undefined;
    const meaning = material?learningSupportMeaning(material.content.resources,participant?.languageContext.supportLanguageTag):undefined;
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
  .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)||left.recordId.localeCompare(right.recordId));
};

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
    : stepId ? localPresentedMaterial(participant, stepId) : runBaselineMaterial(participant);
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
    const currentKeys=new Set(step?.materialBindings.map(binding=>binding.resourceKey)??[]);
    const experience=localLightweightAdoptedExperience(run,participant);
    const experienceRoles=new Set<string>(lightweightStepRequirements('pre_reveal').map(requirement=>requirement.materialRoleKey));
    return {
      ...base,
      kind: 'lightweight',
      needsRelearning: run.completionKind === 'wait_relearning',
      capabilities: ['toast', 'dictionary', 'personal_scenes', 'personal_content_menu', 'declared_mastery'],
      target: targetView,
      phase: localLightweightPhase(run) === 'reveal' ? 'reveal' : 'experience',
      step: step ? { ...structuredClone(step), materialization: structuredClone(material) } : null,
      questionResources:structuredClone([
        ...material.content.resources.filter(resource=>currentKeys.has(resource.resourceKey)),
        ...(experience?.content.resources.filter(resource=>experienceRoles.has(resource.materialRoleKey))??[]),
      ]),
      questionUsesPersonalContext:material.snapshot.personalAnchorUseGrantIds.length>0||(experience?.snapshot.personalAnchorUseGrantIds.length??0)>0,
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

const workspaceReadiness = async (
  targets: readonly LocalLearningTarget[],
  packages: readonly ContentSupplyRuntimePackage[],
  context: SensaFormalPinnedLanguageContext,
  enrollments:ReadonlyMap<string,LocalCurriculumEnrollment>,
) => {
  const readiness:Record<string,'ready'|'blocked'>={},eligibility:Record<string,{introduce:boolean;ongoing:boolean}>={};let until=performance.now()+8;
  for(const target of targets){
    const membership=planningMembershipForContext(target,context,enrollments,member=>inspectLocalTargetReadiness(target,member,packageFor(packages,member)).status==='ready');
    readiness[target.id]=membership?'ready':'blocked';
    const id=membership?.provenance?.curriculumEnrollmentId;
    eligibility[target.id]=membership?curriculumSourceEligibility(membership,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt):{introduce:false,ongoing:false};
    // All content checks remain mandatory. Yield between Targets so validating
    // a collection cannot monopolize one main-thread task on a slower device.
    if(performance.now()>=until){await new Promise<void>(resolve=>setTimeout(resolve,0));until=performance.now()+8;}
  }
  return {readiness,eligibility};
};

export async function readLearningWorkspaceProjection(input: Readonly<{
  languageContext: SensaFormalPinnedLanguageContext;
  clock: number;
  retries: readonly InterleavedLearningRetry[];
}>): Promise<LearningWorkspaceProjection> {
  const snapshot=await readLearningOverview();
  const enrollments=new Map(snapshot.enrollments.map(enrollment=>[enrollment.id,enrollment]));
  const packageKeys=snapshot.targets.flatMap(target=>target.curriculumMemberships.flatMap(member=>member.languageContext.languageRouteId===input.languageContext.languageRouteId&&member.assurancePackageKey&&member.packageKey?[member.packageKey]:[]));
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys});
  const {readiness,eligibility} = await workspaceReadiness(snapshot.targets, packages, input.languageContext,enrollments);
  const dailyLimit = snapshot.studyPlans[input.languageContext.languageRouteId]?.dailyNewSenseLimit;
  const queue = resolveLearningQueue({
    targets: snapshot.targets,
    languageRouteId: input.languageContext.languageRouteId,
    readiness,
    eligibility,
    clock: input.clock,
    dailyLimit,
  });
  const activeRun = snapshot.runs.find((run) => run.id === snapshot.active) ?? null;
  const nextTarget = selectInterleavedLearningTarget({
    due: queue.due,
    initialReady: activeRun&&localRunSessionIntent(activeRun)==='review_only'?[]:queue.initialReady,
    currentRunTargetIds: (activeRun?.targetIds??[]).filter(id=>!(activeRun?.purpose==='retention_review'&&queue.due.some(target=>target.id===id&&target.relearnAt))),
    retries: input.retries,
  });
  const targets = snapshot.targets.flatMap((target) => {
    const membership = planningMembershipForContext(target,input.languageContext,enrollments,member=>inspectLocalTargetReadiness(target,member,packageFor(packages,member)).status==='ready')??localCurriculumMembershipForContext(target, input.languageContext);
    return membership
      ? [projectLearningTarget(
        target,
        membership,
        inspectLocalTargetReadiness(target,membership,packageFor(packages,membership)).status,
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
      .map(enrollment=>({enrollmentId:enrollment.id,languageRouteId:enrollment.languageContext.languageRouteId,source:enrollment.source.kind==='stable_sense'
        ?{kind:'stable_sense' as const,senseId:enrollment.source.selection.reference.senseId,senseVersionId:enrollment.source.selection.reference.senseVersionId,
          bindingId:enrollment.source.selection.reference.bindingId,bindingVersionId:enrollment.source.selection.reference.bindingVersionId,
          expression:enrollment.source.selection.expression.surfaceForm,meaning:enrollment.source.selection.semanticSpec.coreMeaningFocus}
        :structuredClone(enrollment.source)})),
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
      },queue),
    },
    runtime: activeRun ? projectRuntime(activeRun, snapshot.targets, packages, input.clock) : null,
    activeRunId: activeRun?.id ?? null,
    dailyLimit: dailyLimit ?? null,
    records: recordProjection(snapshot.runs, snapshot.targets),
    policyOptions,
  };
}

/** Exact Target and active Run reads share the Library lock. Merely opening a
 * record must not prepare a queue, rehydrate artifacts or decode other Runs. */
export async function readLearningTargetDetailProjection(input:Readonly<{
  targetId:string;languageContext:SensaFormalPinnedLanguageContext;clock:number;
}>):Promise<LearningTargetDetailProjection>{
  if(!Number.isFinite(input.clock))throw new Error('localFlow.clockChanged');
  const snapshot=await readLibrary(async tx=>{
    const target=await tx.get<LocalLearningTarget>('learningTargets',input.targetId);
    const membership=target?localCurriculumMembershipForContext(target,input.languageContext):undefined;
    const activeId=await tx.get<string>('meta','learning-active');
    const run=activeId?await tx.get<LocalLearningRun>('learningRuns',activeId):undefined;
    if(activeId&&(!run||run.id!==activeId))throw new Error('localFlow.resourceInvalid');
    const packageKey=membership?.packageKey;
    const exportPackageKey=packageKey&&(await tx.existingRecordKeys('packageCache',[packageKey])).has(packageKey)?packageKey:null;
    const dailyLimit=(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit??null;
    return {target,membership,activeRunTargetIds:run?.targetIds??[],exportPackageKey,dailyLimit};
  });
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys:snapshot.membership?.assurancePackageKey&&snapshot.membership.packageKey?[snapshot.membership.packageKey]:[]});
  const pack=packageFor(packages,snapshot.membership);
  return {
    target:snapshot.target&&snapshot.membership?projectLearningTarget(snapshot.target,snapshot.membership,inspectLocalTargetReadiness(snapshot.target,snapshot.membership,pack).status,input.clock,snapshot.membership.material,pack):null,
    activeRunTargetIds:snapshot.activeRunTargetIds,exportPackageKey:snapshot.exportPackageKey,
    dailyLimit:snapshot.dailyLimit,policyOptions,
  };
}

/** The page's current execution does not need every stored material and Run.
 * Exact participants and compact Worker planning share the Library read lock;
 * immutable public artifacts are obtained through Content Supply afterwards. */
export async function readLearningRuntimeProjection(input:Readonly<{
  languageContext:SensaFormalPinnedLanguageContext;clock:number;retries:readonly InterleavedLearningRetry[];
  sessionIntent?:'mixed'|'review_only';
}>):Promise<LearningRuntimeWorkspaceProjection>{
  const snapshot=await readLibrary(async tx=>{
    const activeId=await tx.get<string>('meta','learning-active');
    const run=activeId?await tx.get<LocalLearningRun>('learningRuns',activeId):null;
    if(activeId&&(!run||run.id!==activeId))throw new Error('localFlow.resourceInvalid');
    const targets=run?await Promise.all(run.targetIds.map(async id=>{
      const target=await tx.get<LocalLearningTarget>('learningTargets',id);
      if(!target||target.id!==id)throw new Error('localFlow.resourceInvalid');
      return target;
    })):[];
    // Ordinary Steps need no collection planning. Choose a continuation only
    // at a Run boundary. The compact Worker query bypasses the page transaction
    // chain, so it is safe under this lock without nesting a Library transaction.
    const dailyLimit=(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit;
    return {run,targets,dailyLimit,
      // A pinned Run can finish after the surface Route changes. It cannot
      // continue its Session into a different direction or Route.
      planning:(!run||run.completedAt&&sameLearningSessionDirection(run.languageContext,input.languageContext))?await readRuntimeLearningCandidates({languageContext:input.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id),currentTargetIds:run?.targetIds??[],retryTargetIds:input.retries.map(retry=>retry.id)}):null};
  });
  const packageKeys=snapshot.targets.flatMap(target=>{
    const participant=snapshot.run!.participants[target.id];
    const member=target.curriculumMemberships.find(member=>member.id===participant?.curriculumMembershipId);
    return member?.assurancePackageKey&&member.packageKey?[member.packageKey]:[];
  });
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys});
  const runtime=snapshot.run?projectRuntime(snapshot.run,snapshot.targets,packages,input.clock):null;
  if(!snapshot.planning)return {runtime,dailyLimit:snapshot.dailyLimit??null,nextTargetId:null,nextChangeAt:null,policyOptions};
  const queue=snapshot.planning;
  // A failed Review can hand off to a distinct Relearning Run for the same
  // Target, including after reopening (the spacing hints are not persisted).
  const currentIds=(snapshot.run?.targetIds??[]).filter(id=>!(snapshot.run?.purpose==='retention_review'&&queue.due.some(target=>target.id===id&&target.relearnAt)));
  const intent=snapshot.run?localRunSessionIntent(snapshot.run):input.sessionIntent??'mixed';
  const next=selectInterleavedLearningTarget({due:queue.due,initialReady:intent==='review_only'?[]:queue.initialReady,currentRunTargetIds:currentIds,retries:input.retries});
  return {
    runtime,
    dailyLimit:snapshot.dailyLimit??null,nextTargetId:next?.id??null,
    nextChangeAt:queue.nextChangeAt,
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

export async function readLearningPreferencesProjection(languageContext:SensaFormalPinnedLanguageContext){
 return readLibrary(async tx=>({dailyLimit:(await readStudyPlans(tx))[languageContext.languageRouteId]?.dailyNewSenseLimit??null,policyOptions}));
}
export async function readLearningManagementProjection(input:{languageContext:SensaFormalPinnedLanguageContext;clock:number}):Promise<import('./learningReadModels').LearningManagementProjection>{
 // Native projections bypass the page transaction chain. Hold the same shared
 // Library lock as the enrollment read so a writer cannot split this snapshot.
 const {summary,dailyLimit,pending}=await readLibrary(async tx=>{
  const dailyLimit=(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit;
  const [summary,identity,enrollments]=await Promise.all([readLearningManagementSummary({languageContext:input.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id)}),tx.get<import('../../data/library/store').LibraryIdentity>('meta','identity'),tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')]);
  if(!identity)throw new Error('localFlow.resourceInvalid');
  return {summary,dailyLimit,pending:{identity,enrollments}};
 });
 const ids=new Set(summary.targetIds);
 return {...summary,policies:summary.policies as LearningPolicy[],pendingDirectCount:pending.enrollments.filter(enrollment=>enrollment.status==='active'&&enrollment.source.kind==='stable_sense'&&enrollment.languageContext.languageRouteId===input.languageContext.languageRouteId&&enrollment.languageContext.targetLanguageTag===input.languageContext.targetLanguageTag&&enrollment.languageContext.supportLanguageTag===input.languageContext.supportLanguageTag&&!ids.has(stableUuid(`sensa-learning-target:${pending.identity.learnerId}:${enrollment.source.selection.reference.senseVersionId}:${enrollment.source.selection.reference.bindingVersionId}`))).length,dailyLimit:dailyLimit??null,policyOptions};
}
export async function readLearningHistoryProjection(input:{request:import('./learningHistoryModel').LearningHistoryRequest}):Promise<import('./learningReadModels').LearningHistoryProjection>{
 return readLibrary(async tx=>{
  const [page,identity,incarnation,revision]=await Promise.all([readLearningHistoryPage(input.request),tx.get<import('../../data/library/store').LibraryIdentity>('meta','identity'),tx.get<string>('meta','local-incarnation'),readLocalLibraryRevision(tx)]);
  if(!identity)throw new Error('localFlow.resourceInvalid');
  return {...page,version:JSON.stringify([identity.id,incarnation??'initial',revision,Intl.DateTimeFormat().resolvedOptions().timeZone]),records:page.records.map(record=>({...record,label:localFlowText(record.kind==='initial_learning'?'initialRecord':record.kind==='retention_review'?'reviewRecord':'relearningRecord'),detail:localFlowText('localRecord')}))};
 });
}
export async function readLearningHomeProjection(input: Readonly<{
  languageContext: SensaFormalPinnedLanguageContext;
  clock: number;
}>): Promise<LearningHomeProjection> {
  const languageRouteId=input.languageContext.languageRouteId;
  const stored = await readHomeLearningRecords(languageRouteId,input.clock);
  const availablePackageKeys = new Set(stored.availablePackageKeys);
  const enrollments=new Map((stored.enrollments??[]).map(enrollment=>[enrollment.id,enrollment]));
  const eligibility:Record<string,{introduce:boolean;ongoing:boolean}>={};
  const readiness = Object.fromEntries(stored.targets.map((target) => {
    const membership = planningMembershipForContext(target,input.languageContext,enrollments,member=>homeLearningReadiness(target,member,availablePackageKeys)==='ready',stored.sourceEligibility);
    const id=membership?.provenance?.curriculumEnrollmentId;
    eligibility[target.id]=membership?(membership.id&&stored.sourceEligibility?.[membership.id]||curriculumSourceEligibility(membership,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt)):{introduce:false,ongoing:false};
    return [target.id, homeLearningReadiness(target, membership, availablePackageKeys)];
  })) as Readonly<Record<string, 'ready' | 'blocked'>>;
  const queue = resolveLearningQueue({
    targets: stored.targets,
    languageRouteId,
    readiness,
    eligibility,
    clock: input.clock,
    dailyLimit: stored.dailyLimit,
  });
  const nextTarget = queue.due[0] ?? queue.initialReady[0] ?? null;
  return {
    activeRunId: stored.activeRun?.id ?? null,
    resumeTargetId:queue.initialReady.find(target=>target.startedAt)?.id??null,
    dailyLimit: stored.dailyLimit ?? null,
    readyInitialCount: queue.initialReady.length,
    reviewDueCount: queue.due.length,
    mixedReadyCount: queue.initialReady.length + queue.due.length,
    nextTargetId: stored.activeRun?.targetId ?? nextTarget?.id ?? null,
    nextReviewTargetId: queue.due[0]?.id ?? null,
    nextChangeAt: nextLearningQueueChangeAt({
      targets: stored.targets,
      languageRouteId,
      readiness,
      eligibility,
      clock: input.clock,
      dailyLimit: stored.dailyLimit,
    },queue),
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
