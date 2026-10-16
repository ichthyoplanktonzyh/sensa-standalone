import {createHash} from 'node:crypto';
import {librarySyncNativeDescriptorText,type LibrarySyncNativeSnapshot,type LibrarySyncPreparation} from '@sensa/contracts/sensa';
import type {DatabaseExecutor} from '../../database/core.js';
import {ConsumerError} from '../access/auth.js';
import {readLibrarySnapshotPage,readLibraryTailPage} from './pages.js';
import {libraryCloudCleanupRows,libraryCloudCleanupPins,requirePrivateLibraryGeneration} from './generation.js';
import {libraryCloudReadLeaseMs,libraryCloudUploadLeaseMs} from './retention.js';

type Head=Record<string,any>;
type Input={baseRevision:number;operationId?:string;page?:number;nativeSnapshot?:LibrarySyncNativeSnapshot};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const sameNative=(a:LibrarySyncNativeSnapshot|undefined,b:LibrarySyncNativeSnapshot|undefined)=>a&&b?a.manifestHash===b.manifestHash&&librarySyncNativeDescriptorText(a)===librarySyncNativeDescriptorText(b):!a&&!b;
const conflict=(code='library_sync_conflict'):never=>{throw new ConsumerError(409,code);};
const progress=(stage:Head):LibrarySyncPreparation=>({operationId:stage.operation_id,revision:stage.descriptor.baseRevision,page:stage.pages,phase:stage.checkpoint_state.phase});
const sourceMatches=(head:Head,d:Head)=>head.library_id===d.libraryId&&head.learner_id===d.learnerId&&head.rows_generation===d.rowsGeneration&&head.snapshot_generation===d.snapshotGeneration&&head.snapshot_revision===d.snapshotRevision&&head.retention_floor===d.floor&&head.revision>=d.baseRevision;
const active=async(db:DatabaseExecutor,id:string)=>(await db.query("SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND purpose='checkpoint' AND NOT retiring AND published_revision IS NULL FOR UPDATE",[id])).rows[0];
const lease=async(db:DatabaseExecutor,id:string,stage:Head,now:Date)=>(await db.query('SELECT 1 FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND id=$2 AND expires_at>$3 AND snapshot_generation=$4 AND snapshot_revision=$5 AND to_revision=$6 AND from_revision=$7',[id,stage.checkpoint_state.readLease,now,stage.descriptor.snapshotGeneration,stage.descriptor.snapshotRevision,stage.descriptor.baseRevision,stage.descriptor.floor])).rowCount;
// Reuse the initial-publication workspace bound. Published witnesses never
// consume a private slot; interrupted work must finish bounded retirement
// before another source can add a fifth private generation.
const privateCapacity=async(db:DatabaseExecutor,id:string)=>(await db.query(`SELECT 1 FROM sensa_consumer.library_cloud_staging s WHERE s.account_id=$1 AND s.published_revision IS NULL
 AND NOT EXISTS(SELECT 1 FROM sensa_consumer.library_cloud_commits c WHERE c.account_id=s.account_id AND c.operation_id=s.operation_id AND c.result IS NOT NULL) LIMIT 4`,[id])).rows.length<4;

/** Finds existing work, or captures a fixed source without copying any rows.
 * Callers hold the existing account lock. Expired work remains private and uses
 * the existing bounded generation retirement path, never an empty checkpoint. */
export async function ensureLibraryCheckpoint(db:DatabaseExecutor,id:string,head:Head,now:Date,due=false):Promise<LibrarySyncPreparation|undefined>{
 if(!head.library_id)return;
 let stage:Head|undefined=await active(db,id);
 if(stage&&(!sourceMatches(head,stage.descriptor)||new Date(stage.expires_at)<=now||!await lease(db,id,stage,now))){
  await db.query('UPDATE sensa_consumer.library_cloud_staging SET retiring=true,expires_at=LEAST(expires_at,$3) WHERE account_id=$1 AND operation_id=$2',[id,stage.operation_id,now]);stage=undefined;
 }
 if(stage)return progress(stage);
 if(!due||head.snapshot_revision===head.revision||!await privateCapacity(db,id))return;
 return progress(await begin(db,id,head,now,{}));
}

async function begin(db:DatabaseExecutor,id:string,head:Head,now:Date,input:{operationId?:string;nativeSnapshot?:LibrarySyncNativeSnapshot}){
 const operationId=input.operationId??crypto.randomUUID();requirePrivateLibraryGeneration(operationId);
 if((await db.query('SELECT 1 FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[id,operationId])).rowCount)conflict('operation_conflict');
 const descriptor={operationId,baseRevision:head.revision,libraryId:head.library_id,learnerId:head.learner_id,records:head.record_count,rowsGeneration:head.rows_generation,snapshotGeneration:head.snapshot_generation,snapshotRevision:head.snapshot_revision,floor:head.retention_floor,tailBytes:Number(head.tail_bytes),tailCommits:head.tail_commits,...(input.nativeSnapshot?{nativeSnapshot:input.nativeSnapshot}:{})};
 const state={phase:head.snapshot_revision===head.revision?'native':'snapshot',after:null,position:{revision:head.snapshot_revision,offset:0},readLease:crypto.randomUUID(),nativeOffset:0,records:head.snapshot_revision===head.revision?head.record_count:0};
 const records=head.record_count;
 await db.query('INSERT INTO sensa_consumer.library_cloud_reads(account_id,id,from_revision,to_revision,snapshot_revision,expires_at,snapshot_generation) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,state.readLease,head.retention_floor,head.revision,head.snapshot_revision,new Date(now.getTime()+libraryCloudReadLeaseMs),head.snapshot_generation]);
 return (await db.query(`INSERT INTO sensa_consumer.library_cloud_staging(account_id,operation_id,request_digest,descriptor,digest,expires_at,logical_bytes,prepared_version,purpose,checkpoint_state,records,prepared_records)
  VALUES($1,$2,$3,$4::jsonb,$3,$5,0,1,'checkpoint',$6::jsonb,$7,0) RETURNING *`,[id,operationId,hash(JSON.stringify({baseRevision:head.revision,nativeSnapshot:input.nativeSnapshot??null})),JSON.stringify(descriptor),new Date(now.getTime()+libraryCloudUploadLeaseMs),JSON.stringify(state),records])).rows[0]!;
}

/** Advances one persisted page, or selects a sealed checkpoint in a short CAS.
 * Rows come only from the leased server snapshot/tail. Page replays never redo
 * work or renew leases; current facts and the H→N tail are not rewritten. */
export async function advanceLibraryCheckpoint(db:DatabaseExecutor,id:string,head:Head,input:Input,now:Date,describe:(head:Head)=>Head):Promise<Head>{
 if(!head.library_id)conflict('library_sync_identity');
 let stage:Head|undefined;
 if(input.operationId){
  requirePrivateLibraryGeneration(input.operationId);
  const receipt=(await db.query('SELECT request_digest,result FROM sensa_consumer.library_cloud_commits WHERE account_id=$1 AND operation_id=$2',[id,input.operationId])).rows[0];
  stage=(await db.query('SELECT * FROM sensa_consumer.library_cloud_staging WHERE account_id=$1 AND operation_id=$2 FOR UPDATE',[id,input.operationId])).rows[0];
  if(!stage||stage.purpose!=='checkpoint'||stage.descriptor.baseRevision!==input.baseRevision)conflict('operation_conflict');
  if(input.nativeSnapshot&&!sameNative(input.nativeSnapshot,stage.descriptor.nativeSnapshot))conflict('operation_conflict');
  if(receipt){
   if(receipt.request_digest!==stage.request_digest||stage.published_revision===null)conflict('operation_conflict');
   // Omitted cursor is a status retry. Explicit old cursors require their
   // committed witness; a future cursor never describes this operation.
   if(input.page!==undefined&&(input.page>stage.pages||(input.page<stage.pages&&!(await db.query('SELECT 1 FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2 AND page=$3',[id,stage.operation_id,input.page])).rowCount)))conflict('operation_conflict');
   return receipt.result;
  }
 }else{
  if(head.revision!==input.baseRevision)conflict();
  if(input.nativeSnapshot){
   const a=input.nativeSnapshot;
   if(a.accountId!==id||a.libraryId!==head.library_id||a.learnerId!==head.learner_id||a.revision!==head.revision||a.records!==head.record_count)conflict('library_sync_identity');
   if(hash(librarySyncNativeDescriptorText(a))!==a.manifestHash)throw new ConsumerError(400,'library_sync_hash');
   if(head.native_snapshot?.revision===head.revision&&!sameNative(head.native_snapshot,a))conflict('operation_conflict');
  }
  if(head.snapshot_revision===head.revision&&(!input.nativeSnapshot||sameNative(head.native_snapshot,input.nativeSnapshot)))return describe(head);
  stage=await active(db,id);
  if(stage&&(!sourceMatches(head,stage.descriptor)||new Date(stage.expires_at)<=now||!await lease(db,id,stage,now))){await db.query('UPDATE sensa_consumer.library_cloud_staging SET retiring=true,expires_at=LEAST(expires_at,$3) WHERE account_id=$1 AND operation_id=$2',[id,stage.operation_id,now]);stage=undefined;}
  if(stage&&input.nativeSnapshot&&!sameNative(input.nativeSnapshot,stage.descriptor.nativeSnapshot)){
   // Finish refs first; attaching an artifact can then reuse the selected H.
   return {preparation:progress(stage)};
  }
  // Return the error as a value so the route commits the maintenance slice
  // already performed by this request. Throwing here would roll it back and
  // make repeated preparation retries unable to free a workspace slot.
  if(!stage&&!await privateCapacity(db,id))return {code:'library_sync_capacity'};
  stage??=await begin(db,id,head,now,input);
 }
 const page=input.page??stage.pages;
 if(page<stage.pages){const prior=(await db.query('SELECT result FROM sensa_consumer.library_cloud_staging_pages WHERE account_id=$1 AND operation_id=$2 AND page=$3',[id,stage.operation_id,page])).rows[0];if(!prior?.result)conflict('operation_conflict');return prior.result;}
 if(page!==stage.pages)conflict('operation_conflict');
 if(stage.retiring||new Date(stage.expires_at)<=now||!sourceMatches(head,stage.descriptor)||!await lease(db,id,stage,now))conflict('library_sync_snapshot_required');
 const d=stage.descriptor,state=stage.checkpoint_state;
 if(state.phase==='sealed'){
  if(stage.records!==d.records||stage.prepared_records!==d.records||stage.prepared_pages!==stage.pages||state.position.revision!==d.baseRevision||state.position.offset!==0)conflict('library_sync_staging_unprepared');
  const changed=d.snapshotRevision!==d.baseRevision;
  const next:Head={...head,...(changed?{snapshot_generation:stage.operation_id,snapshot_revision:d.baseRevision,retention_floor:d.baseRevision,tail_bytes:Number(head.tail_bytes)-d.tailBytes,tail_commits:head.tail_commits-d.tailCommits}:{}),...(d.nativeSnapshot?{native_snapshot:d.nativeSnapshot}:{})};
  if(next.tail_bytes<0||next.tail_commits<0)conflict('library_sync_staging_unprepared');
  const result={...describe(next),receipt:{operationId:stage.operation_id,requestDigest:stage.request_digest}};
  await db.query('INSERT INTO sensa_consumer.library_cloud_commits(account_id,operation_id,request_digest,revision,result) VALUES($1,$2,$3,$4,$5::jsonb)',[id,stage.operation_id,stage.request_digest,d.baseRevision,JSON.stringify(result)]);
  await db.query('UPDATE sensa_consumer.library_cloud_staging SET published_revision=$3 WHERE account_id=$1 AND operation_id=$2',[id,stage.operation_id,d.baseRevision]);
  if(changed)await db.query(`UPDATE sensa_consumer.library_cloud SET snapshot_generation=$2,snapshot_revision=$3,retention_floor=$3,tail_bytes=$4,tail_commits=$5,native_snapshot=$6::jsonb WHERE account_id=$1`,[id,stage.operation_id,d.baseRevision,next.tail_bytes,next.tail_commits,JSON.stringify(next.native_snapshot??null)]);
  else if(d.nativeSnapshot)await db.query('UPDATE sensa_consumer.library_cloud SET native_snapshot=$2::jsonb WHERE account_id=$1',[id,JSON.stringify(d.nativeSnapshot)]);
  await db.query('DELETE FROM sensa_consumer.library_cloud_reads WHERE account_id=$1 AND id=$2',[id,state.readLease]);
  return result;
 }
 let records=state.records;
 if(state.phase==='snapshot'){
  const part=await readLibrarySnapshotPage(db,id,d.snapshotRevision,d.snapshotGeneration,state.after,libraryCloudCleanupRows,libraryCloudCleanupPins);
  if(part.rows.length){
   await db.query(`INSERT INTO sensa_consumer.library_cloud_snapshots(account_id,generation,revision,table_name,record_key,refs)
    SELECT $1,$2,$3,r.table_name,r.record_key,r.refs FROM jsonb_to_recordset($4::jsonb) r(table_name text,record_key text,refs jsonb)`,[id,stage.operation_id,d.baseRevision,JSON.stringify(part.rows)]);
   await pin(db,id,stage.operation_id,part.rows.flatMap(row=>row.refs));records+=part.rows.length;
  }
  state.after=part.next;if(part.done)state.phase='tail';
 }else if(state.phase==='tail'){
  const part=await readLibraryTailPage(db,id,state.position,d.baseRevision,libraryCloudCleanupRows,libraryCloudCleanupPins);
  if(part.rows.length){
   const keys=JSON.stringify(part.rows.map(row=>({table_name:row.table_name,record_key:row.record_key}))),key=(row:Head)=>JSON.stringify([row.table_name,row.record_key]);
   const existing=new Set((await db.query(`SELECT table_name,record_key FROM sensa_consumer.library_cloud_snapshots
    WHERE account_id=$1 AND generation=$2 AND revision=$3 AND (table_name,record_key) IN
     (SELECT r.table_name,r.record_key FROM jsonb_to_recordset($4::jsonb) r(table_name text,record_key text))`,[id,stage.operation_id,d.baseRevision,keys])).rows.map(key));
   for(const row of part.rows){if(row.refs&&!existing.has(key(row)))records++;else if(!row.refs&&existing.has(key(row)))records--;}
   const writes=part.rows.filter(row=>row.refs),deletes=part.rows.filter(row=>!row.refs);
   if(writes.length)await db.query(`INSERT INTO sensa_consumer.library_cloud_snapshots(account_id,generation,revision,table_name,record_key,refs)
    SELECT $1,$2,$3,r.table_name,r.record_key,r.refs FROM jsonb_to_recordset($4::jsonb) r(table_name text,record_key text,refs jsonb)
    ON CONFLICT(account_id,generation,revision,table_name,record_key) DO UPDATE SET refs=EXCLUDED.refs`,[id,stage.operation_id,d.baseRevision,JSON.stringify(writes)]);
   if(deletes.length)await db.query(`DELETE FROM sensa_consumer.library_cloud_snapshots s USING jsonb_to_recordset($4::jsonb) r(table_name text,record_key text)
    WHERE s.account_id=$1 AND s.generation=$2 AND s.revision=$3 AND s.table_name=r.table_name AND s.record_key=r.record_key`,[id,stage.operation_id,d.baseRevision,JSON.stringify(deletes)]);
  }
  await pin(db,id,stage.operation_id,part.rows.flatMap(row=>row.refs??[]));
  state.position=part.next;if(part.done){if(records!==d.records)conflict('library_sync_staging_unprepared');state.phase=d.nativeSnapshot?'native':'sealed';}
 }else if(state.phase==='native'){
  const a=d.nativeSnapshot as LibrarySyncNativeSnapshot|undefined;
  if(a){
   const refs=a.blocks.slice(state.nativeOffset,state.nativeOffset+libraryCloudCleanupPins),found=(await db.query('SELECT hash FROM sensa_consumer.library_cloud_blocks WHERE account_id=$1 AND hash=ANY($2::text[])',[id,[...new Set(refs)]])).rows;
   if(found.length!==new Set(refs).size)conflict('library_sync_missing_block');
   // The same G root protects partial uploads and published native-only H.
   // published_revision keeps it until current/reader H advances, even when
   // attaching bytes does not change head.snapshot_generation.
   await pin(db,id,stage.operation_id,refs);
   state.nativeOffset+=refs.length;
  }
  if(!a||state.nativeOffset===a.blocks.length)state.phase='sealed';
 }else conflict('library_sync_staging_unprepared');
 if(records<0||stage.pages>=200000)conflict('library_sync_capacity');
 state.records=records;stage.pages++;stage.prepared_pages++;stage.prepared_records=state.phase==='sealed'?records:0;
 const result={preparation:progress(stage)},requestDigest=hash(JSON.stringify({baseRevision:input.baseRevision,operationId:stage.operation_id,page})),digest=hash(stage.digest+requestDigest+JSON.stringify(state));
 await db.query('INSERT INTO sensa_consumer.library_cloud_staging_pages(account_id,operation_id,page,request_digest,digest,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id,stage.operation_id,page,requestDigest,digest,JSON.stringify(result)]);
 await db.query('UPDATE sensa_consumer.library_cloud_staging SET pages=$3,prepared_pages=$3,prepared_records=$4,digest=$5,checkpoint_state=$6::jsonb,expires_at=$7 WHERE account_id=$1 AND operation_id=$2',[id,stage.operation_id,stage.pages,stage.prepared_records,digest,JSON.stringify(state),new Date(now.getTime()+libraryCloudUploadLeaseMs)]);
 // Only newly committed progress renews the private source reader. An expired
 // reader is rejected above; an ACK replay cannot keep old history alive.
 await db.query('UPDATE sensa_consumer.library_cloud_reads SET expires_at=$3 WHERE account_id=$1 AND id=$2',[id,state.readLease,new Date(now.getTime()+libraryCloudReadLeaseMs)]);
 return result;
}

async function pin(db:DatabaseExecutor,id:string,operation:string,refs:string[]){
 if(refs.length)await db.query("INSERT INTO sensa_consumer.library_cloud_membership SELECT $1,'staging',$2,hash FROM unnest($3::text[]) hash ON CONFLICT DO NOTHING",[id,operation,[...new Set(refs)]]);
}
