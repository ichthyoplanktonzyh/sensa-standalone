import type {Database} from '@sqlite.org/sqlite-wasm';
import {sha256} from '@sensa/learning-kernel';
import {z} from 'zod';
import {backupEqual} from './backupCodec';
import {validatedCheckpoint} from './cloudSyncCheckpoint';
import {libraryRestoreValidationVersion} from './replication/libraryReplicaValidation';
import type {CloudSyncState} from './cloudSync';
import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable} from './sqliteProtocol';
import type {ReplicaCandidateFence} from './replicaCandidateProtocol';

export type SyncDependencyRow={table:SqliteLibraryTable;key:string;digest:string;bytes:number;storedBytes:number;edges:Array<[string,string]>;protocols:Array<[string,string]>};
export type SyncAdmission={rows:Map<string,SyncDependencyRow>;packageCacheComplete:boolean;logicalBytes:number;storedBytes:number;metadataBytes:number;deletes?:Array<{table:SqliteLibraryTable;key:string}>;disabled?:string};
export type SyncDependencyCertificate={generation:number;epoch:number;version:1;validationVersion:number;owner:ReplicaCandidateFence['owner'];incarnation:string;libraryId:string;learnerId:string;revision:number;localRevision:number;artifactRevision:number;records:number;logicalBytes:number;storedBytes:number;packageCacheComplete:boolean};
const id=(table:string,key:string)=>JSON.stringify([table,key]);
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),uuid=z.string().uuid();
const certificateSchema=z.object({generation:counter,epoch:counter,version:z.literal(1),validationVersion:z.literal(libraryRestoreValidationVersion),owner:z.object({subject:uuid,accountId:uuid}).strict(),incarnation:z.string().min(1).max(128),libraryId:uuid,learnerId:uuid,revision:counter,localRevision:counter,artifactRevision:counter,records:z.number().int().min(1).max(200000),logicalBytes:counter.max(512*1024*1024),storedBytes:counter.max(256*1024*1024),packageCacheComplete:z.boolean()}).strict();
const schema=`
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_state_v1(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL DEFAULT 0,epoch INTEGER NOT NULL DEFAULT 0,certificate_json TEXT);
INSERT OR IGNORE INTO sensa_sync_dependency_state_v1(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_rows_v1(table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,logical_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,PRIMARY KEY(table_name,record_key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sensa_sync_dependency_edges_v1(table_name TEXT NOT NULL,record_key TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(table_name,record_key,kind,target),FOREIGN KEY(table_name,record_key) REFERENCES sensa_sync_dependency_rows_v1(table_name,record_key) ON DELETE CASCADE) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_sync_dependency_reverse_v1 ON sensa_sync_dependency_edges_v1(kind,target,table_name,record_key);
CREATE TABLE IF NOT EXISTS sensa_sync_protocol_owners_v1(protocol_id TEXT PRIMARY KEY,run_key TEXT NOT NULL,target_key TEXT NOT NULL) WITHOUT ROWID;
`;
const triggers=[...['INSERT','UPDATE','DELETE'].flatMap(action=>[
 {name:`sensa_sync_base_generation_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_base_generation_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_base BEGIN UPDATE sensa_sync_dependency_state_v1 SET generation=generation+1,certificate_json=NULL WHERE id=1; END;`},
 ...['rows','edges'].map(table=>({name:`sensa_sync_dependency_${table}_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_dependency_${table}_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_dependency_${table}_v1 BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;`})),
 {name:`sensa_sync_protocol_${action.toLowerCase()}_v1`,sql:`CREATE TRIGGER IF NOT EXISTS sensa_sync_protocol_${action.toLowerCase()}_v1 AFTER ${action} ON sensa_sync_protocol_owners_v1 BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;`},
]),{name:'sensa_sync_shared_update_v1',sql:'CREATE TRIGGER IF NOT EXISTS sensa_sync_shared_update_v1 AFTER UPDATE ON sensa_shared_record_content BEGIN UPDATE sensa_sync_dependency_state_v1 SET epoch=epoch+1,certificate_json=NULL WHERE id=1; END;'}];
const normalized=(sql:string)=>sql.replace(/\bIF NOT EXISTS\s*/gu,'').replace(/\s+/gu,' ').replace(/;$/u,'').trim();

/** Baseline-only reverse relations. SQL mutation invalidates the certificate;
 * only a complete admission or its checked sparse successor can renew it. */
export class SqliteSyncDependencies{
 private ready=false;
 private healthySchema=true;
 private schemaCookie=-1;
 constructor(private readonly database:Database){}
 resetSchema():void{this.ready=false;this.healthySchema=true;}
 private rows<T>(sql:string,bind:readonly (string|number)[]=[]):T[]{return this.database.exec({sql,bind:[...bind],rowMode:'object',returnValue:'resultRows'}) as T[];}
 ensure():void{
  const cookie=Number(this.rows<{v:number}>('SELECT schema_version AS v FROM pragma_schema_version')[0].v);
  if(this.ready&&cookie===this.schemaCookie)return;
  const prior=this.rows<{name:string;sql:string}>("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'sensa_sync_%_v1'");
  this.database.exec(schema);for(const trigger of triggers)this.database.exec(trigger.sql);
  const definitions=[...triggers,...schema.split(';').filter(sql=>sql.trim().startsWith('CREATE')).map(sql=>({sql:sql.trim(),name:sql.match(/(?:TABLE|INDEX) IF NOT EXISTS (\w+)/u)![1]!}))];
  this.healthySchema=!prior.some(row=>definitions.some(definition=>definition.name===row.name&&normalized(definition.sql)!==normalized(row.sql)));
  if(!this.healthySchema||prior.length&&definitions.some(definition=>!prior.some(row=>row.name===definition.name)))this.database.exec('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');
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
 clear():void{this.ensure();this.database.exec('DELETE FROM sensa_sync_protocol_owners_v1');this.database.exec('DELETE FROM sensa_sync_dependency_rows_v1');this.database.exec('UPDATE sensa_sync_dependency_state_v1 SET certificate_json=NULL WHERE id=1');}
 rowBudget(table:SqliteLibraryTable,key:string){return this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[table,key])[0]??{logical_bytes:0,stored_bytes:0};}
 observe(admission:SyncAdmission,table:SqliteLibraryTable,key:string,text:string,value:any,hasPackage:(key:string)=>boolean=()=>false,storedBytes?:number,computedDigest?:string):void{
  if(admission.disabled||admission.rows.has(id(table,key)))return;
  if(admission.rows.size>=200000){admission.disabled='dependency_capacity';admission.rows.clear();return;}
  const bytes=new TextEncoder().encode(text).length,edges:Array<[string,string]>=[],protocols:Array<[string,string]>=[];
  const edge=(kind:string,target:unknown)=>{if(typeof target==='string')edges.push([kind,target]);};
  if(table==='learningRuns'){
   for(const target of value.targetIds??[])edge('runTarget',target);
   edge('runSession',value.learningSessionId);edge('runScope',value.studyScopeRevisionId);
   edge('runPredecessor',value.continuedFromRunId);
   for(const event of value.lifecycleEvents??[]){edge('runSession',event.learningSessionId);edge('runPredecessor',event.continuedFromRunId);}
   for(const [target,participant]of Object.entries(value.participants??{}) as Array<[string,any]>)protocols.push([participant.protocolRunId,target]);
  }else if(table==='learningEvents')edge('eventRun',value.runId);
  else if(table==='learningReconciliations')edge('decisionTarget',value.targetId);
  else if(table==='learningSessions'){
   for(const run of value.runIds??[])edge('sessionRun',run);edge('sessionScope',value.scopeRevisionId);
   edge('sessionStart',JSON.stringify([value.startedByOperationId,value.startedAt]));
  }else if(table==='studyScopes')for(const member of value.members??[])edge('scopeTarget',member.targetId);
  if(table==='learningTargets'&&(value.curriculumMemberships??[]).some((membership:any)=>!!membership.packageKey&&!hasPackage(membership.packageKey)))admission.packageCacheComplete=false;
  if(computedDigest!==undefined&&!/^[a-f0-9]{64}$/u.test(computedDigest))throw Error('library_sync_dependency_corrupt');
  const row={table,key,digest:computedDigest??sha256(text),bytes,storedBytes:storedBytes??bytes,edges:[...new Map(edges.map(edge=>[JSON.stringify(edge),edge])).values()],protocols};
  admission.metadataBytes+=new TextEncoder().encode(JSON.stringify(row)).length;
  if(admission.metadataBytes>16*1024*1024){admission.disabled='dependency_metadata_capacity';admission.rows.clear();return;}
  admission.logicalBytes+=bytes;admission.storedBytes+=row.storedBytes;admission.rows.set(id(table,key),row);
 }
 private put(row:SyncDependencyRow):void{
  this.database.exec({sql:'DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:[row.table,row.key]});
  if(row.table==='learningRuns')this.database.exec({sql:'DELETE FROM sensa_sync_protocol_owners_v1 WHERE run_key=?',bind:[row.key]});
  this.database.exec({sql:'INSERT INTO sensa_sync_dependency_rows_v1 VALUES(?,?,?,?,?)',bind:[row.table,row.key,row.digest,row.bytes,row.storedBytes]});
  if(row.edges.length)this.database.exec({sql:'INSERT INTO sensa_sync_dependency_edges_v1 SELECT ?,?,json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?)',bind:[row.table,row.key,JSON.stringify(row.edges)]});
  if(row.protocols.length)this.database.exec({sql:'INSERT INTO sensa_sync_protocol_owners_v1 SELECT json_extract(value,\'$[0]\'),?,json_extract(value,\'$[1]\') FROM json_each(?)',bind:[row.key,JSON.stringify(row.protocols)]});
 }
 /** Caller is inside the same source/base/cursor transaction. */
 certify(admission:SyncAdmission,state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number,previous?:SyncDependencyCertificate):void{
  this.ensure();if(!this.healthySchema||admission.disabled||!validatedCheckpoint(state))return;
  let logicalBytes=admission.logicalBytes,storedBytes=admission.storedBytes,records=admission.rows.size;
  if(previous){
   logicalBytes+=previous.logicalBytes;storedBytes+=previous.storedBytes;records=previous.records;
   for(const row of admission.rows.values()){const old=this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key])[0];if(old){logicalBytes-=old.logical_bytes;storedBytes-=old.stored_bytes;}else records++;}
   for(const row of admission.deletes??[]){const old=this.rows<{logical_bytes:number;stored_bytes:number}>('SELECT logical_bytes,stored_bytes FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',[row.table,row.key])[0];if(old){logicalBytes-=old.logical_bytes;storedBytes-=old.stored_bytes;records--;this.database.exec({sql:'DELETE FROM sensa_sync_dependency_rows_v1 WHERE table_name=? AND record_key=?',bind:[row.table,row.key]});}}
   // Remove all changed owners before adding any successor, so moving an ID
   // within the complete checked overlay is independent of insertion order.
   for(const row of admission.rows.values())if(row.table==='learningRuns')this.database.exec({sql:'DELETE FROM sensa_sync_protocol_owners_v1 WHERE run_key=?',bind:[row.key]});
  }else{this.database.exec('DELETE FROM sensa_sync_protocol_owners_v1');this.database.exec('DELETE FROM sensa_sync_dependency_rows_v1');}
  for(const row of admission.rows.values())this.put(row);
  if(logicalBytes>512*1024*1024||storedBytes>256*1024*1024)return;
  const clock=this.clock(),certificate:SyncDependencyCertificate={generation:clock.generation,epoch:clock.epoch,version:1,validationVersion:libraryRestoreValidationVersion,owner:state.owner,incarnation:state.incarnation,libraryId:identity.id,learnerId:identity.learnerId,revision:state.revision,localRevision:state.syncedLocalRevision!,artifactRevision,records,logicalBytes,storedBytes,packageCacheComplete:previous?.packageCacheComplete??admission.packageCacheComplete};
  this.database.exec({sql:'UPDATE sensa_sync_dependency_state_v1 SET certificate_json=? WHERE id=1',bind:[JSON.stringify(certificate)]});
 }
}

export const syncAdmission=():SyncAdmission=>({rows:new Map(),packageCacheComplete:true,logicalBytes:0,storedBytes:0,metadataBytes:0});
export const dependencyRowId=id;
