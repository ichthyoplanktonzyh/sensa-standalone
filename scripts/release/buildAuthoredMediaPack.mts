/** Build one sealed, out-of-Git media input for a protected content release. */
import {createHash} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createAuthoredMediaPackager,type AuthoredMediaPackObject,type AuthoredMediaReference} from './authoredMedia.mts';

const configuredSources=process.env.SENSA_BOOK_RELEASE_SOURCES?.trim();
const configuredSourceDirectory=process.env.SENSA_BOOK_RELEASE_SOURCE_DIRECTORY?.trim();
if(configuredSources&&configuredSourceDirectory)throw Error('Configure a source list or one source directory, not both');
const sourceDirectory=configuredSourceDirectory??'content/authored';
const sourcePaths=configuredSources
 ?configuredSources.split(',').map(value=>value.trim()).filter(Boolean)
 :(await readdir(sourceDirectory,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&entry.name.endsWith('.json'))
  .map(entry=>sourceDirectory+'/'+entry.name);
if(!sourcePaths.length||new Set(sourcePaths).size!==sourcePaths.length)throw Error('Explicit unique authored Book release sources required');

const references=new Map<string,AuthoredMediaReference>();
const collect=(value:unknown)=>{
 if(value==null||typeof value!=='object')return;
 if(Array.isArray(value)){for(const item of value)collect(item);return;}
 const object=value as Record<string,unknown>,keys=Object.keys(object).sort().join(',');
 if(keys==='mimeType,sha256'){
  const reference={sha256:object.sha256,mimeType:object.mimeType} as AuthoredMediaReference,key=`${reference.mimeType}:${reference.sha256}`;
  references.set(key,reference);return;
 }
 for(const child of Object.values(object))collect(child);
};
for(const path of sourcePaths.sort())collect(JSON.parse(await readFile(path,'utf8')));
if(!references.size)throw Error('Authored sources do not contain content-addressed media');

const media=await createAuthoredMediaPackager({mediaRoot:resolve(process.env.SENSA_AUTHORED_MEDIA_ROOT??'content/data/media')});
const objects:AuthoredMediaPackObject[]=[];
for(const [key,reference] of [...references.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0)){
 const dataUrl=await media.embed(reference,`media-pack:${key}`);if(!dataUrl)throw Error(`Authored media is missing: ${key}`);
 objects.push({...reference,base64:dataUrl.slice(dataUrl.indexOf(',')+1)});
}
const bytes=Buffer.from(JSON.stringify({format:'sensa-authored-media-pack-v1',objects})+'\n'),output=resolve(process.env.SENSA_AUTHORED_MEDIA_PACK_OUTPUT??'release-candidate/authored-media-pack.json');
await mkdir(dirname(output),{recursive:true});await writeFile(output,bytes);
console.log(`Built sealed authored media pack with ${objects.length} object(s); sha256 ${createHash('sha256').update(bytes).digest('hex')}. No media generation or provider call was performed.`);
