import {hydrateMeaningContexts} from '../../../apps/web/src/experience/personalMeaningJourney/contextRecords';
import {test,expect} from 'vitest';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {manualMeaningPayload,newManualMeaningDraft} from '../../../apps/web/src/experience/intake/manualMeaning';
import {meaningCorrectionPayload} from '../../../apps/web/src/experience/personalMeaningJourney/meaningCorrection';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {assertPersonalSemanticWorldRecords} from '../../../apps/web/src/experience/personalMeaningJourney/authority';
import {buildPersonalMeaningLearningSources,resolvePinnedPersonalMeaningLearningSource} from '../../../apps/web/src/experience/personalMeaningJourney/learningSource';
import {mergeLibraryReplicas,partitionLibraryReplicaConflicts,finalizeLibraryReplicaConflictChoice,planLibraryReplicaApply} from '../../../apps/web/src/data/library/replication/libraryReplica';
import type {ReplicaEntry} from '../../../apps/web/src/data/library/replication/domainReplica';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {semanticRecords,memorySemanticReader} from '../support/semanticWorldRecordFixture.mts';
import type {JourneyState,MeaningJourneyRecord} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {assertMeaningConflictHistory,decideMeaningConflict} from '../../../apps/web/src/experience/personalMeaningJourney/meaningConflictHistory';
import {canonicalMeaningFacts} from '../../../apps/web/src/experience/personalMeaningJourney/clarificationSource';
import {buildCloudSyncComparison} from '../../../apps/web/src/data/library/cloudSyncComparison';
import {decideContextConflict,mergeContextHeads} from '../../../apps/web/src/experience/personalMeaningJourney/contextConflictHistory';
import {assertPersonalSemanticWorldTransition} from '../../../apps/web/src/experience/personalMeaningJourney/authority';

const entries=(state:JourneyState):ReplicaEntry[]=>[...semanticRecords(state)].map(row=>({...row,value:encodeBackupValue(row.value)}));
const meaning=(rows:ReplicaEntry[])=>hydrateMeaningContexts(decodeBackupValue(rows.find(row=>row.table==='semanticMeanings')!.value),key=>{const row=rows.find(row=>row.table==='semanticContexts'&&row.key===key);return row?decodeBackupValue(row.value):undefined;});
const admit=(rows:ReplicaEntry[])=>assertPersonalSemanticWorldRecords(memorySemanticReader(rows.map(row=>({...row,table:row.table as any,value:decodeBackupValue(row.value)}))));
const modules=(repository:MemoryJourneyRepository)=>createJourneyModules({repository,clock:createSeededClock('2026-10-09T04:00:00Z'),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});

test('Context decisions adopt unchanged and exact rejected peers, retain new selected edits, and do not swallow later rejected edits',async()=>{
 const repository=new MemoryJourneyRepository(),gateway=modules(repository).personalMeaningJourney;
 const created=await gateway.saveContext({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'One independently saved Context.'}]});
 const initial=await repository.load(),root=initial.contexts.anchors[0]!,r2a=crypto.randomUUID(),r2b=crypto.randomUUID(),r3a=crypto.randomUUID(),r3b=crypto.randomUUID();
 const versions=new Map([[created.revisionId,{personalSemanticAnchorId:created.contextId,parentRevisionId:null}],[r2a,{personalSemanticAnchorId:created.contextId,parentRevisionId:created.revisionId}],[r2b,{personalSemanticAnchorId:created.contextId,parentRevisionId:created.revisionId}],[r3a,{personalSemanticAnchorId:created.contextId,parentRevisionId:r2a}],[r3b,{personalSemanticAnchorId:created.contextId,parentRevisionId:r2b}]]);
 const a={...root,currentRevision:2,currentRevisionId:r2a},b={...root,currentRevision:2,currentRevisionId:r2b};
 const decided=decideContextConflict(a,b,a,crypto.randomUUID(),'2026-10-09T04:01:00Z',versions);
 for(const old of [root,a,b])expect(mergeContextHeads(root,old,decided,versions)).toEqual({ok:true,value:decided});
 const selectedEdit={...a,currentRevision:3,currentRevisionId:r3a};expect(mergeContextHeads(root,selectedEdit,decided,versions)).toEqual({ok:true,value:{...selectedEdit,conflictHistory:decided.conflictHistory}});
 const rejectedEdit={...b,currentRevision:3,currentRevisionId:r3b};expect(mergeContextHeads(root,rejectedEdit,decided,versions)).toEqual({ok:false});
 const forged=structuredClone(initial),revision=initial.contexts.anchorRevisions[0]!;
 forged.contexts.anchorRevisions.push({...revision,personalSemanticAnchorRevisionId:r2a,revision:2},{...revision,personalSemanticAnchorRevisionId:r2b,revision:2},{...revision,personalSemanticAnchorRevisionId:r3a,revision:3});
 forged.contexts.anchorRevisionParents={...forged.contexts.anchorRevisionParents,[r2a]:created.revisionId,[r2b]:created.revisionId,[r3a]:r2a};forged.contexts.anchors[0]={...root,currentRevision:3,currentRevisionId:r3a};
 const changed=structuredClone(forged);changed.contexts.anchorRevisionParents[r3a]=r2b;
 expect(()=>assertPersonalSemanticWorldTransition(forged,changed)).toThrow('父版本');
});

test('independent Context save and two unconfirmed Meanings share one canonical body without accepting a Sense',async()=>{
 const repository=new MemoryJourneyRepository(),gateway=modules(repository).personalMeaningJourney,request={operationId:crypto.randomUUID(),blocks:[{kind:'text' as const,bodyText:'It is raining; I ask Jo to borrow an umbrella.'}]};
 const context=await gateway.saveContext(request);expect(await gateway.saveContext(request)).toEqual({...context,replayed:true});
 const first=await gateway.createMeaningDraft({operationId:crypto.randomUUID(),contextReferences:[{contextId:context.contextId,revisionId:context.revisionId}],learnerIntentNote:'借用后归还'});
 const second=await gateway.createMeaningDraft({operationId:crypto.randomUUID(),contextReferences:[{contextId:context.contextId,revisionId:context.revisionId}],learnerIntentNote:'礼貌请求'});
 const state=await repository.load();expect(first.personalMeaningId).not.toBe(second.personalMeaningId);expect(state.contexts.anchors).toHaveLength(1);expect(state.contexts.anchorRevisions).toHaveLength(1);expect(state.registry.senses).toEqual([]);
 for(const meaning of state.meanings){expect(meaning.semanticAcceptances).toEqual([]);expect(meaning.alignments).toEqual([]);expect(meaning.bindingConfirmations).toEqual([]);expect(meaning.personalSemanticAnchorRevisions[0]!.personalSemanticAnchorRevisionId).toBe(context.revisionId);}
 const durable=[...semanticRecords(state)],serialized=JSON.stringify(durable.filter(row=>row.table==='semanticMeanings'));expect(serialized).not.toContain(request.blocks[0]!.bodyText);
 admit(entries(state));
 const tampered=durable.map(row=>row.table==='semanticMeanings'?{...row,value:{...(row.value as object),contextSnapshot:request.blocks}}:row);expect(()=>assertPersonalSemanticWorldRecords(memorySemanticReader(tampered))).toThrow('semantic_context_invalid');
});
async function correct(base:JourneyState,text:string,senseEdit:'different_meaning'|'wording'='different_meaning'){
 const repository=new MemoryJourneyRepository();await repository.commit({before:await repository.load(),after:structuredClone(base)});
 const api=modules(repository),record=base.meanings[0]!,alignment=record.alignments.at(-1)!,operationId=crypto.randomUUID();
 const payload=meaningCorrectionPayload(record,base.registry,alignment.personalMeaningAlignmentId);
 const request={operationId,senseEdit,personalMeaningId:record.personalMeaning.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:await api.personalMeaningJourney.captureClarificationSource('personal_meaning',record.personalMeaning.personalMeaningId),payload:{...payload,operationId,sense:{...payload.sense!,senseKey:crypto.randomUUID(),semanticSpec:{...payload.sense!.semanticSpec,coreMeaningFocus:text}},acceptance:{mode:'learner_direct' as const}}};
 await api.personalMeaningJourney.correctPersonalMeaning(request);return {state:await repository.load(),request};
}
async function fork(){
 const repository=new MemoryJourneyRepository();await modules(repository).semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow my umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂借物品，随后归还。',usage:'借朋友的雨伞。'}));
 const base=await repository.load(),a=await correct(base,'A: 暂借雨伞，明天归还。'),b=await correct(base,'B: 暂借雨伞，周末归还。');
 return {base,a,b};
}
function choose(base:ReplicaEntry[],local:ReplicaEntry[],remote:ReplicaEntry[],side:'local'|'remote'){
 const merged=mergeLibraryReplicas({base,local,remote});expect(merged.conflicts).toHaveLength(1);
 const partition=partitionLibraryReplicaConflicts({base,local,remote,merged:merged.entries,conflicts:merged.conflicts});
 return finalizeLibraryReplicaConflictChoice(side==='local'?partition.local:partition.upload,merged.entries,{base,local,remote,conflicts:merged.conflicts,decision:{id:crypto.randomUUID(),createdAt:'2026-10-09T04:00:10Z'}});
}

test('one explicit correction decision converges the unmodified peer and preserves both histories and old learning pins',async()=>{
 const {base,a,b}=await fork(),prior=entries(base),left=entries(a.state),right=entries(b.state);
 const chosen=choose(prior,right,left,'local');admit(chosen);
 const received=mergeLibraryReplicas({base:left,local:left,remote:chosen});expect(received.conflicts).toEqual([]);admit(received.entries);
 expect(planLibraryReplicaApply(left,received.entries).deletes).toEqual([]);
 const current=meaning(received.entries);expect(current.conflictHistory!.branches).toHaveLength(3);
 for(const branch of [a.state,b.state]){
  const snapshot=branch.meanings[0]!;expect(current.conflictHistory!.branches.map(row=>canonicalMeaningFacts(row.record))).toContainEqual(canonicalMeaningFacts(snapshot));
  for(const receipt of branch.commandReceipts)expect(received.entries.some(row=>row.table==='semanticReceipts'&&row.key===receipt.operationId)).toBe(true);
  const source=buildPersonalMeaningLearningSources(snapshot,branch.registry).at(-1)!;
  const registry={...base.registry};for(const key of Object.keys(registry) as Array<keyof typeof registry>)registry[key]=received.entries.filter(row=>row.table==='semanticRegistry'&&decodeBackupValue(row.value).kind===key).map(row=>decodeBackupValue(row.value).value) as any;
  expect(resolvePinnedPersonalMeaningLearningSource(current,registry,source.reference,source.context.personalSemanticAnchorRevisionIds)?.reference).toEqual(source.reference);
 }
 expect(mergeLibraryReplicas({base:chosen,local:chosen,remote:received.entries}).conflicts).toEqual([]);
});

test('a later local edit and opposite concurrent decisions are not silently covered by an old choice',async()=>{
 const {base,a,b}=await fork(),prior=entries(base),left=entries(a.state),right=entries(b.state),chosen=choose(prior,right,left,'local');
 const later=await correct(a.state,'A: 我又明确改变了意思。');
 expect(mergeLibraryReplicas({base:left,local:entries(later.state),remote:chosen}).conflicts).not.toEqual([]);
 const nextInput={base:chosen,local:chosen,remote:entries(later.state)},nextMerge=mergeLibraryReplicas(nextInput),partition=partitionLibraryReplicaConflicts({...nextInput,merged:nextMerge.entries,conflicts:nextMerge.conflicts});
 const key=(row:ReplicaEntry)=>JSON.stringify([row.table,row.key]);
 const comparison=buildCloudSyncComparison(nextMerge.conflicts,{base:new Map(chosen.map(row=>[key(row),row])),local:new Map(chosen.map(row=>[key(row),row])),remote:new Map(nextInput.remote.map(row=>[key(row),row]))});expect(comparison.records).toHaveLength(1);
 const nextChoice=finalizeLibraryReplicaConflictChoice(partition.upload,nextMerge.entries,{...nextInput,conflicts:nextMerge.conflicts,decision:{id:crypto.randomUUID(),createdAt:'2026-10-09T04:00:20Z'}});admit(nextChoice);
 expect(meaning(nextChoice).conflictHistory!.decisions).toHaveLength(2);
 expect(mergeLibraryReplicas({base:chosen,local:chosen,remote:nextChoice}).conflicts).toEqual([]);
 const other=choose(prior,left,right,'local');
 expect(mergeLibraryReplicas({base:prior,local:chosen,remote:other}).conflicts).not.toEqual([]);
 const resolved=decideMeaningConflict(meaning(chosen),meaning(other),meaning(chosen));expect(()=>assertMeaningConflictHistory(resolved)).not.toThrow();
});

test('archive tampering, dropped decisions and orphan correction receipts remain rejected',async()=>{
 const {base,a,b}=await fork(),chosen=choose(entries(base),entries(b.state),entries(a.state),'local'),record=meaning(chosen);
 const corrupt=structuredClone(record);corrupt.conflictHistory!.branches[0]!.record.personalMeaningRevisions[0]!.displayLabel='forged';
 expect(()=>assertMeaningConflictHistory(corrupt)).toThrow();
 const dropped={...record};delete dropped.conflictHistory;
 const rows=chosen.map(row=>row.table==='semanticMeanings'?{...row,value:encodeBackupValue(dropped)}:row);
 expect(()=>admit(rows)).toThrow();expect(mergeLibraryReplicas({base:chosen,local:chosen,remote:rows}).conflicts).not.toEqual([]);
 const missing=chosen.filter(row=>row.key!==a.request.operationId);expect(()=>admit(missing)).toThrow();
});

test('a deleted branch can be explicitly selected without erasing the concurrent edit',async()=>{
 const {base,a}=await fork(),repository=new MemoryJourneyRepository();await repository.commit({before:await repository.load(),after:structuredClone(base)});
 await createJourneyModules({repository,clock:createSeededClock('2026-10-09T04:01:00Z')}).personalMeaningJourney.changeMeaningLifecycle({operationId:crypto.randomUUID(),personalMeaningId:base.meanings[0]!.personalMeaning.personalMeaningId,expectedRevision:base.meanings[0]!.personalMeaning.currentRevision,action:'delete'});
 const deleted=await repository.load(),selected=choose(entries(base),entries(deleted),entries(a.state),'local');
 admit(selected);expect(meaning(selected).personalMeaning.status).toBe('deleted');
 expect(mergeLibraryReplicas({base:entries(a.state),local:entries(a.state),remote:selected}).conflicts).toEqual([]);
});

test('a conflict choice cannot authorize a rewritten base identity or divergent external version body',async()=>{
 const {base,a,b}=await fork(),original=base.meanings[0]!,rewritten=structuredClone(b.state.meanings[0]!);
 rewritten.personalSemanticAnchors[0]!.createdAt='2026-10-01T00:00:00Z';
 expect(()=>decideMeaningConflict(a.state.meanings[0]!,rewritten,rewritten,crypto.randomUUID(),'2026-10-09T04:01:00Z',original)).toThrow();
 const corrupt=structuredClone(b.state);corrupt.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus='A different body under the same immutable version ID.';
 const input={base:entries(base),local:entries(a.state),remote:entries(corrupt)},merged=mergeLibraryReplicas(input),partition=partitionLibraryReplicaConflicts({...input,merged:merged.entries,conflicts:merged.conflicts});
 expect(()=>finalizeLibraryReplicaConflictChoice(partition.upload,merged.entries,{...input,conflicts:merged.conflicts,decision:{id:crypto.randomUUID(),createdAt:'2026-10-09T04:01:00Z'}})).toThrow('library_sync_conflict_unsupported');
});

test('a wording fork decision also converges stable Sense and Binding heads while retaining both versions',async()=>{
 const repository=new MemoryJourneyRepository();await modules(repository).semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow my umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂借物品，随后归还。'}));
 const base=await repository.load(),a=await correct(base,'A: 暂时借用并归还。','wording'),b=await correct(base,'B: 暂借，之后归还。','wording'),prior=entries(base),left=entries(a.state),right=entries(b.state);
 const merged=mergeLibraryReplicas({base:prior,local:right,remote:left}),partition=partitionLibraryReplicaConflicts({base:prior,local:right,remote:left,merged:merged.entries,conflicts:merged.conflicts});
 const chosen=finalizeLibraryReplicaConflictChoice(partition.local,merged.entries,{base:prior,local:right,remote:left,conflicts:merged.conflicts,decision:{id:crypto.randomUUID(),createdAt:'2026-10-09T04:00:10Z'}});admit(chosen);
 const received=mergeLibraryReplicas({base:left,local:left,remote:chosen});expect(received.conflicts).toEqual([]);admit(received.entries);
 for(const row of ['senses','bindings'] as const){const original=base.registry[row][0]!,expected=b.state.registry[row][0]!;expect(expected).toMatchObject(row==='senses'?{senseId:(original as any).senseId}:{senseExpressionBindingId:(original as any).senseExpressionBindingId});expect(received.entries.find(entry=>entry.table==='semanticRegistry'&&entry.key.startsWith(row+':'))?.value).toEqual(encodeBackupValue({kind:row,ordinal:0,value:expected}));}
 expect(received.entries.filter(row=>row.key.startsWith('senseVersions:'))).toHaveLength(3);expect(received.entries.filter(row=>row.key.startsWith('bindingVersions:'))).toHaveLength(3);
 const later=await correct(a.state,'A: 暂借之后计划归还。','wording');expect(mergeLibraryReplicas({base:left,local:entries(later.state),remote:chosen}).conflicts.length).toBeGreaterThan(0);
});

test('a decision cannot use the first of two binding confirmations for the same active basis as a unique pin',async()=>{
 const repository=new MemoryJourneyRepository();await modules(repository).semanticIntake.submit(manualMeaningPayload({...newManualMeaningDraft(),context:'She asked to borrow my umbrella.',occurrence:'borrow',languageTag:'en',meaning:'暂借物品，随后归还。'}));
 const base=await repository.load(),a=await correct(base,'A: 暂时借用并归还。','wording'),b=await correct(base,'B: 暂借，之后归还。','wording');
 const record=b.state.meanings[0]!,confirmation=record.bindingConfirmations.at(-1)!,priorVersion=b.state.registry.bindingVersions.find(row=>row.bindingVersionId===confirmation.bindingVersionId)!;
 const anotherVersion={...priorVersion,bindingVersionId:crypto.randomUUID(),versionNumber:priorVersion.versionNumber+1,parentBindingVersionId:priorVersion.bindingVersionId,semanticCoverage:'overlapping' as const};
 b.state.registry.bindingVersions.push(anotherVersion);record.bindingConfirmations.push({...confirmation,expressionBindingConfirmationId:crypto.randomUUID(),operationId:crypto.randomUUID(),bindingVersionId:anotherVersion.bindingVersionId});
 const prior=entries(base),left=entries(a.state),right=entries(b.state);admit(right);
 const merged=mergeLibraryReplicas({base:prior,local:right,remote:left}),partition=partitionLibraryReplicaConflicts({base:prior,local:right,remote:left,merged:merged.entries,conflicts:merged.conflicts});
 const chosen=finalizeLibraryReplicaConflictChoice(partition.local,merged.entries,{base:prior,local:right,remote:left,conflicts:merged.conflicts,decision:{id:crypto.randomUUID(),createdAt:'2026-10-09T04:00:10Z'}});
 const received=mergeLibraryReplicas({base:left,local:left,remote:chosen});
 expect(received.conflicts).toContain(JSON.stringify(['semanticRegistry',`bindings:${priorVersion.senseExpressionBindingId}`]));
});
