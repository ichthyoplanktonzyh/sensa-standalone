/** Worker-private, rebuildable identity reservations, not semantic authority. */
import type {Database,PreparedStatement,SqlValue} from '@sqlite.org/sqlite-wasm';
import {decodeBackupValue} from './backupCodec';
import {unpackStoredRecord} from './sharedRecordContent';
import {ensureSqliteSchemaIndexes} from './sqliteSchemaIndexes';
import {sqliteRollbackFailure} from './sqliteConnectionFailure';
import type {SqliteMutation} from './sqliteProtocol';
import type {LibraryRecordReader} from './libraryRecordReader';
import {journeyIdentityTables,journeyReservedIdentities,type JourneyIdentityTable} from '../../experience/personalMeaningJourney/reservedIdentities';
import {isUuid} from '../../experience/personalMeaningJourney/ids';

const schema=`
CREATE TABLE IF NOT EXISTS sensa_journey_identity_records(id INTEGER PRIMARY KEY,table_name INTEGER NOT NULL,record_key TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sensa_journey_identity_record_key ON sensa_journey_identity_records(table_name,record_key);
CREATE TABLE IF NOT EXISTS sensa_journey_identities(record_id INTEGER NOT NULL,identity_id BLOB NOT NULL CHECK(typeof(identity_id)='blob' AND length(identity_id)=16),PRIMARY KEY(record_id,identity_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sensa_journey_identity_lookup ON sensa_journey_identities(identity_id);
CREATE TABLE IF NOT EXISTS sensa_journey_identity_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
`;
const version=5;
const tableCode=(table:string)=>journeyIdentityTables.indexOf(table as JourneyIdentityTable);
const tableNameSql=`CASE owner.table_name ${journeyIdentityTables.map((table,index)=>`WHEN ${index} THEN '${table}'`).join(' ')} END`;
const uuidBytes=(id:string)=>{const hex=id.replaceAll('-','');return Uint8Array.from({length:16},(_,index)=>Number.parseInt(hex.slice(index*2,index*2+2),16));};
const uuidString=(bytes:Uint8Array)=>{const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};
export class SqliteJourneyIdentityProjection{
 private invalid=false;
 private statements=new Map<string,PreparedStatement>();
 constructor(private database:Database,private decodedReader?:()=>LibraryRecordReader|undefined){}
 private sourceValue(table:JourneyIdentityTable,key:string,encoded:string):unknown{
  const reader=this.decodedReader?.();return reader?reader.get(table,key):decodeBackupValue(JSON.parse(unpackStoredRecord(encoded)));
 }
 private rows(sql:string,bind:unknown[]=[]):Record<string,any>[]{
  let statement=this.statements.get(sql);if(!statement){statement=this.database.prepare(sql);this.statements.set(sql,statement);}
  statement.reset(true);if(bind.length)statement.bind(bind as SqlValue[]);
  const rows:Record<string,any>[]=[];try{while(statement.step())rows.push(statement.get({}));return rows;}finally{statement.reset(true);}
 }
 close(){for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 initialize(){
  const complete=this.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('sensa_journey_identities','sensa_journey_identity_records','sensa_journey_identity_meta')").length===3;
  if(complete&&this.rows('SELECT version FROM sensa_journey_identity_meta WHERE id=1')[0]?.version===version){ensureSqliteSchemaIndexes(this.database,schema);return;}
  this.rows('DROP TABLE IF EXISTS sensa_journey_identities');this.rows('DROP TABLE IF EXISTS sensa_journey_identity_records');this.rows('DROP TABLE IF EXISTS sensa_journey_identity_meta');this.database.exec(schema);
  this.sourceRows((table,row)=>this.replace(table,row.record_key,row.value_json));
  this.rows('INSERT INTO sensa_journey_identity_meta VALUES(1,?)',[version]);this.invalid=false;
 }
 /** Caller holds the facts/projection transaction. */
 rebuild(){
  if(this.invalid)throw new Error('journey_identity_cache_invalid');
  this.rows('DELETE FROM sensa_journey_identities');this.rows('DELETE FROM sensa_journey_identity_records');
  this.sourceRows((table,row)=>this.replace(table,row.record_key,row.value_json));
 }
 private sourceRows(consume:(table:JourneyIdentityTable,row:Record<string,any>)=>void){
  for(const table of journeyIdentityTables){
   let after='';
   for(;;){
    const rows=this.rows('SELECT record_key,value_json FROM sensa_records WHERE table_name=? AND record_key>? ORDER BY record_key LIMIT 16',[table,after]);
    for(const row of rows)consume(table,row);
    if(rows.length<16)break;after=rows.at(-1)!.record_key;
   }
  }
 }
 /** Explicit diagnostics only. Ordinary opening/lookup never enumerates facts.
  * Logical drift is repaired from source rows without altering learner data. */
 checkAndRepair():{status:'ok'|'rebuilt';checkedAt:string;durationMs:number;recordsChecked:number}{
  const started=performance.now();let recordsChecked=0,stale=this.rows('SELECT version FROM sensa_journey_identity_meta WHERE id=1')[0]?.version!==version;
  this.sourceRows((table,row)=>{
   recordsChecked++;
   const expected=journeyReservedIdentities(table,this.sourceValue(table,row.record_key,row.value_json)).sort();
   const actual=this.rows('SELECT identity.identity_id FROM sensa_journey_identities AS identity JOIN sensa_journey_identity_records AS owner ON owner.id=identity.record_id WHERE owner.table_name=? AND owner.record_key=? ORDER BY identity.identity_id',[tableCode(table),row.record_key]).map(row=>uuidString(row.identity_id));
   if(expected.length!==actual.length||expected.some((id,index)=>id!==actual[index]))stale=true;
  });
  if(this.rows(`SELECT 1 FROM sensa_journey_identity_records AS owner LEFT JOIN sensa_records AS source ON source.table_name=${tableNameSql} AND source.record_key=owner.record_key WHERE source.record_key IS NULL LIMIT 1`).length
   ||this.rows('SELECT 1 FROM sensa_journey_identities AS identity LEFT JOIN sensa_journey_identity_records AS owner ON owner.id=identity.record_id WHERE owner.id IS NULL LIMIT 1').length)stale=true;
  if(stale){
   this.invalid=true;
   // Quarantine is a separate durable commit. A failed/crashed repair must
   // not roll back its invalid marker and make reconnect trust a stale cache.
   // If the marker itself cannot be stored, surface that storage error and
   // keep this connection invalid; do not attempt a repair without it.
   this.rows('INSERT INTO sensa_journey_identity_meta VALUES(1,0) ON CONFLICT(id) DO UPDATE SET version=0');
   try{
    this.database.exec('BEGIN IMMEDIATE');
    this.rows('DELETE FROM sensa_journey_identities');
    this.rows('DELETE FROM sensa_journey_identity_records');
    this.sourceRows((table,row)=>this.replace(table,row.record_key,row.value_json));
    this.rows('INSERT INTO sensa_journey_identity_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version',[version]);this.database.exec('COMMIT');this.invalid=false;
   }catch(cause){
    try{this.database.exec('ROLLBACK');}catch(rollbackCause){throw sqliteRollbackFailure(cause,rollbackCause);}
    throw cause;
   }
  }
  this.invalid=false;
  return {status:stale?'rebuilt':'ok',checkedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started),recordsChecked};
 }
 private replace(table:JourneyIdentityTable,key:string,encoded:string){
  const recordId=this.rows('INSERT INTO sensa_journey_identity_records(table_name,record_key) VALUES(?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET record_key=excluded.record_key RETURNING id',[tableCode(table),key])[0]!.id;
  this.rows('DELETE FROM sensa_journey_identities WHERE record_id=?',[recordId]);
  const ids=journeyReservedIdentities(table,this.sourceValue(table,key,encoded));
  if(ids.length)this.rows('INSERT INTO sensa_journey_identities SELECT ?,unhex(value) FROM json_each(?)',[recordId,JSON.stringify(ids.map(id=>id.replaceAll('-','')))]);
 }
 update(mutation:SqliteMutation){
  const relevant=(table:string)=>journeyIdentityTables.includes(table as JourneyIdentityTable);
  if(!mutation.clears.some(relevant)&&!mutation.deletes.some(row=>relevant(row.table))&&!mutation.puts.some(row=>relevant(row.table)))return;
  if(this.invalid)throw new Error('journey_identity_cache_invalid');
  for(const table of mutation.clears)if(relevant(table)){this.rows('DELETE FROM sensa_journey_identities WHERE record_id IN (SELECT id FROM sensa_journey_identity_records WHERE table_name=?)',[tableCode(table)]);this.rows('DELETE FROM sensa_journey_identity_records WHERE table_name=?',[tableCode(table)]);}
  for(const row of mutation.deletes)if(relevant(row.table)){this.rows('DELETE FROM sensa_journey_identities WHERE record_id IN (SELECT id FROM sensa_journey_identity_records WHERE table_name=? AND record_key=?)',[tableCode(row.table),row.key]);this.rows('DELETE FROM sensa_journey_identity_records WHERE table_name=? AND record_key=?',[tableCode(row.table),row.key]);}
  for(const row of mutation.puts)if(journeyIdentityTables.includes(row.table as JourneyIdentityTable))this.replace(row.table as JourneyIdentityTable,row.key,row.encodedValue);
 }
 existing(raw:readonly string[]):string[]{
  if(this.invalid)throw new Error('journey_identity_cache_invalid');
  if(raw.length>256||raw.some(id=>!isUuid(id)))throw new Error('journey_identity_query_invalid');
  if(!raw.length)return [];
  return this.rows(`SELECT DISTINCT identity_id FROM sensa_journey_identities WHERE identity_id IN (${raw.map(()=>'?').join(',')}) ORDER BY identity_id`,raw.map(uuidBytes)).map(row=>uuidString(row.identity_id));
 }
}
