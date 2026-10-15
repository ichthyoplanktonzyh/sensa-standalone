/** Fresh synthetic source for native copy/cancellation regression only. */
import initialize from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies,syncAdmission} from '../../apps/web/src/data/library/sqliteSyncDependencies';
import {encodeBackupValue,decodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {localLibraryPoolDirectory} from '../../apps/web/src/data/library/localLibraryLocation';
import {sqliteLibraryFile} from '../../apps/web/src/data/library/sqliteProtocol';
import {libraryRestoreValidationVersion} from '../../apps/web/src/data/library/replication/libraryReplicaValidation';
const namespace=crypto.randomUUID();
const init=initialize as unknown as (options:{locateFile:(name:string)=>string})=>ReturnType<typeof initialize>;
const sqlite=await init({locateFile:(name:string)=>name.endsWith('.wasm')?wasmUrl:name}),pool=await sqlite.installOpfsSAHPoolVfs({name:'source-copy-test',directory:localLibraryPoolDirectory(namespace),initialCapacity:6}),raw=new pool.OpfsSAHPoolDb(sqliteLibraryFile),library=new SqliteRecordDatabase(sqlite,raw,'opfs');
library.initialize();const encode=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
const identity={schemaVersion:2 as const,createdAt:new Date().toISOString(),id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID()},owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()},incarnation=crypto.randomUUID(),fence={owner,incarnation,identity,localRevision:1,signoutEpoch:undefined};
const state={owner,incarnation,revision:1,checkpointVersion:7 as const,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:1,status:'synced' as const};
library.commit({clears:[],deletes:[],puts:Object.entries({identity,'service-owner':{...owner,email:'synthetic-source@example.invalid'},'local-incarnation':incarnation,'local-content-revision':1,'cloud-sync':state,'private-test-padding':Array.from({length:256},()=>{const bytes=crypto.getRandomValues(new Uint8Array(32768));return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');}).join('')}).map(([key,value])=>({table:'meta',key,encodedValue:encode(value)}))});
const canonical=encode({...identity,deviceId:identity.id}),dependencies=new SqliteSyncDependencies(raw),admission=syncAdmission();dependencies.observe(admission,'meta','identity',canonical,decodeBackupValue(JSON.parse(canonical)));raw.exec({sql:"INSERT INTO sensa_sync_base VALUES('meta','identity',?,?)",bind:[canonical,JSON.stringify(['a'.repeat(64)])]});dependencies.certify(admission,state,identity,0);
dependencies.close();library.close(false);pool.pauseVfs();
const actual=new Worker(new URL('../../apps/web/src/data/library/sqliteWorker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();let nextId=0,closed=false;
actual.onmessage=({data})=>{if('kind' in data)return;const waiting=pending.get(data.id);if(!waiting)return;pending.delete(data.id);if(data.ok)waiting.resolve(data.value);else waiting.reject(Error(data.error));};
const forward=(input:Record<string,unknown>)=>{if(closed)return Promise.reject(Error('sqlite_worker_terminated'));const id=++nextId;return new Promise<any>((resolve,reject)=>{pending.set(id,{resolve,reject});actual.postMessage({id,...input});});};
await forward({kind:'initialize',namespace,requireExisting:true});
self.addEventListener('message',event=>{const {id,kind,input}=event.data;const result=(async()=>{
 if(kind==='fence')return fence;
 if(kind==='snapshotSource')return forward({kind,request:input});
 if(kind==='get')return forward({kind,table:'meta',key:input??'identity'});
 if(kind==='commit')return forward({kind,mutation:{clears:[],deletes:[],puts:[{table:'meta',key:'private-test-write',encodedValue:encode(input)}]}});
 if(kind==='candidateBusy'){
  const job=forward({kind:'replicaCandidate',request:{kind:'validate',id:crypto.randomUUID()}}).then(()=>null,error=>String(error));
  let copyError:string|undefined;try{const begun=await forward({kind:'snapshotSource',request:{action:'begin',fence}});await forward({kind:'snapshotSource',request:{action:'discard',id:begun.proof.id}});}catch(error){copyError=String(error);}
  return {copyError,candidateError:await job,identity:await forward({kind:'get',table:'meta',key:'identity'})};
 }
 if(kind==='checkCopy'){
  const destination=await sqlite.installOpfsSAHPoolVfs({name:'source-copy-verify-'+crypto.randomUUID(),directory:'/source-copy-verify-'+crypto.randomUUID(),initialCapacity:4}),reader=(input as File).stream().getReader();
  try{await destination.importDb('/copy.sqlite3',async()=>{const next=await reader.read();return next.done?undefined:next.value;});}finally{reader.releaseLock();}
  const copied=new destination.OpfsSAHPoolDb('/copy.sqlite3'),copyLibrary=new SqliteRecordDatabase(sqlite,copied,'opfs');let result;try{result={integrity:copied.selectValue('PRAGMA integrity_check'),identity:copied.selectValue("SELECT value_json FROM sensa_records WHERE table_name='meta' AND record_key='identity'"),padding:copied.selectValue("SELECT length(value_json) FROM sensa_records WHERE table_name='meta' AND record_key='private-test-padding'"),records:copied.selectValue('SELECT count(*) FROM sensa_records'),baseline:copied.selectValue('SELECT count(*) FROM sensa_sync_base'),pending:copied.selectValue("SELECT count(*) FROM sqlite_schema WHERE name='sensa_private_restore_pending_v1'")};}finally{copyLibrary.close(false);destination.pauseVfs();}return result;
 }
 if(kind==='close'){if(!closed){await forward({kind:'close'});closed=true;actual.terminate();for(const waiter of pending.values())waiter.reject(Error('sqlite_worker_terminated'));pending.clear();}return null;}
 throw Error('test_request');
})();void result.then(value=>self.postMessage({id,ok:true,value}),error=>self.postMessage({id,ok:false,error:String(error)}));});
self.postMessage({ready:true});
