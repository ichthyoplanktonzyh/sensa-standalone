import {Gzip,Gunzip,strToU8} from 'fflate';
import {z} from 'zod';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue,decodeBackupValue} from './backupCodec';
import {externalizeSharedRecordContent,sharedRecordTables,compactArchiveWire,expandArchiveWire,decodeSharedArchiveWire} from './sharedRecordContent';
import {libraryBackupTables} from './backupPolicy';
import {libraryTables} from './store';
import type {BackupRows} from './backupValidation';

export const backupArchiveByteLimit=64*1024*1024;
const expandedLimit=512*1024*1024,frameLimit=96*1024*1024,rowLimit=200000;
const ownerSchema=z.object({subject:z.string().uuid(),accountId:z.string().uuid().optional(),email:z.string().max(500).optional()}).strict();
const headerSchema=z.object({kind:z.literal('header'),format:z.literal('sensa-web-library-snapshot-v3'),librarySchema:z.literal(6),createdAt:z.string().datetime({offset:true}),owner:ownerSchema.nullable(),counts:z.record(z.string(),z.number().int().nonnegative()),sharedBodies:z.number().int().nonnegative().max(rowLimit)}).strict();
export type BackupArchiveHeader=z.infer<typeof headerSchema>;
const invalid=():never=>{throw new Error('libraryBackup.errors.invalidFile');};
const yieldToUser=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

/** Bounded compressed transport over individual frames, not one giant JSON
 * object/string. Sharing is lossless and happens before compression. */
export async function encodeBackupArchive(rows:BackupRows,owner:BackupArchiveHeader['owner']){
 const bodies=new Map<string,string>();let count=0;
 for(const table of libraryBackupTables){
  for(const row of rows[table]){
   if(++count>rowLimit)throw Error('libraryBackup.errors.rowLimit');
   const value=encodeBackupValue(row.value),shared=sharedRecordTables.has(table)?externalizeSharedRecordContent(value):{value,bodies:new Map<string,string>()};
   for(const [digest,body] of shared.bodies)bodies.set(digest,body);
   if(count%64===0)await yieldToUser();
  }
 }
 const header=headerSchema.parse({kind:'header',format:'sensa-web-library-snapshot-v3',librarySchema:6,createdAt:new Date().toISOString(),owner,counts:Object.fromEntries(libraryBackupTables.map(table=>[table,rows[table].length])),sharedBodies:bodies.size});
 const chunks:Uint8Array[]=[],compressor=new Gzip({level:6},chunk=>{size+=chunk.length;if(size>backupArchiveByteLimit)throw Error('libraryBackup.errors.sizeLimit');chunks.push(chunk);});let size=0,expanded=0,frames=0;
 const push=async(value:unknown,final=false)=>{
  const bytes=strToU8(JSON.stringify(value)+'\n');expanded+=bytes.length;
  if(bytes.length>frameLimit||expanded>expandedLimit)throw Error('libraryBackup.errors.sizeLimit');
  compressor.push(bytes,final);if(++frames%64===0)await yieldToUser();
 };
 await push(header);
 for(const [digest,text] of bodies)await push({kind:'body',digest,value:compactArchiveWire(JSON.parse(text))});
 // The first pass retains only unique immutable bodies. Encode record frames
 // in the second pass, rather than retaining a second full tagged fact graph.
 for(const table of libraryBackupTables)for(const row of rows[table]){
  const wire=encodeBackupValue(row.value),value=sharedRecordTables.has(table)?externalizeSharedRecordContent(wire).value:wire;
  await push({kind:'row',table,key:row.key,value:compactArchiveWire(value)});
 }
 await push({kind:'end'},true);
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return {header,bytes};
}

export async function decodeBackupArchive(compressed:Uint8Array):Promise<{header:BackupArchiveHeader;rows:BackupRows}>{
 try{
  if(compressed.length>backupArchiveByteLimit)invalid();
  const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as BackupRows,bodies=new Map<string,unknown>(),used=new Set<string>(),keys=new Map(libraryBackupTables.map(table=>[table,new Set<string>()]));
  const textDecoder=new TextDecoder('utf-8',{fatal:true});let parts:Uint8Array[]=[],frameBytes=0,header:BackupArchiveHeader|undefined,expanded=0,count=0,ended=false,startedRows=false;
  const parse=(text:string)=>{
   if(ended)invalid();const frame=JSON.parse(text);
   if(!header){header=headerSchema.parse(frame);if(Object.keys(header.counts).length!==libraryBackupTables.length||libraryBackupTables.some(table=>header!.counts[table]===undefined)||Object.values(header.counts).reduce((a,b)=>a+b,0)>rowLimit)invalid();return;}
   if(frame.kind==='body'){
    if(startedRows||bodies.size>=header.sharedBodies||Object.keys(frame).length!==3||typeof frame.digest!=='string'||!/^[a-f0-9]{64}$/u.test(frame.digest)||bodies.has(frame.digest))invalid();
    const wire=expandArchiveWire(frame.value);if(sha256(JSON.stringify(wire))!==frame.digest)invalid();bodies.set(frame.digest,decodeBackupValue(wire));return;
   }
   if(frame.kind==='row'){
    startedRows=true;if(bodies.size!==header.sharedBodies||++count>rowLimit||Object.keys(frame).length!==4||!keys.has(frame.table)||typeof frame.key!=='string'||!frame.key.length||frame.key.length>2000)invalid();
    const table=frame.table as typeof libraryBackupTables[number],set=keys.get(table)!;
    if(set.has(frame.key)||rows[table].length>=header.counts[table])invalid();set.add(frame.key);
    rows[table].push({key:frame.key,value:decodeSharedArchiveWire(expandArchiveWire(frame.value),bodies,used)});return;
   }
   if(frame.kind!=='end'||Object.keys(frame).length!==1||bodies.size!==header.sharedBodies||libraryBackupTables.some(table=>rows[table].length!==header!.counts[table])||used.size!==bodies.size)invalid();ended=true;
  };
  const consume=(chunk:Uint8Array)=>{
   expanded+=chunk.length;if(expanded>expandedLimit)invalid();let at=0;
   while(at<chunk.length){
    const newline=chunk.indexOf(10,at),end=newline<0?chunk.length:newline,part=chunk.subarray(at,end);
    frameBytes+=part.length;if(frameBytes>frameLimit)invalid();if(part.length)parts.push(part);
    if(newline<0)break;
    // Join only one bounded frame. Scan each decompressed byte once, including
    // large media frames split across many inflater callbacks.
    const frame=new Uint8Array(frameBytes);let offset=0;for(const piece of parts){frame.set(piece,offset);offset+=piece.length;}
    parts=[];frameBytes=0;parse(textDecoder.decode(frame));at=newline+1;
   }
  };
  const inflater=new Gunzip(chunk=>consume(chunk));
  for(let at=0;at<compressed.length;at+=16*1024){inflater.push(compressed.subarray(at,at+16*1024),at+16*1024>=compressed.length);if(at>0&&at%(256*1024)===0)await yieldToUser();}
  if(!header||!ended||frameBytes)invalid();return {header:header!,rows};
 }catch{throw Error('libraryBackup.errors.invalidFile');}
}
