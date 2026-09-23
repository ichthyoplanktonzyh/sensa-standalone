import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'vitest';
import {summarizeLanguageMatrix, summarizeRunDirectory} from '../../../scripts/live/summarizeLanguageMatrix.mjs';

test('partial live acceptance cannot be reported as complete or pass without Agent evidence', () => {
  const event = (agent: string, agentRunId: string, event: string) => ({
    agent, agentRunId, event, businessTraceId: 'business-1',
    ...(event === 'model_completed' ? {status: 'succeeded', ...(agent === 'clarification' ? {inputTokens: 20, outputTokens: 5} : {})} : {}),
  });
  const agentEvents = ['clarification', 'content_generation'].flatMap((agent, index) => [
    event(agent, `run-${index}`, 'run_started'),
    event(agent, `run-${index}`, 'model_completed'),
    event(agent, `run-${index}`, 'run_finished'),
  ]);
  const result = summarizeLanguageMatrix(
    {runId: 'fixture', mode: 'live', suites: ['web', 'extension'], limit: 2},
    [
      {caseKey: 'web-en--ja', status: 'passed', durationMs: 100, stages: {clarification_acceptance: {status: 'passed', durationMs: 40}}, agentEvents},
      {caseKey: 'web-fr--en', status: 'passed', durationMs: 200, stages: {clarification_acceptance: {status: 'passed', durationMs: 60}}, agentEvents: []},
      {caseKey: 'extension-en--ja', status: 'failed', durationMs: 150, stages: {'reading-translation': {status: 'failed', durationMs: 30}}},
    ],
  );
  assert.deepEqual(result.suites.web, {planned: 2, reported: 2, passed: 1, failed: 1, missing: 0});
  assert.deepEqual(result.suites.extension, {planned: 2, reported: 1, passed: 0, failed: 1, missing: 1});
  assert.equal(result.failuresByType.observability_incomplete, 1);
  assert.equal(result.stageFailures['reading-translation'], 1);
  assert.equal(result.agentModelCalls, 2);
  assert.equal(result.inputTokens, null, 'unknown token usage must not be estimated');
  assert.equal(result.estimatedCost, null);
  assert.deepEqual(result.durationMs, {p50: 150, p95: 200});
  assert(!JSON.stringify(result).includes('private learner text'));
});

test('business-flow acceptance requires both loops and keeps UI smoke separate', () => {
  const events = ['clarification', 'content_generation'].flatMap((agent, index) => [
    {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'run_started'},
    {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'model_completed', inputTokens: 10, outputTokens: 4},
    {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'run_finished'},
  ]);
  const result = summarizeLanguageMatrix(
    {runId: 'fixture-business', mode: 'live', suites: ['business'], case: 'en--zh-CN'},
    [{caseKey: 'business-en--zh-CN', status: 'passed', durationMs: 90,
      stages: {clarification: {status: 'passed', durationMs: 35}}, agentEvents: events,
      requests: [{category: 'speech', status: 200}]}],
  );
  assert.deepEqual(result.suites.business, {planned: 1, reported: 1, passed: 1, failed: 0, missing: 0});
  assert.equal(result.agentModelCalls, 2);
  assert.equal(result.inputTokens, 20);
  assert.equal(result.outputTokens, 8);
  assert.equal(result.edgeTtsServiceSuccesses, 1);
});

test('a failed business stage overrides a stale case-level pass', () => {
  const result = summarizeLanguageMatrix(
    {runId: 'fixture-stage', mode: 'live', suites: ['business'], case: 'en--fr'},
    [{caseKey: 'business-en--fr', status: 'passed',
      stages: {tts: {status: 'failed', durationMs: 12, error: 'network_failure'}}, agentEvents: []}],
  );
  assert.deepEqual(result.suites.business, {planned: 1, reported: 1, passed: 0, failed: 1, missing: 0});
  assert.equal(result.cases[0]?.failedStage, 'tts');
  assert.equal(result.cases[0]?.failureType, 'network_failure');
  assert.equal(result.cases[0]?.failureCode, 'network_failure');
  assert.equal(result.failuresByCode.network_failure, 1);
});

test('human language review is separate from business flow and excludes private notes', () => {
  const result = summarizeLanguageMatrix(
    {runId: 'fixture-review', mode: 'live', suites: ['business'], case: 'en--zh-CN'},
    [{caseKey: 'business-en--zh-CN', status: 'failed', languageEvidenceFile: 'evidence-business-en--zh-CN.json',
      stages: {clarification: {status: 'failed', error: 'expression_surface_mismatch'}}, agentEvents: []}],
    [{schemaVersion: 1, caseKey: 'business-en--zh-CN', status: 'fail',
      checks: {clarificationReplySupport: 'pass', clarificationExpressionTarget: 'fail'},
      reasonCodes: ['expression_language_mismatch'], notes: 'private learner text'}],
  );
  assert.equal(result.cases[0]?.languageReview.status, 'fail');
  assert.equal(result.cases[0]?.languageReview.checks.clarificationReplySupport, 'pass');
  assert.equal(result.cases[0]?.languageReview.checks.contentExampleTarget, 'uncertain');
  assert.equal(result.failuresByCode.expression_surface_mismatch, 1);
  assert.equal(result.languageReviews.fail, 1);
  assert(!JSON.stringify(result).includes('private learner text'));
});

test('directory summary never treats private evidence or review files as business reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sensa-language-summary-'));
  try {
    const events = ['clarification', 'content_generation'].flatMap((agent, index) => [
      {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'run_started'},
      {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'model_completed'},
      {agent, agentRunId: `run-${index}`, businessTraceId: 'one-flow', event: 'run_finished'},
    ]);
    await writeFile(join(directory, 'result.json'), JSON.stringify({runId: 'fixture', mode: 'live', suites: ['business'], case: 'en--ja'}));
    await writeFile(join(directory, 'business-en--ja.json'), JSON.stringify({caseKey: 'business-en--ja', status: 'passed',
      stages: {clarification: {status: 'passed', durationMs: 10}}, agentEvents: events}));
    await writeFile(join(directory, 'evidence-business-en--ja.json'), JSON.stringify({caseKey: 'business-en--ja', clarification: {replies: ['private learner text']}}));
    await writeFile(join(directory, 'review-business-en--ja.json'), JSON.stringify({schemaVersion: 1, caseKey: 'business-en--ja', status: 'pass', notes: 'private learner text'}));
    const summary = await summarizeRunDirectory(directory);
    assert.equal(summary.passed, 1);
    assert.equal(summary.agentModelCalls, 2);
    assert.equal(summary.cases[0]?.stages.clarification.status, 'passed');
    assert.equal(summary.languageReviews.pass, 1);
    assert(!await readFile(join(directory, 'summary.json'), 'utf8').then(text => text.includes('private learner text')));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
