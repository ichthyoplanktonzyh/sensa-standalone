import {librarySyncManifest,librarySyncPatch,librarySyncCommit,librarySyncPullResult,librarySyncSnapshotPageResult,librarySyncHead,librarySyncTables,librarySyncBlockFetchHashes,librarySyncBlockFetchBytes,librarySyncBlockFetchResult,librarySyncBlockMissingResult,librarySyncBlockStore,librarySyncBlockStoreBatch,librarySyncBlockStoreChars,librarySyncBlockStoreBytes,type LibrarySyncManifest,type LibrarySyncHead,type LibrarySyncCommit} from '@sensa/contracts/sensa';
import {readLibrary,readLocalLibraryRevision,restoreLibraryTransaction,writeLibraryState,assertCurrentLibrary,requestReplicaCandidate,type LibraryTransaction,type LibraryIdentity} from './store';
import {backupEqual,encodeBackupValue,decodeBackupValue} from './backupCodec';
import {cloudSyncFailurePolicy,type CloudSyncFailureKind} from './cloudSyncPolicy';
import {confirmedCheckpoint,validatedCheckpoint} from './cloudSyncCheckpoint';
import type {CloudSyncComparison} from './cloudSyncComparison';
import {
 isReplicatedLibraryEntry,
 mergeLibraryReplicasCooperatively,
 normalizeLibraryReplicaEntry,
 partitionLibraryReplicaConflicts,
 finalizeLibraryReplicaConflictChoice,
 replicaEntriesEqual,
 replicaEntryId,
 assertLibraryReplicaDelete,
 type LibraryReplicaEntry,
} from './replication/libraryReplica';
import {applyLibraryReplicaMutation} from './replication/libraryReplicaApplication';
import {validateLibraryReplicaCooperatively,libraryRestoreValidationVersion,type ValidatedLibraryReplica} from './replication/libraryReplicaValidation';
import {replicaCandidateAppendRecordLimit,replicaCandidateAppendReferenceLimit,type ReplicaCandidateFence,type ReplicaCandidateRequest,type ReplicaCandidateResponse,type ReplicaCandidateRecord,type ReplicaCandidateValidation} from './replicaCandidateProtocol';
export type SyncRequest=(path:string,body?:unknown)=>Promise<any>;
export type LibrarySyncOptions={publishEmptyIdentity?:boolean;restoreAfterLocalClear?:boolean;backgroundVerification?:boolean};
export type CloudSyncEntry=LibraryReplicaEntry;
type Entry=CloudSyncEntry;
type Owner={subject:string;accountId:string};
export type CloudSyncConflictChoice='local'|'remote';
export type CloudSyncConflict={detectedAt:string;localRevision:number;remoteRevision:number;remoteManifest:LibrarySyncHead['manifest'];records:{id:string;base:Entry|null;local:Entry|null;remote:Entry|null}[];affectedRecordIds:string[];comparison?:CloudSyncComparison};
export type CloudSyncState={receive?:import('./learningDeltaAdmission').DeltaReceiveEvidence;owner:Owner;incarnation:string;revision:number;checkpointVersion?:7;restoreValidationVersion?:typeof libraryRestoreValidationVersion;storage?:LibrarySyncHead['storage'];syncedLocalRevision?:number;pending?:LibrarySyncCommit;status:'pending'|'syncing'|'synced'|'offline'|'conflict'|'failed';conflicts?:string[];conflict?:CloudSyncConflict;resolution?:{choice:CloudSyncConflictChoice;expectedRemoteRevision:number;expectedLocalRevision:number;decision:{id:string;createdAt:string}};lastSyncedAt?:string;lastCheckedAt?:string;syncStartedAt?:string;error?:string;failureKind?:CloudSyncFailureKind;retryCount?:number;retryAt?:string};
type State=CloudSyncState&{/** Durable proof for an uncertain staged-restore COMMIT ACK. */restoreOperationId?:string;publicationOperationId?:string;initialUpload?:{id:string;operationId:string;localRevision:number;baseRevision:number};publication?:import('./replicaCandidateProtocol').InitialPublicationStats};
export type PendingCloudSyncRecord={table:typeof librarySyncTables[number];key:string};
export type PendingCloudSyncSnapshot={
 accountLinked:boolean;
 canSync:boolean;
 localRevision:number;
 records:PendingCloudSyncRecord[];
};
const STATE='cloud-sync';
const equal=backupEqual;
const entryId=replicaEntryId;
const entriesEqual=replicaEntriesEqual;
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
/** Unique transport bytes, not duplicated logical material snapshots. */
const TRANSFER_CAP=96*1024*1024;
// Keep the existing logical payload protection until capture/merge itself has
// a bounded snapshot path. Compression is not permission to multiply its heap.
const DECODED_CAP=64*1024*1024;
const blockCodec=()=>import('@sensa/contracts/sensa/library-sync-blocks');
// These API rejections occur before commit, unlike a lost/malformed ACK.
const rejectedPublication=(cause:unknown)=>cause instanceof Error&&['library_sync_history','library_sync_identity'].includes(cause.message);
async function captureHeader(tx:LibraryTransaction){
 const incarnation=await assertCurrentLibrary(tx),storedOwner=await tx.get<Owner>('meta','service-owner'),identity=await tx.get<LibraryIdentity>('meta','identity');
 if(!storedOwner?.accountId||!identity||await tx.get('meta','signed-out'))throw new Error('authentication_required');
 // Account display metadata (such as email) is not replica authority and must
 // not leak into the strict Worker fence. Leave the stored account untouched.
 const owner:Owner={subject:storedOwner.subject,accountId:storedOwner.accountId};
 return {owner,incarnation,identity,state:await tx.get<State>('meta',STATE),localRevision:await readLocalLibraryRevision(tx),reconnectRequired:await cloudReconnectRequired(tx)};
}
/** A validated remote baseline plus owner-admitted local transactions needs
 * only the changed bodies and their reference patch. */
async function captureDelta(tx:LibraryTransaction,expected:Awaited<ReturnType<typeof captureHeader>>,head:LibrarySyncHead){
 const current=await captureHeader(tx);
 if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
 if(current.localRevision!==expected.localRevision||!validatedCheckpoint(current.state)||current.state!.revision!==head.revision)throw new Error('library_sync_local_changed');
 if(current.localRevision===current.state!.syncedLocalRevision)return {...current,puts:[] as Entry[],deletes:[] as Array<Pick<Entry,'table'|'key'>>,};
 const changes=(await tx.changesSince(current.state!.syncedLocalRevision!,librarySyncTables)).filter(row=>isReplicatedLibraryEntry(row.table,row.key));
 const base=new Map((await tx.syncBaseEntries<typeof librarySyncTables>(changes)).map(row=>[entryId(row),row]));
 const puts:Entry[]=[],deletes:Array<Pick<Entry,'table'|'key'>>=[];
 for(const change of changes){
  const before=base.get(entryId(change));
  if(change.value===null){
   assertLibraryReplicaDelete(before?{...before,value:before.value}:{table:change.table,key:change.key,value:undefined});
   if(before)deletes.push({table:change.table,key:change.key});
  }else{
   const normalized=normalizeLibraryReplicaEntry({table:change.table,key:change.key,value:change.value},current.identity),value=encodeBackupValue(normalized.value);
   if(!equal(value,before?.value))puts.push({...normalized,value});
  }
 }
 return {...current,puts,deletes};
}
async function capture(tx:LibraryTransaction){
 const {owner,incarnation,identity,state,localRevision,reconnectRequired}=await captureHeader(tx),entries:Entry[]=[];
 const base:Entry[]=(await tx.syncBaseEntries<typeof librarySyncTables>()).map(row=>({table:row.table,key:row.key,value:row.value,blocks:row.blocks}));
 base.sort((a,b)=>entryId(a).localeCompare(entryId(b)));
 if(state?.syncedLocalRevision!==undefined&&state.syncedLocalRevision<=localRevision){
  const current=new Map(base.map(row=>[entryId(row),row]));
  // An authoritative empty remote stores an intentionally empty baseline so it
  // does not publish device bootstrap metadata. Seed the local identity again
  // when the first real learner record later makes a publication necessary.
  const normalizedIdentity=normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:identity},identity);
  if(!current.has(entryId(normalizedIdentity)))current.set(entryId(normalizedIdentity),{...normalizedIdentity,value:encodeBackupValue(normalizedIdentity.value)});
  for(const change of await tx.changesSince(state.syncedLocalRevision,librarySyncTables)){
   const id=entryId(change);
   if(change.value===null||!isReplicatedLibraryEntry(change.table,change.key)){current.delete(id);continue;}
   const normalized=normalizeLibraryReplicaEntry({table:change.table,key:change.key,value:change.value},identity);
   current.set(id,{...normalized,table:change.table,value:encodeBackupValue(normalized.value)});
  }
  entries.push(...current.values());
 }else{
  // The first checkpoint has no baseline. Afterwards SQLite returns only rows
  // changed since the last converged local revision, never the device ledger.
  for(const table of librarySyncTables)for(const row of await tx.entries(table)){
   if(typeof row.key!=='string')throw new Error('library_sync_format');
   if(isReplicatedLibraryEntry(table,row.key)){
    const normalized=normalizeLibraryReplicaEntry({table,key:row.key,value:row.value},identity);
    entries.push({...normalized,table,value:encodeBackupValue(normalized.value)});
   }
  }
 }
 entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));
 return {owner,incarnation,identity,entries,base,localRevision,state,reconnectRequired};
}
function sameOwner(a:Owner,b:Owner){return a.subject===b.subject&&a.accountId===b.accountId;}
function empty(entries:Entry[]){return entries.every(r=>r.table==='meta'&&r.key==='identity');}
async function conflictSnapshot(base:Entry[],local:Entry[],remote:Entry[],conflicts:string[],affectedRecordIds:string[],head:LibrarySyncHead,localRevision:number):Promise<CloudSyncConflict>{
 const byId=(entries:Entry[])=>new Map(entries.map(entry=>[entryId(entry),entry]));const b=byId(base),l=byId(local),r=byId(remote);
 const {buildCloudSyncComparison}=await import('./cloudSyncComparison');
 return {detectedAt:new Date().toISOString(),localRevision,remoteRevision:head.revision,remoteManifest:head.manifest,records:conflicts.map(id=>({id,base:b.get(id)??null,local:l.get(id)??null,remote:r.get(id)??null})),affectedRecordIds,comparison:buildCloudSyncComparison(conflicts,{base:b,local:l,remote:r})};
}
async function pendingCloudSyncRecords(tx:LibraryTransaction,state:State|undefined,identity:LibraryIdentity){
 if(state?.syncedLocalRevision===undefined){
  const records:PendingCloudSyncRecord[]=[];
  // Before the first checkpoint every replicated key is pending. The clear
  // preview needs identities/counts, not every Meaning, history or media body.
  for(const table of librarySyncTables)for await(const keys of tx.recordKeyBatches(table))for(const key of keys){
   if(isReplicatedLibraryEntry(table,key)&&!(table==='meta'&&key==='identity'))records.push({table,key});
  }
  return records.sort((a,b)=>entryId(a).localeCompare(entryId(b)));
 }
 const latest=new Map<string,{table:typeof librarySyncTables[number];key:string;value:unknown|null}>();
 for(const change of await tx.changesSince(state.syncedLocalRevision,librarySyncTables)){
  if(isReplicatedLibraryEntry(change.table,change.key))latest.set(entryId(change),change);
 }
 if(!latest.size)return [];
 const changes=[...latest.values()];
 const base=new Map((await tx.syncBaseEntries<typeof librarySyncTables>(changes.map(({table,key})=>({table,key}))))
  .map(row=>[entryId(row),row.value]));
 return changes.filter(change=>{
  const current=change.value===null?undefined:encodeBackupValue(normalizeLibraryReplicaEntry({table:change.table,key:change.key,value:change.value},identity).value);
  return !equal(current,base.get(entryId(change)));
 }).map(({table,key})=>({table,key})).sort((a,b)=>entryId(a).localeCompare(entryId(b)));
}
/** Exact local records that differ from the last confirmed account checkpoint. */
export async function inspectPendingCloudSync(tx:LibraryTransaction):Promise<PendingCloudSyncSnapshot>{
 const [owner,signedOut,identity,state,localRevision]=await Promise.all([
  tx.get<Owner>('meta','service-owner'),tx.get('meta','signed-out'),tx.get<LibraryIdentity>('meta','identity'),
  tx.get<State>('meta',STATE),readLocalLibraryRevision(tx),
 ]);
 if(!owner?.accountId)return {accountLinked:false,canSync:false,localRevision,records:[]};
 if(!identity)throw new Error('localFlow.storageOpen');
 return {accountLinked:true,canSync:!signedOut,localRevision,records:await pendingCloudSyncRecords(tx,state,identity)};
}
async function localDiffersFromBase(tx:LibraryTransaction,state:State,identity:LibraryIdentity){return (await pendingCloudSyncRecords(tx,state,identity)).length>0;}
const cloudReconnectRequired=async(tx:LibraryTransaction)=>(await tx.get('meta','local-reset'))==='local-clear';
export const readCloudReconnectRequired=()=>readLibrary(cloudReconnectRequired);
export const readCloudSync=()=>readLibrary(async tx=>{const state=await tx.get<State>('meta',STATE);if(state?.status==='syncing'&&(!state.syncStartedAt||Date.now()-Date.parse(state.syncStartedAt)>120000))return {...state,status:'pending' as const,syncStartedAt:undefined};if(state?.status==='synced'&&!await tx.get('meta','signed-out')){const localRevision=await readLocalLibraryRevision(tx);if(localRevision!==state.syncedLocalRevision){const identity=await tx.get<LibraryIdentity>('meta','identity');if(!identity||await localDiffersFromBase(tx,state,identity))return {...state,status:'pending' as const};}}return state;});
export async function resolveCloudSyncConflicts(choice:CloudSyncConflictChoice,expected:Pick<CloudSyncConflict,'localRevision'|'remoteRevision'>){
 await writeLibraryState(async tx=>{
  await assertCurrentLibrary(tx);if(await tx.get('meta','signed-out'))throw new Error('authentication_required');
  const state=await tx.get<State>('meta',STATE);if(state?.status!=='conflict'||!state.conflict)throw new Error('library_sync_no_conflict');
  if(!expected||!Number.isSafeInteger(expected.localRevision)||expected.localRevision!==state.conflict.localRevision||expected.remoteRevision!==state.conflict.remoteRevision||await readLocalLibraryRevision(tx)!==expected.localRevision)throw Error('library_sync_conflict_changed');
  tx.put('meta',STATE,{...state,status:'pending',resolution:{choice,expectedRemoteRevision:expected.remoteRevision,expectedLocalRevision:expected.localRevision,decision:{id:crypto.randomUUID(),createdAt:new Date().toISOString()}},error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
 });
}
async function saveState(expected:{owner:Owner;incarnation:string;localRevision?:number;identity?:LibraryIdentity},work:(old:State|undefined)=>State,base?:Entry[],consumeReconnect=false){
 await writeLibraryState(async tx=>{
  const owner=await tx.get<Owner>('meta','service-owner');
  if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');
  if(expected.localRevision!==undefined&&await readLocalLibraryRevision(tx)!==expected.localRevision)throw new Error('library_sync_local_changed');
  if(expected.identity&&!equal(await tx.get('meta','identity'),expected.identity))throw new Error('account_changed');
  tx.put('meta',STATE,work(await tx.get<State>('meta',STATE)));if(base!==undefined)tx.replaceSyncBase(base);if(consumeReconnect)tx.delete('meta','local-reset');
 });
}
async function applyEntries(expected:Awaited<ReturnType<typeof capture>>,entries:Entry[],rows:ValidatedLibraryReplica,state:State,base:Entry[],consumeReconnect=false){
 const changesContent=!entriesEqual(expected.entries,entries);
 // One SQLite commit makes facts and their corresponding baseline visible
 // together. An unchanged candidate remains bookkeeping, not a learner edit.
 return (changesContent?restoreLibraryTransaction:writeLibraryState)(async tx=>{
  const current=await captureHeader(tx);
  if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
  if(current.localRevision!==expected.localRevision||!equal(current.identity,expected.identity))throw new Error('library_sync_local_changed');
  applyLibraryReplicaMutation({tx,current:expected.entries,desired:entries,records:rows.records,identity:current.identity});
  tx.put('meta',STATE,{...state,...(state.conflict?{conflict:{...state.conflict,localRevision:current.localRevision+(changesContent?1:0)}}:{})});tx.replaceSyncBase(base);
  if(consumeReconnect)tx.delete('meta','local-reset');
  return current.localRevision+(changesContent?1:0);
 });
}
class Blocks{
 cache=new Map<string,string>();
 private held=0;
 constructor(private request:SyncRequest){}
 private remember(id:string,data:string,protectedIds?:ReadonlySet<string>){
  if(this.cache.has(id))return;const size=new TextEncoder().encode(data).length;
  if(protectedIds)for(const hash of this.cache.keys()){
   if(this.held+size<=TRANSFER_CAP)break;
   if(!protectedIds.has(hash))this.forget(hash);
  }
  if(this.held+size>TRANSFER_CAP)throw new Error('library_sync_capacity');
  this.held+=size;this.cache.set(id,data);
 }
 private forget(id:string){const data=this.cache.get(id);if(data!==undefined){this.held-=new TextEncoder().encode(data).length;this.cache.delete(id);}}
 private async packSegment(segment:string,refs:string[]){const {splitLibrarySyncText,encodeLibrarySyncBlock}=await blockCodec();for(const part of splitLibrarySyncText(segment)){const data=encodeLibrarySyncBlock(part),id=await hash(data);this.remember(id,data);refs.push(id);}}
 async pack(text:string){const refs:string[]=[];let at=0;const media=/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;for(const match of text.matchAll(media)){const start=match.index??0;await this.packSegment(text.slice(at,start),refs);await this.packSegment(match[0],refs);at=start+match[0].length;}await this.packSegment(text.slice(at),refs);return refs;}
 /** One request per byte-budgeted page: the cost of a restore follows library size,
  *  not how many blocks an older client happened to split it into. */
 async fetch(ids:string[],onePage=false,protectedIds?:ReadonlySet<string>){
  const pending=[...new Set(ids)].filter(id=>!this.cache.has(id));
  let rounds=0,pageSize=librarySyncBlockFetchHashes;
  for(let at=0;at<pending.length;){
   if(++rounds>4096)throw new Error('library_sync_format');
   const page=pending.slice(at,at+pageSize);
   let raw:unknown;
   try{raw=await this.request('/blocks/fetch',{hashes:page});}
   catch(error){
    // During a rolling release the previous API accepts only eight hashes. Keep the
    // new client functional until the byte-paged endpoint reaches that deployment.
    if(pageSize>8&&error instanceof Error&&error.message==='invalid_request'){pageSize=8;continue;}
    throw error;
   }
   const reply=librarySyncBlockFetchResult.parse(raw);
   const requested=new Set(page);
   if(reply.blocks.some(block=>!requested.has(block.hash))||reply.missing.some(id=>!requested.has(id))||reply.deferred.some(id=>!requested.has(id)))throw new Error('library_sync_format');
   if(reply.missing.length)throw new Error('library_sync_missing_block');
   if(onePage&&reply.blocks.reduce((bytes,block)=>bytes+new TextEncoder().encode(block.data).length,0)>librarySyncBlockFetchBytes)throw new Error('library_sync_format');
   for(const block of reply.blocks){if(await hash(block.data)!==block.hash)throw new Error('library_sync_hash');this.remember(block.hash,block.data,protectedIds);}
   if(!reply.blocks.length&&reply.deferred.length)throw new Error('library_sync_format');
   // Prefetch only one byte-bounded response, not every deferred hash. The
   // current row falls back to complete fetch below if it spans several pages.
   if(onePage)return;
   at+=page.length;
   // The response is bounded by bytes, so anything it could not carry is re-queued.
   for(const id of reply.deferred)if(!this.cache.has(id))pending.push(id);
  }
  for(const id of ids)if(!this.cache.has(id))throw new Error('library_sync_missing_block');
 }
 async text(refs:string[]){const {decodeLibrarySyncBlock}=await blockCodec();const parts:string[]=[];let size=0;for(const id of refs){const data=this.cache.get(id);if(data===undefined)throw new Error('library_sync_missing_block');const part=decodeLibrarySyncBlock(data);size+=part.length;if(size>90*1024*1024)throw new Error('library_sync_capacity');parts.push(part);}return parts.join('');}
 async upload(){
  const keys=[...this.cache.keys()],missing:string[]=[];
  for(let at=0;at<keys.length;at+=512){const reply=librarySyncBlockMissingResult.parse(await this.request('/blocks/missing',{hashes:keys.slice(at,at+512)}));if(reply.missing.some(id=>!this.cache.has(id)))throw new Error('library_sync_format');missing.push(...reply.missing);}
  for(let at=0;at<missing.length;){
   const blocks:{hash:string;data:string}[]=[];let chars=0,bytes=13;
   while(at<missing.length&&blocks.length<librarySyncBlockStoreBatch){const data=this.cache.get(missing[at])!;const block={hash:missing[at],data},size=new TextEncoder().encode(JSON.stringify(block)).length+1;if(blocks.length&&(chars+data.length>librarySyncBlockStoreChars||bytes+size>librarySyncBlockStoreBytes))break;if(bytes+size>librarySyncBlockStoreBytes)throw Error('library_sync_capacity');blocks.push(block);chars+=data.length;bytes+=size;at++;}
   librarySyncBlockStore.parse({blocks});await this.request('/blocks/store',{blocks});
  }
 }
 async prepare(entries:Entry[]){
  const {librarySyncRecordSegments}=await blockCodec(),prepared:Entry[]=[];let decodedSize=0;
  for(const r of entries){let refs=r.blocks;if(!refs?.length){refs=[];for(const segment of librarySyncRecordSegments(r.value)){decodedSize+=new TextEncoder().encode(segment).length;if(decodedSize>DECODED_CAP)throw new Error('library_sync_capacity');refs.push(...await this.pack(segment));}}prepared.push({...r,blocks:[...refs]});}
  return prepared;
 }
 async packManifest(identity:LibraryIdentity,rows:LibrarySyncManifest['rows']){
  return this.pack(JSON.stringify(librarySyncManifest.parse({version:8,libraryId:identity.id,learnerId:identity.learnerId,rows})));
 }
 async patch(identity:LibraryIdentity,changes:Array<{table:Entry['table'];key:string;blocks:string[]|null}>){
  const text=JSON.stringify(librarySyncPatch.parse({version:1,libraryId:identity.id,learnerId:identity.learnerId,changes}));
  if(new TextEncoder().encode(text).length>4*1024*1024)throw Error('library_sync_capacity');return this.pack(text);
 }
 async *indexPages(head:LibrarySyncHead,baseRevision?:number){
  if(!head.manifest)return;
  let position={revision:baseRevision??head.manifest.snapshotRevision,offset:0};
  if(baseRevision===undefined){
   let after:{table:string;key:string}|null=null;
   for(;;){const page=librarySyncSnapshotPageResult.parse(await this.request('/snapshot',{snapshotRevision:head.manifest.snapshotRevision,after,readLease:head.readLease}));
    if(page.snapshotRevision!==head.manifest.snapshotRevision||!equal(page.after,after)||!page.rows.length&&!page.done)throw Error('library_sync_format');
    const last=page.rows.at(-1),next=last?{table:last.table,key:last.key}:after;if(!equal(page.next,next))throw Error('library_sync_format');
    const compare=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
    let previous=after;for(const row of page.rows){if(previous&&(compare(row.table,previous.table)<0||row.table===previous.table&&compare(row.key,previous.key)<=0))throw Error('library_sync_format');previous={table:row.table,key:row.key};}
    yield page;if(page.done)break;after=page.next;
   }
  }
  while(position.revision<head.revision){
   const page=librarySyncPullResult.parse(await this.request('/pull',{after:position,toRevision:head.revision,readLease:head.readLease}));
   if(!equal(page.from,position)||page.toRevision!==head.revision||!page.changes.length||!(page.next.revision===position.revision&&page.next.offset===position.offset+page.changes.length||page.next.revision===position.revision+1&&page.next.offset===0)||page.next.revision>head.revision||page.done!==(page.next.revision===head.revision))throw Error('library_sync_format');
   yield page;position=page.next;
  }
 }
 /** An admitted baseline is copied privately in the Worker. Continuous index
  * pages overlay that generation; only changed body/proof windows cross RPC. */
 async stage(head:LibrarySyncHead,fence:ReplicaCandidateFence,send:(request:ReplicaCandidateRequest)=>Promise<ReplicaCandidateResponse>,baseRevision?:number):Promise<ReplicaCandidateValidation>{
  if(!head.manifest)throw Error('library_sync_candidate_invalid');
  if(baseRevision!==undefined&&baseRevision<head.manifest.floor)baseRevision=undefined;
  const begun=await send({kind:'beginIndex',fence,head,baseRevision});if(begun.kind!=='begun')throw Error('library_sync_candidate_invalid');
  const id=begun.id;
  try{
   for await(const page of this.indexPages(head,baseRevision)){
    const indexed=await send({kind:'indexPage',id,page});if(indexed.kind!=='indexed')throw Error('library_sync_candidate_invalid');
    const needed=new Set(indexed.needed.map(row=>JSON.stringify([row.table,row.key]))),rows='rows' in page?page.rows:page.changes;
    const pendingRows=rows.filter(row=>row.blocks&&needed.has(entryId(row))) as LibrarySyncManifest['rows'];
   const remaining=new Map<string,number>();for(const row of pendingRows)for(const hash of new Set(row.blocks))remaining.set(hash,(remaining.get(hash)??0)+1);
   let records:ReplicaCandidateRecord[]=[],proofs=new Map<string,string>(),bodyBytes=0,proofBytes=0,referenceCount=0;
   const flush=async()=>{
    if(!records.length)return;
    const result=await send({kind:'append',id,records,blocks:[...proofs].map(([hash,data])=>({hash,data}))});
    if(result.kind!=='appended')throw Error('library_sync_candidate_invalid');
    records=[];proofs=new Map();bodyBytes=0;proofBytes=0;referenceCount=0;
   };
   for(let at=0;at<pendingRows.length;at++){
    const row=pendingRows[at],refs=new Set(row.blocks);
    if(row.blocks.some(hash=>!this.cache.has(hash))){
     // Ask for the existing API's hash window but retain only one byte page.
     // Small records share a roundtrip; large records cannot inflate prefetch.
     // Retain still-reachable prefetched bodies. Only budget pressure evicts
     // unrelated hashes; the complete current row stays protected.
     const wanted=new Set<string>();
     for(let index=at;index<pendingRows.length&&wanted.size<librarySyncBlockFetchHashes;index++)for(const hash of pendingRows[index].blocks){wanted.add(hash);if(wanted.size===librarySyncBlockFetchHashes)break;}
     await this.fetch([...wanted],true,refs);
     if(row.blocks.some(hash=>!this.cache.has(hash)))await this.fetch(row.blocks,false,refs);
    }
    const valueJson=await this.text(row.blocks),size=new TextEncoder().encode(valueJson).length;
    if(size>90*1024*1024)throw Error('library_sync_capacity');
    const record:ReplicaCandidateRecord={table:row.table,key:row.key,valueJson,blockRefs:row.blocks};
    const rowProofBytes=[...refs].reduce((sum,hash)=>sum+new TextEncoder().encode(this.cache.get(hash)!).length,0);
    if(size>4*1024*1024||rowProofBytes>4*1024*1024||refs.size>512){
     await flush();const {decodeLibrarySyncBlock}=await blockCodec();
     let batch:Array<{hash:string;data:string}>=[],rawBytes=0,plainBytes=0;
     const prove=async()=>{if(!batch.length)return;const result=await send({kind:'prove',id,record:{table:row.table,key:row.key},blocks:batch});if(result.kind!=='proved')throw Error('library_sync_candidate_invalid');batch=[];rawBytes=0;plainBytes=0;};
     for(const hash of refs){
      const data=this.cache.get(hash)!,raw=new TextEncoder().encode(data).length,plain=new TextEncoder().encode(decodeLibrarySyncBlock(data)).length;
      if(batch.length&&(rawBytes+raw>4*1024*1024||plainBytes+plain>4*1024*1024||batch.length===512))await prove();
      batch.push({hash,data});rawBytes+=raw;plainBytes+=plain;
     }
     await prove();const result=await send({kind:'append',id,records:[record],blocks:[]});if(result.kind!=='appended')throw Error('library_sync_candidate_invalid');
    }else{
     const needed=[...refs].filter(hash=>!proofs.has(hash)),extra=needed.reduce((sum,hash)=>sum+new TextEncoder().encode(this.cache.get(hash)!).length,0);
     if(records.length&&(records.length===replicaCandidateAppendRecordLimit||referenceCount+row.blocks.length>replicaCandidateAppendReferenceLimit||bodyBytes+size>4*1024*1024||proofBytes+extra>4*1024*1024||proofs.size+needed.length>512))await flush();
     for(const hash of refs)if(!proofs.has(hash)){const data=this.cache.get(hash)!;proofs.set(hash,data);proofBytes+=new TextEncoder().encode(data).length;}
     records.push(record);bodyBytes+=size;referenceCount+=row.blocks.length;
    }
    for(const hash of refs){const count=remaining.get(hash)!-1;if(count)remaining.set(hash,count);else{remaining.delete(hash);this.forget(hash);}}
   }
   await flush();for(const hash of [...this.cache.keys()])this.forget(hash);
   }
   const result=await send({kind:'validate',id});if(result.kind!=='validated')throw Error('library_sync_candidate_invalid');return result.candidate;
  }catch(cause){for(const hash of [...this.cache.keys()])this.forget(hash);await send({kind:'discard',id}).catch(()=>{});throw cause;}
 }
 async download(head:LibrarySyncHead,base:Entry[]=[],baseRevision?:number){
  if(!head.manifest)return [];
  if(baseRevision!==undefined&&baseRevision<head.manifest.floor)baseRevision=undefined;
  const inventory=new Map<string,LibrarySyncManifest['rows'][number]>(baseRevision===undefined?[]:base.map(row=>[entryId(row),{table:row.table,key:row.key,blocks:row.blocks!}]));
  for await(const page of this.indexPages(head,baseRevision))for(const row of 'rows' in page?page.rows:page.changes){if(row.blocks)inventory.set(entryId(row),{...row,blocks:row.blocks});else inventory.delete(entryId(row));}
  if(inventory.size!==head.manifest.records)throw Error('library_sync_format');
  const checkpointRows=[...inventory.values()];
  const prior=new Map(base.map(entry=>[entryId(entry),entry]));
  const reusable=(row:LibrarySyncManifest['rows'][number])=>{const entry=prior.get(entryId(row as Entry));return entry?.blocks&&equal(entry.blocks,row.blocks)?entry:undefined;};
  // Baseline rows whose confirmed block references did not change need neither
  // hashing nor download. Fetch only the bodies added or replaced by this head.
  const remaining=new Map<string,number>();
  for(const row of checkpointRows)if(!reusable(row))for(const id of new Set(row.blocks))remaining.set(id,(remaining.get(id)??0)+1);
  for(const id of this.cache.keys())if(!remaining.has(id))this.forget(id);
  const entries:Entry[]=[];let size=0;
  // Consume bounded row windows and release blocks after their final reference.
  // Restoring does not retain an extra copy of the entire transport checkpoint.
  for(let at=0;at<checkpointRows.length;at+=128){
   const page=checkpointRows.slice(at,at+128);await this.fetch(page.filter(row=>!reusable(row)).flatMap(row=>row.blocks));
   for(const row of page){
    const existing=reusable(row);if(existing){entries.push({...existing,blocks:[...row.blocks]});continue;}
    const text=await this.text(row.blocks);size+=new TextEncoder().encode(text).length;if(size>DECODED_CAP)throw new Error('library_sync_capacity');
    entries.push({table:row.table as Entry['table'],key:row.key,value:JSON.parse(text),blocks:[...row.blocks]});
    for(const id of new Set(row.blocks)){const count=remaining.get(id)!-1;if(count)remaining.set(id,count);else{remaining.delete(id);this.forget(id);}}
   }
  }
  entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));const {identity}=await validateLibraryReplicaCooperatively(entries);if(identity.id!==head.manifest.libraryId||identity.learnerId!==head.manifest.learnerId)throw new Error('library_sync_identity');return entries;
 }
}
async function downloadStableHead(blocks:Blocks,request:SyncRequest,base:Entry[],confirmedRevision?:number,observedHead?:LibrarySyncHead){
 let head=observedHead??parseSyncHead(await request('/head'));
 // A confirmed baseline is already the complete body of this remote revision.
 // Reuse it without fetching even the manifest; conflicts deliberately keep a
 // mixed baseline and therefore never provide a confirmed revision here.
 if(confirmedRevision===head.revision)return {head,remote:base};
 for(let attempt=0;attempt<3;attempt++){
  try{return {head,remote:await blocks.download(head,base,confirmedRevision)};}
  catch(error){
   if(!(error instanceof Error)||error.message!=='library_sync_missing_block')throw error;
   const latest=parseSyncHead(await request('/head'));
   if(latest.revision===head.revision&&equal(latest.manifest,head.manifest))throw error;
   if(attempt===2)throw new Error('library_sync_head_changed');
   head=latest;
  }
 }
 throw new Error('library_sync_head_changed');
}

async function canRestoreFreshLibrary(tx:LibraryTransaction){
 // Read only keys, never materialize an existing user's bodies to determine
 // eligibility. A previous baseline must still take the domain merge path.
 if((await tx.syncBaseReferences()).length)return false;
 for(const table of librarySyncTables)for await(const keys of tx.recordKeyBatches(table))for(const key of keys){
  if(isReplicatedLibraryEntry(table,key)&&!(table==='meta'&&key==='identity'))return false;
 }
 return true;
}

async function stageStableCandidate(blocks:Blocks,request:SyncRequest,head:LibrarySyncHead,fence:ReplicaCandidateFence,baseRevision?:number):Promise<{head:LibrarySyncHead;candidate?:ReplicaCandidateValidation}>{
 for(let attempt=0;attempt<3;attempt++){
  if(!head.manifest)return {head};
  try{return {head,candidate:await blocks.stage(head,fence,requestReplicaCandidate,baseRevision)};}
  catch(cause){
   if(!(cause instanceof Error)||cause.message!=='library_sync_missing_block')throw cause;
   const latest=parseSyncHead(await request('/head'));
   if(latest.revision===head.revision&&equal(latest.manifest,head.manifest))throw cause;
   if(attempt===2)throw Error('library_sync_head_changed');head=latest;
  }
 }
 throw Error('library_sync_head_changed');
}

function parseSyncHead(value:unknown):LibrarySyncHead{
 if(value&&typeof value==='object'&&'manifest' in value&&Array.isArray(value.manifest))throw Error('library_sync_incompatible_checkpoint');
 const parsed=librarySyncHead.safeParse(value);if(!parsed.success)throw Error('library_sync_format');return parsed.data;
}
async function verifyPublication(head:LibrarySyncHead,pending:LibrarySyncCommit){
 const parsed=librarySyncCommit.parse(pending);
 if(head.revision!==pending.baseRevision+1||head.receipt?.operationId!==pending.operationId||head.receipt.requestDigest!==await hash(JSON.stringify(parsed)))throw Error('library_sync_format');
}

async function confirmInitialPublication(header:Awaited<ReturnType<typeof captureHeader>>,id:string,published:LibrarySyncHead,sourceRevision:number,currentRemoteRevision=published.revision){
 await requestReplicaCandidate({kind:'validatePublication',id,confirmed:true});
 await writeLibraryState(async tx=>{
  const current=await captureHeader(tx);
  if(!sameOwner(current.owner,header.owner)||current.incarnation!==header.incarnation||!equal(current.identity,header.identity))throw Error('account_changed');
  const completedAt=new Date().toISOString();tx.confirmInitialPublication(id);
  tx.put('meta',STATE,{...current.state!,publicationOperationId:id,initialUpload:undefined,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,revision:published.revision,storage:published.storage,status:current.localRevision===sourceRevision&&currentRemoteRevision===published.revision?'synced':'pending',syncedLocalRevision:sourceRevision,pending:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
 });
}

/** The source stays private and revision fenced while bounded rows/blocks cross
 * the page. Only a durable server receipt authorizes the baseline transaction. */
async function publishInitialLibrary(header:Awaited<ReturnType<typeof captureHeader>>,head:LibrarySyncHead,request:SyncRequest,options:LibrarySyncOptions):Promise<boolean>{
 const begun=await requestReplicaCandidate({kind:'beginPublication',fence:{owner:header.owner,incarnation:header.incarnation,identity:header.identity,localRevision:header.localRevision}});
 if(begun.kind!=='begun')throw Error('library_sync_candidate_invalid');
 const id=begun.id,operationId=header.state?.initialUpload?.localRevision===header.localRevision?header.state.initialUpload.operationId:crypto.randomUUID();
 if(header.state?.initialUpload&&header.state.initialUpload.operationId!==operationId)await request('/staging/discard',{operationId:header.state.initialUpload.operationId});
 let after:import('./replicaCandidateProtocol').InitialPublicationPage['next']=null,pageNumber=0,digest=await hash('sensa-initial-publication-v1'),pendingSaved=false;
 try{
  for(;;){
   const page=await requestReplicaCandidate({kind:'publicationPage',id,after});if(page.kind!=='publicationPage')throw Error('library_sync_candidate_invalid');
   if(page.done&&page.stats.records===1&&!options.publishEmptyIdentity)return false;
   if(pageNumber===0){
    await saveState({...header,localRevision:header.localRevision},old=>({...old!,initialUpload:{id,operationId,localRevision:header.localRevision,baseRevision:head.revision}}));
    await request('/staging/begin',{operationId,baseRevision:head.revision,libraryId:header.identity.id,learnerId:header.identity.learnerId,incarnation:header.incarnation,localRevision:header.localRevision});
   }
   if(page.rows.length){
    // The cache exists for one page only; per-record, inflate, request and
    // account limits remain enforced independently of total logical expansion.
    const hashes=[...new Set(page.rows.flatMap(row=>row.blocks))];
    for(let at=0;at<hashes.length;at+=512){
     const wanted=hashes.slice(at,at+512),reply=librarySyncBlockMissingResult.parse(await request('/blocks/missing',{hashes:wanted}));
     if(reply.missing.some(hash=>!wanted.includes(hash)))throw Error('library_sync_format');let missing=reply.missing;
     while(missing.length){const packed=await requestReplicaCandidate({kind:'publicationBlocks',id,hashes:missing});if(packed.kind!=='publicationBlocks')throw Error('library_sync_candidate_invalid');librarySyncBlockStore.parse({blocks:packed.blocks});await request('/blocks/store',{blocks:packed.blocks});missing=packed.deferred;}
    }
    const input={operationId,page:pageNumber,rows:page.rows},expectedDigest=await hash(digest+await hash(JSON.stringify(input))),reply=await request('/staging/page',input);
    if(reply?.digest!==expectedDigest)throw Error('library_sync_format');digest=expectedDigest;pageNumber++;
   }
   after=page.next;
   if(page.done)break;
  }
  const checked=await requestReplicaCandidate({kind:'validatePublication',id});if(checked.kind!=='publicationValidated')throw Error('library_sync_candidate_invalid');
  const pending:LibrarySyncCommit={operationId,baseRevision:head.revision,staging:{pages:pageNumber,records:checked.stats.records,digest}};
  // From here the sealed generation may be the recovery source for a durable
  // pending write whose Worker ACK is lost. Keep it even on an uncertain ACK.
  pendingSaved=true;
  await saveState({owner:header.owner,incarnation:header.incarnation,identity:header.identity},old=>({...old!,pending,publication:checked.stats}));
  let published:LibrarySyncHead;
  try{published=parseSyncHead(await request('/commit',pending));}
  catch(cause){if(cause instanceof Error&&cause.message==='library_sync_conflict')throw Error('library_sync_head_changed');throw cause;}
  await verifyPublication(published,pending);
  await confirmInitialPublication(header,id,published,header.localRevision);return true;
 }finally{if(!pendingSaved)await requestReplicaCandidate({kind:'discardPublication',id}).catch(()=>{});}
}

/** Injected transport permits offline/idempotency/restore tests without real accounts. */
export async function synchronizeLibrary(request:SyncRequest,options:LibrarySyncOptions={}){
 let receiveEvidence:import('./learningDeltaAdmission').DeltaReceiveEvidence|undefined;
 const header=await readLibrary(captureHeader),expected={owner:header.owner,incarnation:header.incarnation};
 // Apply to both staged restoration and the ordinary empty-library fallback.
 // No request/status is manufactured while the learner keeps the cleared world.
 if(header.reconnectRequired&&!options.restoreAfterLocalClear)return;
 const consumeReconnect=header.reconnectRequired&&options.restoreAfterLocalClear===true;
 const prior=header.state;
 const initiallyConflicted=prior?.status==='conflict'||!!prior?.conflicts?.length||!!prior?.conflict||!!prior?.resolution;
 if(prior&&(!sameOwner(prior.owner,header.owner)||prior.incarnation!==header.incarnation))throw new Error('account_changed');
 const defaults:State={...expected,revision:0,status:'pending'};
 const transport=request;
 request=async(path,body)=>{
  await readLibrary(async tx=>{const owner=await tx.get<Owner>('meta','service-owner');if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');});
  return transport(path,body);
 };
 const blocks=new Blocks(request);
 try{
  // A confirmed, clean verification keeps its durable checkpoint while the
  // head is in flight. Success updates it once; failure still saves a real
  // error. This avoids two OPFS commits for an unchanged background check.
  const cleanVerification=options.backgroundVerification===true&&validatedCheckpoint(prior)&&prior!.status==='synced'&&prior!.syncedLocalRevision===header.localRevision&&!options.publishEmptyIdentity&&!consumeReconnect;
  if(!cleanVerification)await saveState(expected,old=>({...old??defaults,status:'syncing',syncStartedAt:new Date().toISOString(),error:undefined}));
  let observedHead:LibrarySyncHead|undefined;
  if(prior?.pending&&'staging' in prior.pending&&prior.initialUpload){
   const p=prior.pending,upload=prior.initialUpload,receipt=await request('/receipt/'+p.operationId);
   if(receipt.head){const published=parseSyncHead(receipt.head);await verifyPublication(published,p);await confirmInitialPublication(header,upload.id,published,upload.localRevision,receipt.currentRevision);return;}
   {
    try{const published=parseSyncHead(await request('/commit',p));await verifyPublication(published,p);await confirmInitialPublication(header,upload.id,published,upload.localRevision);return;}
    catch(cause){if(!(cause instanceof Error)||!['library_sync_conflict','library_sync_staging_expired','library_sync_missing_block','library_sync_local_changed','library_sync_identity'].includes(cause.message))throw cause;}
   }
   const retired=await request('/staging/discard',{operationId:p.operationId});
   if(retired.head){const published=parseSyncHead(retired.head);await verifyPublication(published,p);await confirmInitialPublication(header,upload.id,published,upload.localRevision,retired.currentRevision);return;}
   await saveState(expected,old=>({...old!,pending:undefined,initialUpload:undefined}));
   header.state={...header.state!,pending:undefined,initialUpload:undefined};
  }
  if(!initiallyConflicted&&(!validatedCheckpoint(prior)||prior?.revision===0)&&(!prior?.pending||'staging' in prior.pending)){
   observedHead=parseSyncHead(await request('/head'));
   if(!observedHead.manifest){
    try{if(await publishInitialLibrary(header,observedHead,request,options))return;}
    catch(cause){if(!(cause instanceof Error)||cause.message!=='sqlite_replica_candidate_unavailable')throw cause;}
   }
  }
  if(validatedCheckpoint(prior)&&prior!.syncedLocalRevision!<=header.localRevision){
   observedHead??=parseSyncHead(await request('/head'));
   if(cleanVerification&&observedHead.revision!==prior!.revision)await saveState(expected,old=>({...old??defaults,status:'syncing',syncStartedAt:new Date().toISOString(),error:undefined}));
   if(observedHead.revision===prior!.revision&&!(observedHead.manifest===null&&(options.publishEmptyIdentity||header.localRevision!==prior!.syncedLocalRevision))){
    const delta=await readLibrary(tx=>captureDelta(tx,header,observedHead!));
    if(delta.puts.length||delta.deletes.length){
     const prepared=await blocks.prepare(delta.puts),patch=await blocks.patch(delta.identity,[...prepared.map(row=>({table:row.table,key:row.key,blocks:row.blocks!})),...delta.deletes.map(row=>({...row,blocks:null}))]);
     const pending={operationId:crypto.randomUUID(),baseRevision:observedHead.revision,patch};
     await blocks.upload();
     await saveState(expected,old=>{
      if(!validatedCheckpoint(old)||old!.revision!==pending.baseRevision)throw new Error('library_sync_local_changed');
      return {...old!,status:'pending',pending};
     });
     let published:LibrarySyncHead;
     try{published=parseSyncHead(await request('/commit',pending));}
     catch(cause){
      if(cause instanceof Error&&cause.message==='library_sync_conflict'){await saveState(expected,old=>({...old!,pending:undefined}));throw new Error('library_sync_head_changed');}
      if(rejectedPublication(cause))await saveState(expected,old=>({...old!,pending:undefined}));
      throw cause;
     }
     await verifyPublication(published,pending);
     await writeLibraryState(async tx=>{
      const current=await captureHeader(tx),state=current.state;
      if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
      if(state?.pending?.operationId!==pending.operationId||state.revision!==pending.baseRevision)throw new Error('library_sync_local_changed');
      const completedAt=new Date().toISOString();
      tx.patchSyncBase({puts:prepared.map(row=>({...row,blocks:row.blocks!})),deletes:delta.deletes});
      tx.put('meta',STATE,{...state,revision:published.revision,storage:published.storage??state.storage,status:current.localRevision===delta.localRevision?'synced':'pending',syncedLocalRevision:delta.localRevision,pending:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
     });
     return;
    }
    await writeLibraryState(async tx=>{
     const current=await captureHeader(tx);
     if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
     if(current.localRevision!==header.localRevision||!validatedCheckpoint(current.state)||current.state!.revision!==prior!.revision||current.state!.syncedLocalRevision!==prior!.syncedLocalRevision)throw new Error('library_sync_local_changed');
     const completedAt=new Date().toISOString();
     tx.put('meta',STATE,{...current.state!,storage:observedHead!.storage??current.state!.storage,status:'synced',syncedLocalRevision:header.localRevision,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
    });
    return;
   }
  }
  // A remote-only update can keep its bodies in the same SQLite candidate
  // used for fresh restoration. The Worker still runs domain three-way merge
  // against the confirmed baseline, then prepares only actual record changes.
  if(validatedCheckpoint(prior)&&prior!.syncedLocalRevision===header.localRevision&&observedHead?.manifest&&observedHead.revision!==prior!.revision){
   let candidate:ReplicaCandidateValidation|undefined;
   try{
    const staged=await stageStableCandidate(blocks,request,observedHead,{owner:header.owner,incarnation:header.incarnation,identity:header.identity,localRevision:header.localRevision},prior!.revision);
    observedHead=staged.head;candidate=staged.candidate;receiveEvidence=candidate?.receive;
    const prepared=candidate?await requestReplicaCandidate({kind:'prepareUpdate',id:candidate.id,baseRevision:prior!.revision}):{kind:'updatePrepared' as const,update:null};
    if(prepared.kind!=='updatePrepared')throw Error('library_sync_candidate_invalid');
    if(prepared.update&&candidate){
     const selected=candidate,update=prepared.update;
     await (update.contentChanged?restoreLibraryTransaction:writeLibraryState)(async tx=>{
      const current=await captureHeader(tx);
      if(!sameOwner(current.owner,header.owner)||current.incarnation!==header.incarnation)throw Error('account_changed');
      if(current.localRevision!==header.localRevision||!equal(current.identity,header.identity)||!validatedCheckpoint(current.state)||current.state!.revision!==prior!.revision)throw Error('library_sync_local_changed');
      const completedAt=new Date().toISOString();tx.updateReplicaCandidate(update);
      tx.put('meta',STATE,{...current.state!,receive:update.receive,restoreOperationId:selected.id,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,revision:selected.head.revision,storage:selected.head.storage,status:'synced',syncedLocalRevision:header.localRevision+(update.contentChanged?1:0),pending:undefined,conflicts:undefined,conflict:undefined,resolution:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
     });
     return;
    }
   }catch(cause){if(!(cause instanceof Error)||cause.message!=='sqlite_replica_candidate_unavailable')throw cause;}
   finally{if(candidate)await requestReplicaCandidate({kind:'discard',id:candidate.id}).catch(()=>{});}
  }
  if(!prior?.pending&&!initiallyConflicted&&await readLibrary(canRestoreFreshLibrary)){
   observedHead??=parseSyncHead(await request('/head'));
   if(observedHead.manifest){
    const send=requestReplicaCandidate;
    let candidate:ReplicaCandidateValidation|undefined;
    try{
     const staged=await stageStableCandidate(blocks,request,observedHead,{owner:header.owner,incarnation:header.incarnation,identity:header.identity,localRevision:header.localRevision});
     observedHead=staged.head;candidate=staged.candidate;receiveEvidence=candidate?.receive;
     // A same-library identity fork still follows ordinary explicit conflict
     // handling; only a genuinely empty fresh Library may adopt another ID.
     const normalizedIdentity=normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:header.identity},header.identity).value;
     if(candidate&&(candidate.identity.id!==header.identity.id||candidate.records>1&&equal(candidate.identity,normalizedIdentity))){
      const selected=candidate;
      await restoreLibraryTransaction(async tx=>{
       const current=await captureHeader(tx);
       if(!sameOwner(current.owner,header.owner)||current.incarnation!==header.incarnation)throw Error('account_changed');
       if(current.localRevision!==header.localRevision||!equal(current.identity,header.identity))throw Error('library_sync_local_changed');
       const completedAt=new Date().toISOString();tx.restoreReplicaCandidate(selected);
       if(consumeReconnect)tx.delete('meta','local-reset');
       tx.put('meta',STATE,{...current.state!,receive:selected.receive,restoreOperationId:selected.id,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,revision:selected.head.revision,storage:selected.head.storage,status:'synced',syncedLocalRevision:header.localRevision+1,pending:undefined,conflicts:undefined,conflict:undefined,resolution:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
      });
      return;
     }
    }catch(cause){if(!(cause instanceof Error)||cause.message!=='sqlite_replica_candidate_unavailable')throw cause;}
    finally{if(candidate)await send({kind:'discard',id:candidate.id}).catch(()=>{});}
   }
  }
  let initial=await readLibrary(capture);
  if(observedHead&&initial.localRevision!==header.localRevision)throw new Error('library_sync_local_changed');
  // Pending publication survives a lost HTTP acknowledgement and is retried verbatim.
  let state=initial.state??defaults;
  if(state.pending){
   const p=state.pending;
   try{const result=parseSyncHead(await request('/commit',p));await verifyPublication(result,p);await saveState(expected,old=>({...old!,pending:undefined}));observedHead=undefined;}
   catch(e){if(rejectedPublication(e)){await saveState(expected,old=>({...old!,pending:undefined}));throw e;}if(!(e instanceof Error)||!['library_sync_conflict','library_sync_missing_block'].includes(e.message))throw e;await saveState(expected,old=>({...old!,pending:undefined}));observedHead=undefined;}

   initial=await readLibrary(capture);state=initial.state??defaults;
  }
  const confirmedRevision=!initiallyConflicted&&confirmedCheckpoint(initial.state)?initial.state!.revision:undefined;
  const stable=await downloadStableHead(blocks,request,initial.base,confirmedRevision,observedHead),head=stable.head,remote=stable.remote.filter(row=>isReplicatedLibraryEntry(row.table,row.key));
  // An identity-only browser and a null remote head are the authoritative empty
  // account. Confirm that state without publishing device bootstrap metadata.
  // The first learner-content write will still become pending and publish v6.
  if(head.manifest===null&&empty(initial.entries)&&!options.publishEmptyIdentity){
   await validateLibraryReplicaCooperatively(initial.entries);
   const completedAt=new Date().toISOString();
   await saveState(expected,old=>({...old!,checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,revision:head.revision,storage:head.storage,status:'synced',syncedLocalRevision:initial.localRevision,pending:undefined,conflicts:undefined,conflict:undefined,resolution:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined}),[],consumeReconnect);
   return;
  }
  let merged:Awaited<ReturnType<typeof mergeLibraryReplicasCooperatively>>;
  const remoteIdentity=remote.find(r=>r.table==='meta'&&r.key==='identity');
  if(remoteIdentity&&decodeBackupValue(remoteIdentity.value).id!==initial.identity.id){if(!empty(initial.entries))throw new Error('library_sync_identity');merged={entries:remote,conflicts:[]};}
  else merged=await mergeLibraryReplicasCooperatively({base:initial.base,local:initial.entries,remote});
  let localEntries=merged.entries,uploadEntries=merged.entries,activeConflicts=merged.conflicts;
  let nextBase=(published:Entry[])=>published;
  let conflict:CloudSyncConflict|undefined;
  if(merged.conflicts.length){
   const partition=partitionLibraryReplicaConflicts({base:initial.base,local:initial.entries,remote,merged:merged.entries,conflicts:merged.conflicts});
   conflict=await conflictSnapshot(initial.base,initial.entries,remote,merged.conflicts,partition.affectedRecordIds,head,initial.localRevision);
   if(state.resolution?.expectedRemoteRevision===head.revision&&state.resolution.expectedLocalRevision===initial.localRevision){localEntries=uploadEntries=finalizeLibraryReplicaConflictChoice(state.resolution.choice==='local'?partition.local:partition.upload,merged.entries,{base:initial.base,conflicts:merged.conflicts,local:initial.entries,remote,decision:state.resolution.decision});activeConflicts=[];conflict=undefined;}
   else{localEntries=partition.local;uploadEntries=partition.upload;nextBase=partition.base;}
  }
  // Cloud Checkpoints replicate the recoverable Package installation fact, not
  // the local Package/media cache. Validation must therefore use the same
  // cache-independent authority path on both the publishing and restoring
  // device; admitted Runtime bytes were already checked at local write time.
  let localRows:ValidatedLibraryReplica;
  try{
   localRows=await validateLibraryReplicaCooperatively(localEntries);
   if(!entriesEqual(localEntries,uploadEntries))await validateLibraryReplicaCooperatively(uploadEntries);
  }catch(error){
   if(activeConflicts.length){await saveState({...expected,localRevision:initial.localRevision},old=>({...old!,status:'conflict',conflicts:activeConflicts,conflict,resolution:undefined,error:'library_sync_conflict'}));return;}throw error;
  }
  // Different compression/chunking of the same remote facts is not a local edit
  // and must not manufacture another publication during a pure restore.
  const publicationRequired=!entriesEqual(uploadEntries,remote);
  let confirmedBase=nextBase(remote);
  const appliedLocalRevision=await applyEntries(initial,localEntries,localRows,{...state,revision:head.revision,storage:head.storage,status:'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict,resolution:activeConflicts.length?undefined:state.resolution,pending:undefined},confirmedBase,consumeReconnect);
  if(conflict)conflict={...conflict,localRevision:appliedLocalRevision};
  if(publicationRequired){
   const preparedEntries=await blocks.prepare(uploadEntries),remoteById=new Map(remote.map(row=>[entryId(row),row])),nextIds=new Set(preparedEntries.map(entryId));
   const changes=[...preparedEntries.filter(row=>!equal(row.value,remoteById.get(entryId(row))?.value)).map(row=>({table:row.table,key:row.key,blocks:row.blocks!})),...remote.filter(row=>!nextIds.has(entryId(row))).map(row=>({table:row.table,key:row.key,blocks:null}))];
   const prepared={entries:preparedEntries};
   const pending:LibrarySyncCommit=head.manifest?{operationId:crypto.randomUUID(),baseRevision:head.revision,patch:await blocks.patch(initial.identity,changes)}:{operationId:crypto.randomUUID(),baseRevision:head.revision,manifest:await blocks.packManifest(initial.identity,preparedEntries.map(row=>({table:row.table,key:row.key,blocks:row.blocks!})))};
   // Blocks are content-addressed and leased on upload. Persist only the compact
   // idempotent commit receipt after every referenced block is confirmed present.
   await blocks.upload();await saveState(expected,old=>({...old!,pending}));
   let published:LibrarySyncHead;
   try{published=parseSyncHead(await request('/commit',pending));}
   catch(error){if(error instanceof Error&&error.message==='library_sync_conflict'){await saveState(expected,old=>({...old!,pending:undefined}));throw new Error('library_sync_head_changed');}if(rejectedPublication(error))await saveState(expected,old=>({...old!,pending:undefined}));throw error;}
   await verifyPublication(published,pending);
   confirmedBase=nextBase(prepared.entries);
   // Publishing unrelated merged facts advances the head without changing the
   // remote conflict branch. Bind the displayed comparison to that confirmed
   // head so the next explicit choice is not spuriously rejected once.
   if(conflict)conflict={...conflict,remoteRevision:published.revision,remoteManifest:published.manifest};
   await saveState(expected,old=>({...old!,revision:published.revision,storage:published.storage??old!.storage,...(conflict?{conflict}:{}),pending:undefined,lastSyncedAt:new Date().toISOString()}),confirmedBase);
  }
  await writeLibraryState(async tx=>{
   const current=await captureHeader(tx);
   if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
   // The applied candidate and baseline were validated before commit. Only
   // metadata is needed to prove that no later local transaction changed it.
   const converged=current.localRevision===appliedLocalRevision&&entriesEqual(localEntries,confirmedBase),completedAt=new Date().toISOString();
   tx.put('meta',STATE,{...current.state!,receive:receiveEvidence??{mode:'complete',fallbackReason:'local_changes_or_unvalidated_checkpoint',changedRecords:remote.length,baselineBuildRecords:initial.base.length,baselineRecordsRead:initial.base.length,candidateRecordsRead:remote.length,targets:0,runs:0,events:0,decisions:0,scopes:0,sessions:0,scopeRuns:0},checkpointVersion:7,restoreValidationVersion:libraryRestoreValidationVersion,status:activeConflicts.length?'conflict':converged?'synced':'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict:activeConflicts.length?conflict:undefined,resolution:undefined,syncedLocalRevision:converged?current.localRevision:current.state!.syncedLocalRevision,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
  });
 }catch(error){const message=error instanceof Error?error.message:'library_sync_failed';
  await saveState(expected,old=>{const state=old??defaults;
   if(['meaning_conflict_history_invalid','library_sync_conflict_unsupported'].includes(message))return {...state,status:'conflict',resolution:undefined,syncStartedAt:undefined,error:'library_sync_conflict_unsupported',failureKind:undefined,retryCount:undefined,retryAt:undefined};
   if(message==='library_sync_local_changed')return {...state,status:'pending',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   if(['library_sync_conflict','library_sync_identity','library_sync_history','library_sync_tombstone_required','libraryBackup.errors.inconsistent'].includes(message))return {...state,status:'conflict',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   return {...state,...cloudSyncFailurePolicy(message,navigator.onLine,state.retryCount),syncStartedAt:undefined,error:message};
  }).catch(()=>{});
  throw error;
 }
}
