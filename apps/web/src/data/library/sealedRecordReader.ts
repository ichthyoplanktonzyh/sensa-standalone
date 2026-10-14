import {decodeBackupValue,encodeBackupValue} from './backupCodec';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';
import {replicaWork} from './replicaWork';

export type SealedRecordKey={record_key:string;stored_value_bytes:number};
export type SealedStoredRecord={record_key:string;value_json:string};
type SealedRecordSource<Row extends SealedStoredRecord>={
 alive():void;
 beforePage():void;
 get(table:SqliteLibraryTable,key:string):Row|undefined;
 has(table:SqliteLibraryTable,key:string):boolean;
 keys(table:SqliteLibraryTable,after:string|null):SealedRecordKey[];
 rows(table:SqliteLibraryTable,keys:readonly string[]):Row[];
 plain(table:SqliteLibraryTable,stored:Row):string;
 missing():never;
 observed?:(table:SqliteLibraryTable,key:string,text:string,value:any)=>void;
 /** Learning's sealed snapshot only. The retained value is private: even
  * Dates are cloned before use, so no consumer can change a later input. */
 cloneDecoded?:boolean;
};
const pageBytes=1024*1024,cacheBytes=16*1024*1024,cacheRows=256;
const windowBytes=4*1024*1024,windowRowBytes=256*1024;
type CachedRecord={text:string;bytes:number;decoded?:{value:any};canonical?:string};
export type SealedRecordReader=LibraryRecordReader&{
 /** One bounded component, disposed before processing the next component. */
 beginWindow():()=>void;
 text(table:SqliteLibraryTable,key:string):string|undefined;
 canonical(table:SqliteLibraryTable,key:string):string|undefined;
};

/** One sealed generation only. Ordinary reads decode immutable text afresh.
 * Learning may retain private decoded originals and clone every consumer value.
 * Its additional 4MiB/256KiB limits count serialized UTF-8, not JavaScript heap;
 * eviction or either decoded limit retains the original strict decode path. */
export function sealedRecordReader<Row extends SealedStoredRecord>(source:SealedRecordSource<Row>,budget=cacheBytes):SealedRecordReader{
 if(!Number.isSafeInteger(budget)||budget<0||budget>cacheBytes)throw Error('sqlite_record_cache_budget');
 const cache=new Map<string,CachedRecord>();let held=0,decodedHeld=0;
 let window:{rows:Map<string,CachedRecord>;bytes:number}|undefined;
 const id=(table:string,key:string)=>JSON.stringify([table,key]);
 const cached=(table:string,key:string)=>{
  const identity=id(table,key),pinned=window?.rows.get(identity);if(pinned){replicaWork('window.hit');return pinned.text;}
  const row=cache.get(identity);
  if(row){cache.delete(identity);cache.set(identity,row);replicaWork('reader.textHit');}return row?.text;
 };
 const plain=(table:SqliteLibraryTable,key:string,stored:Row)=>{
  replicaWork('reader.bodyLoad');const text=source.plain(table,stored);
  if(window){
   const bytes=new TextEncoder().encode(text).length,cost=3*bytes+new TextEncoder().encode(id(table,key)).length;
   // Reserve text, decoded serialized size and canonical wire together. A
   // large row/window overflow keeps strict reads; it never widens admission.
   if(bytes<=windowRowBytes&&window.bytes+cost<=windowBytes){window.rows.set(id(table,key),{text,bytes});window.bytes+=cost;replicaWork('window.heldBytes',cost);replicaWork('window.retained');}
   else replicaWork('window.bypass');
   return text;
  }
  if(text.length>budget)return text;
  const bytes=new TextEncoder().encode(text).length;
  if(bytes<=budget){
   const identity=id(table,key),prior=cache.get(identity);
   if(prior){held-=prior.bytes;if(prior.decoded)decodedHeld-=prior.bytes;cache.delete(identity);}
   while(cache.size&&(held+bytes>budget||cache.size>=cacheRows)){
    const oldest=cache.keys().next().value!;const previous=cache.get(oldest)!;held-=previous.bytes;if(previous.decoded)decodedHeld-=previous.bytes;cache.delete(oldest);replicaWork('reader.eviction');
   }
   cache.set(identity,{text,bytes});held+=bytes;
  }
  return text;
 };
 const decode=(table:SqliteLibraryTable,key:string,text:string)=>{
  const pinned=window?.rows.get(id(table,key)),entry=source.cloneDecoded?pinned??cache.get(id(table,key)):undefined;
  let value:any;
  if(entry?.decoded){replicaWork('reader.decodeHit');value=entry.decoded.value;}
  else{replicaWork('reader.wireDecode');value=decodeBackupValue(JSON.parse(text));if(entry&&(pinned||entry.bytes<=256*1024&&decodedHeld+entry.bytes<=4*1024*1024)){entry.decoded={value};if(!pinned)decodedHeld+=entry.bytes;}else if(entry)replicaWork('reader.decodeBypass');}
  // Observation and validators see their own value, never the memo's original.
  if(entry?.decoded)value=structuredClone(value);
  source.observed?.(table,key,text,value);return value;
 };
 const reader:SealedRecordReader={
  beginWindow(){
   source.alive();if(window)throw Error('sqlite_record_window_busy');
   cache.clear();held=decodedHeld=0;
   const scope=window={rows:new Map(),bytes:0};replicaWork('window.open');
   return ()=>{if(window===scope){replicaWork('window.heldBytes',-scope.bytes);replicaWork('window.release');scope.rows.clear();window=undefined;}};
  },
  text(table,key){source.alive();const hit=cached(table,key);if(hit!==undefined)return hit;const row=source.get(table,key);return row===undefined?undefined:plain(table,key,row);},
  canonical(table,key){
   source.alive();const text=reader.text(table,key);if(text===undefined)return undefined;
   const entry=window?.rows.get(id(table,key));if(entry?.canonical!==undefined){replicaWork('window.canonicalHit');return entry.canonical;}
   const value=entry?.decoded?entry.decoded.value:decode(table,key,text);if(value===undefined)return undefined;
   const canonical=JSON.stringify(encodeBackupValue(value));replicaWork('window.canonicalEncode');
   if(entry&&new TextEncoder().encode(canonical).length<=entry.bytes)entry.canonical=canonical;
   return canonical;
  },
  get(table,key){
   replicaWork('reader.get');source.alive();const hit=cached(table,key);if(hit!==undefined)return decode(table,key,hit);
   const stored=source.get(table,key);return stored===undefined?undefined:decode(table,key,plain(table,key,stored));
  },
  has(table,key){replicaWork('reader.has');source.alive();return source.has(table,key);},
  entries(table){return {[Symbol.iterator]:function*(){
   let after:string|null=null;
   for(;;){
    source.alive();source.beforePage();
    const keys=source.keys(table,after),selected:string[]=[];let bytes=0;
    for(const row of keys){bytes+=row.stored_value_bytes;if(selected.length&&bytes>pageBytes)break;selected.push(row.record_key);}
    if(!selected.length)return;
    const texts=new Map<string,string>(),missing:string[]=[];
    for(const key of selected){const hit=cached(table,key);if(hit!==undefined)texts.set(key,hit);else missing.push(key);}
    const stored=new Map((missing.length?source.rows(table,missing):[]).map(row=>[row.record_key,row]));
    for(const key of selected){
     source.alive();const hit=texts.get(key)??cached(table,key),body=stored.get(key);
     if(hit===undefined&&body===undefined)source.missing();
     yield {key,value:decode(table,key,hit??plain(table,key,body!))};
    }
    after=selected.at(-1)!;
   }
  }};},
 };return reader;
}
