import {appendFile,readFile,writeFile} from 'node:fs/promises';

const source=process.env.WRANGLER_OUTPUT_FILE_PATH;
if(!source)throw Error('WRANGLER_OUTPUT_FILE_PATH is required');
const lines=(await readFile(source,'utf8')).split(/\r?\n/u).filter(Boolean);
const rows=lines.map(line=>{try{return JSON.parse(line);}catch{throw Error('Wrangler output was not JSON lines: '+line.slice(0,200));}});
const upload=rows.findLast(row=>row.type==='version-upload');
const secure=value=>{if(typeof value!=='string')return false;try{return new URL(value).protocol==='https:';}catch{return false;}};
// `versions upload` records the version identity and its preview URL directly; older
// Wrangler builds reported `targets` only, so both shapes stay accepted here.
const previewCandidates=upload?[upload.preview_url,upload.preview_alias_url,...(Array.isArray(upload.targets)?upload.targets:[])]:[];
const previewUrl=previewCandidates.find(secure);
if(!upload||typeof upload.version_id!=='string'||!previewUrl){
 // Nothing here is secret: these rows carry ids, names and URLs only.
 console.error('Wrangler version-upload row: '+JSON.stringify(upload??null));
 throw Error('Wrangler did not record an uploaded Worker version with a secure preview URL');
}
const evidence={format:'sensa-cloudflare-version-v1',releaseSha:process.env.SENSA_RELEASE_SHA,versionId:upload.version_id,previewUrl,createdAt:new Date().toISOString()};
await writeFile('release-candidate/cloudflare-version.json',JSON.stringify(evidence,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`version_id=${upload.version_id}\npreview_url=${previewUrl}\n`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`### Cloudflare version\n\n- Release: \`${process.env.SENSA_RELEASE_SHA}\`\n- Version: \`${upload.version_id}\`\n- Preview: ${previewUrl}\n`);
console.log(`Recorded Cloudflare Worker version ${upload.version_id}.`);
