/** Production browsers must never turn a missing persistence capability into a successful memory library. */
import assert from 'node:assert/strict';

delete process.env.SENSA_TEST_MEMORY_LIBRARY;
Object.defineProperty(globalThis,'document',{value:{},configurable:true});
Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
const setNavigator=(value:Record<string,unknown>)=>Object.defineProperty(globalThis,'navigator',{value,configurable:true});
const remove=(key:'Worker'|'BroadcastChannel')=>Reflect.deleteProperty(globalThis,key);

const store=await import('../../../apps/web/src/data/library/store.ts');
const persistence=await import('../../../apps/web/src/data/library/storagePersistence.ts');
const rejectsVolatileFallback=async(label:string)=>{
 await assert.rejects(store.openLibrary(),error=>error instanceof Error&&error.message==='localFlow.storageUnsupported',label);
};

remove('Worker');setNavigator({storage:{getDirectory(){}}});
await rejectsVolatileFallback('a browser without Worker support must not receive a memory library');

Object.defineProperty(globalThis,'Worker',{value:class {},configurable:true});setNavigator({storage:{}});
await rejectsVolatileFallback('a browser without OPFS must not receive a memory library');

setNavigator({storage:{getDirectory(){}}});
await rejectsVolatileFallback('a browser without Web Locks must not receive a memory library');

setNavigator({storage:{getDirectory(){}},locks:{request:(_name:string,_options:unknown,work:()=>Promise<unknown>)=>work()}});remove('BroadcastChannel');
await rejectsVolatileFallback('a browser without cross-tab coordination must not receive a memory library');

setNavigator({storage:{estimate:async()=>({usage:8*1024*1024,quota:64*1024*1024})}});
assert.deepEqual(await persistence.readLocalStorageBudget(),{usageBytes:8*1024*1024,quotaBytes:64*1024*1024});
setNavigator({storage:{estimate:async()=>({usage:undefined,quota:undefined})}});
assert.equal(await persistence.readLocalStorageBudget(),null,'an unavailable browser estimate is not presented as zero usage');

console.log('PASS: missing Worker, OPFS, Web Locks or BroadcastChannel refuses the local library instead of reporting volatile saves.');
