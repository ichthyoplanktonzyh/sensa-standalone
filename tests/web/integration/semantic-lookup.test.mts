import assert from 'node:assert/strict';
import {test,expect} from 'vitest';
import {sensaIntakePayloadSchema} from '@sensa/contracts/sensa';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway.ts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository.ts';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports.ts';
import {createMeaningLookup,createMeaningLookupCooperatively,MEANING_LOOKUP_MAX_BYTES} from '../../../apps/web/src/experience/personalMeaningJourney/meaningLookup.ts';
import {assertPersonalSemanticWorldState,assertPersonalSemanticWorldStateCooperatively} from '../../../apps/web/src/experience/personalMeaningJourney/authority.ts';
import {validatePersonalSemanticWorldReplica} from '../../../apps/web/src/data/library/replication/personalSemanticWorldValidation.ts';
import {libraryTables,type Table} from '../../../apps/web/src/data/library/store.ts';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation.ts';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store.ts';
import {intakeSourceLabel,intakeSourceUrl} from '../../../apps/web/src/experience/personalMeaningJourney/sourcePresentation.ts';
import {semanticLookupSpec as spec,semanticLookupPayload as payload,syntheticSemanticWorld,advanceSemanticHeads,deleteFirstMeaning} from '../support/semanticLookupFixtures.ts';
import {meaningLookupFactFields} from '../../../apps/web/src/experience/personalMeaningJourney/meaningLookupFacts.ts';
const setup=()=>{const repository=new MemoryJourneyRepository();return {repository,...createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}})};};

test('clarification must confirm its exact source, not current material substituted after a model turn',async()=>{
 const {repository,personalMeaningJourney:gateway}=setup();
 const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'Original learner material'}]});
 const source=await gateway.captureClarificationSource('intake',draft.intakeId);
 expect(source).toMatchObject({kind:'intake',id:draft.intakeId});expect(source.digest).toMatch(/^[0-9a-f]{64}$/u);
 const command={operationId:crypto.randomUUID(),intakeId:draft.intakeId,source,context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
  sense:{proposedSenseKey:'source-pinned-borrow',...spec,unresolvedQuestions:[]},expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},
  confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'};
 await gateway.addClarificationMaterial(crypto.randomUUID(),draft.intakeId,{kind:'text',bodyText:'New material added during review'});
 const before=await repository.load();
 await expect(gateway.completeClarificationDraft(command)).rejects.toThrow('clarificationSourceChanged');expect(await repository.load()).toEqual(before);
 const current=await gateway.captureClarificationSource('intake',draft.intakeId);
 await expect(gateway.completeClarificationDraft({...command,source:{...current,incarnation:'another-library'}})).rejects.toThrow('clarificationSourceChanged');
 await expect(gateway.completeClarificationDraft({...command,source:undefined!})).rejects.toThrow('clarificationSourceChanged');expect(await repository.load()).toEqual(before);
 const accepted=await gateway.completeClarificationDraft({...command,source:current});
 expect(await gateway.completeClarificationDraft({...command,source:current})).toEqual({...accepted,replayed:true});
 // Confirmation changes the source itself. An exact retry returns its receipt,
 // while a fresh operation cannot claim that the old source still exists.
 await expect(gateway.completeClarificationDraft({...command,operationId:crypto.randomUUID(),source:current})).rejects.toThrow('clarificationSourceChanged');
 expect((await repository.load()).meanings).toHaveLength(1);
});

test('a source witness is rechecked under the commit lock, including draft metadata not written by confirmation',async()=>{
 const repository=new MemoryJourneyRepository();let foreign:(()=>Promise<void>)|undefined;
 const adapter={load:()=>repository.load(),captureSource:repository.captureSource.bind(repository),readReceipt:repository.readReceipt.bind(repository),
  commit:async(change:Parameters<MemoryJourneyRepository['commit']>[0])=>{const action=foreign;foreign=undefined;await action?.();return repository.commit(change);}};
 const gateway=createJourneyModules({repository:adapter,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
 const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'Material before held commit'}]});
 const source=await gateway.captureClarificationSource('intake',draft.intakeId);
 foreign=async()=>{const before=await repository.load(),after={...before,clarificationDrafts:before.clarificationDrafts.map(row=>row.intakeId===draft.intakeId?{...row,startingPoint:'from_expression' as const}:row)};await repository.commit({before,after});};
 const operationId=crypto.randomUUID();
 await expect(gateway.completeClarificationDraft({operationId,intakeId:draft.intakeId,source,context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
  sense:{proposedSenseKey:'commit-source-borrow',...spec,unresolvedQuestions:[]},expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'})).rejects.toThrow('meaningChanged');
 const stored=await repository.load();expect(stored.meanings).toHaveLength(0);expect(stored.inboxItems.map(row=>row.intakeId)).toEqual([draft.intakeId]);expect(stored.commandReceipts.some(row=>row.operationId===operationId)).toBe(false);expect(stored.clarificationDrafts[0]?.startingPoint).toBe('from_expression');
});

test('a fresh rechecked source succeeds even when the original command gateway has an older unobserved Inbox frame',async()=>{
 const {repository,personalMeaningJourney:gateway}=setup();
 const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'Original source in the command gateway'}]});
 const other=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
 await other.addClarificationMaterial(crypto.randomUUID(),draft.intakeId,{kind:'text',bodyText:'Foreign appended material without a gateway subscription'});
 expect(gateway.getClarificationDraft(draft.intakeId)?.materialBlocks[0]?.bodyText).not.toContain('Foreign appended');
 const source=await gateway.captureClarificationSource('intake',draft.intakeId);
 const accepted=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source,context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
  sense:{proposedSenseKey:'foreign-rechecked-source',...spec,unresolvedQuestions:[]},expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
 expect(accepted.personalMeaningId).toBeTruthy();expect((await repository.load()).inboxItems).toHaveLength(0);
});

test('an existing Meaning clarification rejects a proposal made against an older Context',async()=>{
 const {repository,personalMeaningJourney:gateway,semanticIntake}=setup();const accepted=await semanticIntake.submit(payload());
 if(accepted.route!=='fast_track')throw new Error('Expected accepted fixture');
 const id=gateway.getWorldItems()[0]!.personalMeaningId;
 const source=await gateway.captureClarificationSource('personal_meaning',id),match=(await gateway.lookupMeanings('borrow')).meanings[0]!;
 const command={operationId:crypto.randomUUID(),personalMeaningId:id,source,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:{statement:'临时借用者的视角',distinguishingNotes:[],aspectLabel:'借用者'},
  sense:{proposedSenseKey:match.senseKey,reuseSense:{senseId:match.senseId,senseVersionId:match.senseVersionId},...spec,unresolvedQuestions:[]},expression:null,confirmExpression:false,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'};
 await gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:id,expectedRevision:gateway.getDetail(id)!.revision,blocks:[{kind:'text',bodyText:'Another Context saved before confirmation'}]});
 const before=await repository.load();await expect(gateway.confirmClarification(command)).rejects.toThrow('clarificationSourceChanged');expect(await repository.load()).toEqual(before);
 const current=await gateway.captureClarificationSource('personal_meaning',id),fresh={...command,source:current};
 const confirmed=await gateway.confirmClarification(fresh);expect(confirmed.expressionConfirmed).toBe(false);expect(confirmed.senseVersionId).toBe(match.senseVersionId);
 expect(await gateway.confirmClarification(fresh)).toEqual({...confirmed,replayed:true});
 expect(gateway.getDetail(id)?.materialBlocks[0]?.bodyText).toBe('Another Context saved before confirmation');
});

test('durable candidate reads do not hydrate the World; a subscribed view loads and follows foreign frame changes',async()=>{
  const fixture=setup();await fixture.semanticIntake.submit(payload());const state=await fixture.repository.load();let loads=0;
  const repository={load:()=>{loads++;return fixture.repository.load();},
    lookupMeanings:async(query:string)=>createMeaningLookup(await fixture.repository.load()).query(query),
    refresh:(state:JourneyState,scope?:'semantic'|'frame')=>fixture.repository.refresh(state,scope),
    subscribe:(listener:()=>void)=>fixture.repository.subscribe(listener),commit:(change:Parameters<MemoryJourneyRepository['commit']>[0])=>fixture.repository.commit(change),
    readReceipt:(id:string)=>fixture.repository.readReceipt(id)};
  const gateway=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);assert.equal(loads,0);
  const stop=gateway.subscribe(()=>undefined);
  try{
    await expect.poll(()=>gateway.getWorldItems().length).toBe(1);assert.equal(loads,1);
    const pending=await fixture.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'external pending material'}]});
    await expect.poll(()=>gateway.getClarificationDraft(pending.intakeId)?.intakeId).toBe(pending.intakeId);
    const before=await fixture.repository.load();await fixture.repository.commit({before,after:deleteFirstMeaning(before)});
    await expect.poll(()=>gateway.getWorldItems().length).toBe(0);
  }finally{stop();}
  repository.lookupMeanings=async()=>{throw new Error('localFlow.libraryReplaced');};
  await assert.rejects(gateway.lookupMeanings('borrow'),/libraryReplaced/u);
  assert.equal(gateway.getStatus().ok,false);assert.deepEqual(gateway.getWorldItems(),[]);
  assert.equal(state.meanings.length,1);
});

test('object and void operation retries bind exact input and cannot reuse a cached receipt after library replacement',async()=>{
  const fixture=setup(),gateway=fixture.personalMeaningJourney,operationId=crypto.randomUUID(),input={operationId,blocks:[{kind:'text' as const,bodyText:'first material'}]};
  const draft=await gateway.createClarificationDraft(input);
  assert.deepEqual(await gateway.createClarificationDraft(input),{...draft,replayed:true});
  await assert.rejects(gateway.createClarificationDraft({...input,blocks:[{kind:'text',bodyText:'changed material'}]}),/operationId/u);
  const addId=crypto.randomUUID(),block={kind:'text' as const,bodyText:'additional material'};
  await gateway.addClarificationMaterial(addId,draft.intakeId,block);await gateway.addClarificationMaterial(addId,draft.intakeId,block);
  await assert.rejects(gateway.addClarificationMaterial(addId,draft.intakeId,{kind:'text',bodyText:'changed additional material'}),/operationId/u);
  const readReceipt=fixture.repository.readReceipt.bind(fixture.repository);
  fixture.repository.readReceipt=async()=>{throw new Error('localFlow.libraryReplaced');};
  await assert.rejects(gateway.createClarificationDraft(input),/libraryReplaced/u);
  await assert.rejects(gateway.addClarificationMaterial(addId,draft.intakeId,block),/libraryReplaced/u);
  assert.equal(gateway.getStatus().ok,false);assert.deepEqual(gateway.getWorldItems(),[]);
  fixture.repository.readReceipt=readReceipt;
  assert.equal((await fixture.repository.load()).inboxItems.length,1);
});

test('10k committed World/detail/learning projections use one identity index, not a registry scan per Meaning',async()=>{
  const fixture=setup();await fixture.semanticIntake.submit(payload());
  const state=syntheticSemanticWorld(await fixture.repository.load(),10_000);
  for(const rows of Object.values(state.registry))Object.defineProperty(rows,'find',{value:()=>{throw new Error('projection scanned the registry per Meaning');}});
  const gateway=createJourneyModules({repository:{load:async()=>state,commit:async()=>{throw new Error('read-only scale fixture');}},clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  await gateway.lookupMeanings('borrow-9999');
  const start=performance.now(),world=gateway.getWorldItems();
  assert.equal(world.length,10_000);assert.equal(gateway.getListItems().length,10_000);
  const id=state.meanings[9999]!.personalMeaning.personalMeaningId;
  assert.equal(gateway.getDetail(id)!.directAlignments[0]!.confirmedBindings[0]!.surfaceForm,'borrow-9999');
  assert.equal(gateway.getLearningSources(id)[0]!.expression.surfaceForm,'borrow-9999');
  console.log('Node synthetic committed 10k World/list/detail/source assembly; not browser paint:',performance.now()-start,'ms');
});

test('returned Focus notes and expression form parts cannot mutate the committed snapshot',async()=>{
  const fixture=setup(),draft=await fixture.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'借来雨伞之后归还。'}]});
  const accepted=await fixture.personalMeaningJourney.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await fixture.personalMeaningJourney.captureClarificationSource('intake',draft.intakeId),context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},
    focus:{statement:'暂借而非接受赠送',distinguishingNotes:['之后归还'],aspectLabel:'临时使用'},sense:{proposedSenseKey:'view-copy-borrow',...spec,unresolvedQuestions:[]},
    expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
  const state=await fixture.repository.load();
  state.registry.expressionVersions[0]!.structure.formParts=[{kind:'fixed',text:'borrow'}];
  assertPersonalSemanticWorldState(state);
  const gateway=createJourneyModules({repository:{load:async()=>state,commit:async()=>{throw new Error('read-only projection fixture');}},clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  await gateway.lookupMeanings('borrow');
  gateway.getDetail(accepted.personalMeaningId)!.focuses[0]!.distinguishingNotes.push('caller injected note');
  const parts=gateway.getLearningSources(accepted.personalMeaningId)[0]!.expression.formParts!;parts[0]!.text='caller injected form';parts.push({kind:'slot',text:'caller injected slot'});
  assert.deepEqual(gateway.getDetail(accepted.personalMeaningId)!.focuses[0]!.distinguishingNotes,['之后归还']);
  assert.deepEqual(gateway.getLearningSources(accepted.personalMeaningId)[0]!.expression.formParts,[{kind:'fixed',text:'borrow'}]);
});

test('reopen reserves persisted fact identities, not UUID-shaped learner prose',async()=>{
  const fixture=setup();await fixture.semanticIntake.submit(payload());
  const existing=(await fixture.personalMeaningJourney.lookupMeanings('borrow')).meanings[0]!;
  const originalDraft=await fixture.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'借用另一个同伴的物品。'}]});
  await fixture.personalMeaningJourney.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:originalDraft.intakeId,source:await fixture.personalMeaningJourney.captureClarificationSource('intake',originalDraft.intakeId),context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
    sense:{proposedSenseKey:existing.senseKey,reuseSense:{senseId:existing.senseId,senseVersionId:existing.senseVersionId},...spec,unresolvedQuestions:[]},
    expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
  const state=await fixture.repository.load(),opaque=crypto.randomUUID();
  state.meanings[0]!.personalMeaningRevisions[0]!.learnerIntentNote=opaque;
  const repository=new MemoryJourneyRepository();await repository.commit({before:await repository.load(),after:state});
  const candidates=[state.registry.senses[0]!.senseId,state.meanings[0]!.personalMeaning.personalMeaningId,
    state.meanings[0]!.personalSemanticAnchorRevisions[0]!.personalSemanticAnchorRevisionId,state.commandReceipts[0]!.operationId,
    state.meanings[1]!.proposalVersions[0]!.expressionCandidates[0]!.candidateId,opaque];
  const gateway=createJourneyModules({repository,clock:createSeededClock(),ids:{next:()=>candidates.shift()??crypto.randomUUID()},languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'新的私有场景。'}]});
  assert.equal(draft.intakeId,opaque,'persisted fact IDs are skipped, opaque learner text does not become an identity');
  assert.equal((await repository.load()).meanings[0]!.personalMeaningRevisions[0]!.learnerIntentNote,opaque);
});

test('clarifying an imported Context preserves the original occurrence revision rather than pointing into a rewrite',async()=>{
  const {repository,personalMeaningJourney:gateway,semanticIntake:intake}=setup();
  const original=sensaIntakePayloadSchema.parse({...payload(),context:{...payload().context!,textSegment:'May borrowed an umbrella.',languageObservation:{source:'detector',confidence:.9},source:{client:'codex',title:'Original conversation',url:null,sourceReferenceId:'fixture-conversation',domSelector:null,paragraphContext:null}},
    expression:{...payload().expression!,occurrence:{surfaceForm:'borrowed',locator:{kind:'text_span',start:4,end:12}}},sense:null});
  const queued=await intake.submit(original);assert.equal(queued.route,'inbox');
  if(queued.route!=='inbox')throw new Error('fixture must enter Inbox');
  const context={...original.context!,textSegment:'May 临时借用一把雨伞，之后准备归还。',languageTag:'zh-CN',languageObservation:{source:'model' as const,confidence:null}};
  const result=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:queued.intakeId,source:await gateway.captureClarificationSource('intake',queued.intakeId),context,contextWordingSource:'llm_suggested',languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
    sense:{proposedSenseKey:'borrow-from-original-source',...spec,unresolvedQuestions:[]},expression:{surfaceForm:'borrow',expressionType:'word',languageTag:'en',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
  const state=await repository.load(),record=state.meanings[0]!,expression=record.personalExpressionAnchorRevisions.find(row=>row.occurrence?.kind==='text_span')!;
  const captured=record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===expression.contextAnchorRevisionId)!;
  assert.equal(captured.bodyText,original.context!.textSegment);assert.equal(captured.languageTag,'en');
  const locator=expression.occurrence!;assert.equal(locator.kind,'text_span');
  if(locator.kind==='text_span')assert.equal(captured.bodyText!.slice(locator.start,locator.end),'borrowed');
  assert.equal(gateway.getDetail(result.personalMeaningId)!.materialBlocks[0]!.bodyText,context.textSegment);
  assert.deepEqual(gateway.getDetail(result.personalMeaningId)!.materialBlocks[0]!.capturedSource,{text:original.context!.textSegment,source:original.context!.source});
  assert.equal(intakeSourceLabel(original.context!.source!),'Codex · Original conversation');
  assert.equal(intakeSourceUrl({...original.context!.source!,url:'javascript:alert(1)'}),null);
  assert.equal(gateway.getLearningSources(result.personalMeaningId)[0]!.context.text,context.textSegment,'learning uses the accepted revision, not a concatenation with raw source instructions');
  assert.equal(record.personalSemanticAnchorRevisions.length,2);assertPersonalSemanticWorldState(state);
  assert.equal(record.personalSemanticAnchorRevisions[1]!.provenance.kind,'llm_suggested');
  await gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:result.personalMeaningId,expectedRevision:gateway.getDetail(result.personalMeaningId)!.revision,blocks:[{kind:'text',bodyText:'A newly edited current Context.'}]});
  const revised=gateway.getDetail(result.personalMeaningId)!;
  assert.equal(revised.materialBlocks[0]!.bodyText,'A newly edited current Context.');
  assert.deepEqual(revised.capturedSources,[{anchorId:record.personalSemanticAnchors[0]!.personalSemanticAnchorId,text:original.context!.textSegment,source:original.context!.source}]);
  captured.bodyText='a rewritten source';
  assert.throws(()=>assertPersonalSemanticWorldState(state),/occurrence/u);
  await assert.rejects(assertPersonalSemanticWorldStateCooperatively(state),/occurrence/u);
});

test('lookup is deduplicated, bounded and private; failed key collisions preserve the original draft',async()=>{
  const {repository,personalMeaningJourney:gateway,semanticIntake:intake}=setup();
  const first=await intake.submit(payload());assert.equal(first.route,'fast_track');
  await intake.submit(payload());
  const found=await gateway.lookupMeanings('ＢＯＲＲＯＷ');
  assert.equal(found.meanings.length,1);assert.equal(found.meanings[0]!.senseKey,'temporary-borrow');
  assert.deepEqual(found.meanings[0]!.semanticSpec,spec);
  assert(!JSON.stringify(found).includes('Private source'));assert(!JSON.stringify(found).includes('private-provenance'));
  found.meanings[0]!.semanticSpec.excludedCases.push('caller mutation');
  assert.deepEqual((await gateway.lookupMeanings('borrow')).meanings[0]!.semanticSpec.excludedCases,['永久赠送']);
  await assert.rejects(gateway.lookupMeanings(' '),/invalid_tool_arguments/u);
  const before=await repository.load();
  await assert.rejects(intake.submit(payload({...spec,coreMeaningFocus:'永久接受赠送'})),/不能静默替换/u);
  assert.deepEqual(await repository.load(),before);
  const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'另一个临时借用物品的场景。'}]});
  const sense=found.meanings[0]!;
  const clarification={operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await gateway.captureClarificationSource('intake',draft.intakeId),context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
    sense:{proposedSenseKey:sense.senseKey,reuseSense:{senseId:sense.senseId,senseVersionId:sense.senseVersionId},...spec,unresolvedQuestions:[]},
    expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},
    confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v1'},semanticPolicyVersion:'fixture-v1'};
  await assert.rejects(gateway.completeClarificationDraft({...clarification,sense:{...clarification.sense,coreMeaningFocus:'永久接受赠送'}}),/语义不一致/u);
  const {reuseSense:_ignored,...withoutReference}=clarification.sense;
  await assert.rejects(gateway.completeClarificationDraft({...clarification,sense:withoutReference}),/不能只按 key/u);
  assert.equal(intake.snapshot().length,1);assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);
  const completed=await gateway.completeClarificationDraft(clarification);
  assert.equal(completed.senseVersionId,sense.senseVersionId);assert.equal(completed.resolution,'reuse_existing');
  assert.equal(intake.snapshot().length,0);
  assert.deepEqual((await repository.load()).registry.senseVersions[0]!.semanticSpec,spec);
});

test('only active confirmed connections are reusable and their original version stays pinned',async()=>{
  const {repository,semanticIntake:intake}=setup();await intake.submit(payload());
  const state=await repository.load(),record=state.meanings[0]!,version=state.registry.senseVersions[0]!;
  const nextVersion={...version,senseVersionId:crypto.randomUUID(),versionNumber:2,semanticSpec:{...spec,coreMeaningFocus:'新版区别'}};
  state.registry.senseVersions.push(nextVersion);
  state.registry.senses[0]={...state.registry.senses[0]!,currentSenseVersionId:nextVersion.senseVersionId,currentVersionNumber:2};
  assert.equal(createMeaningLookup(state).query('borrow').meanings[0]!.senseVersionId,version.senseVersionId,'an Alignment is not the registry head');
  record.alignments[0]!.status='withdrawn';
  assert.deepEqual(createMeaningLookup(state).query('borrow').meanings,[]);
  record.alignments[0]!.status='active';record.bindingConfirmations=[];
  assert.deepEqual(createMeaningLookup(state).query('borrow').meanings,[]);
});

test('Sense, Expression and Binding heads can advance without hiding a pinned learning connection',async()=>{
  const {repository,semanticIntake:intake,personalMeaningJourney:gateway}=setup();await intake.submit(payload());
  const before=await repository.load(),pinned=before.registry.senseVersions[0]!.senseVersionId;
  await repository.commit({before,after:advanceSemanticHeads(before)});
  const found=await gateway.lookupMeanings('borrow');
  assert.equal(found.meanings[0]!.senseVersionId,pinned);
  assert.deepEqual(found.meanings[0]!.expressions,[{expression:'borrow',languageTag:'en'}]);
  const learning=gateway.getLearningSources(before.meanings[0]!.personalMeaning.personalMeaningId);
  assert.equal(learning.length,1);assert.equal(learning[0]!.reference.senseVersionId,pinned);
  assert.equal(gateway.getWorldItems().length,1);
  assert.equal(gateway.getDetail(before.meanings[0]!.personalMeaning.personalMeaningId)!.directAlignments[0]!.confirmedBindings.length,1);
  assert.equal(gateway.getListItems()[0]!.confirmedExpressionCount,1);
});

test('backup/sync resolve a pinned learning source after head advancement and origin deletion, not an unconfirmed edge',async()=>{
  const {repository,semanticIntake:intake,personalMeaningJourney:gateway}=setup();await intake.submit(payload());
  const before=await repository.load(),source=gateway.getLearningSources(before.meanings[0]!.personalMeaning.personalMeaningId)[0]!.reference;
  const resolver=(state:JourneyState)=>{
    const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as BackupRows;
    rows.semanticState.push({key:'root',value:{version:state.version}});
    rows.semanticMeanings=state.meanings.map(value=>({key:value.personalMeaning.personalMeaningId,value}));
    const idFields={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
    for(const kind of Object.keys(idFields) as Array<keyof typeof idFields>)state.registry[kind].forEach((value,ordinal)=>rows.semanticRegistry.push({
      key:`${kind}:${(value as unknown as Record<string,string>)[idFields[kind]]}`,value:{kind,ordinal,value},
    }));
    const maps=Object.fromEntries(libraryTables.map(table=>[table,new Map(rows[table].map(row=>[row.key,row.value]))])) as Record<Table,Map<string,any>>;
    return validatePersonalSemanticWorldReplica({rows,maps,requireRow:(table,key)=>maps[table].get(key),fail:()=>{throw new Error('invalid pinned source');}});
  };
  const advanced=advanceSemanticHeads(before);assert.doesNotThrow(()=>resolver(advanced).requirePersonalSource(source));
  const deleted=deleteFirstMeaning(advanced);assert.doesNotThrow(()=>resolver(deleted).requirePersonalSource(source));
  assert.throws(()=>resolver(advanced).requirePersonalSource({...source,bindingVersionId:advanced.registry.bindingVersions[1]!.bindingVersionId}),/invalid pinned source/u);
  const unconfirmed=structuredClone(before),otherBindingId=crypto.randomUUID(),otherVersionId=crypto.randomUUID();
  unconfirmed.registry.bindings.push({...before.registry.bindings[0]!,senseExpressionBindingId:otherBindingId,currentBindingVersionId:otherVersionId});
  unconfirmed.registry.bindingVersions.push({...before.registry.bindingVersions[0]!,senseExpressionBindingId:otherBindingId,bindingVersionId:otherVersionId});
  assert.throws(()=>resolver(unconfirmed).requirePersonalSource({...source,bindingId:otherBindingId,bindingVersionId:otherVersionId}),/invalid pinned source/u);
  assert.deepEqual((await createMeaningLookupCooperatively(advanced)).query('borrow'),createMeaningLookup(advanced).query('borrow'));
});

test('lookup refresh sees semantic writes but an Inbox-only change does not rebuild its fact snapshot',async()=>{
  const {repository,personalMeaningJourney:gateway}=setup();await gateway.lookupMeanings('borrow');
  const other=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await other.semanticIntake.submit(payload());assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);
  const before=await repository.load();
  await other.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'Inbox only'}]});
  assert.equal(await repository.refresh(before),before,'no semantic invalidation for Inbox/receipt rows');
  const current=await repository.load();await repository.commit({before:current,after:deleteFirstMeaning(current)});
  assert.deepEqual((await gateway.lookupMeanings('borrow')).meanings,[]);
});

test('a stale command merges a foreign Meaning and Inbox instead of stamping its old frame fresh',async()=>{
  const {repository,personalMeaningJourney:gateway}=setup();await gateway.lookupMeanings('borrow');
  const other=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await other.semanticIntake.submit(payload());
  const foreign=await other.personalMeaningJourney.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'foreign Inbox'}]});
  const own=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'own Inbox'}]});
  assert.equal(gateway.getWorldItems().length,1);
  const stored=await repository.load();assert.equal(stored.inboxItems.length,2);
  assert.deepEqual(new Set(stored.inboxItems.map(row=>row.intakeId)),new Set([foreign.intakeId,own.intakeId]));
  assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);
});

test('stale intake replay reads the durable receipt and rejects a changed payload before writing',async()=>{
  const repository=new MemoryJourneyRepository(),deps={repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}};
  const first=createJourneyModules(deps),second=createJourneyModules(deps);await Promise.all([first.personalMeaningJourney.lookupMeanings('borrow'),second.personalMeaningJourney.lookupMeanings('borrow')]);
  const input=payload(),accepted=await first.semanticIntake.submit(input),stored=await repository.load();
  assert.deepEqual(await second.semanticIntake.submit(input),{...accepted,replayed:true});assert.equal(second.personalMeaningJourney.getWorldItems().length,1);
  await assert.rejects(second.semanticIntake.submit({...input,context:{...input.context!,source:{client:'fixture',title:'changed input',url:null,sourceReferenceId:null,domSelector:null,paragraphContext:null}}}),/operationId/u);
  assert.deepEqual(await repository.load(),stored);
});

test('repeated reloads and the next command are serialized instead of allowing an older load to replace new facts',async()=>{
  const backing=new MemoryJourneyRepository();let calls=0,release:(()=>void)|undefined,entered:(()=>void)|undefined,hold=false;
  const repository={load:async()=>{
    calls++;const state=await backing.load();
    if(hold){hold=false;entered?.();await new Promise<void>(resolve=>{release=resolve;});}
    return state;
  },refresh:(state:JourneyState)=>backing.refresh(state),commit:(change:Parameters<MemoryJourneyRepository['commit']>[0])=>backing.commit(change)};
  const gateway=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  await gateway.lookupMeanings('borrow');hold=true;
  const loading=new Promise<void>(resolve=>{entered=resolve;});gateway.reload();await loading;
  gateway.reload();await new Promise<void>(resolve=>setTimeout(resolve,0));assert.equal(calls,2,'the second reload must wait for the first');
  const other=createJourneyModules({repository:backing,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await other.semanticIntake.submit(payload());
  const command=gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'after both reloads'}]});
  release!();const draft=await command;
  assert.equal(calls,3);assert.equal(gateway.getWorldItems().length,1);
  assert((await backing.load()).inboxItems.some(row=>row.intakeId===draft.intakeId));
  assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);
});

test('deleting a source Meaning during confirmation does not delete its fixed Sense or resurrect that Meaning',async()=>{
  const repository=new MemoryJourneyRepository();let foreignWrite:(()=>Promise<void>)|undefined;
  const adapter={load:()=>repository.load(),refresh:(state:Parameters<MemoryJourneyRepository['refresh']>[0])=>repository.refresh(state),
    commit:async(change:Parameters<MemoryJourneyRepository['commit']>[0])=>{const write=foreignWrite;foreignWrite=undefined;await write?.();return repository.commit(change);}};
  const {semanticIntake:intake,personalMeaningJourney:gateway}=createJourneyModules({repository:adapter,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await intake.submit(payload());const found=(await gateway.lookupMeanings('borrow')).meanings[0]!;
  const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'another borrower'}]});
  foreignWrite=async()=>{const before=await repository.load();await repository.commit({before,after:deleteFirstMeaning(before)});};
  const completed=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await gateway.captureClarificationSource('intake',draft.intakeId),context:payload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
    sense:{proposedSenseKey:found.senseKey,reuseSense:{senseId:found.senseId,senseVersionId:found.senseVersionId},...found.semanticSpec,unresolvedQuestions:[]},
    expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],
    provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
  const after=await repository.load();assert.equal(after.meanings[0]!.personalMeaning.status,'deleted');
  assert.notEqual(after.meanings[0]!.personalMeaning.personalMeaningId,completed.personalMeaningId);
  assert.equal(after.meanings[1]!.personalMeaning.status,'active');assert.equal(after.registry.senseVersions.length,1);
  assert.equal(completed.senseVersionId,found.senseVersionId);assert.equal(gateway.getWorldItems().length,1);
  assert.equal(intake.snapshot().length,0);
});

test('a rejected read witness writes no receipt or draft, while semantic-key collisions roll back the full merged frame',async()=>{
  const {repository,semanticIntake:intake}=setup();await intake.submit(payload());
  const before=await repository.load(),version=before.registry.senseVersions[0]!;
  const unrelated=setup();await unrelated.semanticIntake.submit(payload());const addition=await unrelated.repository.load();
  const after={...before,meanings:[...before.meanings,...addition.meanings],registry:Object.fromEntries(Object.keys(before.registry).map(kind=>[
    kind,[...before.registry[kind as keyof typeof before.registry],...addition.registry[kind as keyof typeof before.registry]],
  ])) as unknown as typeof before.registry};
  const draftAfter={...before,commandReceipts:[...before.commandReceipts,{operationId:crypto.randomUUID(),command:'ReadWitnessFixture',result:{},committedAt:'2026-10-03T02:00:00.000Z'}]};
  await assert.rejects(repository.commit({before,after:draftAfter,preconditions:[{table:'semanticRegistry',key:`senseVersions:${version.senseVersionId}`,
    expected:{kind:'senseVersions',ordinal:0,value:{...version,semanticSpec:{...spec,coreMeaningFocus:'not the observed version'}}}}]}),/meaningChanged/u);
  assert.deepEqual(await repository.load(),before);
  // Both worlds are valid independently, but the stale writer's chosen key is
  // now occupied by a foreign identity. No part of that second world may stick.
  const empty=await unrelated.repository.load();
  const fresh=new MemoryJourneyRepository(),stale=await fresh.load();
  await fresh.commit({before:stale,after:before});
  await assert.rejects(fresh.commit({before:stale,after:empty}),(error:unknown)=>
    error instanceof Error&&error.cause instanceof Error&&/Sense key/u.test(error.cause.message));
  assert.deepEqual(await fresh.load(),before);
  assert.throws(()=>assertPersonalSemanticWorldState(after),/Sense key/u);
});

test('a pending or failed commit cannot expose speculative semantic connections to the model',async()=>{
  const backing=new MemoryJourneyRepository();
  let rejectCommit:((error:Error)=>void)|undefined,entered:()=>void=()=>{};
  let hold=false;
  const repository={load:()=>backing.load(),commit:async(change:Parameters<MemoryJourneyRepository['commit']>[0])=>{
    if(hold){entered();await new Promise<never>((_resolve,reject)=>{rejectCommit=reject;});}
    return backing.commit(change);
  }};
  const {semanticIntake:intake,personalMeaningJourney:gateway}=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await intake.submit(payload());
  hold=true;const committing=new Promise<void>(resolve=>{entered=resolve;});
  const next=payload({...spec,coreMeaningFocus:'新连接尚未提交'});next.sense!.senseKey='not-committed';
  const pending=intake.submit(next),rejected=assert.rejects(pending,/fixture disk failure/u);
  await committing;
  assert.deepEqual((await gateway.lookupMeanings('新连接')).meanings,[]);
  assert.equal((await gateway.lookupMeanings('borrow')).meanings.length,1);
  rejectCommit!(new Error('fixture disk failure'));await rejected;
  assert.deepEqual((await gateway.lookupMeanings('新连接')).meanings,[]);
  assert.equal((await backing.load()).meanings.length,1);
});

test('cross-linked acceptance or learner ownership cannot admit a reusable connection',async()=>{
  const {repository,semanticIntake:intake}=setup();await intake.submit(payload());
  const state=await repository.load(),version=state.registry.senseVersions[0]!,sense=state.registry.senses[0]!;
  const foreignSenseId=crypto.randomUUID(),foreignVersionId=crypto.randomUUID();
  state.registry.senses.push({...sense,senseId:foreignSenseId,senseKey:'another-sense',currentSenseVersionId:foreignVersionId});
  state.registry.senseVersions.push({...version,senseId:foreignSenseId,senseVersionId:foreignVersionId});
  const acceptance=state.meanings[0]!.semanticAcceptances[0]!;
  acceptance.senseId=foreignSenseId;acceptance.senseVersionId=foreignVersionId;
  assert.throws(()=>assertPersonalSemanticWorldState(state),/Alignment 与 Semantic Acceptance/u);
  assert.deepEqual(createMeaningLookup(state).query('borrow').meanings,[]);
  acceptance.senseId=sense.senseId;acceptance.senseVersionId=version.senseVersionId;
  state.meanings[0]!.bindingConfirmations[0]!.learnerUserId='another-learner';
  assert.throws(()=>assertPersonalSemanticWorldState(state),/Binding confirmation 属于错误的 learner/u);
  assert.deepEqual(createMeaningLookup(state).query('borrow').meanings,[]);
});

test('10,000 connections use a reusable compact index and keep result bytes independent of world size',async()=>{
  const {repository,semanticIntake:intake}=setup();await intake.submit(payload());
  const state=syntheticSemanticWorld(await repository.load(),10_000);
  // Identity witnesses may be read; no private prose, media or provenance may
  // be traversed even at first index construction.
  for(const record of state.meanings)for(const [field,value] of Object.entries(record)){
    const allowed=Object.hasOwn(meaningLookupFactFields,field)?new Set(meaningLookupFactFields[field as keyof typeof meaningLookupFactFields]):null;
    const protect=(object:object,key:string)=>Object.defineProperty(object,key,{get(){throw new Error('lookup read private Context');}});
    if(!allowed){protect(record,field);continue;}
    for(const row of Array.isArray(value)?value:[value])for(const key of Object.keys(row))if(!allowed.has(key))protect(row,key);
  }
  const started=performance.now(),lookup=createMeaningLookup(state),coldMs=performance.now()-started;
  const times:number[]=[];
  for(let iteration=0;iteration<100;iteration++){
    const at=performance.now(),result=lookup.query('borrow-9999');times.push(performance.now()-at);
    assert.equal(result.meanings.length,1);assert.equal(result.meanings[0]!.senseKey,'borrow-9999');
  }
  const common=lookup.query('borrow');assert.equal(common.meanings.length,5);assert.equal(common.truncated,true);
  assert(new TextEncoder().encode(JSON.stringify({ok:true,...common})).byteLength<=MEANING_LOOKUP_MAX_BYTES);
  times.sort((a,b)=>a-b);const p95Ms=times[94]!;
  console.log(`Semantic lookup, Node/in-memory synthetic 10k connections: cold index ${coldMs.toFixed(1)}ms; warm query p95 ${p95Ms.toFixed(2)}ms; not browser/OPFS/model latency.`);
  assert(coldMs<1000,'cold compact index must not regress to quadratic detail projections');
  assert(p95Ms<20,'warm indexed lookup must remain interactive at 10k connections');
});

test('oversize semantic boundaries are omitted honestly, not truncated into a different reusable meaning',async()=>{
  const {repository,semanticIntake:intake}=setup();await intake.submit(payload());
  const state=await repository.load();state.registry.senseVersions[0]!.semanticSpec.excludedCases=['不应省略的边界'.repeat(10_000)];
  const result=createMeaningLookup(state).query('borrow');assert.equal(result.truncated,true);assert.deepEqual(result.meanings,[]);
});
