/** Shipped SQLite/Wasm private generations and complete cooperative validation.
 * Does not prove HTTP download, candidate promotion or OPFS crash recovery. */
import {afterAll,expect,test,vi} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,writeLibraryState,assertCurrentLibrary,readLocalLibraryRevision} from '../../../apps/web/src/data/library/store';
import {saveDraft} from '../../../apps/web/src/data/library/drafts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {ReplicaCandidateFence,ReplicaCandidateRecord} from '../../../apps/web/src/data/library/replicaCandidateProtocol';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';
import {candidateExpected,candidateBlocksFor} from '../support/replicaCandidateFixture.mts';
import {verifyReplicaCandidateManifest} from '../../../apps/web/src/data/library/replicaCandidateProof';

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
