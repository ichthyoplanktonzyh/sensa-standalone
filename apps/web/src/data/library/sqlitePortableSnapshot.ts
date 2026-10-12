import type {Database,Sqlite3Static,SAHPoolUtil} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {librarySyncTables} from '@sensa/contracts/sensa';
import {SqliteRecordDatabase} from './sqliteDatabase';
import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import {decodeSharedArchiveWire,unpackStoredRecord} from './sharedRecordContent';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from './replication/libraryReplica';
import {sqliteLibraryTables,sqliteLibrarySchemaVersion,sqliteSourceDataTables} from './sqliteProtocol';
import {libraryRowsReader} from './libraryRecordReader';
import type {BackupRows} from './backupValidation';
import {validateLibraryRecordSteps} from './backupValidation';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {immutableLightweightMaterializationValidator} from '../../learning/runtime/lightweightInitialContent';

const fileLimit=90*1024*1024,expandedLimit=512*1024*1024,rowLimit=200000;
export type LocalPortableSnapshot={format:'sensa-local-db-snapshot-v1';schemaVersion:typeof sqliteLibrarySchemaVersion;sourceRevision:number;sha256:string;bytes:Uint8Array;timingsMs:{build:number;projection:number;export:number}};
type SchemaRow={type:string;name:string;tbl_name:string;sql:string|null};
const invalid=(reason:string):never=>{throw Error(`sqlite_snapshot_${reason}`);};
const statisticsSql=new Set(['CREATE TABLE sqlite_stat1(tbl,idx,stat)','CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)']);
const definitions=(raw:Database)=>(raw.exec({sql:'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',rowMode:'object',returnValue:'resultRows'}) as SchemaRow[]).filter(row=>!(row.type==='table'&&row.sql!==null&&statisticsSql.has(row.sql)));
const scalar=(raw:Database,sql:string)=>raw.selectValue(sql);
const emptyRows=()=>Object.fromEntries(sqliteLibraryTables.map(table=>[table,[]])) as unknown as BackupRows;
/** Compare cache values, not file page layout or a sender's cache stamp. */
function projectionValues(raw:Database){
 const result=new Map<string,string>();
 for(const row of definitions(raw))if(row.type==='table'&&!sqliteSourceDataTables.has(row.name)){
  if(!/^\w+$/u.test(row.name))invalid('projection_schema');
  const columns=raw.exec({sql:`PRAGMA table_info(${row.name})`,rowMode:'object',returnValue:'resultRows'}) as unknown[];
  const order=Array.from({length:columns.length},(_,index)=>index+1).join(',');
  const rows=raw.exec({sql:`SELECT * FROM ${row.name}${order?' ORDER BY '+order:''}`,rowMode:'array',returnValue:'resultRows'});
  result.set(row.name,sha256(JSON.stringify(rows)));
 }
 return result;
}
function restrict(sqlite:Sqlite3Static,raw:Database){
 const c=sqlite.capi;
 for(const [op,value] of [[c.SQLITE_DBCONFIG_TRUSTED_SCHEMA,0],[c.SQLITE_DBCONFIG_ENABLE_TRIGGER,0],[c.SQLITE_DBCONFIG_ENABLE_VIEW,0],[c.SQLITE_DBCONFIG_DEFENSIVE,1]] as const)if(c.sqlite3_db_config(raw.pointer!,op,value)!==0)invalid('connection_restriction');
 raw.exec('PRAGMA locking_mode=EXCLUSIVE;PRAGMA foreign_keys=ON');
}
function trusted(sqlite:Sqlite3Static,pool?:SAHPoolUtil,file?:string,portableBuild=false){
 const raw=pool?new pool.OpfsSAHPoolDb(file!):new sqlite.oo1.DB(':memory:','c');
 const library=new SqliteRecordDatabase(sqlite,raw,pool?'opfs':'memory',portableBuild);library.initialize();return {raw,library};
}
function freeze(value:any,seen:WeakSet<object>){
 if(value===null||typeof value!=='object'||seen.has(value))return;seen.add(value);
 for(const item of Object.values(value))freeze(item,seen);Object.freeze(value);
}
/** Decode each real stored record once. Shared bodies are digest-checked and
 * decoded once globally, then referenced by immutable decoded facts. */
async function decodedFacts(raw:Database){
 const rows=emptyRows(),bodies=new Map<string,unknown>(),used=new Set<string>(),frozen=new WeakSet<object>();
 let bytes=0,count=0,bodyCount=0;
 const addBytes=(text:string)=>{bytes+=new TextEncoder().encode(text).length;if(bytes>expandedLimit)invalid('expanded_limit');};
 const bodyRows=raw.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content ORDER BY digest',rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[];
 for(const body of bodyRows){
  const text=unpackStoredRecord(body.value_json,undefined,expandedLimit-bytes);
  if(++bodyCount>rowLimit||!/^[a-f0-9]{64}$/u.test(body.digest)||sha256(text)!==body.digest)invalid('shared_body');
  addBytes(text);const value=decodeBackupValue(JSON.parse(text));freeze(value,frozen);bodies.set(body.digest,value);
 }
 for(const table of sqliteLibraryTables){
  let after='';
  for(;;){
   const page=raw.exec({sql:'SELECT record_key,value_json FROM sensa_records WHERE table_name=? AND record_key>? ORDER BY record_key LIMIT 64',bind:[table,after],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
   for(const row of page){
    if(++count>rowLimit||!isReplicatedLibraryEntry(table,row.record_key))invalid('private_record');
    const text=unpackStoredRecord(row.value_json,undefined,expandedLimit-bytes);addBytes(text);
    const refs=new Set<string>(),value=decodeSharedArchiveWire(JSON.parse(text),bodies,refs);for(const digest of refs)used.add(digest);
    const actual=raw.exec({sql:"SELECT digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name=? AND record_key=? ORDER BY digest",bind:[table,row.record_key],rowMode:0,returnValue:'resultRows'}) as string[];
    if(JSON.stringify([...refs].sort())!==JSON.stringify(actual))invalid('shared_owners');
    freeze(value,frozen);rows[table].push({key:row.record_key,value});
   }
   if(page.length<64)break;after=page.at(-1)!.record_key;await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
 }
 if(used.size!==bodies.size)invalid('orphan_body');
 if(Number(scalar(raw,'SELECT count(*) FROM sensa_sync_base'))||Number(scalar(raw,'SELECT count(*) FROM sensa_record_tombstones'))||Number(scalar(raw,'SELECT count(*) FROM sensa_portable_media'))||Number(scalar(raw,'SELECT count(*) FROM sensa_portable_package_media')))invalid('device_storage');
 if(Number(scalar(raw,"SELECT count(*) FROM sensa_shared_record_content_owners WHERE owner_kind!='record'")))invalid('shared_owners');
 if(Number(scalar(raw,"SELECT count(*) FROM sensa_shared_record_content_owners AS owner WHERE NOT EXISTS(SELECT 1 FROM sensa_records AS record WHERE record.table_name=owner.table_name AND record.record_key=owner.record_key)")))invalid('shared_owners');
 const reader=libraryRowsReader(rows);
 const identity=await runCooperatively(validateLibraryRecordSteps(reader,'restore',immutableLightweightMaterializationValidator()));
 return {rows,reader,identity,stats:{decodedRecords:count,decodedBodies:bodyCount,expandedBytes:bytes}};
}

/** Local frozen-revision producer. It creates a trusted clean library using
 * portable facts only; it never copies owner file pages or clears the source. */
export async function createLocalPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,source:SqliteRecordDatabase,expectedRevision:number):Promise<LocalPortableSnapshot>{
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)invalid('source_revision');
 const revision=()=>{const encoded=source.get('meta','local-content-revision');return encoded===null?0:decodeBackupValue(JSON.parse(encoded));};
 if(revision()!==expectedRevision)invalid('source_changed');
 const inputIdentity=source.get('meta','identity');if(inputIdentity===null)invalid('identity');const identity=decodeBackupValue(JSON.parse(inputIdentity!));
 const fenceKeys=['identity','local-incarnation','service-owner','signed-out','service-signout-epoch'];
 const fence=fenceKeys.map(key=>source.get('meta',key));
 const assertSource=()=>{if(revision()!==expectedRevision||fenceKeys.some((key,index)=>source.get('meta',key)!==fence[index]))invalid('source_changed');};
 const file=`/snapshot-build-${crypto.randomUUID()}.sqlite3`,output=`/snapshot-output-${crypto.randomUUID()}.sqlite3`;
 await pool.reserveMinimumCapacity(pool.getFileCount()+8);
 assertSource();
 const target=trusted(sqlite,pool,file,true);const started=performance.now();
 try{
  target.raw.exec('BEGIN IMMEDIATE');
  try{
  for(const table of librarySyncTables){
   let after:string|null=null;
   for(;;){
    const page=source.recordKeysPage(table,after,64),puts=[];
    for(const key of page)if(isReplicatedLibraryEntry(table,key)){
     const encoded=source.get(table,key);if(encoded===null)invalid('source_changed');
     const value=decodeBackupValue(JSON.parse(encoded!)),normalized=normalizeLibraryReplicaEntry({table,key,value},identity);
     puts.push({table,key,encodedValue:JSON.stringify(encodeBackupValue(normalized.value))});
    }
    if(puts.length)target.library.appendPortableSnapshotFacts(puts);
    if(page.length<64)break;after=page.at(-1)!;
   }
  }
  target.raw.exec('COMMIT');
  }catch(error){target.raw.exec('ROLLBACK');throw error;}
  assertSource();
  const facts=await decodedFacts(target.raw);
  assertSource();
  const built=performance.now();target.library.rebuildPortableProjections(facts.reader);
  const projected=performance.now();target.raw.exec({sql:'VACUUM INTO ?',bind:[output]});
  const bytes=pool.exportFile(output) as unknown as Uint8Array;if(bytes.byteLength>fileLimit)invalid('file_limit');
  return {format:'sensa-local-db-snapshot-v1',schemaVersion:sqliteLibrarySchemaVersion,sourceRevision:expectedRevision,sha256:sha256(bytes),bytes,timingsMs:{build:built-started,projection:projected-built,export:performance.now()-projected}};
 }finally{target.library.close();pool.unlink(file);pool.unlink(output);}
}

/** The destination is a fresh independent namespace. This stage does not
 * select it as the user's active library or manufacture a cloud checkpoint. */
export async function importLocalPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,file:string,snapshot:LocalPortableSnapshot){
 if(pool.getFileCount()!==0)invalid('destination_not_empty');
 if(snapshot.format!=='sensa-local-db-snapshot-v1'||snapshot.schemaVersion!==sqliteLibrarySchemaVersion||!Number.isSafeInteger(snapshot.sourceRevision)||snapshot.sourceRevision<0||snapshot.bytes.byteLength>fileLimit||snapshot.bytes.byteLength<512||sha256(snapshot.bytes)!==snapshot.sha256)invalid('envelope');
 const expected=trusted(sqlite);const schema=definitions(expected.raw);expected.library.close();
 let raw:Database|undefined,library:SqliteRecordDatabase|undefined;const started=performance.now();
 try{
  let at=0;await pool.importDb(file,()=>{if(at===snapshot.bytes.byteLength)return undefined;const next=Math.min(at+256*1024,snapshot.bytes.byteLength),chunk=snapshot.bytes.subarray(at,next);at=next;return chunk;});
  const imported=performance.now();raw=new pool.OpfsSAHPoolDb(file);restrict(sqlite,raw);
  if(JSON.stringify(definitions(raw))!==JSON.stringify(schema)||scalar(raw,'PRAGMA user_version')!==sqliteLibrarySchemaVersion)invalid('schema_allowlist');
  // Register only application-owned innocuous functions after the schema gate.
  library=new SqliteRecordDatabase(sqlite,raw,'opfs');
  if(scalar(raw,'PRAGMA integrity_check')!=='ok'||raw.exec({sql:'PRAGMA foreign_key_check',returnValue:'resultRows'}).length)invalid('integrity');
  const facts=await decodedFacts(raw);
  const admitted=performance.now();let before:ReturnType<typeof projectionValues>;
  library.rebuildPortableProjections(facts.reader,stage=>{
   if(stage==='before'){before=projectionValues(raw!);return;}
   const after=projectionValues(raw!);
   if(before.size!==after.size||[...before].some(([table,digest])=>after.get(table)!==digest))invalid('projection_values');
  });
  const projected=performance.now();
  const identity={...facts.identity,deviceId:crypto.randomUUID()};
  library.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))},{table:'meta',key:'local-incarnation',encodedValue:JSON.stringify(encodeBackupValue(crypto.randomUUID()))},{table:'meta',key:'local-content-revision',encodedValue:JSON.stringify(encodeBackupValue(1))}]});
  return {library,identity,stats:facts.stats,timingsMs:{import:imported-started,admission:admitted-imported,projection:projected-admitted,deviceBootstrap:performance.now()-projected}};
 }catch(error){try{if(library)library.close(false);else raw?.close();}finally{pool.unlink(file);}throw error;}
}
