/** Resolve immutable build provenance separately from the successful validation attempt. */
import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function candidateArtifactName(sha, attempt) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !/^[1-9][0-9]*$/.test(String(attempt))) throw Error('Invalid candidate identity');
  return `sensa-production-${sha}-attempt-${attempt}`;
}

export function assertGreenValidation(run, {repository, sha, runId, validationAttempt}) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')
    || !Number.isSafeInteger(Number(runId)) || Number(runId) < 1
    || !Number.isSafeInteger(Number(validationAttempt)) || Number(validationAttempt) < 1
    || run?.repository?.full_name !== repository || run?.head_repository?.full_name !== repository
    || !Number.isSafeInteger(run.repository.id) || run.repository.id < 1
    || run.name !== 'Sensa CI' || run.path !== '.github/workflows/sensa-consumer-check.yml'
    || run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== sha
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.id !== Number(runId) || run.run_attempt !== Number(validationAttempt)) {
    throw Error('A completed successful same-repository main CI validation is required');
  }
}

export function selectCandidateArtifacts(run, artifacts, now = Date.now()) {
  const prefix = `sensa-production-${run.head_sha}-attempt-`;
  return artifacts.filter(artifact => artifact.name?.startsWith(prefix) && artifact.expired === false
    && Date.parse(artifact.expires_at) > now).map(artifact => {
    const attempt = Number(artifact.name.slice(prefix.length));
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > run.run_attempt
      || artifact.name !== candidateArtifactName(run.head_sha, attempt)
      || !Number.isSafeInteger(artifact.id) || artifact.id < 1
      || artifact.expired !== false || !Number.isFinite(Date.parse(artifact.expires_at))
      || Date.parse(artifact.expires_at) <= now || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
      || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha
      || artifact.workflow_run?.head_branch !== 'main'
      || artifact.workflow_run?.repository_id !== run.repository.id
      || artifact.workflow_run?.head_repository_id !== run.repository.id) throw Error('Candidate artifact identity or lifetime is invalid');
    return {...artifact, buildAttempt: attempt};
  }).sort((a, b) => b.buildAttempt - a.buildAttempt);
}

export function verifyBuildJob(run, artifact, jobs) {
  const build = jobs.filter(job => job.name === 'Static, build and fast smoke'
    && job.run_id === run.id && job.run_attempt === artifact.buildAttempt);
  if (build.length !== 1 || build[0].status !== 'completed' || build[0].conclusion !== 'success'
    || !Number.isSafeInteger(build[0].id) || build[0].id < 1
    || !Number.isFinite(Date.parse(build[0].started_at)) || !Number.isFinite(Date.parse(build[0].completed_at))
    || !build[0].steps?.some(step => step.name === 'Preserve the tested main release candidate' && step.conclusion === 'success')
    || !Number.isFinite(Date.parse(artifact.created_at))
    || Date.parse(artifact.created_at) < Date.parse(build[0].started_at)
    || Date.parse(artifact.created_at) > Date.parse(build[0].completed_at)) throw Error('Candidate was not produced by a successful build job');
  return {
    format: 'sensa-ci-candidate-source-v1', repository: run.repository.full_name,
    commit: run.head_sha, workflowRunId: String(run.id),
    validationAttempt: String(run.run_attempt), buildAttempt: String(artifact.buildAttempt),
    buildJobId: build[0].id, artifactId: artifact.id, artifactName: artifact.name, artifactDigest: artifact.digest,
  };
}

export async function resolveCandidateSource(environment = process.env, fetchImpl = fetch) {
  const {GITHUB_REPOSITORY: repository, SENSA_RELEASE_SHA: sha,
    SENSA_CANDIDATE_RUN_ID: runId, SENSA_VALIDATION_RUN_ATTEMPT: validationAttempt} = environment;
  if (!environment.GH_TOKEN || !/^[^/\s]+\/[^/\s]+$/.test(repository ?? '')
    || !/^[1-9][0-9]*$/.test(runId ?? '') || !/^[1-9][0-9]*$/.test(validationAttempt ?? '')) throw Error('Candidate lookup requires scoped Actions identity');
  const request = async path => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {authorization: `Bearer ${environment.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10'},
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!response.ok) throw Error(`GitHub candidate lookup failed (${response.status})`);
    return response.json();
  };
  const run = await request(`actions/runs/${runId}`);
  assertGreenValidation(run, {repository, sha, runId, validationAttempt});
  const artifacts = [];
  for (let page = 1; page <= 10; page++) {
    const result = await request(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    if (!Array.isArray(result.artifacts)) throw Error('Invalid GitHub artifact response');
    artifacts.push(...result.artifacts);
    if (result.artifacts.length < 100) break;
    if (page === 10) throw Error('Candidate artifact listing exceeds its bounded lookup');
  }
  const candidates = selectCandidateArtifacts(run, artifacts);
  if (!candidates.length || candidates[1]?.buildAttempt === candidates[0].buildAttempt) throw Error('A unique unexpired CI candidate is required; rerun the build job if absent');
  const artifact = candidates[0], jobs = [];
  for (let page = 1; page <= 10; page++) {
    const result = await request(`actions/runs/${runId}/attempts/${artifact.buildAttempt}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(result.jobs)) throw Error('Invalid GitHub job response');
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
    if (page === 10) throw Error('Candidate job listing exceeds its bounded lookup');
  }
  return verifyBuildJob(run, artifact, jobs);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = await resolveCandidateSource();
    const output = 'release-candidate/ci-candidate-source.json';
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(source, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `artifact_id=${source.artifactId}\nartifact_name=${source.artifactName}\nbuild_attempt=${source.buildAttempt}\nvalidation_attempt=${source.validationAttempt}\n`);
    console.log(`Verified candidate artifact ${source.artifactId}: build attempt ${source.buildAttempt}, validation attempt ${source.validationAttempt}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
