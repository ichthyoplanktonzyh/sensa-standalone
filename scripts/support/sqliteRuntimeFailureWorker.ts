/// <reference lib="webworker" />
export {};
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
import type {Database} from '@sqlite.org/sqlite-wasm';
import {sqliteSyncBaseSchema} from '../../apps/web/src/data/library/sqliteProtocol';

// Test-only wrapper: exercise the shipped Worker with a real OPFS short write.
// No fault command or injection branch is compiled into the product Worker.
const scope=self as unknown as DedicatedWorkerGlobalScope;
const originalWrite=FileSystemSyncAccessHandle.prototype.write;
let armed=false;
let checkpointArmed=false;
let rollbackArmed=false;
let diagnosticRollbackArmed=false;
let inCheckpoint=false;
let writeCalls=0;
let fault:Readonly<{requested:number;returned:number;offset:number;phase:'request'|'post-commit-checkpoint'}>|undefined;
let openedDatabase:SqliteRecordDatabase|undefined,probeBaselineUpgrade=false;
let baselineUpgradeEvidence:unknown;
const layoutSnapshot=(database:Database)=>({
  version:database.exec({sql:'PRAGMA user_version',rowMode:0,returnValue:'resultRows'})[0],
  definition:database.exec({sql:"SELECT sql FROM sqlite_schema WHERE name='sensa_sync_base'",rowMode:0,returnValue:'resultRows'})[0],
  indexes:database.exec({sql:"SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='sensa_sync_base' AND sql IS NOT NULL ORDER BY name",rowMode:'array',returnValue:'resultRows'}),
  facts:['sensa_records','sensa_sync_base','sensa_record_tombstones','sensa_shared_record_content','sensa_shared_record_content_owners'].map(table=>database.exec({sql:`SELECT ${table==='sensa_records'?'rowid,*':'*'} FROM ${table} ORDER BY 1,2`,rowMode:'array',returnValue:'resultRows'})),
});
const originalInitialize=SqliteRecordDatabase.prototype.initialize;
SqliteRecordDatabase.prototype.initialize=function(){
  openedDatabase=this;
  if(!probeBaselineUpgrade)return originalInitialize.call(this);
  probeBaselineUpgrade=false;
  const raw=Reflect.get(this,'database') as Database,database=raw as unknown as {exec(...args:unknown[]):unknown},exec=database.exec;
  let before:ReturnType<typeof layoutSnapshot>|undefined;
  database.exec=function(...args){
    const result=Reflect.apply(exec,this,args),input=args[0],sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
    // The shipped initialize has already set exclusive locking first. This
    // read-only snapshot precedes the migration transaction, not pool open.
    if(sql==='PRAGMA user_version'&&!before){database.exec=exec;before=layoutSnapshot(raw);database.exec=wrapped;}
    return result;
  };
  const wrapped=database.exec;
  try{const result=originalInitialize.call(this);database.exec=exec;baselineUpgradeEvidence={before,after:layoutSnapshot(raw)};return result;}
  catch(cause){baselineUpgradeEvidence={before,error:String(cause)};throw cause;}
  finally{database.exec=exec;}
};
FileSystemSyncAccessHandle.prototype.write=function(data,options){
  writeCalls++;
  const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  const offset=options?.at??0;
  if((armed||checkpointArmed&&inCheckpoint)&&offset>=4096&&bytes.byteLength>1){
    const phase=checkpointArmed&&inCheckpoint?'post-commit-checkpoint':'request';
    armed=false;
    checkpointArmed=false;
    const returned=originalWrite.call(this,bytes.slice(0,-1),options);
    fault={requested:bytes.byteLength,returned,offset,phase};
    return returned;
  }
  return originalWrite.call(this,data,options);
};

const originalDiagnostics=SqliteRecordDatabase.prototype.diagnostics;
SqliteRecordDatabase.prototype.diagnostics=function(options){
  if(!diagnosticRollbackArmed)return originalDiagnostics.call(this,options);
  const database=Reflect.get(this,'database') as {exec(...args:unknown[]):unknown};
  // Test-only drift in rebuildable metadata, never learner source records.
  database.exec('UPDATE sensa_journey_identity_meta SET version=0 WHERE id=1');
  const originalExec=database.exec;
  database.exec=function(...args){
    const input=args[0],sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
    if(sql==='COMMIT')throw new Error('fixture identity repair failure');
    if(sql==='ROLLBACK'){
      diagnosticRollbackArmed=false;
      throw Object.assign(new Error('fixture diagnostic rollback SQLITE_IOERR'),{resultCode:10});
    }
    return Reflect.apply(originalExec,this,args);
  };
  try{return originalDiagnostics.call(this,options);}
  finally{database.exec=originalExec;diagnosticRollbackArmed=false;}
};

// Checkpoint mode arms the native write only inside the actual checkpoint,
// after production COMMIT returned. Rollback mode separately injects a
// controlled SQL error; it is not a native-short-write claim.
const originalCommit=SqliteRecordDatabase.prototype.commit;
SqliteRecordDatabase.prototype.commit=function(mutation){
  if(!checkpointArmed&&!rollbackArmed)return originalCommit.call(this,mutation);
  const database=Reflect.get(this,'database') as {exec(...args:unknown[]):unknown};
  const originalExec=database.exec;
  database.exec=function(...args){
    const input=args[0],sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
    if(rollbackArmed&&sql==='ROLLBACK'){
      rollbackArmed=false;
      throw Object.assign(new Error('fixture rollback SQLITE_IOERR'),{resultCode:10});
    }
    inCheckpoint=sql==='PRAGMA wal_checkpoint(TRUNCATE)';
    try{return Reflect.apply(originalExec,this,args);}
    finally{inCheckpoint=false;}
  };
  try{return originalCommit.call(this,mutation);}
  finally{database.exec=originalExec;inCheckpoint=false;}
};

scope.addEventListener('message',event=>{
  const request=event.data as {id:number;kind:string};
  if(!request.kind.startsWith('test_'))return;
  event.stopImmediatePropagation();
  const action=async()=>{
    if(request.kind==='test_arm_short_write'){armed=true;return null;}
    if(request.kind==='test_arm_checkpoint_short_write'){checkpointArmed=true;return null;}
    if(request.kind==='test_arm_rollback_io_failure'){rollbackArmed=true;return null;}
    if(request.kind==='test_arm_diagnostic_rollback_io_failure'){diagnosticRollbackArmed=true;return null;}
    if(request.kind==='test_arm_constructor_failure'){Reflect.set(globalThis,'__sqliteConstructorFailureForTest',true);return null;}
    if(request.kind==='test_probe_pool_free'){
      const {assertSahPoolAccessHandlesFree}=await import('../../apps/web/src/data/library/sqlitePoolLifecycle');
      const {sqlitePoolDirectory}=await import('../../apps/web/src/data/library/sqliteProtocol');
      await assertSahPoolAccessHandlesFree(navigator.storage,sqlitePoolDirectory);
      return (await navigator.locks.query()).held?.map(lock=>lock.name)??[];
    }
    if(request.kind==='test_native_write_stats')return {writeCalls,fault};
    if(request.kind==='test_probe_baseline_upgrade'){probeBaselineUpgrade=true;return null;}
    if(request.kind==='test_baseline_upgrade_evidence')return baselineUpgradeEvidence;
    if(request.kind==='test_seed_baseline_layout17'){
      if(!openedDatabase)throw Error('sqlite_runtime_fixture_not_initialized');
      const database=Reflect.get(openedDatabase,'database') as Database;
      database.exec('BEGIN IMMEDIATE');
      try{
        database.exec(sqliteSyncBaseSchema.replace('IF NOT EXISTS sensa_sync_base','fixture_baseline17').replace(/\);\s*$/u,') WITHOUT ROWID;'));
        database.exec('INSERT INTO fixture_baseline17 SELECT * FROM sensa_sync_base');
        database.exec('DROP TABLE sensa_sync_base');database.exec('ALTER TABLE fixture_baseline17 RENAME TO sensa_sync_base');
        database.exec('CREATE INDEX retained_baseline_key ON sensa_sync_base(record_key)');
        database.exec('PRAGMA user_version=17');database.exec('COMMIT');
      }catch(cause){database.exec('ROLLBACK');throw cause;}
      return layoutSnapshot(database);
    }
    throw new Error('sqlite_runtime_fault_command_unknown');
  };
  void action().then(value=>scope.postMessage({id:request.id,ok:true,value}),cause=>scope.postMessage({id:request.id,ok:false,error:String(cause)}));
});

await import('../../apps/web/src/data/library/sqliteWorker');
scope.postMessage({ready:true});
