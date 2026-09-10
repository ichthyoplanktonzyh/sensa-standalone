/** Production local-library storage. Separate from account replicas and preview data. */
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
export const libraryDatabaseName='sensa:local-library:v1';
export const libraryTables=['meta','drafts','providers','settings','operations','sessions','meanings','identities','packages','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts'] as const;
export type Table=typeof libraryTables[number];
let connection:Promise<IDBDatabase>|undefined;
function open(){
 if(!connection){
  connection=new Promise<IDBDatabase>((resolve,reject)=>{
   const request=indexedDB.open(libraryDatabaseName,3);
   request.onupgradeneeded=()=>{for(const table of libraryTables)if(!request.result.objectStoreNames.contains(table))request.result.createObjectStore(table);};
   request.onerror=()=>reject(new Error('无法打开本机存储，请检查浏览器设置后重试。'));
   request.onblocked=()=>reject(new Error('请关闭其他旧版本 Sensa 页面后重试。'));
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
 delete(table:Table,key:IDBValidKey){this.tx.objectStore(table).delete(key);}
}
/** Only local IDB requests belong in work; network and hashing must finish before entry. */
async function transaction<T>(mode:IDBTransactionMode,work:(tx:LibraryTransaction)=>Promise<T>):Promise<T>{
 const db=await open();
 return new Promise<T>((resolve,reject)=>{
  let tx:IDBTransaction;
  try{tx=db.transaction([...libraryTables],mode);}catch{reject(new Error('本机存储暂不可用，请重新打开页面。'));return;}
  let value:T,failed:unknown;
  tx.oncomplete=()=>{if(mode==='readwrite'){window.dispatchEvent(new Event('sensa-library-changed'));if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('sensa-local-library');channel.postMessage('changed');channel.close();}}resolve(value!);};
  const fail=()=>reject(failed??new Error('未能保存到本机，可能存储空间不足。请保留输入并重试。'));
  tx.onerror=fail;tx.onabort=fail;
  work(new LibraryTransaction(tx)).then(v=>{value=v;},e=>{failed=e;try{tx.abort();}catch{reject(e);}});
 });
}
/** Reserved for validated full-library restore; it remains one transaction. */
export const restoreLibraryTransaction=<T>(work:(tx:LibraryTransaction)=>Promise<T>)=>transaction('readwrite',work);
export const readLibrary=<T>(work:(tx:LibraryTransaction)=>Promise<T>)=>transaction('readonly',work);
export type Operation={id:string;kind:string;input:unknown};
export async function command<T>(op:Operation,work:(tx:LibraryTransaction)=>Promise<T>):Promise<T>{
 if(!/^[0-9a-f-]{36}$/i.test(op.id))throw new Error('无效的操作标识。');
 const input=canonicalConsumerJson({kind:op.kind,input:op.input});
 return transaction('readwrite',async tx=>{
  const prior=await tx.get<{input:string;result:T}>('operations',op.id);
  if(prior){if(prior.input!==input)throw new Error('此操作标识已用于不同内容，请重新操作。');return prior.result;}
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
