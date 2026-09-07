import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const release=JSON.parse(await readFile(path.join(root,'apps/web/src/experience/content/releases/golden-learning-release-v1.json'),'utf8'));
const source=path.resolve(root,process.env.SENSA_WEB_MEDIA_ROOT??'content/data/media/audio');
const output=path.join(root,'apps/web/public/golden-audio');
const assets=await Promise.all(release.media.filter(item=>item.kind==='audio').map(async item=>{
  const digest=item.uri.replace('content://sha256/','');
  if(!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid packaged audio URI: '+item.mediaKey);
  const bytes=await readFile(path.join(source,digest+'.mp3')).catch(()=>{throw Error('Missing approved audio '+item.mediaKey+'. Provision SENSA_WEB_MEDIA_ROOT before starting or building Web.');});
  if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Packaged audio hash mismatch: '+item.mediaKey);
  return {digest,bytes};
}));
await mkdir(output,{recursive:true});
for(const {digest,bytes} of assets)await writeFile(path.join(output,digest+'.mp3'),bytes);
console.log('Prepared '+assets.length+' verified learning audio assets. No generation or provider calls.');
