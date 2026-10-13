import {sha256} from '@sensa/learning-kernel';
import {gzipSync,gunzipSync,Gunzip} from 'fflate';
import {librarySyncBlockChars} from './librarySync.js';

const tag='sensa-library-sync-gzip-v1';
const prefix=`["${tag}",`;
const bodyFields=new Set(['content','contentPayload','protocolBinding','definition','schedulingPolicy']);
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const crc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const invalid=():never=>{throw new Error('library_sync_format');};
const base64=(bytes:Uint8Array)=>{
 let text='';for(let at=0;at<bytes.length;at+=16384)text+=String.fromCharCode(...bytes.subarray(at,at+16384));
 return btoa(text);
};

/** Exact text chunks: never split a UTF-16 surrogate pair before UTF-8 encoding. */
export function splitLibrarySyncText(text:string):string[]{
 const chunks:string[]=[];
 for(let at=0;at<text.length;){
  let end=Math.min(at+librarySyncBlockChars,text.length);
  if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff&&text.charCodeAt(end)>=0xdc00&&text.charCodeAt(end)<=0xdfff)end--;
  chunks.push(text.slice(at,end));at=end;
 }
 return chunks;
}

/** Isolate identical immutable bodies without changing the logical row wire.
 * The concatenation is still exactly JSON.stringify(value), including key order.
 * This is a transport representation, not a second authority or a body fallback. */
export function librarySyncRecordSegments(value:unknown,readShared?:(digest:string)=>string):string[]{
 const segments:string[]=[];let framing='';
 const flush=()=>{if(framing){segments.push(framing);framing='';}};
 const visit=(node:any,field='',depth=0):void=>{
  if(depth>80||!Array.isArray(node))invalid();
  if(node[0]==='sensa-shared-content-v1'){
   if(!readShared||node.length!==2||typeof node[1]!=='string'||!/^[a-f0-9]{64}$/u.test(node[1]))invalid();
   flush();segments.push(readShared!(node[1]));return;
  }
  if(bodyFields.has(field)&&(node[0]==='object'||node[0]==='array')){
   const body=JSON.stringify(node);if(body.length>=512){flush();segments.push(body);return;}
  }
  if(node[0]==='object'){
   framing+='["object",[';
   node[1].forEach(([key,item]:[string,unknown],index:number)=>{if(index)framing+=',';framing+=`[${JSON.stringify(key)},`;visit(item,key,depth+1);framing+=']';});
   framing+=']]';
  }else if(node[0]==='array'){
   framing+='["array",[';node[1].forEach((item:unknown,index:number)=>{if(index)framing+=',';visit(item,'',depth+1);});framing+=']]';
  }else framing+=JSON.stringify(node);
 };
 visit(value);flush();return segments;
}

/** Deterministic lossless compression; the address hashes the returned transport
 * text, while the envelope digest verifies the exact decoded UTF-8 bytes. */
export function encodeLibrarySyncBlock(text:string):string{
 if(text.length>librarySyncBlockChars)invalid();
 const bytes=encoder.encode(text);if(decoder.decode(bytes)!==text)invalid();
 if(bytes.length<1024)return text;
 const packed=JSON.stringify([tag,sha256(bytes),base64(gzipSync(bytes,{level:6,mtime:0}))]);
 return packed.length<text.length?packed:text;
}

/** A fixed output buffer bounds inflation before parsing or joining a row.
 * Plain fragments remain valid v6 blocks; compressed framing is never a fact. */
export function decodeLibrarySyncBlock(data:string):string{
 try{
  if(data.length>librarySyncBlockChars)invalid();
  if(!data.startsWith(prefix)){if(decoder.decode(encoder.encode(data))!==data)invalid();return data;}
  const value=JSON.parse(data);
  if(!Array.isArray(value)||value.length!==3||value[0]!==tag||typeof value[1]!=='string'||!/^[a-f0-9]{64}$/u.test(value[1])||typeof value[2]!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value[2]))invalid();
  const bytes=Uint8Array.from(atob(value[2]),character=>character.charCodeAt(0));if(bytes.length<18)invalid();
  const trailer=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),expected=trailer.getUint32(bytes.length-4,true);
  if(expected>librarySyncBlockChars*3)invalid();
  // One extra byte detects forged ISIZE/truncated output instead of accepting
  // a digest of only the attacker-selected prefix of a larger inflation.
  const plain=gunzipSync(bytes,{out:new Uint8Array(expected+1)});
  if(plain.length!==expected||crc32(plain)!==trailer.getUint32(bytes.length-8,true)||sha256(plain)!==value[1])invalid();
  const text=decoder.decode(plain);if(text.length>librarySyncBlockChars)invalid();return text;
 }catch{return invalid();}
}

/** Binary snapshot chunks share the existing block store and request quota.
 * Compress binary bytes once, rather than compressing their expanded base64 text. */
export const librarySyncBinaryChunkBytes=176*1024;
const binaryTag='sensa-library-db-chunk-v1';
export async function encodeLibrarySyncBinaryChunk(input:Uint8Array):Promise<string>{
 if(input.byteLength<1||input.byteLength>librarySyncBinaryChunkBytes)invalid();
 const bytes=input.slice();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 const compressed=typeof CompressionStream==='function'?new Uint8Array(await new Response(new Response(bytes).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()):gzipSync(bytes,{level:6,mtime:0});
 const data=JSON.stringify([binaryTag,bytes.length,digest,base64(compressed)]);if(data.length>librarySyncBlockChars)invalid();return data;
}
/** Inflation has a fixed per-chunk output allocation before any bytes escape. */
export function decodeLibrarySyncBinaryChunk(data:string):Uint8Array{
 try{
  if(data.length>librarySyncBlockChars)invalid();const value=JSON.parse(data);
  if(!Array.isArray(value)||value.length!==4||value[0]!==binaryTag||!Number.isSafeInteger(value[1])||value[1]<1||value[1]>librarySyncBinaryChunkBytes||typeof value[2]!=='string'||!/^[a-f0-9]{64}$/u.test(value[2])||typeof value[3]!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value[3]))invalid();
  const packed=Uint8Array.from(atob(value[3]),c=>c.charCodeAt(0));if(packed.length<18||packed[0]!==31||packed[1]!==139||packed[2]!==8||packed[3]!==0)invalid();
  const trailer=new DataView(packed.buffer);if(trailer.getUint32(packed.length-4,true)!==value[1])invalid();
  const plain=new Uint8Array(value[1]);let at=0,done=false;
  const stream=new Gunzip((chunk,final)=>{if(at+chunk.length>plain.length)invalid();plain.set(chunk,at);at+=chunk.length;done=final;});stream.onmember=invalid;
  for(let offset=0;offset<packed.length;offset+=8192)stream.push(packed.subarray(offset,offset+8192),offset+8192>=packed.length);
  if(!done||at!==plain.length||crc32(plain)!==trailer.getUint32(packed.length-8,true)||sha256(plain)!==value[2])invalid();return plain;
 }catch{return invalid();}
}
