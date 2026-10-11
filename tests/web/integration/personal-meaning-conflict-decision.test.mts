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

const entries=(state:JourneyState):ReplicaEntry[]=>[...semanticRecords(state)].map(row=>({...row,value:encodeBackupValue(row.value)}));
const meaning=(rows:ReplicaEntry[])=>decodeBackupValue(rows.find(row=>row.table==='semanticMeanings')!.value) as MeaningJourneyRecord;
const admit=(rows:ReplicaEntry[])=>assertPersonalSemanticWorldRecords(memorySemanticReader(rows.map(row=>({...row,table:row.table as any,value:decodeBackupValue(row.value)}))));
const modules=(repository:MemoryJourneyRepository)=>createJourneyModules({repository,clock:createSeededClock('2026-10-09T04:00:00Z'),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
async function correct(base:JourneyState,text:string){
 const repository=new MemoryJourneyRepository();await repository.commit({before:await repository.load(),after:structuredClone(base)});
 const api=modules(repository),record=base.meanings[0]!,alignment=record.alignments.at(-1)!,operationId=crypto.randomUUID();
 const payload=meaningCorrectionPayload(record,base.registry,alignment.personalMeaningAlignmentId);
 const request={operationId,senseEdit:'different_meaning' as const,personalMeaningId:record.personalMeaning.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:await api.personalMeaningJourney.captureClarificationSource('personal_meaning',record.personalMeaning.personalMeaningId),payload:{...payload,operationId,sense:{...payload.sense!,senseKey:crypto.randomUUID(),semanticSpec:{...payload.sense!.semanticSpec,coreMeaningFocus:text}},acceptance:{mode:'learner_direct' as const}}};
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
  const snapshot=branch.meanings[0]!;expect(current.conflictHistory!.branches.map(row=>row.record)).toContainEqual(canonicalMeaningFacts(snapshot));
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
