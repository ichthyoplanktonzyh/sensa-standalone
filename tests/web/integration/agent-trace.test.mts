import assert from 'node:assert/strict';
import {afterEach, test} from 'vitest';
import {agentFailureCode, beginAgentBusinessTrace, startAgentTrace, type AgentRawTraceEvent, type AgentTraceEvent} from '../../../apps/web/src/observability/agentTrace';

const surface = globalThis as typeof globalThis & {
  __sensaAgentTraceSink?: (event: AgentTraceEvent) => void;
  __sensaAgentRawTraceSink?: (event: AgentRawTraceEvent) => Promise<void>;
};
afterEach(() => { delete surface.__sensaAgentTraceSink; delete surface.__sensaAgentRawTraceSink; });

test('Agent trace links both loops while exporting only bounded operational fields', () => {
  const events: AgentTraceEvent[] = [];
  surface.__sensaAgentTraceSink = event => { events.push(event); };
  const flowId = beginAgentBusinessTrace();
  const clarification = startAgentTrace({
    agent: 'clarification', targetLanguageTag: 'en', supportLanguageTag: 'ja',
    promptVersion: 'fixture-v1', providerKind: 'sensa',
  });
  clarification.model(1, {
    id: '00000000-0000-4000-8000-000000000001', provider: 'https://private.example/secret',
    model: 'test-model', purpose: 'teacher', execution: 'service', state: 'succeeded',
    queuedAt: 1, startedAt: 2, endedAt: 22, traceId: 'abc123', inputTokens: 42, outputTokens: 8,
    // Deliberately malformed extra fields must never pass the allowlist.
    prompt: 'private learner text', response: 'private model text',
  } as Parameters<typeof clarification.model>[1], 'succeeded');
  clarification.validation(1, false, 1, 'private learner text');
  clarification.retry(1, 'water');
  clarification.retry(1, 'invalid_teacher_turn');
  clarification.finish(2, 'succeeded', 'proposal_ready');
  const content = startAgentTrace({
    agent: 'content_generation', targetLanguageTag: 'en', supportLanguageTag: 'ja',
    promptVersion: 'fixture-v1', providerKind: 'compatible',
  });
  content.tool(1, 'submit_resources', 'failed', 'content_validation_rejected', 12);
  content.finish(1, 'failed', agentFailureCode(new Error('private learner text')));

  assert.equal(clarification.businessTraceId, content.businessTraceId);
  assert.equal(clarification.businessTraceId, flowId);
  assert.notEqual(clarification.agentRunId, content.agentRunId);
  assert.equal(events.filter(event => event.event === 'run_started').length, 2);
  assert.equal(events.find(event => event.event === 'model_completed')?.genkitTraceId, 'abc123');
  assert.equal(events.find(event => event.event === 'model_completed')?.durationMs, 20);
  assert.equal(events.find(event => event.event === 'validation_completed')?.reason, undefined);
  assert.equal(events.find(event => event.event === 'retry_decided')?.reason, undefined, 'short private strings are not safe error codes');
  assert.equal(events.find(event => event.event === 'tool_completed')?.durationMs, 12);
  assert.equal(agentFailureCode(new Error('private learner text')), 'agent_failed');
  const serialized = JSON.stringify(events);
  for (const secret of ['private learner text', 'private model text', 'private.example/secret', 'water']) {
    assert(!serialized.includes(secret), `trace leaked ${secret}`);
  }
});

test('Agent trace sink failures cannot alter the Agent result', () => {
  surface.__sensaAgentTraceSink = () => { throw new Error('sink unavailable'); };
  const run = startAgentTrace({
    agent: 'clarification', targetLanguageTag: 'en', supportLanguageTag: 'fr',
    promptVersion: 'fixture-v1', providerKind: 'sensa',
  });
  assert.doesNotThrow(() => run.finish(1, 'succeeded'));
});

test('full synthetic payload is delivered only to the explicit raw sink', async () => {
  const metadata: AgentTraceEvent[] = [];
  const raw: AgentRawTraceEvent[] = [];
  surface.__sensaAgentTraceSink = event => { metadata.push(event); };
  const run = startAgentTrace({
    agent: 'clarification', targetLanguageTag: 'en', supportLanguageTag: 'fr',
    promptVersion: 'fixture-v1', providerKind: 'sensa',
  });
  await run.raw(1, 'model_response', {content: 'private synthetic response'});
  assert.equal(raw.length, 0);
  surface.__sensaAgentRawTraceSink = async event => { raw.push(event); };
  await run.raw(2, 'model_response', {content: 'private synthetic response'});
  assert.equal(raw.length, 1);
  assert.equal((raw[0]?.payload as {content: string}).content, 'private synthetic response');
  assert.equal(raw[0]?.businessTraceId, run.businessTraceId);
  assert(!JSON.stringify(metadata).includes('private synthetic response'));
});
