/** A bounded observation of Actions outcomes, not a synthetic successful deployment. */
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const phases = ['preflight', 'migrations', 'auth_config', 'service_config', 'api_deploy', 'web_version', 'web_preview', 'web_promote', 'domain_routes', 'public_smoke', 'live_verification'];
const fullOnly = new Set(['migrations','auth_config','service_config','api_deploy','domain_routes']);
const mutations = new Set(['migrations', 'auth_config', 'service_config', 'api_deploy', 'web_promote', 'domain_routes']);
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function applicationReleaseStatus({commit, runId, attempt, steps, mode='full'}) {
  if (!['full','web-only'].includes(mode)) throw Error('Release execution mode required');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[1-9][0-9]*$/.test(String(runId)) || !/^[1-9][0-9]*$/.test(String(attempt))) throw Error('Release observation requires exact Actions identity');
  const observed = phases.map(phase => {
    const outcome = steps?.[phase]?.outcome ?? 'skipped';
    if (!outcomes.has(outcome)) throw Error('Invalid release step outcome');
    return {phase, outcome};
  });
  const productionMayHaveChanged = observed.some(step => mutations.has(step.phase) && step.outcome !== 'skipped');
  const completed = observed.every(step => step.outcome === (mode==='web-only'&&fullOnly.has(step.phase)?'skipped':'success'));
  return {format: 'sensa-application-release-status-v1', commit, mode, workflowRunId: String(runId), workflowRunAttempt: String(attempt),
    status: completed ? 'verified' : productionMayHaveChanged ? 'partial-or-unverified' : 'not-deployed',
    productionMayHaveChanged, phases: observed,
    meaning: 'Outcomes describe executed commands. Partial failure can leave production changes; this is not an atomic rollback or a provider-version receipt.'};
}

export function systemReleaseStatus(plan, jobs) {
  if (!plan?.releaseId || !plan.source?.commit || !plan.authorization?.outcome) throw Error('Release plan required');
  for (const value of Object.values(jobs)) if (!outcomes.has(value)) throw Error('Invalid release job outcome');
  const pending = plan.authorization.outcome === 'requires-approval';
  const complete = jobs.record === 'success'
    && (!plan.decision.deployApplication || jobs.application === 'success')
    && (!plan.decision.publishLearningContent || jobs.learning_content === 'success');
  return {format: 'sensa-system-release-status-v1', releaseId: plan.releaseId, commit: plan.source.commit,
    status: pending ? 'awaiting-approval' : complete ? jobs.archive !== 'success' ? 'verified-but-unarchived' : plan.decision.kind === 'no-op' ? 'no-op' : 'verified' : 'incomplete',
    authorization: plan.authorization, jobs,
    meaning: 'A green policy/report job is not deployment success. A verified-but-unarchived release has actual completed production evidence but incomplete durable recovery; retry archive, not deployment. Inspect component phase evidence for partial changes.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    let report;
    if (mode === 'application') report = applicationReleaseStatus({commit: process.env.SENSA_RELEASE_SHA,
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, mode:process.env.SENSA_APPLICATION_MODE??'full', steps: JSON.parse(process.env.SENSA_RELEASE_STEPS ?? '{}')});
    else if (mode === 'system') report = systemReleaseStatus(JSON.parse(await readFile('.tmp/system-release-plan/system-release-plan.json', 'utf8')),
      JSON.parse(process.env.SENSA_RELEASE_JOBS ?? '{}'));
    else throw Error('Expected application or system release status');
    await mkdir('release-candidate', {recursive: true});
    await writeFile(`release-candidate/${mode}-release-status.json`, JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Sensa ${mode} release status\n\n- Revision: \`${report.commit}\`\n- State: \`${report.status}\`\n\n${report.phases?.map(step => `- ${step.phase}: ${step.outcome}`).join('\n') ?? Object.entries(report.jobs).map(([name, result]) => `- ${name}: ${result}`).join('\n')}\n\n${report.meaning}\n`);
    console.log(`Release status: ${report.status}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
