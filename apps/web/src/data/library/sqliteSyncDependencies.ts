import {librarySyncStoredByteLimit,librarySyncRecordLimit,librarySyncLogicalByteLimit} from '@sensa/contracts/sensa';
import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {z} from 'zod';
import {replicaWork} from './replicaWork';
import {backupEqual} from './backupCodec';
import {validatedCheckpoint} from './cloudSyncCheckpoint';
import {libraryRestoreValidationVersion} from './replication/libraryReplicaValidation';
import type {CloudSyncState} from './cloudSync';
import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {ReplicaCandidateFence} from './replicaCandidateProtocol';

export type SyncDependencyRow={table:SqliteLibraryTable;key:string;digest:string;bytes:number;storedBytes:number;edges:Array<[string,string]>;protocols:Array<[string,string]>};
interface AdmissionRows{readonly size:number;has(key:string):boolean;get(key:string):SyncDependencyRow|undefined;set(key:string,row:SyncDependencyRow):AdmissionRows;clear():void;values():IterableIterator<SyncDependencyRow>;[Symbol.iterator]():IterableIterator<[string,SyncDependencyRow]>;}
export type SyncAdmission={rows:AdmissionRows;scope?:string;flush?:(insideTransaction?:boolean)=>void;retainedMetadataBytes?:()=>number;packageCacheComplete:boolean;logicalBytes:number;storedBytes:number;metadataBytes:number;deletes?:Array<{table:SqliteLibraryTable;key:string}>;disabled?:string};
export type SyncDependencyCertificate={generation:number;epoch:number;version:2;validationVersion:number;owner:ReplicaCandidateFence['owner'];incarnation:string;libraryId:string;learnerId:string;revision:number;localRevision:number;artifactRevision:number;records:number;logicalBytes:number;storedBytes:number;packageCacheComplete:boolean};
const id=(table:string,key:string)=>JSON.stringify([table,key]);
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),uuid=z.string().uuid();
const certificateSchema=z.object({generation:counter,epoch:counter,version:z.literal(2),validationVersion:z.literal(libraryRestoreValidationVersion),owner:z.object({subject:uuid,accountId:uuid}).strict(),incarnation:z.string().min(1).max(128),libraryId:uuid,learnerId:uuid,revision:counter,localRevision:counter,artifactRevision:counter,records:z.number().int().min(1).max(librarySyncRecordLimit),logicalBytes:counter.max(librarySyncLogicalByteLimit),storedBytes:counter.max(librarySyncStoredByteLimit),packageCacheComplete:z.boolean()}).strict();
const schema=`
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_state_v1(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL DEFAULT 0,epoch INTEGER NOT NULL DEFAULT 0,certificate_json TEXT);
INSERT OR IGNORE INTO sensa_sync_dependency_state_v1(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_rows_v1(table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,logical_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,PRIMARY KEY(table_name,record_key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_edges_v1(table_name TEXT NOT NULL,record_key TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(table_name,record_key,kind,target),FOREIGN KEY(table_name,record_key) REFERENCES sensa_sync_dependency_rows_v1(table_name,record_key) ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_sync_dependency_reverse_v1 ON sensa_sync_dependency_edges_v1(kind,target,table_name,record_key);
CREATE TABLE IF NOT EXISTS sensa_sync_protocol_owners_v1(protocol_id TEXT PRIMARY KEY,run_key TEXT NOT NULL,target_key TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_sync_admission_v1(scope TEXT PRIMARY KEY,records INTEGER NOT NULL DEFAULT 0,logical_bytes INTEGER NOT NULL DEFAULT 0,stored_bytes INTEGER NOT NULL DEFAULT 0,metadata_bytes INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_sync_admission_rows_v1(scope TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,logical_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,edges_json TEXT NOT NULL,protocols_json TEXT NOT NULL,metadata_bytes INTEGER NOT NULL,meaning_id TEXT GENERATED ALWAYS AS(CASE WHEN table_name='semanticReceipts' AND json_extract(edges_json,'$[0][0]')='meaningReceipt' THEN json_extract(edges_json,'$[0][1]') END) VIRTUAL,PRIMARY KEY(scope,table_name,record_key),FOREIGN KEY(scope) REFERENCES sensa_sync_admission_v1 ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_sync_admission_meaning_v1 ON sensa_sync_admission_rows_v1(scope,meaning_id);
`;
const triggers=[...['INSERT','UPDATE','DELETE'].flatMap(action=>[
 {name:`sensa_sync_base_generation_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_base_generation_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_base BEGIN UPDATE sensa_sync_dependency_state_v1 SET generation=generation+1,certificate_json=NULL WHERE id=1; END;`},
 ...['rows','edges'].map(table=>({name:`sensa_sync_dependency_${table}_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_dependency_${table}_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_dependency_${table}_v1 BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;`})),
 {name:`sensa_sync_protocol_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_protocol_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_protocol_owners_v1 BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;`},
]),{name:'sensa_sync_shared_update_v1',sql:'CREATE TRIGGER IF NOT EXISTS sensa_sync_shared_update_v1 AFTER UPDATE ON sensa_shared_record_content BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;'}];
const normalized=(sql:string)=>sql.replace(/\bIF NOT EXISTS\s*/gu,'').replace(/\s+/gu,' ').replace(/;$/u,'').trim();

/** Snapshot row digests, budgets, protocol ownership and Session-start lookup.
 * SQL mutation invalidates this storage receipt;
 * only a complete admission or its checked sparse successor can renew it. */
export class SqliteSyncDependencies{
 private ready=false;
 private healthySchema=true;
 private schemaCookie=-1;
 private readonly statements=new Map<string,PreparedStatement>();
 constructor(private readonly database:Database){}
 resetSchema():void{this.ready=false;this.healthySchema=true;}
 private rows<T>(sql:string,bind:readonly (string|number)[]=[]):T[]{
  let statement=this.statements.get(sql);if(!statement){replicaWork('dependency.prepare');statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind([...bind]);
  const rows:T[]=[];try{while(statement.step())rows.push(statement.get({}) as T);return rows;}finally{statement.reset(true);}
 }
 close():void{for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 ensure():void{
  const cookie=Number(this.rows<{v:number}>('SELECT schema_version AS v FROM pragma_schema_version')[0].v);
  if(this.ready&&cookie===this.schemaCookie)return;
  const prior=this.rows<{name:string;sql:string}>("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'sensa_sync_%_v1'");
  this.database.exec(schema);for(const trigger of triggers)this.database.exec(trigger.sql);
  const definitions=[...triggers,...schema.split(';').filter(sql=>sql.trim().startsWith('CREATE')&&!sql.includes('sensa_sync_admission')).map(sql=>({sql:sql.trim(),name:sql.match(/(?:TABLE|INDEX) IF NOT EXISTS (\w+)/u)![1]!}))];
  this.healthySchema=!prior.some(row=>definitions.some(definition=>definition.name===row.name&&normalized(definition.sql)!==normalized(row.sql)));
  if(!this.healthySchema||prior.length&&definitions.some(definition=>!prior.some(row=>row.name===definition.name)))this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');
  this.ready=true;
  this.schemaCookie=Number(this.rows<{v:number}>('SELECT schema_version AS v FROM pragma_schema_version')[0].v);
 }
 clock(){this.ensure();return this.rows<{generation:number;epoch:number;certificate_json:string|null}>('SELECT * FROM sensa_sync_dependency_state_v1 WHERE id=1')[0];}
 certificate():SyncDependencyCertificate|undefined{const row=this.clock();if(!this.healthySchema||!row.certificate_json)return;let raw:unknown;try{raw=JSON.parse(row.certificate_json);}catch{return;}const parsed=certificateSchema.safeParse(raw);if(!parsed.success)return;const certificate=parsed.data;if(certificate.generation!==row.generation||certificate.epoch!==row.epoch)return;return certificate;}
 match(state:CloudSyncState|undefined,fence:ReplicaCandidateFence,artifactRevision:number){
  // The live revision fences source edits. The certificate's localRevision
  // records admission provenance, not baseline identity: private commands and
  // a checked empty-delta ACK can advance the clean checkpoint independently.
  if(!validatedCheckpoint(state)||state!.syncedLocalRevision!==fence.localRevision||!backupEqual(state!.owner,fence.owner)||state!.incarnation!==fence.incarnation)return;
  const certificate=this.certificate();if(!certificate||certificate.revision!==state!.revision||certificate.artifactRevision!==artifactRevision||certificate.incarnation!==fence.incarnation||!backupEqual(certificate.owner,fence.owner)||certificate.libraryId!==fence.identity.id||certificate.learnerId!==fence.identity.learnerId)return;
  return certificate;
 }
 assert(certificate:SyncDependencyCertificate):void{const current=this.certificate();if(!current||!backupEqual(current,certificate))throw Error('library_sync_local_changed');}
 keys(kind:string,target:string):Array<{table:SqliteLibraryTable;key:string}>{this.ensure();return this.rows<{table:SqliteLibraryTable;key:string}>('SELECT table_name AS "table",record_key AS "key" FROM sensa_sync_dependency_edges_v1 INDEXED BY sensa_sync_dependency_reverse_v1 WHERE kind=? AND target=? ORDER BY table_name,record_key',[kind,target]);}
 protocolOwner(protocolId:string){this.ensure();return this.rows<{run_key:string;target_key:string}>('SELECT run_key,target_key FROM sensa_sync_protocol_owners_v1 WHERE protocol_id=?',[protocolId])[0];}
 verify(table:SqliteLibraryTable,key:string,text:string):void{const row=this.rows<{digest:string}>('SELECT digest FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[table,key])[0];if(!row||row.digest!==sha256(text))throw Error('library_sync_dependency_corrupt');}
 count(){return Number(this.rows<{n:number}>('SELECT count(*) AS n FROM sensa_sync_dependency_rows_v1')[0].n);}
 clear():void{this.ensure();this.rows('DELETE FROM sensa_sync_protocol_owners_v1');this.rows('DELETE FROM sensa_sync_dependency_rows_v1');this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');}
 /** Install this admitted publication's optional index without selecting its
  * baseline. A missing certificate keeps partial work unavailable to reuse. */
 async preparePublication(scope:string,alive:()=>void,onPage:(records:number)=>void,afterBatch?:()=>void):Promise<{generation:number;epoch:number}>{
  this.ensure();alive();let expected=this.clock();
  const check=()=>{alive();const clock=this.clock();if(clock.generation!==expected.generation||clock.epoch!==expected.epoch)throw Error('library_sync_local_changed');};
  const batch=(work:()=>number)=>{check();this.database.exec('BEGIN IMMEDIATE');try{check();this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');const changes=work(),clock=this.clock();if(clock.generation!==expected.generation||clock.epoch!==expected.epoch+changes||clock.certificate_json!==null)throw Error('library_sync_local_changed');this.database.exec('COMMIT');expected=clock;}catch(cause){this.database.exec('ROLLBACK');throw cause;}afterBatch?.();};
  batch(()=>0);
  for(const table of ['sensa_sync_protocol_owners_v1','sensa_sync_dependency_edges_v1','sensa_sync_dependency_rows_v1'])for(;;){
   const keys=table==='sensa_sync_protocol_owners_v1'?['protocol_id']:table==='sensa_sync_dependency_edges_v1'?['table_name','record_key','kind','target']:['table_name','record_key'];
   check();const rows=this.rows<Record<string,string>>(`SELECT ${keys.join(',')} FROM ${table} ORDER BY ${keys.join(',')} LIMIT 128`);if(!rows.length)break;
   batch(()=>{this.rows(`DELETE FROM ${table} WHERE (${keys.join(',')}) IN(SELECT ${keys.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?))`,[JSON.stringify(rows.map(row=>keys.map(key=>row[key])))]);if(this.database.changes()!==rows.length)throw Error('library_sync_dependency_corrupt');return rows.length;});await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  let table='',key='',records=0;
  for(;;){check();const page=this.rows<{table_name:string;record_key:string;edges_json:string;protocols_json:string;metadata_bytes:number}>('SELECT table_name,record_key,edges_json,protocols_json,metadata_bytes FROM sensa_sync_admission_rows_v1 WHERE scope=? AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64',[scope,table,key]);if(!page.length)break;
   const selected:typeof page=[];let bytes=0;for(const row of page){if(selected.length&&bytes+row.metadata_bytes>1024*1024)break;selected.push(row);bytes+=row.metadata_bytes;}
   const identities=JSON.stringify(selected.map(row=>[row.table_name,row.record_key]));
   batch(()=>{const filter='row.scope=? AND(row.table_name,row.record_key) IN(SELECT json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?))';
    this.rows('INSERT INTO sensa_sync_dependency_rows_v1 SELECT table_name,record_key,digest,logical_bytes,stored_bytes FROM sensa_sync_admission_rows_v1 row WHERE '+filter,[scope,identities]);if(this.database.changes()!==selected.length)throw Error('library_sync_dependency_corrupt');
    return selected.length;});
   for(const family of ['edges','protocols'] as const){let pending:string[][]=[];
    const flush=async()=>{if(!pending.length)return;const entries=pending;pending=[];batch(()=>{this.rows(family==='edges'?"INSERT INTO sensa_sync_dependency_edges_v1 SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]') FROM json_each(?)":"INSERT INTO sensa_sync_protocol_owners_v1 SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?)",[JSON.stringify(entries)]);if(this.database.changes()!==entries.length)throw Error('library_sync_dependency_corrupt');return entries.length;});await new Promise<void>(resolve=>setTimeout(resolve,0));};
    for(const row of selected)for(const pair of JSON.parse(family==='edges'?row.edges_json:row.protocols_json) as Array<[string,string]>){pending.push(family==='edges'?[row.table_name,row.record_key,...pair]:[pair[0],row.record_key,pair[1]]);if(pending.length===128)await flush();}await flush();
   }
   records+=selected.length;table=selected.at(-1)!.table_name;key=selected.at(-1)!.record_key;onPage(records);await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  check();return {generation:expected.generation,epoch:expected.epoch};
 }
 /** Atomically select a prepared same-layout baseline and renew its triggers.
  * The generation is an invalidation clock, not a count of copied records. */
 replacePreparedBaseline():void{
  this.ensure();const known=new Set(['insert','update','delete'].map(action=>`sensa_sync_base_generation_${action}_v1`));
  const references=this.rows<{name:string;type:string;tbl_name:string;sql:string|null}>("SELECT name,type,tbl_name,sql FROM sqlite_schema UNION ALL SELECT name,type,tbl_name,sql FROM sqlite_temp_schema");
  if(references.some(row=>row.sql&&/\bsensa_sync_base\b/iu.test(row.sql)&&row.name!=='sensa_sync_base'&&!known.has(row.name)))throw Error('library_sync_candidate_invalid');
  for(const action of ['insert','update','delete'])this.rows(`DROP TRIGGER sensa_sync_base_generation_${action}_v1`);
  this.rows('ALTER TABLE sensa_sync_base RENAME TO sensa_initial_publication_retired_base');
  this.rows('ALTER TABLE sensa_initial_publication_baseline RENAME TO sensa_sync_base');
  for(const trigger of triggers.filter(trigger=>trigger.name.startsWith('sensa_sync_base_generation_')))this.database.exec(trigger.sql);
  this.rows('UPDATE sensa_sync_dependency_state_v1 SET generation=generation+1,certificate_json=NULL WHERE id=1');this.ready=false;
 }
 certifyPreparedPublication(admission:SyncAdmission,expected:{generation:number;epoch:number},state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number):void{
  this.certifyPreparedRestore(admission,{generation:expected.generation+1,epoch:expected.epoch},state,identity,artifactRevision);
 }
 /** Rebind only a verified own-cloud v2 file's retained admission to this device.
  * The importer has checked the complete file and native facts/baseline joins. */
 certifyAdmittedSnapshot(metadata:import('./sqliteAdmittedSnapshot').AdmittedSnapshotMetadata,state:CloudSyncState,identity:LibraryIdentity):void{
  const clock=this.clock(),stats=this.rows<{records:number;logical:number;stored:number}>('SELECT count(*) AS records,coalesce(sum(logical_bytes),0) AS logical,coalesce(sum(stored_bytes),0) AS stored FROM sensa_sync_dependency_rows_v1')[0];
  if(!this.healthySchema||!validatedCheckpoint(state)||metadata.admissionVersion!==libraryRestoreValidationVersion||metadata.accountId!==state.owner.accountId||metadata.revision!==state.revision||metadata.libraryId!==identity.id||metadata.learnerId!==identity.learnerId||stats.records!==metadata.records||stats.logical!==metadata.logicalBytes||stats.stored!==metadata.storedBytes)throw Error('sqlite_snapshot_admission');
  const certificate:SyncDependencyCertificate={generation:clock.generation,epoch:clock.epoch,version:2,validationVersion:libraryRestoreValidationVersion,owner:state.owner,incarnation:state.incarnation,libraryId:identity.id,learnerId:identity.learnerId,revision:state.revision,localRevision:state.syncedLocalRevision!,artifactRevision:0,records:metadata.records,logicalBytes:metadata.logicalBytes,storedBytes:metadata.storedBytes,packageCacheComplete:false};
  this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=? WHERE id=1',[JSON.stringify(certificate)]);
 }
 /** The private installer has filled the new baseline and fenced every write. */
 certifyPreparedRestore(admission:SyncAdmission,expected:{generation:number;epoch:number},state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number):void{
  const clock=this.clock();if(clock.generation!==expected.generation||clock.epoch!==expected.epoch)throw Error('library_sync_local_changed');
  if(!this.healthySchema||admission.disabled||!validatedCheckpoint(state))return;
  const stats=this.rows<{records:number;logical_bytes:number;stored_bytes:number}>('SELECT records,logical_bytes,stored_bytes FROM sensa_sync_admission_v1 WHERE scope=?',[admission.scope!])[0];if(!stats||stats.logical_bytes>librarySyncLogicalByteLimit||stats.stored_bytes>librarySyncStoredByteLimit)throw Error('library_sync_capacity');
  const certificate:SyncDependencyCertificate={generation:clock.generation,epoch:clock.epoch,version:2,validationVersion:libraryRestoreValidationVersion,owner:state.owner,incarnation:state.incarnation,libraryId:identity.id,learnerId:identity.learnerId,revision:state.revision,localRevision:state.syncedLocalRevision!,artifactRevision,records:stats.records,logicalBytes:stats.logical_bytes,storedBytes:stats.stored_bytes,packageCacheComplete:admission.packageCacheComplete};
  this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=? WHERE id=1',[JSON.stringify(certificate)]);
 }
 rowBudget(table:SqliteLibraryTable,key:string){return this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[table,key])[0]??{logical_bytes:0,stored_bytes:0};}
 /** Private capture/candidate observation. Only one key page enters JavaScript. */
 spoolAdmission(scope:string,insidePage=false,onMetadataStored?:(bytes:number,records:number)=>void):SyncAdmission{
  this.ensure();this.rows('INSERT INTO sensa_sync_admission_v1(scope) VALUES(?) ON CONFLICT DO NOTHING',[scope]);
  const db=this,pending=new Map<string,SyncDependencyRow>();let pendingBytes=0;
  const from=(row:any):SyncDependencyRow=>({table:row.table_name,key:row.record_key,digest:row.digest,bytes:row.logical_bytes,storedBytes:row.stored_bytes,edges:JSON.parse(row.edges_json),protocols:JSON.parse(row.protocols_json)});
  const flush=(insideTransaction=false)=>{if(!pending.size)return;if(!insideTransaction)db.database.exec('BEGIN IMMEDIATE');try{let addedMetadata=0;for(const row of pending.values()){const metadata=new TextEncoder().encode(scope+row.table+row.key+row.digest+JSON.stringify(row.edges)+JSON.stringify(row.protocols)).length;addedMetadata+=metadata;db.rows('INSERT INTO sensa_sync_admission_rows_v1(scope,table_name,record_key,digest,logical_bytes,stored_bytes,edges_json,protocols_json,metadata_bytes) VALUES(?,?,?,?,?,?,?,?,?)',[scope,row.table,row.key,row.digest,row.bytes,row.storedBytes,JSON.stringify(row.edges),JSON.stringify(row.protocols),metadata]);db.rows('UPDATE sensa_sync_admission_v1 SET records=records+1,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+?,metadata_bytes=metadata_bytes+? WHERE scope=?',[row.bytes,row.storedBytes,metadata,scope]);}onMetadataStored?.(addedMetadata,pending.size);if(!insideTransaction)db.database.exec('COMMIT');pending.clear();pendingBytes=0;}catch(cause){if(!insideTransaction)db.database.exec('ROLLBACK');throw cause;}};
  const lookup=(key:string)=>{const [table,id]=JSON.parse(key);return db.rows<any>('SELECT * FROM sensa_sync_admission_rows_v1 WHERE scope=? AND table_name=? AND record_key=?',[scope,table,id])[0];};
  const rows:AdmissionRows={
   get size(){return db.rows<{records:number}>('SELECT records FROM sensa_sync_admission_v1 WHERE scope=?',[scope])[0].records+pending.size;},
   has:key=>pending.has(key)||lookup(key)!==undefined,get:key=>{const queued=pending.get(key);if(queued)return queued;const row=lookup(key);return row?from(row):undefined;},
   set(key,row){
    if(key!==id(row.table,row.key))throw Error('library_sync_dependency_corrupt');
    const queued=pending.get(key),stored=queued?undefined:lookup(key),prior=queued??(stored?from(stored):undefined);if(prior){if(!backupEqual(prior,row))throw Error('library_sync_dependency_corrupt');return rows;}
    const metadata=new TextEncoder().encode(JSON.stringify(row)).length;if(metadata>16*1024*1024)throw Error('library_sync_capacity');
    if(pending.size&&(pending.size>=64||pendingBytes+metadata>1024*1024))flush(insidePage);
    pending.set(key,row);pendingBytes+=metadata;return rows;
   },
   clear(){pending.clear();pendingBytes=0;db.rows('DELETE FROM sensa_sync_admission_rows_v1 WHERE scope=?',[scope]);db.rows('UPDATE sensa_sync_admission_v1 SET records=0,logical_bytes=0,stored_bytes=0,metadata_bytes=0 WHERE scope=?',[scope]);},
   *values(){let table='',key='';for(;;){const page=db.rows<any>('SELECT * FROM sensa_sync_admission_rows_v1 WHERE scope=? AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64',[scope,table,key]);if(!page.length)return;for(const row of page)yield from(row);table=page.at(-1).table_name;key=page.at(-1).record_key;}},
   *[Symbol.iterator](){for(const row of rows.values())yield [id(row.table,row.key),row] as [string,SyncDependencyRow];},
  };
  const stats=this.rows<any>('SELECT * FROM sensa_sync_admission_v1 WHERE scope=?',[scope])[0];
  return {rows,scope,flush,retainedMetadataBytes:()=>this.rows<{metadata_bytes:number}>('SELECT metadata_bytes FROM sensa_sync_admission_v1 WHERE scope=?',[scope])[0].metadata_bytes,packageCacheComplete:true,logicalBytes:stats.logical_bytes,storedBytes:stats.stored_bytes,metadataBytes:stats.metadata_bytes};
 }
 admissionMeaningReceipts(scope:string,meaningId:string){return this.rows<{table:SqliteLibraryTable;key:string}>('SELECT table_name AS "table",record_key AS "key" FROM sensa_sync_admission_rows_v1 WHERE scope=? AND meaning_id=? LIMIT 16385',[scope,meaningId]);}
 discardAdmission(scope:string){this.ensure();this.rows('DELETE FROM sensa_sync_admission_v1 WHERE scope=?',[scope]);}
 observe(admission:SyncAdmission,table:SqliteLibraryTable,key:string,text:string,value:any,hasPackage:(key:string)=>boolean=()=>false,storedBytes?:number,computedDigest?:string):void{
  if(admission.disabled||admission.rows.has(id(table,key)))return;
  if(admission.rows.size>=(admission.scope?librarySyncRecordLimit:200000)){admission.disabled='dependency_capacity';admission.rows.clear();return;}
  const bytes=new TextEncoder().encode(text).length,edges:Array<[string,string]>=[],protocols:Array<[string,string]>=[];
  const edge=(kind:string,target:unknown)=>{if(typeof target==='string')edges.push([kind,target]);};
  if(table==='learningRuns'){
   for(const [target,participant]of Object.entries(value.participants??{}) as Array<[string,any]>)protocols.push([participant.protocolRunId,target]);
  }else if(table==='semanticReceipts')edge('meaningReceipt',value.result?.personalMeaningId);
  else if(table==='learningSessions')edge('sessionStart',JSON.stringify([value.startedByOperationId,value.startedAt]));
  if(table==='learningTargets'&&(value.curriculumMemberships??[]).some((membership:any)=>!!membership.packageKey&&!hasPackage(membership.packageKey)))admission.packageCacheComplete=false;
  if(computedDigest!==undefined&&!/^[a-f0-9]{64}$/u.test(computedDigest))throw Error('library_sync_dependency_corrupt');
  const row={table,key,digest:computedDigest??sha256(text),bytes,storedBytes:storedBytes??bytes,edges:[...new Map(edges.map(edge=>[JSON.stringify(edge),edge])).values()],protocols};
  admission.metadataBytes+=new TextEncoder().encode(JSON.stringify(row)).length;
  if(!admission.scope&&admission.metadataBytes>16*1024*1024){admission.disabled='dependency_metadata_capacity';admission.rows.clear();return;}
  admission.logicalBytes+=bytes;admission.storedBytes+=row.storedBytes;admission.rows.set(id(table,key),row);
  if(admission.scope&&admission.rows.size%64===0)admission.flush?.();
 }
 private put(row:SyncDependencyRow):void{
  this.rows('DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key]);
  if(row.table==='learningRuns')this.rows('DELETE FROM sensa_sync_protocol_owners_v1 WHERE run_key=?',[row.key]);
  this.rows('INSERT INTO sensa_sync_dependency_rows_v1 VALUES(?,?,?,?,?)',[row.table,row.key,row.digest,row.bytes,row.storedBytes]);
  if(row.edges.length)this.rows('INSERT INTO sensa_sync_dependency_edges_v1 SELECT ?,?,json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?)',[row.table,row.key,JSON.stringify(row.edges)]);
  if(row.protocols.length)this.rows('INSERT INTO sensa_sync_protocol_owners_v1 SELECT json_extract(value,\'$[0]\'),?,json_extract(value,\'$[1]\') FROM json_each(?)',[row.key,JSON.stringify(row.protocols)]);
 }
 /** Caller is inside the same source/base/cursor transaction. */
 certify(admission:SyncAdmission,state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number,previous?:SyncDependencyCertificate):void{
  this.ensure();if(!this.healthySchema||admission.disabled||!validatedCheckpoint(state))return;admission.flush?.(true);
  let logicalBytes=admission.logicalBytes,storedBytes=admission.storedBytes,records=admission.rows.size;
  if(previous){
   logicalBytes+=previous.logicalBytes;storedBytes+=previous.storedBytes;records=previous.records;
   for(const row of admission.rows.values()){const old=this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key])[0];if(old){logicalBytes-=old.logical_bytes;storedBytes-=old.stored_bytes;}else records++;}
   for(const row of admission.deletes??[]){const old=this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key])[0];if(old){logicalBytes-=old.logical_bytes;storedBytes-=old.stored_bytes;records--;this.rows('DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key]);}}
   // Remove all changed owners before adding any successor, so moving an ID
   // within the complete checked overlay is independent of insertion order.
   for(const row of admission.rows.values())if(row.table==='learningRuns')this.rows('DELETE FROM sensa_sync_protocol_owners_v1 WHERE run_key=?',[row.key]);
  }else{this.rows('DELETE FROM sensa_sync_protocol_owners_v1');this.rows('DELETE FROM sensa_sync_dependency_rows_v1');}
  if(admission.scope&&!previous){
   const scope=admission.scope,stats=this.rows<any>('SELECT * FROM sensa_sync_admission_v1 WHERE scope=?',[scope])[0];
   logicalBytes=stats.logical_bytes;storedBytes=stats.stored_bytes;records=stats.records;
   this.rows('INSERT INTO sensa_sync_dependency_rows_v1 SELECT table_name,record_key,digest,logical_bytes,stored_bytes FROM sensa_sync_admission_rows_v1 WHERE scope=?',[scope]);
   this.rows("INSERT INTO sensa_sync_dependency_edges_v1 SELECT row.table_name,row.record_key,json_extract(edge.value,'$[0]'),json_extract(edge.value,'$[1]') FROM sensa_sync_admission_rows_v1 row,json_each(row.edges_json) edge WHERE row.scope=?",[scope]);
   this.rows("INSERT INTO sensa_sync_protocol_owners_v1 SELECT json_extract(p.value,'$[0]'),row.record_key,json_extract(p.value,'$[1]') FROM sensa_sync_admission_rows_v1 row,json_each(row.protocols_json) p WHERE row.scope=?",[scope]);
  }else for(const row of admission.rows.values())this.put(row);
  if(logicalBytes>librarySyncLogicalByteLimit||storedBytes>librarySyncStoredByteLimit)return;
  const clock=this.clock(),certificate:SyncDependencyCertificate={generation:clock.generation,epoch:clock.epoch,version:2,validationVersion:libraryRestoreValidationVersion,owner:state.owner,incarnation:state.incarnation,libraryId:identity.id,learnerId:identity.learnerId,revision:state.revision,localRevision:state.syncedLocalRevision!,artifactRevision,records,logicalBytes,storedBytes,packageCacheComplete:previous?.packageCacheComplete??admission.packageCacheComplete};
  this.rows('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=? WHERE id=1',[JSON.stringify(certificate)]);
 }
}

export const syncAdmission=():SyncAdmission=>({rows:new Map(),packageCacheComplete:true,logicalBytes:0,storedBytes:0,metadataBytes:0});
export const dependencyRowId=id;
