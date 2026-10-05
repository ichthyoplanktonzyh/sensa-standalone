/** Specialized transport measurement over already command-generated, fully
 * validated capacity facts. Not a browser/HTTP/restore or heap benchmark. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {sha256} from '@sensa/learning-kernel';
import {librarySyncManifest,librarySyncTables} from '../packages/contracts/src/sensa/librarySync.ts';
import {decodeLibrarySyncBlock,encodeLibrarySyncBlock,librarySyncRecordSegments,splitLibrarySyncText} from '../packages/contracts/src/sensa/librarySyncBlocks.ts';
import {decodeBackupValue} from '../apps/web/src/data/library/backupCodec.ts';

const directory=resolve(process.argv.find(arg=>arg.startsWith('--fixture='))?.slice(10)??'');
if(!directory.startsWith(resolve('.tmp')+'/retention-capacity-facts-'))throw new Error('Verified isolated capacity fixture required');
const fixture=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
if(fixture.format!=='sensa-retention-capacity-facts-v1')throw new Error('Unknown capacity fixture');
const encoder=new TextEncoder(),blocks=new Map<string,number>(),rows:{table:any;key:string;blocks:string[]}[]=[];
let logicalBytes=0,identity:any;
const pack=(segment:string)=>splitLibrarySyncText(segment).map(part=>{
 const data=encodeLibrarySyncBlock(part),hash=sha256(data);
 if(!blocks.has(hash)){if(decodeLibrarySyncBlock(data)!==part)throw new Error('Transport roundtrip mismatch');blocks.set(hash,encoder.encode(data).length);}
 return hash;
});
for(const batch of fixture.batches){
 if(!(librarySyncTables as readonly string[]).includes(batch.table))continue;
 if(!/^\w+-\d+\.json$/u.test(batch.file))throw new Error('Invalid batch path');
 const bytes=await readFile(join(directory,batch.file));if(sha256(bytes)!==batch.sha256)throw new Error('Capacity fixture digest mismatch');
 const wire=JSON.parse(bytes.toString('utf8'));if(wire[0]!=='array'||wire[1].length!==batch.rowCount)throw new Error('Capacity fixture row count mismatch');
 for(const row of wire[1]){
  const key=row[1].find(([name]:[string])=>name==='key')?.[1]?.[1],value=row[1].find(([name]:[string])=>name==='value')?.[1];
  if(typeof key!=='string'||!value)throw new Error('Invalid capacity row');
  if(batch.table==='meta'&&!['identity','learning-active'].includes(key))continue;
  if(batch.table==='meta'&&key==='identity')identity=decodeBackupValue(value);
  logicalBytes+=encoder.encode(JSON.stringify(value)).length;
  const refs=librarySyncRecordSegments(value).flatMap(pack);rows.push({table:batch.table,key,blocks:refs});
 }
}
const manifest=librarySyncManifest.parse({version:6,libraryId:identity.id,learnerId:identity.learnerId,rows});
pack(JSON.stringify(manifest));
const uniqueTransportBytes=[...blocks.values()].reduce((sum,size)=>sum+size,0);
console.log(JSON.stringify({targets:fixture.targets,runs:fixture.runs,events:fixture.events,replicatedRows:rows.length,logicalBytes,uniqueBlocks:blocks.size,uniqueTransportBytes,scope:'Verified fixture batches and exact per-block roundtrip; not cloud HTTP, encryption, actual restore, browser latency or heap evidence'}));
