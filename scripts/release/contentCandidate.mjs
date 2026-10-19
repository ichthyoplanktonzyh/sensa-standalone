/** Seal once before any production write, then verify the exact file set on retries. */
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const roots = ['.tmp/learning-content/releases', 'packages/contracts/dist', 'packages/learning-kernel/dist',
  'packages/content-validator/dist', 'packages/model-runtime/dist'];
const catalogPath = 'release-candidate/portable-catalog.json';
const manifestPath = 'release-candidate/content-candidate.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileSet(root) {
  const files = [catalogPath];
  async function visit(path) {
    for (const entry of await readdir(resolve(root, path), {withFileTypes: true})) {
      const name = path + '/' + entry.name;
      if (entry.name.startsWith('.')) throw Error('Content candidate contains a hidden file or directory');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw Error('Content candidate contains a non-regular file');
    }
  }
  for (const directory of roots) await visit(directory);
  return files.sort();
}
export async function contentCandidate(mode, env = process.env, root = process.cwd()) {
  const commit = env.SENSA_RELEASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[a-f0-9]{64}$/.test(env.SENSA_MEDIA_PACK_SHA256 ?? '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !env.GITHUB_REPOSITORY) throw Error('Exact content build identity required');
  const paths = await fileSet(root), files = [];
  for (const path of paths) {
    const bytes = await readFile(resolve(root, path));
    files.push({path, bytes: bytes.length, sha256: hash(bytes)});
  }
  const catalog = JSON.parse(await readFile(resolve(root, catalogPath), 'utf8'));
  const plan = JSON.parse(await readFile(resolve(root, '.tmp/system-release-plan/system-release-plan.json'), 'utf8'));
  if (plan.source?.commit !== commit || plan.authorization?.outcome !== 'approved' || !plan.decision?.publishLearningContent
    || plan.inputs?.learningContent?.sha256 !== env.SENSA_MEDIA_PACK_SHA256
    || !/^sensa-system-[a-f0-9]{12}-[1-9][0-9]*-[1-9][0-9]*$/.test(plan.releaseId ?? '')
    || plan.releaseId.split('-').at(-2) !== env.GITHUB_RUN_ID
    || !/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF ?? '')) throw Error('Exact authorized content plan and target required');
  const identity = {format: 'sensa-content-candidate-v1', commit, repository: env.GITHUB_REPOSITORY,
    workflowRunId: env.GITHUB_RUN_ID, buildAttempt: env.SENSA_CONTENT_BUILD_ATTEMPT ?? env.GITHUB_RUN_ATTEMPT,
    mediaPackSha256: env.SENSA_MEDIA_PACK_SHA256, projectRef: env.SUPABASE_PROJECT_REF,
    releaseId: plan.releaseId, planSha256: hash(JSON.stringify(plan)), registryRevision: catalog.revision, files};
  if (!/^[1-9][0-9]*$/.test(identity.buildAttempt ?? '') || !/^[a-f0-9]{64}$/.test(catalog.revision ?? '') || paths.length < 2) throw Error('Incomplete content candidate');
  if (mode === 'seal') {
    await mkdir(resolve(root, 'release-candidate'), {recursive: true});
    await writeFile(resolve(root, manifestPath), JSON.stringify(identity, null, 2) + '\n', {flag: 'wx'});
  } else if (mode === 'verify') {
    const sealed = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8'));
    if (JSON.stringify(sealed) !== JSON.stringify(identity)) throw Error('Content candidate identity, file set or digest mismatch');
  } else throw Error('Expected seal or verify');
  return identity;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  contentCandidate(process.argv[2]).then(result => console.log(`Verified ${result.files.length} content candidate files for ${result.commit}.`))
    .catch(() => {console.error('Content candidate verification failed; restore the exact preflight artifact, do not rebuild in publish.'); process.exitCode = 1;});
}
