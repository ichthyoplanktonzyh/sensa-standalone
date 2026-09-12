/** Production local-library storage. Separate from account replicas and preview data. */
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
export const libraryDatabaseName='sensa:local-library:v1';
export const libraryTables=['meta','drafts','providers','settings','operations','sessions','meanings','identities','packages','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts'] as const;
export type Table=typeof libraryTables[number];
let connection:Promise<IDBDatabase>|undefined;
let sessionIncarnation:string|undefined;
function open(){
 if(!connection){
  connection=new Promise<IDBDatabase>((resolve,reject)=>{
   const request=indexedDB.open(libraryDatabaseName,3);
   request.onupgradeneeded=()=>{for(const table of libraryTables)if(!request.result.objectStoreNames.contains(table))request.result.createObjectStore(table);};
   request.onerror=()=>reject(new Error('localFlow.storageOpen'));
   request.onblocked=()=>reject(new Error('localFlow.closeOldTabs'));
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=undefined;};resolve(db);};
  });
  connection.catch(()=>{connection=undefined;});
 }
 return connection;
}
const result=<T>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export class LibraryTransaction {
 constructor(private tx:IDBTransaction){}
 get<T>(table:Table,key:IDBValidKey){return result(this.tx.objectStore(table).get(key)) as Promise<T|undefined>;}
 entries(table:Table){const store=this.tx.objectStore(table);return Promise.all([result(store.getAllKeys()),result(store.getAll())]).then(([keys,values])=>keys.map((key,i)=>({key,value:values[i]})));}
 all<T>(table:Table){return result(this.tx.objectStore(table).getAll()) as Promise<T[]>;}
 put(table:Table,key:IDBValidKey,value:unknown){this.tx.objectStore(table).put(value,key);}
 clear(table:Table){this.tx.objectStore(table).clear();}
 delete(table:Table,key:IDBValidKey){this.tx.objectStore(table).delete(key);}
}
/** Only local IDB requests belong in work; network and hashing must finish before entry. */
async function transaction<T>(mode:IDBTransactionMode,work:(tx:LibraryTransaction)=>Promise<T>,kind:'content'|'state'='content'):Promise<T>{
 const db=await open();
 return new Promise<T>((resolve,reject)=>{
  let tx:IDBTransaction;
  try{tx=db.transaction([...libraryTables],mode);}catch{reject(new Error('localFlow.storageUnavailable'));return;}
  let value:T,failed:unknown;
  tx.oncomplete=()=>{
   if(mode==='readwrite'){
    // Sync bookkeeping is not learner content. It announces itself separately so the
    // change that published it cannot schedule the next sync pass.
    if(kind==='state')window.dispatchEvent(new Event('sensa-sync-state-changed'));
    else{window.dispatchEvent(new Event('sensa-library-changed'));if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('sensa-local-library');channel.postMessage('changed');channel.close();}}
   }
   resolve(value!);
  };
  const fail=()=>{const cause=failed??tx.error;reject(cause instanceof DOMException&&cause.name==='QuotaExceededError'?new Error('localFlow.storageFull'):cause??new Error('localFlow.storageWrite'));};
  tx.onerror=fail;tx.onabort=fail;
  work(new LibraryTransaction(tx)).then(v=>{value=v;},e=>{failed=e;try{tx.abort();}catch{reject(e);}});
 });
}
/** Reserved for validated full-library restore; it remains one transaction. */
export const restoreLibraryTransaction=<T>(work:(tx:LibraryTransaction)=>Promise<T>)=>transaction('readwrite',work);
/** Sync progress and baselines. Never announces content, so it cannot re-trigger sync. */
export const writeLibraryState=<T>(work:(tx:LibraryTransaction)=>Promise<T>)=>transaction('readwrite',work,'state');
export const readLibrary=<T>(work:(tx:LibraryTransaction)=>Promise<T>)=>transaction('readonly',work);
/** A cleared/restored library fences every command from an older page instance. */
export async function assertCurrentLibrary(tx:LibraryTransaction){
 const current=await tx.get<string>('meta','local-incarnation')??'initial';
 sessionIncarnation??=current;
 if(sessionIncarnation!==current)throw new Error('localFlow.libraryReplaced');
 return current;
}
export type Operation={id:string;kind:string;input:unknown};
export async function command<T>(op:Operation,work:(tx:LibraryTransaction)=>Promise<T>):Promise<T>{
 if(!/^[0-9a-f-]{36}$/i.test(op.id))throw new Error('localFlow.operationInvalid');
 const input=canonicalConsumerJson({kind:op.kind,input:op.input});
 return transaction('readwrite',async tx=>{
  await assertCurrentLibrary(tx);
  const prior=await tx.get<{input:string;result:T}>('operations',op.id);
  if(prior){if(prior.input!==input)throw new Error('localFlow.operationConflict');return prior.result;}
  const value=await work(tx);tx.put('operations',op.id,{input,result:value,committedAt:new Date().toISOString()});return value;
 });
}
export type LibraryIdentity={id:string;learnerId:string;deviceId:string;createdAt:string;schemaVersion:1};
export async function openLibrary(){
 return command({id:'00000000-0000-4000-8000-000000000001',kind:'library.create',input:{}},async tx=>{
  const identity:LibraryIdentity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:1};
  tx.put('meta','identity',identity);return identity;
 });
}
export function observeLibrary(listener:()=>void){
 window.addEventListener('sensa-library-changed',listener);
 const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('sensa-local-library');
 if(channel)channel.onmessage=listener;
 return ()=>{window.removeEventListener('sensa-library-changed',listener);channel?.close();};
}
/** Surfaces that report sync progress follow learner content and sync bookkeeping. */
export function observeCloudSync(listener:()=>void){
 window.addEventListener('sensa-sync-state-changed',listener);
 const stop=observeLibrary(listener);
 return ()=>{window.removeEventListener('sensa-sync-state-changed',listener);stop();};
}
