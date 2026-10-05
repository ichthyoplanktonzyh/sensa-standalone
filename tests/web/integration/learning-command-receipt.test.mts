import {test,expect,vi} from 'vitest';
import {canonicalConsumerJson,defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {actLearning,startLearning,continueLearning} from '../../../apps/web/src/data/library/learning';
import {openLibrary,readLibrary,restoreLibraryTransaction,libraryTables} from '../../../apps/web/src/data/library/store';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://receipt.fixture.invalid/')});
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute),id=()=>crypto.randomUUID(),at='2026-09-01T08:00:00.000Z';
await openLibrary();
vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
const fixture=portablePackageFixture({packageId:id(),audioByteLength:52_000});
const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
const [targetId]=await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context});
await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
vi.useRealTimers();
const startId=id(),revealId=id();
let initialId:string,original:any,revealed:any;
const rows=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);

test('bounded receipts replay their exact original metadata after later progress, without duplicating facts',async()=>{
 original=await startLearning(startId,targetId!,context,20,at);initialId=original.id;
 revealed=await actLearning(revealId,initialId,original.revision,{kind:'reveal'},at);
 const completed=await actLearning(id(),initialId,revealed.revision,{kind:'rate',rating:'good'},at);
 expect(completed.completedAt).toBe(at);
 expect(await startLearning(startId,targetId!,context,20,at)).toEqual(original);
 expect(await actLearning(revealId,initialId,original.revision,{kind:'reveal'},at)).toEqual(revealed);
 expect(revealed.completedAt).toBeNull();expect(completed.revision).toBeGreaterThan(revealed.revision);
 await expect(actLearning(revealId,initialId,original.revision,{kind:'rate',rating:'hard'},at)).rejects.toThrow('localFlow.operationConflict');
 const snapshot=await rows();expect(snapshot.learningEvents).toHaveLength(2);expect(snapshot.learningRuns).toHaveLength(1);
 for(const row of snapshot.operations.filter(row=>['learning.start','learning.act'].includes(JSON.parse(row.value.input).kind))){
  expect(row.value.result.format).toBe('sensa-learning-run-receipt-v1');expect(JSON.stringify(row.value.result).length).toBeLessThan(1000);
  expect(row.value.result).not.toHaveProperty('participants');expect(row.value.result).not.toHaveProperty('protocolState');
 }
 snapshot.packageCache=[];validateBackupRows(snapshot);
 await learningSystem.execute({kind:'finish',operationId:id(),runId:initialId});
});

test('a receipt cannot point at another valid Run for the same target, or change its recorded input context/intent',async()=>{
 const due=(await learningSystem.read({kind:'workspace',languageContext:context})).targets[0]!.nextReviewAt!;
 const review=await startLearning(id(),targetId!,context,20,due,'review_only');
 const snapshot=await rows();snapshot.packageCache=[];
 const changedPointer=structuredClone(snapshot);changedPointer.operations.find(row=>row.key===startId)!.value.result=review;
 expect(()=>validateBackupRows(changedPointer)).toThrow('libraryBackup.errors.inconsistent');
 for(const patch of [{languageContext:{...context,supportLanguageTag:'fr'}},{sessionIntent:'review_only'},{at:'2026-09-01T09:00:00.000Z'}]){
  const changedInput=structuredClone(snapshot),operation=changedInput.operations.find(row=>row.key===startId)!;
  const command=JSON.parse(operation.value.input);command.input={...command.input,...patch};operation.value.input=canonicalConsumerJson(command);
  expect(()=>validateBackupRows(changedInput)).toThrow('libraryBackup.errors.inconsistent');
 }
 const stored=await readLibrary(tx=>tx.get<any>('operations',startId));
 await restoreLibraryTransaction(async tx=>tx.put('operations',startId,{...stored,result:review}));
 await expect(startLearning(startId,targetId!,context,20,at)).rejects.toThrow('localFlow.progressReadFailed');
 await restoreLibraryTransaction(async tx=>tx.put('operations',startId,stored));
 expect((await rows()).learningEvents).toHaveLength(2);
});

test('restore rejects a changed command revision and matching forged receipt even when the Action timeline is internally continuous',async()=>{
 const snapshot=await rows();snapshot.packageCache=[];validateBackupRows(snapshot);
 for(const revision of [0,2]){
  const changed=structuredClone(snapshot),operation=changed.operations.find(row=>row.key===revealId)!;
  const command=JSON.parse(operation.value.input);command.input.revision=revision;operation.value.input=canonicalConsumerJson(command);
  operation.value.result.revision=revision+1;
  expect(()=>validateBackupRows(changed)).toThrow('libraryBackup.errors.inconsistent');
 }
 for(const mutation of ['creation_revision','creation_completion','reveal_completion','completion_removed'] as const){
  const changed=structuredClone(snapshot),creation=changed.operations.find(row=>row.key===startId)!,reveal=changed.operations.find(row=>row.key===revealId)!;
  if(mutation==='creation_revision')creation.value.result.revision=2;
  if(mutation==='creation_completion')creation.value.result.completedAt=at;
  if(mutation==='reveal_completion')reveal.value.result.completedAt=at;
  if(mutation==='completion_removed')changed.operations.find(row=>JSON.parse(row.value.input).kind==='learning.act'&&row.value.result.completedAt===at)!.value.result.completedAt=null;
  expect(()=>validateBackupRows(changed),mutation).toThrow('libraryBackup.errors.inconsistent');
 }
});

test('continuation cannot precede its parent completion or silently change its language direction',async()=>{
 const snapshot=await rows();
 await expect(continueLearning(id(),initialId,targetId!,context,20,'2026-09-01T07:59:00.000Z')).rejects.toThrow('localFlow.clockChanged');
 await expect(continueLearning(id(),initialId,targetId!,{...context,supportLanguageTag:'fr'},20,'2026-09-05T08:00:00.000Z')).rejects.toThrow('localFlow.stepChanged');
 const after=await rows();expect(after.learningRuns).toEqual(snapshot.learningRuns);expect(after.learningEvents).toEqual(snapshot.learningEvents);expect(after.operations).toEqual(snapshot.operations);
});
