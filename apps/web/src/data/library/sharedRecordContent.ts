import {sha256} from '@sensa/learning-kernel';
import {gzipSync,Gunzip,strToU8,strFromU8} from 'fflate';
import {decodeBackupValue,type WireValue} from './backupCodec';

const referenceTag='sensa-shared-content-v1';
const compressedTag='sensa-record-gzip-v1';
const sharedFields=new Set(['content','contentPayload','protocolBinding','definition','schedulingPolicy']);
const hashPattern=/^[a-f0-9]{64}$/u;
const maximumRecordBytes=96*1024*1024;
const fail=():never=>{throw new Error('sqlite_shared_content_invalid');};
export interface SharedRecordContent{readonly value:WireValue;readonly bodies:ReadonlyMap<string,string>;}

/** A single synchronous activation only. Exact text keys retain immutable
 * results; count input and output UTF-8 bytes together. Never retain decoded
 * facts, cross a transaction boundary, or admit a large row by caching it. */
export class StoredRecordMemo{
 private readonly indexes={hash:new Map<string,Entry>(),unpack:new Map<string,Entry>()};
 private readonly recent=new Map<Entry,undefined>();
 private held=0;
 constructor(private readonly budget=16*1024*1024,private readonly limit=256){
  if(!Number.isSafeInteger(budget)||budget<0||budget>16*1024*1024||!Number.isSafeInteger(limit)||limit<0||limit>256)throw Error('sqlite_record_cache_budget');
 }
 transform(kind:'hash'|'unpack',input:string,compute:()=>string):string{
  const index=this.indexes[kind],hit=index.get(input);
  if(hit){this.recent.delete(hit);this.recent.set(hit,undefined);return hit.output;}
  const output=compute();
  if(!this.limit||input.length+output.length>this.budget)return output;
  const bytes=strToU8(input).length+strToU8(output).length;
  if(bytes>this.budget)return output;
  while(this.recent.size&&(this.held+bytes>this.budget||this.recent.size>=this.limit)){
   const oldest=this.recent.keys().next().value!;
   this.recent.delete(oldest);this.indexes[oldest.kind].delete(oldest.input);this.held-=oldest.bytes;
  }
  const entry:Entry={kind,input,output,bytes};index.set(input,entry);this.recent.set(entry,undefined);this.held+=bytes;
  return output;
 }
 clear():void{this.indexes.hash.clear();this.indexes.unpack.clear();this.recent.clear();this.held=0;}
}
type Entry={kind:'hash'|'unpack';input:string;output:string;bytes:number};
const bodyDigest=(text:string,memo?:StoredRecordMemo)=>memo?memo.transform('hash',text,()=>sha256(text)):sha256(text);

/** Lossless storage representation only: identities, revisions, provenance,
 * bindings and outcomes remain caller-owned facts. Bodies have no references
 * themselves, so each record has a bounded, directly owned dependency set. */
export function externalizeSharedRecordContent(value:WireValue,memo?:StoredRecordMemo):SharedRecordContent{
 const decoded=decodeBackupValue(value) as {format?:unknown}|null;
 const scope=decoded?.format==='sensa-study-scope-v1';
 const bodies=new Map<string,string>();
 const visit=(node:any,field='',depth=0):any=>{
  if(depth>80||!Array.isArray(node))fail();
  if((sharedFields.has(field)||scope&&(field==='scopeMember'||field==='range'))&&(node[0]==='object'||node[0]==='array')){
   const text=JSON.stringify(node);
   if(text.length>=512){const digest=bodyDigest(text,memo);bodies.set(digest,text);return [referenceTag,digest];}
  }
  if(node[0]==='object')return ['object',node[1].map(([key,item]:[string,unknown])=>[key,visit(item,key,depth+1)])];
  if(node[0]==='array')return ['array',node[1].map((item:unknown)=>visit(item,scope&&field==='members'?'scopeMember':'',depth+1))];
  return node;
 };
 return {value:visit(value),bodies};
}

/** Verify once per distinct body in this read. Never substitute a missing body
 * from a current Target, package cache or a guessed older representation. */
export function expandSharedRecordContent(value:WireValue,read:(digest:string)=>string|undefined,memo?:StoredRecordMemo):WireValue{
 const cache=new Map<string,WireValue>();
 const visit=(node:any,depth=0):any=>{
  if(depth>80||!Array.isArray(node))fail();
  if(node[0]===referenceTag){
   const digest=node[1];if(node.length!==2||typeof digest!=='string'||!hashPattern.test(digest))fail();
   if(!cache.has(digest)){
    const text=read(digest);if(text===undefined||bodyDigest(text,memo)!==digest)fail();
    const body=JSON.parse(text!);decodeBackupValue(body);cache.set(digest,body);
   }
   return cache.get(digest);
  }
  if(node[0]==='object')return ['object',node[1].map(([key,item]:[string,unknown])=>[key,visit(item,depth+1)])];
  if(node[0]==='array')return ['array',node[1].map((item:unknown)=>visit(item,depth+1))];
  return node;
 };
 return visit(value);
}


const base64=(bytes:Uint8Array)=>{
 const native=Reflect.get(Uint8Array.prototype,'toBase64');
 if(typeof native==='function')return Reflect.apply(native,bytes,[]) as string;
 let text='';for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
 return btoa(text);
};
const unbase64=(text:string):Uint8Array=>{
 const native=Reflect.get(Uint8Array,'fromBase64');
 return typeof native==='function'?Reflect.apply(native,Uint8Array,[text]):Uint8Array.from(atob(text),character=>character.charCodeAt(0));
};

/** Compress the remaining record framing, not instead of sharing its bodies.
 * Compression is private to the storage seam; its digest covers exact bytes. */
export function packStoredRecord(text:string):string{
 const bytes=strToU8(text);if(bytes.length>maximumRecordBytes)fail();
 if(bytes.length<1024)return text;
 const packed=JSON.stringify([compressedTag,sha256(bytes),base64(gzipSync(bytes,{level:6}))]);
 return packed.length<text.length?packed:text;
}
export function unpackStoredRecord(text:string,memo?:StoredRecordMemo,outputLimit=maximumRecordBytes):string{
 // Writers use this exact envelope. Ordinary tagged facts need not be parsed
 // merely to discover that they are not compressed records.
 if(!text.startsWith(`["${compressedTag}",`))return text;
 if(memo)return memo.transform('unpack',text,()=>unpackStoredRecord(text,undefined,outputLimit));
 const value=JSON.parse(text);
 if(!Array.isArray(value)||value[0]!==compressedTag)return text;
 if(value.length!==3||typeof value[1]!=='string'||!hashPattern.test(value[1])||typeof value[2]!=='string')fail();
 const bytes=unbase64(value[2]);if(bytes.length<18)fail();
 const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(bytes.length-4,true);
 if(!Number.isSafeInteger(outputLimit)||outputLimit<0||size>Math.min(outputLimit,maximumRecordBytes))fail();
 // ISIZE alone is not an output bound. A fixed gunzipSync buffer can silently
 // truncate a forged longer stream to an otherwise valid tagged JSON prefix.
 const plain=new Uint8Array(size);let at=0,finished=false;
 const stream=new Gunzip((chunk,final)=>{
  if(at+chunk.length>size||at+chunk.length>outputLimit)fail();
  plain.set(chunk,at);at+=chunk.length;finished=final;
 });
 stream.onmember=fail; // Stored writers emit exactly one gzip member.
 for(let offset=0;offset<bytes.length;offset+=8192)stream.push(bytes.subarray(offset,offset+8192),offset+8192>=bytes.length);
 if(!finished||at!==size||sha256(plain)!==value[1])fail();
 return strFromU8(plain);
}

export const sharedRecordTables=new Set(['learningTargets','learningRuns','learningEvents','contentAttempts','operations','packageCache','studyScopes']);

/** Compact archive wire form. Reserve one object key and escape its occurrence
 * in user objects; arrays and primitive values otherwise stay ordinary JSON. */
export function compactArchiveWire(node:any,depth=0):unknown{
 if(depth>80||!Array.isArray(node))fail();
 const [kind,value]=node;
 if(kind===referenceTag)return {$sensa:'shared',value};
 if(kind==='undefined'||kind==='date')return {$sensa:kind,...(kind==='date'?{value}:{})};
 if(kind==='null')return null;
 if(['string','boolean','number'].includes(kind))return value;
 if(kind==='array')return value.map((item:unknown)=>compactArchiveWire(item,depth+1));
 if(kind==='object'){
  const object:Record<string,unknown>={};
  for(const [key,item] of value)Object.defineProperty(object,key,{value:compactArchiveWire(item,depth+1),enumerable:true,writable:true,configurable:true});
  return Object.hasOwn(object,'$sensa')?{$sensa:'object',value:object}:object;
 }
 return fail();
}
export function expandArchiveWire(value:any,depth=0):WireValue{
 if(depth>80)fail();
 if(value===null)return ['null'];
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return [typeof value,value];
 if(Array.isArray(value))return ['array',value.map(item=>expandArchiveWire(item,depth+1))];
 if(value&&typeof value==='object'){
  if(Object.hasOwn(value,'$sensa')){
   const marker=value.$sensa;
   if(marker==='undefined'&&Object.keys(value).length===1)return ['undefined'];
   if(marker==='date'&&Object.keys(value).length===2&&typeof value.value==='string')return ['date',value.value];
   if(marker==='shared'&&Object.keys(value).length===2&&typeof value.value==='string'&&hashPattern.test(value.value))return [referenceTag,value.value];
   if(marker!=='object'||Object.keys(value).length!==2||!value.value||typeof value.value!=='object'||Array.isArray(value.value))return fail();
   value=value.value;
  }
  return ['object',Object.entries(value).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,item])=>[key,expandArchiveWire(item,depth+1)])];
 }
 return fail();
}

/** Archive decoding can share immutable bodies across rows, rather than
 * expanding the same content into several temporary tagged object graphs. */
export function decodeSharedArchiveWire(value:any,bodies:ReadonlyMap<string,unknown>,used:Set<string>,depth=0):any{
 return decodeBackupValue(value,depth,digest=>{if(!bodies.has(digest))fail();used.add(digest);return bodies.get(digest);});
}
