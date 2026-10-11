import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';
import {learningSupportMeaning,lightweightStepRequirements} from '@sensa/contracts/sensa';

import { contentSupplySystem, type ContentSupplyRuntimePackage } from '../../contentSupply/system';
import { readHomeLearningRecords,readLibrary,readLearningHistoryPage,readLearningSchedulePage,readRuntimeLearningCandidates,readLearningManagementSummary,readLocalLibraryRevision,readLearningSemanticMemoryRecords } from '../../data/library/store';
import {stableUuid} from '@sensa/learning-kernel';
import type {LocalCurriculumEnrollment} from '../../data/library/curriculumEnrollments';
import { readLearningOverview } from '../../data/library/learningOverview';
import {readStudyPlans} from '../../data/library/studyPlans';
import {readActiveLearningSessionHeader,currentStudyMembership} from '../../data/library/studyScopes';
import type {LibraryTransaction} from '../../data/library/store';
import type {RuntimeLearningCandidateQuery} from '../../data/library/runtimeLearningCandidates';
import {sameLearningSessionDirection} from '../../data/library/learningCommandReceipt';
import {planningMembershipForContext,curriculumSourceEligibility} from '../runtime/curriculumEligibility';
import {currentPlanningMembership,supplementalSourceDescriptor,type SupplementalMembershipState} from '../../data/library/supplementalMemberships';
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
  localLightweightRetryCount,
  localLightweightAdoptedExperience,
  localLightweightStep,
} from '../runtime/lightweightInitialProtocol';
import {
  localProtocolActiveTargetId,
  localProtocolStepId,
  localRunSessionIntent,
  localLearningPurpose,
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
    nextReviewAt: Number.isFinite(reviewAt)?new Date(reviewAt).toISOString():null,
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
      repeatCount: localLightweightRetryCount(run),
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
  sourceEligibility:Readonly<Record<string,{introduce:boolean;ongoing:boolean}>>,
) => {
  const readiness:Record<string,'ready'|'blocked'>={},eligibility:Record<string,{introduce:boolean;ongoing:boolean}>={};let until=performance.now()+8;
  for(const target of targets){
    const membership=planningMembershipForContext(target,context,enrollments,member=>inspectLocalTargetReadiness(target,member,packageFor(packages,member)).status==='ready',sourceEligibility);
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
  const sourceEligibility=Object.fromEntries(snapshot.supplementalStates.filter(state=>state.status==='removed').map(state=>[state.id,{introduce:false,ongoing:false}]));
  const packageKeys=snapshot.targets.flatMap(target=>target.curriculumMemberships.flatMap(member=>member.languageContext.languageRouteId===input.languageContext.languageRouteId&&member.assurancePackageKey&&member.packageKey?[member.packageKey]:[]));
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys});
  const {readiness,eligibility} = await workspaceReadiness(snapshot.targets, packages, input.languageContext,enrollments,sourceEligibility);
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
    const planningActive=!!planningMembershipForContext(target,input.languageContext,enrollments,()=>true,sourceEligibility);
    const planningPaused=!planningActive&&target.curriculumMemberships.some(member=>{
      const context=member.languageContext,id=member.provenance.curriculumEnrollmentId;
      return context.languageRouteId===input.languageContext.languageRouteId&&context.targetLanguageTag===input.languageContext.targetLanguageTag&&context.supportLanguageTag===input.languageContext.supportLanguageTag&&typeof id==='string'&&enrollments.get(id)?.bookPlan?.mode==='paused';
    });
    const membership = planningMembershipForContext(target,input.languageContext,enrollments,member=>inspectLocalTargetReadiness(target,member,packageFor(packages,member)).status==='ready',sourceEligibility)??localCurriculumMembershipForContext(target, input.languageContext);
    if(!membership)return [];
    const projection=projectLearningTarget(target,membership,inspectLocalTargetReadiness(target,membership,packageFor(packages,membership)).status,input.clock,membership.material,packageFor(packages,membership));
    const enrollmentId=membership.provenance.curriculumEnrollmentId;
    const source=typeof enrollmentId==='string'?enrollments.get(enrollmentId)?.source:undefined;
    const sourceTitle=source?.kind==='published_book'?source.title:undefined;
    return [{...projection,planningActive,planningPaused,presentation:{...projection.presentation,...(sourceTitle?{sourceLabel:sourceTitle}:{})}}];
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
    const current=target?await currentPlanningMembership(tx,target,input.languageContext):undefined;
    const membership=current??(target?localCurriculumMembershipForContext(target,input.languageContext):undefined);
    let planningPaused=false;
    if(target&&!current)for(const member of target.curriculumMemberships){
      if(!sameLearningSessionDirection(member.languageContext,input.languageContext))continue;
      const id=member.provenance.curriculumEnrollmentId;
      if(typeof id==='string'&&(await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id))?.bookPlan?.mode==='paused'){planningPaused=true;break;}
    }
    const activeId=await tx.get<string>('meta','learning-active');
    const run=activeId?await tx.get<LocalLearningRun>('learningRuns',activeId):undefined;
    if(activeId&&(!run||run.id!==activeId))throw new Error('localFlow.resourceInvalid');
    const packageKey=membership?.packageKey;
    const exportPackageKey=packageKey&&(await tx.existingRecordKeys('packageCache',[packageKey])).has(packageKey)?packageKey:null;
    const dailyLimit=(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit??null;
    return {target,membership,planningActive:!!current,planningPaused,activeRunTargetIds:run?.targetIds??[],exportPackageKey,dailyLimit};
  });
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys:snapshot.membership?.assurancePackageKey&&snapshot.membership.packageKey?[snapshot.membership.packageKey]:[]});
  const pack=packageFor(packages,snapshot.membership);
  return {
    target:snapshot.target&&snapshot.membership?{...projectLearningTarget(snapshot.target,snapshot.membership,inspectLocalTargetReadiness(snapshot.target,snapshot.membership,pack).status,input.clock,snapshot.membership.material,pack),planningActive:snapshot.planningActive,planningPaused:snapshot.planningPaused}:null,
    activeRunTargetIds:snapshot.activeRunTargetIds,exportPackageKey:snapshot.exportPackageKey,
    dailyLimit:snapshot.dailyLimit,policyOptions,
  };
}

/** The page's current execution does not need every stored material and Run.
 * Exact participants and compact Worker planning share the Library read lock;
 * immutable public artifacts are obtained through Content Supply afterwards. */
async function readNextReadyRuntimeCandidate(tx:LibraryTransaction,query:RuntimeLearningCandidateQuery,selection:{run:LocalLearningRun|null;intent:'mixed'|'review_only';retries:readonly InterleavedLearningRetry[]}):Promise<{nextTargetId:string|null;nextChangeAt:number|null}>{
  const excluded=new Set<string>();
  for(;;){
    const queue=await readRuntimeLearningCandidates({...query,excludedTargetIds:[...excluded]});
    // A failed Review may continue as Relearning for the same Target. All
    // other current participants and categories outside intent stay unprobed.
    const currentIds=(selection.run?.targetIds??[]).filter(id=>!(selection.run?.purpose==='retention_review'&&queue.due.some(target=>target.id===id&&target.relearnAt)));
    const next=selectInterleavedLearningTarget({due:queue.due,initialReady:selection.intent==='review_only'?[]:queue.initialReady,currentRunTargetIds:currentIds,retries:selection.retries});
    if(!next)return {nextTargetId:null,nextChangeAt:queue.nextChangeAt};
    const target=await tx.get<LocalLearningTarget>('learningTargets',next.id);
    if(!target||target.id!==next.id)throw new Error('localFlow.resourceInvalid');
    if(await currentStudyMembership(tx,target,query.languageContext,localLearningPurpose(target)))return {nextTargetId:next.id,nextChangeAt:queue.nextChangeAt};
    // A protocol rejection refills the indexed prefix. Nothing is decoded
    // merely because it shares the library or precedes an excluded participant.
    excluded.add(next.id);
  }
}

export async function readLearningRuntimeProjection(input:Readonly<{
  languageContext:SensaFormalPinnedLanguageContext;clock:number;retries:readonly InterleavedLearningRetry[];
  sessionIntent?:'mixed'|'review_only';
}>):Promise<LearningRuntimeWorkspaceProjection>{
  const snapshot=await readLibrary(async tx=>{
    const activeId=await tx.get<string>('meta','learning-active');
    const run=activeId?(await tx.get<LocalLearningRun>('learningRuns',activeId))??null:null;
    if(activeId&&(!run||run.id!==activeId))throw new Error('localFlow.resourceInvalid');
    const targets=run?await Promise.all(run.targetIds.map(async id=>{
      const target=await tx.get<LocalLearningTarget>('learningTargets',id);
      if(!target||target.id!==id)throw new Error('localFlow.resourceInvalid');
      return target;
    })):[];
    // Ordinary Steps need no collection planning. Choose a continuation only
    // at a Run boundary. The compact Worker query bypasses the page transaction
    // chain, so it is safe under this lock without nesting a Library transaction.
    const activity=await readActiveLearningSessionHeader(tx);
    if(activity&&activity.activeRunId!==activeId)throw new Error('localFlow.progressReadFailed');
    const preferencesDailyLimit=(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit??null;
    const dailyLimit=activity?.dailyNewSenseLimit??preferencesDailyLimit??undefined;
    const sessionSummary=activity?await (async()=>{
      const currentTargetIds=run&&!run.completedAt?run.targetIds.filter(id=>!run.targetCompletions?.[id]):[];
      const [history,queue]=await Promise.all([
        readLearningHistoryPage({surface:'study',range:'all',start:'',end:'',kind:'all',languageChoice:null,activeLanguageTag:activity.languageContext.targetLanguageTag,clock:input.clock,cursor:null,limit:1,runIds:activity.runIds}),
        readLearningManagementSummary({languageContext:activity.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id),includeTargetIds:false,includeInventory:false,currentTargetIds}),
      ]);
      const pendingInitialCount=activity.intent==='review_only'?0:queue.readyInitialCount;
      // A paused future plan does not erase the currently recoverable Run.
      // Count it once even when it no longer belongs to the ready queue.
      const pendingCount=pendingInitialCount+queue.reviewDueCount+Math.max(0,currentTargetIds.length-queue.currentCandidateCount);
      return {sessionId:activity.id,completed:history.counts,completedCount:history.total,pendingCount,pendingInitialCount,pendingReviewCount:queue.reviewDueCount,nextReviewAt:queue.nextReviewAt===null?null:new Date(queue.nextReviewAt).toISOString()};
    })():null;
    return {run,targets,dailyLimit,preferencesDailyLimit,sessionSummary,
      // A pinned Run can finish after the surface Route changes. It cannot
      // continue its Session into a different direction or Route.
      planning:(!run||run.completedAt&&sameLearningSessionDirection(run.languageContext,input.languageContext))?await readNextReadyRuntimeCandidate(tx,{languageContext:activity?.languageContext??input.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id),currentTargetIds:run?.targetIds??[],retryTargetIds:input.retries.map(retry=>retry.id)},{run,intent:run?localRunSessionIntent(run):input.sessionIntent??'mixed',retries:input.retries}):null};
  });
  const packageKeys=snapshot.targets.flatMap(target=>{
    const participant=snapshot.run!.participants[target.id];
    const member=target.curriculumMemberships.find(member=>member.id===participant?.curriculumMembershipId);
    return member?.assurancePackageKey&&member.packageKey?[member.packageKey]:[];
  });
  const packages=await contentSupplySystem.read({kind:'runtime_packages',packageKeys});
  const runtime=snapshot.run?projectRuntime(snapshot.run,snapshot.targets,packages,input.clock):null;
  if(!snapshot.planning)return {runtime,sessionSummary:snapshot.sessionSummary,dailyLimit:snapshot.dailyLimit??null,preferencesDailyLimit:snapshot.preferencesDailyLimit,nextTargetId:null,nextChangeAt:null,policyOptions};
  return {
    runtime,
    sessionSummary:snapshot.sessionSummary,
    dailyLimit:snapshot.dailyLimit??null,preferencesDailyLimit:snapshot.preferencesDailyLimit,...snapshot.planning,
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
  const [summary,identity,enrollments]=await Promise.all([readLearningManagementSummary({languageContext:input.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id),includeLibraryItems:true}),tx.get<import('../../data/library/store').LibraryIdentity>('meta','identity'),tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')]);
  if(!identity)throw new Error('localFlow.resourceInvalid');
  const states=await tx.all<SupplementalMembershipState>('supplementalMembershipStates');
  return {summary,dailyLimit,pending:{identity,enrollments,states}};
 });
 const ids=new Set(summary.targetIds);
 const content=pending.enrollments.filter(enrollment=>enrollment.status==='active'&&sameLearningSessionDirection(enrollment.languageContext,input.languageContext)).slice(0,3).map(enrollment=>({id:enrollment.id,title:enrollment.source.kind==='published_book'?enrollment.source.title??localFlowText('downloadedPackages'):enrollment.source.kind==='stable_sense'?enrollment.source.selection.expression.surfaceForm:localFlowText('downloadedPackages'),state:enrollment.bookPlan?.mode??'active' as const,kind:enrollment.source.kind==='published_book'?'book' as const:enrollment.source.kind==='stable_sense'?'direct' as const:'book' as const}));
 const pendingDirect=pending.enrollments.flatMap(enrollment=>{
  if(enrollment.status!=='active'||enrollment.source.kind!=='stable_sense'||!sameLearningSessionDirection(enrollment.languageContext,input.languageContext)||enrollment.languageContext.supportLanguageTag!==input.languageContext.supportLanguageTag)return [];
  const descriptor=supplementalSourceDescriptor({kind:'stable_sense',id:enrollment.id},enrollment,pending.identity.learnerId);
  if(ids.has(descriptor.targetId))return [];
  return [{enrollmentId:enrollment.id,expression:enrollment.source.selection.expression.surfaceForm,meaning:enrollment.source.selection.semanticSpec.coreMeaningFocus,active:!pending.states.some(state=>state.id===descriptor.id&&state.status==='removed')}];
 });
 const fresh=(summary.items??[]).filter(item=>item.group==='new').sort((a,b)=>Number(b.started)-Number(a.started)||a.targetId.localeCompare(b.targetId));
 const readyIds=new Set(fresh.slice(0,summary.readyInitialCount).map(item=>item.targetId));
 const items=summary.items?.map(item=>item.group==='new'&&!readyIds.has(item.targetId)?{...item,group:item.started?'active' as const:'other' as const}:item);
 return {...summary,items,content,pendingDirect,policies:summary.policies as LearningPolicy[],pendingDirectCount:pendingDirect.filter(entry=>entry.active).length,dailyLimit:dailyLimit??null,policyOptions};
}
export async function readLearningBookPlans(context:SensaFormalPinnedLanguageContext):Promise<import('./learningReadModels').LearningBookPlanProjection[]>{
 const enrollments=await readLibrary(async tx=>(await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')).filter(enrollment=>enrollment.status==='active'&&enrollment.source.kind==='published_book'&&sameLearningSessionDirection(enrollment.languageContext,context)));
 const catalog=enrollments.some(enrollment=>enrollment.source.kind==='published_book'&&!enrollment.source.title)?await contentSupplySystem.read({kind:'catalog'}):[];
 return enrollments.flatMap(enrollment=>{
  const source=enrollment.source;if(source.kind!=='published_book')return [];
  return [{enrollmentId:enrollment.id,revision:enrollment.revision,title:source.title??catalog.find(item=>item.sha256===source.publicationArchiveSha256)?.book.title??null,bookVersionNumber:source.bookVersionNumber,memberCount:source.memberCount,mode:enrollment.bookPlan?.mode??'active',selection:structuredClone(enrollment.bookPlan?.range.selection??{kind:'all' as const})}];
 }).sort((left,right)=>(left.mode==='active'?0:1)-(right.mode==='active'?0:1)||(left.title??left.enrollmentId).localeCompare(right.title??right.enrollmentId));
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
  // Home needs counts and the next choice, not a decoded object for every
  // stored Target. Reuse the transactional scheduling indexes used by Study.
  return readLibrary(async tx=>{
    const activeId=await tx.get<string>('meta','learning-active');
    const activeRun=activeId?await tx.get<LocalLearningRun>('learningRuns',activeId):undefined;
    if(activeId&&(!activeRun||activeRun.id!==activeId))throw new Error('localFlow.resourceInvalid');
    const activity=await readActiveLearningSessionHeader(tx);
    if(activity&&activity.activeRunId!==activeId)throw new Error('localFlow.progressReadFailed');
    const dailyLimit=activity&&sameLearningSessionDirection(activity.languageContext,input.languageContext)
      ?activity.dailyNewSenseLimit:(await readStudyPlans(tx))[input.languageContext.languageRouteId]?.dailyNewSenseLimit;
    const query={languageContext:input.languageContext,clock:input.clock,dailyLimit,supportedPolicies:policyOptions.map(option=>option.id),currentTargetIds:[],retryTargetIds:[],includeTargetIds:false};
    const [summary,mixed,review]=await Promise.all([
      readLearningManagementSummary(query),
      readNextReadyRuntimeCandidate(tx,query,{run:null,intent:'mixed',retries:[]}),
      readNextReadyRuntimeCandidate(tx,query,{run:null,intent:'review_only',retries:[]}),
    ]);
    const nextTarget=mixed.nextTargetId?await tx.get<LocalLearningTarget>('learningTargets',mixed.nextTargetId):undefined;
    const currentId=activeRun?(activeRun.completedAt?activeRun.targetId:localProtocolActiveTargetId(localExecutionForRun(activeRun),activeRun)):mixed.nextTargetId;
    const currentTarget=currentId===nextTarget?.id?nextTarget:currentId?await tx.get<LocalLearningTarget>('learningTargets',currentId):undefined;
    if(currentId&&!currentTarget)throw new Error('localFlow.progressReadFailed');
    if(summary.libraryTargetCount===null||summary.routeTargetCount===null)throw new Error('localFlow.progressReadFailed');
    let hasLearningIntent=false;
    if(!summary.libraryTargetCount)for await(const keys of tx.recordKeyBatches('curriculumEnrollments')){hasLearningIntent=keys.length>0;break;}
    return {
      currentTask:currentTarget?{expression:currentTarget.expression,targetLanguageTag:currentTarget.targetLanguageTag,purpose:activeRun?.purpose??localLearningPurpose(currentTarget)}:null,
      activeRunId:activeRun?.id??null,activeLanguageContext:activeRun?.languageContext??null,
      hasLibraryContent:summary.libraryTargetCount>0||hasLearningIntent,routeTargetCount:summary.routeTargetCount,
      nextReviewAt:summary.nextReviewAt===null?null:new Date(summary.nextReviewAt).toISOString(),dailyLimit:dailyLimit??null,
      readyInitialCount:summary.readyInitialCount,reviewDueCount:summary.reviewDueCount,
      mixedReadyCount:summary.readyInitialCount+summary.reviewDueCount,
      nextTargetId:activeRun?.targetId??mixed.nextTargetId,nextReviewTargetId:review.nextTargetId,
      nextChangeAt:mixed.nextChangeAt,
      nextTargetPolicy:nextTarget?(nextTarget.committedPolicy?.profileId??nextTarget.policyAssignment.profileId):null,
      policyOptions,
    };
  });
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

export async function readLearningSemanticMemoryProjection(targetId?:string): Promise<LearningSemanticMemoryProjection> {
  return readLearningSemanticMemoryRecords(targetId);
}

export const currentLearningPolicyOptions = () => policyOptions;

export const removeRetryTarget = (
  retries: readonly InterleavedLearningRetry[],
  targetId: string,
) => retries.filter((retry) => retry.id !== targetId);

export type { InterleavedLearningRetry } from './learningPlanning';

export async function readLearningScheduleProjection(query:Extract<import('./learningSystem').LearningQuery,{kind:'schedule'}>):Promise<import('./learningScheduleModel').LearningScheduleProjection>{
 return readLibrary(async tx=>{
  const page=await readLearningSchedulePage({languageContext:query.languageContext,clock:query.clock,days:query.days,kind:query.recordKind,day:query.day,offset:query.offset,limit:20,supportedPolicies:policyOptions.map(option=>option.id)});
  const targets=await Promise.all(page.targets.map(async row=>{const target=await tx.get<LocalLearningTarget>('learningTargets',row.targetId);if(!target)throw Error('localFlow.progressReadFailed');return {...row,expression:target.expression};}));
  return {...page,targets,version:JSON.stringify([await readLocalLibraryRevision(tx),await tx.get('meta','identity'),await tx.get('meta','local-incarnation'),Intl.DateTimeFormat().resolvedOptions().timeZone])};
 });
}
