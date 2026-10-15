import type {Database,Sqlite3Static,SAHPoolUtil} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {librarySyncRecordLimit,librarySyncLogicalByteLimit,librarySyncTables} from '@sensa/contracts/sensa';
import {SqliteRecordDatabase} from './sqliteDatabase';
import {decodeBackupValue,encodeBackupValue,backupEqual} from './backupCodec';
import {decodeSharedArchiveWire,unpackStoredRecord} from './sharedRecordContent';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,canCopyNormalizedLibraryReplicaValue} from './replication/libraryReplica';
import {sqliteLibraryTables,sqliteLibrarySchemaVersion,sqliteSourceDataTables} from './sqliteProtocol';
import {libraryRowsReader} from './libraryRecordReader';
import type {BackupRows} from './backupValidation';
import {validateLibraryRecordSteps} from './backupValidation';
import {runCooperatively} from '../../experience/personalMeaningJourney/cooperative';
import {immutableLightweightMaterializationValidator} from '../../learning/runtime/lightweightInitialContent';
import type {ReplicaCandidateFence} from './replicaCandidateProtocol';
import type {LibraryRecordReader} from './libraryRecordReader';

const fileLimit=90*1024*1024,expandedLimit=512*1024*1024,rowLimit=200000;
export type LocalPortableSnapshot={format:'sensa-local-db-snapshot-v1';schemaVersion:typeof sqliteLibrarySchemaVersion;sourceRevision:number;sha256:string;bytes:Uint8Array;timingsMs:{build:number;storageCopy:number;admission:number;projection:number;export:number}};
/** Supplied by the authenticated cursor coordinator, never by an import file. */
export type OwnCloudSnapshotBinding={accountId:string;libraryId:string;learnerId:string;revision:number;sourceRevision:number;records:number;sha256:string;byteLength:number;schemaVersion:number};
type SchemaRow={type:string;name:string;tbl_name:string;sql:string|null};
const invalid=(reason:string):never=>{throw Error(`sqlite_snapshot_${reason}`);};
const statisticsSql=new Set(['CREATE TABLE sqlite_stat1(tbl,idx,stat)','CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)']);
const definitions=(raw:Database)=>(raw.exec({sql:'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',rowMode:'object',returnValue:'resultRows'}) as SchemaRow[]).filter(row=>!(row.type==='table'&&row.sql!==null&&statisticsSql.has(row.sql)));
export {definitions as portableSnapshotSchema,projectionVersions as portableSnapshotVersions,restrict as restrictPortableSnapshot};
const scalar=(raw:Database,sql:string)=>raw.selectValue(sql);
const projectionVersions=(raw:Database)=>[
 ...['sensa_meaning_lookup_meta','sensa_world_browse_meta','sensa_practice_expression_meta','sensa_journey_identity_meta'].map(table=>scalar(raw,`SELECT version FROM ${table} WHERE id=1`)),
 ...['sensa_learning_history_meta','sensa_runtime_learning_meta'].map(table=>scalar(raw,`SELECT value FROM ${table} WHERE key='format'`)),
];
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
 const copyPolicy:ConstructorParameters<typeof SqliteRecordDatabase>[3]=portableBuild?(table,key)=>isReplicatedLibraryEntry(table,key)&&canCopyNormalizedLibraryReplicaValue({table:table as typeof librarySyncTables[number],key}):undefined;
 const library=new SqliteRecordDatabase(sqlite,raw,pool?'opfs':'memory',copyPolicy);library.initialize();return {raw,library};
}
function freeze(value:any,seen:WeakSet<object>){
 if(value===null||typeof value!=='object'||seen.has(value))return;seen.add(value);
 for(const item of Object.values(value))freeze(item,seen);Object.freeze(value);
}
/** Decode each real stored record once. Shared bodies are digest-checked and
 * decoded once globally, then referenced by immutable decoded facts. */
async function decodedFacts(raw:Database,policy:'external'|'own-cloud'='external'){
 if(policy==='own-cloud')return boundedOwnCloudFacts(raw);
 const rows=emptyRows(),bodies=new Map<string,unknown>(),used=new Set<string>(),frozen=new WeakSet<object>();
 let bytes=0,count=0,bodyCount=0;
 const addBytes=(text:string)=>{bytes+=new TextEncoder().encode(text).length;if(bytes>expandedLimit)invalid('expanded_limit');};
 let afterBody='';
 for(;;){
 const bodyRows=raw.exec({sql:'SELECT digest,value_json FROM sensa_shared_record_content WHERE digest>? ORDER BY digest LIMIT 64',bind:[afterBody],rowMode:'object',returnValue:'resultRows'}) as {digest:string;value_json:string}[];
 for(const body of bodyRows){
  const text=unpackStoredRecord(body.value_json,undefined,expandedLimit-bytes);
  if(++bodyCount>rowLimit||!/^[a-f0-9]{64}$/u.test(body.digest)||sha256(text)!==body.digest)invalid('shared_body');
  addBytes(text);const value=decodeBackupValue(JSON.parse(text));freeze(value,frozen);bodies.set(body.digest,value);
 }
 if(bodyRows.length<64)break;afterBody=bodyRows.at(-1)!.digest;await new Promise<void>(resolve=>setTimeout(resolve,0));
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
 if(!identity||identity.schemaVersion!==2||!(['id','learnerId','deviceId'] as const).every(key=>typeof identity[key]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(identity[key])))invalid('identity');
 return {rows,reader,identity,stats:{decodedRecords:count,decodedBodies:bodyCount,expandedBytes:bytes}};
}
/** The normal replication gate never holds the complete decoded Library.
 * A 16 MiB/256-body cache and 64-key SQL windows bound shared material residence;
 * one admitted large record keeps the existing independent inflate limit. */
async function boundedOwnCloudFacts(raw:Database){
 const cache=new Map<string,{value:unknown;bytes:number}>(),used=new Set<string>();let held=0,bytes=0,count=0,bodyCount=0,afterBody='',maximumSourceWindowBytes=0,maximumCachedBodyBytes=0;
 const page=(kind:'body'|'record',after:string,table?:string)=>{
  const name=kind==='body'?'sensa_shared_record_content':'sensa_records',key=kind==='body'?'digest':'record_key',where=kind==='body'?`${key}>?`:`table_name=? AND ${key}>?`,bind=kind==='body'?[after]:[table!,after];
  const sizes=raw.exec({sql:`SELECT ${key} AS record_key,length(CAST(value_json AS BLOB)) AS bytes FROM ${name} WHERE ${where} ORDER BY ${key} LIMIT 64`,bind,rowMode:'object',returnValue:'resultRows'}) as {record_key:string;bytes:number}[];
  const keys:string[]=[];let physical=0;for(const row of sizes){if(keys.length&&physical+row.bytes>1024*1024)break;if(row.bytes>fileLimit)invalid('file_limit');keys.push(row.record_key);physical+=row.bytes;}maximumSourceWindowBytes=Math.max(maximumSourceWindowBytes,physical);
  if(!keys.length)return [];
  return raw.exec({sql:`SELECT ${key} AS record_key,value_json FROM ${name} WHERE ${kind==='record'?'table_name=? AND ':''}${key} IN(SELECT value FROM json_each(?)) ORDER BY ${key}`,bind:kind==='body'?[JSON.stringify(keys)]:[table!,JSON.stringify(keys)],rowMode:'object',returnValue:'resultRows'}) as {record_key:string;value_json:string}[];
 };
 const add=(text:string)=>{bytes+=new TextEncoder().encode(text).length;if(bytes>librarySyncLogicalByteLimit)invalid('expanded_limit');};
 for(;;){const rows=page('body',afterBody);if(!rows.length)break;
  for(const body of rows){const text=unpackStoredRecord(body.value_json,undefined,96*1024*1024);if(++bodyCount>librarySyncRecordLimit||!/^[a-f0-9]{64}$/u.test(body.record_key)||sha256(text)!==body.record_key)invalid('shared_body');add(text);decodeBackupValue(JSON.parse(text));}
  afterBody=rows.at(-1)!.record_key;await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 const bodies={has:(digest:string)=>!!cache.has(digest)||!!raw.selectValue("SELECT 1 FROM sensa_shared_record_content WHERE digest=?",[digest]),get:(digest:string)=>{
  const hit=cache.get(digest);if(hit){cache.delete(digest);cache.set(digest,hit);return hit.value;}
  const stored=raw.selectValue('SELECT value_json FROM sensa_shared_record_content WHERE digest=?',[digest]);if(typeof stored!=='string')invalid('shared_body');
  const text=unpackStoredRecord(stored as string,undefined,96*1024*1024),value=decodeBackupValue(JSON.parse(text)),size=new TextEncoder().encode(text).length;freeze(value,new WeakSet());
  if(size<=16*1024*1024){while(cache.size&&(held+size>16*1024*1024||cache.size>=256)){const oldest=cache.keys().next().value!;held-=cache.get(oldest)!.bytes;cache.delete(oldest);}cache.set(digest,{value,bytes:size});held+=size;maximumCachedBodyBytes=Math.max(maximumCachedBodyBytes,held);}return value;
 }} as ReadonlyMap<string,unknown>;
 const decode=(table:typeof sqliteLibraryTables[number],key:string,stored:string)=>{
  const text=unpackStoredRecord(stored,undefined,96*1024*1024),refs=new Set<string>(),value=decodeSharedArchiveWire(JSON.parse(text),bodies,refs);
  const owners=raw.exec({sql:"SELECT digest FROM sensa_shared_record_content_owners WHERE owner_kind='record' AND table_name=? AND record_key=? ORDER BY digest",bind:[table,key],rowMode:0,returnValue:'resultRows'}) as string[];
  if(JSON.stringify([...refs].sort())!==JSON.stringify(owners))invalid('shared_owners');for(const ref of refs)used.add(ref);freeze(value,new WeakSet());return {text,value};
 };
 const reader:LibraryRecordReader={get:(table,key)=>{const stored=raw.selectValue('SELECT value_json FROM sensa_records WHERE table_name=? AND record_key=?',[table,key]);return typeof stored==='string'?decode(table,key,stored).value:undefined;},has:(table,key)=>!!raw.selectValue('SELECT 1 FROM sensa_records WHERE table_name=? AND record_key=?',[table,key]),entries:table=>({*[Symbol.iterator](){let after='';for(;;){const rows=page('record',after,table);if(!rows.length)return;for(const row of rows)yield {key:row.record_key,value:decode(table,row.record_key,row.value_json).value};after=rows.at(-1)!.record_key;}}})};
 for(const table of sqliteLibraryTables){let after='';for(;;){const rows=page('record',after,table);if(!rows.length)break;for(const row of rows){if(++count>librarySyncRecordLimit||!isReplicatedLibraryEntry(table,row.record_key))invalid('private_record');add(decode(table,row.record_key,row.value_json).text);}after=rows.at(-1)!.record_key;await new Promise<void>(resolve=>setTimeout(resolve,0));}}
 if(used.size!==bodyCount)invalid('orphan_body');
 if(Number(scalar(raw,'SELECT count(*) FROM sensa_sync_base'))||Number(scalar(raw,'SELECT count(*) FROM sensa_record_tombstones'))||Number(scalar(raw,'SELECT count(*) FROM sensa_portable_media'))||Number(scalar(raw,'SELECT count(*) FROM sensa_portable_package_media')))invalid('device_storage');
 if(Number(scalar(raw,"SELECT count(*) FROM sensa_shared_record_content_owners WHERE owner_kind!='record'"))||Number(scalar(raw,"SELECT count(*) FROM sensa_shared_record_content_owners AS owner WHERE NOT EXISTS(SELECT 1 FROM sensa_records AS record WHERE record.table_name=owner.table_name AND record.record_key=owner.record_key)")))invalid('shared_owners');
 const identity=reader.get('meta','identity');if(!identity||identity.schemaVersion!==2||!['id','learnerId','deviceId'].every(key=>typeof identity[key]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(identity[key])))invalid('identity');
 return {reader,identity,stats:{decodedRecords:count,decodedBodies:bodyCount,expandedBytes:bytes,maximumSourceWindowBytes,maximumCachedBodyBytes}};
}

/** Local frozen-revision producer. It creates a trusted clean library using
 * portable facts only; it never copies owner file pages or clears the source. */
export async function createLocalPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,source:SqliteRecordDatabase,expectedRevision:number):Promise<LocalPortableSnapshot>{
 return buildPortableSnapshot(sqlite,pool,source,expectedRevision,'external');
}
/** Normal account replication: controlled writes maintain domain relations.
 * Arbitrary backup/file/package imports keep the external admission entry. */
export async function createOwnCloudPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,source:SqliteRecordDatabase,fence:ReplicaCandidateFence):Promise<LocalPortableSnapshot>{
 const owner=source.get('meta','service-owner'),identity=source.get('meta','identity'),incarnation=source.get('meta','local-incarnation');
 const current=owner===null?undefined:decodeBackupValue(JSON.parse(owner));
 if(current?.subject!==fence.owner.subject||current?.accountId!==fence.owner.accountId||identity===null||!backupEqual(decodeBackupValue(JSON.parse(identity)),fence.identity)||(incarnation===null?'initial':decodeBackupValue(JSON.parse(incarnation)))!==fence.incarnation||source.get('meta','signed-out')!==null&&decodeBackupValue(JSON.parse(source.get('meta','signed-out')!)))invalid('owner');
 return buildPortableSnapshot(sqlite,pool,source,fence.localRevision,'own-cloud');
}
async function buildPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,source:SqliteRecordDatabase,expectedRevision:number,policy:'external'|'own-cloud'):Promise<LocalPortableSnapshot>{
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
    const page=source.recordKeysPage(table,after,64),puts=[],copy=[];
    for(const key of page)if(isReplicatedLibraryEntry(table,key)){
     if(canCopyNormalizedLibraryReplicaValue({table,key})){copy.push(key);continue;}
     const encoded=source.get(table,key);if(encoded===null)invalid('source_changed');
     const value=decodeBackupValue(JSON.parse(encoded!)),normalized=normalizeLibraryReplicaEntry({table,key,value},identity);
     puts.push({table,key,encodedValue:JSON.stringify(encodeBackupValue(normalized.value))});
    }
    if(copy.length)target.library.copyStoredPortableFacts(source,table,copy);
    if(puts.length)target.library.appendPortableSnapshotFacts(puts);
    if(page.length<64)break;after=page.at(-1)!;
   }
  }
  target.raw.exec('COMMIT');
  }catch(error){target.raw.exec('ROLLBACK');throw error;}
  assertSource();
  const copied=performance.now();
  const facts=await decodedFacts(target.raw,policy);
  assertSource();
  const built=performance.now();target.library.rebuildPortableProjections(facts.reader);
  const projected=performance.now();target.raw.exec({sql:'VACUUM INTO ?',bind:[output]});
  const bytes=pool.exportFile(output) as unknown as Uint8Array;if(bytes.byteLength>fileLimit)invalid('file_limit');
  return {format:'sensa-local-db-snapshot-v1',schemaVersion:sqliteLibrarySchemaVersion,sourceRevision:expectedRevision,sha256:sha256(bytes),bytes,timingsMs:{build:built-started,storageCopy:copied-started,admission:built-copied,projection:projected-built,export:performance.now()-projected}};
 }finally{target.library.close();pool.unlink(file);pool.unlink(output);}
}

/** The destination is a fresh independent namespace. This stage does not
 * select it as the user's active library or manufacture a cloud checkpoint. */
export async function importLocalPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,file:string,snapshot:LocalPortableSnapshot){
 return importPortableSnapshot(sqlite,pool,file,snapshot,'external');
}
/** Only the authenticated own-library coordinator calls this distinct entry.
 * Binding is independently obtained from its account's exact committed H. */
export async function importOwnCloudPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,file:string,snapshot:LocalPortableSnapshot,binding:OwnCloudSnapshotBinding,expectedAccountId:string){
 if(binding.accountId!==expectedAccountId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(binding.accountId)||!Number.isSafeInteger(binding.revision)||binding.revision<1||binding.sourceRevision!==snapshot.sourceRevision||binding.schemaVersion!==snapshot.schemaVersion||binding.byteLength!==snapshot.bytes.byteLength||binding.sha256!==snapshot.sha256||!Number.isSafeInteger(binding.records)||binding.records<1||binding.records>librarySyncRecordLimit)invalid('checkpoint_binding');
 return importPortableSnapshot(sqlite,pool,file,snapshot,'own-cloud',{...binding});
}
async function importPortableSnapshot(sqlite:Sqlite3Static,pool:SAHPoolUtil,file:string,input:LocalPortableSnapshot,policy:'external'|'own-cloud',binding?:OwnCloudSnapshotBinding){
 if(pool.getFileCount()!==0)invalid('destination_not_empty');
 if(input.bytes.byteLength>fileLimit)invalid('envelope');
 // Freeze the exact buffer consumed after asynchronous import starts. The
 // caller cannot swap H-bound bytes after the hash check.
 const snapshot={...input,bytes:input.bytes.slice()};
 if(snapshot.format!=='sensa-local-db-snapshot-v1'||snapshot.schemaVersion!==sqliteLibrarySchemaVersion||!Number.isSafeInteger(snapshot.sourceRevision)||snapshot.sourceRevision<0||snapshot.bytes.byteLength>fileLimit||snapshot.bytes.byteLength<512||sha256(snapshot.bytes)!==snapshot.sha256)invalid('envelope');
 const expected=trusted(sqlite);const schema=definitions(expected.raw),versions=projectionVersions(expected.raw);expected.library.close();
 let raw:Database|undefined,library:SqliteRecordDatabase|undefined;const started=performance.now();
 try{
  let at=0;await pool.importDb(file,()=>{if(at===snapshot.bytes.byteLength)return undefined;const next=Math.min(at+256*1024,snapshot.bytes.byteLength),chunk=snapshot.bytes.subarray(at,next);at=next;return chunk;});
  const imported=performance.now();raw=new pool.OpfsSAHPoolDb(file);restrict(sqlite,raw);
  if(JSON.stringify(definitions(raw))!==JSON.stringify(schema)||scalar(raw,'PRAGMA user_version')!==sqliteLibrarySchemaVersion)invalid('schema_allowlist');
  if(policy==='own-cloud'&&(JSON.stringify(projectionVersions(raw))!==JSON.stringify(versions)||scalar(raw,"SELECT count(*) FROM sensa_records WHERE table_name='learningTargets'")!==scalar(raw,'SELECT count(*) FROM sensa_learning_semantic_memory')))invalid('projection_version');
  // Register only application-owned innocuous functions after the schema gate.
  library=new SqliteRecordDatabase(sqlite,raw,'opfs');
  if(scalar(raw,'PRAGMA integrity_check')!=='ok'||raw.exec({sql:'PRAGMA foreign_key_check',returnValue:'resultRows'}).length)invalid('integrity');
  const facts=await decodedFacts(raw,policy);
  if(binding&&(facts.identity.id!==binding.libraryId||facts.identity.learnerId!==binding.learnerId||facts.stats.decodedRecords!==binding.records))invalid('checkpoint_binding');
  // The schema is now exactly the application-owned allowlist and facts have
  // passed their distinct admission gate. Restore mutation invalidation before
  // this connection becomes a Library; imported triggers stayed disabled until here.
  if(sqlite.capi.sqlite3_db_config(raw.pointer!,sqlite.capi.SQLITE_DBCONFIG_ENABLE_TRIGGER,1)!==0)invalid('connection_restriction');
  const admitted=performance.now();let before:ReturnType<typeof projectionValues>;
  if(policy==='external')library.rebuildPortableProjections(facts.reader,stage=>{
   if(stage==='before'){before=projectionValues(raw!);return;}
   const after=projectionValues(raw!);
   if(before.size!==after.size||[...before].some(([table,digest])=>after.get(table)!==digest))invalid('projection_values');
  });
  else library.initialize();
  const projected=performance.now();
  const identity={...facts.identity,deviceId:crypto.randomUUID()};
  library.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))},{table:'meta',key:'local-incarnation',encodedValue:JSON.stringify(encodeBackupValue(crypto.randomUUID()))},{table:'meta',key:'local-content-revision',encodedValue:JSON.stringify(encodeBackupValue(1))}]});
  return {library,identity,stats:facts.stats,timingsMs:{import:imported-started,admission:admitted-imported,projection:projected-admitted,deviceBootstrap:performance.now()-projected}};
 }catch(error){try{if(library)library.close(false);else raw?.close();}finally{pool.unlink(file);}throw error;}
}
