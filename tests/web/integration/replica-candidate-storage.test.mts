/** Shipped SQLite/Wasm private generations and complete cooperative validation.
 * Does not prove HTTP download, candidate promotion or OPFS crash recovery. */
import {afterAll,expect,test,vi} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,assertCurrentLibrary,readLocalLibraryRevision} from '../../../apps/web/src/data/library/store';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {replicaCandidateSchema,replicaCandidateRecordSchema,replicaCandidateAppendRecordLimit,replicaCandidateAppendReferenceLimit,type ReplicaCandidateFence,type ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
import {SqliteReplicaCandidates} from '../../../apps/web/src/data/library/sqliteReplicaCandidates';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';
import {candidateExpected,candidateBlocksFor} from '../support/replicaCandidateFixture.mts';
import {verifyReplicaCandidateManifest} from '../../../apps/web/src/data/library/replicaCandidateProof';
import type {LibraryRecordReader} from '../../../apps/web/src/data/library/libraryRecordReader';
import {packStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';
import {sealedRecordReader} from '../../../apps/web/src/data/library/sealedRecordReader';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://candidate-storage.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
const identity=await openLibrary(),owner={subject:crypto.randomUUID(),accountId:crypto.randomUUID()};
await writeLibraryState(async tx=>tx.put('meta','service-owner',owner));
const repository=new MemoryJourneyRepository();
await createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')}).semanticIntake.submit(semanticLookupPayload());
const seed=await repository.load();
const rows=(count=1):ReplicaCandidateRecord[]=>[
 {table:'meta',key:'identity',valueJson:JSON.stringify(encodeBackupValue(identity)),blockRefs:['a'.repeat(64)]},
 ...[...semanticRecords(syntheticSemanticWorld(seed,count))].map(row=>({...row,valueJson:JSON.stringify(encodeBackupValue(row.value)),blockRefs:['a'.repeat(64)]})),
];
const fence=()=>readLibrary(async tx=>({owner,identity,incarnation:await assertCurrentLibrary(tx),localRevision:await readLocalLibraryRevision(tx)} satisfies ReplicaCandidateFence));
const original=()=>readLibrary(async tx=>({identity:await tx.get('meta','identity'),meanings:await tx.entries('semanticMeanings'),drafts:await tx.entries('drafts'),base:await tx.syncBaseEntries(),revision:await readLocalLibraryRevision(tx)}));
const begin=async(records:ReplicaCandidateRecord[])=>{
 const result=await database.replicaCandidate({kind:'begin',fence:await fence(),expected:candidateExpected(records,identity)});
 if(result.kind!=='begun')throw Error('Expected candidate');return result.id;
};
const append=(id:string,records:ReplicaCandidateRecord[])=>database.replicaCandidate({kind:'append',id,records,blocks:candidateBlocksFor(records)});
const validate=(id:string)=>database.replicaCandidate({kind:'validate',id});
const discard=(id:string)=>database.replicaCandidate({kind:'discard',id});

test('filling and validated generations stay outside ordinary facts and the confirmed baseline',async()=>{
 const records=rows(),id=await begin(records),before=await original();
 try{
  const raw=Reflect.get(database,'database');
  expect(raw.exec({sql:'PRAGMA main.synchronous',rowMode:0,returnValue:'resultRows'})).toEqual([2]);
  await append(id,records);expect(await original()).toEqual(before);
  expect(raw.exec({sql:'SELECT count(*) FROM sensa_replica_candidate_records_v1 WHERE stored_value_bytes<>length(CAST(value_json AS BLOB))',rowMode:0,returnValue:'resultRows'})).toEqual([0]);
  const result=await validate(id);expect(result.kind).toBe('validated');
  if(result.kind!=='validated')throw Error('Expected validation');expect(result.candidate.records).toBe(records.length);expect(result.candidate.identity).toEqual(identity);
  expect(await validate(id)).toEqual(result);expect(await original()).toEqual(before);
  await expect(append(id,[records[0]!])).rejects.toThrow('library_sync_candidate_invalid');
 }finally{await discard(id);}
 expect(await original()).toEqual(before);await expect(validate(id)).rejects.toThrow('library_sync_candidate_invalid');
});

test('partial candidates do not seal; exact batch retries are idempotent and different duplicates roll back',async()=>{
 const records=rows(2),id=await begin(records);
 try{
  await append(id,records.slice(0,5));await append(id,records.slice(0,5));
  await expect(validate(id)).rejects.toThrow('library_sync_candidate_invalid');
  await expect(append(id,[{...records[0]!,valueJson:JSON.stringify(encodeBackupValue({...identity,learnerId:crypto.randomUUID()}))},records[5]!])).rejects.toThrow('library_sync_candidate_invalid');
  await append(id,records.slice(5));const result=await validate(id);if(result.kind!=='validated')throw Error('Expected validation');expect(result.candidate.records).toBe(records.length);
 }finally{await discard(id);}
});

for(const fault of ['missing-root','opaque-codec'] as const)test(`complete generation rejects ${fault} before admission`,async()=>{
 const records=fault==='missing-root'?rows().filter(row=>row.table!=='semanticState'):[...rows(),{table:'settings' as const,key:'opaque-preference',valueJson:'["unsupported-tag", "not a value"]',blockRefs:['a'.repeat(64)]}];
 const id=await begin(records),before=await original();
 try{await append(id,records);await expect(validate(id)).rejects.toThrow();expect(await original()).toEqual(before);await expect(append(id,[records[0]!])).rejects.toThrow('library_sync_candidate_invalid');}
 finally{await discard(id);}
});

for(const tag of ['compressed','shared'] as const)test(`opaque transport cannot impersonate a trusted ${tag} storage envelope`,async()=>{
 const raw=tag==='compressed'?packStoredRecord(JSON.stringify(encodeBackupValue('a'.repeat(4096)))):JSON.stringify(['sensa-shared-content-v1','a'.repeat(64)]);
 const records=[...rows(),{table:'settings' as const,key:'opaque-storage-envelope',valueJson:raw,blockRefs:['a'.repeat(64)]}],id=await begin(records),before=await original();
 try{await append(id,records);await expect(validate(id)).rejects.toThrow('libraryBackup.errors.format');expect(await original()).toEqual(before);}
 finally{await discard(id);}
});

test('candidate append cannot carry device credentials or private metadata',async()=>{
 const records=rows(),id=await begin(records);
 try{
  for(const row of [{table:'providers' as const,key:crypto.randomUUID()},{table:'settings' as const,key:'providers'},{table:'meta' as const,key:'service-owner'}])await expect(append(id,[{...row,valueJson:'["null"]',blockRefs:['a'.repeat(64)]}])).rejects.toThrow('library_sync_candidate_invalid');
  await append(id,records);expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

test('a local write during cooperative validation invalidates the generation and survives',async()=>{
 const records=rows(256),id=await begin(records);
 try{
  for(let at=0;at<records.length;at+=128)await append(id,records.slice(at,at+128));
  const pending=validate(id);let saved:Awaited<ReturnType<typeof saveDraft>>|undefined;
  const writing=new Promise<void>((resolve,reject)=>setTimeout(()=>{void saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text:'Kept while a candidate validates.'}).then(value=>{saved=value;resolve();},reject);},0));
  await expect(pending).rejects.toThrow('library_sync_local_changed');await writing;
  expect((await original()).drafts.some(row=>row.value.id===saved!.id)).toBe(true);expect((await original()).meanings).toEqual([]);
 }finally{await discard(id);}
});

test('discarding a running validation cancels only that private generation',async()=>{
 const records=rows(128),id=await begin(records),before=await original();
 for(let at=0;at<records.length;at+=128)await append(id,records.slice(at,at+128));
 const pending=validate(id);await discard(id);await expect(pending).rejects.toThrow('library_sync_candidate_discarded');expect(await original()).toEqual(before);
});

test('lost begin ACK reuses one generation; a different completed request replaces its private copy',async()=>{
 const records=rows(),id=await begin(records);
 try{
  expect(await begin(records)).toBe(id);await append(id,records);
  expect(await begin(records)).toBe(id);const result=await validate(id);expect(result.kind).toBe('validated');
  expect(await begin(records)).toBe(id);
  const replacement=await database.replicaCandidate({kind:'begin',fence:await fence(),expected:candidateExpected(records,identity,4)});
  if(replacement.kind!=='begun')throw Error('Expected candidate');expect(replacement.id).not.toBe(id);
  await expect(validate(id)).rejects.toThrow('library_sync_candidate_invalid');await discard(replacement.id);
 }finally{await discard(id);}
});

test('oversized batches fail before parsing any body and do not leave a partial append',async()=>{
 const records=rows(),id=await begin(records);
 try{
  // Both bodies are invalid JSON. A parse-before-budget implementation would
  // throw SyntaxError on the first row instead of the intended capacity error.
  const invalid='{'+ ' '.repeat(2200000);
  await expect(append(id,[{...records[0]!,valueJson:invalid},{...records[1]!,valueJson:invalid}])).rejects.toThrow('library_sync_capacity');
  await append(id,records);expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

test('a full bounded batch retries exactly and a late body mismatch rolls back every staged row and proof',async()=>{
 const records=rows(Math.ceil(replicaCandidateAppendRecordLimit/7)+1),id=await begin(records),page=records.slice(0,replicaCandidateAppendRecordLimit),before=await original();
 try{
  const over=records.slice(0,replicaCandidateAppendRecordLimit+1).map(row=>({...row,valueJson:'{'}));
  await expect(append(id,over)).rejects.toThrow('library_sync_candidate_invalid');
  const wrong=page.map((row,index)=>index===page.length-1?{...row,valueJson:row.valueJson+'x'}:row);
  await expect(database.replicaCandidate({kind:'append',id,records:wrong,blocks:candidateBlocksFor(page)})).rejects.toThrow('library_sync_hash');
  const raw=Reflect.get(database,'database');
  expect(raw.exec({sql:'SELECT count(*) FROM sensa_replica_candidate_records_v1 WHERE candidate_id=?',bind:[id],rowMode:0,returnValue:'resultRows'})).toEqual([0]);
  await append(id,page);await append(id,page);await append(id,records.slice(page.length));
  const result=await validate(id);if(result.kind!=='validated')throw Error('Expected validation');expect(result.candidate.records).toBe(records.length);expect(await original()).toEqual(before);
 }finally{await discard(id);}
});

test('repeated reference work is bounded before parsing bodies or opening an append transaction',async()=>{
 const records=rows(),id=await begin(records),before=await original();
 try{
  const dense=Array.from({length:3},(_,index)=>({table:'settings' as const,key:`dense-${index}`,valueJson:'{',blockRefs:Array.from({length:2048},()=> 'a'.repeat(64))}));
  expect(dense.flatMap(row=>row.blockRefs).length).toBeGreaterThan(replicaCandidateAppendReferenceLimit);
  await expect(append(id,dense)).rejects.toThrow('library_sync_capacity');
  expect(await original()).toEqual(before);await append(id,records);expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

const sqlite=await sqlite3InitModule();
function isolatedDatabase(){
 const raw=new sqlite.oo1.DB(':memory:','c'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 database.commit({clears:[],deletes:[],puts:[{table:'meta',key:'identity',encodedValue:JSON.stringify(encodeBackupValue(identity))},{table:'meta',key:'service-owner',encodedValue:JSON.stringify(encodeBackupValue(owner))},{table:'meta',key:'sentinel',encodedValue:JSON.stringify(encodeBackupValue('Existing owner data'))}]});
 const request=database.replicaCandidate.bind(database);
 const stage=async(count=128)=>{
  const records=rows(count),result=await request({kind:'begin',fence:{owner,identity,localRevision:0,incarnation:'initial'},expected:candidateExpected(records,identity)});
  if(result.kind!=='begun')throw Error('Expected candidate');
  for(let at=0;at<records.length;at+=128){const page=records.slice(at,at+128);await request({kind:'append',id:result.id,records:page,blocks:candidateBlocksFor(page)});}
  return result.id;
 };
 const storedCount=()=>Number((raw.exec({sql:'SELECT count(*) FROM sensa_replica_candidate_records_v1',rowMode:0,returnValue:'resultRows'}) as number[])[0]);
 return {raw,database,request,stage,storedCount};
}

test('candidate paging selects a UTF-8 bounded key prefix before loading wide bodies',async()=>{
 const fixture=isolatedDatabase(),handler=new SqliteReplicaCandidates(fixture.raw,()=>{},()=>{});
 try{
  const records=rows(),id=handler.begin({owner,identity,localRevision:0,incarnation:'initial'},candidateExpected(records,identity));
  // Exact packed storage values, including multibyte JSON and an oversized
  // legal first row. Raw fixture writes isolate paging from compression.
  const values=Array.from({length:137},(_,index)=>JSON.stringify(encodeBackupValue(
   index===0?'界'.repeat(400000):index===1?'é'.repeat(230000):index===2?'字'.repeat(200000):index===3?'a'.repeat(1024*1024-JSON.stringify(encodeBackupValue('')).length):`row-${index}`)));
  const expected=values.map((text,index)=>({key:String(index).padStart(3,'0'),text,bytes:new TextEncoder().encode(text).length}));
  for(const row of expected)fixture.raw.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1(candidate_id,table_name,record_key,value_json,refs_json) VALUES(?,?,?,?,?)',bind:[id,'settings',row.key,row.text,'[]']});
  const sizes=fixture.raw.exec({sql:"SELECT record_key,stored_value_bytes FROM sensa_replica_candidate_records_v1 WHERE candidate_id=? AND table_name='settings' ORDER BY record_key",bind:[id],rowMode:'object',returnValue:'resultRows'});
  expect(sizes).toEqual(expected.map(row=>({record_key:row.key,stored_value_bytes:row.bytes})));
  const plan=fixture.raw.exec({sql:"EXPLAIN QUERY PLAN SELECT record_key,stored_value_bytes FROM sensa_replica_candidate_records_v1 INDEXED BY sensa_replica_candidate_page_v1 WHERE candidate_id=? AND table_name=? ORDER BY record_key LIMIT 64",bind:[id,'settings'],rowMode:'object',returnValue:'resultRows'});
  expect(JSON.stringify(plan)).toContain('USING INDEX sensa_replica_candidate_page_v1');
  // SQLite does not label generated-column indexes COVERING, even when its
  // bytecode reads both columns from the index and never seeks the body table.
  const root=(fixture.raw.exec({sql:"SELECT rootpage FROM sqlite_schema WHERE name='sensa_replica_candidate_records_v1'",rowMode:0,returnValue:'resultRows'}) as number[])[0];
  const program=fixture.raw.exec({sql:"EXPLAIN SELECT record_key,stored_value_bytes FROM sensa_replica_candidate_records_v1 INDEXED BY sensa_replica_candidate_page_v1 WHERE candidate_id=? AND table_name=? ORDER BY record_key LIMIT 64",bind:[id,'settings'],rowMode:'object',returnValue:'resultRows'}) as Array<{opcode:string;p1:number;p2:number}>;
  const tableCursor=program.find(row=>row.opcode==='OpenRead'&&row.p2===root)!.p1;
  expect(program.filter(row=>row.opcode==='Column').every(row=>row.p1!==tableCursor)).toBe(true);
  const bodyPages:Array<Array<{record_key:string;value_json:string}>>=[],query=Reflect.get(handler,'rows').bind(handler);
  Reflect.set(handler,'rows',(sql:string,bind:unknown[])=>{const result=query(sql,bind);if(sql.startsWith('SELECT record_key,value_json'))bodyPages.push(result);return result;});
  const reader=Reflect.get(handler,'reader').call(handler,id,new AbortController().signal) as LibraryRecordReader;
  expect([...reader.entries('settings')].map(row=>row.key)).toEqual(expected.map(row=>row.key));
  expect(bodyPages[0]!.map(row=>row.record_key)).toEqual(['000']);
  expect(bodyPages[1]!.map(row=>row.record_key)).toEqual(['001']);
  expect(bodyPages[3]!.map(row=>row.record_key)).toEqual(['003']);
  expect(new TextEncoder().encode(bodyPages[3]![0]!.value_json).length).toBe(1024*1024);
  for(const page of bodyPages){expect(page.length).toBeLessThanOrEqual(64);if(page.length>1)expect(page.reduce((sum,row)=>sum+new TextEncoder().encode(row.value_json).length,0)).toBeLessThanOrEqual(1024*1024);}
  // Repeatable iteration cannot skip or duplicate rows at byte/count edges.
  expect([...reader.entries('settings')].map(row=>row.value)).toEqual(values.map(text=>JSON.parse(text)[1]));
 }finally{handler.close();fixture.database.close(false);}
});

test('sealed text caching bounds retained bytes, clones values and still checks cancellation',()=>{
 const texts=new Map(Array.from({length:3},(_,index)=>[String(index),JSON.stringify(encodeBackupValue({nested:{count:index}}))]));
 const calls=new Map<string,number>(),controller=new AbortController();
 const source={
  alive(){if(controller.signal.aborted)throw controller.signal.reason;},beforePage(){},
  get(_table:unknown,key:string){calls.set(key,(calls.get(key)??0)+1);return texts.has(key)?{record_key:key,value_json:texts.get(key)!}:undefined;},
  has(_table:unknown,key:string){return texts.has(key);},keys(){return [];},rows(){return [];},
  plain(_table:unknown,row:{value_json:string}){return row.value_json;},missing():never{throw Error('fixture missing');},
 };
 const bytes=new TextEncoder().encode(texts.get('0')!).length,reader=sealedRecordReader(source,bytes*2);
 const first=reader.get('settings','0');first.nested.count=99;
 expect(reader.get('settings','0')).toEqual({nested:{count:0}});expect(calls.get('0')).toBe(1);
 reader.get('settings','1');reader.get('settings','2');reader.get('settings','0');expect(calls.get('0')).toBe(2);
 texts.set('large',JSON.stringify(encodeBackupValue('界'.repeat(bytes))));
 expect(texts.get('large')!.length).toBeLessThan(bytes*2);
 expect(new TextEncoder().encode(texts.get('large')!).length).toBeGreaterThan(bytes*2);
 reader.get('settings','large');reader.get('settings','large');expect(calls.get('large')).toBe(2);
 controller.abort(Error('fixture cancelled'));
 expect(()=>reader.get('settings','0')).toThrow('fixture cancelled');expect(()=>reader.has('settings','0')).toThrow('fixture cancelled');
});

test('interleaved point reads during sealed iteration do not double-count a cached row',()=>{
 const texts=new Map(['0','1'].map(key=>[key,JSON.stringify(encodeBackupValue({nested:{count:Number(key)}}))]));
 const calls=new Map<string,number>(),plains=new Map<string,number>(),controller=new AbortController();
 const reader=sealedRecordReader({
  alive(){if(controller.signal.aborted)throw controller.signal.reason;},beforePage(){},
  get(_table,key){calls.set(key,(calls.get(key)??0)+1);return texts.has(key)?{record_key:key,value_json:texts.get(key)!}:undefined;},has(_table,key){return texts.has(key);},
  keys(_table,after){return after===null?[...texts].map(([record_key,value])=>({record_key,stored_value_bytes:new TextEncoder().encode(value).length})):[];},
  rows(_table,keys){return keys.map(record_key=>({record_key,value_json:texts.get(record_key)!}));},
  plain(_table,row){const text=row.value_json;plains.set(text,(plains.get(text)??0)+1);return text;},missing():never{throw Error('fixture missing');},
 },new TextEncoder().encode(texts.get('0')!).length*2);
 const iterator=reader.entries('settings')[Symbol.iterator]();
 const first=iterator.next().value;expect(first?.key).toBe('0');first!.value.nested.count=99;expect(reader.get('settings','0')).toEqual({nested:{count:0}});expect(reader.get('settings','1')).toEqual({nested:{count:1}});
 expect(iterator.next().value?.key).toBe('1');expect(reader.get('settings','1')).toEqual({nested:{count:1}});
 expect(calls.get('1')).toBe(1);expect(plains.get(texts.get('1')!)).toBe(1);
 expect(iterator.next().done).toBe(true);
 const cached=reader.entries('settings')[Symbol.iterator]();expect(cached.next().value?.key).toBe('0');
 controller.abort(Error('fixture cancelled'));expect(()=>cached.next()).toThrow('fixture cancelled');
});

test('sealed text cache bounds small-row count independently from retained bytes',()=>{
 const texts=new Map(Array.from({length:257},(_,index)=>[String(index),JSON.stringify(encodeBackupValue(index))]));
 const calls=new Map<string,number>();
 const reader=sealedRecordReader({
  alive(){},beforePage(){},get(_table,key){calls.set(key,(calls.get(key)??0)+1);return texts.has(key)?{record_key:key,value_json:texts.get(key)!}:undefined;},
  has(_table,key){return texts.has(key);},keys(){return [];},rows(){return [];},plain(_table,row){return row.value_json;},missing():never{throw Error('fixture missing');},
 });
 for(const key of texts.keys())expect(reader.get('settings',key)).toBe(Number(key));
 expect(reader.get('settings','0')).toBe(0);expect(calls.get('0')).toBe(2);
 expect(reader.get('settings','256')).toBe(256);expect(calls.get('256')).toBe(1);
});

for(const interrupted of [false,true])test(`cold candidate handler replaces only abandoned clustered bodies atomically (${interrupted})`,async()=>{
 const fixture=isolatedDatabase();let handler:SqliteReplicaCandidates|undefined;
 try{
  const raw=fixture.raw,oldRecord=replicaCandidateRecordSchema.slice(0,replicaCandidateRecordSchema.indexOf('CREATE INDEX')).replace(" representation TEXT NOT NULL DEFAULT 'packed' CHECK(representation IN ('packed','opaque')),\n",'').replace(' stored_value_bytes INTEGER GENERATED ALWAYS AS(length(CAST(value_json AS BLOB))) STORED,\n','').replace('\n);','\n) WITHOUT ROWID;'),oldId=crypto.randomUUID();
  raw.exec(replicaCandidateSchema.replace(replicaCandidateRecordSchema,oldRecord));
  raw.exec({sql:"INSERT INTO sensa_replica_candidates_v1(id,fence_json,expected_json,state) VALUES(?,'{}','{}','filling')",bind:[oldId]});
  raw.exec({sql:'INSERT INTO sensa_replica_candidate_records_v1 VALUES(?,?,?,?,?)',bind:[oldId,'settings','abandoned','["string","abandoned private download"]','[]']});
  raw.exec({sql:'INSERT INTO sensa_replica_candidate_manifest_v1 VALUES(?,?,?,?)',bind:[oldId,'settings','abandoned',JSON.stringify(['a'.repeat(64)])]});
  raw.exec({sql:'INSERT INTO sensa_replica_candidate_proofs_v1(candidate_id,digest) VALUES(?,?)',bind:[oldId,'a'.repeat(64)]});
  const snapshot=()=>['sensa_replica_candidates_v1','sensa_replica_candidate_records_v1','sensa_replica_candidate_manifest_v1','sensa_replica_candidate_proofs_v1'].map(table=>raw.exec({sql:`SELECT * FROM ${table} ORDER BY 1`,rowMode:'array',returnValue:'resultRows'})),before=snapshot();
  handler=new SqliteReplicaCandidates(raw,()=>{},()=>{});
  const records=rows(),expected=candidateExpected(records,identity),fence={owner,identity,localRevision:0,incarnation:'initial'};
  if(interrupted){const exec=raw.exec.bind(raw);raw.exec=((input:any)=>{if(input===replicaCandidateSchema)throw Error('fixture cache layout interrupted');return exec(input);}) as typeof raw.exec;
   try{expect(()=>handler!.begin(fence,expected)).toThrow('fixture cache layout interrupted');}finally{raw.exec=exec;}
   expect(snapshot()).toEqual(before);expect(String((raw.exec({sql:"SELECT sql FROM sqlite_schema WHERE name='sensa_replica_candidate_records_v1'",rowMode:0,returnValue:'resultRows'}) as string[])[0])).toMatch(/WITHOUT ROWID/);
  }
  const id=handler.begin(fence,expected);expect(id).not.toBe(oldId);expect(fixture.storedCount()).toBe(0);
  for(const table of ['sensa_replica_candidate_records_v1','sensa_replica_candidate_manifest_v1','sensa_replica_candidate_proofs_v1'])expect(raw.exec({sql:`SELECT count(*) FROM ${table} WHERE candidate_id=?`,bind:[oldId],rowMode:0,returnValue:'resultRows'})).toEqual([0]);
  expect(String((raw.exec({sql:"SELECT sql FROM sqlite_schema WHERE name='sensa_replica_candidate_records_v1'",rowMode:0,returnValue:'resultRows'}) as string[])[0])).not.toMatch(/WITHOUT ROWID/);
  expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
  handler.append(id,records,candidateBlocksFor(records));expect((await handler.validate(id)).records).toBe(records.length);
 }finally{handler?.close();fixture.database.close(false);}
});

for(const added of ['live-fact','baseline'] as const)test(`fresh promotion rechecks ${added} inside its source transaction`,async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(1);expect((await fixture.request({kind:'validate',id})).kind).toBe('validated');
  const key=crypto.randomUUID(),valueJson=JSON.stringify(encodeBackupValue({id:key,revision:1,text:'A concurrent fact must survive.',createdAt:identity.createdAt,updatedAt:identity.createdAt}));
  fixture.database.commit({clears:[],deletes:[],puts:added==='live-fact'?[{table:'drafts',key,encodedValue:valueJson}]:[],...(added==='baseline'?{syncBasePatch:{puts:[{table:'drafts' as const,key,valueJson,blockRefs:['a'.repeat(64)]}],deletes:[]}}:{})});
  expect(()=>fixture.database.commit({clears:[],deletes:[],puts:[],contentRevision:1,replicaCandidateRestore:{id,tables:['semanticMeanings']}})).toThrow('library_sync_local_changed');
  expect(fixture.database.count('semanticMeanings')).toBe(0);expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
  if(added==='live-fact')expect(fixture.database.get('drafts',key)).toBe(valueJson);else expect(fixture.database.syncBaseEntries()).toHaveLength(1);
  expect((await fixture.request({kind:'validate',id})).kind).toBe('validated');
 }finally{fixture.database.close(false);}
});

test('only a validated generation can promote and its commit cannot bundle independent fact changes',async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(1),mutation={clears:[],deletes:[],puts:[],contentRevision:1,replicaCandidateRestore:{id,tables:['semanticMeanings' as const]}};
  expect(()=>fixture.database.commit(mutation)).toThrow('library_sync_candidate_invalid');
  expect((await fixture.request({kind:'validate',id})).kind).toBe('validated');
  expect(()=>fixture.database.commit({...mutation,puts:[{table:'settings',key:'unrelated',encodedValue:'["string","extra fact"]'}]})).toThrow('library_sync_candidate_invalid');
  expect(()=>fixture.database.commit({...mutation,puts:[{table:'meta',key:'service-owner',encodedValue:JSON.stringify(encodeBackupValue({subject:crypto.randomUUID(),accountId:crypto.randomUUID()}))}]})).toThrow('library_sync_candidate_invalid');
  expect(fixture.database.count('semanticMeanings')).toBe(0);expect(fixture.database.syncBaseEntries()).toEqual([]);
 }finally{fixture.database.close(false);}
});

for(const reset of [undefined,'account-deletion','local-clear'] as const)test(`fresh promotion consumes only an existing local-clear marker (${reset??'absent'})`,async()=>{
 const fixture=isolatedDatabase();
 try{
  if(reset)fixture.database.commit({clears:[],deletes:[],puts:[{table:'meta',key:'local-reset',encodedValue:JSON.stringify(encodeBackupValue(reset))}]});
  const id=await fixture.stage(1),validated=await fixture.request({kind:'validate',id});
  if(validated.kind!=='validated')throw Error('Expected validation');
  const mutation={clears:[],deletes:[],contentRevision:1,replicaCandidateRestore:{id,tables:validated.candidate.tables},puts:[
   {table:'meta' as const,key:'cloud-sync',encodedValue:JSON.stringify(encodeBackupValue({restoreOperationId:id,owner,incarnation:'initial',revision:validated.candidate.head.revision,syncedLocalRevision:1,status:'synced'}))},
   {table:'meta' as const,key:'local-content-revision',encodedValue:JSON.stringify(encodeBackupValue(1))},
  ]};
  const deletion={table:'meta' as const,key:'local-reset'};
  expect(()=>fixture.database.commit({...mutation,deletes:[{table:'meta',key:'sentinel'}]})).toThrow('library_sync_candidate_invalid');
  expect(()=>fixture.database.commit({...mutation,deletes:[deletion,deletion]})).toThrow('library_sync_candidate_invalid');
  if(reset==='local-clear')expect(()=>fixture.database.commit(mutation)).toThrow('library_sync_candidate_invalid');
  else expect(()=>fixture.database.commit({...mutation,deletes:[deletion]})).toThrow('library_sync_candidate_invalid');
  expect(fixture.database.get('meta','local-reset')).toBe(reset?JSON.stringify(encodeBackupValue(reset)):null);
  expect(fixture.database.count('semanticMeanings')).toBe(0);expect(fixture.database.syncBaseEntries()).toEqual([]);
  fixture.database.commit({...mutation,deletes:reset==='local-clear'?[deletion]:[]});
  expect(fixture.database.count('semanticMeanings')).toBe(1);expect(fixture.database.syncBaseEntries().length).toBeGreaterThan(0);
  expect(fixture.database.get('meta','local-reset')).toBe(reset==='account-deletion'?JSON.stringify(encodeBackupValue(reset)):null);
  expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
 }finally{fixture.database.close(false);}
});

test('proof-only batches are tied to one manifest row and cannot seal or expose a partial body',async()=>{
 const records=rows(),id=await begin(records),before=await original();
 try{
  const identityProofs=candidateBlocksFor([records[0]!]),otherProofs=candidateBlocksFor([records[1]!]);
  await expect(database.replicaCandidate({kind:'prove',id,record:{table:records[0]!.table,key:records[0]!.key},blocks:otherProofs})).rejects.toThrow('library_sync_candidate_invalid');
  for(let attempt=0;attempt<2;attempt++)expect((await database.replicaCandidate({kind:'prove',id,record:{table:records[0]!.table,key:records[0]!.key},blocks:identityProofs})).kind).toBe('proved');
  expect(await original()).toEqual(before);await expect(validate(id)).rejects.toThrow('library_sync_candidate_invalid');
  await database.replicaCandidate({kind:'append',id,records:[records[0]!],blocks:[]});await append(id,records.slice(1));
  expect((await validate(id)).kind).toBe('validated');expect(await original()).toEqual(before);
 }finally{await discard(id);}
});

test('close drains an in-flight validation and performs no later SQL through its closed connection',async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(256),exec=vi.spyOn(fixture.raw,'exec');
  const outcome=fixture.request({kind:'validate',id}).then(()=>undefined,cause=>cause as Error);
  await new Promise(resolve=>setTimeout(resolve,0));await fixture.database.settleReplicaCandidates();
  expect((await outcome)?.message).toBe('sqlite_database_closed');
  expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
  fixture.database.close(false);const atClose=exec.mock.calls.length;
  await new Promise(resolve=>setTimeout(resolve,10));expect(exec.mock.calls).toHaveLength(atClose);
 }finally{fixture.database.close(false);}
});

test('physical connection quarantine stops in-flight reads without a failed/validated state write',async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(256),exec=vi.spyOn(fixture.raw,'exec');
  const outcome=fixture.request({kind:'validate',id}).then(()=>undefined,cause=>cause as Error);
  await new Promise(resolve=>setTimeout(resolve,0));
  const failure=Object.assign(Error('synthetic physical IOERR'),{resultCode:10});fixture.database.quarantineConnection(failure);const atFailure=exec.mock.calls.length;
  expect(await outcome).toBe(failure);expect(fixture.database.connectionFailed).toBe(true);expect(exec.mock.calls).toHaveLength(atFailure);
  await expect(fixture.request({kind:'discard',id})).rejects.toThrow('synthetic physical IOERR');
  expect(exec.mock.calls).toHaveLength(atFailure);
 }finally{fixture.database.close(false);}
});

for(const action of ['sign-out','incarnation','identity','service-owner','clear'] as const)test(`owner ${action} erases private candidate copies with the same source transaction`,async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(1);expect(fixture.storedCount()).toBeGreaterThan(0);
  const replacement=action==='sign-out'?{key:'signed-out',value:true}:action==='identity'?{key:'identity',value:{...identity,id:crypto.randomUUID()}}:action==='service-owner'?{key:'service-owner',value:{subject:crypto.randomUUID(),accountId:crypto.randomUUID()}}:{key:'local-incarnation',value:crypto.randomUUID()};
  const mutation=action==='clear'?{clears:['meta'] as const,deletes:[],puts:[]}:{clears:[],deletes:[],puts:[{table:'meta' as const,key:replacement.key,encodedValue:JSON.stringify(encodeBackupValue(replacement.value))}]};
  fixture.database.commit({...mutation,clears:[...mutation.clears]});expect(fixture.storedCount()).toBe(0);
  await expect(fixture.request({kind:'validate',id})).rejects.toThrow('library_sync_candidate_invalid');
  if(action!=='clear')expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
 }finally{fixture.database.close(false);}
});

test('a failed owner reset rolls back its private purge and keeps the original valid generation',async()=>{
 const fixture=isolatedDatabase();
 try{
  const id=await fixture.stage(1),before=fixture.storedCount(),originalExec=fixture.raw.exec;
  const exec=vi.spyOn(fixture.raw,'exec').mockImplementation(function(...args:Parameters<typeof originalExec>){
   const input:unknown=args[0];if(input==='COMMIT')throw Error('fixture reset commit rejected');return Reflect.apply(originalExec,fixture.raw,args);
  });
  try{expect(()=>fixture.database.commit({clears:[],deletes:[],puts:[{table:'meta',key:'signed-out',encodedValue:'["boolean",true]'}]})).toThrow('fixture reset commit rejected');}finally{exec.mockRestore();}
  expect(fixture.storedCount()).toBe(before);expect(fixture.database.get('meta','signed-out')).toBeNull();
  expect((await fixture.request({kind:'validate',id})).kind).toBe('validated');
 }finally{fixture.database.close(false);}
});

test('an invalid complete candidate removes its private bodies without touching owner facts',async()=>{
 const fixture=isolatedDatabase();
 try{
  const records=rows().filter(row=>row.table!=='semanticState');
  const result=await fixture.request({kind:'begin',fence:{owner,identity,localRevision:0,incarnation:'initial'},expected:candidateExpected(records,identity)});
  if(result.kind!=='begun')throw Error('Expected candidate');await fixture.request({kind:'append',id:result.id,records,blocks:candidateBlocksFor(records)});
  expect(fixture.storedCount()).toBeGreaterThan(0);await expect(fixture.request({kind:'validate',id:result.id})).rejects.toThrow();
  expect(fixture.storedCount()).toBe(0);expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
 }finally{fixture.database.close(false);}
});

test('a nonfatal cleanup failure is explicit and begin retries a new generation rather than a stuck seal',async()=>{
 const fixture=isolatedDatabase();
 try{
  const records=rows().filter(row=>row.table!=='semanticState'),fence={owner,identity,localRevision:0,incarnation:'initial'},expected=candidateExpected(records,identity);
  const begun=await fixture.request({kind:'begin',fence,expected});if(begun.kind!=='begun')throw Error('Expected candidate');
  await fixture.request({kind:'append',id:begun.id,records,blocks:candidateBlocksFor(records)});
  const originalExec=fixture.raw.exec,exec=vi.spyOn(fixture.raw,'exec').mockImplementation(function(...args:Parameters<typeof originalExec>){
   const input:unknown=args[0],sql=typeof input==='string'?input:(input as {sql?:string})?.sql;
   if(sql?.includes("DELETE FROM sensa_replica_candidates_v1 WHERE id=? AND state='sealed'"))throw Object.assign(Error('fixture cleanup SQLITE_FULL'),{resultCode:13});
   return Reflect.apply(originalExec,fixture.raw,args);
  });
  try{await expect(fixture.request({kind:'validate',id:begun.id})).rejects.toThrow('library_sync_candidate_cleanup_failed');}finally{exec.mockRestore();}
  expect(fixture.database.connectionFailed).toBe(false);expect(fixture.storedCount()).toBeGreaterThan(0);
  const replacement=await fixture.request({kind:'begin',fence,expected});if(replacement.kind!=='begun')throw Error('Expected candidate');
  expect(replacement.id).not.toBe(begun.id);expect(fixture.storedCount()).toBe(0);
  expect(fixture.database.get('meta','sentinel')).toBe(JSON.stringify(encodeBackupValue('Existing owner data')));
 }finally{fixture.database.close(false);}
});

for(const fault of ['wrong-manifest-hash','missing-manifest-part','extra-manifest-part'] as const)test(`candidate begin binds the observed manifest: ${fault}`,async()=>{
 const records=rows(),expected=candidateExpected(records,identity),before=await original();
 if(fault==='wrong-manifest-hash')expected.manifestBlocks[0]!.data+=' ';
 if(fault==='missing-manifest-part')expected.manifestBlocks=[];
 if(fault==='extra-manifest-part')expected.manifestBlocks.push({hash:'f'.repeat(64),data:'unrequested data'});
 await expect(database.replicaCandidate({kind:'begin',fence:await fence(),expected})).rejects.toThrow();expect(await original()).toEqual(before);
});

for(const fault of ['wrong-block-hash','wrong-row-ref','valid-different-row-body','extra-row','missing-proof'] as const)test(`candidate rows cannot bypass manifest and body binding: ${fault}`,async()=>{
 const records=rows(),id=await begin(records),before=await original();
 try{
  const row={...records[0]!,blockRefs:[...records[0]!.blockRefs]},blocks=candidateBlocksFor([records[0]!]);
  if(fault==='wrong-block-hash')blocks[0]!.data+=' ';
  if(fault==='wrong-row-ref')row.blockRefs=['f'.repeat(64)];
  if(fault==='valid-different-row-body')row.valueJson=JSON.stringify(encodeBackupValue({...identity,createdAt:'2026-10-01T00:00:00.000Z'}));
  if(fault==='extra-row'){row.table='settings';row.key='not-in-the-observed-manifest';}
  if(fault==='missing-proof')blocks.length=0;
  await expect(database.replicaCandidate({kind:'append',id,records:[row],blocks})).rejects.toThrow();
  // A refused row and its newly proved blocks roll back together. The exact
  // original wire can still fill and validate the entire observed checkpoint.
  await append(id,records);const validated=await validate(id);expect(validated.kind).toBe('validated');expect(await original()).toEqual(before);
 }finally{await discard(id);}
});

test('exact row retries reuse proved fragments and the receipt identifies the observed head',async()=>{
 const records=rows(),expected=candidateExpected(records,identity),result=await database.replicaCandidate({kind:'begin',fence:await fence(),expected});
 if(result.kind!=='begun')throw Error('Expected candidate');
 try{
  await append(result.id,records);await database.replicaCandidate({kind:'append',id:result.id,records,blocks:[]});
  const receipt=await validate(result.id);if(receipt.kind!=='validated')throw Error('Expected validation');
  expect(receipt.candidate.records).toBe(records.length);expect(receipt.candidate.head).toEqual(expected.head);
 }finally{await discard(result.id);}
});

test('changing storage telemetry under the same head does not replace a partially filled generation',async()=>{
 const records=rows(),id=await begin(records);
 try{
  await append(id,records.slice(0,1));const expected=candidateExpected(records,identity);
  expected.head.storage={usedBytes:1024,capacityBytes:256*1024*1024};
  expect(await database.replicaCandidate({kind:'begin',fence:await fence(),expected})).toEqual({kind:'begun',id});
  await append(id,records.slice(1));expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

test('proof input cannot inflate beyond its bounded row batch or pre-prove unrelated rows',async()=>{
 const large:ReplicaCandidateRecord={table:'settings',key:'opaque-compressed-fixture',valueJson:JSON.stringify(encodeBackupValue('x'.repeat(250000))),blockRefs:[]};
 const records=[...rows(),large],id=await begin(records);
 try{
  await expect(database.replicaCandidate({kind:'append',id,records:[records[0]!],blocks:candidateBlocksFor(records)})).rejects.toThrow('library_sync_candidate_invalid');
  await expect(database.replicaCandidate({kind:'append',id,records:[{...large,valueJson:'["null"]'}],blocks:candidateBlocksFor([large])})).rejects.toThrow('library_sync_capacity');
  await append(id,records);expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

test('an oversized raw manifest fragment is refused before a proportional encoding allocation',()=>{
 const expected=candidateExpected(rows(),identity),oversized='x'.repeat(1000000);expected.manifestBlocks[0]!.data=oversized;
 const encode=vi.spyOn(TextEncoder.prototype,'encode');
 try{expect(()=>verifyReplicaCandidateManifest(expected)).toThrow('library_sync_candidate_invalid');expect(encode.mock.calls.some(call=>call[0]===oversized)).toBe(false);}finally{encode.mockRestore();}
});

test('ordered multi-fragment compressed Unicode rows bind every slice and retain valid opaque preferences',async()=>{
 const unicode:ReplicaCandidateRecord={table:'settings',key:'opaque-unicode-fixture',valueJson:JSON.stringify(encodeBackupValue('🙂汉字'.repeat(100000))),blockRefs:[]};
 const records=[...rows(),unicode],id=await begin(records);
 try{
  expect(unicode.blockRefs.length).toBeGreaterThan(1);
  const blocks=candidateBlocksFor([unicode]);
  await expect(database.replicaCandidate({kind:'append',id,records:[unicode],blocks:blocks.slice(0,-1)})).rejects.toThrow('library_sync_missing_block');
  await expect(database.replicaCandidate({kind:'append',id,records:[{...unicode,blockRefs:[...unicode.blockRefs].reverse()}],blocks})).rejects.toThrow();
  await append(id,records);expect((await validate(id)).kind).toBe('validated');
 }finally{await discard(id);}
});

// The certificate is disposable admission metadata, never a Library authority.
// These mechanics use controlled descriptors, not a remote domain-admission claim.
const {SqliteSyncDependencies,syncAdmission}=await import('../../../apps/web/src/data/library/sqliteSyncDependencies');
const {libraryRestoreValidationVersion}=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
const checkpoint={owner,incarnation:'initial',revision:3,checkpointVersion:7 as const,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:0,status:'synced' as const};
test('current dependency stored budgets replace old rows and subtract deletions over repeated certification',()=>{
 const fixture=isolatedDatabase(),deps=new SqliteSyncDependencies(fixture.raw);try{
  const make=(key:string,text:string,size:number)=>{const admission=syncAdmission();deps.observe(admission,'settings',key,JSON.stringify(encodeBackupValue(text)),text,undefined,size);return admission;};
  deps.certify(make('a','initial',200),checkpoint,identity,0);expect(deps.certificate()?.storedBytes).toBe(200);
  for(let i=0;i<100;i++){const previous=deps.certificate()!;deps.certify(make('a','replacement '+i,150+i),checkpoint,identity,0,previous);expect(deps.certificate()?.storedBytes).toBe(150+i);expect(deps.certificate()?.records).toBe(1);}
  deps.certify(make('b','independent',90),checkpoint,identity,0,deps.certificate());expect(deps.certificate()?.storedBytes).toBe(339);
  const deletion=syncAdmission();deletion.deletes=[{table:'settings',key:'a'}];deps.certify(deletion,checkpoint,identity,0,deps.certificate());expect(deps.certificate()?.storedBytes).toBe(90);expect(deps.certificate()?.records).toBe(1);
 }finally{fixture.database.close();}
});
for(const damage of ['bad-json','missing-trigger','edge-write'] as const)test(`dependency certificate rejects ${damage} and never treats coverage alone as proof`,()=>{
 const fixture=isolatedDatabase(),deps=new SqliteSyncDependencies(fixture.raw);try{
  const admission=syncAdmission();deps.observe(admission,'learningRuns','controlled','["null"]',{targetIds:['target'],participants:{}});deps.certify(admission,checkpoint,identity,0);const prior=deps.certificate()!;expect(prior).toBeDefined();
  if(damage==='bad-json')fixture.raw.exec("UPDATE sensa_sync_dependency_state_v1 SET certificate_json='{' WHERE id=1");
  else if(damage==='missing-trigger')fixture.raw.exec('DROP TRIGGER sensa_sync_base_generation_update_v1');
  else fixture.raw.exec('DELETE FROM sensa_sync_dependency_edges_v1');
  expect(deps.certificate()).toBeUndefined();expect(()=>deps.assert(prior)).toThrow('library_sync_local_changed');
 }finally{fixture.database.close();}
});
