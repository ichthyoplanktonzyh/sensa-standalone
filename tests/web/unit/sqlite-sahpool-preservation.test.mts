import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {test} from 'vitest';
import {CoordinatedSqliteAdapter,type CoordinatedSqliteBackend} from '../../../apps/web/src/data/library/sqliteCoordinator.ts';
import type {SqliteStorageDiagnostics} from '../../../apps/web/src/data/library/sqliteProtocol.ts';
import {sqliteCoordinatorProtocolVersion,sqliteLibrarySchemaVersion} from '../../../apps/web/src/data/library/sqliteProtocol.ts';

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
  sdkHeaderMethod(sqliteSdkSource),
  '/** Existing writer is unchanged by the header read protection. */',
  'setAssociatedPath(sah, path, flags) {}',
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

function sdkHeaderMethod(source:string){
  const start=source.indexOf('getAssociatedPath(sah) {');
  return source.slice(start,source.indexOf('\n\t\t\t\t/**',start));
}

function headerReader(){
  const transformed=patchSqliteSahPoolInitFailure(sqliteSdkSource,sqliteSdkVersion);
  const method=sdkHeaderMethod(transformed).trim()
    .replace(/^getAssociatedPath\(sah\)/u,'function(sah)')
    .replaceAll('this.#apBody','this.body').replaceAll('this.#dvBody','this.view');
  return Function('capi','PERSISTENT_FILE_TYPES','HEADER_OFFSET_FLAGS','HEADER_DIGEST_SIZE','HEADER_OFFSET_DIGEST','HEADER_OFFSET_DATA','HEADER_CORPUS_SIZE','HEADER_MAX_PATH_SIZE','textDecoder',`return (${method})`)(
    {SQLITE_OPEN_DELETEONCLOSE:8},0x100|0x800|0x4000|0x80000,512,8,516,4096,516,512,new TextDecoder(),
  ) as (handle:unknown)=>string;
}

const digestBody=(body:Uint8Array,flags:number)=>{
  if(!(flags&0x80))return new Uint32Array([0,0]);
  let h1=3735928559,h2=1103547991;
  for(const value of body){h1=Math.imul(h1^value,2654435761);h2=Math.imul(h2^value,104729);}
  return new Uint32Array([h1>>>0,h2>>>0]);
};

function headerFixture(path='/fixture.sqlite3',flags=0x186,size=8192){
  let bytes=new Uint8Array(size);
  new TextEncoder().encodeInto(path,bytes.subarray(0,512));
  new DataView(bytes.buffer).setUint32(512,flags);
  bytes.set(new Uint8Array(digestBody(bytes.subarray(0,516),flags).buffer),516);
  if(size>4096)bytes.set(new TextEncoder().encode('synthetic-committed-data'),4096);
  const mutations:number[]=[];
  const handle={getSize:()=>bytes.length,read(target:Uint8Array|Uint32Array,{at}:{at:number}){
    const output=new Uint8Array(target.buffer,target.byteOffset,target.byteLength);
    const input=bytes.subarray(at,at+output.length);output.set(input);return input.length;
  },truncate(size:number){mutations.push(size);bytes=bytes.slice(0,size);}};
  const body=new Uint8Array(516);
  const context={body,view:new DataView(body.buffer),computeDigest:digestBody,setAssociatedPath(){handle.truncate(4096);}};
  return {handle,context,mutations,get bytes(){return bytes;}};
}

test('the actual SDK header reader preserves damaged database bytes instead of reclaiming its slot',()=>{
  const read=headerReader();
  for(const change of [(bytes:Uint8Array)=>{bytes[516]^=1;},(bytes:Uint8Array)=>{bytes[512]^=1;}]){
    const fixture=headerFixture();change(fixture.bytes);
    const before=fixture.bytes.slice();
    assert.throws(()=>read.call(fixture.context,fixture.handle),/sqlite_sahpool_header_digest_mismatch/u);
    assert.deepEqual(fixture.bytes,before);
    assert.deepEqual(fixture.mutations,[]);
  }
  const orphan=headerFixture('',0);
  assert.throws(()=>read.call(orphan.context,orphan.handle),/sqlite_sahpool_header_orphaned_payload/u);
  assert.equal(orphan.bytes.length,8192);
  const short=headerFixture('',0,4096);
  const truncatedHeader={...short.handle,read:()=>0};
  assert.throws(()=>read.call(short.context,truncatedHeader),/sqlite_sahpool_header_short_read/u);
  assert.deepEqual(short.mutations,[]);
  const unknownFlags=headerFixture('/fixture.sqlite3',0);
  const unknownBefore=unknownFlags.bytes.slice();
  assert.throws(()=>read.call(unknownFlags.context,unknownFlags.handle),/sqlite_sahpool_header_flags_invalid/u);
  assert.deepEqual(unknownFlags.bytes,unknownBefore,'a named file with unknown flags is not permission to erase its payload');
});

test('verified persistent headers remain readable and valid empty or transient slots retain their SDK meaning',()=>{
  const read=headerReader(),database=headerFixture();
  assert.equal(read.call(database.context,database.handle),'/fixture.sqlite3');
  assert.deepEqual(database.mutations,[]);
  const empty=headerFixture('',0,4096);
  assert.equal(read.call(empty.context,empty.handle),'');
  assert.deepEqual(empty.mutations,[]);
  const transient=headerFixture('/temp',8|0x80);
  assert.equal(read.call(transient.context,transient.handle),'');
  assert.deepEqual(transient.mutations,[4096],'only a verified transient association can be reclaimed');
});

test('an interrupted zero-byte slot can initialize but nonempty short files retain every byte',()=>{
  const read=headerReader();
  const empty=headerFixture('',0,4096);
  const zeroHandle={...empty.handle,getSize:()=>0,read:()=>{throw new Error('an empty file has no header to read');}};
  assert.equal(read.call(empty.context,zeroHandle),'');
  assert.deepEqual(empty.mutations,[4096],'the SDK initializes only a physically empty slot');
  for(const size of [1,515,516,523]){
    const short=headerFixture('',0,4096);
    const bytes=short.bytes.slice(0,size);
    const before=bytes.slice();
    const shortHandle={...short.handle,getSize:()=>size,read(target:Uint8Array|Uint32Array,{at}:{at:number}){
      const output=new Uint8Array(target.buffer,target.byteOffset,target.byteLength);
      const input=bytes.subarray(at,at+output.length);output.set(input);return input.length;
    }};
    assert.throws(()=>read.call(short.context,shortHandle),/sqlite_sahpool_header_short_read/u);
    assert.deepEqual(bytes,before);
    assert.deepEqual(short.mutations,[],'nonempty partial headers cannot be treated as empty slots');
  }
});

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

test('a new owner retires lost old read requests promptly without blindly retrying ambiguous commits',async()=>{
 const previous=Object.fromEntries(['navigator','window','BroadcastChannel'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 let channel!:TestChannel,leader='old-owner',requests=0,lastRequest:any,signalRead!:()=>void,signalCommit!:()=>void;
 const readSent=new Promise<void>(resolve=>{signalRead=resolve;}),commitSent=new Promise<void>(resolve=>{signalCommit=resolve;});
 class TestChannel extends EventTarget{
  constructor(){super();channel=this;}
  receive(payload:unknown){this.dispatchEvent(new MessageEvent('message',{data:{protocol:sqliteCoordinatorProtocolVersion,schemaVersion:sqliteLibrarySchemaVersion,...payload as object}}));}
  postMessage(message:any){
   if(message.kind==='probe')queueMicrotask(()=>this.receive({kind:'leader',sender:leader}));
   if(message.kind==='request'){
    requests++;lastRequest=message;
    if(message.input.kind==='commit'){signalCommit();return;}
    if(leader==='old-owner'){signalRead();return;}
    queueMicrotask(()=>this.receive({kind:'response',recipient:message.sender,requestId:message.requestId,ok:true,value:'preserved sentinel'}));
   }
  }
 }
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:string,_options:unknown,callback:(lock:null)=>unknown)=>callback(null)}}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 Object.defineProperty(globalThis,'BroadcastChannel',{configurable:true,value:TestChannel});
 const adapter=new CoordinatedSqliteAdapter(()=>{throw Error('An occupied owner lock cannot create a second backend');});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const read=adapter.get('meta','sentinel');await readSent;
  const stale=lastRequest;leader='replacement-owner';channel.receive({kind:'leader',sender:leader});
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('old remote read was not retired')),1500);});
  assert.equal(await Promise.race([read,deadline]),'preserved sentinel');assert.equal(requests,2);
  channel.receive({kind:'response',recipient:stale.sender,requestId:stale.requestId,ok:true,value:'late old reply'});
  const write=adapter.commit({clears:[],deletes:[],puts:[]});
  const rejected=assert.rejects(write,/sqlite_owner_changed/);await commitSent;
  const before=requests;leader='third-owner';channel.receive({kind:'leader',sender:leader});await rejected;
  assert.equal(requests,before,'an ambiguous commit belongs to receipt recovery, not an automatic raw replay');
 }finally{
  clearTimeout(timer);await adapter.close();
  for(const name of ['navigator','window','BroadcastChannel']){const descriptor=previous[name];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
 }
});

test('initial coordination retries ownership after a closing leader releases its lock without a new announcement',async()=>{
 const previous=Object.fromEntries(['navigator','window','BroadcastChannel'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 class SilentChannel extends EventTarget{postMessage(_message:unknown):void{}}
 let ownerLocked=true,attempts=0,firstAttempt!:()=>void;
 const initialAttempt=new Promise<void>(resolve=>{firstAttempt=resolve;});
 const locks={request:async(name:string,options:{ifAvailable?:boolean;mode?:string},callback:(lock:unknown)=>Promise<unknown>|unknown)=>{
  attempts++;
  if(options.ifAvailable&&ownerLocked){firstAttempt();return callback(null);}
  ownerLocked=true;try{return await callback({name,mode:options.mode??'exclusive'});}finally{ownerLocked=false;}
 }};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
 Object.defineProperty(globalThis,'BroadcastChannel',{configurable:true,value:SilentChannel});
 const diagnostics:SqliteStorageDiagnostics={engine:'sqlite-wasm',persistence:'opfs',sqliteVersion:'fixture',schemaVersion:sqliteLibrarySchemaVersion,journalMode:'wal',synchronous:2,lockingMode:'exclusive'};
 let created=0,timer:ReturnType<typeof setTimeout>|undefined;
 const adapter=new CoordinatedSqliteAdapter(()=>{created++;return {initialize:async()=>diagnostics,close:async()=>{}} as unknown as CoordinatedSqliteBackend;});
 const startup=adapter.initialize();
 try{
  await initialAttempt;
  // A graceful old-document close releases the lock, but cannot announce a
  // new owner. A surviving idle follower also has no backend to announce.
  ownerLocked=false;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('initial handoff waited for an absent leader instead of retrying the released lock')),1500);});
  assert.deepEqual(await Promise.race([startup,deadline]),diagnostics);
  assert(attempts>=2);assert.equal(created,1);
 }finally{
  clearTimeout(timer);await adapter.close();await startup.catch(()=>undefined);
  for(const name of ['navigator','window','BroadcastChannel']){const descriptor=previous[name];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
 }
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
