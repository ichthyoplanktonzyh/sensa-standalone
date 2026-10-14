/** Complete integrity rules through decoded rows, lazy wire references and a
 * real SQLite/Wasm candidate. No OPFS, staged restore or capacity claim. */
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
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
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteSyncDependencies,syncAdmission} from '../../../apps/web/src/data/library/sqliteSyncDependencies';
import {admitLearningDelta,DeltaReceiveFallback,deltaComponents} from '../../../apps/web/src/data/library/learningDeltaAdmission';
import {sealedRecordReader} from '../../../apps/web/src/data/library/sealedRecordReader';
import {observeReplicaWork} from '../../../apps/web/src/data/library/replicaWork';
import {backupEqual} from '../../../apps/web/src/data/library/backupCodec';
import {libraryRestoreValidationVersion} from '../../../apps/web/src/data/library/replication/libraryReplicaValidation';
import type {LibraryRecordReader} from '../../../apps/web/src/data/library/libraryRecordReader';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://library-record-reader.fixture.invalid/')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());
const {validateBackupRows,validateLibraryRecords,validateLibraryRecordsCooperatively,validateLibraryRecordSteps,validateRestoreBackupRows,validateLibraryRestoreRecords,validateLibraryRestoreRecordsCooperatively}=await import('../../../apps/web/src/data/library/backupValidation');
const {validateLibraryReplica,validateLibraryReplicaCooperatively}=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID();
let source:BackupRows,baseline:BackupRows,identity:LibraryIdentity;
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
const replicated=(rows:BackupRows):BackupRows=>Object.fromEntries(libraryTables.map(table=>[table,rows[table].filter(row=>isReplicatedLibraryEntry(table,row.key)).map(row=>({key:row.key,value:normalizeLibraryReplicaEntry({...structuredClone(row),table:table as LibraryReplicaEntry['table']},identity).value}))])) as BackupRows;
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
  baseline=replicated(await snapshot());
  const target=await readLibrary(tx=>tx.get<any>('learningTargets',targets[0]!));vi.setSystemTime(target.memory.dueAt);
  await learningSystem.execute({kind:'start',operationId:id(),targetId:targets[0]!,languageContext:context,dailyLimit:20,sessionIntent:'review_only'});
  await action('reveal');const runId=await action('rate');await learningSystem.execute({kind:'finish',operationId:id(),runId});
  source=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
  source.packageCache=[];source.operations=[];
 }finally{vi.useRealTimers();}
});
const deltaChanges=(before:BackupRows,after:BackupRows)=>libraryTables.flatMap(table=>{
 const old=new Map(before[table].map(row=>[row.key,row.value])),current=new Map(after[table].map(row=>[row.key,row.value]));
 return [...new Set([...old.keys(),...current.keys()])].filter(key=>!backupEqual(old.get(key),current.get(key))).map(key=>({table:table as LibraryReplicaEntry['table'],key,...(!current.has(key)?{deleted:true}:{})}));
});
async function deltaFixture(after=replicated(source),prior=baseline){
 const sqlite=await sqlite3InitModule(),raw=new sqlite.oo1.DB(':memory:','c'),storage=new SqliteRecordDatabase(sqlite,raw,'memory');storage.initialize();
 const dependencies=new SqliteSyncDependencies(raw),admission=syncAdmission();
 for(const row of records(prior))dependencies.observe(admission,row.table,row.key,JSON.stringify(encodeBackupValue(row.value)),row.value);
 const owner={subject:id(),accountId:id()},state={owner,incarnation:'delta-fixture',revision:1,checkpointVersion:7 as const,restoreValidationVersion:libraryRestoreValidationVersion,syncedLocalRevision:0,status:'synced' as const};
 dependencies.certify(admission,state,identity,0);const certificate=dependencies.certificate()!;expect(certificate).toBeDefined();
 const alive=()=>dependencies.assert(certificate),beforeReader=libraryRowsReader(prior),afterReader=libraryRowsReader(after);
 const controlled=(reader:LibraryRecordReader):LibraryRecordReader=>({...reader,get:(table,key)=>{alive();return reader.get(table,key);},has:(table,key)=>{alive();return reader.has(table,key);}});
 return {raw,dependencies,certificate,alive,base:controlled(beforeReader),remote:controlled(afterReader),changes:deltaChanges(prior,after),close:()=>{dependencies.close();storage.close();}};
}
test('eight independent histories use bounded component windows and prepare metadata without rereading bodies',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-20T00:00:00Z');
 const targets:string[]=[];
 const settle=async(targetId:string)=>{const target=await readLibrary(tx=>tx.get<any>('learningTargets',targetId));vi.setSystemTime(Math.max(Date.now()+1000,target.memory?.dueAt.getTime()??0));await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20});await action('reveal');const runId=await action('rate');await learningSystem.execute({kind:'finish',operationId:id(),runId});};
 let prior:BackupRows,after:BackupRows;
 try{
  for(let i=0;i<8;i++){const pack=portablePackageFixture({packageId:id(),expression:`window-${i}`}),installed=await contentSupplySystem.execute({kind:'install_portable_package',bytes:pack.bytes,expectedArchiveDigest:pack.archiveDigest});targets.push((await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:installed.key,languageContext:context}))[0]!);await settle(targets.at(-1)!);}
  prior=replicated(await snapshot());for(const target of targets)await settle(target);after=replicated(await snapshot());
 }finally{vi.useRealTimers();}
 expect(validateLibraryRestoreRecords(libraryRowsReader(after!))).toMatchObject({id:identity.id,learnerId:identity.learnerId});
 const fixture=await deltaFixture(after!,prior!);let held=0,peak=0,physical=0;const work:Record<string,number>={},componentLoads=new Map<string,number>();let inWindow=false;
 const reader=(rows:BackupRows,side:string)=>{const texts=new Map([...records(rows)].map(row=>[JSON.stringify([row.table,row.key]),JSON.stringify(encodeBackupValue(row.value))]));return sealedRecordReader({cloneDecoded:true,alive:fixture.alive,beforePage:fixture.alive,get(table,key){physical++;const identity=JSON.stringify([table,key]);if(inWindow){const k=side+identity;componentLoads.set(k,(componentLoads.get(k)??0)+1);}const text=texts.get(identity);return text===undefined?undefined:{record_key:key,value_json:text};},has:(table,key)=>texts.has(JSON.stringify([table,key])),keys(){return [];},rows(){return [];},plain(_table,row){return row.value_json;},missing():never{throw Error('missing fixture row');}});};
 const base=reader(prior!,'base'),remote=reader(after!,'remote');
 observeReplicaWork((kind,n)=>{work[kind]=(work[kind]??0)+n;if(kind==='window.heldBytes'){held+=n;peak=Math.max(peak,held);}});
 try{
  const prepared=await admitLearningDelta({...fixture,base,remote,window(){inWindow=true;const a=base.beginWindow(),b=remote.beginWindow();return ()=>{b();a();inWindow=false;};},canonical:(side,table,key)=>(side==='base'?base:remote).canonical(table,key),consume:async()=>{expect(held).toBeGreaterThan(0);}});
  expect(work['component.open']).toBe(8);expect(work['component.release']).toBe(8);expect(held).toBe(0);expect(peak).toBeLessThanOrEqual(8*1024*1024);expect(work['window.bypass']??0).toBe(0);
  const historyLoads=[...componentLoads].filter(([key])=>/learningTargets|learningRuns|learningEvents|studyScopes|learningSessions/.test(key));expect(historyLoads.length).toBeGreaterThan(80);expect(historyLoads.every(([,count])=>count===1)).toBe(true);
  const before=physical;expect(await prepared.prepare()).toEqual(fixture.changes.map(({table,key})=>({table,key})));const metadata=await prepared.prepare();metadata[0]!.key='caller mutation';expect((await prepared.prepare())[0]!.key).not.toBe('caller mutation');expect(physical).toBe(before);
  // A valid shared Scope joins all affected histories without adding support
  // rows to admission. Its predicate result still matches the full oracle.
  const shared=structuredClone(after!),oldRuns=new Set(prior!.learningRuns.map(row=>row.key)),newRuns=shared.learningRuns.filter(row=>!oldRuns.has(row.key)),replaced=new Set(newRuns.map(row=>row.value.studyScopeRevisionId));
  const selectedScopes=shared.studyScopes.filter(row=>replaced.has(row.key));expect(selectedScopes).toHaveLength(8);
  const scope=structuredClone(selectedScopes[0]!.value);scope.members=selectedScopes.flatMap(row=>row.value.members);scope.enrollments=[...new Map(selectedScopes.flatMap(row=>row.value.enrollments).map((row:any)=>[row.id,row])).values()];
  const {id:discardId,createdAt,createdByOperationId,definitionDigest:discardDigest,...body}=scope;scope.definitionDigest=canonicalJsonDigest(body);scope.id=stableUuid(`local-study-scope:${createdByOperationId}:${scope.definitionDigest}`);shared.studyScopes.push({key:scope.id,value:scope});
  for(const row of newRuns)row.value.studyScopeRevisionId=scope.id;
  const oldSessions=new Set(prior!.learningSessions.map(row=>row.key));for(const row of shared.learningSessions)if(!oldSessions.has(row.key)&&replaced.has(row.value.scopeRevisionId))row.value.scopeRevisionId=scope.id;
  expect(validateLibraryRestoreRecords(libraryRowsReader(shared))).toMatchObject({id:identity.id});
  const connected=await deltaFixture(shared,prior!);try{const start=work['component.open']!;const result=await admitLearningDelta(connected);expect(work['component.open']!-start).toBe(1);expect(await result.prepare()).toEqual(connected.changes.map(({table,key})=>({table,key})));}finally{connected.close();}

 }finally{observeReplicaWork(undefined);fixture.close();}
});

// These fixtures verify execution inventory only. Domain acceptance remains
// covered above by genuine histories and the unchanged full restore oracle.
for(const relation of ['multi-target','predecessor','shared-session','shared-scope','active-pointers','reconciliation','edge-capacity'] as const)test(`component execution joins or keeps the whole frontier for ${relation}`,async()=>{
 const selection=new Map(libraryTables.map(table=>[table,new Set<string>()]));
 for(let i=0;i<2;i++){selection.get('learningTargets')!.add(`t${i}`);selection.get('learningRuns')!.add(`r${i}`);selection.get('learningSessions')!.add(`s${i}`);selection.get('studyScopes')!.add(`c${i}`);}
 const facts=new Map<string,any>(),key=(table:string,id:string)=>JSON.stringify([table,id]);
 for(let i=0;i<2;i++){facts.set(key('learningRuns',`r${i}`),{targetIds:[`t${i}`],learningSessionId:`s${i}`,studyScopeRevisionId:`c${i}`});facts.set(key('learningSessions',`s${i}`),{runIds:[`r${i}`],scopeRevisionId:`c${i}`});facts.set(key('studyScopes',`c${i}`),{members:[{targetId:`t${i}`} ]});}
 if(relation==='multi-target')facts.get(key('learningRuns','r0')).targetIds.push('t1');
 if(relation==='predecessor')facts.get(key('learningRuns','r1')).continuedFromRunId='r0';
 if(relation==='shared-session')facts.get(key('learningSessions','s0')).runIds.push('r1');
 if(relation==='shared-scope')facts.get(key('studyScopes','c0')).members.push({targetId:'t1'});
 if(relation==='reconciliation')selection.get('learningReconciliations')!.add('decision');
 if(relation==='edge-capacity')facts.get(key('learningSessions','s0')).runIds=Array(30000).fill('r0');
 const reader=(active:string|undefined):LibraryRecordReader=>({get:(table,id)=>table==='meta'&&id==='learning-active'?active:facts.get(key(table,id)),has:(table,id)=>facts.has(key(table,id)),entries:()=>[]});
 let held=0,edges=0,bypass=0,checks=0;observeReplicaWork((kind,n)=>{if(kind==='component.graphBytes')held+=n;if(kind==='component.graphEdges')edges+=n;if(kind==='component.graphBypass')bypass+=n;});
 try{const changes=[{table:'learningTargets' as const,key:'t0'},{table:'learningTargets' as const,key:'t1'}];const result=await deltaComponents(selection,changes,new Set(),new Map(),reader(relation==='active-pointers'?'r0':undefined),reader(relation==='active-pointers'?'r1':undefined),()=>{checks++;});
  expect(result).toHaveLength(1);expect([...result[0]!.selection.get('learningTargets')!]).toEqual(['t0','t1']);expect(result[0]!.changes).toEqual(changes);expect([...result[0]!.selection.get('learningRuns')!]).toEqual(['r0','r1']);expect(held).toBeLessThanOrEqual(4*1024*1024);
  if(relation==='edge-capacity'){expect(bypass).toBe(1);expect(checks).toBeLessThan(60000);}else if(relation!=='reconciliation')expect(edges).toBeGreaterThan(0);
 }finally{observeReplicaWork(undefined);}
});

test('changed Event closure reads each side once rather than scanning the overlay for every related Run',async()=>{
 const after=replicated(source),fixture=await deltaFixture(after);let phase='',beforeEvents=0,afterEvents=0;
 const count=(reader:LibraryRecordReader,side:'before'|'after'):LibraryRecordReader=>({...reader,get(table,key){if(phase==='eligibility'&&table==='learningEvents'){if(side==='before')beforeEvents++;else afterEvents++;}return reader.get(table,key);}});
 try{
  expect(validateLibraryRestoreRecords(libraryRowsReader(after))).toMatchObject({id:identity.id,learnerId:identity.learnerId});
  const result=await admitLearningDelta({...fixture,base:count(fixture.base,'before'),remote:count(fixture.remote,'after'),phase:name=>{phase=name;}});
  const changedEvents=fixture.changes.filter(row=>row.table==='learningEvents').length;
  expect(changedEvents).toBe(2);expect(result.evidence.runs).toBe(2);expect(result.evidence.events).toBe(4);
  expect(beforeEvents).toBe(changedEvents);expect(afterEvents).toBe(changedEvents);
  expect(result.evidence.changedEventClosure).toEqual({baselineLookups:2,candidateLookups:2,runLookups:2,indexedRelations:2,edgeVisits:2});
  expect(await result.prepare()).toEqual(fixture.changes.map(({table,key})=>({table,key})));
 }finally{fixture.close();}
});
test('redundant immutable Event puts preserve both baseline and overlay reachability without duplicate edges',async()=>{
 const fixture=await deltaFixture();try{
  const targetId=source.learningEvents.find(row=>!baseline.learningEvents.some(prior=>prior.key===row.key))!.value.targetId;
  const old=baseline.learningEvents.find(row=>row.value.targetId===targetId)!;
  const result=await admitLearningDelta({...fixture,changes:[...fixture.changes,{table:'learningEvents',key:old.key}]});
  expect(result.evidence.runs).toBe(2);expect(result.evidence.events).toBe(4);
  expect(result.evidence.changedEventClosure).toEqual({baselineLookups:3,candidateLookups:3,runLookups:2,indexedRelations:3,edgeVisits:3});
  expect((await result.prepare()).some(row=>row.key===old.key)).toBe(false);
 }finally{fixture.close();}
});
for(const fault of ['delete-old-event','rebind-old-run','retarget-old-event','missing-changed-event','missing-event-run','cross-target-event'] as const)test(`Event adjacency retains fail-closed admission for ${fault}`,async()=>{
 const after=replicated(source),old=baseline.learningEvents[0]!,fresh=after.learningEvents.find(row=>!baseline.learningEvents.some(prior=>prior.key===row.key))!;
 if(fault==='delete-old-event')after.learningEvents=after.learningEvents.filter(row=>row.key!==old.key);
 else if(fault==='rebind-old-run')after.learningEvents.find(row=>row.key===old.key)!.value.runId=fresh.value.runId;
 else if(fault==='retarget-old-event')after.learningEvents.find(row=>row.key===old.key)!.value.targetId=after.learningTargets.find(row=>row.key!==old.value.targetId)!.key;
 else if(fault==='missing-changed-event')after.learningEvents=after.learningEvents.filter(row=>row.key!==fresh.key);
 else if(fault==='missing-event-run')fresh.value.runId=id();
 else fresh.value.targetId=after.learningTargets.find(row=>row.key!==fresh.value.targetId)!.key;
 const fixture=await deltaFixture(after);try{
  const work=admitLearningDelta({...fixture,changes:fault==='missing-changed-event'?[...fixture.changes,{table:'learningEvents',key:fresh.key}]:fixture.changes});
  if(fault==='delete-old-event')await expect(work).rejects.toMatchObject({reason:'deleted_record'} satisfies Partial<DeltaReceiveFallback>);
  else if(fault==='rebind-old-run'||fault==='retarget-old-event')await expect(work).rejects.toMatchObject({reason:'immutable_record_change'} satisfies Partial<DeltaReceiveFallback>);
  else await expect(work).rejects.toThrow('libraryBackup.errors.inconsistent');
  expect(()=>validateLibraryRestoreRecords(libraryRowsReader(after))).toThrow();
 }finally{fixture.close();}
});
test('Event adjacency construction and consumption keep checking the certified baseline generation',async()=>{
 for(const at of ['eligibility','eventRun','dependencyClosure']){const fixture=await deltaFixture();try{
  if(at==='eventRun'){const query=fixture.dependencies.keys.bind(fixture.dependencies);fixture.dependencies.keys=(kind,target)=>{const result=query(kind,target);if(kind==='eventRun')fixture.raw.exec('DELETE FROM sensa_sync_dependency_edges_v1');return result;};}
  await expect(admitLearningDelta({...fixture,phase(name){if(name===at)fixture.raw.exec('DELETE FROM sensa_sync_dependency_edges_v1');}})).rejects.toThrow('library_sync_local_changed');
 }finally{fixture.close();}}
});
function* records(rows:BackupRows):Generator<LibraryCandidateRecord>{for(const table of libraryTables)for(const row of rows[table])yield {table,...row};}
const corrupt=(change:(rows:BackupRows)=>void)=>{const rows=structuredClone(source);change(rows);return rows;};
const cases=[
 {name:'two introduced Targets and a later Review',change:null},
 {name:'a forged final memory revision',change:(rows:BackupRows)=>{rows.learningTargets[0]!.value.memoryRevision++;}},
 {name:'a missing Action from the first Run',change:(rows:BackupRows)=>{rows.learningEvents.shift();}},
 {name:'an orphan Action outside the replay inventory',change:(rows:BackupRows)=>{rows.learningEvents[0]!.value.runId=id();}},
 {name:'a changed historical evaluation result',change:(rows:BackupRows)=>{const event=rows.learningEvents.find(row=>row.value.detail.formalEvaluation)!;event.value.detail.formalEvaluation.evaluation.result={historicalAlgorithmDisagreement:true};}},
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

test('cooperative validation preserves the complete result and rejects malformed unused preference wire',async()=>{
 expect(await validateLibraryRecordsCooperatively(libraryRowsReader(source))).toEqual(validateBackupRows(source));
 const entries:LibraryReplicaEntry[]=[];
 for(const row of records(source))if(isReplicatedLibraryEntry(row.table,row.key)){
  const normalized=normalizeLibraryReplicaEntry({...row,table:row.table as LibraryReplicaEntry['table']},identity);entries.push({...normalized,value:encodeBackupValue(normalized.value)});
 }
 const bad=[...entries,{table:'settings' as const,key:'opaque-preference',value:['unsupported-tag','not a value']}];
 expect(()=>validateLibraryReplica(bad)).toThrow('libraryBackup.errors.format');
 await expect(validateLibraryReplicaCooperatively(bad)).rejects.toThrow('libraryBackup.errors.format');
});

for(const stage of ['semanticState','learningReconciliations'] as const)for(const reason of ['account_changed','library_sync_local_changed','library_sync_candidate_discarded'])test(`${stage} validation preserves reader control failure: ${reason}`,async()=>{
 const reader=libraryRowsReader(source),failure=Error(reason);let passes=0;
 const controlled={...reader,entries(table:Parameters<typeof reader.entries>[0]){
  // The first pass strictly decodes all tables. Fail specifically in the PSW
  // rule pass, where the old broad catch hid reader failures as corruption.
  if(table===stage&&++passes===2)throw failure;
  return reader.entries(table);
 }};
 await expect(validateLibraryRecordsCooperatively(controlled)).rejects.toBe(failure);
});

test('a genuine long Run checks and replays individual Action bodies between cooperative steps',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-08T00:00:00Z');
 try{
  const fixture=portablePackageFixture({packageId:id(),expression:'long-run-action-stream'}),pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  const [targetId]=await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context});
  await learningSystem.execute({kind:'start',operationId:id(),targetId:targetId!,languageContext:context,dailyLimit:20});
  for(let attempt=0;attempt<80;attempt++){
   await action('reveal');const runtime=(await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.now()})).runtime!;
   if(runtime.kind!=='lightweight')throw Error('Expected lightweight learning');vi.setSystemTime(Date.now()+1000);
   await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'again'}});
  }
  await action('reveal');const runId=await action('rate');await learningSystem.execute({kind:'finish',operationId:id(),runId});
  const candidate=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);
  candidate.packageCache=[];candidate.operations=[];
  const longActions=candidate.learningEvents.filter(row=>row.value.runId===runId);expect(longActions).toHaveLength(162);
  const reader=libraryRowsReader(candidate);let reads=0,maxReads=0,totalReads=0;
  const indexed={...reader,get(table:Parameters<typeof reader.get>[0],key:string){
   if(table==='learningEvents'){reads++;totalReads++;}
   const value=reader.get(table,key);return value===undefined?undefined:structuredClone(value);
  }};
  const steps=validateLibraryRecordSteps(indexed);let result:ReturnType<typeof steps.next>;
  do{result=steps.next();maxReads=Math.max(maxReads,reads);reads=0;}while(!result.done);
  expect(result.value.id).toBe(identity.id);expect(totalReads).toBeGreaterThanOrEqual(longActions.length*2);
  // The previous whole-Run map performed 162 body reads in one step. This is
  // a body-fetch locality assertion, not a whole-process heap/latency claim.
  expect(maxReads).toBeLessThanOrEqual(2);
  expect(await validateLibraryRecordsCooperatively(indexed)).toEqual(identity);
 }finally{vi.useRealTimers();}
});

for(const sample of cases)test(`saved-state restoration retains structural rejection: ${sample.name}`,async()=>{
 const rows=sample.change?corrupt(sample.change):structuredClone(source);
 const accepted=sample.change===null||sample.name==='a changed historical evaluation result';
 const candidate=await sqliteLibraryCandidate(records(rows));
 try{for(const reader of [libraryRowsReader(rows),candidate.reader]){
  if(accepted)expect(validateLibraryRestoreRecords(reader)).toEqual(identity);
  else expect(()=>validateLibraryRestoreRecords(reader)).toThrow();
 }}finally{candidate.close();}
});
test('saved Memory is authoritative at restore; explicit history audit still detects algorithm disagreement',async()=>{
 const rows=corrupt(rows=>{rows.learningTargets[0]!.value.memory.fsrsStability+=0.125;});
 const original=structuredClone(rows);
 expect(validateRestoreBackupRows(rows)).toEqual(identity);
 expect(await validateLibraryRestoreRecordsCooperatively(libraryRowsReader(rows))).toEqual(identity);
 expect(rows).toEqual(original);
 expect(()=>validateBackupRows(rows)).toThrow('libraryBackup.errors.inconsistent');
});
for(const mutation of [
 (rows:BackupRows)=>{rows.learningTargets[0]!.value.memory.fsrsCardState='invented';},
 (rows:BackupRows)=>{rows.learningTargets[0]!.value.memory.dueAt=new Date(NaN);},
 (rows:BackupRows)=>{rows.learningTargets[0]!.value.memory.fsrsStability=-1;},
 (rows:BackupRows)=>{rows.learningRuns[0]!.value.protocolState.value.phase='invented';},
 (rows:BackupRows)=>{rows.learningRuns[0]!.value.participants[rows.learningRuns[0]!.value.targetId].progress.progressEpoch=-1;},
 (rows:BackupRows)=>{rows.learningEvents[0]!.value.detail.formalEvaluation.attempt.learnerUserId=id();},
])test(`restore rejects invalid saved state shape ${mutation.toString()}`,()=>expect(()=>validateRestoreBackupRows(corrupt(mutation))).toThrow());

test('a well-formed historical scheduling contradiction restores verbatim and remains detectable by audit',()=>{
 const rows=corrupt(rows=>{const event=rows.learningEvents.find(row=>row.value.detail.transition.retention?.kind==='memory_outcome')!;event.value.detail.transition.retention.schedulingDecision.nextDueAt='2099-01-01T00:00:00.000Z';});
 expect(validateRestoreBackupRows(rows)).toEqual(identity);
 expect(()=>validateBackupRows(rows)).toThrow('libraryBackup.errors.inconsistent');
});

for(const mutation of ['run-identity','protocol-version','checkpoint-set'] as const)test(`restore rejects a mismatched inner lightweight progress ${mutation}`,()=>{
 const rows=corrupt(rows=>{const run=rows.learningRuns.find(row=>row.value.purpose==='initial_learning')!.value,progress=run.protocolState.value.initial.progress;
  if(mutation==='run-identity')progress.protocolRunId=id();
  if(mutation==='protocol-version')progress.protocolVersion='unavailable';
  if(mutation==='checkpoint-set')progress.checkpointCredits.extra={status:'unresolved',creditedInEpoch:null,lastObservationId:null};
 });
 expect(()=>validateRestoreBackupRows(rows)).toThrow('libraryBackup.errors.inconsistent');
});

test('ordinary restoration never calls the historical protocol reducer or settlement scheduler; audit still does',async()=>{
 const protocol=await import('../../../apps/web/src/learning/runtime/localProtocol'),settlement=await import('../../../apps/web/src/data/library/learningSettlement');
 const reducer=vi.spyOn(protocol,'reduceLocalProtocolAction');
 const scheduler=vi.spyOn(settlement,'applyLocalProtocolTransition');
 try{
  expect(validateRestoreBackupRows(structuredClone(source))).toEqual(identity);expect(reducer).not.toHaveBeenCalled();expect(scheduler).not.toHaveBeenCalled();
  expect(validateBackupRows(structuredClone(source))).toEqual(identity);expect(reducer).toHaveBeenCalled();expect(scheduler).toHaveBeenCalled();
 }finally{reducer.mockRestore();scheduler.mockRestore();}
});
