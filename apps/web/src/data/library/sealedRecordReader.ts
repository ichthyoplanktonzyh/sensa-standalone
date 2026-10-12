import {decodeBackupValue} from './backupCodec';
import type {LibraryRecordReader} from './libraryRecordReader';
import type {SqliteLibraryTable} from './sqliteProtocol';

export type SealedRecordKey={record_key:string;stored_value_bytes:number};
export type SealedStoredRecord={record_key:string;value_json:string};
type SealedRecordSource={
 alive():void;
 beforePage():void;
 get(table:SqliteLibraryTable,key:string):string|undefined;
 has(table:SqliteLibraryTable,key:string):boolean;
 keys(table:SqliteLibraryTable,after:string|null):SealedRecordKey[];
 rows(table:SqliteLibraryTable,keys:readonly string[]):SealedStoredRecord[];
 plain(table:SqliteLibraryTable,stored:string):string;
 missing():never;
};
const pageBytes=1024*1024,cacheBytes=16*1024*1024,cacheRows=256;

/** One sealed generation only. Cache immutable text, never decoded objects:
 * every consumer receives a fresh value and cannot mutate another read. The
 * UTF-8/count budget bounds retained source text, not JavaScript heap. */
export function sealedRecordReader(source:SealedRecordSource,budget=cacheBytes):LibraryRecordReader{
 if(!Number.isSafeInteger(budget)||budget<0||budget>cacheBytes)throw Error('sqlite_record_cache_budget');
 const cache=new Map<string,{text:string;bytes:number}>();let held=0;
 const id=(table:string,key:string)=>JSON.stringify([table,key]);
 const cached=(table:string,key:string)=>{
  const identity=id(table,key),row=cache.get(identity);
  if(row){cache.delete(identity);cache.set(identity,row);}return row?.text;
 };
 const plain=(table:SqliteLibraryTable,key:string,stored:string)=>{
  const text=source.plain(table,stored);
  if(text.length>budget)return text;
  const bytes=new TextEncoder().encode(text).length;
  if(bytes<=budget){
   const identity=id(table,key),prior=cache.get(identity);
   if(prior){held-=prior.bytes;cache.delete(identity);}
   while(cache.size&&(held+bytes>budget||cache.size>=cacheRows)){
    const oldest=cache.keys().next().value!;held-=cache.get(oldest)!.bytes;cache.delete(oldest);
   }
   cache.set(identity,{text,bytes});held+=bytes;
  }
  return text;
 };
 const decode=(text:string)=>decodeBackupValue(JSON.parse(text));
 return {
  get(table,key){
   source.alive();const hit=cached(table,key);if(hit!==undefined)return decode(hit);
   const stored=source.get(table,key);return stored===undefined?undefined:decode(plain(table,key,stored));
  },
  has(table,key){source.alive();return source.has(table,key);},
  entries(table){return {[Symbol.iterator]:function*(){
   let after:string|null=null;
   for(;;){
    source.alive();source.beforePage();
    const keys=source.keys(table,after),selected:string[]=[];let bytes=0;
    for(const row of keys){bytes+=row.stored_value_bytes;if(selected.length&&bytes>pageBytes)break;selected.push(row.record_key);}
    if(!selected.length)return;
    const texts=new Map<string,string>(),missing:string[]=[];
    for(const key of selected){const hit=cached(table,key);if(hit!==undefined)texts.set(key,hit);else missing.push(key);}
    const stored=new Map((missing.length?source.rows(table,missing):[]).map(row=>[row.record_key,row.value_json]));
    for(const key of selected){
     source.alive();const hit=texts.get(key)??cached(table,key),body=stored.get(key);
     if(hit===undefined&&body===undefined)source.missing();
     yield {key,value:decode(hit??plain(table,key,body!))};
    }
    after=selected.at(-1)!;
   }
  }};},
 };
}
