/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import type {SAHPoolUtil} from '@sqlite.org/sqlite-wasm';

import { SqliteRecordDatabase } from "./sqliteDatabase";
import {
  assertSahPoolAccessHandlesFree,
  acquireSqliteSahPoolLease,
  closeSqliteSahPoolSafely,
  releaseSqliteSahPoolLeaseWhenFree,
  SahPoolProbeCloseError,
  type SqliteSahPoolLease,
} from './sqlitePoolLifecycle';
import {
  sqliteLibraryFile,
  sqlitePoolDirectory,
  type SqliteWorkerRequest,
  type SqliteWorkerResult,
} from "./sqliteProtocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
type WorkerStore={
  pool:SAHPoolUtil;
  database:SqliteRecordDatabase;
  initialized:boolean;
  startupTimingsMs:Record<string,number>;
};

let store:Promise<WorkerStore>|undefined;
let activeLease:SqliteSahPoolLease|undefined;
let activePool:SAHPoolUtil|undefined;
let activeDatabase:SqliteRecordDatabase|undefined;
let installerStarted=false;
let closing=false;
let closed=false;
let cleanupUnconfirmed=false;
let requestQueue:Promise<void>=Promise.resolve();

const verifyPoolHandles=()=>assertSahPoolAccessHandlesFree(navigator.storage,sqlitePoolDirectory);
const releaseLease=async()=>{
  const lease=activeLease;
  if(!lease)return;
  await lease.release();
  activeLease=undefined;
};

async function database():Promise<WorkerStore>{
  if(closed||closing||cleanupUnconfirmed)throw new Error('sqlite_worker_closing');
  if(!store){
    store=(async()=>{
      const started=performance.now();
      activeLease=await acquireSqliteSahPoolLease(navigator.locks);
      const leased=performance.now();
      installerStarted=false;
      try{
        // The native probe catches Workers from pre-lock releases too. It only
        // opens each SAH and closes it; it never changes file contents.
        await verifyPoolHandles();
        const probed=performance.now();
        const initialize=sqlite3InitModule as unknown as (options?:{
          locateFile?:(path:string)=>string;
        })=>ReturnType<typeof sqlite3InitModule>;
        const sqlite3=await initialize({
          locateFile:(path)=>path.endsWith('.wasm')?sqliteWasmUrl:path,
        });
        const wasmReady=performance.now();
        installerStarted=true;
        const pool=await sqlite3.installOpfsSAHPoolVfs({
          directory:sqlitePoolDirectory,
          initialCapacity:6,
        });
        const poolReady=performance.now();
        activePool=pool;
        const database=new pool.OpfsSAHPoolDb(sqliteLibraryFile);
        activeDatabase=new SqliteRecordDatabase(sqlite3,database,'opfs');
        return {pool,database:activeDatabase,initialized:false,startupTimingsMs:{lease:Math.round(leased-started),nativeProbe:Math.round(probed-leased),wasm:Math.round(wasmReady-probed),pool:Math.round(poolReady-wasmReady),databaseOpen:Math.round(performance.now()-poolReady),total:Math.round(performance.now()-started)}};
      }catch(cause){
        try{
          if(!installerStarted&&!(cause instanceof SahPoolProbeCloseError)){
            await releaseLease();
          }else{
            if(activeDatabase){activeDatabase.close(false);activeDatabase=undefined;}
            if(activePool){activePool.pauseVfs();activePool=undefined;}
            // The bundled 3.53.4 init-failure backport pauses rather than
            // removes the pool. Verify every native handle before unlocking.
            await releaseSqliteSahPoolLeaseWhenFree({
              verifyAccessHandlesFree:verifyPoolHandles,
              releaseLease,
            });
          }
        }catch(cleanupCause){
          cleanupUnconfirmed=true;
          throw new AggregateError([cause,cleanupCause],'sqlite_sahpool_startup_cleanup_unconfirmed');
        }
        throw cause;
      }
    })();
  }
  return store;
}

async function closeStorage():Promise<void>{
  if(closed)return;
  if(closing)return;
  closing=true;
  try{
    const initializedStore=store?await store.catch(()=>undefined):undefined;
    const databaseValue=initializedStore?.database??activeDatabase;
    const pool=initializedStore?.pool??activePool;
    if(databaseValue&&pool){
      await closeSqliteSahPoolSafely({
        closeDatabase:()=>databaseValue.close(initializedStore?.initialized??false),
        pauseVfs:()=>pool.pauseVfs(),
        verifyAccessHandlesFree:verifyPoolHandles,
        releaseLease,
      });
      activeDatabase=undefined;
      activePool=undefined;
    }else if(activePool){
      activePool.pauseVfs();
      activePool=undefined;
      if(activeLease){
        await releaseSqliteSahPoolLeaseWhenFree({
          verifyAccessHandlesFree:verifyPoolHandles,
          releaseLease,
        });
      }
    }else if(activeLease){
      if(installerStarted){
        await releaseSqliteSahPoolLeaseWhenFree({
          verifyAccessHandlesFree:verifyPoolHandles,
          releaseLease,
        });
      }else{
        await releaseLease();
      }
    }
    store=undefined;
    cleanupUnconfirmed=false;
    closed=true;
  }catch(cause){
    // Keep the physical Web Lock until a later cleanup succeeds or this Worker
    // is terminated. A new Worker must not enter SQLite with uncertain handles.
    cleanupUnconfirmed=true;
    throw new Error('sqlite_sahpool_close_unconfirmed',{cause});
  }finally{
    closing=false;
  }
}

const message=async(request:SqliteWorkerRequest):Promise<unknown>=>{
  if(request.kind==='close'){
    await closeStorage();
    return null;
  }
  if(closed||closing||cleanupUnconfirmed)throw new Error('sqlite_worker_closing');
  const current=await database();
  switch(request.kind){
    case 'initialize':{
      try{
        const diagnostics=current.database.initialize();
        current.initialized=true;
        return {...diagnostics,workerStartupTimingsMs:current.startupTimingsMs};
      }catch(cause){
        await closeStorage();
        throw cause;
      }
    }
    case 'get': return current.database.get(request.table,request.key);
    case 'entries': return current.database.entries(request.table);
    case 'entriesPage':return current.database.entriesPage(request.table,request.afterKey,request.limit);
    case 'existingRecordKeys':return current.database.existingRecordKeys(request.table,request.keys);
    case 'packageCacheProjection':return current.database.packageCacheProjection(request.query);
    case 'meaningLookup':return current.database.lookupMeanings(request.query);
    case 'worldBrowse':return current.database.worldBrowse(request.query);
    case 'registrySelection':return current.database.registrySelection(request.query);
    case 'worldLearningChoices':return current.database.worldLearningChoices(request.query);
    case 'existingJourneyIdentities':return current.database.existingJourneyIdentities(request.ids);
    case 'changesSince': return current.database.changesSince(request.contentRevision,request.tables);
    case 'hasChangesSince':return current.database.hasChangesSince(request.contentRevision,request.tables);
    case 'syncBaseEntries': return current.database.syncBaseEntries(request.keys);
    case 'count': return current.database.count(request.table);
    case 'estimateRecordBytes': return current.database.estimateRecordBytes(request.tables);
    case 'homeLearningProjection': return current.database.homeLearningProjection(request.languageRouteId,request.clock);
    case 'runtimeLearningCandidates':return current.database.runtimeLearningCandidates(request.query);
    case 'studyScopeMember':return current.database.studyScopeMember(request.scopeRevisionId,request.targetId);
    case 'learningHistoryPage':return current.database.learningHistoryPage(request.query);
    case 'learningManagementSummary':return current.database.learningManagementSummary(request.query);
    case 'countIntroducedLearningTargets': return current.database.countIntroducedLearningTargets(
      request.languageRouteId,
      request.startedAfter,
      request.startedBefore,
    );
    case 'learningRunIdsForTarget': return current.database.learningRunIdsForTarget(request.targetId,request.openOnly);
    case 'openLearningRunTargets': return current.database.openLearningRunTargets();
    case 'countContentAttemptsSince': return current.database.countContentAttemptsSince(request.taskId,request.createdAfter);
    case 'learningTargetIdsForBookUpgrade': return current.database.learningTargetIdsForBookUpgrade(
      request.languageRouteId,
      request.targetLanguageTag,
      request.supportLanguageTag,
      request.bookId,
      request.nextBookVersionId,
    );
    case 'isMediaReferenced': return current.database.isMediaReferenced(request.mediaId);
    case 'portableMedia': return current.database.portableMedia(request.sha256);
    case 'portableMediaDiagnostics': return current.database.portableMediaDiagnostics();
    case 'commit': current.database.commit(request.mutation); return null;
    case 'diagnostics': return {...current.database.diagnostics({verifyIntegrity:request.verifyIntegrity}),workerStartupTimingsMs:current.startupTimingsMs};
  }
};

worker.addEventListener('message',(event:MessageEvent<SqliteWorkerRequest>)=>{
  const response=requestQueue.then(()=>message(event.data));
  requestQueue=response.then(()=>undefined,()=>undefined);
  void response.then(
    value=>worker.postMessage({id:event.data.id,ok:true,value} satisfies SqliteWorkerResult),
    cause=>worker.postMessage({
      id:event.data.id,
      ok:false,
      error:cause instanceof Error?cause.message:'sqlite_worker_failed',
    } satisfies SqliteWorkerResult),
  );
});
