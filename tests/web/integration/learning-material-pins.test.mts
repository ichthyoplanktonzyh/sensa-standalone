import {test,expect,vi} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import {runBaselineMaterial,runStepMaterial,runMaterialDigest,pinRunStepMaterial,validateRunMaterialPins,type RunMaterialPins} from '../../../apps/web/src/learning/runtime/runMaterialPins';
import type {LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';
import type {LearningEvent} from '../../../apps/web/src/data/library/learning';
import {localLastPresentedMaterial} from '../../../apps/web/src/learning/runtime/localCurriculum';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://material-pins.fixture.invalid/')});
const {validateBackupRows,validateRestoreBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
await openLibrary();
const state=async()=>readLibrary(async tx=>{const active=await tx.get<string>('meta','learning-active');return (await tx.get<LocalLearningRun>('learningRuns',active!))!;});
const rows=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))) as BackupRows);

test('separate user action times reuse one immutable material body, while baseline and each acted Step remain exact',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-09-01T07:59:59.000Z');
 try{
 const fixture=portablePackageFixture({packageId:id(),expression:'retain'}),pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 const [targetId]=await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context});
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 const at='2026-09-01T08:00:00.000Z';
 const beforeStart=await rows();
 await expect(learningSystem.execute({kind:'start',operationId:id(),targetId:targetId!,languageContext:context,dailyLimit:20,at:'2026-09-01T07:59:58.000Z'})).rejects.toThrow('localFlow.clockChanged');
 expect(await rows()).toEqual(beforeStart);vi.setSystemTime('2026-09-01T08:00:07.000Z');
 await learningSystem.execute({kind:'start',operationId:id(),targetId:targetId!,languageContext:context,dailyLimit:20,at});
 const initial=await state(),baseline=runBaselineMaterial(initial.participants[targetId!]!);
 await learningSystem.execute({kind:'act',operationId:id(),runId:initial.id,expectedRevision:initial.revision,action:{kind:'reveal'},at:'2026-09-01T08:00:03.000Z'});
 const revealed=await state();
 await learningSystem.execute({kind:'act',operationId:id(),runId:revealed.id,expectedRevision:revealed.revision,action:{kind:'rate',rating:'good'},at:'2026-09-01T08:00:07.000Z'});
 const completed=await state(),participant=completed.participants[targetId!]!;
 expect(completed.completedAt).toBe('2026-09-01T08:00:07.000Z');expect(Object.keys(participant.materializations)).toEqual([participant.material]);
 expect(Object.values(participant.presentedMaterials)).toEqual([participant.material,participant.material]);
 expect(runBaselineMaterial(participant)).toEqual(baseline);expect(baseline.snapshot.createdAt).toBe(at);
 for(const stepId of Object.keys(participant.presentedMaterials))expect(runStepMaterial(participant,stepId)).toEqual(baseline);
 const snapshot=await rows();snapshot.packageCache=[];validateBackupRows(snapshot);validateRestoreBackupRows(snapshot);
 }finally{vi.useRealTimers();}
});

test('restore rejects a missing body, retargeted digest or mutated snapshot; callers never fall back to current Curriculum material',async()=>{
 const snapshot=await rows();snapshot.packageCache=[];validateBackupRows(snapshot);validateRestoreBackupRows(snapshot);
 for(const mutation of ['missing','pointer','body'] as const){
  const changed=structuredClone(snapshot),run=changed.learningRuns[0]!.value as LocalLearningRun,participant=run.participants[run.targetId]!;
  if(mutation==='missing')delete participant.materializations[participant.material];
  if(mutation==='pointer')participant.presentedMaterials[Object.keys(participant.presentedMaterials)[0]!]='0'.repeat(64);
  if(mutation==='body')participant.materializations[participant.material]!.snapshot.createdAt='2026-09-01T08:00:01.000Z';
  expect(()=>validateRunMaterialPins(participant)).toThrow();expect(()=>validateBackupRows(changed)).toThrow('libraryBackup.errors.inconsistent');expect(()=>validateRestoreBackupRows(changed)).toThrow('libraryBackup.errors.inconsistent');
 }
});

test('source readiness cannot be erased or moved across source admission or Run start even with correctly rehashed material pins',async()=>{
 const snapshot=await rows();snapshot.packageCache=[];snapshot.operations=[];validateBackupRows(snapshot);validateRestoreBackupRows(snapshot);
 for(const mutation of ['missing','before_admission','after_start'] as const){
  const changed=structuredClone(snapshot),run=changed.learningRuns[0]!.value as LocalLearningRun,participant=run.participants[run.targetId]!;
  const previous=participant.material,material=structuredClone(runBaselineMaterial(participant));
  if(mutation==='missing')Reflect.deleteProperty(material.snapshot.provenance,'sourceReadyAt');
  else material.snapshot.provenance.sourceReadyAt=mutation==='before_admission'?'2026-09-01T07:59:58.000Z':'2026-09-01T08:00:00.001Z';
  const reference=runMaterialDigest(material);delete participant.materializations[previous];participant.materializations[reference]=material;participant.material=reference;
  for(const step of participant.presentationOrder)participant.presentedMaterials[step]=reference;
  for(const {value:raw} of changed.learningEvents){const event=raw as LearningEvent;if(event.runId===run.id&&event.detail.nextPresentation)event.detail.nextPresentation.material=reference;}
  expect(()=>validateRunMaterialPins(participant),mutation).not.toThrow();
  expect(()=>validateBackupRows(changed),mutation).toThrow();
 }
});

test('same-instant Actions and repeated unacted refreshes replay causally, retain actual protocol bindings and survive sorted serialization',async()=>{
 const base=Date.now()-86_400_000,packageId=id(),expression='retain-updates';
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(base);
 try{
  const install=async(version:number)=>{
   const fixture=portablePackageFixture({packageId,version,expression,scene:`Same meaning, scene version ${version}.`});
   return contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  };
  const pack=await install(1),[targetId]=await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context});
  await learningSystem.execute({kind:'start',operationId:id(),targetId:targetId!,languageContext:context,dailyLimit:20});
  let run=await state();vi.setSystemTime(base+1000);
  await learningSystem.execute({kind:'act',operationId:id(),runId:run.id,expectedRevision:run.revision,action:{kind:'reveal'}});
  vi.setSystemTime(base+2000);const v2=await install(2);
  await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:v2.key,languageContext:context});
  await learningSystem.execute({kind:'start',operationId:id(),targetId:targetId!,languageContext:context,dailyLimit:20});
  vi.setSystemTime(base+3000);const v3=await install(3);
  await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:v3.key,languageContext:context});
  const beforeRejected=await rows();run=await state();
  await expect(learningSystem.execute({kind:'act',operationId:id(),runId:run.id,expectedRevision:run.revision,action:{kind:'rate',rating:'good'},at:new Date(base+2000).toISOString()})).rejects.toThrow('localFlow.clockChanged');
  expect(await rows()).toEqual(beforeRejected);
  for(const action of [{kind:'rate',rating:'again'},{kind:'reveal'},{kind:'rate',rating:'good'}] as const){
   run=await state();await learningSystem.execute({kind:'act',operationId:id(),runId:run.id,expectedRevision:run.revision,action});
  }
  run=await state();const participant=run.participants[targetId!]!,snapshot=await rows();snapshot.packageCache=[];snapshot.operations=[];
  expect(run.revision).toBe(8);expect(run.completedAt).not.toBeNull();expect(participant.presentationOrder).toHaveLength(4);
  expect(participant.presentationOrder.map(step=>runStepMaterial(participant,step).snapshot.provenance.packageVersion)).toEqual(['1','3','3','3']);
  const protocol=(run.protocolState.value as {initial:{completedSteps:{instance:{materialBindings:{learningMaterializationId:string}[]}}[]}}).initial;
  expect(protocol.completedSteps.map(step=>[...new Set(step.instance.materialBindings.map(binding=>binding.learningMaterializationId))])).toEqual(participant.presentationOrder.map(step=>[runStepMaterial(participant,step).snapshot.learningMaterializationId]));
  expect(Object.values(participant.materializations).map(material=>material.snapshot.provenance.packageVersion).sort()).toEqual(['1','2','3']);
  validateBackupRows(snapshot);validateRestoreBackupRows(snapshot);
  const serialized=decodeBackupValue(encodeBackupValue(snapshot)) as BackupRows;validateBackupRows(serialized);
  const roundtrip=serialized.learningRuns.find(row=>row.key===run.id)!.value as LocalLearningRun;
  expect(localLastPresentedMaterial(roundtrip.participants[targetId!]!).snapshot.provenance.packageVersion).toBe('3');
  // Controlled binding projection using actual admitted bodies. These names
  // guarantee lexical order is different; they are never persisted as facts.
  const ordered:RunMaterialPins={material:participant.material,materializations:{},presentedMaterials:{},presentationOrder:[]};
  pinRunStepMaterial(ordered,'z-first',runBaselineMaterial(participant));pinRunStepMaterial(ordered,'a-later',localLastPresentedMaterial(participant));
  const sorted=decodeBackupValue(encodeBackupValue(ordered)) as RunMaterialPins;
  expect(Object.keys(sorted.presentedMaterials)).toEqual(['a-later','z-first']);
  expect(sorted.presentationOrder).toEqual(['z-first','a-later']);expect(localLastPresentedMaterial(sorted)).toEqual(localLastPresentedMaterial(participant));
  for(const mutation of ['order','missing_order','missing_next','missing_revision','duplicate','gap','swap_refresh_action','future_next','orphan_refresh','orphan_body','opaque_material'] as const){
   const changed=structuredClone(serialized),saved=changed.learningRuns.find(row=>row.key===run.id)!.value as LocalLearningRun,pin=saved.participants[targetId!]!;
   const events=changed.learningEvents.map(row=>row.value as LearningEvent).filter(event=>event.runId===run.id).sort((a,b)=>a.detail.runRevision-b.detail.runRevision);
   if(mutation==='order')pin.presentationOrder.reverse();
   if(mutation==='missing_order')Reflect.deleteProperty(pin,'presentationOrder');
   if(mutation==='missing_next')Reflect.deleteProperty(events[0]!.detail,'nextPresentation');
   if(mutation==='missing_revision')Reflect.deleteProperty(events[0]!.detail,'runRevision');
   if(mutation==='duplicate')saved.lifecycleEvents[0]={...saved.lifecycleEvents[0]!,runRevision:events[0]!.detail.runRevision};
   if(mutation==='gap')events[0]!.detail.runRevision=999;
   if(mutation==='swap_refresh_action'){
    const index=saved.lifecycleEvents.findIndex(event=>event.kind==='current_step_material_refreshed'&&runMaterialDigest(Object.values(pin.materializations).find(material=>material.snapshot.learningMaterializationId===event.materializationId)!)===pin.presentedMaterials[pin.presentationOrder[1]!]!);
    const refresh=saved.lifecycleEvents[index]!,action=events[1]!,old=refresh.runRevision;
    saved.lifecycleEvents[index]={...refresh,runRevision:action.detail.runRevision};action.detail.runRevision=old;
   }
   if(mutation==='future_next')events[0]!.detail.nextPresentation!.material=pin.presentedMaterials[pin.presentationOrder[1]!]!;
   if(mutation==='orphan_refresh'){
    const removed=saved.lifecycleEvents.shift()!.runRevision;saved.revision--;
    saved.lifecycleEvents=saved.lifecycleEvents.map(event=>event.runRevision>removed?{...event,runRevision:event.runRevision-1}:event);
    for(const event of events)if(event.detail.runRevision>removed)event.detail.runRevision--;
   }
   if(mutation==='orphan_body'){
    const material=structuredClone(localLastPresentedMaterial(pin)),extra={...material,snapshot:{...material.snapshot,learningMaterializationId:id()}};
    pin.materializations[runMaterialDigest(extra)]=extra;
   }
   if(mutation==='opaque_material'){
    const value=saved.protocolState.value as {initial:typeof protocol};
    value.initial.completedSteps[1]!.instance.materialBindings[0]!.learningMaterializationId=runBaselineMaterial(pin).snapshot.learningMaterializationId;
   }
   expect(()=>validateBackupRows(changed),mutation).toThrow('libraryBackup.errors.inconsistent');
  }
 }finally{vi.useRealTimers();}
});
