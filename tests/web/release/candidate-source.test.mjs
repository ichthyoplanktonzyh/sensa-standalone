import {test, expect} from 'vitest';
import {assertGreenValidation, candidateArtifactName, selectCandidateArtifacts, verifyBuildJob, resolveCandidateSource} from '../../../scripts/release/candidateSource.mjs';

const sha = 'a'.repeat(40), now = Date.parse('2026-10-10T00:00:00Z');
const run = {id: 123, run_attempt: 2, name: 'Sensa CI', path: '.github/workflows/sensa-consumer-check.yml',
  event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success',
  repository: {id: 7, full_name: 'sensa/example'}, head_repository: {full_name: 'sensa/example'}};
const artifact = {id: 9, name: candidateArtifactName(sha, 1), expired: false, digest: 'sha256:' + 'b'.repeat(64),
  created_at: '2026-10-09T00:01:00Z', expires_at: '2099-10-10T00:00:00Z',
  workflow_run: {id: 123, head_sha: sha, head_branch: 'main', repository_id: 7, head_repository_id: 7}};
const job = {id: 55, run_id: 123, run_attempt: 1, name: 'Static, build and fast smoke', status: 'completed', conclusion: 'success',
  started_at: '2026-10-09T00:00:00Z', completed_at: '2026-10-09T00:02:00Z',
  steps: [{name: 'Preserve the tested main release candidate', conclusion: 'success'}]};
const selection = {repository: 'sensa/example', sha, runId: '123', validationAttempt: '2'};

test('failed-test reruns retain immutable build provenance rather than pretending the candidate was rebuilt', () => {
  assertGreenValidation(run, selection);
  const selected = selectCandidateArtifacts(run, [artifact], now)[0];
  const source = verifyBuildJob(run, selected, [job]);
  expect(source).toMatchObject({artifactId: 9, workflowRunId: '123', buildAttempt: '1', validationAttempt: '2', buildJobId: 55});
  const rebuilt = {...artifact, id: 10, name: candidateArtifactName(sha, 2)};
  expect(selectCandidateArtifacts(run, [artifact, rebuilt], now)[0].id).toBe(10);
});

test('red, foreign, stale and non-main validations cannot grant deployment authority', () => {
  for (const change of [{conclusion: 'failure'}, {status: 'in_progress'}, {event: 'pull_request'}, {head_branch: 'other'},
    {head_sha: 'c'.repeat(40)}, {run_attempt: 3}, {head_repository: {full_name: 'foreign/repo'}}, {path: 'other.yml'}]) {
    expect(() => assertGreenValidation({...run, ...change}, selection)).toThrow();
  }
  expect(selectCandidateArtifacts(run, [{...artifact, expired: true}, {...artifact, expires_at: '2026-01-01T00:00:00Z'}], now)).toEqual([]);
  for (const change of [{digest: 'unknown'},
    {name: candidateArtifactName(sha, 3)}, {workflow_run: {...artifact.workflow_run, head_repository_id: 8}}]) {
    expect(() => selectCandidateArtifacts(run, [{...artifact, ...change}], now)).toThrow();
  }
  const selected = selectCandidateArtifacts(run, [artifact], now)[0];
  for (const change of [{conclusion: 'failure'}, {run_attempt: 2}, {steps: []}, {completed_at: '2026-10-09T00:00:30Z'}]) {
    expect(() => verifyBuildJob(run, selected, [{...job, ...change}])).toThrow();
  }
});

test('GitHub lookup uses exact run, attempt and artifact metadata without consuming credentials or mutating services', async () => {
  const requested = [], env = {GITHUB_REPOSITORY: 'sensa/example', SENSA_RELEASE_SHA: sha,
    SENSA_CANDIDATE_RUN_ID: '123', SENSA_VALIDATION_RUN_ATTEMPT: '2', GH_TOKEN: 'fixture-do-not-log'};
  const lookup = async (url, init) => {
    requested.push(url);
    expect(init.redirect).toBe('error'); expect(init.method).toBeUndefined();
    const value = url.endsWith('/123') ? run : url.includes('/artifacts?') ? {artifacts: [artifact]} : {jobs: [job]};
    return new Response(JSON.stringify(value), {status: 200});
  };
  expect(await resolveCandidateSource(env, lookup)).toMatchObject({artifactId: 9, buildAttempt: '1', validationAttempt: '2'});
  expect(requested).toEqual(['https://api.github.com/repos/sensa/example/actions/runs/123',
    'https://api.github.com/repos/sensa/example/actions/runs/123/artifacts?per_page=100&page=1',
    'https://api.github.com/repos/sensa/example/actions/runs/123/attempts/1/jobs?per_page=100&page=1']);
  await expect(resolveCandidateSource(env, async () => new Response('', {status: 403}))).rejects.toThrow('403');
  await expect(resolveCandidateSource(env, async url => new Response(JSON.stringify(url.endsWith('/123') ? run : {artifacts: [artifact, artifact]})))).rejects.toThrow('unique');
});
