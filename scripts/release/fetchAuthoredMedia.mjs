/** Fetch an explicitly selected immutable input; never publish or print its contents. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';

const env = process.env;
const tag = env.SENSA_MEDIA_RELEASE_TAG ?? '', digest = env.SENSA_MEDIA_PACK_SHA256 ?? '';
if (!/^sensa-learning-media-[a-f0-9]{12,64}$/.test(tag) || !/^[a-f0-9]{64}$/.test(digest)
  || !digest.startsWith(tag.slice('sensa-learning-media-'.length))) throw Error('Exact sealed media tag and digest required');
await mkdir('.tmp', {recursive: true});
execFileSync('gh', ['release', 'download', tag, '--repo', env.GITHUB_REPOSITORY, '--pattern', 'authored-media-pack.json', '--dir', '.tmp'], {stdio: 'pipe'});
const bytes = await readFile('.tmp/authored-media-pack.json');
if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error('Sealed authored media pack digest mismatch');
console.log('Verified sealed authored media input.');
