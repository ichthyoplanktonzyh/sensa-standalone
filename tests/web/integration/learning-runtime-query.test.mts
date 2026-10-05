import {test,expect} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {command,openLibrary} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {addLanguageRoute,updateLanguageRouteSupport} from '../../../apps/web/src/data/library/language';
import {readLibrary} from '../../../apps/web/src/data/library/store';

test('Runtime and Target detail use exact reads, plan only at a Run boundary, and never enumerate collection material or history',async()=>{
 Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
 const id=()=>crypto.randomUUID(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await openLibrary();await command({id:id(),kind:'fixture.owner',input:{}},async tx=>tx.put('meta','service-owner',{subject:id(),accountId:id()}));
 for(const expression of ['borrow','lend']){
  const fixture=portablePackageFixture({packageId:id(),expression});
  const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext:context});
 }
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 const at=new Date().toISOString();
 const initial=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(at)});
 const targetId=initial.queue.initialReadyTargetIds[0]!;
 await learningSystem.execute({kind:'start',operationId:id(),targetId,languageContext:context,dailyLimit:20,at});
 const expected=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(at)});
 const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter),get=adapter.get.bind(adapter),home=adapter.homeLearningProjection.bind(adapter);
 const targetReads:string[]=[];
 const forbidden=new Set(['learningTargets','learningRuns','learningEvents','curriculumEnrollments','packageCache']);
 adapter.homeLearningProjection=async()=>{throw new Error('Current Step reread collection planning');};
 adapter.entries=async table=>{if(forbidden.has(table))throw new Error('Runtime enumerated collection/history');return entries(table);};
 adapter.entriesPage=async(table,after,limit)=>{if(forbidden.has(table))throw new Error('Runtime paged collection/history');return page(table,after,limit);};
 adapter.get=async(table,key)=>{if(table==='learningTargets')targetReads.push(key);return get(table,key);};
 try{
  const current=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
  expect(current.runtime).toEqual(expected.runtime);
  expect(current.nextTargetId).toBeNull();
  expect(current.dailyLimit).toBe(20);
  expect(targetReads).toEqual([targetId]);
  targetReads.length=0;
  const detail=await learningSystem.read({kind:'target',targetId,languageContext:context,clock:Date.parse(at)});
  expect(detail.target).toEqual(expected.targets.find(target=>target.targetId===targetId));
  expect(detail.activeRunTargetIds).toEqual(expected.runtime!.targetIds);
  expect(detail.dailyLimit).toBe(20);
  expect(detail.policyOptions).toEqual(expected.policyOptions);
  expect(detail.exportPackageKey).toBe(detail.target!.packageKey);
  expect(targetReads).toEqual([targetId]);
  const mismatch=await learningSystem.read({kind:'target',targetId,languageContext:{...context,supportLanguageTag:'ja'},clock:Date.parse(at)});
  expect(mismatch.target).toBeNull();expect(mismatch.exportPackageKey).toBeNull();
  const missing=await learningSystem.read({kind:'target',targetId:id(),languageContext:context,clock:Date.parse(at)});
  expect(missing.target).toBeNull();
  await expect(learningSystem.read({kind:'target',targetId,languageContext:context,clock:Number.NaN})).rejects.toThrow('localFlow.clockChanged');
  adapter.get=async(table,key)=>{if(table==='learningTargets'&&key===targetId)throw new Error('detail_read_failed');return get(table,key);};
  await expect(learningSystem.read({kind:'target',targetId,languageContext:context,clock:Date.parse(at)})).rejects.toThrow();
 }finally{adapter.entries=entries;adapter.entriesPage=page;adapter.get=get;adapter.homeLearningProjection=home;}
 const before=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
 if(before.runtime?.kind!=='lightweight')throw new Error('Fixture must start ordinary lightweight Runtime');
 const reveal={kind:'act' as const,operationId:id(),runId:before.runtime.runId,expectedRevision:before.runtime.revision,action:{kind:'reveal' as const},at};
 await learningSystem.execute(reveal);await learningSystem.execute(reveal);
 const revealed=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
 if(revealed.runtime?.kind!=='lightweight')throw new Error('Fixture must retain ordinary lightweight Runtime');
 expect(revealed.runtime.phase).toBe('reveal');expect(revealed.runtime.revision).toBe(before.runtime.revision+1);
 expect(revealed.runtime.runId).toBe(before.runtime.runId);
 expect(revealed.runtime.step!.materialization).toEqual(before.runtime.step!.materialization);
 const again={kind:'act' as const,operationId:id(),runId:revealed.runtime.runId,expectedRevision:revealed.runtime.revision,action:{kind:'rate' as const,rating:'again' as const},at};
 await learningSystem.execute(again);await learningSystem.execute(again);
 const retried=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
 if(retried.runtime?.kind!=='lightweight')throw new Error('Again must retain ordinary lightweight Runtime');
 expect(retried.runtime.completed).toBe(false);expect(retried.runtime.phase).toBe('experience');
 expect(retried.runtime.runId).toBe(revealed.runtime.runId);expect(retried.runtime.currentTargetId).toBe(targetId);
 expect(retried.runtime.revision).toBe(revealed.runtime.revision+1);
 const unfinished=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(at)});
 expect(unfinished.records).toEqual([]);expect(unfinished.targets.find(target=>target.targetId===targetId)?.nextReviewAt).toBeNull();
 await expect(learningSystem.execute({...again,operationId:id()})).rejects.toThrow('localFlow.stepChanged');
 await learningSystem.execute({kind:'act',operationId:id(),runId:retried.runtime.runId,expectedRevision:retried.runtime.revision,action:{kind:'reveal'},at});
 const secondReveal=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
 await learningSystem.execute({kind:'act',operationId:id(),runId:secondReveal.runtime!.runId,expectedRevision:secondReveal.runtime!.revision,action:{kind:'rate',rating:'hard'},at});
 const completed=await learningSystem.read({kind:'runtime',languageContext:context,clock:Date.parse(at)});
 expect(completed.runtime?.completed).toBe(true);expect(completed.nextTargetId).not.toBe(targetId);expect(completed.nextTargetId).not.toBeNull();
 const saved=await learningSystem.read({kind:'workspace',languageContext:context,clock:Date.parse(at)});
 expect(saved.records).toHaveLength(1);expect(saved.targets.find(target=>target.targetId===targetId)?.nextReviewAt).toBeTruthy();
});

test('Home plans the current exact language pair after a support revision without rebinding the open Run',async()=>{
 Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
 await openLibrary();
 const id=()=>crypto.randomUUID();
 const route=await addLanguageRoute(id(),'en','ja'),context=sensaPinnedLanguageContext(route);
 const install=async(expression:string,supportLanguage:string)=>{
  const fixture=portablePackageFixture({packageId:id(),expression,supportLanguage});
  const pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  return pack.key;
 };
 const targets:string[]=[];
 for(const expression of ['route-first','route-second']){
  const key=await install(expression,'ja');
  targets.push((await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:key,languageContext:context}))[0]!);
 }
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext:context,dailyLimit:20});
 expect((await learningSystem.read({kind:'home',languageContext:context})).readyInitialCount).toBe(2);
 await learningSystem.execute({kind:'start',operationId:id(),targetId:targets[0]!,languageContext:context,dailyLimit:20});
 const before=await learningSystem.read({kind:'runtime',languageContext:context});
 const run=await readLibrary(tx=>tx.get<any>('learningRuns',before.runtime!.runId));
 const revised=sensaPinnedLanguageContext(await updateLanguageRouteSupport(id(),route.id,'es'));
 const home=await learningSystem.read({kind:'home',languageContext:revised});
 expect(home.readyInitialCount).toBe(0);expect(home.mixedReadyCount).toBe(0);expect(home.nextReviewTargetId).toBeNull();
 expect(home.activeRunId).toBe(run.id);
 expect((await learningSystem.read({kind:'workspace',languageContext:revised})).queue.initialReadyTargetIds).toEqual([]);
 const resumed=await learningSystem.read({kind:'runtime',languageContext:revised});
 expect(resumed.runtime).toEqual(before.runtime);expect(run.languageContext).toEqual(context);
 expect(await readLibrary(tx=>tx.get('learningRuns',run.id))).toEqual(run);
 const key=await install('route-current','es');
 const current=(await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:key,languageContext:revised}))[0]!;
 const next=await learningSystem.read({kind:'home',languageContext:revised});
 expect(next.readyInitialCount).toBe(1);expect(next.activeRunId).toBe(run.id);
 expect((await learningSystem.read({kind:'workspace',languageContext:revised})).queue.initialReadyTargetIds).toEqual([current]);
});
