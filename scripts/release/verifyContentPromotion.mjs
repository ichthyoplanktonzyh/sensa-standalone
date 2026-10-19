/** Public readback after promotion; command success alone is insufficient. */
import {readFile, appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fetchEventually} from './hostedChecks.mjs';
import {canonicalConsumerJson, sensaPortableLearningContentRegistrySchema} from '@sensa/contracts/sensa';
export async function verifyContentPromotion(catalog, project, fetchImpl = fetch, {requireMatch = true} = {}) {
  if (!/^[a-z0-9]{20}$/.test(project ?? '')) throw Error('Exact content project required');
  const response = await fetchEventually(`https://${project}.supabase.co/functions/v1/sensa-api/sensa/packages?bookPreview=1`,
    {redirect: 'error', headers: {'cache-control': 'no-cache'}}, response => response.ok, 'Promoted catalog unavailable', {fetchImpl});
  const actual = sensaPortableLearningContentRegistrySchema.parse(await response.json());
  const {revision, ...snapshot} = actual;
  if (createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex') !== revision) throw Error('Live catalog digest is invalid');
  const verified = canonicalConsumerJson(actual) === canonicalConsumerJson(catalog);
  if (requireMatch && !verified) throw Error('Live catalog does not match sealed content bytes');
  return {registryRevision: revision, verified};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const check = process.argv[2] === 'check';
    const report = await verifyContentPromotion(JSON.parse(await readFile('release-candidate/portable-catalog.json', 'utf8')), process.env.SUPABASE_PROJECT_REF, fetch, {requireMatch:!check});
    if (check && process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `already_promoted=${report.verified}\n`);
    console.log(report.verified ? 'Verified promoted Registry snapshot.' : 'Current Registry differs; authorized promotion is still required.');
  } catch { console.error('Promoted Registry readback failed; publication is not verified.'); process.exitCode = 1; }
}
