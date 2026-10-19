/** Production readiness via GET and read-only SQL only. Never print provider errors. */
import {mkdir, readFile, writeFile, appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {databaseMigrationSet} from './releaseCandidate.mjs';
import {readMigrationLedger, assertMigrationCompatibility} from './migrationLedger.mjs';
import {verifyApiIdentity} from './liveVerification.mjs';

const required = (env, name) => {
  if (!env[name]?.trim()) throw Error(`${name} is required`);
  return env[name];
};
const origin = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('HTTPS origin required');
  return url.origin;
};
export function preflightTargets(env, component) {
  if (!['application', 'content'].includes(component)) throw Error('Expected application or content');
  const projectRef = required(env, 'SUPABASE_PROJECT_REF');
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !/^[a-f0-9]{40}$/.test(env.SENSA_RELEASE_SHA ?? '')) throw Error('Exact revision and project required');
  const supabaseOrigin = origin(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL);
  if (supabaseOrigin !== `https://${projectRef}.supabase.co`) throw Error('Supabase project target mismatch');
  const targets = {projectRef, supabaseOrigin, webOrigin: origin(env.SENSA_WEB_ORIGIN)};
  if (component === 'content' || env.SENSA_APPLICATION_MODE === 'full') required(env, 'SUPABASE_ACCESS_TOKEN');
  if (component === 'content') required(env, 'SUPABASE_SECRET_KEY');
  else {
    if (env.VITE_SENSA_API_URL !== `${supabaseOrigin}/functions/v1/sensa-api`
      || !['full','web-only'].includes(env.SENSA_APPLICATION_MODE)
      || env.CLOUDFLARE_WORKER_NAME !== 'sensa-standalone'
      || !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')) throw Error('Application target mismatch');
    required(env, 'CLOUDFLARE_API_TOKEN');
    if (env.SENSA_APPLICATION_MODE === 'full') {
      for (const name of ['MIGRATION_DATABASE_URL','SENSA_RUNTIME_DATABASE_URL']) assertDatabaseTarget(required(env, name), projectRef);
      required(env, 'DEEPSEEK_API_KEY');
      if (!/^[a-f0-9]{64}$/i.test(env.SENSA_PROVIDER_VAULT_KEY ?? '')) throw Error('Provider vault key required');
      for (const name of ['SENSA_RUNTIME_DATABASE_URL','DEEPSEEK_API_KEY','SENSA_PROVIDER_VAULT_KEY']) {
        if (/[\r\n']/.test(env[name])) throw Error('Unsupported service environment encoding');
      }
    }
  }
  return targets;
}
export function assertDatabaseTarget(value, project) {
  let url; try { url = new URL(value); } catch { throw Error('Database target URL required'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.password
    || !['require','verify-full','verify-ca'].includes(url.searchParams.get('sslmode'))
    || !(url.hostname === `db.${project}.supabase.co`
      || (/\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username).endsWith('.' + project)))) throw Error('Database must match the approved project and require TLS');
}

async function getJson(url, headers, fetchImpl) {
  const response = await fetchImpl(url, {method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000)});
  if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}`); }
  // Catalogs/config responses have a bounded local admission limit.
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) throw Error('Read-only response exceeds 8 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function inspectDatabase(connectionString, files, runtime = false) {
  const client = new pg.Client({connectionString, connectionTimeoutMillis: 15000, query_timeout: 20000,
    options: '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000'});
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    if (runtime) {
      const role = (await client.query("SELECT current_user, rolsuper, rolcreaterole, pg_has_role(current_user,'backend_app','MEMBER') AS application_role FROM pg_roles WHERE rolname=current_user")).rows[0];
      if (!role?.application_role || role.rolsuper || role.rolcreaterole || ['postgres','supabase_admin'].includes(role.current_user)) throw Error('Restricted runtime role required');
      return {restrictedRole: true};
    }
    return await readMigrationLedger(client, files);
  } finally { await client.end(); }
}
async function validateRegistry(registry) {
  const {sensaPortableLearningContentRegistrySchema} = await import('@sensa/contracts/sensa');
  sensaPortableLearningContentRegistrySchema.parse(registry);
}

export async function releasePreflight({component, environment = process.env, plan, fetchImpl = fetch,
  inspectDatabaseImpl = inspectDatabase, validateRegistryImpl = validateRegistry, root = process.cwd()} = {}) {
  const report = {format: 'sensa-release-preflight-v1', component, commit: environment.SENSA_RELEASE_SHA,
    scope: environment.SENSA_PREFLIGHT_SCOPE === 'content-write-boundary' ? 'content-write-boundary' : 'preparation',
    releaseId: plan?.releaseId, workflowRunId: environment.GITHUB_RUN_ID,
    workflowRunAttempt: environment.GITHUB_RUN_ATTEMPT,
    planSha256: createHash('sha256').update(JSON.stringify(plan ?? null)).digest('hex'),
    observedAt: new Date().toISOString(), status: 'failed', checks: [],
    limitation: 'GET/SELECT prove current access, not future write permissions, migration duration or atomic rollback.'};
  let check = 'configuration';
  try {
    report.targets = preflightTargets(environment, component);
    if (plan?.source?.commit !== report.commit || plan.authorization?.outcome !== 'approved'
      || !(component === 'application' ? plan.decision?.deployApplication : plan.decision?.publishLearningContent)) throw Error('Approved exact component plan required');
    if (component === 'content' && !plan.decision.deployApplication) {
      const app = plan.previousRelease?.components?.application?.targets;
      if (app?.supabaseOrigin !== report.targets.supabaseOrigin || app?.webOrigin !== report.targets.webOrigin) throw Error('Content-only target differs from the current application');
    }
    report.checks.push(check);
    if (component === 'content' || environment.SENSA_APPLICATION_MODE === 'full') {
      check = 'supabase-management-access';
      const project = await getJson(`https://api.supabase.com/v1/projects/${report.targets.projectRef}`,
        {authorization: `Bearer ${environment.SUPABASE_ACCESS_TOKEN}`}, fetchImpl);
      if ((project.ref ?? project.id) !== report.targets.projectRef || project.status !== 'ACTIVE_HEALTHY') throw Error('Approved active project required');
      report.checks.push(check);
      check = 'supabase-service-secrets-access';
      const secrets = await getJson(`https://api.supabase.com/v1/projects/${report.targets.projectRef}/secrets`,
        {authorization: `Bearer ${environment.SUPABASE_ACCESS_TOKEN}`}, fetchImpl);
      if (!Array.isArray(secrets)) throw Error('Service secret metadata read failed');
      report.checks.push(check);
      if (component === 'application') {
        check = 'supabase-configuration-access';
        // Inspect access to the protected configuration surface, never retain its payload.
        const config = await getJson(`https://api.supabase.com/v1/projects/${report.targets.projectRef}/config/auth`,
          {authorization: `Bearer ${environment.SUPABASE_ACCESS_TOKEN}`}, fetchImpl);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Configuration read failed');
        report.checks.push(check);
      }
    }
    if (component === 'application') {
      check = 'cloudflare-target-access';
      const result = await getJson(`https://api.cloudflare.com/client/v4/accounts/${environment.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/sensa-standalone/deployments`,
        {authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}`}, fetchImpl);
      if (!result.success || !Array.isArray(result.result?.deployments)) throw Error('Worker read failed');
      report.checks.push(check); check = 'current-registry-compatibility';
      const registry = await getJson(`${environment.VITE_SENSA_API_URL}/sensa/packages?bookPreview=1`, {}, fetchImpl);
      await validateRegistryImpl(registry);
      report.currentRegistryRevision = registry.revision;
      report.checks.push(check);
      if (environment.SENSA_APPLICATION_MODE === 'full') {
        check = 'migration-ledger';
        const migrations = await databaseMigrationSet(root);
        const compatibility = assertMigrationCompatibility(migrations, plan.previousRelease?.components?.application?.database);
        report.migrations = {...await inspectDatabaseImpl(environment.MIGRATION_DATABASE_URL, migrations.migrations.map(row => row.path.split('/').at(-1))), candidateSetSha256: migrations.sha256, compatibility};
        if (!report.migrations.ledgerExists && plan.previousRelease) throw Error('Existing production migration ledger required');
        report.checks.push(check); check = 'restricted-runtime-database';
        await inspectDatabaseImpl(environment.SENSA_RUNTIME_DATABASE_URL, [], true);
        report.checks.push(check);
      }
    } else {
      if (!plan.decision.deployApplication) {
        check = 'current-application-compatibility';
        await verifyApiIdentity(`${report.targets.supabaseOrigin}/functions/v1/sensa-api`, plan.previousRelease?.components?.application?.api?.releaseSha, fetchImpl);
        await validateRegistryImpl(await getJson(`${report.targets.supabaseOrigin}/functions/v1/sensa-api/sensa/packages?bookPreview=1`, {}, fetchImpl));
        report.checks.push(check);
      }
      check = 'content-storage-access';
      const bucket = await getJson(`${report.targets.supabaseOrigin}/storage/v1/bucket/sensa-learning-content`,
        {apikey: environment.SUPABASE_SECRET_KEY, authorization: `Bearer ${environment.SUPABASE_SECRET_KEY}`}, fetchImpl);
      if (bucket.id !== 'sensa-learning-content' || bucket.public !== true
        || (Array.isArray(bucket.allowed_mime_types) && ['application/json','application/zip'].some(type => !bucket.allowed_mime_types.includes(type)))) throw Error('Existing public content bucket policy required');
      report.checks.push(check);
    }
    report.status = 'ready';
  } catch {
    report.failure = {check, nextStep: 'Inspect this named check and protected configuration. Before retrying inspect the original plan, successful job outputs and exact artifact IDs; follow the recovery table in docs/sensa/engineering.md. Provider responses and credentials are omitted.'};
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const component = process.argv[2];
  try {
    const plan = JSON.parse(await readFile('.tmp/system-release-plan/system-release-plan.json', 'utf8'));
    const report = await releasePreflight({component, plan});
    await mkdir('release-candidate', {recursive: true});
    await writeFile(`release-candidate/${component}-preflight.json`, JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### ${component} preflight\n\n- Candidate: \`${report.commit}\`\n- State: ${report.status}\n- Completed: ${report.checks.join(', ')}\n${report.failure ? `- Failed: ${report.failure.check}\n- Next: ${report.failure.nextStep}\n` : ''}\n${report.limitation}\n`);
    console.log(`${component} preflight: ${report.status}${report.failure ? '; failed check: ' + report.failure.check : ''}`);
    if (report.status !== 'ready') process.exitCode = 1;
  } catch { console.error('Preflight requires an exact saved release plan and valid component.'); process.exitCode = 1; }
}
