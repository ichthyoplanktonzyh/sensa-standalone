/** Actual owner commands and SQLite/Wasm; no model or fabricated learning outcome. */
import {afterAll,expect,test} from 'vitest';
import {useNodeLearningCapacityStorage} from '../../../scripts/support/nodeLearningCapacity.mts';
import {openLibrary,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {LibraryJourneyRepository,semanticJourneyTables} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
import {worldReadRepository} from '../../../apps/web/src/experience/personalMeaningJourney/worldRepository';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import type {ReplicaEntry} from '../../../apps/web/src/data/library/replication/domainReplica';
import {isAlignmentActive} from '../../../apps/web/src/experience/personalMeaningJourney/alignmentLifecycle';
import type {MeaningJourneyRecord} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import type {CorrectPersonalMeaningInput} from '../../../apps/web/src/experience/personalMeaningJourney/types';
import {mergeLibraryReplicas} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {clarificationSourceWitness,meaningSourceValue,sameClarificationSource} from '../../../apps/web/src/experience/personalMeaningJourney/clarificationSource';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://correction.fixture.invalid')});
const database=await useNodeLearningCapacityStorage();afterAll(()=>database.close());await openLibrary();
const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
const {personalContentSystem}=await import('../../../apps/web/src/personalContent/system');
const {buildLearnerSemanticProjection}=await import('../../../apps/web/src/learnerSemanticProjection/system/learnerSemanticProjectionSystem');
const clock=createSeededClock('2026-10-06T12:00:00Z'),id=()=>crypto.randomUUID();
const modules=()=>createJourneyModules({repository:new LibraryJourneyRepository(),clock,languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
const record=(key:string)=>readLibrary(tx=>tx.get<MeaningJourneyRecord>('semanticMeanings',key));
const snapshot=()=>readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)]))));
const replicas=(rows:Awaited<ReturnType<typeof snapshot>>):ReplicaEntry[]=>semanticJourneyTables.flatMap(table=>(rows[table] as {key:string;value:unknown}[]).map(row=>({table,key:row.key,value:encodeBackupValue(row.value)})));

test('correction replaces one current connection in the same Meaning, preserves original sources, rejects stale/failed saves, and an old replica cannot restore it',async()=>{
 const accepted=await modules().semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'Jo asked to borrow my umbrella. I gave it to her.',occurrence:'borrow',canonicalForm:'borrow',languageTag:'en',meaning:'暂时取得他人的物品，之后归还。',usage:'从朋友处暂借雨伞。'}));if(accepted.route!=='fast_track')throw Error('Expected accepted source');
 const before=(await record(accepted.personalMeaningId))!,old=before.alignments[0]!,seed=await worldReadRepository.correction(accepted.personalMeaningId,old.personalMeaningAlignmentId);
 await personalContentSystem.execute({kind:'set_saved_sense',operationId:id(),senseId:old.senseId,saved:true});
 await personalContentSystem.execute({kind:'set_sense_note',operationId:id(),senseId:old.senseId,body:'当时理解成借入，后来纠正。',expected:{body:'',revision:0}});
 const operationId=id(),request:CorrectPersonalMeaningInput={operationId,personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:old.personalMeaningAlignmentId,source:seed.source,payload:{...seed.payload,operationId,acceptance:{mode:'learner_direct'},expression:{...seed.payload.expression!,surfaceForm:'lend',occurrence:{...seed.payload.expression!.occurrence!,surfaceForm:'lend'}},sense:{senseKey:null,wordingSource:'learner_authored',resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null,policyVersion:null,sourceReferenceIds:[]},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'把自己的物品暂时交给别人使用，之后收回。',prototypeScenes:[{summary:'把雨伞暂借给朋友，用完后收回。',participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}}}};
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter),base=await snapshot();
 try{
  adapter.entries=async table=>{if(table.startsWith('semantic'))throw Error('correction scanned the World');return entries(table);};adapter.entriesPage=async(table,after,limit)=>{if(table.startsWith('semantic'))throw Error('correction paged the World');return page(table,after,limit);};
  adapter.commit=async()=>{throw Error('controlled correction commit failure');};
  await expect(modules().personalMeaningJourney.correctPersonalMeaning(request)).rejects.toThrow();
  adapter.commit=commit;expect(await record(accepted.personalMeaningId)).toEqual(before);
  const result=await modules().personalMeaningJourney.correctPersonalMeaning(request);
  expect(result).toMatchObject({personalMeaningId:accepted.personalMeaningId,revision:2,replacedAlignmentId:old.personalMeaningAlignmentId,replayed:false});
  expect(await modules().personalMeaningJourney.correctPersonalMeaning(request)).toEqual({...result,replayed:true});
  await expect(modules().personalMeaningJourney.correctPersonalMeaning({...request,payload:{...request.payload,expression:{...request.payload.expression!,surfaceForm:'changed retry'}}})).rejects.toThrow();
  await expect(modules().personalMeaningJourney.correctPersonalMeaning({...request,operationId:id(),payload:{...request.payload,operationId:id()}})).rejects.toThrow();
  const staleId=id();await expect(modules().personalMeaningJourney.correctPersonalMeaning({...request,operationId:staleId,payload:{...request.payload,operationId:staleId}})).rejects.toThrow('clarificationSourceChanged');
  const current=(await record(accepted.personalMeaningId))!;
  expect(current.personalSemanticAnchors).toEqual(before.personalSemanticAnchors);expect(current.personalSemanticAnchorRevisions).toEqual(before.personalSemanticAnchorRevisions);
  expect(current.semanticAcceptances[0]).toEqual(before.semanticAcceptances[0]);expect(current.alignments[0]).toEqual(old);expect(current.personalMeaningRevisions[0]).toEqual(before.personalMeaningRevisions[0]);
  expect(isAlignmentActive(current,old)).toBe(false);expect(isAlignmentActive(current,current.alignments[1]!)).toBe(true);
  expect((await worldReadRepository.detail(accepted.personalMeaningId)).detail?.directAlignments).toMatchObject([{coreMeaningFocus:request.payload.sense!.semanticSpec.coreMeaningFocus,confirmedBindings:[{surfaceForm:'lend'}]}]);
  const references=await worldReadRepository.references([old.senseId]);await personalContentSystem.refresh();
  const markers=buildLearnerSemanticProjection([],references);
  expect(markers.savedSenses).toContainEqual(expect.objectContaining({kind:'personal_meaning',personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:old.personalMeaningAlignmentId,senseId:old.senseId,word:'borrow',meaning:'暂时取得他人的物品，之后归还。',historical:true}));
  expect(markers.notes).toContainEqual(expect.objectContaining({word:'borrow',body:'当时理解成借入，后来纠正。',reference:expect.objectContaining({senseId:old.senseId,historical:true})}));
  expect(markers.learned).toEqual([]);
  expect((await modules().personalMeaningJourney.lookupMeanings('borrow')).meanings).toEqual([]);expect((await modules().personalMeaningJourney.lookupMeanings('lend')).meanings).toHaveLength(1);
  await expect(modules().semanticIntake.submit({...request.payload,operationId:id()})).rejects.toThrow('annotationInvalid');
 }finally{adapter.commit=commit;adapter.entries=entries;adapter.entriesPage=page;}
 const after=await snapshot();validateBackupRows(after as Parameters<typeof validateBackupRows>[0]);
 for(const table of libraryTables)if(!table.startsWith('semantic')&&table!=='meta')expect(after[table],`${table} must not be rewritten by a personal correction`).toEqual(base[table]);
 const merged=mergeLibraryReplicas({base:replicas(base),local:replicas(after),remote:replicas(base)});expect(merged.conflicts).toEqual([]);
 const mergedMeaning=decodeBackupValue(merged.entries.find(row=>row.table==='semanticMeanings'&&row.key===accepted.personalMeaningId)!.value) as MeaningJourneyRecord;expect(isAlignmentActive(mergedMeaning,old)).toBe(false);
 const receipt=after.semanticReceipts!.find((row:any)=>row.value.command==='CorrectPersonalMeaning') as any;
 const forged={...after,semanticReceipts:after.semanticReceipts!.filter((row:any)=>row.key!==receipt.key)};
 expect(()=>validateBackupRows(forged as Parameters<typeof validateBackupRows>[0])).toThrow();expect(mergeLibraryReplicas({base:replicas(base),local:replicas(forged),remote:replicas(base)}).conflicts).toContain(JSON.stringify(['semanticMeanings',accepted.personalMeaningId]));
});

test('markers retain exact non-primary active interpretations when another Focus becomes the primary view',async()=>{
 const accepted=await modules().semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'Jo asked to borrow my umbrella. I gave it to her.',occurrence:'borrow',languageTag:'en',meaning:'从别人那里暂时借入物品，之后归还。',usage:'向朋友暂借雨伞。'}));if(accepted.route!=='fast_track')throw Error('Expected source');
 const original=(await record(accepted.personalMeaningId))!,old=original.alignments[0]!,spec=manualMeaningPayload({...newManualMeaningDraft(),context:'I lend an umbrella.',occurrence:'lend',languageTag:'en',meaning:'把物品暂时借给别人，之后收回。',usage:'把自己的雨伞暂借给同事。'}).sense!.semanticSpec;
 const confirmation=await modules().personalMeaningJourney.confirmClarification({operationId:id(),personalMeaningId:accepted.personalMeaningId,source:await worldReadRepository.captureSource('personal_meaning',accepted.personalMeaningId),languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:{statement:'从物品所有者的借出视角理解',distinguishingNotes:[],aspectLabel:'借出者'},sense:{proposedSenseKey:'giving-umbrella-focus',...spec,unresolvedQuestions:[]},expression:{surfaceForm:'lend',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'controlled-fixture',model:'controlled-fixture',promptVersion:'test-v1'},semanticPolicyVersion:'test-v1'});
 const current=(await record(accepted.personalMeaningId))!,newAlignment=current.alignments.find(row=>row.personalMeaningAlignmentId===confirmation.personalMeaningAlignmentId)!;
 expect(isAlignmentActive(current,old)).toBe(true);expect(isAlignmentActive(current,newAlignment)).toBe(true);
 const references=await worldReadRepository.references([old.senseId,newAlignment.senseId]);
 expect(references[0]?.references).toContainEqual(expect.objectContaining({personalMeaningAlignmentId:old.personalMeaningAlignmentId,senseId:old.senseId,word:'borrow',historical:false}));
 expect(references[0]?.references?.[0]).toMatchObject({personalMeaningAlignmentId:newAlignment.personalMeaningAlignmentId,senseId:newAlignment.senseId,word:'lend',historical:false});
 await personalContentSystem.execute({kind:'set_saved_sense',operationId:id(),senseId:old.senseId,saved:true});await personalContentSystem.refresh();
 expect(buildLearnerSemanticProjection([],references).savedSenses).toContainEqual(expect.objectContaining({kind:'personal_meaning',personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:old.personalMeaningAlignmentId,senseId:old.senseId,primary:false,historical:false}));
 validateBackupRows(await snapshot() as Parameters<typeof validateBackupRows>[0]);
});

test('correction reviews the complete current Context while preserving earlier capture, and refuses a Context changed after that review',async()=>{
 const accepted=await modules().semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow an umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂时借用，之后归还。',usage:'向朋友暂借雨伞。'}));if(accepted.route!=='fast_track')throw Error('Expected source');
 const original=(await record(accepted.personalMeaningId))!,alignment=original.alignments[0]!;
 await modules().personalMeaningJourney.reviseContext({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:'现在审阅的情境：把自己的伞借给同事。'},{kind:'text',bodyText:'同事约好第二天归还。'}]});
 const reviewed=await worldReadRepository.correction(accepted.personalMeaningId,alignment.personalMeaningAlignmentId),locator=reviewed.payload.expression!.occurrence!.locator;
 expect(reviewed.payload.context?.textSegment).toBe('现在审阅的情境：把自己的伞借给同事。\n\n同事约好第二天归还。');
 if(locator.kind!=='personal_meaning')throw Error('Expected existing Context locator');expect(locator.personalSemanticAnchorRevisionIds).toHaveLength(2);
 const operationId=id(),request={operationId,personalMeaningId:accepted.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:reviewed.source,reuseSense:reviewed.reuseSense,payload:{...reviewed.payload,operationId,acceptance:{mode:'learner_direct' as const}}};
 await modules().personalMeaningJourney.reviseContext({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:2,blocks:[{kind:'text',bodyText:'另一页刚更新的情境，尚未审阅。'}]});
 await expect(modules().personalMeaningJourney.correctPersonalMeaning(request)).rejects.toThrow('clarificationSourceChanged');
 const next=await worldReadRepository.correction(accepted.personalMeaningId,alignment.personalMeaningAlignmentId),nextId=id();
 await modules().personalMeaningJourney.correctPersonalMeaning({...request,operationId:nextId,source:next.source,payload:{...next.payload,operationId:nextId,acceptance:{mode:'learner_direct'}}});
 const current=(await record(accepted.personalMeaningId))!;
 expect(current.semanticAcceptances[0]).toEqual(original.semanticAcceptances[0]);expect(current.personalSemanticAnchorRevisions[0]).toEqual(original.personalSemanticAnchorRevisions[0]);
 expect(current.semanticAcceptances.at(-1)?.personalSemanticAnchorRevisionId).not.toBe(original.semanticAcceptances[0]?.personalSemanticAnchorRevisionId);
 const detail=(await worldReadRepository.detail(accepted.personalMeaningId)).detail!;expect(detail.directAlignments).toHaveLength(1);expect(detail.directAlignments[0]?.confirmedBindings).toHaveLength(1);expect(detail.alignmentHistory).toHaveLength(1);
 validateBackupRows(await snapshot() as Parameters<typeof validateBackupRows>[0]);
});

test('review witnesses ignore only top-level fact collection order, retaining every fact and nested source sequence',async()=>{
 const accepted=await modules().semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow an umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂时借用，之后归还。',usage:'向朋友暂借雨伞。'}));if(accepted.route!=='fast_track')throw Error('Expected source');
 await modules().personalMeaningJourney.reviseContext({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:1,blocks:[{kind:'text',bodyText:'先借入雨伞。'},{kind:'text',bodyText:'之后归还。'}]});
 const original=(await record(accepted.personalMeaningId))!,untouched=structuredClone(original),source=await worldReadRepository.captureSource('personal_meaning',accepted.personalMeaningId);
 const witness=(value:MeaningJourneyRecord)=>clarificationSourceWitness(source.incarnation,'personal_meaning',accepted.personalMeaningId,meaningSourceValue(value));
 const reordered=structuredClone(original);for(const value of Object.values(reordered))if(Array.isArray(value))value.reverse();
 expect(witness(reordered)).toEqual(source);expect(original).toEqual(untouched);
 // Every fact's complete payload stays bound; neither fact identity nor a
 // reduced current-head projection is enough to authorize a reviewed save.
 for(const [field,rows] of Object.entries(original))if(Array.isArray(rows)&&rows.length){
  const changed=structuredClone(original) as unknown as Record<string,unknown[]>;
  changed[field]![0]={...changed[field]![0] as object,witnessProbe:'changed complete fact'};
  expect(witness(changed as unknown as MeaningJourneyRecord).digest,field).not.toBe(source.digest);
 }
 const duplicated=structuredClone(original);duplicated.personalSemanticAnchorRevisions.push(structuredClone(duplicated.personalSemanticAnchorRevisions[0]!));expect(witness(duplicated).digest).not.toBe(source.digest);
 const reversedSources=structuredClone(original),revision=reversedSources.personalMeaningRevisions.find(row=>row.provenance.sourceReferenceIds.length>1)!;expect(revision).toBeDefined();revision.provenance.sourceReferenceIds.reverse();expect(witness(reversedSources).digest).not.toBe(source.digest);
 const changedHead=structuredClone(original);changedHead.personalMeaning.currentRevision++;expect(witness(changedHead).digest).not.toBe(source.digest);
 const changedAdapter=structuredClone(original);changedAdapter.mockState.focusAspectLabels['another-focus']='changed';expect(witness(changedAdapter).digest).not.toBe(source.digest);
 expect(sameClarificationSource(source,{...source,incarnation:'another-library'})).toBe(false);
 const deleted=structuredClone(original);deleted.personalMeaning.status='deleted';expect(()=>witness(deleted)).toThrow('clarificationSourceChanged');
});
