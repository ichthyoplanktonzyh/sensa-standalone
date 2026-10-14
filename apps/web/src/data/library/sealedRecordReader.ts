import {decodeBackupValue} from './backupCodec';
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

/** One sealed generation only. Ordinary reads decode immutable text afresh.
 * Learning may retain private decoded originals and clone every consumer value.
 * Its additional 4MiB/256KiB limits count serialized UTF-8, not JavaScript heap;
 * eviction or either decoded limit retains the original strict decode path. */
export function sealedRecordReader<Row extends SealedStoredRecord>(source:SealedRecordSource<Row>,budget=cacheBytes):LibraryRecordReader{
 if(!Number.isSafeInteger(budget)||budget<0||budget>cacheBytes)throw Error('sqlite_record_cache_budget');
 const cache=new Map<string,{text:string;bytes:number;decoded?:{value:any}}>();let held=0,decodedHeld=0;
 const id=(table:string,key:string)=>JSON.stringify([table,key]);
 const cached=(table:string,key:string)=>{
  const identity=id(table,key),row=cache.get(identity);
  if(row){cache.delete(identity);cache.set(identity,row);replicaWork('reader.textHit');}return row?.text;
 };
 const plain=(table:SqliteLibraryTable,key:string,stored:Row)=>{
  replicaWork('reader.bodyLoad');const text=source.plain(table,stored);
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
  const entry=source.cloneDecoded?cache.get(id(table,key)):undefined;
  let value:any;
  if(entry?.decoded){replicaWork('reader.decodeHit');value=entry.decoded.value;}
  else{replicaWork('reader.wireDecode');value=decodeBackupValue(JSON.parse(text));if(entry&&entry.bytes<=256*1024&&decodedHeld+entry.bytes<=4*1024*1024){entry.decoded={value};decodedHeld+=entry.bytes;}else if(entry)replicaWork('reader.decodeBypass');}
  // Observation and validators see their own value, never the memo's original.
  if(entry?.decoded)value=structuredClone(value);
  source.observed?.(table,key,text,value);return value;
 };
 return {
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
 };
}
