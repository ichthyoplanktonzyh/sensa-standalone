/** Assessment-only in-memory Vite transform. Production source stays unchanged.
 * Only prepare's newly encoded logical-fact budget is overridden; download,
 * block decompression, manifests, backups, packages and authority are untouched. */
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';
export function decodedFactBudgetExperiment(mib:number){
 if(process.env.SENSA_CAPACITY_EXPERIMENT!=='true'||!Number.isSafeInteger(mib)||mib<=64||mib>128)throw Error('Explicit isolated capacity experiment required; prepare cap must be65..128MiB');
 const metadata={mode:'isolated assessment build only; not production configuration',prepareDecodedFactCapBytes:mib*1048576,productionDefaultDecodedFactCapBytes:64*1048576,fallbackDownloadDecodedFactCapBytes:64*1048576,applications:0,originalSourceSha256:'',transformedSourceSha256:''};
 const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
 const plugin:Plugin={name:'assessment-prepare-decoded-budget',enforce:'pre',transform(code,id){
  if(!id.endsWith('/apps/web/src/data/library/cloudSync.ts'))return;
  const needle='if(decodedSize>DECODED_CAP)',constant='const DECODED_CAP=64*1024*1024;';
  if(!code.includes(constant)||code.split(needle).length!==2||!code.includes('async prepare(entries:Entry[])'))throw Error('Production prepare budget changed; experiment needs review');
  metadata.applications++;if(metadata.applications!==1)throw Error('Unexpected duplicate budget transform');
  const transformed=code.replace(needle,`if(decodedSize>${metadata.prepareDecodedFactCapBytes})`);
  metadata.originalSourceSha256=digest(code);metadata.transformedSourceSha256=digest(transformed);
  return {code:transformed,map:null};
 }};
 return {plugin,metadata,assertApplied(){if(metadata.applications!==1)throw Error('Assessment prepare budget override was not applied');}};
}
