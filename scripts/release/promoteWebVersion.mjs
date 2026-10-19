/** Re-promoting the same verified version is a read-only no-op. */
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function promoteWebVersion(version, env = process.env, fetchImpl = fetch, execute = execFileSync) {
  if (version?.format !== 'sensa-cloudflare-version-v1' || version.releaseSha !== env.SENSA_RELEASE_SHA
    || !/^[a-f0-9]{40}$/.test(env.SENSA_RELEASE_SHA ?? '') || !/^[a-f0-9-]{36}$/.test(version.versionId ?? '')
    || !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')
    || env.CLOUDFLARE_WORKER_NAME !== 'sensa-standalone' || !env.CLOUDFLARE_API_TOKEN) throw Error('Exact Web promotion identity required');
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/sensa-standalone/deployments`, {
    method: 'GET', headers: {authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`}, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('Cannot inspect current Web traffic before promotion');
  const data = await response.json(), current = data.result?.deployments?.[0];
  if (!data.success || !Array.isArray(current?.versions) || !current.versions.length) throw Error('Current Web traffic response is invalid');
  if (current.versions.length === 1 && current.versions[0].version_id === version.versionId && current.versions[0].percentage === 100) return {alreadyPromoted: true};
  execute(resolve('node_modules/.bin/wrangler'), ['versions', 'deploy', `${version.versionId}@100%`, '--name', 'sensa-standalone', '--message', `Authorized release ${env.SENSA_RELEASE_SHA}`, '-y'], {stdio: 'inherit'});
  return {alreadyPromoted: false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await promoteWebVersion(JSON.parse(await readFile('release-candidate/cloudflare-version.json', 'utf8')));
    console.log(result.alreadyPromoted ? 'Exact Web version already serves 100%; promotion skipped.' : 'Web promotion command completed; live verification remains required.');
  } catch { console.error('Web promotion failed; inspect phase evidence and exact version before retrying.'); process.exitCode = 1; }
}
