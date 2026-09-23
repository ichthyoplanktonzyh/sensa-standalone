#!/usr/bin/env node
/** Aggregate only bounded acceptance metadata. Never read service logs or media. */
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const expectedCasesPerSuite = 306;
const allowedSuites = ['business', 'web', 'extension'];
const pairPattern = /^[a-zA-Z0-9-]{2,40}--[a-zA-Z0-9-]{2,40}$/u;
const reviewStatuses = new Set(['pass', 'fail', 'blocked', 'uncertain']);
const checkStatuses = new Set(['pass', 'fail', 'not_observed', 'uncertain']);
const languageChecks = [
  'clarificationReplySupport', 'clarificationSenseSupport', 'clarificationExpressionTarget',
  'contentRecallSupport', 'contentExplanationSupport', 'contentExampleTarget', 'dictionaryGlossSupport',
];

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * quantile) - 1];
}

function caseIdentity(report) {
  const key = report?.caseKey ?? report?.case;
  if (typeof key !== 'string') return null;
  const match = /^(business|web|extension)-(.+)$/u.exec(key);
  if (!match || !pairPattern.test(match[2])) return null;
  return {suite: match[1], pair: match[2], key};
}

function agentObservation(events, kind) {
  const selected = events.filter(event => event?.agent === kind);
  if (selected.length === 0) return false;
  const runs = new Set(selected.map(event => event.agentRunId));
  return [...runs].some(id => {
    const run = selected.filter(event => event.agentRunId === id);
    return run.some(event => event.event === 'run_started')
      && run.some(event => event.event === 'model_completed')
      && run.some(event => event.event === 'run_finished');
  });
}

function summarizedReport(report) {
  const identity = caseIdentity(report);
  if (!identity) return null;
  const stages = report.stages && typeof report.stages === 'object' ? report.stages : {};
  const stageEntries = Object.entries(stages).filter(([name, stage]) =>
    name !== 'total' && stage && typeof stage === 'object');
  const events = Array.isArray(report.agentEvents) ? report.agentEvents : [];
  const hasBothAgents = !['business', 'web'].includes(identity.suite) ||
    (agentObservation(events, 'clarification') && agentObservation(events, 'content_generation')
      && new Set(events.filter(event => event?.agent === 'clarification' || event?.agent === 'content_generation')
        .map(event => event.businessTraceId)).size === 1);
  const failedEntry = stageEntries.find(([, stage]) => stage.status === 'failed');
  const failedStage = failedEntry?.[0] ?? null;
  const reportedPassed = report.status === 'passed';
  const status = reportedPassed && !failedStage && hasBothAgents ? 'passed' : 'failed';
  const safeFailureTypes = new Set(['timeout', 'network_failure', 'ui_assertion_failed', 'agent_observation_incomplete']);
  const stageError = failedEntry?.[1]?.error ?? failedEntry?.[1]?.detail;
  const failureType = failedStage
    ? (typeof stageError === 'string' && safeFailureTypes.has(stageError) ? stageError : stageError === 'TimeoutError' ? 'timeout' : 'stage_failed')
    : reportedPassed && !hasBothAgents ? 'observability_incomplete'
    : reportedPassed ? null : 'case_failed';
  const failureCode = typeof stageError === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(stageError)
    ? stageError : typeof report.failure === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(report.failure)
      ? report.failure : null;
  const modelEvents = events.filter(event => event?.event === 'model_completed');
  const tokens = modelEvents.reduce((total, event) => ({
    input: total.input + (Number.isSafeInteger(event.inputTokens) ? event.inputTokens : 0),
    output: total.output + (Number.isSafeInteger(event.outputTokens) ? event.outputTokens : 0),
    knownInput: total.knownInput + Number.isSafeInteger(event.inputTokens),
    knownOutput: total.knownOutput + Number.isSafeInteger(event.outputTokens),
  }), {input: 0, output: 0, knownInput: 0, knownOutput: 0});
  const socketCount = Array.isArray(report.websockets)
    ? report.websockets.filter(socket => socket?.origin === 'wss://speech.platform.bing.com').length
    : stageEntries.reduce((total, [, stage]) => total + (Number.isSafeInteger(stage.evidence?.edgeTtsSockets) ? stage.evidence.edgeTtsSockets : 0), 0);
  const speechRequests = Array.isArray(report.requests)
    ? report.requests.filter(request => request?.category === 'speech' && request.status === 200).length : 0;
  return {
    ...identity, status, failedStage, failureType, failureCode,
    languageEvidenceAvailable: typeof report.languageEvidenceFile === 'string',
    durationMs: Number.isFinite(report.durationMs) && report.durationMs >= 0 ? report.durationMs : null,
    stages: Object.fromEntries(stageEntries.map(([name, stage]) => [name, {
      status: stage.status === 'passed' ? 'passed' : stage.status === 'failed' ? 'failed' : 'unknown',
      durationMs: Number.isFinite(stage.durationMs) && stage.durationMs >= 0 ? stage.durationMs : null,
    }])),
    agentModelCalls: modelEvents.length,
    agentModelFailures: modelEvents.filter(event => event.status === 'failed').length,
    agentRetries: events.filter(event => event?.event === 'retry_decided').length,
    inputTokens: tokens.knownInput === modelEvents.length ? tokens.input : null,
    outputTokens: tokens.knownOutput === modelEvents.length ? tokens.output : null,
    edgeTtsSockets: socketCount, edgeTtsServiceSuccesses: speechRequests,
  };
}

export function summarizeLanguageMatrix(run, reports, reviews = []) {
  const selectedSuites = Array.isArray(run.suites) ? run.suites.filter(suite => allowedSuites.includes(suite)) : [];
  const plannedPerSuite = run.case ? 1 : Number.isInteger(run.limit) ? run.limit : expectedCasesPerSuite;
  const normalized = reports.map(summarizedReport).filter(Boolean);
  const unique = new Map(normalized.map(report => [report.key, report]));
  const reviewByKey = new Map(reviews.filter(review =>
    review?.schemaVersion === 1 && caseIdentity(review)?.suite === 'business'
    && reviewStatuses.has(review.status)).map(review => [review.caseKey, review]));
  const cases = [...unique.values()].map(item => {
    const review = reviewByKey.get(item.key);
    return {...item, languageReview: review ? {
      status: review.status,
      checks: Object.fromEntries(languageChecks.map(check =>
        [check, checkStatuses.has(review.checks?.[check]) ? review.checks[check] : 'uncertain'])),
      reasonCodes: Array.isArray(review.reasonCodes) ? review.reasonCodes.filter(code =>
        typeof code === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(code)).slice(0, 20) : [],
    } : {status: 'unreviewed'}};
  }).sort((a, b) => a.key.localeCompare(b.key));
  const stageFailures = {};
  const failuresByType = {};
  const failuresByCode = {};
  const languageReviews = Object.fromEntries([...reviewStatuses, 'unreviewed'].map(status => [status, 0]));
  const stageDurations = new Map();
  for (const item of cases) {
    if (item.failedStage) stageFailures[item.failedStage] = (stageFailures[item.failedStage] ?? 0) + 1;
    if (item.failureType) failuresByType[item.failureType] = (failuresByType[item.failureType] ?? 0) + 1;
    if (item.failureCode) failuresByCode[item.failureCode] = (failuresByCode[item.failureCode] ?? 0) + 1;
    languageReviews[item.languageReview.status] += 1;
    for (const [stage, result] of Object.entries(item.stages)) {
      if (result.durationMs === null) continue;
      const values = stageDurations.get(stage) ?? [];
      values.push(result.durationMs);
      stageDurations.set(stage, values);
    }
  }
  const suiteTotals = Object.fromEntries(selectedSuites.map(suite => {
    const selected = cases.filter(item => item.suite === suite);
    return [suite, {planned: plannedPerSuite, reported: selected.length,
      passed: selected.filter(item => item.status === 'passed').length,
      failed: selected.filter(item => item.status === 'failed').length,
      missing: Math.max(0, plannedPerSuite - selected.length)}];
  }));
  const knownInputs = cases.filter(item => item.inputTokens !== null);
  const knownOutputs = cases.filter(item => item.outputTokens !== null);
  return {
    schemaVersion: 1, runId: run.runId ?? null, mode: run.mode ?? 'unknown',
    selectedSuites, expectedCasesPerSuite, suites: suiteTotals,
    passed: cases.filter(item => item.status === 'passed').length,
    failed: cases.filter(item => item.status === 'failed').length,
    stageFailures, failuresByType, failuresByCode, languageReviews,
    durationMs: {p50: percentile(cases.map(item => item.durationMs).filter(Number.isFinite), .5),
      p95: percentile(cases.map(item => item.durationMs).filter(Number.isFinite), .95)},
    stageDurationMs: Object.fromEntries([...stageDurations].map(([stage, values]) =>
      [stage, {p50: percentile(values, .5), p95: percentile(values, .95)}])),
    agentModelCalls: cases.reduce((sum, item) => sum + item.agentModelCalls, 0),
    agentModelFailures: cases.reduce((sum, item) => sum + item.agentModelFailures, 0),
    agentRetries: cases.reduce((sum, item) => sum + item.agentRetries, 0),
    inputTokens: knownInputs.length === cases.length ? knownInputs.reduce((sum, item) => sum + item.inputTokens, 0) : null,
    outputTokens: knownOutputs.length === cases.length ? knownOutputs.reduce((sum, item) => sum + item.outputTokens, 0) : null,
    edgeTtsSockets: cases.reduce((sum, item) => sum + item.edgeTtsSockets, 0),
    edgeTtsServiceSuccesses: cases.reduce((sum, item) => sum + item.edgeTtsServiceSuccesses, 0),
    estimatedCost: null,
    cases,
  };
}

export async function summarizeRunDirectory(directory) {
  const run = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
  const reports = [];
  const reviews = [];
  for (const entry of await readdir(directory)) {
    if (/^review-business-[a-zA-Z0-9-]{2,40}--[a-zA-Z0-9-]{2,40}\.json$/u.test(entry)) {
      reviews.push(JSON.parse(await readFile(join(directory, entry), 'utf8')));
    } else if (/^(business|web|extension)-[a-zA-Z0-9-]{2,40}--[a-zA-Z0-9-]{2,40}\.json$/u.test(entry)) {
      reports.push(JSON.parse(await readFile(join(directory, entry), 'utf8')));
    } else if (entry === 'extension-language-matrix.jsonl') {
      const lines = (await readFile(join(directory, entry), 'utf8')).split(/\r?\n/u).filter(Boolean);
      for (const line of lines) reports.push(JSON.parse(line));
    }
  }
  const summary = summarizeLanguageMatrix(run, reports, reviews);
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {mode: 0o600});
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node scripts/live/summarizeLanguageMatrix.mjs <run-directory>');
  const summary = await summarizeRunDirectory(resolve(directory));
  console.log(JSON.stringify({suites: summary.suites, passed: summary.passed, failed: summary.failed,
    stageFailures: summary.stageFailures, failuresByType: summary.failuresByType,
    failuresByCode: summary.failuresByCode, languageReviews: summary.languageReviews}));
}
