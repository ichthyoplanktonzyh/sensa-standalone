/// <reference lib="webworker" />
/** Diagnostic wrapper only. No instrumentation is compiled into the product. */
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
import type {Database,Sqlite3Static} from '@sqlite.org/sqlite-wasm';
type Metric={calls:number;ms:number};
const phases:Record<string,Metric>={},projections:Record<string,Metric>={},reads:Record<string,Metric>={},sql=new Map<string,Metric>();
type Counters={hit:number;miss:number;write:number;spill:number;cacheBytes:number};
// Cache use is sampled at phase boundaries, not a whole-process peak.
const nativeCache:Record<string,{calls:number;hit:number;miss:number;write:number;spill:number;maxObservedCacheBytes:number}>={};
const diagnosticErrors:string[]=[];
// Measure the native boundary before choosing a different file layout or
// durability policy. This wrapper runs only in isolated synthetic tests;
// production remains WAL/FULL and no filesystem method is replaced there.
const nativeIo:Record<string,{calls:number;ms:number;bytes:number;failures:number}>={};
for(const method of ['read','write','flush'] as const){
 const original=FileSystemSyncAccessHandle.prototype[method];
 Reflect.set(FileSystemSyncAccessHandle.prototype,method,function(this:FileSystemSyncAccessHandle,...args:unknown[]){
  const metric=nativeIo[`${phase}:${method}`]??={calls:0,ms:0,bytes:0,failures:0},started=performance.now();metric.calls++;
  try{const result=Reflect.apply(original,this,args);if(typeof result==='number')metric.bytes+=result;return result;}
  catch(cause){metric.failures++;throw cause;}
  finally{metric.ms+=performance.now()-started;}
 });
}
const requestedCache=new URL(self.location.href).searchParams.get('cacheKiB');
const journalMode=new URL(self.location.href).searchParams.get('journalMode')??'wal';
if(journalMode!=='wal'&&journalMode!=='delete')throw Error('unsupported_diagnostic_journal_mode');
const cacheKiB=requestedCache===null?undefined:Number(requestedCache);
if(cacheKiB!==undefined&&cacheKiB!==16384&&cacheKiB!==40960)throw Error('unsupported_diagnostic_cache_size');
let phase='initialize';
const record=(metrics:Record<string,Metric>,key:string,elapsed:number)=>{const metric=metrics[key]??={calls:0,ms:0};metric.calls++;metric.ms+=elapsed;};
const counters=(database:SqliteRecordDatabase):Counters|undefined=>{
 const sqlite=Reflect.get(database,'sqlite3') as Sqlite3Static,raw=Reflect.get(database,'database') as Database;
 const pointer=sqlite.wasm.alloc(8);
 try{
  const result={} as Counters;
  for(const [key,option] of [['hit',sqlite.capi.SQLITE_DBSTATUS_CACHE_HIT],['miss',sqlite.capi.SQLITE_DBSTATUS_CACHE_MISS],['write',sqlite.capi.SQLITE_DBSTATUS_CACHE_WRITE],['spill',sqlite.capi.SQLITE_DBSTATUS_CACHE_SPILL],['cacheBytes',sqlite.capi.SQLITE_DBSTATUS_CACHE_USED]] as const){
   const code=sqlite.capi.sqlite3_db_status(raw.pointer,option,pointer,pointer+4,0);if(code!==0)throw Error(`db_status:${code}`);
   result[key]=Number(sqlite.wasm.peek(pointer,'i32'));
  }
  return result;
 }catch(cause){diagnosticErrors.push(String(cause));return undefined;}finally{sqlite.wasm.dealloc(pointer);}
};
const cacheDelta=(database:SqliteRecordDatabase,key:string,before:Counters|undefined)=>{
 const after=counters(database);if(!before||!after)return;
 const total=nativeCache[key]??={calls:0,hit:0,miss:0,write:0,spill:0,maxObservedCacheBytes:0};total.calls++;
 for(const counter of ['hit','miss','write','spill'] as const)total[counter]+=after[counter]-before[counter];
 total.maxObservedCacheBytes=Math.max(total.maxObservedCacheBytes,before.cacheBytes,after.cacheBytes);
};
const emit=(database:SqliteRecordDatabase,includePages=false)=>{
 const raw=Reflect.get(database,'database') as Database;
 const scalar=(sql:string)=>Number((raw.exec({sql,rowMode:0,returnValue:'resultRows'}) as number[])[0]);
 let settings:unknown,pages:unknown;
 try{
  settings={journalMode:raw.exec({sql:'PRAGMA journal_mode',rowMode:0,returnValue:'resultRows'})[0],cacheSize:scalar('PRAGMA cache_size'),pageSize:scalar('PRAGMA page_size'),pageCount:scalar('PRAGMA page_count'),freePages:scalar('PRAGMA freelist_count'),synchronous:scalar('PRAGMA synchronous')};
  if(includePages)pages=raw.exec({sql:'SELECT name,pagetype,count(*) AS pages,sum(pgsize) AS bytes,sum(payload) AS payloadBytes,sum(unused) AS unusedBytes FROM dbstat GROUP BY name,pagetype ORDER BY name,pagetype',rowMode:'object',returnValue:'resultRows'});
 }catch(cause){diagnosticErrors.push(String(cause));}
 const base64={encode:typeof Reflect.get(Uint8Array.prototype,'toBase64')==='function',decode:typeof Reflect.get(Uint8Array,'fromBase64')==='function'};
 self.postMessage({sensaRestoreProfile:{phases,projections,reads,nativeCache,nativeIo,settings,pages,base64,diagnosticErrors,execTimings:[...sql].sort((a,b)=>b[1].ms-a[1].ms).slice(0,25).map(([sql,metric])=>({sql,...metric}))}});
};
const instrumented=new WeakSet<object>(),initialize=SqliteRecordDatabase.prototype.initialize;
SqliteRecordDatabase.prototype.initialize=function(){
 const raw=Reflect.get(this,'database') as {exec(...args:unknown[]):unknown};
 const first=!instrumented.has(raw);
 if(first){
  instrumented.add(raw);const exec=raw.exec;
  raw.exec=function(...args){const text=typeof args[0]==='string'?args[0]:(args[0] as {sql?:string})?.sql??'',key=`${phase}: ${text.replace(/\s+/gu,' ').trim()}`,started=performance.now();
   try{return Reflect.apply(exec,this,args);}finally{const metric=sql.get(key)??{calls:0,ms:0};metric.calls++;metric.ms+=performance.now()-started;sql.set(key,metric);}
  };
  for(const name of ['meaningLookup','worldBrowseProjection','practiceExpressionProjection','journeyIdentities']){
   const projection=Reflect.get(this,name),update=projection.update;
   projection.update=function(...args:unknown[]){const started=performance.now();try{return Reflect.apply(update,this,args);}finally{record(projections,name,performance.now()-started);}};
  }
  const get=this.get;
  this.get=function(table,key){const started=performance.now();try{return get.call(this,table,key);}finally{record(reads,`${phase}:${table}`,performance.now()-started);}};
 }
 try{
  const result=initialize.call(this);
  if(first&&cacheKiB!==undefined)raw.exec(`PRAGMA cache_size=-${cacheKiB}`);
  // SQLite recommends EXTRA for rollback-journal power-loss durability. FULL
  // alone is not a durability-equivalent comparison with WAL/FULL.
  if(first&&journalMode==='delete')raw.exec('PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA');
  return result;
 }finally{phase='outside';}
};
const candidate=SqliteRecordDatabase.prototype.replicaCandidate;
SqliteRecordDatabase.prototype.replicaCandidate=async function(request){
 phase=request.kind;const started=performance.now(),before=counters(this);
 try{return await candidate.call(this,request);}finally{record(phases,request.kind,performance.now()-started);cacheDelta(this,request.kind,before);phase='outside';if(request.kind==='validate')emit(this);}
};
const commit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){
 const key=phase=mutation.replicaCandidateRestore?'promotion':'other-commit';const started=performance.now(),before=counters(this);
 try{return commit.call(this,mutation);}finally{record(phases,key,performance.now()-started);cacheDelta(this,key,before);phase='outside';if(mutation.replicaCandidateRestore)emit(this,true);}
};
// Unlike a static production entry, this wrapper awaits a dynamic import.
// Preserve requests arriving during that await until the shipped listener is
// installed; otherwise the first initialize RPC can be consumed without reply.
const pending:unknown[]=[],buffer=(event:MessageEvent)=>{pending.push(event.data);event.stopImmediatePropagation();};
self.addEventListener('message',buffer);
await import('../../apps/web/src/data/library/sqliteWorker');
self.removeEventListener('message',buffer);
for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));
