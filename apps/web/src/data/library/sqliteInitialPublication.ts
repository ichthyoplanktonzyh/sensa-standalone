import type {Database,PreparedStatement} from '@sqlite.org/sqlite-wasm';
import {librarySyncRecordLimit,librarySyncLogicalByteLimit,librarySyncTables,librarySyncMetadataPageRefs,type LibrarySyncManifest} from '@sensa/contracts/sensa';
import {cloudScratchPayloadBytes,cloudScratchAllocatedBytes} from './cloudScratchStorage';
import {encodeLibrarySyncBlock,decodeLibrarySyncBlock,librarySyncRecordSegments,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue,decodeBackupValue,backupEqual} from './backupCodec';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,canCopyNormalizedLibraryReplicaValue} from './replication/libraryReplica';
import {packStoredRecord,unpackStoredRecord,expandSharedRecordContent,sharedRecordTables} from './sharedRecordContent';
import {sealedRecordReader} from './sealedRecordReader';
import type {ReplicaCandidateFence,InitialPublicationPage,InitialPublicationStats} from './replicaCandidateProtocol';
import {SqliteSyncDependencies,syncAdmission,type SyncAdmission} from './sqliteSyncDependencies';
import type {CloudSyncState} from './cloudSync';
import type {LibraryIdentity} from './store';
import {sqliteSyncBaseSchema,type SqliteLibraryTable,type SqliteMutation} from './sqliteProtocol';
import {SqlitePublicationBaseline} from './sqlitePublicationBaseline';
const utf8=(text:string)=>new TextEncoder().encode(text).length;
const pageBytes=4*1024*1024,recordBytes=90*1024*1024,logicalBytes=librarySyncLogicalByteLimit,storedBytes=cloudScratchPayloadBytes;
type Position={table:SqliteLibraryTable;key:string}|null;
export const initialPublicationKeyPageSql='SELECT record_key,length(CAST(value_json AS BLOB)) AS bytes FROM sensa_records WHERE table_name=? AND record_key>? ORDER BY record_key LIMIT 64';
export const initialPublicationIndexAfterSql='SELECT table_name,record_key,length(CAST(refs_json AS BLOB)) AS bytes,json_array_length(refs_json) AS refs FROM sensa_initial_publication_rows WHERE id=? AND (table_name,record_key)>(?,?) ORDER BY table_name,record_key LIMIT 64';
const decodedStoredBytes=(text:string)=>{
 if(!text.startsWith('["sensa-record-gzip-v1",'))return utf8(text);
 const value=JSON.parse(text);if(!Array.isArray(value)||value.length!==3||typeof value[2]!=='string')throw Error('sqlite_shared_content_invalid');
 const tail=Uint8Array.from(atob(value[2].slice(-12)),c=>c.charCodeAt(0));if(tail.length<4)throw Error('sqlite_shared_content_invalid');
 const size=new DataView(tail.buffer).getUint32(tail.length-4,true);if(size>recordBytes)throw Error('library_sync_capacity');return size;
};
const orderedTables=[...librarySyncTables].sort();
type StoredBody={digest:string;value_json:string;refs_json:string|null};
type Block={hash:string;data:string;plainBytes:number;storedBytes:number;sourceJson:string};
type FrozenFragment=({digest:string}|{table:SqliteLibraryTable;key:string;segment:number})&{start:number;length:number};
type StoredBlock={hash:string;data:string;source_json:string|null;plain_bytes:number;stored_bytes:number};
type Header={id:string;fence:string;after_key:string;state:string;records:number;logical_bytes:number;stored_bytes:number;maximum_page_bytes:number;unique_plain_bytes:number;unique_stored_bytes:number;block_count:number;last_page_json:string|null;allocated_baseline:number|null;source_epoch:number;authorized_epoch:number;baseline_started:number;baseline_records:number;baseline_after:string};
/** Disposable fixed-revision source capture. Rows never become facts or a cloud head. */
export class SqliteInitialPublication{
 private ready=false;
 private statements=new Map<string,PreparedStatement>();
 private admission:SyncAdmission|undefined;
 private admissionPolicy:'external'|'own-cloud'|'captured-own'|undefined;
 private indexedRecords=0;
 private dependencies:SqliteSyncDependencies;
 private baseline:SqlitePublicationBaseline;
 private validatedEpoch:number|undefined;
 private preparedArtifact:number|undefined;
 private preparing:{id:string;controller:AbortController;promise:Promise<void>}|undefined;
 private closing=false;
 constructor(private db:Database,private assertFence:(f:ReplicaCandidateFence)=>void,private get:(table:SqliteLibraryTable,key:string)=>string|null,private assertOwner:(f:ReplicaCandidateFence)=>void,private checkSpace:()=>Promise<void>=async()=>{},private artifactRevision:()=>number=()=>0){this.dependencies=new SqliteSyncDependencies(db);this.baseline=new SqlitePublicationBaseline(db,this.dependencies,(id,ownedChanges=0)=>{if(this.preparing?.controller.signal.aborted)throw Error('library_sync_cancelled');const h=this.header(id,true);if(h.state!=='validated'||(this.validatedEpoch??-1)+ownedChanges!==h.source_epoch||this.preparedArtifact!==this.artifactRevision())throw Error('library_sync_candidate_invalid');return {epoch:h.source_epoch,records:h.records,started:!!h.baseline_started,preparedRecords:h.baseline_records,after:JSON.parse(h.baseline_after) as Position};},()=>{if(this.preparing)this.assertAllocatedCapacity(this.header(this.preparing.id,true));},epoch=>{this.validatedEpoch=epoch;});}
 private rows<T>(sql:string,bind:(string|number|null)[]=[]):T[]{
  // Bound each captured/prepared range before combining it. A final merge
  // sees at most two key pages, rather than sorting an entire frozen source.
  if(sql.startsWith('SELECT')&&sql.includes('FROM sensa_initial_publication_rows')&&(!/rowid/u.test(sql)||/value_json|refs_json/u.test(sql))){
   const prepared=sql.replace(/FROM sensa_initial_publication_rows\b/u,`FROM (SELECT header.id,prepared.table_name,prepared.record_key,prepared.value_json,prepared.block_refs_json AS refs_json,CASE WHEN shared.record_key IS NULL THEN 0 ELSE 1 END AS shared FROM sensa_initial_publication header JOIN sensa_initial_publication_baseline prepared LEFT JOIN sensa_initial_publication_shared shared ON shared.id=header.id AND shared.table_name=prepared.table_name AND shared.record_key=prepared.record_key WHERE header.baseline_started=1 AND header.state IN('sealed','validated'))`);
   const order=sql.match(/ ORDER BY ([\w.,]+)(?: LIMIT \d+)?$/u)?.[1].replace(/\brow\./gu,''),limit=sql.match(/ LIMIT (\d+)$/u)?.[1];
   sql=`SELECT * FROM (${sql}) UNION ALL SELECT * FROM (${prepared})${order?' ORDER BY '+order:''}${limit?' LIMIT '+limit:''}`;bind=[...bind,...bind];
  }
  let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}statement.reset(true);if(bind.length)statement.bind(bind);
  const result:T[]=[];try{while(statement.step())result.push(statement.get({}) as T);return result;}finally{statement.reset(true);}
 }
 close(){this.closing=true;this.preparing?.controller.abort();for(const statement of this.statements.values())statement.finalize();this.statements.clear();this.baseline.close();this.dependencies.close();}
 async settle(){this.closing=true;this.preparing?.controller.abort();await this.preparing?.promise.catch(()=>{});}
 private ensure(){if(this.ready)return;this.db.exec(`
 CREATE TABLE IF NOT EXISTS sensa_initial_publication(id TEXT PRIMARY KEY,fence TEXT NOT NULL,after_key TEXT NOT NULL,state TEXT NOT NULL,records INTEGER NOT NULL DEFAULT 0,logical_bytes INTEGER NOT NULL DEFAULT 0,stored_bytes INTEGER NOT NULL DEFAULT 0,maximum_page_bytes INTEGER NOT NULL DEFAULT 0,unique_plain_bytes INTEGER NOT NULL DEFAULT 0,unique_stored_bytes INTEGER NOT NULL DEFAULT 0,block_count INTEGER NOT NULL DEFAULT 0,last_page_json TEXT);
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_rows(id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,value_json TEXT NOT NULL,refs_json TEXT NOT NULL,shared INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(id,table_name,record_key));
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_blocks(id TEXT NOT NULL,hash TEXT NOT NULL,plain_bytes INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,hash));

 CREATE TABLE IF NOT EXISTS sensa_initial_publication_content(id TEXT NOT NULL,digest TEXT NOT NULL,value_json TEXT NOT NULL,refs_json TEXT,PRIMARY KEY(id,digest));
 CREATE TABLE IF NOT EXISTS sensa_initial_publication_owners(id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(id,table_name,record_key,digest));
 `);
 // Retained uncertain-ACK sources from older code keep their exact bytes. New
 // blocks have an empty data column and only a locator into the frozen source.
 if(!this.rows<{name:string}>('PRAGMA table_info(sensa_initial_publication_blocks)').some(row=>row.name==='source_json'))this.db.exec('ALTER TABLE sensa_initial_publication_blocks ADD COLUMN source_json TEXT');
 if(!this.rows<{name:string}>('PRAGMA table_info(sensa_initial_publication)').some(row=>row.name==='allocated_baseline'))this.db.exec('ALTER TABLE sensa_initial_publication ADD COLUMN allocated_baseline INTEGER');
 if(!this.rows<{name:string}>('PRAGMA table_info(sensa_initial_publication)').some(row=>row.name==='source_epoch'))this.db.exec('ALTER TABLE sensa_initial_publication ADD COLUMN source_epoch INTEGER NOT NULL DEFAULT 0');
 const columns=new Set(this.rows<{name:string}>('PRAGMA table_info(sensa_initial_publication)').map(row=>row.name));
 for(const [name,type] of [['authorized_epoch','INTEGER NOT NULL DEFAULT 0'],['baseline_started','INTEGER NOT NULL DEFAULT 0'],['baseline_records','INTEGER NOT NULL DEFAULT 0'],['baseline_after',"TEXT NOT NULL DEFAULT 'null'"]])if(!columns.has(name))this.db.exec(`ALTER TABLE sensa_initial_publication ADD COLUMN ${name} ${type}`);
 this.db.exec(sqliteSyncBaseSchema.replace('sensa_sync_base','sensa_initial_publication_baseline'));this.db.exec('CREATE TABLE IF NOT EXISTS sensa_initial_publication_shared(id TEXT NOT NULL,table_name TEXT NOT NULL,record_key TEXT NOT NULL,PRIMARY KEY(id,table_name,record_key))');
 for(const action of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS sensa_initial_publication_shared_${action.toLowerCase()}_epoch AFTER ${action} ON sensa_initial_publication_shared BEGIN UPDATE sensa_initial_publication SET source_epoch=source_epoch+1 WHERE id=${action==='DELETE'?'OLD':'NEW'}.id AND state NOT IN('filling','retiring');END`);
 for(const action of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS sensa_publication_baseline_source_${action.toLowerCase()} AFTER ${action} ON sensa_initial_publication_baseline BEGIN UPDATE sensa_initial_publication SET source_epoch=source_epoch+1 WHERE baseline_started=1 AND state NOT IN('filling','retiring');END`);

 for(const table of ['rows','blocks','content','owners'])for(const action of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS sensa_initial_publication_${table}_${action.toLowerCase()}_epoch AFTER ${action} ON sensa_initial_publication_${table} WHEN (SELECT state FROM sensa_initial_publication WHERE id=${action==='DELETE'?'OLD':'NEW'}.id) NOT IN('filling','retiring') BEGIN UPDATE sensa_initial_publication SET source_epoch=source_epoch+1 WHERE id=${action==='DELETE'?'OLD':'NEW'}.id;END`);
 this.dependencies.ensure();for(const action of ['INSERT','UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS sensa_initial_publication_admission_${action.toLowerCase()}_epoch AFTER ${action} ON sensa_sync_admission_rows_v1 BEGIN UPDATE sensa_initial_publication SET source_epoch=source_epoch+1 WHERE 'publication:'||id=${action==='DELETE'?'OLD':'NEW'}.scope AND state NOT IN('filling','retiring');END`);
 this.ready=true;}
 private allocatedBytes(){return (Number(this.db.selectValue('PRAGMA page_count'))-Number(this.db.selectValue('PRAGMA freelist_count')))*Number(this.db.selectValue('PRAGMA page_size'));}
 private assertAllocatedCapacity(h:Header){if(this.allocatedBytes()-(h.allocated_baseline??0)>cloudScratchAllocatedBytes)throw Error('library_sync_capacity');}
 private header(id:string,confirmed=false){if(this.closing)throw Error('sqlite_database_closed');this.ensure();const h=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(!h||h.state==='retiring'||h.source_epoch!==h.authorized_epoch)throw Error('library_sync_candidate_invalid');if(confirmed||h.state!=='filling')this.assertOwner(JSON.parse(h.fence));else this.assertFence(JSON.parse(h.fence));return h;}
 begin(fence:ReplicaCandidateFence):string{
  this.preparing?.controller.abort();this.validatedEpoch=undefined;this.preparedArtifact=undefined;this.admission=undefined;this.admissionPolicy='captured-own';this.indexedRecords=0;this.assertFence(fence);this.ensure();const id=crypto.randomUUID(),fenceJson=JSON.stringify(fence);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.exec('DELETE FROM sensa_initial_publication;DELETE FROM sensa_initial_publication_rows;DELETE FROM sensa_initial_publication_blocks;DELETE FROM sensa_initial_publication_content;DELETE FROM sensa_initial_publication_owners;DELETE FROM sensa_initial_publication_shared');
   this.dependencies.ensure();this.rows("DELETE FROM sensa_sync_admission_v1 WHERE scope LIKE 'publication:%'");
   const baseline=this.allocatedBytes();
   this.rows("INSERT INTO sensa_initial_publication(id,fence,after_key,state,stored_bytes,allocated_baseline) VALUES(?,?,'null','filling',?,?)",[id,fenceJson,utf8(id)+utf8(fenceJson)+4+7,baseline]);this.admission=this.dependencies.spoolAdmission('publication:'+id,true);this.db.exec('COMMIT');
  }catch(cause){this.db.exec('ROLLBACK');throw cause;}return id;
 }
 /** One table/range seek per bounded source window. A page commits sets once;
  * no row write, quota or statistics query visits previous page prefixes. */
 async page(id:string,after:Position):Promise<InitialPublicationPage>{
  let h=this.header(id);const fence=JSON.parse(h.fence) as ReplicaCandidateFence;
  const prior=h.last_page_json?JSON.parse(h.last_page_json):undefined;
  if(prior&&JSON.stringify(prior.after)===JSON.stringify(after))return {kind:'publicationPage',blocks:[],rows:prior.rows,next:prior.next,done:prior.done,stats:this.stats(id)};
  if(JSON.stringify(after)!==h.after_key){
   throw Error('library_sync_candidate_invalid');
  }
  if(h.state!=='filling')throw Error('library_sync_candidate_invalid');
  // ACK-loss replays above consume no new space. Recheck the source fence
  // after this advisory asynchronous estimate and before opening a transaction.
  await this.checkSpace();h=this.header(id);
  const saved=h.last_page_json?JSON.parse(h.last_page_json):undefined;
  if(saved&&JSON.stringify(saved.after)===JSON.stringify(after))return {kind:'publicationPage',blocks:[],rows:saved.rows,next:saved.next,done:saved.done,stats:this.stats(id)};
  if(JSON.stringify(after)!==h.after_key||h.state!=='filling')throw Error('library_sync_candidate_invalid');
  const output:LibrarySyncManifest['rows']=[],prepared:Array<{table:string;key:string;valueJson:string;refsJson:string;shared:number}>=[],owners:Array<{table:string;key:string;digest:string}>=[];
  const newBodies=new Map<string,StoredBody>(),pageBlocks=new Map<string,Block>(),usedHashes=new Set<string>();
  const pageAdmission=syncAdmission();
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
     for(const [segmentIndex,segment] of segments.entries()){
      const digest=texts.get(segment),body=digest?(newBodies.get(digest)??bodies.get(digest)):undefined;
      if(body?.refs_json){refs.push(...JSON.parse(body.refs_json));continue;}
      const segmentRefs:string[]=[];const pack=(text:string,start:number)=>{let offset=start;for(const part of splitLibrarySyncText(text)){const data=encodeLibrarySyncBlock(part),hash=sha256(data);segmentRefs.push(hash);refs.push(hash);const old=encoded.get(hash)??pageBlocks.get(hash);if(old&&old.data!==data)throw Error('library_sync_hash');const source:FrozenFragment={...(digest?{digest}:{table,key:row.record_key,segment:segmentIndex}),start:offset,length:part.length};encoded.set(hash,{hash,data,plainBytes:utf8(part),storedBytes:utf8(data),sourceJson:JSON.stringify(source)});offset+=part.length;}};
      let at=0;const media=/data:(?:image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu;for(const match of segment.matchAll(media)){const start=match.index??0;pack(segment.slice(at,start),at);pack(match[0],start);at=start+match[0].length;}pack(segment.slice(at),at);if(digest)contentRefs.set(digest,segmentRefs);
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
     if(this.admission&&!this.admission.disabled){
      // The exact wire already exists in this bounded capture window. Index
      // metadata now; do not later decode every retained material again.
      const text=segments.join(''),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),value=>value.toString(16).padStart(2,'0')).join('');
      this.dependencies.observe(pageAdmission,table,row.record_key,text,decodeBackupValue(JSON.parse(text)),()=>false,utf8(valueJson)+2*utf8(refsJson)+72*refs.length,digest);
     }
     prepared.push({table,key:row.record_key,valueJson,refsJson,shared:row.shared?1:0});output.push({table,key:row.record_key,blocks:refs});plain+=size;wire+=extra;references+=refs.length;position={table,key:row.record_key};
    }
    if(keysRead>=512||output.length===64)stop=true;
    if(!stop&&until===inputs.length&&decodedSource.length===source.length&&selected.length===keys.length&&keys.length<64)tableAt++;
   }
   done=tableAt===orderedTables.length;
   const priorBlocks=pageBlocks.size?this.rebuild(id,this.rows<StoredBlock>('SELECT hash,data,source_json,plain_bytes,stored_bytes FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify([...pageBlocks.keys()])])):[];
   for(const old of priorBlocks)if(pageBlocks.get(old.hash)!.data!==old.data)throw Error('library_sync_hash');
   const existing=new Set(priorBlocks.map(block=>block.hash)),added=[...pageBlocks.values()].filter(block=>!existing.has(block.hash));
   const storedRows=prepared.reduce((n,row)=>n+utf8(id)+utf8(row.table)+utf8(row.key)+utf8(row.valueJson)+utf8(row.refsJson),0),storedBlocks=added.reduce((n,b)=>n+utf8(id)+utf8(b.hash)+utf8(b.sourceJson),0);
   const storedContent=[...newBodies.values()].reduce((n,b)=>n+utf8(id)+utf8(b.digest)+utf8(b.value_json)+utf8(b.refs_json??''),0),storedOwners=owners.reduce((n,o)=>n+utf8(id)+utf8(o.table)+utf8(o.key)+utf8(o.digest),0);
   const nextJson=JSON.stringify(position),state=done?'sealed':'filling',lastPage=JSON.stringify({after,next:position,done,rows:output}),headerDelta=utf8(nextJson)-utf8(h.after_key)+utf8(state)-utf8(h.state)+utf8(lastPage)-utf8(h.last_page_json??'');
   const priorObservationBytes=this.admission?.retainedMetadataBytes?.()??0;
   if(this.admission?.scope){for(const [key,row]of pageAdmission.rows)this.admission.rows.set(key,row);this.admission.flush?.(true);}
   const observationBytes=(this.admission?.retainedMetadataBytes?.()??0)-priorObservationBytes;
   const stored=storedRows+storedBlocks+storedContent+storedOwners+headerDelta+observationBytes;
   if(h.records+output.length>librarySyncRecordLimit||h.logical_bytes+plain>logicalBytes||h.stored_bytes+stored>storedBytes)throw Error('library_sync_capacity');
   this.rows(`INSERT INTO sensa_initial_publication_content SELECT ?,json_extract(value,'$.digest'),json_extract(value,'$.value_json'),json_extract(value,'$.refs_json') FROM json_each(?)`,[id,JSON.stringify([...newBodies.values()])]);
   const inserted=this.rows<{plain_bytes:number;stored_bytes:number}>(`INSERT INTO sensa_initial_publication_blocks(id,hash,plain_bytes,stored_bytes,data,source_json) SELECT ?,json_extract(value,'$.hash'),json_extract(value,'$.plainBytes'),json_extract(value,'$.storedBytes'),'',json_extract(value,'$.sourceJson') FROM json_each(?) WHERE true ON CONFLICT DO NOTHING RETURNING plain_bytes,stored_bytes`,[id,JSON.stringify([...pageBlocks.values()].map(({data,...block})=>block))]);
   this.rows(`INSERT INTO sensa_initial_publication_rows SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.valueJson'),json_extract(value,'$.refsJson'),json_extract(value,'$.shared') FROM json_each(?)`,[id,JSON.stringify(prepared)]);
   this.rows(`INSERT INTO sensa_initial_publication_owners SELECT ?,json_extract(value,'$.table'),json_extract(value,'$.key'),json_extract(value,'$.digest') FROM json_each(?)`,[id,JSON.stringify(owners)]);
   this.assertFence(fence);
   this.rows('UPDATE sensa_initial_publication SET after_key=?,state=?,last_page_json=?,records=records+?,logical_bytes=logical_bytes+?,stored_bytes=stored_bytes+?,maximum_page_bytes=max(maximum_page_bytes,?),unique_plain_bytes=unique_plain_bytes+?,unique_stored_bytes=unique_stored_bytes+?,block_count=block_count+? WHERE id=?',[nextJson,state,lastPage,output.length,plain,stored,plain+wire,inserted.reduce((n,b)=>n+b.plain_bytes,0),inserted.reduce((n,b)=>n+b.stored_bytes,0),inserted.length,id]);this.assertAllocatedCapacity(h);this.db.exec('COMMIT');
   if(this.admissionPolicy==='captured-own'&&this.admission){
    const target=this.admission;this.indexedRecords+=prepared.length;target.metadataBytes=target.retainedMetadataBytes?.()??target.metadataBytes+pageAdmission.metadataBytes;target.logicalBytes+=pageAdmission.logicalBytes;target.storedBytes+=pageAdmission.storedBytes;target.packageCacheComplete&&=pageAdmission.packageCacheComplete;
    if(pageAdmission.disabled||!target.scope&&target.metadataBytes>16*1024*1024){target.disabled='dependency_metadata_capacity';target.rows.clear();}else if(!target.disabled&&!target.scope)for(const [key,row]of pageAdmission.rows)target.rows.set(key,row);
   }
   return {kind:'publicationPage',blocks:[],rows:output,next:position,done,stats:this.stats(id)};
  }catch(cause){this.db.exec('ROLLBACK');throw cause;}
 }
 /** Stream only bounded refs after local capture is sealed; no body inventory. */
 indexPage(id:string,after:Position){
  const h=this.header(id);if(!['sealed','validated'].includes(h.state))throw Error('library_sync_candidate_invalid');
  // Keep the cursor predicate outside an OR so SQLite seeks the tuple range
  // instead of rescanning the already returned prefix on every page.
  const measured=this.rows<{table_name:SqliteLibraryTable;record_key:string;bytes:number;refs:number}>(after?initialPublicationIndexAfterSql:'SELECT table_name,record_key,length(CAST(refs_json AS BLOB)) AS bytes,json_array_length(refs_json) AS refs FROM sensa_initial_publication_rows WHERE id=? ORDER BY table_name,record_key LIMIT 64',after?[id,after.table,after.key]:[id]);
  const keys:Array<[string,string]>=[];let bytes=0,refs=0;for(const row of measured){if(keys.length&&(refs+row.refs>librarySyncMetadataPageRefs||bytes+row.bytes+utf8(row.record_key)>pageBytes))break;keys.push([row.table_name,row.record_key]);refs+=row.refs;bytes+=row.bytes+utf8(row.record_key);}
  const selected=keys.length?this.rows<{table_name:typeof librarySyncTables[number];record_key:string;refs_json:string}>('SELECT table_name,record_key,refs_json FROM sensa_initial_publication_rows WHERE id=? AND (table_name,record_key) IN(SELECT json_extract(value,\'$[0]\'),json_extract(value,\'$[1]\') FROM json_each(?)) ORDER BY table_name,record_key',[id,JSON.stringify(keys)]):[];
  const last=selected.at(-1),next=last?{table:last.table_name,key:last.record_key}:after,done=!last||!this.rows('SELECT 1 FROM sensa_initial_publication_rows WHERE id=? AND (table_name,record_key)>(?,?) LIMIT 1',[id,last.table_name,last.record_key]).length;
  return {kind:'publicationIndexPage' as const,rows:selected.map(row=>({table:row.table_name,key:row.record_key,blocks:JSON.parse(row.refs_json) as string[]})),next,done,stats:this.stats(id)};
 }
 blocks(id:string,hashes:string[]){
  this.header(id);if(!hashes.length||hashes.length>512)throw Error('library_sync_candidate_invalid');
  const measured=this.rows<{hash:string;stored_bytes:number}>('SELECT hash,stored_bytes FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify(hashes)]),sizes=new Map(measured.map(row=>[row.hash,row.stored_bytes]));
  const selected:string[]=[],deferred:string[]=[];let raw=0;
  for(const hash of hashes){const size=sizes.get(hash);if(size===undefined)throw Error('library_sync_missing_block');if(selected.length&&(selected.length===128||raw+size>3*1024*1024)){deferred.push(hash);continue;}selected.push(hash);raw+=size;}
  const found=this.rows<StoredBlock>('SELECT hash,data,source_json,plain_bytes,stored_bytes FROM sensa_initial_publication_blocks WHERE id=? AND hash IN(SELECT value FROM json_each(?))',[id,JSON.stringify(selected)]),data=new Map(this.rebuild(id,found).map(row=>[row.hash,row.data]));
  const blocks:Array<{hash:string;data:string}>=[];let bytes=13;for(const hash of selected){const block={hash,data:data.get(hash)!},cost=utf8(JSON.stringify(block))+1;if(bytes+cost>3*1024*1024){deferred.push(hash);continue;}blocks.push(block);bytes+=cost;}
  if(!blocks.length)throw Error('library_sync_capacity');this.header(id);return {kind:'publicationBlocks' as const,blocks,deferred};
 }
 /** Rebuilds a bounded request from frozen rows/bodies, never mutable facts.
  * Only the current source's segments remain in memory; a 90 MiB singleton
  * keeps its existing exception. Encoded outputs retain the 3 MiB batch cap.
  */
 private rebuild(id:string,blocks:StoredBlock[]):Array<{hash:string;data:string}>{
  let current='',segments:string[]=[];
  return blocks.map(block=>{
   let data=block.data;
   if(block.source_json!==null){
    const source=JSON.parse(block.source_json) as FrozenFragment;
    if(!Number.isSafeInteger(source.start)||!Number.isSafeInteger(source.length)||source.start<0||source.length<1||source.length>262144)throw Error('library_sync_hash');
    const key='digest' in source?'body:'+source.digest:JSON.stringify([source.table,source.key]);
    if(key!==current){
     if('digest' in source){const body=this.rows<{value_json:string}>('SELECT value_json FROM sensa_initial_publication_content WHERE id=? AND digest=?',[id,source.digest])[0];if(!body)throw Error('library_sync_missing_block');segments=[unpackStoredRecord(body.value_json,undefined,recordBytes)];}
     else{if(!Number.isSafeInteger(source.segment)||source.segment<0)throw Error('library_sync_hash');const row=this.rows<{value_json:string}>('SELECT value_json FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,source.table,source.key])[0];if(!row)throw Error('library_sync_missing_block');segments=librarySyncRecordSegments(JSON.parse(unpackStoredRecord(row.value_json,undefined,recordBytes)),()=> '');}
     current=key;
    }
    const text=segments['digest' in source?0:source.segment];if(text===undefined||source.start+source.length>text.length)throw Error('library_sync_hash');const plain=text.slice(source.start,source.start+source.length);
    if(utf8(plain)!==block.plain_bytes)throw Error('library_sync_hash');data=encodeLibrarySyncBlock(plain);
   }
   if(sha256(data)!==block.hash||utf8(data)!==block.stored_bytes||block.source_json===null&&utf8(decodeLibrarySyncBlock(data))!==block.plain_bytes)throw Error('library_sync_hash');return {hash:block.hash,data};
  });
 }
 private plain(id:string,row:{value_json:string;shared:number}){const text=unpackStoredRecord(row.value_json,undefined,recordBytes);if(!row.shared)return text;return JSON.stringify(expandSharedRecordContent(JSON.parse(text),digest=>{const body=this.rows<{value_json:string}>('SELECT value_json FROM sensa_initial_publication_content WHERE id=? AND digest=?',[id,digest])[0];return body?unpackStoredRecord(body.value_json,undefined,recordBytes):undefined;}));}
 stats(id:string,confirmed=false):InitialPublicationStats{this.ensure();const h=confirmed?this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0]:this.header(id);if(!h)throw Error('library_sync_candidate_invalid');if(confirmed)this.assertOwner(JSON.parse(h.fence));return {records:h.records,logicalBytes:h.logical_bytes,uniqueBlockPlainBytes:h.unique_plain_bytes,uniqueBlockStoredBytes:h.unique_stored_bytes,storedPayloadBytes:h.stored_bytes,blocks:h.block_count,maximumPageBytes:h.maximum_page_bytes};}
 async validate(id:string,confirmed=false,ownCloud=false,onProgress?:import('./replicaCandidateProtocol').ReplicaCandidateProgressObserver):Promise<InitialPublicationStats>{
  const policy=ownCloud?'own-cloud':'external',h=this.header(id,confirmed);if(h.state==='validated'&&this.admission&&this.admissionPolicy===policy){if(this.validatedEpoch!==h.source_epoch)throw Error('library_sync_candidate_invalid');return this.stats(id,confirmed);}if(h.state!=='sealed'&&h.state!=='validated')throw Error('library_sync_candidate_invalid');
  if(ownCloud&&this.admissionPolicy==='captured-own'&&this.admission&&this.indexedRecords===h.records){
   if(h.stored_bytes+utf8('validated')-utf8(h.state)>storedBytes)throw Error('library_sync_capacity');
   this.rows("UPDATE sensa_initial_publication SET state='validated',stored_bytes=stored_bytes+? WHERE id=?",[utf8('validated')-utf8(h.state),id]);this.admissionPolicy='own-cloud';this.validatedEpoch=this.header(id,confirmed).source_epoch;return this.stats(id,confirmed);
  }
  // No other Worker task can mutate facts until the existing 64-row yield.
  // Protect that synchronous read chunk once, then renew after every yield.
  let protectedChunk=false;const alive=()=>{if(!ownCloud||!protectedChunk){this.header(id,confirmed);protectedChunk=true;}};
  // A cold recovery can add missing observer rows. Unknown old baselines use
  // the conservative whole-DB page bound; rejected sources remain retained.
  await this.checkSpace();alive();this.assertAllocatedCapacity(h);
  const admission=ownCloud?this.dependencies.spoolAdmission('publication:'+id,false,(bytes,records)=>{const current=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(!current||current.source_epoch!==current.authorized_epoch+records)throw Error('library_sync_candidate_invalid');this.assertOwner(JSON.parse(current.fence));if(current.stored_bytes+bytes>storedBytes)throw Error('library_sync_capacity');this.rows('UPDATE sensa_initial_publication SET stored_bytes=stored_bytes+?,authorized_epoch=source_epoch WHERE id=?',[bytes,id]);this.assertAllocatedCapacity(current);}):syncAdmission();this.dependencies.ensure();
  const pageObservations=new Map<string,{admitted:number;stored_bytes:number}>();
  const reader=sealedRecordReader({alive,beforePage:alive,
   get:(table,key)=>this.rows<{record_key:string;value_json:string;shared:number}>('SELECT record_key,value_json,shared FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key])[0],
   has:(table,key)=>this.rows('SELECT 1 FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key]).length>0,
   keys:(table,after)=>this.rows<{record_key:string;stored_value_bytes:number}>(`SELECT record_key,length(CAST(value_json AS BLOB)) AS stored_value_bytes FROM sensa_initial_publication_rows WHERE id=? AND table_name=? ${after===null?'':'AND record_key>?'} ORDER BY record_key LIMIT 64`,after===null?[id,table]:[id,table,after]),
   rows:(table,keys)=>{
    if(!ownCloud)return this.rows<{record_key:string;value_json:string;shared:number}>('SELECT record_key,value_json,shared FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key IN(SELECT value FROM json_each(?)) ORDER BY record_key',[id,table,JSON.stringify(keys)]);
    const rows=this.rows<{record_key:string;value_json:string;shared:number;admitted:number;stored_bytes:number}>(`SELECT row.record_key,row.value_json,row.shared,
     CASE WHEN observation.record_key IS NULL THEN 0 ELSE 1 END AS admitted,
     CASE WHEN observation.record_key IS NULL THEN length(CAST(row.value_json AS BLOB))+2*length(CAST(row.refs_json AS BLOB))+72*json_array_length(row.refs_json) ELSE 0 END AS stored_bytes
     FROM sensa_initial_publication_rows row LEFT JOIN sensa_sync_admission_rows_v1 observation ON observation.scope=? AND observation.table_name=row.table_name AND observation.record_key=row.record_key
     WHERE row.id=? AND row.table_name=? AND row.record_key IN(SELECT value FROM json_each(?)) ORDER BY row.record_key`,['publication:'+id,id,table,JSON.stringify(keys)]);
    pageObservations.clear();for(const row of rows)pageObservations.set(JSON.stringify([table,row.record_key]),row);return rows;
   },
   observed:(table,key,text,value)=>{const page=pageObservations.get(JSON.stringify([table,key]));if(page?.admitted||!page&&admission.rows.has(JSON.stringify([table,key])))return;this.dependencies.observe(admission,table,key,text,value,()=>false,page?.stored_bytes??this.rows<{n:number}>('SELECT length(CAST(value_json AS BLOB))+2*length(CAST(refs_json AS BLOB))+72*json_array_length(refs_json) AS n FROM sensa_initial_publication_rows WHERE id=? AND table_name=? AND record_key=?',[id,table,key])[0].n);},
   plain:(_table,row)=>this.plain(id,row),missing:()=>{throw Error('library_sync_candidate_invalid');},
  });
  if(ownCloud){
   // Normal controlled-client publication keeps the bounded stored graph and
   // reverse relations; arbitrary external import retains complete domain audit.
   const identity=(JSON.parse(h.fence) as ReplicaCandidateFence).identity;let count=0;
   for(const table of librarySyncTables)for(const row of reader.entries(table)){
    if(table==='meta'&&row.key==='identity'&&!backupEqual(row.value,normalizeLibraryReplicaEntry({table,key:row.key,value:identity},identity).value))throw Error('library_sync_identity');
    count++;if(count%64===0){alive();onProgress?.({phase:'publication-validation',completed:count});await new Promise<void>(resolve=>setTimeout(resolve,0));protectedChunk=false;alive();}
   }
   if(count%64)onProgress?.({phase:'publication-validation',completed:count});
  }else{const {validateLibraryRestoreRecordsCooperatively}=await import('./backupValidation');await validateLibraryRestoreRecordsCooperatively(reader);}protectedChunk=false;alive();admission.flush?.();
  const stateDelta=utf8('validated')-utf8(h.state);if(this.header(id,confirmed).stored_bytes+stateDelta>storedBytes)throw Error('library_sync_capacity');
  this.rows("UPDATE sensa_initial_publication SET state='validated',stored_bytes=stored_bytes+? WHERE id=?",[stateDelta,id]);this.admission=admission;this.admissionPolicy=policy;this.validatedEpoch=this.header(id,confirmed).source_epoch;return this.stats(id,confirmed);
 }
 async prepare(id:string,onProgress?:import('./replicaCandidateProtocol').ReplicaCandidateProgressObserver):Promise<void>{
  if(this.preparing){if(this.preparing.id!==id)throw Error('library_sync_candidate_invalid');return this.preparing.promise;}
  const h=this.header(id,true);if(h.state!=='validated'||!this.admission||this.admissionPolicy!=='own-cloud')throw Error('library_sync_candidate_invalid');
  this.preparedArtifact??=this.artifactRevision();const controller=new AbortController();let resolve!:()=>void,reject!:(cause:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});this.preparing={id,controller,promise};
  void(async()=>{try{await this.checkSpace();await this.baseline.prepare(id,this.admission!,records=>onProgress?.({phase:'publication-preparation',completed:records}));resolve();}catch(cause){reject(cause);}finally{this.preparing=undefined;}})();return promise;
 }
 cancelPreparation(id:string){if(this.preparing?.id===id)this.preparing.controller.abort();}
 /** Inside the sole baseline/state transaction; no live fact is rewritten. */
 confirm(id:string,mutation:SqliteMutation){
  this.ensure();const h=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(!h)throw Error('library_sync_candidate_invalid');const fence=JSON.parse(h.fence) as ReplicaCandidateFence;this.assertOwner(fence);
  if(h.state!=='validated'||mutation.syncBaseReplacement||mutation.syncBasePatch||mutation.replicaCandidateRestore||mutation.contentRevision!==undefined||mutation.clears.length||mutation.deletes.some(row=>row.table!=='meta'||row.key!=='local-reset')||mutation.puts.some(row=>row.table!=='meta'||row.key!=='cloud-sync'))throw Error('library_sync_candidate_invalid');
  const stateRow=mutation.puts.find(row=>row.key==='cloud-sync');if(!stateRow)throw Error('library_sync_candidate_invalid');
  const state=decodeBackupValue(JSON.parse(stateRow.encodedValue));if(state.publicationOperationId!==id||state.syncedLocalRevision!==fence.localRevision||!['synced','pending'].includes(state.status))throw Error('library_sync_candidate_invalid');
  this.baseline.assert(id);
  if(this.rows('SELECT 1 FROM sensa_initial_publication_content frozen JOIN sensa_shared_record_content body ON body.digest=frozen.digest WHERE frozen.id=? AND body.value_json<>frozen.value_json LIMIT 1',[id]).length)throw Error('sqlite_shared_content_invalid');
  this.rows('INSERT INTO sensa_shared_record_content SELECT digest,value_json FROM sensa_initial_publication_content WHERE id=? ON CONFLICT DO NOTHING',[id]);
  this.rows("INSERT INTO sensa_shared_record_content_owners SELECT 'sync',table_name,record_key,digest FROM sensa_initial_publication_owners WHERE id=?",[id]);
  this.baseline.activate(id);this.rows("UPDATE sensa_initial_publication SET state='retiring' WHERE id=?",[id]);this.ready=false;
 }
 certify(id:string,state:CloudSyncState,identity:LibraryIdentity,artifactRevision:number){if(!this.admission)throw Error('library_sync_candidate_invalid');this.dependencies.certifyPreparedPublication(this.admission,this.baseline.certificateClock(id),state,identity,artifactRevision);}
 /** One RPC retires at most 128 private rows and 1 MiB of payload. An
  * oversized existing row retires alone. No live fact or selected base is deleted. */
 retireConfirmed(id:string,selected:()=>void):boolean{
  const alive=()=>{if(this.closing)throw Error('sqlite_database_closed');selected();const h=this.rows<Header>('SELECT * FROM sensa_initial_publication WHERE id=?',[id])[0];if(h){this.assertOwner(JSON.parse(h.fence));if(h.state!=='retiring')throw Error('library_sync_candidate_invalid');}return h;};
  if(!alive())return true;
  const bounded=<T extends {bytes:number}>(sql:string,bind:(string|number)[]=[])=>{
   let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}statement.reset(true);if(bind.length)statement.bind(bind);
   let bytes=0;const batch:T[]=[];try{while(statement.step()){const row=statement.get({}) as T;if(batch.length&&bytes+row.bytes>1024*1024)break;batch.push(row);bytes+=row.bytes;if(bytes>=1024*1024)break;}return batch;}finally{statement.reset(true);}
  };
  const remove=(sql:string,bind:(string|number)[])=>{this.db.exec('BEGIN IMMEDIATE');try{if(!alive())throw Error('library_sync_candidate_invalid');this.rows(sql,bind);this.db.exec('COMMIT');}catch(cause){this.db.exec('ROLLBACK');throw cause;}};
  for(const [table,payload]of [
   ['sensa_initial_publication_shared','length(CAST(table_name||record_key AS BLOB))'],
   ['sensa_initial_publication_owners','length(CAST(table_name||record_key||digest AS BLOB))'],
   ['sensa_initial_publication_content','length(CAST(value_json AS BLOB))+coalesce(length(CAST(refs_json AS BLOB)),0)'],
   ['sensa_initial_publication_rows','length(CAST(value_json AS BLOB))+length(CAST(refs_json AS BLOB))'],
   ['sensa_initial_publication_blocks','length(CAST(data AS BLOB))+coalesce(length(CAST(source_json AS BLOB)),0)'],
  ]){
   const keys=bounded<{rowid:number;bytes:number}>(`SELECT rowid,${payload} AS bytes FROM main.${table} WHERE id=? LIMIT 128`,[id]);
   if(keys.length){remove(`DELETE FROM ${table} WHERE id=? AND rowid IN(SELECT value FROM json_each(?))`,[id,JSON.stringify(keys.map(row=>row.rowid))]);return false;}
  }
  const scope='publication:'+id,keys=bounded<{table_name:string;record_key:string;bytes:number}>('SELECT table_name,record_key,metadata_bytes AS bytes FROM sensa_sync_admission_rows_v1 WHERE scope=? ORDER BY table_name,record_key LIMIT 128',[scope]);
  if(keys.length){remove("DELETE FROM sensa_sync_admission_rows_v1 WHERE scope=? AND(table_name,record_key) IN(SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))",[scope,JSON.stringify(keys.map(row=>[row.table_name,row.record_key]))]);return false;}
  const retired=this.rows("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sensa_initial_publication_retired_base'").length;
  if(retired){const keys=bounded<{rowid:number;bytes:number}>('SELECT rowid,length(CAST(value_json AS BLOB))+length(CAST(block_refs_json AS BLOB)) AS bytes FROM sensa_initial_publication_retired_base LIMIT 128');if(keys.length){remove('DELETE FROM sensa_initial_publication_retired_base WHERE rowid IN(SELECT value FROM json_each(?))',[JSON.stringify(keys.map(row=>row.rowid))]);return false;}}
  this.db.exec('BEGIN IMMEDIATE');try{if(!alive())throw Error('library_sync_candidate_invalid');if(retired)this.db.exec('DROP TABLE sensa_initial_publication_retired_base');this.rows('DELETE FROM sensa_sync_admission_v1 WHERE scope=?',[scope]);this.rows('DELETE FROM sensa_initial_publication WHERE id=?',[id]);this.db.exec('COMMIT');return true;}catch(cause){this.db.exec('ROLLBACK');throw cause;}
 }
 discard(id:string,keepAdmission=false){if(!keepAdmission)this.dependencies.discardAdmission('publication:'+id);for(const table of ['sensa_initial_publication_shared','sensa_initial_publication_owners','sensa_initial_publication_content','sensa_initial_publication_rows','sensa_initial_publication_blocks','sensa_initial_publication'])this.db.exec({sql:`DELETE FROM ${table} WHERE id=?`,bind:[id]});}
}
