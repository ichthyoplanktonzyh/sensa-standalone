import {afterAll,expect,test,vi} from 'vitest';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import type {Table} from '../../../apps/web/src/data/library/store';
import type {LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
type FixtureRows=Record<Table,Array<{key:string;value:any}>>;
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://readonly-review.fixture.invalid/')});
let now=Date.parse('2026-10-01T07:00:00Z');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
const database=await useNodeLearningCapacityStorage();afterAll(()=>{vi.useRealTimers();database.close();});

test('all real completed branches replay their exact baseline and immutable Actions, while only the causal winner contributes scheduling',async()=>{
const {defaultSensaLanguageRoute,sensaPinnedLanguageContext}=await import('@sensa/contracts/sensa');
const {portablePackageFixture}=await import('../../../scripts/support/portablePackageFixture.mts');
const {contentSupplySystem}=await import('../../../apps/web/src/contentSupply/system/index.ts');
const c=await import('../../../apps/web/src/data/library/learning.ts'),s=await import('../../../apps/web/src/data/library/store.ts');
const {validateBackupRows,validateRestoreBackupRows}=await import('../../../apps/web/src/data/library/backupValidation.ts');
const {mergeLibraryReplicas,isReplicatedLibraryEntry}=await import('../../../apps/web/src/data/library/replication/libraryReplica.ts');
const {encodeBackupValue,decodeBackupValue}=await import('../../../apps/web/src/data/library/backupCodec.ts');
const id=()=>crypto.randomUUID(),ctx=sensaPinnedLanguageContext(defaultSensaLanguageRoute);await s.openLibrary();
const f=portablePackageFixture({packageId:id(),expression:'read-only-review'}),pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:f.bytes,expectedArchiveDigest:f.archiveDigest});
const [targetId]=await c.enrollPackage(id(),pack.key,ctx);await c.confirmLearningQuantity(id(),ctx,20);
const snap=():Promise<FixtureRows>=>s.readLibrary(async tx=>Object.fromEntries(await Promise.all(s.libraryTables.map(async table=>[table,await tx.entries(table)])))) as Promise<FixtureRows>;
const settle=async()=>{vi.setSystemTime(now);const at=new Date(now).toISOString();let r=await c.startLearning(id(),targetId,ctx,20,at);r=await c.actLearning(id(),r.id,r.revision,{kind:'reveal'},at);r=await c.actLearning(id(),r.id,r.revision,{kind:'rate',rating:'good'},at);await c.finishLearning(id(),r.id);return r.id;};
now+=1000;await settle();const base=await snap();validateBackupRows(base as BackupRows);
now=base.learningTargets[0]!.value.memory.dueAt.getTime();await settle();const a=await snap();
await s.restoreLibraryTransaction(async tx=>{for(const table of s.libraryTables){const prior=new Map(base[table].map(row=>[row.key,row.value]));for(const row of a[table])if(!prior.has(row.key))tx.delete(table,row.key);for(const row of base[table])tx.put(table,row.key,row.value);}});
now+=60000;await settle();const b=await snap();
const entries=(rows:FixtureRows):LibraryReplicaEntry[]=>s.libraryTables.flatMap(table=>rows[table].filter(row=>isReplicatedLibraryEntry(table,row.key)).map(row=>({table,key:row.key,value:encodeBackupValue(row.value)}))) as LibraryReplicaEntry[];
const merged=mergeLibraryReplicas({base:entries(base),local:entries(a),remote:entries(b)});
const rows=Object.fromEntries(s.libraryTables.map(table=>[table,merged.entries.filter(row=>row.table===table).map(row=>({key:row.key,value:decodeBackupValue(row.value)}))])) as FixtureRows;rows.meta.push(...base.meta.filter(row=>!isReplicatedLibraryEntry('meta',row.key)));
validateBackupRows(rows as BackupRows);validateRestoreBackupRows(rows as BackupRows);const d=rows.learningReconciliations[0]!.value,loser=d.historyOnlyRunIds[0];
expect(merged.conflicts).toEqual([]);expect(d.historyOnlyRunIds).toHaveLength(1);expect(rows.learningRuns).toHaveLength(3);

for(const mutation of ['run-revision','run-completion-kind','event-kind','event-transition','event-time']){const changed=structuredClone(rows),r=changed.learningRuns.find(row=>row.key===loser)!.value,e=changed.learningEvents.find(row=>row.value.runId===loser)!.value;
 if(mutation==='run-revision')r.revision=999;
 if(mutation==='run-completion-kind')r.completionKind='manufactured';
 if(mutation==='event-kind')e.kind='manufactured';
 if(mutation==='event-transition')e.detail.transition={manufactured:true};
 if(mutation==='event-time')e.at='2020-01-01T00:00:00.000Z';
 expect(()=>validateBackupRows(changed as BackupRows),mutation).toThrow('libraryBackup.errors.inconsistent');expect(()=>validateRestoreBackupRows(changed as BackupRows),mutation).toThrow('libraryBackup.errors.inconsistent');}
const noDecision=structuredClone(rows);noDecision.learningReconciliations=[];
expect(()=>validateBackupRows(noDecision as BackupRows)).toThrow('libraryBackup.errors.inconsistent');expect(()=>validateRestoreBackupRows(noDecision as BackupRows)).toThrow('libraryBackup.errors.inconsistent');
const restore=async(wanted:FixtureRows)=>{const current=await snap();await s.restoreLibraryTransaction(async tx=>{for(const table of s.libraryTables){const prior=new Map(wanted[table].map(row=>[row.key,row.value]));for(const row of current[table])if(!prior.has(row.key))tx.delete(table,row.key);for(const row of wanted[table])tx.put(table,row.key,row.value);}});await s.openLibrary();};
const asRows=(output:{entries:LibraryReplicaEntry[]})=>{const value=Object.fromEntries(s.libraryTables.map(table=>[table,output.entries.filter(row=>row.table===table).map(row=>({key:row.key,value:decodeBackupValue(row.value)}))])) as FixtureRows;value.meta.push(...base.meta.filter(row=>!isReplicatedLibraryEntry('meta',row.key)));return value;};
const check=(name:string,basis:FixtureRows,left:FixtureRows,right:FixtureRows)=>{for(const reverse of [false,true]){const out=mergeLibraryReplicas({base:entries(basis),local:entries(reverse?right:left),remote:entries(reverse?left:right)}),value=asRows(out);expect(out.conflicts,name).toEqual([]);expect(()=>validateBackupRows(value as BackupRows),name).not.toThrow();expect(value.learningReconciliations,name).toHaveLength(2);}};
for(const later of [false,true]){await restore(base);now=base.learningTargets[0]!.value.memory.dueAt.getTime()+(later?120000:30000);await settle();const cbranch=await snap();check('D1 versus old baseline C '+(later?'C wins':'D1 wins'),base,rows,cbranch);}
await restore(a);now=a.learningTargets[0]!.value.memory.dueAt.getTime();await settle();const serialOld=await snap();check('D1 versus later serial Run on losing old branch A',base,rows,serialOld);
await restore(rows);now=rows.learningTargets[0]!.value.memory.dueAt.getTime();await settle();const nextA=await snap();
await restore(rows);now+=60000;await settle();const nextB=await snap();check('parallel next Runs after shared D1',rows,nextA,nextB);
await restore(b);now=b.learningTargets[0]!.value.memory.dueAt.getTime();const extra=await settle(),bSerial=await snap();
const firstWithSerial=mergeLibraryReplicas({base:entries(base),local:entries(a),remote:entries(bSerial)}),firstRows=asRows(firstWithSerial);validateBackupRows(firstRows as BackupRows);
await restore(base);now=bSerial.learningTargets[0]!.value.memory.dueAt.getTime()+60000;await settle();const laterC=await snap();
const second=mergeLibraryReplicas({base:entries(base),local:entries(firstRows),remote:entries(laterC)}),secondRows=asRows(second);validateBackupRows(secondRows as BackupRows);validateRestoreBackupRows(secondRows as BackupRows);
const changed=structuredClone(secondRows),old=changed.learningReconciliations.find(row=>row.key===firstRows.learningReconciliations[0]!.key)!.value;
const aRuns=new Set(a.learningRuns.map(row=>row.key)),baseRuns=new Set(base.learningRuns.map(row=>row.key)),aId=[...aRuns].find(key=>!baseRuns.has(key)),bId=b.learningRuns.map(row=>row.key).find(key=>!baseRuns.has(key));
old.appliedRunIds=[aId,extra].sort();old.historyOnlyRunIds=[bId];
old.appliedEventIds=changed.learningEvents.filter(row=>old.appliedRunIds.includes(row.value.runId)).map(row=>row.key).sort();
old.historyOnlyEventIds=changed.learningEvents.filter(row=>old.historyOnlyRunIds.includes(row.value.runId)).map(row=>row.key).sort();
expect(()=>validateBackupRows(changed as BackupRows)).toThrow('libraryBackup.errors.inconsistent');

await restore(base);now=base.learningTargets[0]!.value.memory.dueAt.getTime();vi.setSystemTime(now);const at=new Date(now).toISOString();
const act=async(r:Awaited<ReturnType<typeof c.startLearning>>,rating:'again'|'good')=>{r=await c.actLearning(id(),r.id,r.revision,{kind:'reveal'},at);return c.actLearning(id(),r.id,r.revision,{kind:'rate',rating},at);};
let review=await c.startLearning(id(),targetId,ctx,20,at,'review_only');review=await act(review,'again');
let repair=await c.continueLearning(id(),review.id,targetId,ctx,20,at);repair=await act(repair,'again');
let complete=await c.continueLearning(id(),repair.id,targetId,ctx,20,at,'relearning');complete=await act(complete,'good');
const value=await snap();value.operations=[];value.packageCache=[];validateBackupRows(value as BackupRows);validateRestoreBackupRows(value as BackupRows);
expect(value.learningTargets[0]!.value.memoryRevision).toBe(2);const repaired=value.learningRuns.find(row=>row.key===repair.id)!.value,completed=value.learningRuns.find(row=>row.key===complete.id)!.value;expect(repaired.participants[targetId].memoryRevision).toBe(completed.participants[targetId].memoryRevision);

});
