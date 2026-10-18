/** Equivalent fixture codec -> real existing API. Explicitly bypasses the
 * client's blocked full first-publication path; never a product onboarding pass. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeBackupValue,encodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from '../../apps/web/src/data/library/replication/libraryReplica';
import {librarySyncManifest} from '../../packages/contracts/src/sensa/librarySync';
import {librarySyncRecordSegments,splitLibrarySyncText,encodeLibrarySyncBlock,decodeLibrarySyncBlock} from '../../packages/contracts/src/sensa/librarySyncBlocks';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export async function bootstrapServerFixture(root:string,origin:string,account:{token:string}){
 const started=performance.now(),manifestBytes=await readFile(join(root,'manifest.json')),fixture=JSON.parse(manifestBytes.toString('utf8'));
 if(fixture.audioByteLength!==undefined)throw Error('Server bootstrap is limited to the tiny-media history baseline, not material-axis fixtures');
 let identity:any;for(const batch of fixture.batches.filter((b:any)=>b.table==='meta')){const bytes=await readFile(join(root,batch.file));if(hash(bytes)!==batch.sha256)throw Error('Fixture digest mismatch');const rows=decodeBackupValue(JSON.parse(bytes.toString('utf8'))) as any[];identity=rows.find(row=>row.key==='identity')?.value??identity;}
 if(!identity)throw Error('Missing fixture identity');const blocks=new Map<string,string>(),rows:any[]=[],expected:Record<string,string>={};let decodedValueBytes=0;
 const pack=(text:string)=>splitLibrarySyncText(text).map(part=>{const data=encodeLibrarySyncBlock(part);if(decodeLibrarySyncBlock(data)!==part)throw Error('Equivalent codec roundtrip mismatch');const id=hash(data);blocks.set(id,data);return id;});
 for(const batch of fixture.batches){
  if(!/^\w+-\d+\.json$/u.test(batch.file))throw Error('Invalid fixture path');const bytes=await readFile(join(root,batch.file));if(hash(bytes)!==batch.sha256)throw Error('Fixture digest mismatch');const entries=decodeBackupValue(JSON.parse(bytes.toString('utf8'))) as any[];
  if(entries.length!==batch.rowCount)throw Error('Fixture count mismatch');
  for(const entry of entries){if(!isReplicatedLibraryEntry(batch.table,entry.key))continue;const normalized=normalizeLibraryReplicaEntry({table:batch.table,key:entry.key,value:entry.value},identity),value=encodeBackupValue(normalized.value),text=JSON.stringify(value);decodedValueBytes+=Buffer.byteLength(text);const refs=librarySyncRecordSegments(value).flatMap(pack);rows.push({table:batch.table,key:entry.key,blocks:refs});expected[JSON.stringify([batch.table,entry.key])]=hash(text);}
 }
 rows.sort((a,b)=>JSON.stringify([a.table,a.key]).localeCompare(JSON.stringify([b.table,b.key])));
 const manifest=librarySyncManifest.parse({version:8,libraryId:identity.id,learnerId:identity.learnerId,rows}),manifestHashes=pack(JSON.stringify(manifest));
 const encodingMs=performance.now()-started,network:any[]=[];
 async function request(path:string,body?:unknown){const text=body===undefined?'':JSON.stringify(body),begin=performance.now();const reply=await fetch(origin+'/sensa/library-sync'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+account.token,'content-type':'application/json'},body:body===undefined?undefined:text});const response=await reply.text();network.push({path,method:body===undefined?'GET':'POST',status:reply.status,elapsedMs:performance.now()-begin,requestBodyBytes:Buffer.byteLength(text),responseBodyBytes:Buffer.byteLength(response)});if(!reply.ok)throw Error('Fixture API rejected: '+reply.status+' '+response);return JSON.parse(response);}
 const head=await request('/head');if(head.revision!==0||head.manifest!==null)throw Error('Fixture bootstrap requires empty isolated account');
 const values=[...blocks].map(([hash,data])=>({hash,data}));for(let at=0;at<values.length;at+=16){const page=values.slice(at,at+16);if(page.reduce((sum,block)=>sum+block.data.length,0)>3*1024*1024)throw Error('Fixture bootstrap store page exceeds existing client budget');await request('/blocks/store',{blocks:page});}
 const committed=await request('/commit',{operationId:crypto.randomUUID(),baseRevision:0,manifest:manifestHashes});
 if(committed.revision!==1)throw Error('Fixture CAS commit failed');
 return {expected,report:{fixtureManifestSha256:hash(manifestBytes),construction:'Exact current normalized row values; original production record segment/split/gzip codec roundtrips; real Node HTTP to existing Hono/Postgres API. NOT client full publication and NOT real-user onboarding.',encodingMs,totalMs:performance.now()-started,decodedValueBytes,rows:rows.length,uniqueBlocks:blocks.size,uniqueStoredBlockBytes:values.reduce((n,b)=>n+Buffer.byteLength(b.data),0),manifestHashes,network}};
}
