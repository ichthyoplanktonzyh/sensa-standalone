import {test,expect} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createWebTestBuildCache,loopbackTestPort,rememberLoopbackTestPort} from '../support/webTestBuild';
import {retentionCapacityCacheKey,prepareRetentionCapacityCache} from '../../../scripts/support/retentionCapacityCache.mts';
import {observeLibrarySmoke} from '../support/librarySmokeObservation';
const readRestoringSyncStatus=async(read:()=>Promise<string>)=>{
 const bridge={syncStatus:read,cloudSyncStateForTest:async()=>undefined,cloudCheckpointForTest:async()=>({state:undefined,refs:[]}),durableBackupFactsForTest:async()=>({}),seedSemanticWorld:async()=>0};
 const result=await observeLibrarySmoke({operation:'status',allowNativeReplacement:true},()=>bridge);
 return result.state==='ready'?result.value:result.state;
};

test('restore observation retries only a retired read and never manufactures a successful state',async()=>{
 await expect(readRestoringSyncStatus(async()=>{throw Error('localFlow.libraryReplaced');})).resolves.toBe('library-replacing');
 for(const status of ['none','syncing','failed','synced'])await expect(readRestoringSyncStatus(async()=>status)).resolves.toBe(status);
 for(const message of ['localFlow.storageOpen','localFlow.wrongAccount','other localFlow.libraryReplaced error']){
  await expect(readRestoringSyncStatus(async()=>{throw Error(message);})).rejects.toThrow(message);
 }
});

test('exact immutable Web builds reuse only configuration, never test server or mutable data',async()=>{
  let builds=0;
  const directories:string[]=[];
  const cache=createWebTestBuildCache(async(directory,env)=>{
    expect(env.NODE_ENV).toBe('production');builds++;
    directories.push(directory);await mkdir(directory);await writeFile(join(directory,'index.html'),'fixture build');
  });
  try{
    const a=await cache({VITE_SENSA_API_URL:'http://127.0.0.1:40001',VITE_SENSA_BROWSER_SMOKE:'true'});
    const b=await cache({VITE_SENSA_BROWSER_SMOKE:'true',VITE_SENSA_API_URL:'http://127.0.0.1:40001'});
    const c=await cache({VITE_SENSA_API_URL:'http://127.0.0.1:40002',VITE_SENSA_BROWSER_SMOKE:'true'});
    expect(a).toBe(b);expect(c).not.toBe(a);expect(builds).toBe(2);
    expect(await readFile(join(a,'index.html'),'utf8')).toBe('fixture build');
    const role=crypto.randomUUID(),first=createServer((_req,res)=>res.end('first'));
    first.listen(loopbackTestPort(role),'127.0.0.1');await once(first,'listening');
    const origin=rememberLoopbackTestPort(role,first);
    expect(await (await fetch(origin)).text()).toBe('first');
    await new Promise<void>(done=>first.close(()=>done()));
    const second=createServer((_req,res)=>res.end('independent second'));
    try{
      second.listen(loopbackTestPort(role),'127.0.0.1');await once(second,'listening');
      expect(rememberLoopbackTestPort(role,second)).toBe(origin);
      expect(await (await fetch(origin)).text()).toBe('independent second');
    }finally{await new Promise<void>(done=>second.close(()=>done()));}
  }finally{for(const directory of directories)await rm(resolve(directory,'..'),{recursive:true,force:true});}
});

test('capacity cache keys bind size, dependency bytes and runtime, independent of enumeration order',()=>{
  const key=retentionCapacityCacheKey(1000,{a:'kernel',b:'schema'},'24.1');
  expect(retentionCapacityCacheKey(1000,{b:'schema',a:'kernel'},'24.1')).toBe(key);
  expect(retentionCapacityCacheKey(1000,{a:'changed',b:'schema'},'24.1')).not.toBe(key);
  expect(retentionCapacityCacheKey(2000,{a:'kernel',b:'schema'},'24.1')).not.toBe(key);
  expect(retentionCapacityCacheKey(1000,{a:'kernel',b:'schema'},'26.1')).not.toBe(key);
  for(const count of [0,-1,10001,NaN])expect(()=>retentionCapacityCacheKey(count,{})).toThrow();
});

test('cached data must be revalidated, mismatch/corruption fail without regeneration or overwrite',async()=>{
  await mkdir(resolve('.tmp'),{recursive:true});
  const root=await mkdtemp(resolve('.tmp/fixture-cache-test-'));
  let generated=0,verified=0;
  const key=retentionCapacityCacheKey(2,{a:'test-fixture'});
  const prepare=()=>prepareRetentionCapacityCache({root,key,targets:2,
    generate:async()=>{
      generated++;const directory=await mkdtemp(join(root,'retention-capacity-facts-'));
      await writeFile(join(directory,'manifest.json'),JSON.stringify({format:'sensa-retention-capacity-facts-v1',targets:2}));
      await writeFile(join(directory,'facts-0.json'),'inert fixture data');return directory;
    },
    verify:async directory=>{verified++;expect(await readFile(join(directory,'facts-0.json'),'utf8')).toBe('inert fixture data');},
  });
  try{
    const fresh=await prepare();expect(fresh.cacheHit).toBe(false);expect(verified).toBe(2);
    const hit=await prepare();expect(hit).toMatchObject({directory:fresh.directory,cacheHit:true});expect(generated).toBe(1);expect(verified).toBe(3);
    const provenance=await readFile(join(hit.directory,'cache-provenance.json'),'utf8');
    await writeFile(join(hit.directory,'facts-0.json'),'corrupted');
    await expect(prepare()).rejects.toThrow();expect(generated).toBe(1);
    expect(await readFile(join(hit.directory,'cache-provenance.json'),'utf8')).toBe(provenance);
    await writeFile(join(hit.directory,'cache-provenance.json'),JSON.stringify({format:'sensa-retention-fixture-cache-v1',key:'wrong',targets:2}));
    await expect(prepare()).rejects.toThrow('provenance mismatch');expect(generated).toBe(1);
    await writeFile(join(hit.directory,'cache-provenance.json'),provenance);
    await symlink(join(hit.directory,'manifest.json'),join(hit.directory,'linked.json'));
    await expect(prepare()).rejects.toThrow('flat JSON data only');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cache preparation never accepts an owner/non-fixture directory',async()=>{
  await expect(prepareRetentionCapacityCache({key:'a'.repeat(64),targets:2,generate:async()=>process.cwd(),verify:async()=>{throw Error('Must not read owner data');}})).rejects.toThrow('non-isolated fixture');
});
