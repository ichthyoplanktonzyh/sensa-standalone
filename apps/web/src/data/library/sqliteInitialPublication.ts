import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {librarySyncTables,librarySyncMetadataPageRefs,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {encodeLibrarySyncBlock,librarySyncRecordSegments,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue,decodeBackupValue} from './backupCodec';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,canCopyNormalizedLibraryReplicaValue} from './replication/libraryReplica';
import {packStoredRecord,unpackStoredRecord,expandSharedRecordContent,sharedRecordTables} from './sharedRecordContent';
import {sealedRecordReader} from './sealedRecordReader';
import type {ReplicaCandidateFence,InitialPublicationPage,InitialPublicationStats} from './replicaCandidateProtocol';
import {SqliteSyncDependencies,syncAdmission,type SyncAdmission} from './sqliteSyncDependencies';
import type {CloudSyncState} from './cloudSync';
import type {LibraryIdentity} from './store';
import type {SqliteLibraryTable,SqliteMutation} from './sqliteProtocol';
const utf8=(text:string)=>new TextEncoder().encode(text).length;
const pageBytes=4*1024*1024,recordBytes=90*1024*1024,logicalBytes=512*1024*1024,storedBytes=256*1024*1024;
type Position={table:SqliteLibraryTable;key:string}|null;
export const initialPublicationKeyPageSql='SELECT record_key,length(CAST(value_json AS BLOB)) AS bytes FROM sensa_records WHERE table_name=? AND record_key>? ORDER BY record_key LIMIT 64';
const decodedStoredBytes=(text:string)=>{
 if(!text.startsWith('["sensa-record-gzip-v1",'))return utf8(text);
 const value=JSON.parse(text);if(!Array.isArray(value)||value.length!==3||typeof value[2]!=='string')throw Error('sqlite_shared_content_invalid');
 const tail=Uint8Array.from(atob(value[2].slice(-12)),c=>c.charCodeAt(0));if(tail.length<4)throw Error('sqlite_shared_content_invalid');
 const size=new DataView(tail.buffer).getUint32(tail.length-4,true);if(size>recordBytes)throw Error('library_sync_capacity');return size;
};
const orderedTables=[...librarySyncTables].sort();
type StoredBody={digest:string;value_json:string;refs_json:string|null};
type Block={hash:string;data:string;plainBytes:number;storedBytes:number};
type Header={id:string;fence:string;after_key:string;state:string;records:number;logical_bytes:number;stored_bytes:number;maximum_page_bytes:number;unique_plain_bytes:number;unique_stored_bytes:number;block_count:number;last_page_json:string|null};
/** Disposable fixed-revision source capture. Rows never become facts or a cloud head. */
export class SqliteInitialPublication{
 private ready=false;
 private statements=new Map<string,PreparedStatement>();
 private admission:SyncAdmission|undefined;
 private dependencies:SqliteSyncDependencies;
 constructor(private db:Database,private assertFence:(f:ReplicaCandidateFence)=>void,private get:(table:SqliteLibraryTable,key:string)=>string|null,private assertOwner:(f:ReplicaCandidateFence)=>void){this.dependencies=new SqliteSyncDependencies(db);}
 private rows<T>(sql:string,bind:(string|number|null)[]=[]):T[]{
  let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}statement.reset(true);if(bind.length)statement.bind(bind);
  const result:T[]=[];try{while(statement.step())result.push(statement.get({}) as T);return result;}finally{statement.reset(true);}
 }
 close(){for(const statement of this.statements.values())statement.finalize();this.statements.clear();}
 private ensure(){if(this.ready)return;this.db.exec(`
 CREATE TABLE IF NOT EXISTS sensa_initial_publication(id TEXT PRIMARY KEY,fence TEXT NOT NULL,after_key TEXT NOT NULL,state TEXT NOT NULL,records INTEGER NOT NULL DEFAULT 0,logical_bytes INTEGER NOT NULL DEFAULT 0,stored_bytes INTEGER NOT NULL DEFAULT 0,maximum_page_bytes INTEGER NOT NULL DEFAULT 0,unique_plain_bytes INTEGER NOT NULL DEFAULT 0,unique_stored_bytes INTEGER NOT NULL DEFAULT 0,block_count INTEGER NOT NULL DEFAULT 0,last_page_json TEXT);
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_rows(id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,value_json TEXT NOT NULL,refs_json TEXT NOT NULL,shared INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(id,table_name,record_key));
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_blocks(id TEXT NOT NULL,hash TEXT NOT NULL,plain_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,hash));

 CREATE TABLE IF NOT EXISTS sensa_initial_publication_content(id TEXT NOT NULL,digest TEXT NOT NULL,value_json TEXT NOT NULL,refs_json TEXT,PRIMARY KEY(id,digest));
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_owners(id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(id,table_name,record_key,digest));
 `);this.ready=true;}
 private header(id:string,confirmed=false){this.ensure();const h=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(!h)throw Error('library_sync_candidate_invalid');if(confirmed||h.state!=='filling')this.assertOwner(JSON.parse(h.fence));else this.assertFence(JSON.parse(h.fence));return h;}
 begin(fence:ReplicaCandidateFence):string{
  this.admission=undefined;this.assertFence(fence);this.ensure();const id=crypto.randomUUID(),fenceJson=JSON.stringify(fence);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.exec('DELETE FROM sensa_initial_publication;DELETE FROM sensa_initial_publication_rows;DELETE FROM sensa_initial_publication_blocks;DELETE FROM sensa_initial_publication_content;DELETE FROM sensa_initial_publication_owners');
   this.rows("INSERT INTO sensa_initial_publication(id,fence,after_key,state,stored_bytes) VALUES(?,?,'null','filling',?)",[id,fenceJson,utf8(id)+utf8(fenceJson)+4+7]);this.db.exec('COMMIT');
  }catch(cause){this.db.exec('ROLLBACK');throw cause;}return id;
 }
 /** One table/range seek per bounded source window. A page commits sets once;
  * no row write, quota or statistics query visits previous page prefixes. */
 page(id:string,after:Position):InitialPublicationPage{
  const h=this.header(id),fence=JSON.parse(h.fence) as ReplicaCandidateFence;
  const prior=h.last_page_json?JSON.parse(h.last_page_json):undefined;
  if(prior&&JSON.stringify(prior.after)===JSON.stringify(after))return {kind:'publicationPage',blocks:[],rows:prior.rows,next:prior.next,done:prior.done,stats:this.stats(id)};
  if(JSON.stringify(after)!==h.after_key){
   throw Error('library_sync_candidate_invalid');
  }
  if(h.state!=='filling')throw Error('library_sync_candidate_invalid');
  const output:LibrarySyncManifest['rows']=[],prepared:Array<{table:string;key:string;valueJson:string;refsJson:string;shared:number}>=[],owners:Array<{table:string;key:string;digest:string}>=[];
  const newBodies=new Map<string,StoredBody>(),pageBlocks=new Map<string,Block>(),usedHashes=new Set<string>();
  let plain=0,wire=0,references=0,position=after,done=false,keysRead=0;
  let tableAt=after?orderedTables.indexOf(after.table as typeof librarySyncTables[number]):0,stop=false;
  if(tableAt<0)throw Error('library_sync_candidate_invalid');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   while(tableAt<orderedTables.length&&!stop){
    const table=orderedTables[tableAt],lower=position?.table===table?position.key:'';
    const keys=this.rows<{record_key:string;bytes:number}>(initialPublicationKeyPageSql,[table,lower]);keysRead+=keys.length;
    if(!keys.length){tableAt++;continue;}
    const selected:Array<{record_key:string;bytes:number}>=[];let physical=0;
    for(const key of keys){if(selected.length&&physical+key.bytes>1024*1024)break;if(key.bytes>recordBytes)throw Error('library_sync_capacity');selected.push(key);physical+=key.bytes;if(isReplicatedLibraryEntry(table,key.record_key)&&!canCopyNormalizedLibraryReplicaValue({table,key:key.record_key}))break;}
    const source=this.rows<{record_key:string;value_json:string}>('SELECT record_key,value_json FROM sensa_records WHERE table_name=? AND record_key IN(SELECT value FROM json_each(?)) ORDER BY record_key',[table,JSON.stringify(selected.map(k=>k.record_key))]);
    if(source.length!==selected.length)throw Error('library_sync_local_changed');
    const decodedSource:typeof source=[];let declared=0;
    for(const row of source){const size=decodedStoredBytes(row.value_json);if(decodedSource.length&&declared+size>pageBytes)break;decodedSource.push(row);declared+=size;}
    const inputs=decodedSource.map(row=>{
     if(!isReplicatedLibraryEntry(table,row.record_key))return {...row,skip:true,copy:false,shared:false,value:null,digests:[] as string[],occurrences:[] as string[]};
     const copy=canCopyNormalizedLibraryReplicaValue({table,key:row.record_key}),shared=copy&&sharedRecordTables.has(table);
     const text=copy?unpackStoredRecord(row.value_json,undefined,recordBytes):this.get(table,row.record_key);if(text===null||utf8(text)>recordBytes)throw Error('library_sync_capacity');
     const value=copy?JSON.parse(text):encodeBackupValue(normalizeLibraryReplicaEntry({table,key:row.record_key,value:decodeBackupValue(JSON.parse(text))},fence.identity).value),digests:string[]=[];
     const visit=(node:any,depth=0)=>{if(depth>80||!Array.isArray(node))throw Error('sqlite_shared_content_invalid');if(node[0]==='sensa-shared-content-v1'){digests.push(node[1]);return;}if(node[0]==='object')for(const pair of node[1])visit(pair[1],depth+1);else if(node[0]==='array')for(const child of node[1])visit(child,depth+1);};
     if(shared)visit(value);return {...row,skip:false,copy,shared,value,digests:[...new Set(digests)],occurrences:digests};
    });
    const requested=[...new Set(inputs.flatMap(row=>row.digests))];
    const metadata=requested.length?this.rows<{digest:string;bytes:number;refs_json:string|null}>('SELECT digest,length(CAST(value_json AS BLOB)) AS bytes,refs_json FROM sensa_initial_publication_content WHERE id=? AND digest IN(SELECT value FROM json_each(?))',[id,JSON.stringify(requested)]):[];
    const priorMetadata=new Map(metadata.map(row=>[row.digest,row])),missing=requested.filter(digest=>!priorMetadata.has(digest));
    const freshMetadata=missing.length?this.rows<{digest:string;bytes:number}>('SELECT digest,length(CAST(value_json AS BLOB)) AS bytes FROM sensa_shared_record_content WHERE digest IN(SELECT value FROM json_each(?))',[JSON.stringify(missing)]):[];
    const sizes=new Map([...metadata,...freshMetadata].map(row=>[row.digest,row.bytes]));
    if(sizes.size!==requested.length)throw Error('sqlite_shared_content_invalid');
    const bodyIds=new Set<string>();let bodyBytes=0,until=0;
    for(const row of inputs){const extra=row.digests.filter(digest=>!bodyIds.has(digest)).reduce((n,digest)=>n+sizes.get(digest)!,0);if(until&&bodyBytes+extra>pageBytes)break;if(extra>recordBytes)throw Error('library_sync_capacity');for(const digest of row.digests)bodyIds.add(digest);bodyBytes+=extra;until++;}
    const oldIds=[...bodyIds].filter(digest=>priorMetadata.has(digest)),freshIds=[...bodyIds].filter(digest=>!priorMetadata.has(digest));
    const old=oldIds.length?this.rows<StoredBody>('SELECT digest,value_json,refs_json FROM sensa_initial_publication_content WHERE id=? AND digest IN(SELECT value FROM json_each(?))',[id,JSON.stringify(oldIds)]):[];
    const fresh=freshIds.length?this.rows<StoredBody>('SELECT digest,value_json,NULL AS refs_json FROM sensa_shared_record_content WHERE digest IN(SELECT value FROM json_each(?))',[JSON.stringify(freshIds)]):[];
    const bodies=new Map([...old,...fresh].map(row=>[row.digest,row]));
    for(const row of inputs.slice(0,until)){
     if(row.skip){position={table,key:row.record_key};continue;}
     const texts=new Map<string,string>(),read=(digest:string)=>{const body=newBodies.get(digest)??bodies.get(digest);if(!body)throw Error('sqlite_shared_content_invalid');const text=unpackStoredRecord(body.value_json,undefined,recordBytes);if(!priorMetadata.has(digest)&&!newBodies.has(digest)&&sha256(text)!==digest)throw Error('sqlite_shared_content_invalid');texts.set(text,digest);return text;};
     let declaredRow=utf8(JSON.stringify(row.value));for(const digest of row.occurrences){const body=newBodies.get(digest)??bodies.get(digest)!;declaredRow+=decodedStoredBytes(body.value_json)-utf8(JSON.stringify(['sensa-shared-content-v1',digest]));}
     if(declaredRow>recordBytes)throw Error('library_sync_capacity');if(output.length&&plain+declaredRow>pageBytes){stop=true;break;}
     const segments=librarySyncRecordSegments(row.value,row.shared?read:undefined),size=segments.reduce((n,text)=>n+utf8(text),0);
     if(size>recordBytes)throw Error('library_sync_capacity');if(output.length&&(plain+size>pageBytes||output.length===64)){stop=true;break;}
     const encoded=new Map<string,Block>(),refs:string[]=[],contentRefs=new Map<string,string[]>();
     for(const segment of segments){
      const digest=texts.get(segment),body=digest?(newBodies.get(digest)??bodies.get(digest)):undefined;
      if(body?.refs_json){refs.push(...JSON.parse(body.refs_json));continue;}
      const segmentRefs:string[]=[];const pack=(text:string)=>{for(const part of splitLibrarySyncText(text)){const data=encodeLibrarySyncBlock(part),hash=sha256(data);segmentRefs.push(hash);refs.push(hash);const old=encoded.get(hash)??pageBlocks.get(hash);if(old&&old.data!==data)throw Error('library_sync_hash');encoded.set(hash,{hash,data,plainBytes:utf8(part),storedBytes:utf8(data)});}};
      let at=0;const media=/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;for(const match of segment.matchAll(media)){const start=match.index??0;pack(segment.slice(at,start));pack(match[0]);at=start+match[0].length;}pack(segment.slice(at));if(digest)contentRefs.set(digest,segmentRefs);
     }
     if(refs.length>2048)throw Error('library_sync_capacity');
     // Existing immutable body refs need only indexed size metadata; no payload inventory scan.
     const rowHashes=[...new Set(refs)],known=rowHashes.filter(hash=>!encoded.has(hash)&&!pageBlocks.has(hash));
     const measured=known.length?this.rows<{hash:string;stored_bytes:number}>('SELECT hash,stored_bytes FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify(known)]):[];
     const sizesByHash=new Map(measured.map(block=>[block.hash,block.stored_bytes]));if(sizesByHash.size!==known.length)throw Error('library_sync_missing_block');
     const extra=rowHashes.filter(hash=>!usedHashes.has(hash)).reduce((n,hash)=>n+(encoded.get(hash)?.storedBytes??pageBlocks.get(hash)?.storedBytes??sizesByHash.get(hash)!),0);
     if(output.length&&(references+refs.length>librarySyncMetadataPageRefs||wire+extra>pageBytes)){stop=true;break;}
     for(const [hash,block]of encoded)pageBlocks.set(hash,block);for(const hash of rowHashes)usedHashes.add(hash);
     for(const digest of row.digests){const body=newBodies.get(digest)??bodies.get(digest)!;const blockRefs=contentRefs.get(digest);if(!priorMetadata.has(digest))newBodies.set(digest,{...body,refs_json:blockRefs?JSON.stringify(blockRefs):body.refs_json});owners.push({table,key:row.record_key,digest});}
     const valueJson=row.copy?row.value_json:packStoredRecord(JSON.stringify(row.value)),refsJson=JSON.stringify(refs);
     prepared.push({table,key:row.record_key,valueJson,refsJson,shared:row.shared?1:0});output.push({table,key:row.record_key,blocks:refs});plain+=size;wire+=extra;references+=refs.length;position={table,key:row.record_key};
    }
    if(keysRead>=512||output.length===64)stop=true;
    if(!stop&&until===inputs.length&&decodedSource.length===source.length&&selected.length===keys.length&&keys.length<64)tableAt++;
   }
   done=tableAt===orderedTables.length;
   const priorBlocks=pageBlocks.size?this.rows<{hash:string;data:string}>('SELECT hash,data FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify([...pageBlocks.keys()])]):[];
   for(const old of priorBlocks)if(pageBlocks.get(old.hash)!.data!==old.data)throw Error('library_sync_hash');
   const existing=new Set(priorBlocks.map(block=>block.hash)),added=[...pageBlocks.values()].filter(block=>!existing.has(block.hash));
   const storedRows=prepared.reduce((n,row)=>n+utf8(id)+utf8(row.table)+utf8(row.key)+utf8(row.valueJson)+utf8(row.refsJson),0),storedBlocks=added.reduce((n,b)=>n+utf8(id)+utf8(b.hash)+b.storedBytes,0);
   const storedContent=[...newBodies.values()].reduce((n,b)=>n+utf8(id)+utf8(b.digest)+utf8(b.value_json)+utf8(b.refs_json??''),0),storedOwners=owners.reduce((n,o)=>n+utf8(id)+utf8(o.table)+utf8(o.key)+utf8(o.digest),0);
   const nextJson=JSON.stringify(position),state=done?'sealed':'filling',lastPage=JSON.stringify({after,next:position,done,rows:output}),headerDelta=utf8(nextJson)-utf8(h.after_key)+utf8(state)-utf8(h.state)+utf8(lastPage)-utf8(h.last_page_json??'');
   const stored=storedRows+storedBlocks+storedContent+storedOwners+headerDelta;
   if(h.records+output.length>200000||h.logical_bytes+plain>logicalBytes||h.stored_bytes+stored>storedBytes)throw Error('library_sync_capacity');
   this.rows(`INSERT INTO sensa_initial_publication_content SELECT ?,json_extract(value,'$.digest'),json_extract(value,'$.value_json'),json_extract(value,'$.refs_json') FROM json_each(?)`,[id,JSON.stringify([...newBodies.values()])]);
   const inserted=this.rows<{plain_bytes:number;stored_bytes:number}>(`INSERT INTO sensa_initial_publication_blocks SELECT ?,json_extract(value,'$.hash'),json_extract(value,'$.plainBytes'),json_extract(value,'$.storedBytes'),json_extract(value,'$.data') FROM json_each(?) WHERE true ON CONFLICT DO NOTHING RETURNING plain_bytes,stored_bytes`,[id,JSON.stringify([...pageBlocks.values()])]);
   this.rows(`INSERT INTO sensa_initial_publication_rows SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.valueJson'),json_extract(value,'$.refsJson'),json_extract(value,'$.shared') FROM json_each(?)`,[id,JSON.stringify(prepared)]);
   this.rows(`INSERT INTO sensa_initial_publication_owners SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.digest') FROM json_each(?)`,[id,JSON.stringify(owners)]);
   this.assertFence(fence);
   this.rows('UPDATE sensa_initial_publication SET after_key=?,state=?,last_page_json=?,records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+?,maximum_page_bytes=max(maximum_page_bytes,?),unique_plain_bytes=unique_plain_bytes+?,unique_stored_bytes=unique_stored_bytes+?,block_count=block_count+? WHERE id=?',[nextJson,state,lastPage,output.length,plain,stored,plain+wire,inserted.reduce((n,b)=>n+b.plain_bytes,0),inserted.reduce((n,b)=>n+b.stored_bytes,0),inserted.length,id]);this.db.exec('COMMIT');
   return {kind:'publicationPage',blocks:[],rows:output,next:position,done,stats:this.stats(id)};
  }catch(cause){this.db.exec('ROLLBACK');throw cause;}
 }
 blocks(id:string,hashes:string[]){
  this.header(id);if(!hashes.length||hashes.length>512)throw Error('library_sync_candidate_invalid');
  const measured=this.rows<{hash:string;stored_bytes:number}>('SELECT hash,stored_bytes FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify(hashes)]),sizes=new Map(measured.map(row=>[row.hash,row.stored_bytes]));
  const selected:string[]=[],deferred:string[]=[];let raw=0;
  for(const hash of hashes){const size=sizes.get(hash);if(size===undefined)throw Error('library_sync_missing_block');if(selected.length&&(selected.length===128||raw+size>3*1024*1024)){deferred.push(hash);continue;}selected.push(hash);raw+=size;}
  const found=this.rows<{hash:string;data:string}>('SELECT hash,data FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify(selected)]),data=new Map(found.map(row=>[row.hash,row.data]));
  const blocks:Array<{hash:string;data:string}>=[];let bytes=13;for(const hash of selected){const block={hash,data:data.get(hash)!},cost=utf8(JSON.stringify(block))+1;if(bytes+cost>3*1024*1024){deferred.push(hash);continue;}blocks.push(block);bytes+=cost;}
  if(!blocks.length)throw Error('library_sync_capacity');return {kind:'publicationBlocks' as const,blocks,deferred};
 }
 private plain(id:string,row:{value_json:string;shared:number}){const text=unpackStoredRecord(row.value_json,undefined,recordBytes);if(!row.shared)return text;return JSON.stringify(expandSharedRecordContent(JSON.parse(text),digest=>{const body=this.rows<{value_json:string}>('SELECT value_json FROM sensa_initial_publication_content WHERE id=? AND digest=?',[id,digest])[0];return body?unpackStoredRecord(body.value_json,undefined,recordBytes):undefined;}));}
 stats(id:string,confirmed=false):InitialPublicationStats{this.ensure();const h=confirmed?this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0]:this.header(id);if(!h)throw Error('library_sync_candidate_invalid');if(confirmed)this.assertOwner(JSON.parse(h.fence));return {records:h.records,logicalBytes:h.logical_bytes,uniqueBlockPlainBytes:h.unique_plain_bytes,uniqueBlockStoredBytes:h.unique_stored_bytes,storedPayloadBytes:h.stored_bytes,blocks:h.block_count,maximumPageBytes:h.maximum_page_bytes};}
 async validate(id:string,confirmed=false):Promise<InitialPublicationStats>{
  const h=this.header(id,confirmed);if(h.state==='validated'&&this.admission)return this.stats(id,confirmed);if(h.state!=='sealed'&&h.state!=='validated')throw Error('library_sync_candidate_invalid');
  const alive=()=>{this.header(id,confirmed);};
  const admission=syncAdmission();this.dependencies.ensure();
  const reader=sealedRecordReader({alive,beforePage:alive,
   get:(table,key)=>this.rows<{record_key:string;value_json:string;shared:number}>('SELECT record_key,value_json,shared FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key])[0],
   has:(table,key)=>this.rows('SELECT 1 FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key]).length>0,
   keys:(table,after)=>this.rows<{record_key:string;stored_value_bytes:number}>(`SELECT record_key,length(CAST(value_json AS BLOB)) AS stored_value_bytes FROM sensa_initial_publication_rows WHERE id=? AND table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64`,after===null?[id,table]:[id,table,after]),
   rows:(table,keys)=>this.rows<{record_key:string;value_json:string;shared:number}>('SELECT record_key,value_json,shared FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key IN(SELECT value FROM json_each(?)) ORDER BY record_key',[id,table,JSON.stringify(keys)]),
   observed:(table,key,text,value)=>{if(!admission.rows.has(JSON.stringify([table,key])))this.dependencies.observe(admission,table,key,text,value,()=>false,this.rows<{n:number}>('SELECT length(CAST(value_json AS BLOB))+2*length(CAST(refs_json AS BLOB))+72*json_array_length(refs_json) AS n FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key])[0].n);},
   plain:(_table,row)=>this.plain(id,row),missing:()=>{throw Error('library_sync_candidate_invalid');},
  });
  const {validateLibraryRestoreRecordsCooperatively}=await import('./backupValidation');await validateLibraryRestoreRecordsCooperatively(reader);alive();
  const stateDelta=utf8('validated')-utf8(h.state);if(h.stored_bytes+stateDelta>storedBytes)throw Error('library_sync_capacity');
  this.rows("UPDATE sensa_initial_publication SET state='validated',stored_bytes=stored_bytes+? WHERE id=?",[stateDelta,id]);this.admission=admission;return this.stats(id,confirmed);
 }
 /** Inside the sole baseline/state transaction; no live fact is rewritten. */
 confirm(id:string,mutation:SqliteMutation){
  this.ensure();const h=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(!h)throw Error('library_sync_candidate_invalid');const fence=JSON.parse(h.fence) as ReplicaCandidateFence;this.assertOwner(fence);
  if(h.state!=='validated'||mutation.syncBaseReplacement||mutation.syncBasePatch||mutation.replicaCandidateRestore||mutation.contentRevision!==undefined||mutation.clears.length||mutation.deletes.some(row=>row.table!=='meta'||row.key!=='local-reset')||mutation.puts.some(row=>row.table!=='meta'||row.key!=='cloud-sync'))throw Error('library_sync_candidate_invalid');
  const stateRow=mutation.puts.find(row=>row.key==='cloud-sync');if(!stateRow)throw Error('library_sync_candidate_invalid');
  const state=decodeBackupValue(JSON.parse(stateRow.encodedValue));if(state.publicationOperationId!==id||state.syncedLocalRevision!==fence.localRevision||!['synced','pending'].includes(state.status))throw Error('library_sync_candidate_invalid');
  this.rows('INSERT INTO sensa_shared_record_content SELECT digest,value_json FROM sensa_initial_publication_content WHERE id=? ON CONFLICT DO NOTHING',[id]);
  this.rows("INSERT INTO sensa_shared_record_content_owners SELECT 'sync',table_name,record_key,digest FROM sensa_initial_publication_owners WHERE id=?",[id]);
  this.rows('INSERT INTO sensa_sync_base SELECT table_name,record_key,value_json,refs_json FROM sensa_initial_publication_rows WHERE id=? AND shared=1',[id]);
  this.rows('INSERT INTO sensa_sync_base SELECT table_name,record_key,value_json,refs_json FROM sensa_initial_publication_rows WHERE id=? AND shared=0',[id]);
 }
 certify(state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number){if(this.admission)this.dependencies.certify(this.admission,state,identity,artifactRevision);}
 discard(id:string){for(const table of ['sensa_initial_publication_owners','sensa_initial_publication_content','sensa_initial_publication_rows','sensa_initial_publication_blocks','sensa_initial_publication'])this.db.exec({sql:`DELETE FROM ${table} WHERE id=?`,bind:[id]});}
}
