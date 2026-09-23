import type {ModelExecutionRecord} from '@sensa/contracts/sensa';

/** Ephemeral, content-free decisions from the two Web-owned Agent loops. */
export type AgentKind = 'clarification' | 'content_generation';
export type AgentTraceEvent = Readonly<{
  version: 1;
  businessTraceId: string;
  agentRunId: string;
  agent: AgentKind;
  event: 'run_started' | 'model_completed' | 'tool_completed' | 'validation_completed' | 'retry_decided' | 'run_finished';
  occurredAt: string;
  elapsedMs: number;
  durationMs?: number;
  round: number;
  targetLanguageTag: string;
  supportLanguageTag: string;
  promptVersion: string;
  status?: 'succeeded' | 'failed' | 'cancelled';
  reason?: string;
  tool?: 'lookup_meanings' | 'organize_answer' | 'reply_to_learner' | 'prepare_pronunciation' | 'lookup_references' | 'submit_resources' | 'validate_resources' | 'unknown';
  accepted?: boolean;
  issueCount?: number;
  providerKind?: 'sensa' | 'compatible';
  execution?: 'device' | 'service';
  model?: string;
  modelExecutionId?: string;
  genkitTraceId?: string;
  inputTokens?: number;
  outputTokens?: number;
}>;

/** Full synthetic-test payload. The production metadata sink never receives it. */
export type AgentRawTraceEvent = Readonly<{
  version: 1;
  businessTraceId: string;
  agentRunId: string;
  agent: AgentKind;
  kind: 'model_request' | 'model_response' | 'tool_response' | 'agent_result';
  round: number;
  occurredAt: string;
  payload: unknown;
}>;

type TraceSurface = typeof globalThis & {
  __sensaAgentTraceSink?: (event: AgentTraceEvent) => void;
  __sensaAgentRawTraceSink?: (event: AgentRawTraceEvent) => Promise<void>;
};

let pageTraceId: string | undefined;
/** Start a new synthetic or user-initiated business flow without attaching a learner ID. */
export function beginAgentBusinessTrace(): string {
  pageTraceId = crypto.randomUUID();
  return pageTraceId;
}
const safeReasons = new Set([
  'agent_failed', 'invalid_teacher_turn', 'clarification_incomplete', 'proposal_ready',
  'clarification_tool_failed', 'model_turn_limit', 'content_validation_rejected',
  'invalid_resources', 'content_tool_failed', 'validated_candidate',
  'edge_tts_connection_failed', 'edge_tts_connection_closed', 'edge_tts_empty_audio',
  'edge_tts_invalid_audio_frame', 'edge_tts_invalid_message', 'edge_tts_audio_too_large',
  'speech_language_unavailable', 'speech_cancelled',
  'localFlow.authUnavailable', 'localFlow.conversationSave', 'localFlow.modelIncomplete',
  'localFlow.modelInputLarge', 'localFlow.modelQueueFull', 'localFlow.modelRateLimited',
  'localFlow.modelRequestRejected', 'localFlow.modelResponseInvalid', 'localFlow.modelTruncated',
  'localFlow.modelUnavailable', 'localFlow.onlineLogin', 'localFlow.providerAccessDenied',
  'localFlow.requestStopped', 'localFlow.requestTimeout', 'localFlow.responseLimit',
  'localFlow.sensaEndpoint', 'localFlow.serviceLimit', 'localFlow.spokenResourceUnavailable', 'localFlow.staleAccountResult',
  'localFlow.staleConfigResult', 'localFlow.stoppedResult', 'localFlow.validationRejected',
]);
const safeCode = (value: string | undefined): string | undefined => value && safeReasons.has(value) ? value : undefined;
const safeIdentifier = (value: string | undefined): string | undefined =>
  value && /^[A-Za-z0-9-]{1,64}$/u.test(value) ? value : undefined;
const safeModel = (value: string | undefined): string | undefined =>
  value && /^[A-Za-z0-9._:/-]{1,100}$/u.test(value) ? value : undefined;
const count = (value: number | undefined): number | undefined =>
  Number.isSafeInteger(value) && value! >= 0 ? value : undefined;
const toolNames = new Set<NonNullable<AgentTraceEvent['tool']>>([
  'lookup_meanings', 'organize_answer', 'reply_to_learner', 'prepare_pronunciation', 'lookup_references', 'submit_resources', 'validate_resources', 'unknown',
]);

export function startAgentTrace(input: {
  agent: AgentKind;
  targetLanguageTag: string;
  supportLanguageTag: string;
  promptVersion: string;
  providerKind: 'sensa' | 'compatible';
}) {
  const businessTraceId = pageTraceId ?? beginAgentBusinessTrace();
  const agentRunId = crypto.randomUUID();
  const started = performance.now();
  const emit = (event: AgentTraceEvent['event'], round: number, details: Partial<AgentTraceEvent> = {}) => {
    const sink = (globalThis as TraceSurface).__sensaAgentTraceSink;
    if (typeof sink !== 'function') return;
    // Construct the record from an explicit allowlist. Neither model payloads
    // nor exception messages can pass through this boundary.
    const record: AgentTraceEvent = {
      version: 1, businessTraceId, agentRunId, agent: input.agent, event,
      occurredAt: new Date().toISOString(), elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      round, targetLanguageTag: input.targetLanguageTag, supportLanguageTag: input.supportLanguageTag,
      promptVersion: input.promptVersion, providerKind: input.providerKind,
      ...(details.status ? {status: details.status} : {}),
      ...(count(details.durationMs) !== undefined ? {durationMs: count(details.durationMs)} : {}),
      ...(safeCode(details.reason) ? {reason: safeCode(details.reason)} : {}),
      ...(details.tool && toolNames.has(details.tool) ? {tool: details.tool} : {}),
      ...(typeof details.accepted === 'boolean' ? {accepted: details.accepted} : {}),
      ...(count(details.issueCount) !== undefined ? {issueCount: count(details.issueCount)} : {}),
      ...(details.execution ? {execution: details.execution} : {}),
      ...(safeModel(details.model) ? {model: safeModel(details.model)} : {}),
      ...(safeIdentifier(details.modelExecutionId) ? {modelExecutionId: safeIdentifier(details.modelExecutionId)} : {}),
      ...(safeIdentifier(details.genkitTraceId) ? {genkitTraceId: safeIdentifier(details.genkitTraceId)} : {}),
      ...(count(details.inputTokens) !== undefined ? {inputTokens: count(details.inputTokens)} : {}),
      ...(count(details.outputTokens) !== undefined ? {outputTokens: count(details.outputTokens)} : {}),
    };
    try { sink(record); } catch { /* Observation cannot change an Agent outcome. */ }
  };
  emit('run_started', 0);
  return {
    businessTraceId,
    agentRunId,
    async raw(round: number, kind: AgentRawTraceEvent['kind'], payload: unknown): Promise<void> {
      const sink = (globalThis as TraceSurface).__sensaAgentRawTraceSink;
      if (typeof sink !== 'function') return;
      try { await sink({version: 1, businessTraceId, agentRunId, agent: input.agent, kind, round, occurredAt: new Date().toISOString(), payload}); }
      catch { /* Synthetic observation cannot change an Agent outcome. */ }
    },
    model(round: number, record: ModelExecutionRecord | undefined, status: 'succeeded' | 'failed', reason?: string, resolvedModel?: string) {
      emit('model_completed', round, {
        status, reason, model: input.providerKind === 'sensa' ? resolvedModel ?? record?.model : undefined,
        execution: record?.execution,
        durationMs: record?.startedAt && record?.endedAt ? Math.max(0, record.endedAt - record.startedAt) : undefined,
        modelExecutionId: record?.id, genkitTraceId: record?.traceId,
        inputTokens: record?.inputTokens, outputTokens: record?.outputTokens,
      });
    },
    tool(round: number, name: string, status: 'succeeded' | 'failed', reason?: string, durationMs?: number) {
      emit('tool_completed', round, {tool: toolNames.has(name as NonNullable<AgentTraceEvent['tool']>) ? name as AgentTraceEvent['tool'] : 'unknown', status, reason, durationMs});
    },
    validation(round: number, accepted: boolean, issueCount: number, reason?: string) {
      emit('validation_completed', round, {accepted, issueCount, reason});
    },
    retry(round: number, reason: string) { emit('retry_decided', round, {reason}); },
    finish(round: number, status: 'succeeded' | 'failed' | 'cancelled', reason?: string) {
      emit('run_finished', round, {status, reason});
    },
  };
}

export function agentFailureCode(error: unknown): string {
  return error instanceof Error ? safeCode(error.message) ?? 'agent_failed' : 'agent_failed';
}
