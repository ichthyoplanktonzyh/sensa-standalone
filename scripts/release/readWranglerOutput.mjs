import {appendFile,readFile,writeFile} from 'node:fs/promises';

const source=process.env.WRANGLER_OUTPUT_FILE_PATH;
if(!source)throw Error('WRANGLER_OUTPUT_FILE_PATH is required');
const rows=(await readFile(source,'utf8')).split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
const upload=rows.findLast(row=>row.type==='version-upload');
if(!upload||typeof upload.version_id!=='string'||!Array.isArray(upload.targets))throw Error('Wrangler did not record an uploaded Worker version');
const previewUrl=upload.targets.find(value=>{try{return new URL(value).protocol==='https:';}catch{return false;}});
if(!previewUrl)throw Error('Wrangler did not record a secure Worker preview URL');
const evidence={format:'sensa-cloudflare-version-v1',releaseSha:process.env.SENSA_RELEASE_SHA,versionId:upload.version_id,previewUrl,createdAt:new Date().toISOString()};
await writeFile('release-candidate/cloudflare-version.json',JSON.stringify(evidence,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`version_id=${upload.version_id}\npreview_url=${previewUrl}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`### Cloudflare version\n\n- Release: \`${process.env.SENSA_RELEASE_SHA}\`\n- Version: \`${upload.version_id}\`\n- Preview: ${previewUrl}\n`);
console.log(`Recorded Cloudflare Worker version ${upload.version_id}.`);
