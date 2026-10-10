/** Exact-key GitHub Actions cache preparation, using the existing formal
 * generator and full domain validator. No provider calls or executable cache. */
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {retentionCapacityCacheKey,prepareRetentionCapacityCache} from './support/retentionCapacityCache.mts';

const targets=Number(process.argv.find(arg=>arg.startsWith('--targets='))?.slice(10)??1000);
if(process.argv.slice(2).some(arg=>!arg.startsWith('--targets=')&&arg!=='--key'&&arg!=='--prepare'))throw Error('Use --key or --prepare and --targets=N');
if(process.argv.includes('--key')===process.argv.includes('--prepare'))throw Error('Choose exactly one cache preparation mode');
const started=performance.now();
const built=await build({entryPoints:['scripts/support/generateRetentionCapacityFacts.mts','scripts/support/verifyRetentionCapacityFacts.mts'],outdir:'.tmp/retention-cache-fingerprint',bundle:true,write:false,metafile:true,packages:'external',platform:'node',format:'esm',target:'es2022',define:{'import.meta.env':'{}'},logLevel:'silent'});
const paths=new Set([...Object.keys(built.metafile!.inputs).filter(path=>!/^<.*>$/u.test(path)),'package-lock.json','scripts/generateRetentionCapacity.mts','scripts/verifyRetentionCapacity.mts','scripts/prepareRetentionCapacity.mts','scripts/support/retentionCapacityCache.mts']);
// Workspace packages are external in the Node bundle. Include their source,
// not only the installed-version lock, so internal kernel/schema changes miss.
async function visit(directory:string){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())await visit(path);else if(entry.isFile())paths.add(path);
  }
}
for(const entry of await readdir('packages',{withFileTypes:true}))if(entry.isDirectory())await visit(join('packages',entry.name,'src'));
const sources=Object.fromEntries(await Promise.all([...paths].map(async path=>[relative(process.cwd(),resolve(path)),await readFile(path)])));
const key=retentionCapacityCacheKey(targets,sources);
const directory=`.tmp/retention-capacity-facts-ci-${targets}-${key}`;
if(process.argv.includes('--key')){
  // Only safe generated identities go to GITHUB_OUTPUT; never env or content.
  console.log(`key=${key}\ndirectory=${directory}`);
}else{
  if(process.env.SENSA_TEST_MEMORY_LIBRARY!=='true')throw Error('Isolated fixture preparation must be explicitly enabled');
  const run=(script:string,args:string[])=>execFileSync(process.execPath,['--import','tsx',script,...args],{env:{...process.env,SENSA_TEST_MEMORY_LIBRARY:'true'},encoding:'utf8',maxBuffer:32*1024*1024});
  const result=await prepareRetentionCapacityCache({key,targets,
    generate:async()=>{
      const log=run('scripts/generateRetentionCapacity.mts',[`--targets=${targets}`]);
      console.log(log.trim());
      const generated=log.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.stage==='validated_snapshot');
      if(typeof generated?.directory!=='string')throw Error('Generator did not return validated facts');
      return generated.directory;
    },
    verify:async path=>{console.log(run('scripts/verifyRetentionCapacity.mts',[`--fixture=${path}`]).trim());},
  });
  console.log(JSON.stringify({stage:'current_capacity_fixture_prepared',...result,elapsedMs:Math.round(performance.now()-started)}));
}
