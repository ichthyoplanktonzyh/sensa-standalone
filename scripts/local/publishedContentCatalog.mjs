import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalConsumerJson,sensaPortableLearningContentRegistrySchema} from '@sensa/contracts/sensa';

/** Read public content only; account, model and learner requests remain local. */
export async function loadPublishedContentCatalog(input,fetcher=globalThis.fetch){
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash){
  throw new Error('A public HTTPS content catalog URL without credentials or query is required');
 }
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw new Error(`Public content catalog unavailable: ${response.status}`);
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>2*1024*1024){await reader.cancel();throw new Error('Public content catalog exceeds the local preview budget');}
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 const catalog=sensaPortableLearningContentRegistrySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 const {revision,...snapshot}=catalog;
 const digest=createHash('sha256').update(canonicalConsumerJson(snapshot)).digest('hex');
 if(digest!==revision)throw new Error('Public content catalog revision mismatch');
 return canonicalConsumerJson(catalog);
}

/** Large registries exceed Linux's per-environment-string exec limit. */
export function writeLocalCatalogSnapshot(runtimeRoot,catalog){
 const directory=mkdtempSync(join(runtimeRoot,'catalog-'));
 const path=join(directory,'registry.json');
 writeFileSync(path,catalog,{encoding:'utf8',mode:0o600,flag:'wx'});
 return path;
}
