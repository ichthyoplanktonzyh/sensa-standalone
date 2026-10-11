import {test,expect} from 'vitest';
import {manualMeaningSense,manualMeaningPayload,manualDraftFromIntake,newManualMeaningDraft,occurrencePositions} from '../../../apps/web/src/experience/intake/manualMeaning';
import {digestOf} from '../../../apps/web/src/experience/personalMeaningJourney/digest';
import {semanticLookupPayload,advanceSemanticHeads} from '../support/semanticLookupFixtures';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';

const draft=()=>({...newManualMeaningDraft(),context:'  📝 She backed out of the trip.  ',occurrence:'backed out',canonicalForm:'back out',languageTag:'en',expressionType:'phrase' as const,meaning:'退出已经答应参加的活动。',usage:'有人答应参加一次活动，后来改变主意不再参加。'});
test('wording edits retain unseen boundaries, other prototypes and the edited scene structure',()=>{
 const prior=semanticLookupPayload(),spec=prior.sense!.semanticSpec;
 const first={...spec.prototypeScenes[0]!,participantRoles:['借用者'],states:['用后归还'],directionOrCausality:'借用后归还'};
 prior.sense!.semanticSpec={...spec,prototypeScenes:[first,{...first,summary:'借一本书。'}],includedCases:['借用'],excludedCases:['赠送'],neighborContrasts:[{label:'lend',distinction:'方向相反'}],openQuestions:['期限尚未说明']};
 const value={...newManualMeaningDraft(),meaning:'临时借用，之后归还。',usage:'借用雨伞。'};
 const edited=manualMeaningSense(value,prior,{preserveDefinition:true}).semanticSpec;
 expect(edited).toEqual({...prior.sense!.semanticSpec,coreMeaningFocus:value.meaning,prototypeScenes:[{...first,summary:value.usage},prior.sense!.semanticSpec.prototypeScenes[1]!]});
 expect(manualMeaningSense({...value,usage:''},prior,{preserveDefinition:true}).semanticSpec.prototypeScenes).toEqual([prior.sense!.semanticSpec.prototypeScenes[1]]);
 expect(manualMeaningSense(value,prior).semanticSpec.excludedCases).toEqual([]);
});
test('manual authoring requires genuine contextual occurrence and preserves only learner-authored meaning',async()=>{
  const value=draft(),payload=manualMeaningPayload(value);
  expect(payload.expression?.occurrence).toEqual({surfaceForm:'backed out',locator:{kind:'text_span',start:7,end:17}});
  expect(payload.expression?.surfaceForm).toBe('back out');
  expect(payload.context?.languageTag).toBeNull(); // The expression's language does not classify the entire context.
  expect(payload.sense?.resolutionProvenance).toMatchObject({resolverKind:'learner',model:null,policyVersion:null});
  expect(()=>manualMeaningPayload({...value,context:''})).toThrow('contextRequired');
  expect(()=>manualMeaningPayload({...value,occurrence:'back out'})).toThrow('occurrenceRequired');
  expect(manualMeaningPayload({...value,usage:''}).sense?.semanticSpec.prototypeScenes).toEqual([]);
  expect(()=>manualMeaningPayload({...value,languageTag:''})).toThrow('languageRequired');
  const repeated={...value,context:'backed out, then backed out again.'};
  expect(occurrencePositions(repeated.context,repeated.occurrence)).toEqual([0,17]);
  expect(()=>manualMeaningPayload(repeated)).toThrow('occurrenceRequired');
  expect(manualMeaningPayload({...repeated,occurrenceStart:17}).expression?.occurrence?.locator).toEqual({kind:'text_span',start:17,end:27});
});
test('explicit manual save creates the complete ordinary Meaning once with no model or learning facts',async()=>{
  const repository=new MemoryJourneyRepository();
  const {semanticIntake}=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  const payload=manualMeaningPayload(draft());
  expect((await repository.load()).meanings).toHaveLength(0);
  const result=await semanticIntake.submit(payload);expect(result.route).toBe('fast_track');
  expect(await semanticIntake.submit(payload)).toEqual({...result,replayed:true});
  await expect(semanticIntake.submit({...payload,capturedAt:'2026-10-05T12:00:00Z'})).rejects.toThrow('operationId');
  const state=await repository.load();expect(state.meanings).toHaveLength(1);expect(state.inboxItems).toHaveLength(0);
  const meaning=state.meanings[0]!;
  expect(meaning.semanticAcceptances[0]).toMatchObject({resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null},authority:{mode:'learner_direct'}});
  expect(meaning.personalExpressionAnchorRevisions[0]).toMatchObject({surfaceForm:'back out',provenanceKind:'learner_authored',occurrence:{kind:'text_span',start:7,end:17}});
  expect(meaning.bindingConfirmations).toHaveLength(1);
  expect(state.registry.senseVersions[0]?.semanticSpec).toEqual(payload.sense!.semanticSpec);
  expect(meaning.focuses).toHaveLength(0);
  expect(state.registry.bindings[0]?.relation).toBeNull();
  expect(state.registry.bindingVersions[0]?.semanticCoverage).toBeNull();
});

test('natural-language meaning needs no prototype and equal prose does not infer identity; explicit selection reuses it',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()});
 const first={...draft(),usage:''};
 await modules.semanticIntake.submit(manualMeaningPayload(first));
 await modules.semanticIntake.submit(manualMeaningPayload({...first,operationId:crypto.randomUUID()}));
 let state=await repository.load();
 expect(state.registry.senses).toHaveLength(2);
 expect(new Set(state.registry.senses.map(row=>row.senseId)).size).toBe(2);
 expect(state.registry.senseVersions.every(row=>row.semanticSpec.prototypeScenes.length===0)).toBe(true);
 const sense=state.registry.senses[0]!,version=state.registry.senseVersions[0]!;
 const selected={...first,operationId:crypto.randomUUID(),existingSense:{senseId:sense.senseId,senseVersionId:version.senseVersionId,senseKey:sense.senseKey,semanticSpec:version.semanticSpec}};
 await modules.semanticIntake.submit(manualMeaningPayload(selected));
 state=await repository.load();
 expect(state.registry.senses).toHaveLength(2);
 expect(state.meanings.at(-1)?.semanticAcceptances[0]).toMatchObject({senseId:sense.senseId,senseVersionId:version.senseVersionId,resolution:'reuse_existing'});
});

test('manual Inbox completion retains original source/media while accepting learner-written context and meaning atomically',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()});
 const seed=semanticLookupPayload(),mediaId=crypto.randomUUID();
 const original={...seed,acceptance:null,sense:null,context:{...seed.context!,mediaReferenceIds:[mediaId],modality:'mixed' as const,source:{client:'browser-extension',url:'https://example.test/story',title:'Original story',sourceReferenceId:null,domSelector:null,paragraphContext:null}}};
 const queued=await modules.semanticIntake.submit(original);if(queued.route!=='inbox')throw new Error('expected Inbox');
 const item=(await repository.load()).inboxItems[0]!,edit={...manualDraftFromIntake(item),context:'Added personal detail. '+original.context.textSegment,meaning:'临时借用并归还。',usage:'我向同事借伞，下班后归还。'};
 const completed=manualMeaningPayload(edit,item),command={operationId:edit.operationId,intakeId:item.intakeId,expectedItemDigest:digestOf(item),context:{...completed.context!,mediaReferenceIds:[]},expression:completed.expression!,sense:completed.sense!};
 const result=await modules.semanticIntake.resolve(command);if(result.route!=='fast_track')throw new Error('expected Meaning');
 expect(await modules.semanticIntake.resolve(command)).toEqual({...result,replayed:true});
 const saved=await repository.load();expect(saved.meanings).toHaveLength(1);expect(saved.inboxItems).toEqual([]);
 const record=saved.meanings[0]!;
 expect(record.semanticAcceptances[0]?.resolutionProvenance.resolverKind).toBe('learner');
 expect(record.personalSemanticAnchorRevisions[0]).toMatchObject({bodyText:edit.context,provenance:{kind:'learner_authored'},structuredPayload:{intake:{contextText:original.context.textSegment,contextSource:original.context.source,expression:original.expression},mediaReferenceIds:[mediaId]}});
 const detail=modules.personalMeaningJourney.getDetail(result.personalMeaningId)!;
 expect(detail.capturedSources?.[0]).toMatchObject({text:original.context.textSegment,source:original.context.source});
 expect(detail.materialBlocks.some(block=>block.personalMediaObjectId===mediaId)).toBe(true);
});

test('unchanged captured Sense keeps its resolver and all constraints; added Context is never attributed to the image source',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()});
 const seed=semanticLookupPayload(),mediaId=crypto.randomUUID(),source={client:'browser-extension',url:'https://example.test/image',title:'Image source',sourceReferenceId:null,domSelector:null,paragraphContext:null};
 await modules.semanticIntake.submit({...seed,acceptance:null,context:{...seed.context!,textSegment:null,modality:'image',mediaReferenceIds:[mediaId],source},expression:{...seed.expression!,occurrence:null}});
 const item=(await repository.load()).inboxItems[0]!,edit={...manualDraftFromIntake(item),context:'I borrow an umbrella.',occurrence:'borrow'};
 const completed=manualMeaningPayload(edit,item);expect(completed.sense).toEqual(seed.sense);
 const result=await modules.semanticIntake.resolve({operationId:edit.operationId,intakeId:item.intakeId,expectedItemDigest:digestOf(item),context:completed.context!,expression:completed.expression!,sense:completed.sense!});if(result.route!=='fast_track')throw new Error('expected Meaning');
 const record=(await repository.load()).meanings[0]!;
 expect(record.semanticAcceptances[0]?.resolutionProvenance).toEqual(seed.sense!.resolutionProvenance);
 expect(record.personalExpressionAnchorRevisions[0]?.provenanceKind).toBe('learner_authored');
 expect(modules.personalMeaningJourney.getDetail(result.personalMeaningId)?.capturedSources?.[0]).toMatchObject({text:null,source});
 expect(modules.personalMeaningJourney.getDetail(result.personalMeaningId)?.materialBlocks.some(block=>block.personalMediaObjectId===mediaId)).toBe(true);
 const changed=manualMeaningPayload({...edit,meaning:'新的手写意思'},item);expect(changed.sense?.wordingSource).toBe('learner_authored');expect(changed.sense?.semanticSpec.includedCases).toEqual([]);
});

test('choosing an existing meaning pins the reviewed version and rejects edited semantic content',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()});
 const seed=semanticLookupPayload();await modules.semanticIntake.submit(seed);
 const selected=(await modules.personalMeaningJourney.lookupMeanings('borrow')).meanings[0]!;
 await modules.semanticIntake.submit({...seed,operationId:crypto.randomUUID(),sense:null,acceptance:null});
 const item=(await repository.load()).inboxItems[0]!;
 const draft={...manualDraftFromIntake(item),existingSense:{senseId:selected.senseId,senseVersionId:selected.senseVersionId,senseKey:selected.senseKey,semanticSpec:selected.semanticSpec},meaning:selected.semanticSpec.coreMeaningFocus,usage:selected.semanticSpec.prototypeScenes[0]!.summary};
 const payload=manualMeaningPayload(draft,item);
 expect(()=>manualMeaningPayload({...draft,meaning:'未解除复用便改写意思'},item)).toThrow('manualMeaning.invalid');
 const before=await repository.load();await repository.commit({before,after:advanceSemanticHeads(before)});
 const intake=createJourneyModules({repository,clock:createSeededClock()}).semanticIntake;
 const command={operationId:draft.operationId,intakeId:item.intakeId,expectedItemDigest:digestOf(item),context:payload.context!,expression:payload.expression!,sense:payload.sense!,reuseSense:{senseId:selected.senseId,senseVersionId:selected.senseVersionId}};
 await expect(intake.resolve({...command,sense:{...command.sense,semanticSpec:{...command.sense.semanticSpec,coreMeaningFocus:'tampered pinned meaning'}}})).rejects.toThrow('语义不一致');
 expect((await repository.load()).inboxItems).toHaveLength(1);expect(await repository.readReceipt(command.operationId)).toBeNull();
 const result=await intake.resolve(command);if(result.route!=='fast_track')throw new Error('expected Meaning');
 const after=await repository.load(),record=after.meanings.find(record=>record.personalMeaning.personalMeaningId===result.personalMeaningId)!;
 expect(after.registry.senses).toHaveLength(1);expect(record.semanticAcceptances[0]).toMatchObject({senseId:selected.senseId,senseVersionId:selected.senseVersionId,resolution:'reuse_existing',resolutionProvenance:{resolverKind:'external_tool',provider:'sensa-local-registry',model:null}});
 expect(record.bindingConfirmations[0]?.senseVersionId).toBe(selected.senseVersionId);
});

test('an already located image occurrence is valid Context without inventing a text example',async()=>{
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock()}),seed=semanticLookupPayload(),mediaId=crypto.randomUUID();
 const occurrence={surfaceForm:'borrow',locator:{kind:'media_region' as const,mediaReferenceId:mediaId,x:.1,y:.1,width:.3,height:.2}};
 await modules.semanticIntake.submit({...seed,sense:null,acceptance:null,context:{...seed.context!,textSegment:null,modality:'image',mediaReferenceIds:[mediaId]},expression:{...seed.expression!,languageTag:'en-US',occurrence}});
 const item=(await repository.load()).inboxItems[0]!,draft={...manualDraftFromIntake(item),meaning:'临时借用',usage:'借用雨伞后归还。'},payload=manualMeaningPayload(draft,item);
 expect(payload.context?.textSegment).toBeNull();expect(payload.expression?.occurrence).toEqual(occurrence);expect(payload.expression?.languageTag).toBe('en-US');
 const result=await modules.semanticIntake.resolve({operationId:draft.operationId,intakeId:item.intakeId,expectedItemDigest:digestOf(item),context:payload.context!,expression:payload.expression!,sense:payload.sense!});if(result.route!=='fast_track')throw new Error('expected Meaning');
 const detail=modules.personalMeaningJourney.getDetail(result.personalMeaningId)!;expect(detail.materialBlocks.filter(block=>block.personalMediaObjectId===mediaId)).toHaveLength(1);expect(detail.materialBlocks.filter(block=>block.kind==='text')).toHaveLength(0);
});
