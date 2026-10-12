/** Specialized read-only proof of the authorized build-time isolation boundary. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {decodedFactBudgetExperiment} from './decodedFactBudgetExperiment.mts';
const path='apps/web/src/data/library/cloudSync.ts';
const source=await readFile(path,'utf8'),baseline=execFileSync('git',['show','2250269b:'+path],{encoding:'utf8'});
assert.equal(source,baseline,'Production sync source changed from assessed baseline');
const previous=process.env.SENSA_CAPACITY_EXPERIMENT;
try{
 delete process.env.SENSA_CAPACITY_EXPERIMENT;assert.throws(()=>decodedFactBudgetExperiment(128));
 process.env.SENSA_CAPACITY_EXPERIMENT='true';assert.throws(()=>decodedFactBudgetExperiment(129));assert.throws(()=>decodedFactBudgetExperiment(64));
 const experiment=decodedFactBudgetExperiment(128),transform=experiment.plugin.transform as any;
 const result=transform(source,'/'+path);experiment.assertApplied();
 assert.equal(result.code,source.replace('if(decodedSize>DECODED_CAP)','if(decodedSize>134217728)'));
 assert(result.code.includes('const DECODED_CAP=64*1024*1024;'));assert(result.code.includes('if(size>DECODED_CAP)'));
 const report={productionSourceUnchanged:true,productionSourceSha256:createHash('sha256').update(source).digest('hex'),explicitGateRequired:true,above128Rejected:true,onlyPrepareComparisonChanged:true,downloadDefaultStill64MiB:true,metadata:experiment.metadata};
 await writeFile('output/playwright/long-term-capacity-2250269b-20261012/prepare-budget-isolation-proof.json',JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify(report));
}finally{if(previous===undefined)delete process.env.SENSA_CAPACITY_EXPERIMENT;else process.env.SENSA_CAPACITY_EXPERIMENT=previous;}
