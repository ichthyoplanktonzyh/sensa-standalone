import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,lstat,readdir,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';

export function retentionCapacityCacheKey(targets:number,sources:Readonly<Record<string,string|Uint8Array>>,runtime=process.versions.node){
  if(!Number.isSafeInteger(targets)||targets<1||targets>10000)throw Error('Invalid retention fixture size');
  const hash=createHash('sha256').update(JSON.stringify(['sensa-retention-fixture-cache-v1',targets,runtime,process.platform,process.arch]));
  for(const [path,bytes] of Object.entries(sources).sort(([a],[b])=>a.localeCompare(b)))hash.update('\0'+path+'\0').update(bytes);
  return hash.digest('hex');
}

/** Cache contains data only. Every hit must pass today's full replay validator;
 * neither a cache hit nor its original validation is current test evidence. */
export async function prepareRetentionCapacityCache(input:{
  key:string;targets:number;root?:string;
  generate:()=>Promise<string>;verify:(directory:string)=>Promise<void>;
}){
  if(!/^[0-9a-f]{64}$/u.test(input.key)||!Number.isSafeInteger(input.targets)||input.targets<1||input.targets>10000)throw Error('Invalid retention cache identity');
  const root=resolve(input.root??'.tmp');
  await mkdir(root,{recursive:true});
  const directory=join(root,`retention-capacity-facts-ci-${input.targets}-${input.key}`);
  let exists=false;
  try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Capacity cache is not a data directory');exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const assertDataOnly=async(path:string)=>{
    for(const entry of await readdir(path,{withFileTypes:true}))if(!entry.isFile()||!entry.name.endsWith('.json'))throw Error('Capacity cache must contain flat JSON data only');
  };
  if(exists){
    await assertDataOnly(directory);
    const provenance=JSON.parse(await readFile(join(directory,'cache-provenance.json'),'utf8'));
    if(provenance.format!=='sensa-retention-fixture-cache-v1'||provenance.key!==input.key||provenance.targets!==input.targets)throw Error('Capacity cache provenance mismatch');
  }else{
    const generated=resolve(await input.generate());
    if(!generated.startsWith(root+'/retention-capacity-facts-')||generated===directory)throw Error('Generator returned a non-isolated fixture');
    const info=await lstat(generated);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Generated fixture is not a data directory');
    await assertDataOnly(generated);
    // Validate the original before publishing a cache copy. Existing targets
    // are never cleared or overwritten, including incomplete prior preparation.
    await input.verify(generated);
    await mkdir(directory);
    for(const name of await readdir(generated))await copyFile(join(generated,name),join(directory,name),constants.COPYFILE_EXCL);
    await writeFile(join(directory,'cache-provenance.json'),JSON.stringify({format:'sensa-retention-fixture-cache-v1',key:input.key,targets:input.targets})+'\n',{flag:'wx'});
  }
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  if(manifest.format!=='sensa-retention-capacity-facts-v1'||manifest.targets!==input.targets)throw Error('Capacity cache manifest differs from requested size');
  await input.verify(directory);
  return {directory,cacheHit:exists,key:input.key,targets:input.targets};
}
