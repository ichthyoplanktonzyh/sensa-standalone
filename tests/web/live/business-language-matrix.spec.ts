/** Real provider acceptance through the production business commands, without UI interaction. */
import {test, expect, type Page} from '@playwright/test';
import {appendFile, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {AgentRawTraceEvent, AgentTraceEvent} from '../../../apps/web/src/observability/agentTrace';
import {extractBusinessLanguageEvidence} from './languageTraceEvidence';
import {languageMatrixCases, type LanguageMatrixCase} from './languageMatrixFixtures';
import {
  readBusinessCaseAfterReloadInPage,
  runBusinessCaseInPage,
  type BusinessStageName,
  type BusinessStageUpdate,
  type BusinessRawStageEvent,
} from './businessHarness';

const enabled = process.env.SENSA_LIVE_ACCEPTANCE === '1';
const webUrl = process.env.SENSA_LIVE_WEB_URL;
const serviceUrl = process.env.SENSA_LIVE_SERVICE_URL;
const reportDirectory = process.env.SENSA_LIVE_REPORT_DIR;
const filter = process.env.SENSA_LIVE_CASE_FILTER;
const startIndex = Number(process.env.SENSA_LIVE_CASE_START ?? '0');
const limit = process.env.SENSA_LIVE_CASE_LIMIT;
const stageNames = new Set<BusinessStageName>([
  'session', 'account_route', 'clarification', 'semantic_confirmation', 'content_generation',
  'dictionary_lookup', 'learning_runtime', 'progress_persistence',
]);

test.skip(!enabled, 'Real providers are enabled only by the isolated live runner.');
test.setTimeout(15 * 60 * 1000);
// There is no visual assertion. Browser traces can retain model and learner text.
test.use({trace: 'off', screenshot: 'off', locale: 'en-US'});

if (limit !== undefined && (!/^\d+$/u.test(limit) || Number(limit) < 1 || Number(limit) > 324)) {
  throw new Error('SENSA_LIVE_CASE_LIMIT must be an integer from 1 to 324.');
}
if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 323) {
  throw new Error('SENSA_LIVE_CASE_START must be an integer from 0 to 323.');
}
const selected = languageMatrixCases
  .filter(item => !filter || `${item.targetLanguageTag}--${item.supportLanguageTag}` === filter)
  .slice(filter ? 0 : startIndex, filter ? undefined : limit === undefined ? undefined : startIndex + Number(limit));
if (enabled && (!webUrl || !serviceUrl || !reportDirectory || selected.length === 0)) {
  throw new Error('The isolated live runner must provide an origin, service, report directory, and selected case.');
}

type StageRecord = {
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  durationMs?: number;
  error?: string;
  evidence?: Record<string, string | number | boolean | null>;
};
type ObservedRequest = {category: 'model' | 'reference' | 'speech'; status?: number; durationMs?: number};
type ObservedSocket = {origin: 'wss://speech.platform.bing.com'; receivedFrames: number; receivedBytes: number};
type SpeechRawEvent = {version: 1; kind: 'speech_request'; occurredAt: string;
  payload: {surface: string; languageTag: string; voice: string; locale: string}};
type Report = {
  schemaVersion: 1;
  caseKey: string;
  targetLanguageTag: string;
  supportLanguageTag: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'passed' | 'failed';
  stages: Partial<Record<BusinessStageName, StageRecord>>;
  agentEvents: AgentTraceEvent[];
  rawTraceFile: string;
  rawTraceEvents: number;
  languageEvidenceFile: string;
  requests: ObservedRequest[];
  websockets: ObservedSocket[];
  failure?: string;
};

function caseKey(item: LanguageMatrixCase): string {
  return `business-${item.targetLanguageTag}--${item.supportLanguageTag}`;
}

function safeFailure(error: unknown): string {
  const allowed = new Set([
    'synthetic_session_unavailable', 'synthetic_account_bootstrap_failed',
    'persistence_readback_failed', 'agent_observation_incomplete', 'business_stage_failed',
    'model_request_unobserved', 'tts_audio_unobserved', 'raw_trace_size_limit', 'raw_trace_write_failed',
  ]);
  if (error instanceof Error && allowed.has(error.message)) return error.message;
  if (error instanceof Error && /timeout|timed out/iu.test(`${error.name} ${error.message}`)) return 'timeout';
  if (error instanceof Error && /network|fetch failed|ECONN/iu.test(`${error.name} ${error.message}`)) return 'network_failure';
  return 'case_failed';
}

function allowedAgentEvent(input: AgentTraceEvent): AgentTraceEvent | null {
  if (!input || !['clarification', 'content_generation'].includes(input.agent)
    || !['run_started', 'model_completed', 'tool_completed', 'validation_completed', 'retry_decided', 'run_finished'].includes(input.event)) return null;
  return {
    version: 1,
    businessTraceId: input.businessTraceId,
    agentRunId: input.agentRunId,
    agent: input.agent,
    event: input.event,
    occurredAt: input.occurredAt,
    elapsedMs: input.elapsedMs,
    round: input.round,
    targetLanguageTag: input.targetLanguageTag,
    supportLanguageTag: input.supportLanguageTag,
    promptVersion: input.promptVersion,
    ...(input.status ? {status: input.status} : {}),
    ...(input.reason ? {reason: input.reason} : {}),
    ...(input.tool ? {tool: input.tool} : {}),
    ...(typeof input.durationMs === 'number' ? {durationMs: input.durationMs} : {}),
    ...(typeof input.accepted === 'boolean' ? {accepted: input.accepted} : {}),
    ...(typeof input.issueCount === 'number' ? {issueCount: input.issueCount} : {}),
    ...(input.providerKind ? {providerKind: input.providerKind} : {}),
    ...(input.execution ? {execution: input.execution} : {}),
    ...(input.model ? {model: input.model} : {}),
    ...(input.modelExecutionId ? {modelExecutionId: input.modelExecutionId} : {}),
    ...(input.genkitTraceId ? {genkitTraceId: input.genkitTraceId} : {}),
    ...(typeof input.inputTokens === 'number' ? {inputTokens: input.inputTokens} : {}),
    ...(typeof input.outputTokens === 'number' ? {outputTokens: input.outputTokens} : {}),
  };
}

function allowedStage(input: BusinessStageUpdate): [BusinessStageName, StageRecord] | null {
  if (!input || !stageNames.has(input.stage) || !['running', 'passed', 'failed'].includes(input.status)) return null;
  const evidence: Record<string, string | number | boolean | null> = {};
  for (const key of ['expressionLanguageVerified', 'expressionExactMatch', 'reviewStatus', 'senseCount', 'supportGlossAvailable', 'contextualStatus', 'memoryRevision'] as const) {
    const value = input.evidence?.[key];
    if (value !== undefined && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
      || key === 'reviewStatus' && (value === 'enabled' || value === 'skipped_policy_disabled')
      || key === 'contextualStatus' && ['authored_target', 'reviewed', 'model_confident', 'ambiguous', 'unresolved'].includes(String(value)))) evidence[key] = value;
  }
  return [input.stage, {
    status: input.status,
    startedAt: input.startedAt,
    ...(typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? {durationMs: input.durationMs} : {}),
    ...(input.errorCode ? {error: /^[A-Za-z0-9._-]{1,80}$/u.test(input.errorCode) ? input.errorCode : 'business_stage_failed'} : {}),
    ...(Object.keys(evidence).length ? {evidence} : {}),
  }];
}

async function save(report: Report): Promise<void> {
  const directory = resolve(reportDirectory!);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const destination = resolve(directory, `${report.caseKey}.json`);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, destination);
}

function observeNetwork(page: Page, report: Report, appendRawTrace: (event: SpeechRawEvent) => Promise<void>): void {
  const records = new WeakMap<object, {record: ObservedRequest; started: number}>();
  page.on('request', request => {
    const url = new URL(request.url());
    const category = url.pathname.endsWith('/chat/completions') || url.pathname.includes('/sensa/model/turn')
      ? 'model' : ['api.wiktapi.dev', 'api.dictionaryapi.dev', 'en.wiktionary.org'].includes(url.hostname)
        || url.pathname.includes('/sensa/reference') ? 'reference'
          : url.pathname === '/sensa/speech/edge-tts' ? 'speech' : null;
    if (!category) return;
    const record: ObservedRequest = {category};
    report.requests.push(record);
    records.set(request, {record, started: Date.now()});
    if (category === 'speech') {
      try {
        const body: unknown = request.postDataJSON();
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const input = body as Record<string, unknown>;
          if (typeof input.surface === 'string' && input.surface.length <= 500
            && ['languageTag', 'voice', 'locale'].every(key => typeof input[key] === 'string' && (input[key] as string).length <= 80)) {
            void appendRawTrace({version: 1, kind: 'speech_request', occurredAt: new Date().toISOString(),
              payload: {surface: input.surface, languageTag: input.languageTag as string,
                voice: input.voice as string, locale: input.locale as string}});
          }
        }
      } catch { /* The request is still recorded as speech metadata. */ }
    }
  });
  page.on('response', response => {
    const observed = records.get(response.request());
    if (!observed) return;
    observed.record.status = response.status();
    observed.record.durationMs = Date.now() - observed.started;
  });
  page.on('websocket', socket => {
    const url = new URL(socket.url());
    if (url.hostname !== 'speech.platform.bing.com') return;
    const observed: ObservedSocket = {origin: 'wss://speech.platform.bing.com', receivedFrames: 0, receivedBytes: 0};
    report.websockets.push(observed);
    socket.on('framereceived', ({payload}) => {
      observed.receivedFrames += 1;
      observed.receivedBytes += typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength;
    });
  });
}

function hasCompleteAgentTrace(report: Report): boolean {
  const traceIds = new Set<string>();
  for (const agent of ['clarification', 'content_generation'] as const) {
    const events = report.agentEvents.filter(event => event.agent === agent);
    const runs = new Set(events.map(event => event.agentRunId));
    const complete = [...runs].some(id => {
      const run = events.filter(event => event.agentRunId === id);
      if (!run.some(event => event.event === 'run_started') || !run.some(event => event.event === 'model_completed')
        || !run.some(event => event.event === 'run_finished' && event.status === 'succeeded')) return false;
      for (const event of run) traceIds.add(event.businessTraceId);
      return true;
    });
    if (!complete) return false;
  }
  return traceIds.size === 1;
}

test.describe('live business language matrix', () => {
  for (const item of selected) {
    test(`${item.targetLanguageTag} → ${item.supportLanguageTag}`, async ({page}) => {
      const started = Date.now();
      const report: Report = {
        schemaVersion: 1, caseKey: caseKey(item), targetLanguageTag: item.targetLanguageTag,
        supportLanguageTag: item.supportLanguageTag, startedAt: new Date(started).toISOString(),
        status: 'running', stages: {}, agentEvents: [], rawTraceFile: `raw-${caseKey(item)}.jsonl`, rawTraceEvents: 0,
        languageEvidenceFile: `evidence-${caseKey(item)}.json`,
        requests: [], websockets: [],
      };
      const rawTracePath = resolve(reportDirectory!, report.rawTraceFile);
      await mkdir(resolve(reportDirectory!), {recursive: true, mode: 0o700});
      await writeFile(rawTracePath, '', {mode: 0o600});
      let rawTraceBytes = 0;
      let rawTraceFailure: string | null = null;
      let rawWrite = Promise.resolve();
      const appendRawTrace = async (event: AgentRawTraceEvent | BusinessRawStageEvent | SpeechRawEvent) => {
        if (rawTraceFailure) return;
        const line = `${JSON.stringify(event)}\n`;
        rawTraceBytes += Buffer.byteLength(line);
        if (rawTraceBytes > 16 * 1024 * 1024) { rawTraceFailure = 'raw_trace_size_limit'; return; }
        rawWrite = rawWrite.then(() => appendFile(rawTracePath, line)).catch(() => { rawTraceFailure = 'raw_trace_write_failed'; });
        await rawWrite;
        if (!rawTraceFailure) report.rawTraceEvents += 1;
      };
      await save(report);
      observeNetwork(page, report, appendRawTrace);
      try {
        const sessionStarted = Date.now();
        report.stages.session = {status: 'running', startedAt: new Date(sessionStarted).toISOString()};
        await save(report);
        const sessionResponse = await fetch(`${serviceUrl}/__sensa_local/session?case=${encodeURIComponent(report.caseKey)}`);
        if (!sessionResponse.ok) throw new Error('synthetic_session_unavailable');
        const session: {access_token?: unknown} = await sessionResponse.json();
        if (typeof session.access_token !== 'string') throw new Error('synthetic_session_unavailable');
        const bootstrap = await fetch(`${serviceUrl}/sensa/web/access/session`, {
          method: 'POST',
          headers: {'content-type': 'application/json', authorization: `Bearer ${session.access_token}`},
          body: JSON.stringify({installationId: crypto.randomUUID()}),
        });
        if (!bootstrap.ok) throw new Error('synthetic_account_bootstrap_failed');
        report.stages.session = {status: 'passed', startedAt: new Date(sessionStarted).toISOString(), durationMs: Date.now() - sessionStarted};
        await save(report);
        const authKey = `sb-${new URL(serviceUrl!).hostname.split('.')[0]}-auth-token`;
        await page.exposeBinding('__sensaBusinessStageBridge', async (_source, update: BusinessStageUpdate, events: AgentTraceEvent[]) => {
          const stage = allowedStage(update);
          if (stage) report.stages[stage[0]] = stage[1];
          report.agentEvents = events.map(allowedAgentEvent).filter((event): event is AgentTraceEvent => event !== null);
          await save(report);
        });
        await page.exposeBinding('__sensaBusinessRawTraceBridge', async (_source, event: AgentRawTraceEvent | BusinessRawStageEvent) => {
          await appendRawTrace(event);
        });
        await page.addInitScript(({origin, key, value}) => {
          if (location.origin !== origin) return;
          localStorage.setItem(key, JSON.stringify(value));
          localStorage.setItem('sensa:local-bootstrap:v1', 'complete');
          type Surface = typeof globalThis & {
            __sensaAgentTraceSink?: (event: AgentTraceEvent) => void;
            __sensaAgentRawTraceSink?: (event: AgentRawTraceEvent) => Promise<void>;
            __sensaBusinessRawTraceBridge?: (event: AgentRawTraceEvent | BusinessRawStageEvent) => Promise<void>;
            __sensaBusinessRawStageSink?: (event: BusinessRawStageEvent) => Promise<void>;
            __sensaBusinessStageSink?: (update: BusinessStageUpdate) => Promise<void>;
            __sensaBusinessStageBridge?: (update: BusinessStageUpdate, events: AgentTraceEvent[]) => Promise<void>;
          };
          const surface = globalThis as Surface;
          const events: AgentTraceEvent[] = [];
          surface.__sensaAgentTraceSink = event => {events.push(event);};
          surface.__sensaAgentRawTraceSink = event => surface.__sensaBusinessRawTraceBridge!(event);
          surface.__sensaBusinessRawStageSink = event => surface.__sensaBusinessRawTraceBridge!(event);
          surface.__sensaBusinessStageSink = update => surface.__sensaBusinessStageBridge!(update, events);
        }, {origin: new URL(webUrl!).origin, key: authKey, value: session});
        await page.goto(webUrl!, {waitUntil: 'domcontentloaded'});
        const receipt = await page.evaluate(runBusinessCaseInPage, item);
        const persistStarted = Date.now();
        report.stages.progress_persistence = {status: 'running', startedAt: new Date(persistStarted).toISOString()};
        await save(report);
        await page.reload({waitUntil: 'domcontentloaded'});
        const persisted = await page.evaluate(readBusinessCaseAfterReloadInPage, receipt);
        const persistencePassed = persisted.taskReady && persisted.targetPersisted && persisted.routePersisted
          && persisted.learningProgressPersisted;
        report.stages.progress_persistence = {
          status: persistencePassed ? 'passed' : 'failed',
          startedAt: new Date(persistStarted).toISOString(), durationMs: Date.now() - persistStarted,
          evidence: {memoryRevision: persisted.memoryRevision},
          ...(!persistencePassed ? {error: 'persistence_readback_failed'} : {}),
        };
        await save(report);
        if (!persistencePassed) throw new Error('persistence_readback_failed');
        if (!hasCompleteAgentTrace(report)) throw new Error('agent_observation_incomplete');
        if (rawTraceFailure || report.rawTraceEvents === 0) throw new Error(rawTraceFailure ?? 'agent_observation_incomplete');
        if (Object.values(report.stages).some(stage => stage?.status !== 'passed')) throw new Error('business_stage_failed');
        if (!report.requests.some(request => request.category === 'model' && request.status === 200)) throw new Error('model_request_unobserved');
        if (!report.requests.some(request => request.category === 'speech' && request.status === 200)
          && !report.websockets.some(socket => socket.receivedBytes > 100)) throw new Error('tts_audio_unobserved');
        report.status = 'passed';
      } catch (error) {
        report.status = 'failed';
        report.failure = safeFailure(error);
        for (const stage of Object.values(report.stages)) {
          if (stage?.status === 'running') {
            stage.status = 'failed';
            stage.error = report.failure;
            stage.durationMs = Date.now() - Date.parse(stage.startedAt);
          }
        }
        await save(report);
        throw new Error(`Business acceptance failed: ${report.failure}; report=${report.caseKey}`);
      } finally {
        await rawWrite;
        const rawLines = (await readFile(rawTracePath, 'utf8')).split(/\r?\n/u).filter(Boolean);
        const rawEvents = rawLines.map(line => JSON.parse(line));
        const evidence = extractBusinessLanguageEvidence(report.caseKey, item.targetLanguageTag, item.supportLanguageTag, rawEvents);
        await writeFile(resolve(reportDirectory!, report.languageEvidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, {mode: 0o600});
        report.finishedAt = new Date().toISOString();
        report.durationMs = Date.now() - started;
        await save(report);
      }
      expect(report.status).toBe('passed');
    });
  }
});
