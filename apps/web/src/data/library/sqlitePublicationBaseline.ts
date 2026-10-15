import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {sqliteSyncBaseSchema} from './sqliteProtocol';
import {SqliteSyncDependencies,type SyncAdmission} from './sqliteSyncDependencies';

type Clock={generation:number;epoch:number};
type Position={table:string;key:string}|null;
type Source={epoch:number;records:number;started:boolean;preparedRecords:number;after:Position};
type Prepared={id:string;sourceEpoch:number;shadowEpoch:number;records:number;schema:number;clock:Clock};
const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

/** One frozen publication transfers exact bytes into the canonical baseline
 * layout in bounded transactions. Selection remains the caller's atomic commit. */
export class SqlitePublicationBaseline{
 private prepared:Prepared|undefined;
 private statements=new Map<string,PreparedStatement>();
 constructor(private readonly db:Database,private readonly dependencies:SqliteSyncDependencies,private readonly source:(id:string,ownedChanges?:number)=>Source,private readonly capacity:()=>void,private readonly transferred:(epoch:number)=>void){}
 private rows<T>(sql:string,bind:(string|number)[]=[]):T[]{
  let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}statement.reset(true);if(bind.length)statement.bind(bind);
  const result:T[]=[];try{while(statement.step())result.push(statement.get({}) as T);return result;}finally{statement.reset(true);}
 }
 close(){for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 private schema(){return Number(this.db.selectValue('PRAGMA schema_version'));}
 private shadowEpoch(){return this.rows<{epoch:number}>('SELECT epoch FROM temp.sensa_publication_baseline_epoch')[0].epoch;}
 private tables(){
  this.db.exec(sqliteSyncBaseSchema.replace('sensa_sync_base','sensa_initial_publication_baseline'));
  this.db.exec('CREATE TEMP TABLE IF NOT EXISTS sensa_publication_baseline_epoch(epoch INTEGER NOT NULL);INSERT INTO temp.sensa_publication_baseline_epoch SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM temp.sensa_publication_baseline_epoch)');
  for(const action of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS sensa_publication_baseline_${action.toLowerCase()} AFTER ${action} ON main.sensa_initial_publication_baseline BEGIN UPDATE sensa_publication_baseline_epoch SET epoch=epoch+1;END`);
 }
 async prepare(id:string,admission:SyncAdmission,onPage:(records:number)=>void):Promise<void>{
  let source=this.source(id);if(this.prepared?.id===id){this.assert(id);return;}
  if(!admission.scope||admission.disabled)throw Error('library_sync_candidate_invalid');
  this.prepared=undefined;this.tables();let expected=this.dependencies.clock(),shadowEpoch=this.shadowEpoch(),schema=this.schema();
  const alive=(ownedChanges=0)=>{const current=this.source(id,ownedChanges);if(current.epoch!==source.epoch+ownedChanges||current.records!==source.records)throw Error('library_sync_candidate_invalid');this.capacity();return current;};
  const check=()=>{alive();const clock=this.dependencies.clock();if(clock.generation!==expected.generation||clock.epoch!==expected.epoch||this.shadowEpoch()!==shadowEpoch||this.schema()!==schema)throw Error('library_sync_local_changed');};
  const batch=(work:()=>{shadow:number;source:number})=>{check();this.db.exec('BEGIN IMMEDIATE');try{check();const changes=work();if(this.shadowEpoch()!==shadowEpoch+changes.shadow||this.schema()!==schema)throw Error('library_sync_candidate_invalid');const current=alive(changes.source);this.db.exec('COMMIT');shadowEpoch+=changes.shadow;source=current;this.transferred(current.epoch);}catch(cause){this.db.exec('ROLLBACK');throw cause;}};
  // Resume the same frozen source after cancellation or reopen. Transferred
  // body/ref bytes must remain readable; only unrelated orphan rows may clear.
  if(!source.started){
   for(;;){check();const keys=this.rows<{rowid:number}>('SELECT rowid FROM sensa_initial_publication_baseline LIMIT 128');if(!keys.length)break;batch(()=>{this.rows('DELETE FROM sensa_initial_publication_baseline WHERE rowid IN(SELECT value FROM json_each(?))',[JSON.stringify(keys.map(row=>row.rowid))]);if(this.db.changes()!==keys.length)throw Error('library_sync_candidate_invalid');return {shadow:keys.length,source:0};});await wait();}
   batch(()=>{this.rows('UPDATE sensa_initial_publication SET baseline_started=1 WHERE id=?',[id]);return {shadow:0,source:0};});
  }
  check();if(this.rows<{n:number}>('SELECT count(*) AS n FROM sensa_initial_publication_baseline')[0].n!==source.preparedRecords)throw Error('library_sync_candidate_invalid');
  if(this.rows("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sensa_initial_publication_retired_base'").length){
   for(;;){check();const keys=this.rows<{rowid:number}>('SELECT rowid FROM sensa_initial_publication_retired_base LIMIT 128');if(!keys.length)break;batch(()=>{this.rows('DELETE FROM sensa_initial_publication_retired_base WHERE rowid IN(SELECT value FROM json_each(?))',[JSON.stringify(keys.map(row=>row.rowid))]);return {shadow:0,source:0};});await wait();}
   check();this.db.exec('DROP TABLE sensa_initial_publication_retired_base');schema=this.schema();
  }
  let table=source.after?.table??'',key=source.after?.key??'',records=source.preparedRecords;
  for(;;){check();const page=this.rows<{table_name:string;record_key:string;bytes:number;shared:number}>('SELECT table_name,record_key,shared,length(CAST(value_json AS BLOB))+length(CAST(refs_json AS BLOB)) AS bytes FROM sensa_initial_publication_rows WHERE id=? AND(table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64',[id,table,key]);if(!page.length)break;
   const selected:typeof page=[];let bytes=0;for(const row of page){if(row.shared!==0&&row.shared!==1||row.bytes===0)throw Error('library_sync_candidate_invalid');if(selected.length&&bytes+row.bytes>1024*1024)break;selected.push(row);bytes+=row.bytes;}
   const identities=JSON.stringify(selected.map(row=>[row.table_name,row.record_key])),last=selected.at(-1)!;
   batch(()=>{
    const filter="id=? AND(table_name,record_key) IN(SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))";
    this.rows('INSERT INTO sensa_initial_publication_baseline SELECT table_name,record_key,value_json,refs_json FROM sensa_initial_publication_rows WHERE '+filter,[id,identities]);if(this.db.changes()!==selected.length)throw Error('library_sync_candidate_invalid');
    this.rows('INSERT INTO sensa_initial_publication_shared SELECT id,table_name,record_key FROM sensa_initial_publication_rows WHERE shared=1 AND '+filter,[id,identities]);const shared=this.db.changes();if(shared!==selected.filter(row=>row.shared===1).length)throw Error('library_sync_candidate_invalid');
    this.rows('DELETE FROM sensa_initial_publication_rows WHERE '+filter,[id,identities]);if(this.db.changes()!==selected.length)throw Error('library_sync_candidate_invalid');
    this.rows('UPDATE sensa_initial_publication SET authorized_epoch=source_epoch,baseline_records=baseline_records+?,baseline_after=? WHERE id=? AND source_epoch=authorized_epoch+?',[selected.length,JSON.stringify({table:last.table_name,key:last.record_key}),id,selected.length*2+shared]);if(this.db.changes()!==1)throw Error('library_sync_candidate_invalid');
    return {shadow:selected.length,source:selected.length*2+shared};
   });
   records+=selected.length;table=last.table_name;key=last.record_key;onPage(records);await wait();
  }
  check();if(records!==source.records||admission.rows.size!==records)throw Error('library_sync_candidate_invalid');
  // Optional reverse relations are unavailable while the certificate is null.
  // Actual base edits still advance generation; every index DML advances epoch.
  const initialGeneration=expected.generation;
  const clock=await this.dependencies.preparePublication(admission.scope,()=>{alive();if(this.schema()!==schema||this.shadowEpoch()!==shadowEpoch||this.dependencies.clock().generation!==initialGeneration)throw Error('library_sync_local_changed');},completed=>onPage(records+completed));
  expected={...expected,...clock};check();this.prepared={id,sourceEpoch:source.epoch,shadowEpoch,records,schema,clock};
 }
 assert(id:string):Prepared{
  const prepared=this.prepared;if(!prepared||prepared.id!==id)throw Error('library_sync_candidate_invalid');const source=this.source(id),clock=this.dependencies.clock();
  if(source.epoch!==prepared.sourceEpoch||source.records!==prepared.records||this.shadowEpoch()!==prepared.shadowEpoch||this.schema()!==prepared.schema)throw Error('library_sync_candidate_invalid');
  if(clock.generation!==prepared.clock.generation||clock.epoch!==prepared.clock.epoch)throw Error('library_sync_local_changed');return prepared;
 }
 activate(id:string):void{
  this.assert(id);for(const action of ['insert','update','delete']){this.db.exec(`DROP TRIGGER temp.sensa_publication_baseline_${action}`);this.db.exec(`DROP TRIGGER sensa_publication_baseline_source_${action}`);}this.dependencies.replacePreparedBaseline();
 }
 certificateClock(id:string):Clock{const prepared=this.prepared;if(!prepared||prepared.id!==id)throw Error('library_sync_candidate_invalid');return prepared.clock;}
}
