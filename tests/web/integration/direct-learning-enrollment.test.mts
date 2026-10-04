import {test,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {semanticLookupPayload} from '../support/semanticLookupFixtures';
import {learningReplica} from '../../../apps/web/src/data/library/replication/learningReplica';
import {directPublishedFixture} from '../support/directPublishedFixture';

test('direct enrollment persists one fixed intent without a Meaning or fabricated ready Target, fences stale input and restores coherently',async()=>{
 const built=await build({stdin:{contents:[
  `export * from './apps/web/src/data/library/store';`,
  `export * from './apps/web/src/data/library/language';`,
  `export {sqliteRecordAdapter} from './apps/web/src/data/library/sqliteAdapter';`,
  `export {learningSystem} from './apps/web/src/learning/system/learningSystem';`,
  `export {LibraryJourneyRepository} from './apps/web/src/experience/personalMeaningJourney/repository';`,
  `export {validateBackupRows} from './apps/web/src/data/library/backupValidation';`,
 ].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},plugins:[{name:'fixture-auth',setup(builder){builder.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:"export const auth={getSession:async()=>({data:{session:null}})}; export {authStorageKey,cachedAuthSubject} from './authSessionHint';",loader:'ts'}));}}]});
 Object.assign(globalThis,{window:new EventTarget(),location:{origin:'http://direct-enrollment.fixture'},BroadcastChannel:undefined});
 const directory=await mkdtemp(join(tmpdir(),'sensa-direct-enrollment-'));
 try{
  await writeFile(join(directory,'enrollment.mjs'),built.outputFiles[0]!.text);const api=await import(pathToFileURL(join(directory,'enrollment.mjs')).href);
  await api.openLibrary();const context=(await api.languageRoutesSnapshot()).context;
  const memory=new MemoryJourneyRepository();await createJourneyModules({repository:memory}).semanticIntake.submit(semanticLookupPayload());
  const state=await memory.load();state.meanings=[];state.commandReceipts=[];
  const repository=new api.LibraryJourneyRepository();await repository.commit({before:await repository.load(),after:state});
  const reference={origin:{kind:'semantic_registry'},senseId:state.registry.senses[0]!.senseId,senseVersionId:state.registry.senseVersions[0]!.senseVersionId,bindingId:state.registry.bindings[0]!.senseExpressionBindingId,bindingVersionId:state.registry.bindingVersions[0]!.bindingVersionId};
  const selection=await api.learningSystem.read({kind:'direct_source',reference});
  const input={kind:'enroll_direct',operationId:crypto.randomUUID(),reference,expectedDigest:selection.sourceDigest,languageContext:context};
  const snapshot=()=>api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  const before=await snapshot();
  const adapter=await api.sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter);
  adapter.entries=async(table:string)=>{if(['semanticMeanings','semanticRegistry','learningTargets','curriculumEnrollments'].includes(table))throw new Error('direct intent enumerated the World');return entries(table);};
  adapter.entriesPage=async(table:string,after:string|null,limit:number)=>{if(['semanticMeanings','semanticRegistry','learningTargets','curriculumEnrollments'].includes(table))throw new Error('direct intent paged the World');return page(table,after,limit);};
  const [accepted,repeated]=await Promise.all([api.learningSystem.execute(input),api.learningSystem.execute(input)]);
  expect(repeated).toEqual(accepted);expect(accepted).toMatchObject({status:'awaiting_content',selection,languageContext:context});
  expect(await api.learningSystem.execute({...input,operationId:crypto.randomUUID()})).toEqual(accepted);
  await expect(api.learningSystem.execute({...input,expectedDigest:'f'.repeat(64)})).rejects.toThrow();
  expect(await api.learningSystem.read({kind:'direct_enrollment',enrollmentId:accepted.enrollmentId})).toEqual(accepted);
  adapter.entries=entries;adapter.entriesPage=page;
  const after=await snapshot();expect(after.curriculumEnrollments).toHaveLength(1);
  for(const table of ['semanticMeanings','semanticInbox','semanticReceipts','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts'])expect(after[table]).toEqual(before[table]);
  expect(after.semanticMeanings).toEqual([]);api.validateBackupRows(after);
  const enrollment=after.curriculumEnrollments[0];
  const dependencies=learningReplica.conflictDependencies({table:'curriculumEnrollments',key:enrollment.key} as any,enrollment.value);
  expect(dependencies).toEqual(expect.arrayContaining([{table:'semanticRegistry',key:`senseVersions:${reference.senseVersionId}`},{table:'semanticRegistry',key:`bindingVersions:${reference.bindingVersionId}`} ]));
  const tampered=structuredClone(after);tampered.curriculumEnrollments[0].value.source.selection.semanticSpec.coreMeaningFocus='tampered snapshot';
  expect(()=>api.validateBackupRows(tampered)).toThrow();
  const badRoute={...input,operationId:crypto.randomUUID(),languageContext:{...context,languageRouteRevision:context.languageRouteRevision+1}};
  await expect(api.learningSystem.execute(badRoute)).rejects.toThrow('languageRouteChanged');
  expect(await api.readLibrary((tx:any)=>tx.get('operations',badRoute.operationId))).toBeUndefined();

  // New fixed connection for a failed write. The fixture importer is not the
  // enrollment command and may seed source facts without claiming user intent.
  const otherMemory=new MemoryJourneyRepository();await createJourneyModules({repository:otherMemory}).semanticIntake.submit(semanticLookupPayload({...state.registry.senseVersions[0]!.semanticSpec,coreMeaningFocus:'另一固定意义'}));
  const other=await otherMemory.load(),existing=await repository.load();
  for(const kind of Object.keys(existing.registry) as Array<keyof typeof existing.registry>)(existing.registry[kind] as unknown[]).push(...other.registry[kind]);
  // Keep the natural Sense key unique; version identity is independently pinned.
  existing.registry.senses.at(-1)!.senseKey='another-direct-source';
  await repository.commit({before:await repository.load(),after:existing});
  const nextReference={origin:{kind:'semantic_registry'},senseId:other.registry.senses[0]!.senseId,senseVersionId:other.registry.senseVersions[0]!.senseVersionId,bindingId:other.registry.bindings[0]!.senseExpressionBindingId,bindingVersionId:other.registry.bindingVersions[0]!.bindingVersionId};
  const next=await api.learningSystem.read({kind:'direct_source',reference:nextReference}),nextInput={...input,operationId:crypto.randomUUID(),reference:nextReference,expectedDigest:next.sourceDigest};
  const commit=adapter.commit.bind(adapter);adapter.commit=async(mutation:any)=>{if(mutation.puts.some((row:any)=>row.table==='curriculumEnrollments')){adapter.commit=commit;throw new Error('fixture enrollment write failed');}return commit(mutation);};
  await expect(api.learningSystem.execute(nextInput)).rejects.toThrow();expect(await api.readLibrary((tx:any)=>tx.get('operations',nextInput.operationId))).toBeUndefined();
  expect((await snapshot()).curriculumEnrollments).toHaveLength(1);
  expect((await api.learningSystem.execute(nextInput)).status).toBe('awaiting_content');expect((await snapshot()).curriculumEnrollments).toHaveLength(2);
  const stale={...nextInput,operationId:crypto.randomUUID()};
  await api.restoreLibraryTransaction(async(tx:any)=>{const key=`senseVersions:${nextReference.senseVersionId}`,row=await tx.get('semanticRegistry',key);row.value.semanticSpec.coreMeaningFocus='changed after preview';tx.put('semanticRegistry',key,row);});
  await expect(api.learningSystem.execute(stale)).rejects.toMatchObject({reason:'changed'});expect(await api.readLibrary((tx:any)=>tx.get('operations',stale.operationId))).toBeUndefined();
  expect((await snapshot()).curriculumEnrollments).toHaveLength(2);
  const changed=await api.learningSystem.read({kind:'direct_source',reference:nextReference});
  await expect(api.learningSystem.execute({...stale,operationId:crypto.randomUUID(),expectedDigest:changed.sourceDigest})).rejects.toThrow('meaningChanged');
  // Restore the faulted immutable source before checking unrelated learning.
  await api.restoreLibraryTransaction(async(tx:any)=>{const key=`senseVersions:${nextReference.senseVersionId}`,row=await tx.get('semanticRegistry',key);row.value.semanticSpec.coreMeaningFocus='另一固定意义';tx.put('semanticRegistry',key,row);});
  const publication=directPublishedFixture();
  await api.restoreLibraryTransaction(async(tx:any)=>{tx.put('packageInstallations',publication.pack.key,publication.installation);tx.put('packageCache',publication.pack.key,publication.pack);});
  const publishedSource=await api.learningSystem.read({kind:'direct_source',reference:publication.reference});
  const publishedIntent=await api.learningSystem.execute({...input,operationId:crypto.randomUUID(),reference:publication.reference,expectedDigest:publishedSource.sourceDigest});
  expect(publishedIntent.status).toBe('awaiting_content');expect((await snapshot()).learningTargets).toEqual([]);
  const preparation={kind:'prepare_direct',operationId:crypto.randomUUID(),enrollmentId:publishedIntent.enrollmentId};
  const prepared=await api.learningSystem.execute(preparation);expect(prepared).toEqual({targetId:publishedIntent.targetId,status:'ready'});
  expect(await api.learningSystem.execute(preparation)).toEqual(prepared);
  expect((await api.learningSystem.execute({...preparation,operationId:crypto.randomUUID()})).status).toBe('already_in_scope');
  expect((await api.learningSystem.execute({...input,operationId:crypto.randomUUID(),reference:publication.reference,expectedDigest:publishedSource.sourceDigest}))).toMatchObject({enrollmentId:null,status:'already_in_scope',targetId:prepared.targetId});
  const ready=await snapshot();expect(ready.learningTargets).toHaveLength(1);expect(ready.semanticMeanings).toEqual([]);expect(ready.personalLearning).toEqual([]);expect(ready.learningRuns).toEqual([]);
  const readyTarget=ready.learningTargets[0].value;expect(readyTarget.curriculumMemberships[0].sourceKind).toBe('stable_sense');expect(readyTarget).toMatchObject({memory:null,memoryRevision:0,startedAt:null,completedAt:null});
  api.validateBackupRows(ready);
  const wrongMaterial=structuredClone(ready);wrongMaterial.learningTargets[0].value.curriculumMemberships[0].material.snapshot.provenance.packageDigest='e'.repeat(64);
  expect(()=>api.validateBackupRows(wrongMaterial)).toThrow();
  await api.learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext:context,dailyLimit:20});
  await api.learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:publication.pack.key,languageContext:context});
  const overlapped=await snapshot();expect(overlapped.learningTargets).toEqual(ready.learningTargets);
  const workspace=await api.learningSystem.read({kind:'workspace',languageContext:context});
  expect(workspace.targets.find((target:any)=>target.targetId===prepared.targetId).presentation.sourceKind).toBe('direct');
  expect(workspace.queue.initialReadyTargetIds).toContain(prepared.targetId);
  await api.learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId:prepared.targetId,languageContext:context,dailyLimit:20});
  const started=await snapshot();expect(started.learningRuns).toHaveLength(1);expect(started.semanticMeanings).toEqual([]);expect(started.learningTargets[0].value.memory).toBeNull();api.validateBackupRows(started);
  const collision=directPublishedFixture(publication.reference);
  await api.restoreLibraryTransaction(async(tx:any)=>{tx.put('packageInstallations',collision.pack.key,collision.installation);tx.put('packageCache',collision.pack.key,collision.pack);});
  const collisionSource=await api.learningSystem.read({kind:'direct_source',reference:collision.reference});
  const collisionInput={...input,operationId:crypto.randomUUID(),reference:collision.reference,expectedDigest:collisionSource.sourceDigest};
  await expect(api.learningSystem.execute(collisionInput)).rejects.toThrow('invalidTarget');
  expect(await api.readLibrary((tx:any)=>tx.get('operations',collisionInput.operationId))).toBeUndefined();
  expect((await snapshot()).learningTargets).toEqual(started.learningTargets);
 }finally{await rm(directory,{recursive:true,force:true});}
});
