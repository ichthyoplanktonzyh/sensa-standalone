import {canonicalConsumerJson,librarySyncManifest,librarySyncHead,librarySyncTables,librarySyncBlockChars,librarySyncBlockFetchHashes,librarySyncBlockFetchResult,librarySyncBlockMissingResult,librarySyncBlockStore,librarySyncBlockStoreBatch,librarySyncBlockStoreChars,type LibrarySyncManifest,type LibrarySyncHead} from '@sensa/contracts/sensa';
import {libraryTables,readLibrary,readLocalLibraryRevision,restoreLibraryTransaction,writeLibraryState,assertCurrentLibrary,type LibraryTransaction,type Table,type LibraryIdentity} from './store';
import {backupEqual,encodeBackupValue,decodeBackupValue} from './backupCodec';
import {validateBackupRows,type BackupRows} from './backupValidation';
import {cloudSyncFailurePolicy,type CloudSyncFailureKind} from './cloudSyncPolicy';
export type SyncRequest=(path:string,body?:unknown)=>Promise<any>;
export type CloudSyncEntry={table:typeof librarySyncTables[number];key:string;value:unknown};
type Entry=CloudSyncEntry;
type Owner={subject:string;accountId:string};
export type CloudSyncConflictChoice='local'|'remote';
export type CloudSyncConflict={detectedAt:string;remoteRevision:number;remoteManifest:string[]|null;records:{id:string;base:Entry|null;local:Entry|null;remote:Entry|null}[];affectedRecordIds:string[]};
export type CloudSyncState={owner:Owner;incarnation:string;base:Entry[];revision:number;storage?:LibrarySyncHead['storage'];syncedLocalRevision?:number;pending?:{operationId:string;baseRevision:number;manifest:string[];entries:Entry[];baseEntries?:Entry[]};status:'pending'|'syncing'|'synced'|'offline'|'conflict'|'failed';conflicts?:string[];conflict?:CloudSyncConflict;resolution?:{choice:CloudSyncConflictChoice;expectedRemoteRevision:number};lastSyncedAt?:string;lastCheckedAt?:string;syncStartedAt?:string;error?:string;failureKind?:CloudSyncFailureKind;retryCount?:number;retryAt?:string};
type State=CloudSyncState;
const STATE='cloud-sync';
const LIBRARY_CREATE_OPERATION='00000000-0000-4000-8000-000000000001';
const entryId=(r:Pick<Entry,'table'|'key'>)=>JSON.stringify([r.table,r.key]);
const equal=backupEqual;
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
/** A restore holds block text in memory before assembling rows; keep that bounded. */
const TRANSFER_CAP=96*1024*1024;
// The package catalog is a short-lived service cache. Synchronizing it lets a
// stale descriptor from another browser replace the catalog this device just
// fetched, so keep it local in the same way as provider credentials.
const allowed=(table:Entry['table'],key:string)=>(table!=='meta'||['identity','learning-active'].includes(key))&&(table!=='settings'||key!=='providers');
function normalized(table:Entry['table'],key:string,raw:any,identity:LibraryIdentity){
 const value=structuredClone(raw);
 // Library identity is shared; a browser installation keeps its own device identity.
 if(table==='meta'&&key==='identity')value.deviceId=identity.id;
 // Process leases cannot be resumed in another browser. Do not transport live ownership.
 if(table==='sessions'&&value.status==='inflight'){value.status='stopped';value.lease=null;}
 if(table==='personalLearning'&&['generating','reviewing'].includes(value.status)){value.status='failed';value.leaseUntil=0;value.notice='localFlow.restoredPreparation';}
 if(table==='contentAttempts'&&['generating','reviewing'].includes(value.status))value.status='failed';
 return value;
}
async function capture(tx:LibraryTransaction){
 const incarnation=await assertCurrentLibrary(tx),owner=await tx.get<Owner>('meta','service-owner'),identity=await tx.get<LibraryIdentity>('meta','identity');
 if(!owner?.accountId||!identity||await tx.get('meta','signed-out'))throw new Error('authentication_required');
 const entries:Entry[]=[];
 // Iterate the checkpoint contract, not every SQLite table. The device operation
 // ledger can be large and must not even be read or hashed by account sync.
 for(const table of librarySyncTables)for(const row of await tx.entries(table)){
  if(typeof row.key!=='string')throw new Error('library_sync_format');
  if(allowed(table,row.key))entries.push({table,key:row.key,value:encodeBackupValue(normalized(table,row.key,row.value,identity))});
 }
 entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));
 return {owner,incarnation,identity,entries,localRevision:await readLocalLibraryRevision(tx),state:await tx.get<State>('meta',STATE)};
}
function rowsFor(entries:Entry[]):BackupRows{
 const rows=Object.fromEntries(libraryTables.map(t=>[t,[]])) as unknown as BackupRows;
 for(const row of entries)rows[row.table].push({key:row.key,value:decodeBackupValue(row.value)});
 validateBackupRows(rows);return rows;
}
function sameOwner(a:Owner,b:Owner){return a.subject===b.subject&&a.accountId===b.accountId;}
function empty(entries:Entry[]){return entries.every(r=>r.table==='meta'&&r.key==='identity');}
/** Three-way record merge. Conflicting records stay local; no time-based winner. */
export function mergeLibraryEntries(base:Entry[],local:Entry[],remote:Entry[]){
 const b=new Map(base.map(r=>[entryId(r),r])),l=new Map(local.map(r=>[entryId(r),r])),r=new Map(remote.map(r=>[entryId(r),r]));const conflicts:string[]=[],entries:Entry[]=[];
 for(const key of new Set([...b.keys(),...l.keys(),...r.keys()])){
  const prior=b.get(key),ours=l.get(key),theirs=r.get(key);let chosen=ours;
  if(equal(ours,prior))chosen=theirs;
  else if(!equal(theirs,prior)&&!equal(ours,theirs))conflicts.push(key);
  if(chosen)entries.push(chosen);
 }
 entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));return {entries,conflicts};
}
/** Keep a conflict and every referencing record together; independent components may still sync. */
function partitionConflicts(base:Entry[],local:Entry[],remote:Entry[],merged:Entry[],conflicts:string[]){
 const all=[...base,...local,...remote],idsByKey=new Map<string,Set<string>>(),edges=new Map<string,Set<string>>();
 for(const row of all){const id=entryId(row);const ids=idsByKey.get(row.key)??new Set<string>();ids.add(id);idsByKey.set(row.key,ids);edges.set(id,edges.get(id)??new Set());}
 const connect=(a:string,b:string)=>{if(a===b)return;edges.get(a)!.add(b);edges.get(b)!.add(a);};
 for(const row of all){const id=entryId(row);const visit=(value:any,depth=0):void=>{if(depth>80)return;
  if(typeof value==='string'){for(const other of idsByKey.get(value)??[])connect(id,other);if(value.startsWith('{')){try{visit(JSON.parse(value),depth+1);}catch{/* Ordinary text. */}}}
  else if(Array.isArray(value))value.forEach(v=>visit(v,depth+1));else if(value&&typeof value==='object')Object.values(value).forEach(v=>visit(v,depth+1));
 };visit(decodeBackupValue(row.value));}
 const blocked=new Set(conflicts),queue=[...blocked];for(let at=0;at<queue.length;at++)for(const next of edges.get(queue[at])??[])if(!blocked.has(next)){blocked.add(next);queue.push(next);}
 const select=(unblocked:Entry[],held:Entry[])=>[...unblocked.filter(r=>!blocked.has(entryId(r))),...held.filter(r=>blocked.has(entryId(r)))].sort((a,b)=>entryId(a).localeCompare(entryId(b)));
 return {local:select(merged,local),upload:select(merged,remote),base:(published:Entry[])=>select(published,base),affectedRecordIds:[...blocked].sort()};
}
function conflictSnapshot(base:Entry[],local:Entry[],remote:Entry[],conflicts:string[],affectedRecordIds:string[],head:LibrarySyncHead):CloudSyncConflict{
 const byId=(entries:Entry[])=>new Map(entries.map(entry=>[entryId(entry),entry]));const b=byId(base),l=byId(local),r=byId(remote);
 return {detectedAt:new Date().toISOString(),remoteRevision:head.revision,remoteManifest:head.manifest,records:conflicts.map(id=>({id,base:b.get(id)??null,local:l.get(id)??null,remote:r.get(id)??null})),affectedRecordIds};
}
export const readCloudSync=()=>readLibrary(async tx=>{const state=await tx.get<State>('meta',STATE);if(state?.status==='syncing'&&(!state.syncStartedAt||Date.now()-Date.parse(state.syncStartedAt)>120000))return {...state,status:'pending' as const,syncStartedAt:undefined};if(state?.status==='synced'&&!await tx.get('meta','signed-out')){const localRevision=await readLocalLibraryRevision(tx);if(localRevision!==state.syncedLocalRevision){const current=await capture(tx);if(!equal(current.entries,state.base))return {...state,status:'pending' as const};}}return state;});
export async function resolveCloudSyncConflicts(choice:CloudSyncConflictChoice){
 await writeLibraryState(async tx=>{await assertCurrentLibrary(tx);if(await tx.get('meta','signed-out'))throw new Error('authentication_required');const state=await tx.get<State>('meta',STATE);if(state?.status!=='conflict'||!state.conflict)throw new Error('library_sync_no_conflict');tx.put('meta',STATE,{...state,status:'pending',resolution:{choice,expectedRemoteRevision:state.conflict.remoteRevision},error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined});});
}
async function saveState(expected:{owner:Owner;incarnation:string},work:(old:State|undefined)=>State){
 await writeLibraryState(async tx=>{const owner=await tx.get<Owner>('meta','service-owner');if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');tx.put('meta',STATE,work(await tx.get<State>('meta',STATE)));});
}
async function applyEntries(expected:Awaited<ReturnType<typeof capture>>,entries:Entry[],state:State){
 const rows=rowsFor(entries);
 await restoreLibraryTransaction(async tx=>{
  const current=await capture(tx);if(!sameOwner(current.owner,expected.owner)||current.incarnation!==expected.incarnation)throw new Error('account_changed');
  if(!equal(current.entries,expected.entries))throw new Error('library_sync_local_changed');
  const next=new Map(entries.map(r=>[entryId(r),r]));
  for(const row of current.entries)if(!next.has(entryId(row)))tx.delete(row.table,row.key);
  const before=new Map(current.entries.map(r=>[entryId(r),r]));
  let restoredIdentity:LibraryIdentity|undefined;
  for(const row of entries){if(equal(before.get(entryId(row)),row))continue;let value=rows[row.table].find(r=>r.key===row.key)!.value;
   if(row.table==='meta'&&row.key==='identity'){value={...value,deviceId:current.identity.deviceId};restoredIdentity=value;}
   tx.put(row.table,row.key,value);
  }
  // openLibrary uses one device-local idempotency record. When an empty device
  // adopts an account library identity, keep that local record aligned without
  // transporting the source device's ledger.
  if(restoredIdentity)tx.put('operations',LIBRARY_CREATE_OPERATION,{input:canonicalConsumerJson({kind:'library.create',input:{}}),result:restoredIdentity,committedAt:restoredIdentity.createdAt});
 });
 // The baseline and progress are sync bookkeeping, not learner content. Writing them in
 // a content transaction would announce a local edit and schedule another sync pass.
 await writeLibraryState(async tx=>{const owner=await tx.get<Owner>('meta','service-owner');if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');tx.put('meta',STATE,state);});
}
class Blocks{
 cache=new Map<string,string>();
 constructor(private request:SyncRequest){}
 private async packSegment(segment:string,refs:string[]){for(let at=0;at<segment.length;at+=librarySyncBlockChars){const part=segment.slice(at,at+librarySyncBlockChars),id=await hash(part);this.cache.set(id,part);refs.push(id);}}
 async pack(text:string){const refs:string[]=[];let at=0;const media=/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;for(const match of text.matchAll(media)){const start=match.index??0;await this.packSegment(text.slice(at,start),refs);await this.packSegment(match[0],refs);at=start+match[0].length;}await this.packSegment(text.slice(at),refs);return refs;}
 /** One request per byte-budgeted page: the cost of a restore follows library size,
  *  not how many blocks an older client happened to split it into. */
 async fetch(ids:string[]){
  const pending=[...new Set(ids)].filter(id=>!this.cache.has(id));
  let held=[...this.cache.values()].reduce((size,value)=>size+value.length,0),rounds=0,pageSize=librarySyncBlockFetchHashes;
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
   if(reply.missing.length)throw new Error('library_sync_missing_block');
   for(const block of reply.blocks){if(await hash(block.data)!==block.hash)throw new Error('library_sync_hash');held+=block.data.length;if(held>TRANSFER_CAP)throw new Error('library_sync_capacity');this.cache.set(block.hash,block.data);}
   if(!reply.blocks.length&&reply.deferred.length)throw new Error('library_sync_format');
   at+=page.length;
   // The response is bounded by bytes, so anything it could not carry is re-queued.
   for(const id of reply.deferred)if(!this.cache.has(id))pending.push(id);
  }
  for(const id of ids)if(!this.cache.has(id))throw new Error('library_sync_missing_block');
 }
 async text(refs:string[]){let text='';for(const id of refs){const data=this.cache.get(id);if(data===undefined)throw new Error('library_sync_missing_block');text+=data;if(text.length>90*1024*1024)throw new Error('library_sync_capacity');}return text;}
 async upload(){
  const keys=[...this.cache.keys()],missing:string[]=[];
  for(let at=0;at<keys.length;at+=512){const reply=librarySyncBlockMissingResult.parse(await this.request('/blocks/missing',{hashes:keys.slice(at,at+512)}));if(reply.missing.some(id=>!this.cache.has(id)))throw new Error('library_sync_format');missing.push(...reply.missing);}
  for(let at=0;at<missing.length;){
   const blocks:{hash:string;data:string}[]=[];let chars=0;
   while(at<missing.length&&blocks.length<librarySyncBlockStoreBatch){const data=this.cache.get(missing[at])!;if(blocks.length&&chars+data.length>librarySyncBlockStoreChars)break;blocks.push({hash:missing[at],data});chars+=data.length;at++;}
   librarySyncBlockStore.parse({blocks});await this.request('/blocks/store',{blocks});
  }
 }
 async manifest(entries:Entry[]){const identity=decodeBackupValue(entries.find(r=>r.table==='meta'&&r.key==='identity')!.value);const rows:LibrarySyncManifest['rows']=[];let size=0;for(const r of entries){const text=JSON.stringify(r.value);size+=text.length;if(size>64*1024*1024)throw new Error('library_sync_capacity');rows.push({table:r.table,key:r.key,blocks:await this.pack(text)});}return this.pack(JSON.stringify(librarySyncManifest.parse({version:3,libraryId:identity.id,learnerId:identity.learnerId,rows})));}
 async download(head:LibrarySyncHead){
  if(!head.manifest)return [];
  await this.fetch(head.manifest);
  let raw:unknown;try{raw=JSON.parse(await this.text(head.manifest));}catch{throw new Error('library_sync_format');}
  if(!raw||typeof raw!=='object'||!('version' in raw)||(raw as {version?:unknown}).version!==3)throw new Error('library_sync_incompatible_checkpoint');
  const parsed=librarySyncManifest.safeParse(raw);if(!parsed.success)throw new Error('library_sync_format');const manifest=parsed.data;
  const checkpointRows=manifest.rows;
  // Fetch every referenced block once, in pages, before assembling any row.
  await this.fetch(checkpointRows.flatMap(row=>row.blocks));
  const entries:Entry[]=[];let size=0;
  for(const row of checkpointRows){const text=await this.text(row.blocks);size+=text.length;if(size>64*1024*1024)throw new Error('library_sync_capacity');entries.push({table:row.table as Entry['table'],key:row.key,value:JSON.parse(text)});}
  entries.sort((a,b)=>entryId(a).localeCompare(entryId(b)));const rows=rowsFor(entries),identity=rows.meta.find(r=>r.key==='identity')!.value;if(identity.id!==manifest.libraryId||identity.learnerId!==manifest.learnerId)throw new Error('library_sync_identity');return entries;
 }
}
async function downloadStableHead(blocks:Blocks,request:SyncRequest){
 let head=librarySyncHead.parse(await request('/head'));
 for(let attempt=0;attempt<3;attempt++){
  try{return {head,remote:await blocks.download(head)};}
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
export async function synchronizeLibrary(request:SyncRequest){
 let initial=await readLibrary(capture);const expected={owner:initial.owner,incarnation:initial.incarnation};
 const prior=initial.state;
 if(prior&&(!sameOwner(prior.owner,initial.owner)||prior.incarnation!==initial.incarnation))throw new Error('account_changed');
 const defaults:State={...expected,base:[],revision:0,status:'pending'};
 const transport=request;
 request=async(path,body)=>{
  await readLibrary(async tx=>{const owner=await tx.get<Owner>('meta','service-owner');if(!owner||!sameOwner(owner,expected.owner)||await tx.get('meta','signed-out')||(await assertCurrentLibrary(tx))!==expected.incarnation)throw new Error('account_changed');});
  return transport(path,body);
 };
 const blocks=new Blocks(request);
 try{
  await saveState(expected,old=>({...old??defaults,status:'syncing',syncStartedAt:new Date().toISOString(),error:undefined}));
  // Pending publication survives a lost HTTP acknowledgement and is retried verbatim.
  let state=await readCloudSync()??defaults;
  if(state.pending){
   const p=state.pending;await blocks.manifest(p.entries);await blocks.upload();
   try{const head=librarySyncHead.parse(await request('/commit',{operationId:p.operationId,baseRevision:p.baseRevision,manifest:p.manifest}));await saveState(expected,old=>({...old!,base:p.baseEntries??p.entries,revision:head.revision,storage:head.storage??old!.storage,pending:undefined}));}
   catch(e){if(!(e instanceof Error)||e.message!=='library_sync_conflict')throw e;await saveState(expected,old=>({...old!,pending:undefined}));}
  }
  initial=await readLibrary(capture);state=initial.state??defaults;
  // Populate cache with local and last-confirmed data: unchanged resources are not downloaded again.
  await blocks.manifest(initial.entries);if(state.base.length)await blocks.manifest(state.base);
  const stable=await downloadStableHead(blocks,request),head=stable.head,remote=stable.remote.filter(row=>allowed(row.table,row.key));
  // An identity-only browser and a null remote head are the authoritative empty
  // account. Confirm that state without publishing device bootstrap metadata.
  // The first learner-content write will still become pending and publish v3.
  if(head.manifest===null&&empty(initial.entries)){
   const completedAt=new Date().toISOString();
   await saveState(expected,old=>({...old!,base:[],revision:head.revision,storage:head.storage,status:'synced',syncedLocalRevision:initial.localRevision,pending:undefined,conflicts:undefined,conflict:undefined,resolution:undefined,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined}));
   return;
  }
  let merged:ReturnType<typeof mergeLibraryEntries>;
  const remoteIdentity=remote.find(r=>r.table==='meta'&&r.key==='identity');
  if(remoteIdentity&&decodeBackupValue(remoteIdentity.value).id!==initial.identity.id){if(!empty(initial.entries))throw new Error('library_sync_identity');merged={entries:remote,conflicts:[]};}
  else merged=mergeLibraryEntries(state.base,initial.entries,remote);
  let localEntries=merged.entries,uploadEntries=merged.entries,activeConflicts=merged.conflicts;
  let nextBase=(published:Entry[])=>published;
  let conflict:CloudSyncConflict|undefined;
  if(merged.conflicts.length){
   const partition=partitionConflicts(state.base,initial.entries,remote,merged.entries,merged.conflicts);
   conflict=conflictSnapshot(state.base,initial.entries,remote,merged.conflicts,partition.affectedRecordIds,head);
   if(state.resolution?.expectedRemoteRevision===head.revision){localEntries=uploadEntries=state.resolution.choice==='local'?partition.local:partition.upload;activeConflicts=[];conflict=undefined;}
   else{localEntries=partition.local;uploadEntries=partition.upload;nextBase=partition.base;}
  }
  // Validate both dependency graphs, including original runtime replay, before publishing or applying.
  try{rowsFor(localEntries);rowsFor(uploadEntries);}catch(error){
   if(activeConflicts.length){await saveState(expected,old=>({...old!,status:'conflict',conflicts:activeConflicts,conflict,resolution:undefined,error:'library_sync_conflict'}));return;}throw error;
  }
  // Content equality is not enough: the same rows may have been repacked into a
  // different block layout after a lost publication attempt. Canonicalize it once
  // so later focus/reload syncs can reuse the locally packed hashes.
  const manifest=await blocks.manifest(uploadEntries);
  const publicationRequired=!equal(uploadEntries,remote)||!equal(manifest,head.manifest);
  await applyEntries(initial,localEntries,{...state,base:nextBase(remote),revision:head.revision,storage:head.storage,status:'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict,resolution:activeConflicts.length?undefined:state.resolution,pending:undefined});
  if(publicationRequired){
   const pending={operationId:crypto.randomUUID(),baseRevision:head.revision,manifest,entries:uploadEntries,baseEntries:nextBase(uploadEntries)};
   // Persist the complete immutable publication before any upload/commit.
   await saveState(expected,old=>({...old!,pending}));await blocks.upload();
   let published:LibrarySyncHead;
   try{published=librarySyncHead.parse(await request('/commit',{operationId:pending.operationId,baseRevision:pending.baseRevision,manifest}));}
   catch(error){if(error instanceof Error&&error.message==='library_sync_conflict'){await saveState(expected,old=>({...old!,pending:undefined}));throw new Error('library_sync_head_changed');}throw error;}
   await saveState(expected,old=>({...old!,base:nextBase(uploadEntries),revision:published.revision,storage:published.storage??old!.storage,pending:undefined,lastSyncedAt:new Date().toISOString()}));
  }
  const current=await readLibrary(capture);
  const completedAt=new Date().toISOString(),converged=equal(current.entries,current.state!.base);
  await saveState(expected,old=>({...old!,status:activeConflicts.length?'conflict':converged?'synced':'pending',conflicts:activeConflicts.length?activeConflicts:undefined,conflict:activeConflicts.length?conflict:undefined,resolution:undefined,syncedLocalRevision:converged?current.localRevision:old!.syncedLocalRevision,lastSyncedAt:completedAt,lastCheckedAt:completedAt,syncStartedAt:undefined,error:undefined,failureKind:undefined,retryCount:undefined,retryAt:undefined}));
 }catch(error){const message=error instanceof Error?error.message:'library_sync_failed';
  await saveState(expected,old=>{const state=old??defaults;
   if(message==='library_sync_local_changed')return {...state,status:'pending',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   if(['library_sync_conflict','library_sync_identity','library_sync_history','libraryBackup.errors.inconsistent'].includes(message))return {...state,status:'conflict',syncStartedAt:undefined,error:message,failureKind:undefined,retryCount:undefined,retryAt:undefined};
   return {...state,...cloudSyncFailurePolicy(message,navigator.onLine,state.retryCount),syncStartedAt:undefined,error:message};
  }).catch(()=>{});
  throw error;
 }
}
