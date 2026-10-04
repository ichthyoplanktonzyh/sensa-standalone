import type { LanguageMatrixCase } from './languageMatrixFixtures';
import type { AgentTraceEvent } from '../../../apps/web/src/observability/agentTrace';

export type BusinessStageName =
  | 'session'
  | 'account_route'
  | 'clarification'
  | 'semantic_confirmation'
  | 'content_generation'
  | 'dictionary_lookup'
  | 'learning_runtime'
  | 'progress_persistence';

export type BusinessStageUpdate = {
  stage: BusinessStageName;
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  durationMs?: number;
  errorCode?: string;
  evidence?: Record<string, string | number | boolean | null>;
};

export type BusinessCaseReceipt = {
  /** Private in-memory handles used only for the post-reload persistence read. */
  personalMeaningId: string;
  learningTaskId: string;
  learningTargetId: string;
  alignmentId: string;
  routeId: string;
  memoryRevision: number;
};

export type BusinessRawStageEvent = {
  version: 1;
  kind: 'business_result';
  stage: 'dictionary_lookup';
  occurredAt: string;
  payload: unknown;
};

type BrowserBusinessSurface = typeof globalThis & {
  __sensaBusinessStageSink?: (update: BusinessStageUpdate) => Promise<void>;
  __sensaBusinessRawStageSink?: (event: BusinessRawStageEvent) => Promise<void>;
  __sensaBusinessMockMode?: boolean;
  __sensaBusinessObservationFailed?: boolean;
};

/**
 * Runs the production business seams in the real Chromium origin. This
 * function is serialized into the page by Playwright, so all imports are Vite
 * URLs and all persistence/network work is performed by the application code.
 */
export async function runBusinessCaseInPage(item: LanguageMatrixCase): Promise<BusinessCaseReceipt> {
  // Playwright serializes this function into the page; runtime helpers must be
  // defined inside it rather than captured from the test module.
  const safeFailureCode = (error: unknown): string => {
    const message = error instanceof Error ? error.message : '';
    if (/^account_route_(open_library|add_route|activate_route|read_route)_(business_stage_failed|timeout|localFlow\.[A-Za-z]+)$/u.test(message)) return message;
    if (/timeout|timed out/iu.test(error instanceof Error ? error.name + message : '')) return 'timeout';
    const allowed = new Set([
      'localFlow.authUnavailable', 'localFlow.languageRouteChanged', 'localFlow.noActiveLanguageRoute',
      'localFlow.onlineLogin', 'localFlow.modelUnavailable', 'localFlow.requestTimeout',
      'localFlow.providerAccessDenied',
      'localFlow.resourceInvalid', 'localFlow.validationRejected', 'localFlow.spokenResourceUnavailable',
      'localFlow.storageOpen', 'localFlow.storageUnsupported',
      'expression_language_mismatch', 'expression_surface_mismatch',
    ]);
    return allowed.has(message) ? message : 'business_stage_failed';
  };
  const load = async <T,>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
  const [trace, library, language, journey, agentModule, semantic, providers, personalLearning, learning, quickDict] = await Promise.all([
    load<typeof import('../../../apps/web/src/observability/agentTrace')>('/src/observability/agentTrace.ts'),
    load<typeof import('../../../apps/web/src/data/library/store')>('/src/data/library/store.ts'),
    load<typeof import('../../../apps/web/src/data/library/language')>('/src/data/library/language.ts'),
    load<typeof import('../../../apps/web/src/experience/personalMeaningJourney/gateway')>('/src/experience/personalMeaningJourney/gateway.ts'),
    load<typeof import('../../../apps/web/src/experience/personalMeaningJourney/realSemanticAgent')>('/src/experience/personalMeaningJourney/realSemanticAgent.ts'),
    load<typeof import('../../../apps/web/src/experience/personalMeaningJourney/semanticAgent')>('/src/experience/personalMeaningJourney/semanticAgent.ts'),
    load<typeof import('../../../apps/web/src/data/library/providers')>('/src/data/library/providers.ts'),
    load<typeof import('../../../apps/web/src/data/library/personalLearning')>('/src/data/library/personalLearning.ts'),
    load<typeof import('../../../apps/web/src/data/library/learning')>('/src/data/library/learning.ts'),
    load<typeof import('../../../apps/web/src/experience/services/quickDict')>('/src/experience/services/quickDict.ts'),
  ]);
  const surface = globalThis as BrowserBusinessSurface;
  const observeStage = async (update: BusinessStageUpdate) => {
    try { await surface.__sensaBusinessStageSink?.(update); }
    catch { surface.__sensaBusinessObservationFailed = true; }
  };
  trace.beginAgentBusinessTrace();
  const operationId = () => crypto.randomUUID();

  const stage = async <T,>(name: BusinessStageName, work: () => Promise<T>, evidence?: (value: T) => BusinessStageUpdate['evidence']): Promise<T> => {
    const started = Date.now();
    const base: BusinessStageUpdate = { stage: name, status: 'running', startedAt: new Date(started).toISOString() };
    await observeStage(base);
    try {
      const value = await work();
      await observeStage({ ...base, status: 'passed', durationMs: Date.now() - started, ...(evidence?.(value) ? { evidence: evidence(value) } : {}) });
      return value;
    } catch (error) {
      await observeStage({ ...base, status: 'failed', durationMs: Date.now() - started, errorCode: safeFailureCode(error) });
      throw error;
    }
  };

  await stage('account_route', async () => {
    let step = 'open_library';
    try {
      await library.openLibrary();
      step = 'add_route';
      const route = await language.addLanguageRoute(operationId(), item.targetLanguageTag, item.supportLanguageTag);
      step = 'activate_route';
      await language.setActiveLanguageRoute(operationId(), route.id);
      step = 'read_route';
      const pinned = await language.activeLanguageContextSnapshot();
      if (pinned.targetLanguageTag !== item.targetLanguageTag || pinned.supportLanguageTag !== item.supportLanguageTag) {
        throw new Error('localFlow.languageRouteChanged');
      }
      return route;
    } catch (error) {
      throw new Error(`account_route_${step}_${safeFailureCode(error)}`);
    }
  });

  const routeContext = await language.activeLanguageContextSnapshot();
  const gateway = journey.journeyGateway;
  const draft = await gateway.createClarificationDraft({
    operationId: operationId(),
    familiarExpression: { surfaceForm: item.fixture.expression },
    blocks: [
      { kind: 'text', bodyText: item.fixture.sentence },
      { kind: 'text', bodyText: item.supportFixture.context },
    ],
    startingPoint: 'from_experience',
  });
  const clarification = await stage('clarification', async () => {
    const {worldReadRepository}=await import('../../../apps/web/src/experience/personalMeaningJourney/worldRepository');
    const captured=await worldReadRepository.detail(draft.intakeId),storedDraft=captured.draft,source=captured.source;
    if (!storedDraft||!source) throw new Error('localFlow.resourceInvalid');
    const material = {
      blocks: storedDraft.materialBlocks.map((block, index) => ({
        blockId: `business-material-${index}`,
        kind: block.kind,
        bodyText: block.bodyText ?? null,
        mediaDataUrl: null,
        mediaMimeType: null,
      })),
      familiarExpression: storedDraft.familiarExpression,
      startingPoint: storedDraft.startingPoint,
    };
    const message = (role: 'learner' | 'assistant', body: string) => ({
      messageId: operationId(), role, body, occurredAt: new Date().toISOString(),
    });
    const learnerText = `${item.fixture.sentence}\n\n${item.supportFixture.context}`;
    const messages = [message('learner', learnerText)];
    const realAgent = agentModule.createRealSemanticAgent();
    let workingSet = semantic.emptyWorkingSet();
    let readyToConfirm = false;
    let provenance: import('../../../apps/web/src/experience/personalMeaningJourney/semanticLlm').SemanticLlmProvenance | null = null;
    for (let turn = 0; turn < 3; turn += 1) {
      if (turn > 0) messages.push(message('learner', item.supportFixture.clarification));
      const result = await realAgent.turn({
        material,
        messages,
        workingSet,
        readyToConfirm,
        learnerEditedTracks: [],
        focusLocked: false,
        languages: routeContext,
        signal: AbortSignal.timeout(150_000),
      });
      messages.push(message('assistant', result.assistantMessage));
      workingSet = result.workingSet;
      readyToConfirm = result.readyToConfirm;
      provenance = result.provenance;
      if (readyToConfirm) break;
    }
    const expression = workingSet.expression;
    const sense = workingSet.sense;
    const context = workingSet.context;
    if (!readyToConfirm || !expression || !sense || !context || !provenance) throw new Error('localFlow.modelUnavailable');
    if (expression.languageTag !== item.targetLanguageTag) throw new Error('expression_language_mismatch');
    const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
    const selectedSurface = normalize(expression.surfaceForm);
    const familiarSurface = normalize(item.fixture.expression);
    if (!selectedSurface.includes(familiarSurface)) throw new Error('expression_surface_mismatch');
    return { messages, workingSet, provenance,source, expressionExactMatch: selectedSurface === familiarSurface };
  }, value => ({ expressionLanguageVerified: value.workingSet.expression?.languageTag === item.targetLanguageTag,
    expressionExactMatch: value.expressionExactMatch }));

  const confirmation = await stage('semantic_confirmation', async () => {
    const { context, focus, sense, expression, expressions } = clarification.workingSet;
    if (!context || !sense || !expression) throw new Error('localFlow.resourceInvalid');
    const completedContext = {
      modality: 'text' as const,
      textSegment: context.summary,
      mediaReferenceIds: [],
      languageTag: routeContext.supportLanguageTag,
      source: { client: 'sensa-web', url: null, title: 'Language matrix business acceptance', sourceReferenceId: draft.intakeId, domSelector: null, paragraphContext: null },
    };
    const result = await gateway.completeClarificationDraft({
      operationId: operationId(),
      intakeId: draft.intakeId,
      source:clarification.source,
      context: completedContext,
      languageContext: routeContext,
      focus: focus ? { statement: focus.statement, distinguishingNotes: focus.distinguishingNotes, aspectLabel: focus.aspectLabel } : null,
      sense: {
        proposedSenseKey: sense.proposedSenseKey,
        coreMeaningFocus: sense.coreMeaningFocus,
        prototypeScenes: sense.prototypeScenes,
        includedCases: sense.includedCases,
        excludedCases: sense.excludedCases,
        neighborContrasts: sense.neighborContrasts,
        openQuestions: sense.openQuestions,
        unresolvedQuestions: sense.unresolvedQuestions,
      },
      expression: {
        surfaceForm: expression.surfaceForm,
        expressionType: expression.expressionType,
        languageTag: expression.languageTag,
        relation: expression.relation,
        semanticCoverage: expression.semanticCoverage,
      },
      expressionCandidates: (expressions?.length ? expressions : [expression]).map(candidate => ({
        surfaceForm: candidate.surfaceForm,
        expressionType: candidate.expressionType,
        languageTag: candidate.languageTag,
        relation: candidate.relation,
        semanticCoverage: candidate.semanticCoverage,
      })),
      confirmExpression: true,
      transcript: clarification.messages,
      provenance: clarification.provenance,
      semanticPolicyVersion: 'sensa-semantic-policy-react-v1',
    });
    const source = gateway.getLearningSources(result.personalMeaningId, result.personalMeaningAlignmentId)[0];
    if (!source || source.expression.surfaceForm !== expression.surfaceForm) throw new Error('localFlow.resourceInvalid');
    return { result, source };
  });

  const learningTask = await stage('content_generation', async () => {
    const task = await personalLearning.enrollPersonal(operationId(), confirmation.source, routeContext, true);
    const reviewProvider = await providers.selectedReviewProvider();
    await personalLearning.preparePersonal(
      task.id,
      confirmation.source,
      providers.defaultSensaProvider,
      reviewProvider,
      AbortSignal.timeout(300_000),
      () => undefined,
    );
    const savedTask = (await personalLearning.personalLearningSnapshot()).find(item => item.id === task.id);
    const learningState = await learning.readLearning();
    const savedTarget = learningState.targets.find(item => item.id === task.targetId);
    if (savedTask?.status !== 'ready' || !savedTarget) throw new Error('localFlow.validationRejected');
    const membership = savedTarget.curriculumMemberships.find(item => item.id === task.curriculumMembershipId);
    const realization = membership?.material.content.resources.find(item => item.materialRoleKey === 'scene_realization');
    const payload = realization?.contentPayload as { example?: unknown; targetStart?: unknown; targetEnd?: unknown } | undefined;
    if (typeof payload?.example !== 'string' || !Number.isInteger(payload.targetStart) || !Number.isInteger(payload.targetEnd)) throw new Error('localFlow.resourceInvalid');
    return { taskId: task.id, targetId: task.targetId, membershipId: task.curriculumMembershipId, resourceKey: realization!.resourceKey, example: payload.example, start: payload.targetStart as number, end: payload.targetEnd as number, reviewStatus: reviewProvider ? 'enabled' as const : 'skipped_policy_disabled' as const };
  }, value => ({ reviewStatus: value.reviewStatus }));

  await stage('dictionary_lookup', async () => {
    const clickedForm = item.fixture.expression;
    const clickedStart = item.fixture.sentence.indexOf(clickedForm);
    if (!clickedForm.trim() || clickedStart < 0) throw new Error('localFlow.resourceInvalid');
    const result = await quickDict.lookupDictionary({
      rawClickedForm: clickedForm,
      clickedSurface: clickedForm,
      clickedStart,
      clickedEnd: clickedStart + clickedForm.length,
      exampleId: learningTask.resourceKey,
      textL2: item.fixture.sentence,
    }, { signal: AbortSignal.timeout(45_000) });
    if (!result.referenceResult || !result.entry || result.entry.senses.length === 0) throw new Error('localFlow.modelUnavailable');
    if (result.referenceResult.release.targetLanguage !== item.targetLanguageTag
      || result.referenceResult.release.learnerLocale !== item.supportLanguageTag) {
      throw new Error('localFlow.resourceInvalid');
    }
    try {
      await surface.__sensaBusinessRawStageSink?.({version: 1, kind: 'business_result', stage: 'dictionary_lookup',
        occurredAt: new Date().toISOString(), payload: {entry: result.entry, referenceResult: result.referenceResult}});
    } catch { surface.__sensaBusinessObservationFailed = true; }
    return { senseCount: result.entry.senses.length,
      supportGlossAvailable: Boolean(result.referenceResult.contextualResolution?.glossL1?.trim()),
      contextualStatus: result.referenceResult.contextualResolution?.status ?? 'unresolved' };
  }, result => ({ senseCount: result.senseCount, supportGlossAvailable: result.supportGlossAvailable,
    contextualStatus: result.contextualStatus }));

  const progress = await stage('learning_runtime', async () => {
    await learning.confirmLearningQuantity(operationId(), routeContext, 20);
    let run = await learning.startLearning(operationId(), learningTask.targetId, routeContext, 20);
    run = await learning.actLearning(operationId(), run.id, run.revision, { kind: 'reveal' });
    run = await learning.actLearning(operationId(), run.id, run.revision, { kind: 'rate', rating: 'good' });
    const target = (await learning.readLearning()).targets.find(item => item.id === learningTask.targetId);
    if (!target || target.memoryRevision < 1) throw new Error('localFlow.validationRejected');
    return target.memoryRevision;
  }, memoryRevision => ({ memoryRevision }));

  if (surface.__sensaBusinessObservationFailed) throw new Error('agent_observation_incomplete');

  return {
    personalMeaningId: confirmation.result.personalMeaningId,
    learningTaskId: learningTask.taskId,
    learningTargetId: learningTask.targetId,
    alignmentId: confirmation.result.personalMeaningAlignmentId,
    routeId: routeContext.languageRouteId,
    memoryRevision: progress,
  };
}

/** Called after a real browser reload; IDs are transient test handles only. */
export async function readBusinessCaseAfterReloadInPage(receipt: BusinessCaseReceipt) {
  const load = async <T,>(path: string): Promise<T> => import(/* @vite-ignore */ path) as Promise<T>;
  const [library, personalLearning, learning] = await Promise.all([
    load<typeof import('../../../apps/web/src/data/library/store')>('/src/data/library/store.ts'),
    load<typeof import('../../../apps/web/src/data/library/personalLearning')>('/src/data/library/personalLearning.ts'),
    load<typeof import('../../../apps/web/src/data/library/learning')>('/src/data/library/learning.ts'),
  ]);
  await library.openLibrary();
  const task = (await personalLearning.personalLearningSnapshot()).find(item => item.id === receipt.learningTaskId);
  const target = (await learning.readLearning()).targets.find(item => item.id === receipt.learningTargetId);
  return {
    taskReady: task?.status === 'ready',
    targetPersisted: Boolean(target),
    routePersisted: target?.curriculumMemberships.some(membership => membership.languageContext.languageRouteId === receipt.routeId) ?? false,
    memoryRevision: target?.memoryRevision ?? 0,
    learningProgressPersisted: Boolean(target && target.memoryRevision >= receipt.memoryRevision && receipt.memoryRevision > 0),
  };
}

/** Re-export keeps the harness contract compile-checked alongside the spec. */
export type { AgentTraceEvent };
