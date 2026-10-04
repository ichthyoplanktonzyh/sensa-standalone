/** Actual gateway/Library repository; controlled storage adapter, no paid calls. */
import {test,expect} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload,syntheticSemanticWorld,advanceSemanticHeads} from '../support/semanticLookupFixtures';

test('cold Context and draft commands are bounded, replay-safe, isolated and atomic under foreign writes',async()=>{
 const compiled=await build({stdin:{contents:[
  `export * from './apps/web/src/data/library/store';`,
  `export * from './apps/web/src/data/library/sqliteAdapter';`,
  `export * from './apps/web/src/experience/personalMeaningJourney/gateway';`,
  `export * from './apps/web/src/experience/personalMeaningJourney/repository';`,
  `export * from './apps/web/src/experience/personalMeaningJourney/worldRepository';`,
  `export * from './apps/web/src/experience/personalMeaningJourney/mediaStore';`,
 ].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},plugins:[{name:'fixture-auth',setup(build){build.onLoad({filter:/[/\\]account[/\\]auth\.ts$/},()=>({contents:"export const auth={getSession:async()=>({data:{session:null}})}; export {authStorageKey,cachedAuthSubject} from './authSessionHint';",loader:'ts'}));}}]});
 Object.assign(globalThis,{window:new EventTarget(),location:{origin:'http://scoped-command.fixture'},BroadcastChannel:undefined});
 const temp=await mkdtemp(join(tmpdir(),'sensa-context-command-'));
 try{
  await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
  await api.openLibrary();
  const memory=new MemoryJourneyRepository(),fixture=createJourneyModules({repository:memory,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await fixture.semanticIntake.submit(semanticLookupPayload());const state=syntheticSemanticWorld(await memory.load(),1000);
  const library=new api.LibraryJourneyRepository();await library.commit({before:await library.load(),after:state});
  const cached=await library.load();
  const foreignDraft=await api.createJourneyModules({repository:library,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'Inbox-only write must not be forgotten by a semantic refresh'}]});
  const semanticOnly=await library.refresh(cached,'semantic');expect(semanticOnly).toBe(cached);
  expect(semanticOnly.inboxItems.some((item:any)=>item.intakeId===foreignDraft.intakeId)).toBe(false);
  expect((await library.refresh(semanticOnly,'frame')).inboxItems.some((item:any)=>item.intakeId===foreignDraft.intakeId)).toBe(true);
  const id=state.meanings[0]!.personalMeaning.personalMeaningId,otherId=state.meanings[1]!.personalMeaning.personalMeaningId;
  const adapter=await api.sqliteRecordAdapter(),entries=adapter.entries.bind(adapter),entriesPage=adapter.entriesPage.bind(adapter),get=adapter.get.bind(adapter);
  const reads:Array<{table:string;key:string}>=[];
  adapter.entries=async(table:string)=>{if(table.startsWith('semantic'))throw new Error('scoped command enumerated source facts');return entries(table);};
  adapter.entriesPage=async(table:string,after:string|null,limit:number)=>{if(table.startsWith('semantic'))throw new Error('scoped command paged through the whole source');return entriesPage(table,after,limit);};
  adapter.get=async(table:string,key:string)=>{reads.push({table,key});return get(table,key);};
  const gateway=(repository:unknown=library,ids?:{next:()=>string})=>api.createJourneyModules({repository,ids,clock:createSeededClock('2026-10-04T00:00:00Z'),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  const input={operationId:crypto.randomUUID(),personalMeaningId:id,expectedRevision:1,blocks:[{kind:'text',bodyText:'saved without reading the other 999 Meanings'}]};
  const result=await gateway().reviseContext(input);
  expect(result).toMatchObject({revision:2,replayed:false});expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>row.key===id)).toBe(true);expect(reads.filter(row=>row.table==='semanticMeanings').length).toBeLessThan(4);expect(reads.filter(row=>row.table==='semanticRegistry').length).toBeLessThan(30);
  reads.length=0;expect(await gateway().reviseContext(input)).toEqual({...result,replayed:true});expect(reads.some(row=>['semanticMeanings','semanticRegistry'].includes(row.table))).toBe(false);
  await expect(gateway().reviseContext({...input,blocks:[{kind:'text',bodyText:'changed retry'}]})).rejects.toThrow('operationId');

  // Starting the next conversation is an Inbox append, not a read of the
  // learner's existing confirmed World. Keep the same strict no-enumeration
  // adapter active across creation and its exact retry.
  reads.length=0;
  const draftInput={operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'new capture among 1000 existing Meanings'}],startingPoint:'from_experience'};
  const created=await gateway().createClarificationDraft(draftInput);
  expect(created).toMatchObject({status:'pending_expression',replayed:false});
  expect(reads.some(row=>['semanticMeanings','semanticRegistry'].includes(row.table))).toBe(false);
  expect((await api.worldReadRepository.detail(created.intakeId)).draft.materialBlocks[0].bodyText).toBe(draftInput.blocks[0]!.bodyText);
  reads.length=0;
  expect(await gateway().createClarificationDraft(draftInput)).toEqual({...created,replayed:true});
  expect(reads.some(row=>['semanticMeanings','semanticRegistry','semanticInbox','semanticDrafts'].includes(row.table))).toBe(false);
  await expect(gateway().createClarificationDraft({...draftInput,blocks:[{kind:'text',bodyText:'changed draft retry'}]})).rejects.toThrow('operationId');
  await expect(library.withDraftCreation({operationId:crypto.randomUUID()},{next:()=>crypto.randomUUID()},async(scoped:any)=>{const before=await scoped.load();await scoped.commit({before,after:{...before,commandReceipts:[...before.commandReceipts,{operationId:crypto.randomUUID(),command:'outside-scope',result:{}}]}});})).rejects.toThrow('journey_command_scope_exceeded');

  const draftMediaId=crypto.randomUUID(),draftPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
  const draftMedia=api.stageMedia({mediaId:draftMediaId,mediaKind:'image',mimeType:'image/png',dataUrl:'data:image/png;base64,'+draftPng,sizeBytes:Buffer.from(draftPng,'base64').byteLength,createdAt:'2026-10-04T00:00:00Z'});
  const draftMediaInput={operationId:crypto.randomUUID(),blocks:[{kind:'image',personalMediaObjectId:draftMediaId}]};
  const draftCommit=adapter.commit.bind(adapter);
  adapter.commit=async(mutation:any)=>{if(mutation.puts.some((row:any)=>row.table==='semanticInbox'))throw new Error('fixture-atomic-draft-write-failure');return draftCommit(mutation);};
  await expect(gateway().createClarificationDraft(draftMediaInput)).rejects.toThrow('storageWrite');adapter.commit=draftCommit;
  expect(await api.readLibrary((tx:any)=>tx.get('media',draftMediaId))).toBeUndefined();expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',draftMediaInput.operationId))).toBeUndefined();expect(api.preparedMediaSnapshot()).toEqual([draftMedia]);
  const draftIds=[draftMediaInput.operationId,draftMediaId,state.meanings[0]!.personalMeaning.personalMeaningId,crypto.randomUUID()];
  const imageDraft=await gateway(library,{next:()=>draftIds.shift()!}).createClarificationDraft(draftMediaInput);
  expect(imageDraft.intakeId).not.toBe(draftMediaId);expect(imageDraft.intakeId).not.toBe(draftMediaInput.operationId);
  expect(await api.readLibrary((tx:any)=>tx.get('media',draftMediaId))).toEqual(draftMedia);expect(api.preparedMediaSnapshot()).toEqual([]);
  expect((await api.worldReadRepository.detail(imageDraft.intakeId)).draft.materialBlocks[0].personalMediaObjectId).toBe(draftMediaId);

  const confirmation=async(intakeId:string,operationId=crypto.randomUUID(),newKey?:string)=>({operationId,intakeId,source:await api.worldReadRepository.captureSource('intake',intakeId),context:semanticLookupPayload().context,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
   sense:{...state.registry.senseVersions[0]!.semanticSpec,proposedSenseKey:newKey??state.registry.senses[0]!.senseKey,...(newKey?{}:{reuseSense:{senseId:state.registry.senses[0]!.senseId,senseVersionId:state.registry.senseVersions[0]!.senseVersionId}}),unresolvedQuestions:[]},expression:{surfaceForm:newKey?'new-learner-expression':'borrow-0',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
  const confirmInput=await confirmation(created.intakeId);reads.length=0;
  const confirmed=await gateway().completeClarificationDraft(confirmInput);
  expect(confirmed).toMatchObject({resolution:'reuse_existing',senseVersionId:state.registry.senseVersions[0]!.senseVersionId,replayed:false});
  expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>row.key===confirmed.personalMeaningId)).toBe(true);expect(reads.filter(row=>row.table==='semanticMeanings').length).toBeLessThan(3);expect(reads.filter(row=>row.table==='semanticRegistry').length).toBeLessThan(40);
  const accepted=await api.worldReadRepository.detail(confirmed.personalMeaningId);expect(accepted.detail.revision).toBe(2);expect(accepted.detail.directAlignments[0].confirmedBindings[0].surfaceForm).toBe('borrow-0');expect((await api.worldReadRepository.detail(created.intakeId)).draft).toBeNull();
  reads.length=0;expect(await gateway().completeClarificationDraft(confirmInput)).toEqual({...confirmed,replayed:true});expect(reads.some(row=>['semanticMeanings','semanticRegistry','semanticInbox','semanticDrafts'].includes(row.table))).toBe(false);
  const newDraft=await gateway().createClarificationDraft({...draftInput,operationId:crypto.randomUUID()}),newInput=await confirmation(newDraft.intakeId,crypto.randomUUID(),'new-bounded-sense');reads.length=0;
  const newConfirmed=await gateway().completeClarificationDraft(newInput);expect(newConfirmed.resolution).toBe('create_new');expect(reads.filter(row=>row.table==='semanticMeanings').every(row=>row.key===newConfirmed.personalMeaningId)).toBe(true);expect((await api.worldReadRepository.detail(newConfirmed.personalMeaningId)).detail.directAlignments[0].confirmedBindings[0].surfaceForm).toBe('new-learner-expression');
  const collisionDraft=await gateway().createClarificationDraft({...draftInput,operationId:crypto.randomUUID()}),collisionInput=await confirmation(collisionDraft.intakeId,crypto.randomUUID(),'new-bounded-sense');
  await expect(gateway().completeClarificationDraft(collisionInput)).rejects.toThrow('语义 key 已存在');expect((await api.worldReadRepository.detail(collisionDraft.intakeId)).draft).not.toBeNull();expect(await library.readReceipt(collisionInput.operationId)).toBeNull();

  const hold=()=>{
   let entered=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
   const intercept=(scoped:any)=>({...scoped,commit:async(change:unknown)=>{entered=true;await held;return scoped.commit(change);}});
   const repository={lookupMeanings:(query:string)=>library.lookupMeanings(query),readReceipt:(id:string)=>library.readReceipt(id),load:()=>library.load(),refresh:(state:unknown,scope:unknown)=>library.refresh(state,scope),commit:(change:unknown)=>library.commit(change),withMeaningCommand:(scope:unknown,ids:unknown,execute:any)=>library.withMeaningCommand(scope,ids,(scoped:any,assigned:unknown)=>execute(intercept(scoped),assigned)),withClarificationCommand:(scope:unknown,ids:unknown,execute:any)=>library.withClarificationCommand(scope,ids,(scoped:any,assigned:unknown)=>execute(intercept(scoped),assigned))};
   return {gateway:gateway(repository),entered:()=>entered,release};
  };
  const wait=async(predicate:()=>boolean)=>{for(let attempt=0;attempt<2000&&!predicate();attempt++)await new Promise(resolve=>setTimeout(resolve,0));expect(predicate()).toBe(true);};
  const appendDraft=()=>gateway().createClarificationDraft({...draftInput,operationId:crypto.randomUUID()});
  const raceDraft=await appendDraft(),raceInput=await confirmation(raceDraft.intakeId,crypto.randomUUID(),'a-foreign-concurrent-key');
  const race=hold(),raceWriting=race.gateway.completeClarificationDraft(raceInput),raceRejected=expect(raceWriting).rejects.toThrow('meaningChanged');await wait(race.entered);
  const winningDraft=await appendDraft(),winning=await gateway().completeClarificationDraft(await confirmation(winningDraft.intakeId,crypto.randomUUID(),'a-foreign-concurrent-key'));
  race.release();await raceRejected;expect((await api.worldReadRepository.detail(raceDraft.intakeId)).draft).not.toBeNull();expect(await library.readReceipt(raceInput.operationId)).toBeNull();expect((await api.worldReadRepository.detail(winning.personalMeaningId)).detail).not.toBeNull();
  const expressionDraft=await appendDraft(),expressionInput=await confirmation(expressionDraft.intakeId,crypto.randomUUID(),'concurrent-expression-own');expressionInput.expression.surfaceForm='concurrent-form';
  const expressionRace=hold(),expressionWriting=expressionRace.gateway.completeClarificationDraft(expressionInput),expressionRejected=expect(expressionWriting).rejects.toThrow('meaningChanged');await wait(expressionRace.entered);
  const expressionForeignDraft=await appendDraft(),expressionForeign=await confirmation(expressionForeignDraft.intakeId,crypto.randomUUID(),'concurrent-expression-foreign');expressionForeign.expression.surfaceForm='concurrent-form';await gateway().completeClarificationDraft(expressionForeign);
  expressionRace.release();await expressionRejected;expect((await api.worldReadRepository.detail(expressionDraft.intakeId)).draft).not.toBeNull();expect(await library.readReceipt(expressionInput.operationId)).toBeNull();
  expect((await gateway().completeClarificationDraft(expressionInput)).resolution).toBe('create_new');
  const distant=state.registry.senses.length-1,distantDraft=await appendDraft(),distantInput=await confirmation(distantDraft.intakeId);distantInput.sense={...state.registry.senseVersions[distant]!.semanticSpec,proposedSenseKey:state.registry.senses[distant]!.senseKey,reuseSense:{senseId:state.registry.senses[distant]!.senseId,senseVersionId:state.registry.senseVersions[distant]!.senseVersionId},unresolvedQuestions:[]};distantInput.expression.surfaceForm=`borrow-${distant}`;distantInput.expression.semanticCoverage='narrower';
  const bindingKey=`bindings:${state.registry.bindings[distant]!.senseExpressionBindingId}`,bindingBefore=await api.readLibrary((tx:any)=>tx.get('semanticRegistry',bindingKey));
  await gateway().completeClarificationDraft(distantInput);
  const bindingAfter=await api.readLibrary((tx:any)=>tx.get('semanticRegistry',bindingKey));expect(bindingAfter.ordinal).toBe(bindingBefore.ordinal);expect(bindingAfter.value.currentVersionNumber).toBe(2);
  for(const expressionType of ['sentence','utterance_strategy']){
   const typedDraft=await appendDraft(),typedInput=await confirmation(typedDraft.intakeId,crypto.randomUUID(),`valid-${expressionType}`);typedInput.expression.expressionType=expressionType;
   const saved=await gateway().completeClarificationDraft(typedInput);expect((await api.worldReadRepository.detail(saved.personalMeaningId)).detail.directAlignments[0].confirmedBindings[0].expressionType).toBe(expressionType);
  }
  const first=hold(),pending=first.gateway.reviseContext({...input,operationId:crypto.randomUUID(),expectedRevision:2,blocks:[{kind:'text',bodyText:'own isolated save'}]});await wait(first.entered);
  await gateway().reviseContext({operationId:crypto.randomUUID(),personalMeaningId:otherId,expectedRevision:1,blocks:[{kind:'text',bodyText:'unrelated foreign save'}]});first.release();await pending;
  expect((await api.worldReadRepository.detail(id)).detail.materialBlocks[0].bodyText).toBe('own isolated save');expect((await api.worldReadRepository.detail(otherId)).detail.materialBlocks[0].bodyText).toBe('unrelated foreign save');
  const conflict=hold(),conflictId=crypto.randomUUID(),stale=conflict.gateway.reviseContext({...input,operationId:conflictId,expectedRevision:3,blocks:[{kind:'text',bodyText:'must not overwrite foreign row'}]});const rejected=expect(stale).rejects.toThrow('meaningChanged');await wait(conflict.entered);
  await gateway().reviseContext({...input,operationId:crypto.randomUUID(),expectedRevision:3,blocks:[{kind:'text',bodyText:'foreign wins exactly one revision'}]});conflict.release();await rejected;
  expect((await api.worldReadRepository.detail(id)).detail.revision).toBe(4);expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',conflictId))).toBeUndefined();

  const occupied=state.meanings[2]!.personalSemanticAnchors[0]!.personalSemanticAnchorId,allocated=[occupied,crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  await gateway(library,{next:()=>allocated.shift()!}).reviseContext({...input,operationId:crypto.randomUUID(),expectedRevision:4,blocks:[{kind:'text',bodyText:'global occupied identity is skipped'}]});
  expect((await api.worldReadRepository.detail(id)).detail.materialBlocks[0].anchorId).not.toBe(occupied);
  const collisionId=crypto.randomUUID();
  const allocatedIDs=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  // The allocator checks once, then the transaction guards the same IDs again.
  const racingRepository={lookupMeanings:(query:string)=>library.lookupMeanings(query),readReceipt:(id:string)=>library.readReceipt(id),load:()=>library.load(),commit:(change:unknown)=>library.commit(change),withMeaningCommand:(scope:unknown,_ids:unknown,execute:any)=>library.withMeaningCommand(scope,{next:(()=>{let index=0;return()=>allocatedIDs[index++]!;})()},(scoped:any,assigned:unknown)=>execute({...scoped,commit:async(change:unknown)=>{
   const foreignIDs=[allocatedIDs[0]!,crypto.randomUUID(),crypto.randomUUID()];
   await gateway(library,{next:()=>foreignIDs.shift()!}).reviseContext({operationId:crypto.randomUUID(),personalMeaningId:otherId,expectedRevision:2,blocks:[{kind:'text',bodyText:'foreign source occupies an ID after the first reservation check'}]});
   return scoped.commit(change);
  }},assigned))};
  await expect(gateway(racingRepository).reviseContext({...input,operationId:collisionId,expectedRevision:5,blocks:[{kind:'text',bodyText:'collision must reject before source writes'}]})).rejects.toThrow('meaningChanged');
  expect((await api.worldReadRepository.detail(id)).detail.revision).toBe(5);expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',collisionId))).toBeUndefined();
  const mediaId=crypto.randomUUID(),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';
  const media=api.stageMedia({mediaId,mediaKind:'image',mimeType:'image/png',dataUrl:'data:image/png;base64,'+png,sizeBytes:Buffer.from(png,'base64').byteLength,createdAt:'2026-10-04T00:00:00Z'});
  const mediaInput={...input,operationId:crypto.randomUUID(),expectedRevision:5,blocks:[{kind:'image',personalMediaObjectId:mediaId}]};
  const commit=adapter.commit.bind(adapter);adapter.commit=async(mutation:any)=>{if(mutation.puts.some((row:any)=>row.table==='semanticMeanings'))throw new Error('fixture-atomic-source-write-failure');return commit(mutation);};
  await expect(gateway().reviseContext(mediaInput)).rejects.toThrow('storageWrite');adapter.commit=commit;
  expect(await api.readLibrary((tx:any)=>tx.get('media',mediaId))).toBeUndefined();expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',mediaInput.operationId))).toBeUndefined();expect(api.preparedMediaSnapshot()).toEqual([media]);
  const externalIDs=[mediaInput.operationId,mediaId,crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  await gateway(library,{next:()=>externalIDs.shift()!}).reviseContext(mediaInput);expect(await api.readLibrary((tx:any)=>tx.get('media',mediaId))).toEqual(media);expect(api.preparedMediaSnapshot()).toEqual([]);
  expect((await api.worldReadRepository.detail(id)).detail.materialBlocks[0].personalMediaObjectId).toBe(mediaId);
  expect((await api.worldReadRepository.detail(id)).detail.materialBlocks[0].anchorId).not.toBe(mediaId);expect((await api.worldReadRepository.detail(id)).detail.materialBlocks[0].anchorId).not.toBe(mediaInput.operationId);
  const missing=hold(),missingOp=crypto.randomUUID(),versionKey=`senseVersions:${state.registry.senseVersions[0]!.senseVersionId}`;
  const version=await api.readLibrary((tx:any)=>tx.get('semanticRegistry',versionKey));
  const waiting=missing.gateway.reviseContext({...input,operationId:missingOp,expectedRevision:6,blocks:[{kind:'text',bodyText:'cannot save against a missing fixed semantic dependency'}]});const missingRejected=expect(waiting).rejects.toThrow('meaningChanged');await wait(missing.entered);
  await api.restoreLibraryTransaction(async(tx:any)=>tx.delete('semanticRegistry',versionKey));missing.release();await missingRejected;
  await api.restoreLibraryTransaction(async(tx:any)=>tx.put('semanticRegistry',versionKey,version));
  expect((await api.worldReadRepository.detail(id)).detail.revision).toBe(6);expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',missingOp))).toBeUndefined();
  const root=await api.readLibrary((tx:any)=>tx.get('semanticState','root')),missingRoot=hold(),rootOp=crypto.randomUUID();
  const rootWrite=missingRoot.gateway.reviseContext({...input,operationId:rootOp,expectedRevision:6,blocks:[{kind:'text',bodyText:'must not manufacture a missing version root'}]});const rootRejected=expect(rootWrite).rejects.toThrow('缺少版本');await wait(missingRoot.entered);
  await api.restoreLibraryTransaction(async(tx:any)=>tx.delete('semanticState','root'));missingRoot.release();await rootRejected;
  expect(await api.readLibrary((tx:any)=>tx.get('semanticState','root'))).toBeUndefined();expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',rootOp))).toBeUndefined();
  await api.restoreLibraryTransaction(async(tx:any)=>tx.put('semanticState','root',root));expect((await api.worldReadRepository.detail(id)).detail.revision).toBe(6);
  await expect(library.withMeaningCommand({personalMeaningId:id,operationId:crypto.randomUUID(),identityCount:1},{next:()=>crypto.randomUUID()},async(scoped:any)=>{const before=await scoped.load();await scoped.commit({before,after:advanceSemanticHeads(before)});})).rejects.toThrow('journey_command_scope_exceeded');
  // A reload is allowed to enumerate the global view, but must not deadlock
  // the save whose gate it is queued behind, or publish its older scene.
  adapter.entries=entries;adapter.entriesPage=entriesPage;
  const reload=hold(),saving=reload.gateway.reviseContext({...input,operationId:crypto.randomUUID(),expectedRevision:6,blocks:[{kind:'text',bodyText:'reload must follow the committed scene'}]});await wait(reload.entered);
  reload.gateway.reload();reload.release();
  const completed=await Promise.race([saving,new Promise((_,reject)=>setTimeout(()=>reject(new Error('scoped save/reload deadlock')),2000))]);expect(completed).toMatchObject({revision:7});
  await wait(()=>reload.gateway.getDetail(id)?.revision===7);expect(reload.gateway.getDetail(id).materialBlocks[0].bodyText).toBe('reload must follow the committed scene');
  const swapped=hold(),swappedOp=crypto.randomUUID(),old=swapped.gateway.reviseContext({...input,operationId:swappedOp,expectedRevision:7});const swappedRejected=expect(old).rejects.toThrow('libraryReplaced');await wait(swapped.entered);
  await api.restoreLibraryTransaction(async(tx:any)=>tx.put('meta','local-incarnation',crypto.randomUUID()));swapped.release();await swappedRejected;
  expect(await api.readLibrary((tx:any)=>tx.get('semanticReceipts',swappedOp))).toBeUndefined();
  adapter.entries=entries;adapter.entriesPage=entriesPage;adapter.get=get;
 }finally{await rm(temp,{recursive:true,force:true});}
},30_000);
