import {librarySyncManifest,librarySyncHead,librarySyncTables,librarySyncBlockFetchHashes,librarySyncBlockFetchResult,librarySyncBlockMissingResult,librarySyncBlockStore,librarySyncBlockStoreBatch,librarySyncBlockStoreChars,type LibrarySyncManifest,type LibrarySyncHead} from '@sensa/contracts/sensa';
import {readLibrary,readLocalLibraryRevision,restoreLibraryTransaction,writeLibraryState,assertCurrentLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import {backupEqual,encodeBackupValue,decodeBackupValue} from './backupCodec';
import {cloudSyncFailurePolicy,type CloudSyncFailureKind} from './cloudSyncPolicy';
import {
 isReplicatedLibraryEntry,
 mergeLibraryReplicas,
 normalizeLibraryReplicaEntry,
 partitionLibraryReplicaConflicts,
 finalizeLibraryReplicaConflictChoice,
 replicaEntriesEqual,
 replicaEntryId,
 assertLibraryReplicaDelete,
 type LibraryReplicaEntry,
} from './replication/libraryReplica';
import {applyLibraryReplicaMutation} from './replication/libraryReplicaApplication';
import {validateLibraryReplica,libraryReplicaValidationVersion} from './replication/libraryReplicaValidation';
export type SyncRequest=(path:string,body?:unknown)=>Promise<any>;
export type CloudSyncEntry=LibraryReplicaEntry;
type Entry=CloudSyncEntry;
type Owner={subject:string;accountId:string};
export type CloudSyncConflictChoice='local'|'remote';
export type CloudSyncConflict={detectedAt:string;remoteRevision:number;remoteManifest:string[]|null;records:{id:string;base:Entry|null;local:Entry|null;remote:Entry|null}[];affectedRecordIds:string[]};
export type CloudSyncState={owner:Owner;incarnation:string;revision:number;checkpointVersion?:6;validationVersion?:typeof libraryReplicaValidationVersion;storage?:LibrarySyncHead['storage'];syncedLocalRevision?:number;pending?:{operationId:string;baseRevision:number;manifest:string[]};status:'pending'|'syncing'|'synced'|'offline'|'conflict'|'failed';conflicts?:string[];conflict?:CloudSyncConflict;resolution?:{choice:CloudSyncConflictChoice;expectedRemoteRevision:number};lastSyncedAt?:string;lastCheckedAt?:string;syncStartedAt?:string;error?:string;failureKind?:CloudSyncFailureKind;retryCount?:number;retryAt?:string};
type State=CloudSyncState;
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
 const incarnation=await assertCurrentLibrary(tx),owner=await tx.get<Owner>('meta','service-owner'),identity=await tx.get<LibraryIdentity>('meta','identity');
 if(!owner?.accountId||!identity||await tx.get('meta','signed-out'))throw new Error('authentication_required');
 return {owner,incarnation,identity,state:await tx.get<State>('meta',STATE),localRevision:await readLocalLibraryRevision(tx)};
}
/** Only a complete, confirmed checkpoint may stand in for an unchanged head.
 * Conflict baselines may deliberately contain different branches. */
function confirmedCheckpoint(state:State|undefined){
 return state?.checkpointVersion===6&&Number.isSafeInteger(state.revision)&&state.revision>=0&&Number.isSafeInteger(state.syncedLocalRevision)&&(state.syncedLocalRevision??-1)>=0
  &&!state.pending&&state.status!=='conflict'&&!state.conflicts?.length&&!state.conflict&&!state.resolution;
}
const validatedCheckpoint=(state:State|undefined)=>confirmedCheckpoint(state)&&state!.validationVersion===libraryReplicaValidationVersion;

/** A validated remote baseline plus owner-admitted local transactions needs
 * only the changed bodies. The v6 manifest still carries all row references. */
async function captureDelta(tx:LibraryTransaction,expected:Awaited<ReturnType<typeof captureHeader>>,head:LibrarySyncHead){
 const current=await captureHeader(tx);
 if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
 if(current.localRevision!==expected.localRevision||!validatedCheckpoint(current.state)||current.state!.revision!==head.revision)throw new Error('library_sync_local_changed');
 if(current.localRevision===current.state!.syncedLocalRevision)return {...current,puts:[] as Entry[],deletes:[] as Array<Pick<Entry,'table'|'key'>>,references:[] as Array<{table:Entry['table'];key:string;blockRefs:string[]}>};
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
 if(!puts.length&&!deletes.length)return {...current,puts,deletes,references:[]};
 const references=(await tx.syncBaseReferences()).map(row=>{
  if(!isReplicatedLibraryEntry(row.table,row.key)||!row.blockRefs.length||row.blockRefs.some(ref=>!/^[a-f0-9]{64}$/u.test(ref)))throw new Error('library_sync_format');
  return {...row,table:row.table as Entry['table']};
 });
 if(!references.some(row=>row.table==='meta'&&row.key==='identity')&&!puts.some(row=>row.table==='meta'&&row.key==='identity')){
  if(head.manifest!==null)throw new Error('library_sync_format');
  const identity=normalizeLibraryReplicaEntry({table:'meta',key:'identity',value:current.identity},current.identity);
  puts.push({...identity,value:encodeBackupValue(identity.value)});
 }
 return {...current,puts,deletes,references};
}
async function capture(tx:LibraryTransaction){
 const {owner,incarnation,identity,state,localRevision}=await captureHeader(tx),entries:Entry[]=[];
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
 return {owner,incarnation,identity,entries,base,localRevision,state};
}
function sameOwner(a:Owner,b:Owner){return a.subject===b.subject&&a.accountId===b.accountId;}
function empty(entries:Entry[]){return entries.every(r=>r.table==='meta'&&r.key==='identity');}
function conflictSnapshot(base:Entry[],local:Entry[],remote:Entry[],conflicts:string[],affectedRecordIds:string[],head:LibrarySyncHead):CloudSyncConflict{
 const byId=(entries:Entry[])=>new Map(entries.map(entry=>[entryId(entry),entry]));const b=byId(base),l=byId(local),r=byId(remote);
 return {detectedAt:new Date().toISOString(),remoteRevision:head.revision,remoteManifest:head.manifest,records:conflicts.map(id=>({id,base:b.get(id)??null,local:l.get(id)??null,remote:r.get(id)??null})),affectedRecordIds};
}
async function pendingCloudSyncRecords(tx:LibraryTransaction,state:State|undefined,identity:LibraryIdentity){
 if(state?.syncedLocalRevision===undefined){
  const records:PendingCloudSyncRecord[]=[];
  for(const table of librarySyncTables)for(const row of await tx.entries(table)){
   if(isReplicatedLibraryEntry(table,row.key)&&!(table==='meta'&&row.key==='identity'))records.push({table,key:row.key});
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
export const readCloudSync=()=>readLibrary(async tx=>{const state=await tx.get<State>('meta',STATE);if(state?.status==='syncing'&&(!state.syncStartedAt||Date.now()-Date.parse(state.syncStartedAt)>120000))return {...state,status:'pending' as const,syncStartedAt:undefined};if(state?.status==='synced'&&!await tx.get('meta','signed-out')){const localRevision=await readLocalLibraryRevision(tx);if(localRevision!==state.syncedLocalRevision){const identity=await tx.get<LibraryIdentity>('meta','identity');if(!identity||await localDiffersFromBase(tx,state,identity))return {...state,status:'pending' as const};}}return state;});
export async function resolveCloudSyncConflicts(choice:CloudSyncConflictChoice){
 await writeLibraryState(async tx=>{await assertCurrentLibrary(tx);if(await tx.get('meta','signed-out'))throw new Error('authentication_required');const state=await tx.get<State>('meta',STATE);if(state?.status!=='conflict'||!state.conflict)throw new Error('library_sync_no_conflict');tx.put('meta',STATE,{...state,status:'pending',resolution:{choice,expectedRemoteRevision:state.conflict.remoteRevision},error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});});
}
async function saveState(expected:{owner:Owner;incarnation:string},work:(old:State|undefined)=>State,base?:Entry[]){
 await writeLibraryState(async tx=>{const owner=await tx.get<Owner>('meta','service-owner');if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');tx.put('meta',STATE,work(await tx.get<State>('meta',STATE)));if(base!==undefined)tx.replaceSyncBase(base);});
}
async function applyEntries(expected:Awaited<ReturnType<typeof capture>>,entries:Entry[],rows:ReturnType<typeof validateLibraryReplica>,state:State,base:Entry[]){
 const changesContent=!entriesEqual(expected.entries,entries);
 // One SQLite commit makes facts and their corresponding baseline visible
 // together. An unchanged candidate remains bookkeeping, not a learner edit.
 return (changesContent?restoreLibraryTransaction:writeLibraryState)(async tx=>{
  const current=await captureHeader(tx);
  if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
  if(current.localRevision!==expected.localRevision||!equal(current.identity,expected.identity))throw new Error('library_sync_local_changed');
  applyLibraryReplicaMutation({tx,current:expected.entries,desired:entries,records:rows.records,identity:current.identity});
  tx.put('meta',STATE,state);tx.replaceSyncBase(base);
  return current.localRevision+(changesContent?1:0);
 });
}
class Blocks{
 cache=new Map<string,string>();
 private held=0;
 constructor(private request:SyncRequest){}
 private remember(id:string,data:string){if(this.cache.has(id))return;this.held+=new TextEncoder().encode(data).length;if(this.held>TRANSFER_CAP)throw new Error('library_sync_capacity');this.cache.set(id,data);}
 private forget(id:string){const data=this.cache.get(id);if(data!==undefined){this.held-=new TextEncoder().encode(data).length;this.cache.delete(id);}}
 private async packSegment(segment:string,refs:string[]){const {splitLibrarySyncText,encodeLibrarySyncBlock}=await blockCodec();for(const part of splitLibrarySyncText(segment)){const data=encodeLibrarySyncBlock(part),id=await hash(data);this.remember(id,data);refs.push(id);}}
 async pack(text:string){const refs:string[]=[];let at=0;const media=/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;for(const match of text.matchAll(media)){const start=match.index??0;await this.packSegment(text.slice(at,start),refs);await this.packSegment(match[0],refs);at=start+match[0].length;}await this.packSegment(text.slice(at),refs);return refs;}
 /** One request per byte-budgeted page: the cost of a restore follows library size,
  *  not how many blocks an older client happened to split it into. */
 async fetch(ids:string[]){
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
   for(const block of reply.blocks){if(await hash(block.data)!==block.hash)throw new Error('library_sync_hash');this.remember(block.hash,block.data);}
   if(!reply.blocks.length&&reply.deferred.length)throw new Error('library_sync_format');
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
   const blocks:{hash:string;data:string}[]=[];let chars=0;
   while(at<missing.length&&blocks.length<librarySyncBlockStoreBatch){const data=this.cache.get(missing[at])!;if(blocks.length&&chars+data.length>librarySyncBlockStoreChars)break;blocks.push({hash:missing[at],data});chars+=data.length;at++;}
   librarySyncBlockStore.parse({blocks});await this.request('/blocks/store',{blocks});
  }
 }
 async prepare(entries:Entry[]){
  const {librarySyncRecordSegments}=await blockCodec(),prepared:Entry[]=[];let decodedSize=0;
  for(const r of entries){let refs=r.blocks;if(!refs?.length){refs=[];for(const segment of librarySyncRecordSegments(r.value)){decodedSize+=new TextEncoder().encode(segment).length;if(decodedSize>DECODED_CAP)throw new Error('library_sync_capacity');refs.push(...await this.pack(segment));}}prepared.push({...r,blocks:[...refs]});}
  return prepared;
 }
 async packManifest(identity:LibraryIdentity,rows:LibrarySyncManifest['rows']){
  return this.pack(JSON.stringify(librarySyncManifest.parse({version:6,libraryId:identity.id,learnerId:identity.learnerId,rows})));
 }
 async manifest(entries:Entry[]){
  const identity=decodeBackupValue(entries.find(r=>r.table==='meta'&&r.key==='identity')!.value),prepared=await this.prepare(entries);
  return {manifest:await this.packManifest(identity,prepared.map(r=>({table:r.table,key:r.key,blocks:r.blocks!}))),entries:prepared};
 }
 async download(head:LibrarySyncHead,base:Entry[]=[]){
  if(!head.manifest)return [];
  await this.fetch(head.manifest);
  let raw:unknown;try{raw=JSON.parse(await this.text(head.manifest));}catch{throw new Error('library_sync_format');}
  if(!raw||typeof raw!=='object'||!('version' in raw)||(raw as {version?:unknown}).version!==6)throw new Error('library_sync_incompatible_checkpoint');
  const parsed=librarySyncManifest.safeParse(raw);if(!parsed.success)throw new Error('library_sync_format');const manifest=parsed.data;
  const checkpointRows=manifest.rows;
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
  entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));const {identity}=validateLibraryReplica(entries);if(identity.id!==manifest.libraryId||identity.learnerId!==manifest.learnerId)throw new Error('library_sync_identity');return entries;
 }
}
async function downloadStableHead(blocks:Blocks,request:SyncRequest,base:Entry[],confirmedRevision?:number,observedHead?:LibrarySyncHead){
 let head=observedHead??librarySyncHead.parse(await request('/head'));
 // A confirmed baseline is already the complete body of this remote revision.
 // Reuse it without fetching even the manifest; conflicts deliberately keep a
 // mixed baseline and therefore never provide a confirmed revision here.
 if(confirmedRevision===head.revision)return {head,remote:base};
 for(let attempt=0;attempt<3;attempt++){
  try{return {head,remote:await blocks.download(head,base)};}
  catch(error){
   if(!(error instanceof Error)||error.message!=='library_sync_missing_block')throw error;
   const latest=librarySyncHead.parse(await request('/head'));
   if(latest.revision===head.revision&&equal(latest.manifest,head.manifest))throw error;
   if(attempt===2)throw new Error('library_sync_head_changed');
   head=latest;
  }
 }
 throw new Error('library_sync_head_changed');
}
/** Injected transport permits offline/idempotency/restore tests without real accounts. */
export async function synchronizeLibrary(request:SyncRequest,options:{publishEmptyIdentity?:boolean}={}){
 const header=await readLibrary(captureHeader),expected={owner:header.owner,incarnation:header.incarnation};
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
  await saveState(expected,old=>({...old??defaults,status:'syncing',syncStartedAt:new Date().toISOString(),error:undefined}));
  let observedHead:LibrarySyncHead|undefined;
  if(validatedCheckpoint(prior)&&prior!.syncedLocalRevision!<=header.localRevision){
   observedHead=librarySyncHead.parse(await request('/head'));
   if(observedHead.revision===prior!.revision&&!(observedHead.manifest===null&&options.publishEmptyIdentity)){
    const delta=await readLibrary(tx=>captureDelta(tx,header,observedHead!));
    if(delta.puts.length||delta.deletes.length){
     const prepared=await blocks.prepare(delta.puts),rows=new Map(delta.references.map(row=>[entryId(row),{table:row.table,key:row.key,blocks:row.blockRefs}]));
     for(const row of delta.deletes)rows.delete(entryId(row));
     for(const row of prepared)rows.set(entryId(row),{table:row.table,key:row.key,blocks:row.blocks!});
     const manifest=await blocks.packManifest(delta.identity,[...rows.values()].sort((a,b)=>entryId(a).localeCompare(entryId(b))));
     const pending={operationId:crypto.randomUUID(),baseRevision:observedHead.revision,manifest};
     await blocks.upload();
     await saveState(expected,old=>{
      if(!validatedCheckpoint(old)||old!.revision!==pending.baseRevision)throw new Error('library_sync_local_changed');
      return {...old!,status:'pending',pending};
     });
     let published:LibrarySyncHead;
     try{published=librarySyncHead.parse(await request('/commit',pending));}
     catch(cause){
      if(cause instanceof Error&&cause.message==='library_sync_conflict'){await saveState(expected,old=>({...old!,pending:undefined}));throw new Error('library_sync_head_changed');}
      if(rejectedPublication(cause))await saveState(expected,old=>({...old!,pending:undefined}));
      throw cause;
     }
     if(published.revision<=pending.baseRevision||!equal(published.manifest,pending.manifest))throw new Error('library_sync_format');
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
  let initial=await readLibrary(capture);
  if(observedHead&&initial.localRevision!==header.localRevision)throw new Error('library_sync_local_changed');
  // Pending publication survives a lost HTTP acknowledgement and is retried verbatim.
  let state=initial.state??defaults;
  if(state.pending){
   const p=state.pending;
   try{const head=librarySyncHead.parse(await request('/commit',{operationId:p.operationId,baseRevision:p.baseRevision,manifest:p.manifest}));const confirmed=await blocks.download(head,initial.base);await saveState(expected,old=>({...old!,revision:head.revision,storage:head.storage??old!.storage,pending:undefined}),confirmed);}
   catch(e){if(rejectedPublication(e)){await saveState(expected,old=>({...old!,pending:undefined}));throw e;}if(!(e instanceof Error)||!['library_sync_conflict','library_sync_missing_block'].includes(e.message))throw e;await saveState(expected,old=>({...old!,pending:undefined}));}
   initial=await readLibrary(capture);state=initial.state??defaults;
  }
  const confirmedRevision=!initiallyConflicted&&confirmedCheckpoint(initial.state)?initial.state!.revision:undefined;
  const stable=await downloadStableHead(blocks,request,initial.base,confirmedRevision,observedHead),head=stable.head,remote=stable.remote.filter(row=>isReplicatedLibraryEntry(row.table,row.key));
  // An identity-only browser and a null remote head are the authoritative empty
  // account. Confirm that state without publishing device bootstrap metadata.
  // The first learner-content write will still become pending and publish v6.
  if(head.manifest===null&&empty(initial.entries)&&!options.publishEmptyIdentity){
   validateLibraryReplica(initial.entries);
   const completedAt=new Date().toISOString();
   await saveState(expected,old=>({...old!,checkpointVersion:6,validationVersion:libraryReplicaValidationVersion,revision:head.revision,storage:head.storage,status:'synced',syncedLocalRevision:initial.localRevision,pending:undefined,conflicts:undefined,conflict:undefined,resolution:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined}),[]);
   return;
  }
  let merged:ReturnType<typeof mergeLibraryReplicas>;
  const remoteIdentity=remote.find(r=>r.table==='meta'&&r.key==='identity');
  if(remoteIdentity&&decodeBackupValue(remoteIdentity.value).id!==initial.identity.id){if(!empty(initial.entries))throw new Error('library_sync_identity');merged={entries:remote,conflicts:[]};}
  else merged=mergeLibraryReplicas({base:initial.base,local:initial.entries,remote});
  let localEntries=merged.entries,uploadEntries=merged.entries,activeConflicts=merged.conflicts;
  let nextBase=(published:Entry[])=>published;
  let conflict:CloudSyncConflict|undefined;
  if(merged.conflicts.length){
   const partition=partitionLibraryReplicaConflicts({base:initial.base,local:initial.entries,remote,merged:merged.entries,conflicts:merged.conflicts});
   conflict=conflictSnapshot(initial.base,initial.entries,remote,merged.conflicts,partition.affectedRecordIds,head);
   if(state.resolution?.expectedRemoteRevision===head.revision){localEntries=uploadEntries=finalizeLibraryReplicaConflictChoice(state.resolution.choice==='local'?partition.local:partition.upload,merged.entries,{base:initial.base,conflicts:merged.conflicts});activeConflicts=[];conflict=undefined;}
   else{localEntries=partition.local;uploadEntries=partition.upload;nextBase=partition.base;}
  }
  // Cloud Checkpoints replicate the recoverable Package installation fact, not
  // the local Package/media cache. Validation must therefore use the same
  // cache-independent authority path on both the publishing and restoring
  // device; admitted Runtime bytes were already checked at local write time.
  let localRows:ReturnType<typeof validateLibraryReplica>;
  try{
   localRows=validateLibraryReplica(localEntries);
   if(!entriesEqual(localEntries,uploadEntries))validateLibraryReplica(uploadEntries);
  }catch(error){
   if(activeConflicts.length){await saveState(expected,old=>({...old!,status:'conflict',conflicts:activeConflicts,conflict,resolution:undefined,error:'library_sync_conflict'}));return;}throw error;
  }
  // Different compression/chunking of the same remote facts is not a local edit
  // and must not manufacture another publication during a pure restore.
  const publicationRequired=!entriesEqual(uploadEntries,remote);
  let confirmedBase=nextBase(remote);
  const appliedLocalRevision=await applyEntries(initial,localEntries,localRows,{...state,revision:head.revision,storage:head.storage,status:'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict,resolution:activeConflicts.length?undefined:state.resolution,pending:undefined},confirmedBase);
  if(publicationRequired){
   // Only changed facts need a newly encoded manifest. Confirmed row references
   // remain reusable even when the server repacked its immutable transport.
   const prepared=await blocks.manifest(uploadEntries),manifest=prepared.manifest;
   const pending={operationId:crypto.randomUUID(),baseRevision:head.revision,manifest};
   // Blocks are content-addressed and leased on upload. Persist only the compact
   // idempotent commit receipt after every referenced block is confirmed present.
   await blocks.upload();await saveState(expected,old=>({...old!,pending}));
   let published:LibrarySyncHead;
   try{published=librarySyncHead.parse(await request('/commit',{operationId:pending.operationId,baseRevision:pending.baseRevision,manifest}));}
   catch(error){if(error instanceof Error&&error.message==='library_sync_conflict'){await saveState(expected,old=>({...old!,pending:undefined}));throw new Error('library_sync_head_changed');}if(rejectedPublication(error))await saveState(expected,old=>({...old!,pending:undefined}));throw error;}
   if(published.revision<=pending.baseRevision||!equal(published.manifest,pending.manifest))throw new Error('library_sync_format');
   confirmedBase=nextBase(prepared.entries);
   await saveState(expected,old=>({...old!,revision:published.revision,storage:published.storage??old!.storage,pending:undefined,lastSyncedAt:new Date().toISOString()}),confirmedBase);
  }
  await writeLibraryState(async tx=>{
   const current=await captureHeader(tx);
   if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
   // The applied candidate and baseline were validated before commit. Only
   // metadata is needed to prove that no later local transaction changed it.
   const converged=current.localRevision===appliedLocalRevision&&entriesEqual(localEntries,confirmedBase),completedAt=new Date().toISOString();
   tx.put('meta',STATE,{...current.state!,checkpointVersion:6,validationVersion:libraryReplicaValidationVersion,status:activeConflicts.length?'conflict':converged?'synced':'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict:activeConflicts.length?conflict:undefined,resolution:undefined,syncedLocalRevision:converged?current.localRevision:current.state!.syncedLocalRevision,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});
  });
 }catch(error){const message=error instanceof Error?error.message:'library_sync_failed';
  await saveState(expected,old=>{const state=old??defaults;
   if(message==='library_sync_local_changed')return {...state,status:'pending',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   if(['library_sync_conflict','library_sync_identity','library_sync_history','library_sync_tombstone_required','libraryBackup.errors.inconsistent'].includes(message))return {...state,status:'conflict',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   return {...state,...cloudSyncFailurePolicy(message,navigator.onLine,state.retryCount),syncStartedAt:undefined,error:message};
  }).catch(()=>{});
  throw error;
 }
}
