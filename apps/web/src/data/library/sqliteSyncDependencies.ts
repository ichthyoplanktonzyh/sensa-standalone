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
 rowBudget(table:SqliteLibraryTable,key:string){return this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[table,key])[0]??{logical_bytes:0,stored_bytes:0};}
 /** Private capture/candidate observation. Only one key page enters JavaScript. */
 spoolAdmission(scope:string,insidePage=false,onMetadataStored?:(bytes:number)=>void):SyncAdmission{
  this.ensure();this.rows('INSERT INTO sensa_sync_admission_v1(scope) VALUES(?) ON CONFLICT DO NOTHING',[scope]);
  const db=this,pending=new Map<string,SyncDependencyRow>();let pendingBytes=0;
  const from=(row:any):SyncDependencyRow=>({table:row.table_name,key:row.record_key,digest:row.digest,bytes:row.logical_bytes,storedBytes:row.stored_bytes,edges:JSON.parse(row.edges_json),protocols:JSON.parse(row.protocols_json)});
  const flush=(insideTransaction=false)=>{if(!pending.size)return;if(!insideTransaction)db.database.exec('BEGIN IMMEDIATE');try{let addedMetadata=0;for(const row of pending.values()){const metadata=new TextEncoder().encode(scope+row.table+row.key+row.digest+JSON.stringify(row.edges)+JSON.stringify(row.protocols)).length;addedMetadata+=metadata;db.rows('INSERT INTO sensa_sync_admission_rows_v1(scope,table_name,record_key,digest,logical_bytes,stored_bytes,edges_json,protocols_json,metadata_bytes) VALUES(?,?,?,?,?,?,?,?,?)',[scope,row.table,row.key,row.digest,row.bytes,row.storedBytes,JSON.stringify(row.edges),JSON.stringify(row.protocols),metadata]);db.rows('UPDATE sensa_sync_admission_v1 SET records=records+1,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+?,metadata_bytes=metadata_bytes+? WHERE scope=?',[row.bytes,row.storedBytes,metadata,scope]);}onMetadataStored?.(addedMetadata);if(!insideTransaction)db.database.exec('COMMIT');pending.clear();pendingBytes=0;}catch(cause){if(!insideTransaction)db.database.exec('ROLLBACK');throw cause;}};
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
