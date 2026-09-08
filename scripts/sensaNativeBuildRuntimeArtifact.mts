// Local packaging only: no publication, generation, model or network calls.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {validateRuntimeLearningRelease} from '../packages/content-validator/src/runtimeLearningReleaseValidator.ts';
const output=process.argv[2];if(!output)throw Error('Supply an explicit output path outside the repository.');
const path=resolve(output);if(path.startsWith(resolve('.')+'/'))throw Error('Runtime content artifacts must remain outside the repository.');
const input=JSON.parse(await readFile('apps/web/src/experience/content/releases/golden-learning-release-v1.json','utf8'));
const admitted=validateRuntimeLearningRelease(input);if(admitted.status!=='satisfied')throw Error('Installed release failed validation');
const release=admitted.release!;
const media=await Promise.all(release.media.map(async m=>{const digest=m.uri.slice('content://sha256/'.length);const bytes=await readFile(`apps/web/public/golden-audio/${digest}.mp3`);if(`sha256:${createHash('sha256').update(bytes).digest('hex')}`!==m.sha256)throw Error(`Media digest mismatch: ${m.mediaKey}`);return {mediaKey:m.mediaKey,bytesBase64:bytes.toString('base64')};}));
await writeFile(path,JSON.stringify({format:'sensa-runtime-artifact-v1',release,media})+'\n');console.log(`Packaged ${release.packages.length} learning materials and ${media.length} verified local media assets to ${path}`);
