/** Complete integrity rules through decoded rows, lazy wire references and a
 * real SQLite/Wasm candidate. No OPFS, staged restore or capacity claim. */
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables,type LibraryIdentity} from '../../../apps/web/src/data/library/store';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {libraryRowsReader,libraryRecordViews} from '../../../apps/web/src/data/library/libraryRecordReader';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,type LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {sqliteLibraryCandidate,type LibraryCandidateRecord} from '../support/semanticWorldRecordFixture.mts';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://library-record-reader.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
const {validateBackupRows,validateLibraryRecords}=await import('../../../apps/web/src/data/library/backupValidation');
const {validateLibraryReplica}=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID();
let source:BackupRows,identity:LibraryIdentity;
const action=async(kind:'reveal'|'rate')=>{
 const runtime=(await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.now()})).runtime!;
 if(runtime.kind!=='lightweight')throw Error('Expected lightweight learning');
 vi.setSystemTime(Date.now()+1000);
 await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:kind==='reveal'?{kind}:{kind,rating:'good'}});
 return runtime.runId;
};
beforeAll(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-01T00:00:00Z');
 try{
  identity=await openLibrary();
  const targets:string[]=[];
  for(const expression of ['record-first','record-second']){
   const fixture=portablePackageFixture({packageId:id(),expression}),pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
   targets.push((await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context}))[0]!);
  }
  for(const targetId of targets){
   await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20});
   await action('reveal');const runId=await action('rate');await learningSystem.execute({kind:'finish',operationId:id(),runId});vi.setSystemTime(Date.now()+1000);
  }
  const target=await readLibrary(tx=>tx.get<any>('learningTargets',targets[0]!));vi.setSystemTime(target.memory.dueAt);
  await learningSystem.execute({kind:'start',operationId:id(),targetId:targets[0]!,languageContext:context,dailyLimit:20,sessionIntent:'review_only'});
  await action('reveal');const runId=await action('rate');await learningSystem.execute({kind:'finish',operationId:id(),runId});
  source=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
  source.packageCache=[];source.operations=[];
 }finally{vi.useRealTimers();}
});
function* records(rows:BackupRows):Generator<LibraryCandidateRecord>{for(const table of libraryTables)for(const row of rows[table])yield {table,...row};}
const corrupt=(change:(rows:BackupRows)=>void)=>{const rows=structuredClone(source);change(rows);return rows;};
const cases=[
 {name:'two introduced Targets and a later Review',change:null},
 {name:'a forged final memory revision',change:(rows:BackupRows)=>{rows.learningTargets[0]!.value.memoryRevision++;}},
 {name:'a missing Action from the first Run',change:(rows:BackupRows)=>{rows.learningEvents.shift();}},
 {name:'an orphan Action outside the replay inventory',change:(rows:BackupRows)=>{rows.learningEvents[0]!.value.runId=id();}},
 {name:'a changed historical evaluation result',change:(rows:BackupRows)=>{const event=rows.learningEvents.find(row=>row.value.detail.transition.retention)!;event.value.detail.transition.retention.nextDueAt='2099-01-01T00:00:00.000Z';}},
 {name:'a dangling Session scope',change:(rows:BackupRows)=>{rows.learningSessions[0]!.value.scopeRevisionId=id();}},
];
for(const sample of cases)test(`complete row and indexed candidate rules agree: ${sample.name}`,async()=>{
 const rows=sample.change?corrupt(sample.change):source,candidate=await sqliteLibraryCandidate(records(rows));
 try{
  const valid=sample.change===null;
  const accepted=(work:()=>unknown)=>{try{work();return true;}catch{return false;}};
  expect(accepted(()=>validateBackupRows(rows))).toBe(valid);
  expect(accepted(()=>validateLibraryRecords(libraryRowsReader(rows)))).toBe(valid);
  expect(accepted(()=>validateLibraryRecords(candidate.reader))).toBe(valid);
  if(valid){expect(rows.learningRuns).toHaveLength(3);expect(rows.learningEvents).toHaveLength(6);expect(candidate.reader.get('learningTargets',rows.learningTargets[0]!.key).memory.dueAt).toBeInstanceOf(Date);}
 }finally{candidate.close();}
});

test('the complete validated wire candidate reads exact facts on demand without sharing mutable decoded bodies',()=>{
 const entries:LibraryReplicaEntry[]=[];
 for(const row of records(source))if(isReplicatedLibraryEntry(row.table,row.key)){
  const normalized=normalizeLibraryReplicaEntry({...row,table:row.table as LibraryReplicaEntry['table']},identity);entries.push({...normalized,value:encodeBackupValue(normalized.value)});
 }
 const candidate=validateLibraryReplica(entries),key=source.learningTargets[0]!.key;
 const one=candidate.records.get('learningTargets',key),two=candidate.records.get('learningTargets',key);
 expect(candidate.identity.id).toBe(identity.id);expect(one).toEqual(two);expect(one).not.toBe(two);
 one.curriculumMemberships[0].material.content.resources=[];
 expect(candidate.records.get('learningTargets',key)).toEqual(two);
 expect(candidate.records.get('learningTargets','missing')).toBeUndefined();
 expect(()=>validateLibraryReplica([...entries,entries.find(row=>row.table==='learningTargets')!])).toThrow('libraryBackup.errors.inconsistent');
});

test('duplicate physical keys in decoded backup rows cannot silently select a different fact',()=>{
 const rows=corrupt(rows=>{rows.learningTargets.push({...rows.learningTargets[0]!});});
 expect(()=>validateBackupRows(rows)).toThrow('libraryBackup.errors.inconsistent');
});

test('existence checks use only candidate keys rather than decoding fact bodies',async()=>{
 const candidate=await sqliteLibraryCandidate(records(source));
 try{
  const views=libraryRecordViews(candidate.reader),pointReads=candidate.metrics.pointReads;
  expect(views.maps.learningTargets.has(source.learningTargets[0]!.key)).toBe(true);
  expect(views.maps.learningTargets.has('missing')).toBe(false);
  expect(candidate.metrics.existenceReads).toBe(2);expect(candidate.metrics.pointReads).toBe(pointReads);
  const rows=corrupt(rows=>{rows.settings.push({key:'opaque-undefined',value:undefined});});
  expect(libraryRowsReader(rows).has('settings','opaque-undefined')).toBe(true);
 }finally{candidate.close();}
});

test('candidate iteration order does not choose a different replay result',()=>{
 const rows=structuredClone(source);for(const table of libraryTables)rows[table].reverse();
 expect(validateLibraryRecords(libraryRowsReader(rows)).id).toBe(identity.id);
});
