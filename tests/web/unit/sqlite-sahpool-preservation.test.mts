import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {test} from 'vitest';
import {CoordinatedSqliteAdapter,type CoordinatedSqliteBackend} from '../../../apps/web/src/data/library/sqliteCoordinator.ts';
import type {SqliteStorageDiagnostics} from '../../../apps/web/src/data/library/sqliteProtocol.ts';

import {
  closeSahPoolHandles,
  patchSqliteSahPoolInitFailure,
  preserveSahPoolAfterInitFailure,
  settleSahPoolAcquisitions,
  sqliteSahPoolPreservedInitFailureVersion,
} from '../../../apps/web/src/data/library/sqliteSahPoolInitPreserver.ts';
import {
  acquireSqliteSahPoolLease,
  assertSahPoolAccessHandlesFree,
  closeSqliteSahPoolSafely,
  observeSahPoolPageHide,
  releaseSqliteSahPoolLeaseWhenFree,
} from '../../../apps/web/src/data/library/sqlitePoolLifecycle.ts';

const pinnedSdkFixture=()=>[
  '\t\t\t\treleaseAccessHandles() {',
  '\t\t\t\t\tfor (const ah of this.#mapSAHToName.keys()) ah.close();',
  '\t\t\t\t\tthis.#mapSAHToName.clear();',
  '\t\t\t\t\tthis.#mapFilenameToSAH.clear();',
  '\t\t\t\t\tthis.#availableSAH.clear();',
  '\t\t\t\t}',
  '\t\t\t\t/**',
  'async acquireAccessHandles(clearFiles = false) {',
  '  const files = [];',
  '  return Promise.all(files.map(async ([name, h]) => {',
  '    try { const ah = await h.createSyncAccessHandle(); }',
  '    catch (e) { this.releaseAccessHandles(); throw e; }',
  '  }));',
  '}',
  '/**',
  'Given an SAH, returns the client-specified name of',
  '*/',
  '\t\t\t\tpauseVfs() {',
  '\t\t\t\t\tif (this.#mapS3FileToOFile_.size > 0) sqlite3.SQLite3Error.toss(capi.SQLITE_MISUSE, "Cannot pause VFS", this.vfsName, "because it has opened files.");',
  '\t\t\t\t\tif (this.#mapSAHToName.size > 0) {',
  '\t\t\t\t\t\tcapi.sqlite3_vfs_unregister(this.vfsName);',
  '\t\t\t\t\t\tthis.releaseAccessHandles();',
  '\t\t\t\t\t}',
  '\t\t\t\t\treturn this;',
  '\t\t\t\t}',
  '\t\t\t\t/**',
  'Returns true if this pool is currently paused else false.',
  '*/',
  '\t\t\t\tisPaused() {',
  '\t\t\t\t\treturn 0 === this.#mapSAHToName.size;',
  '\t\t\t\t}',
  '\t\t\t\t/**',
  'unpauseVfs() {}',
  '\t\t\t\t*/',
  'return thePool.isReady.then(async () => poolUtil).catch(async (e) => {',
  '  await thePool.removeVfs().catch(() => {});',
  '  throw e;',
  '});',
].join('\n');
const sqlitePackageJson=createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/package.json');
const sqliteSdkVersion=(JSON.parse(readFileSync(sqlitePackageJson,'utf8')) as {version:string}).version;
const sqliteSdkSource=readFileSync(join(dirname(sqlitePackageJson),'dist/index.mjs'),'utf8');

test('the pinned SQLite init-failure branch pauses and preserves the existing pool',()=>{
  const source=pinnedSdkFixture();
  const transformed=patchSqliteSahPoolInitFailure(source,sqliteSahPoolPreservedInitFailureVersion);
  assert.match(transformed,/__sensaPreserveSahPoolAfterInitFailure\(thePool\)/u);
  assert.match(transformed,/__sensaSettleSahPoolAcquisitions\(/u);
  assert.match(transformed,/__sensaCloseSahPoolHandles\(this\.#mapSAHToName\.keys\(\)\)/u);
  assert.match(transformed,/sqlite3_vfs_find\(this\.vfsName\) === this\.#cVfs\.pointer/u);
  assert.match(transformed,/if \(this\.#mapSAHToName\.size > 0\) this\.releaseAccessHandles\(\)/u);
  assert.match(transformed,/isPaused\(\) \{\n\s*return 0 === this\.#mapSAHToName\.size;/u);
  assert.doesNotMatch(transformed,/this\.releaseAccessHandles\(\);\n\s*\},/u);
  assert.doesNotMatch(transformed,/this\.releaseAccessHandles\(\); throw e/u);
  assert.doesNotMatch(transformed,/await thePool\.removeVfs\(\)\.catch/u);
});

test('the actual pinned SDK transform preserves isPaused and the following unpause method',()=>{
  const transformed=patchSqliteSahPoolInitFailure(sqliteSdkSource,sqliteSdkVersion);
  assert.match(transformed,/isPaused\(\) \{[\s\S]{0,160}return 0 === this\.#mapSAHToName\.size;/u);
  assert.match(transformed,/async unpauseVfs\(\) \{[\s\S]{0,160}this\.acquireAccessHandles\(false\)/u);
  assert.match(transformed,/sqlite3_vfs_find\(this\.vfsName\) === this\.#cVfs\.pointer/u);
});

test('all acquisitions settle before partial handles are closed and the failed VFS is unregistered',async()=>{
  let locked=false;
  const lockManager={request:async(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{
    locked=true;
    try{return await callback({name:'sensa-sqlite-opfs-pool-v1',mode:'exclusive'});}
    finally{locked=false;}
  }};
  const lease=await acquireSqliteSahPoolLease(lockManager as unknown as LockManager);
  const acquired:Array<{close:()=>void}>=[];
  let closedHandles=0;
  let onFailureAfter:number|undefined;
  let vfsRegistered=true;
  const initialFailure=new Error('NoModificationAllowedError');
  let finishDelayed!:()=>void;
  const delayed=new Promise<void>(resolve=>{finishDelayed=resolve;});
  const acquisitions=[
    delayed.then(()=>{acquired.push({close(){closedHandles++;}});}),
    Promise.reject(initialFailure),
  ];
  const pending=settleSahPoolAcquisitions(acquisitions,()=>{onFailureAfter=acquired.length;});
  await Promise.resolve();
  assert.equal(onFailureAfter,undefined,'a fast rejection must not clean up while another access handle is still opening');
  assert.equal(locked,true,'the physical pool lease remains held while an acquisition is still in flight');
  finishDelayed();
  await assert.rejects(pending,error=>error===initialFailure);
  assert.equal(onFailureAfter,1,'failure handling begins only after the delayed acquisition is recorded');
  const sentinel=new Map([['/library.sqlite3','committed-facts']]);
  const outcome=preserveSahPoolAfterInitFailure({pauseVfs(){
    if(vfsRegistered)vfsRegistered=false;
    closeSahPoolHandles(acquired);
  }});
  assert.deepEqual(outcome,{preserved:true});
  assert.equal(vfsRegistered,false,'a registered VFS is unregistered even after acquisition code cleared its map');
  assert.equal(closedHandles,1);
  assert.equal(sentinel.get('/library.sqlite3'),'committed-facts');
  await releaseSqliteSahPoolLeaseWhenFree({
    verifyAccessHandlesFree:async()=>{
      assert.equal(vfsRegistered,false);
      assert.equal(closedHandles,1);
    },
    releaseLease:()=>lease.release(),
  });
  assert.equal(locked,false,'the physical lease is released only after verified cleanup');
});

test('a failed SAH close does not prevent attempts to close the remaining handles',()=>{
  const attempted:string[]=[];
  const firstFailure=new Error('close_failed');
  assert.throws(()=>closeSahPoolHandles([
    {close(){attempted.push('first');throw firstFailure;}},
    {close(){attempted.push('second');}},
    {close(){attempted.push('third');}},
  ]),error=>error===firstFailure);
  assert.deepEqual(attempted,['first','second','third']);
});

test('failed initialization unregisters a zero-handle VFS without deleting pool data',()=>{
  let registered=true;
  const sentinel=new Map([['/library.sqlite3','committed-facts']]);
  const outcome=preserveSahPoolAfterInitFailure({
    pauseVfs:()=>{registered=false;},
  });
  assert.deepEqual(outcome,{preserved:true});
  assert.equal(registered,false);
  assert.equal(sentinel.get('/library.sqlite3'),'committed-facts');
});

test('the transform fails closed when SQLite version or failure branch changes',()=>{
  const source=[
    'async acquireAccessHandles(clearFiles = false) { return Promise.all(files.map(async ([name, h]) => {',
    'catch (e) { this.releaseAccessHandles(); throw e; }',
    '}); }',
    '/** Given an SAH, returns the client-specified name of */',
    'await thePool.removeVfs().catch(() => {});',
  ].join('\n');
  assert.throws(()=>patchSqliteSahPoolInitFailure(source,'3.54.0'),/version_unsupported/u);
  assert.throws(()=>patchSqliteSahPoolInitFailure('await thePool.removeVfs();',sqliteSahPoolPreservedInitFailureVersion),/acquisition_method_mismatch/u);
  assert.throws(()=>patchSqliteSahPoolInitFailure(`${source}\n${source}`,sqliteSahPoolPreservedInitFailureVersion),/acquisition_method_mismatch/u);
});

test('the native OPFS probe opens and closes handles without creating pool paths',async()=>{
  let opened=0,closed=0,createdDirectories=0;
  const file={kind:'file',async createSyncAccessHandle(){
    opened++;
    return {close(){closed++;}};
  }};
  const missing=()=>new DOMException('missing','NotFoundError');
  const opaque={
    async getDirectoryHandle(){throw missing();},
    async *entries(){yield ['a',file] as const;yield ['b',file] as const;},
  };
  const poolDirectory={
    async getDirectoryHandle(name:string){return name==='.opaque'?opaque:Promise.reject(missing());},
    async *entries(){},
  };
  const root={
    async getDirectoryHandle(name:string,options?:{create?:boolean}){
      if(options?.create)createdDirectories++;
      return name==='sensa-local-library-v12'?poolDirectory:Promise.reject(missing());
    },
    async *entries(){},
  };
  await assertSahPoolAccessHandlesFree({getDirectory:async()=>root} as unknown as StorageManager,'/sensa-local-library-v12');
  assert.deepEqual({opened,closed,createdDirectories},{opened:2,closed:2,createdDirectories:0});
});

test('the OPFS probe fails closed and still releases earlier probe handles',async()=>{
  let closed=0;
  const busy={kind:'file',async createSyncAccessHandle(){throw new DOMException('busy','NoModificationAllowedError');}};
  const available={kind:'file',async createSyncAccessHandle(){return {close(){closed++;}};}};
  const opaque={
    async getDirectoryHandle(){throw new DOMException('missing','NotFoundError');},
    async *entries(){yield ['a',available] as const;yield ['b',busy] as const;},
  };
  const poolDirectory={
    async getDirectoryHandle(name:string){return name==='.opaque'?opaque:Promise.reject(new DOMException('missing','NotFoundError'));},
    async *entries(){},
  };
  const root={
    async getDirectoryHandle(name:string){return name==='sensa-local-library-v12'?poolDirectory:Promise.reject(new DOMException('missing','NotFoundError'));},
    async *entries(){},
  };
  await assert.rejects(assertSahPoolAccessHandlesFree({getDirectory:async()=>root} as unknown as StorageManager,'/sensa-local-library-v12'),/access_handle_busy_or_unavailable/u);
  assert.equal(closed,1);
});

test('the worker lock covers DB close, pool pause and native verification before unlock',async()=>{
  let locked=false;
  const lockManager={request:async(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{
    locked=true;
    try{return await callback({name:'sensa-sqlite-opfs-pool-v1',mode:'exclusive'});}
    finally{locked=false;}
  }};
  const lease=await acquireSqliteSahPoolLease(lockManager as unknown as LockManager);
  assert.equal(locked,true);
  const order:string[]=[];
  await closeSqliteSahPoolSafely({
    closeDatabase:()=>order.push('db.close'),
    pauseVfs:()=>{order.push('pauseVfs');},
    verifyAccessHandlesFree:async()=>{order.push('native.verify');},
    releaseLease:()=>{order.push('lease.release');return lease.release();},
  });
  assert.deepEqual(order,['db.close','pauseVfs','native.verify','lease.release']);
  assert.equal(locked,false);
});

test('a failed native verification retains the physical lock; pagehide triggers graceful close',async()=>{
  let locked=false,closed=0;
  const lockManager={request:async(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{
    locked=true;
    try{return await callback({name:'sensa-sqlite-opfs-pool-v1',mode:'exclusive'});}
    finally{locked=false;}
  }};
  const lease=await acquireSqliteSahPoolLease(lockManager as unknown as LockManager);
  await assert.rejects(closeSqliteSahPoolSafely({
    closeDatabase:()=>{},
    pauseVfs:()=>{},
    verifyAccessHandlesFree:async()=>{throw new Error('still_open');},
    releaseLease:()=>lease.release(),
  }),/still_open/u);
  assert.equal(locked,true,'uncertain handles keep the worker lock');

  const target=new EventTarget();
  const remove=observeSahPoolPageHide(target,async()=>{closed++;await lease.release();});
  target.dispatchEvent(new Event('pagehide'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(closed,1);
  assert.equal(locked,false);
  remove();
});

test('pagehide cancels startup waiters and a later lifecycle reconnects without dispatching the old request',async()=>{
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const previousBroadcastChannel=Object.getOwnPropertyDescriptor(globalThis,'BroadcastChannel');
  const pageWindow=new EventTarget();
  class TestBroadcastChannel extends EventTarget{
    postMessage(_message:unknown):void{}
  }
  let ownerLocked=false;
  const locks={request:async(
    name:string,
    options:Readonly<{ifAvailable?:boolean;mode?:string}>,
    callback:(lock:unknown)=>Promise<unknown>|unknown,
  )=>{
    if(options.ifAvailable&&ownerLocked)return callback(null);
    ownerLocked=true;
    try{return await callback({name,mode:options.mode??'exclusive'});}
    finally{ownerLocked=false;}
  }};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:pageWindow});
  Object.defineProperty(globalThis,'BroadcastChannel',{configurable:true,value:TestBroadcastChannel});

  const diagnostics:SqliteStorageDiagnostics={
    engine:'sqlite-wasm',persistence:'opfs',sqliteVersion:'3.53.4',schemaVersion:12,
    journalMode:'wal',synchronous:2,lockingMode:'exclusive',
  };
  let finishFirstInitialize!:(value:SqliteStorageDiagnostics)=>void;
  let signalFirstInitialize!:()=>void;
  const firstInitialize=new Promise<SqliteStorageDiagnostics>(resolve=>{finishFirstInitialize=resolve;});
  const firstStarted=new Promise<void>(resolve=>{signalFirstInitialize=resolve;});
  const backends:Array<{initializeCalls:number;closeCalls:number}>=[];
  const adapter=new CoordinatedSqliteAdapter(()=>{
    const index=backends.length;
    const state={initializeCalls:0,closeCalls:0};
    backends.push(state);
    const backend={
      async initialize(){
        state.initializeCalls++;
        if(index===0){signalFirstInitialize();return firstInitialize;}
        return diagnostics;
      },
      async close(){state.closeCalls++;},
    } as unknown as CoordinatedSqliteBackend;
    return backend;
  });
  const oldRequest=adapter.initialize();
  const oldOutcome=oldRequest.then(
    value=>({status:'resolved' as const,value}),
    cause=>({status:'rejected' as const,message:cause instanceof Error?cause.message:String(cause)}),
  );
  try{
    await firstStarted;
    pageWindow.dispatchEvent(new Event('pagehide'));
    const close=adapter.close();
    finishFirstInitialize(diagnostics);
    await close;
    const resumedDiagnostics=await adapter.initialize();
    const previousOutcome=await oldOutcome;
    assert.deepEqual(resumedDiagnostics,diagnostics);
    assert.deepEqual(previousOutcome,{status:'rejected',message:'sqlite_owner_lifecycle_closed'});
    assert.equal(backends.length,2);
    assert.equal(backends[1]!.initializeCalls,2,'one startup initialize and one resumed call are expected; the old lifecycle must not add a late dispatch');
    assert.equal(backends[0]!.closeCalls,1,'pagehide closes a backend whose startup was in flight');
  }finally{
    finishFirstInitialize(diagnostics);
    await adapter.close().catch(()=>undefined);
    const restore=(name:string,descriptor:PropertyDescriptor|undefined)=>{
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else Reflect.deleteProperty(globalThis,name);
    };
    restore('navigator',previousNavigator);
    restore('window',previousWindow);
    restore('BroadcastChannel',previousBroadcastChannel);
  }
});
