/** A bounded observation of Actions outcomes, not a synthetic successful deployment. */
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const phases = ['preflight', 'migrations', 'auth_config', 'service_config', 'api_deploy', 'web_version', 'web_preview', 'web_promote', 'domain_routes', 'public_smoke', 'live_verification'];
const fullOnly = new Set(['migrations','auth_config','service_config','api_deploy','domain_routes']);
const mutations = new Set(['migrations', 'auth_config', 'service_config', 'api_deploy', 'web_promote', 'domain_routes']);
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function applicationReleaseStatus({commit, runId, attempt, steps, mode='full', stage='application'}) {
  if (!['full','web-only'].includes(mode)) throw Error('Release execution mode required');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[1-9][0-9]*$/.test(String(runId)) || !/^[1-9][0-9]*$/.test(String(attempt))) throw Error('Release observation requires exact Actions identity');
  const selected = stage === 'backend' ? phases.slice(0,5) : stage === 'web-upload' ? ['web_version'] : phases;
  const observed = selected.map(phase => {
    const outcome = steps?.[phase]?.outcome ?? 'skipped';
    if (!outcomes.has(outcome)) throw Error('Invalid release step outcome');
    return {phase, outcome};
  });
  const productionMayHaveChanged = observed.some(step => mutations.has(step.phase) && step.outcome !== 'skipped');
  const completed = observed.every(step => step.outcome === (mode==='web-only'&&fullOnly.has(step.phase)?'skipped':'success'));
  return {format: 'sensa-application-release-status-v1', commit, mode, workflowRunId: String(runId), workflowRunAttempt: String(attempt),
    stage, status: completed ? 'verified' : productionMayHaveChanged ? 'partial-or-unverified' : 'not-deployed',
    productionMayHaveChanged, phases: observed,
    failedPhases: observed.filter(step => ['failure','cancelled'].includes(step.outcome)).map(step => step.phase),
    nextStep: completed ? stage === 'application' ? 'Continue only the planned content/record/archive jobs.' : 'Keep this successful job and its exact output artifact ID when resuming failed downstream jobs.'
      : 'Inspect the first failed phase and actual production state. Resume only failed jobs with original plan/artifact outputs; never rerun all jobs or recompute the plan after partial writes.',
    rollback: 'No automatic database rollback. Retain forward migrations; verify old API/Web/content compatibility before an explicitly authorized restoration.',
    meaning: 'Outcomes describe this attempt and explicitly retained phase receipts. Earlier failed attempts may have changed production. This is not an atomic rollback or a provider-version receipt.'};
}

export function contentReleaseStatus({commit, runId, attempt, steps}) {
  const observed = ['candidate','write_boundary','upload','promote','live_verification'].map(phase => ({phase, outcome: steps?.[phase]?.outcome ?? 'skipped'}));
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[1-9][0-9]*$/.test(String(runId)) || !/^[1-9][0-9]*$/.test(String(attempt))
    || observed.some(step => !outcomes.has(step.outcome))) throw Error('Exact content phase identity required');
  const productionMayHaveChanged = observed.some(step => ['upload','promote'].includes(step.phase) && step.outcome !== 'skipped');
  return {format:'sensa-content-release-status-v1', commit, workflowRunId:String(runId), workflowRunAttempt:String(attempt), phases:observed,
    status: observed.every(step => step.outcome === 'success') ? 'verified' : productionMayHaveChanged ? 'partial-or-unverified' : 'not-published', productionMayHaveChanged,
    failedPhases:observed.filter(step => ['failure','cancelled'].includes(step.outcome)).map(step => step.phase),
    nextStep:'Keep successful application/preflight outputs. Retry failed content jobs with the original sealed content artifact/build attempt; identical immutable objects are verified and skipped, different bytes are rejected.',
    rollback:'Retain published objects. Restore a previous Registry pointer only after confirming that the current API/Web accepts it and obtaining authorization.',
    meaning:'These are content outcomes only; a planned application may already be deployed before the content write-boundary recheck. Upload completion is not Registry promotion. Public readback of the exact Registry is required.'};
}

export function mergeApplicationPhases(reports, {commit, runId, attempt, mode}) {
  const steps = {}, phaseSources = [];
  for (const [report, requiredStage] of reports.map((report,index)=>[report,index===0?'backend':'web-upload'])) {
    if (report?.format !== 'sensa-application-release-status-v1' || report.status !== 'verified' || report.stage !== requiredStage
      || report.commit !== commit || report.mode !== mode || report.workflowRunId !== String(runId)
      || !/^[1-9][0-9]*$/.test(report.workflowRunAttempt) || Number(report.workflowRunAttempt) > Number(attempt)) throw Error('Retained application phase receipt identity mismatch');
    for (const {phase,outcome} of report.phases) steps[phase] = {outcome};
    phaseSources.push({stage:report.stage, executionAttempt:report.workflowRunAttempt});
  }
  return {steps,phaseSources};
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
    nextStep: pending ? 'Use the single release entry with explicit owner approval for this exact SHA; no mutation is authorized yet.'
      : complete ? jobs.archive !== 'success' ? 'Retry only archive, preserving the recorded manifest artifact ID and original release ID.' : 'No recovery action required.'
      : jobs.preflight === 'failure' ? 'Fix the named preflight failure before any write. Preserve successful preparation outputs when retrying failed jobs.'
      : 'Inspect component phase evidence. Keep the original plan and successful job outputs; resume only failed jobs using exact artifact IDs.',
    meaning: 'A green policy/report job is not deployment success. A verified-but-unarchived release has actual completed production evidence but incomplete durable recovery; retry archive, not deployment. Inspect component phase evidence for partial changes.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    let report;
    if (['application','backend','web-upload','content'].includes(mode)) {
      const identity = {commit:process.env.SENSA_RELEASE_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,mode:process.env.SENSA_APPLICATION_MODE??'full'};
      let steps=JSON.parse(process.env.SENSA_RELEASE_STEPS ?? '{}'), phaseSources=[];
      if(mode==='application') {
        const retained=mergeApplicationPhases(await Promise.all(['.tmp/backend-evidence/backend-release-status.json','.tmp/web-upload-evidence/web-upload-release-status.json'].map(async path=>JSON.parse(await readFile(path,'utf8')))),identity);
        steps={...retained.steps,...steps}; phaseSources=retained.phaseSources;
      }
      report=mode==='content'?contentReleaseStatus({...identity,steps}):applicationReleaseStatus({...identity,steps,stage:mode});
      if(phaseSources.length)report.phaseSources=phaseSources;
    }
    else if (mode === 'system') report = systemReleaseStatus(JSON.parse(await readFile('.tmp/system-release-plan/system-release-plan.json', 'utf8')),
      JSON.parse(process.env.SENSA_RELEASE_JOBS ?? '{}'));
    else throw Error('Expected application or system release status');
    await mkdir('release-candidate', {recursive: true});
    await writeFile(`release-candidate/${mode}-release-status.json`, JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Sensa ${mode} release status\n\n- Revision: \`${report.commit}\`\n- State: \`${report.status}\`\n\n${report.phases?.map(step => `- ${step.phase}: ${step.outcome}`).join('\n') ?? Object.entries(report.jobs).map(([name, result]) => `- ${name}: ${result}`).join('\n')}\n\nNext: ${report.nextStep}\n\n${report.rollback ?? ''}\n\n${report.meaning}\n`);
    console.log(`Release status: ${report.status}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
