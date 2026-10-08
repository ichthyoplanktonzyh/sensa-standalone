/** Full domain validation via arrays and indexed SQLite/Wasm candidate records.
 * No OPFS, sync application, browser latency or paid provider claims. */
import {expect,test} from 'vitest';
import {MemoryJourneyRepository,journeyStateFromRows,semanticJourneyTables} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {assertPersonalSemanticWorldRecords} from '../../../apps/web/src/experience/personalMeaningJourney/authority';
import {meaningCorrectionPayload} from '../../../apps/web/src/experience/personalMeaningJourney/meaningCorrection';
import {isAlignmentActive} from '../../../apps/web/src/experience/personalMeaningJourney/alignmentLifecycle';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import {semanticLookupPayload,syntheticSemanticWorld,deleteFirstMeaning} from '../support/semanticLookupFixtures';
import {semanticRecords,memorySemanticReader,sqliteSemanticCandidate,type SemanticCandidateRecord} from '../support/semanticWorldRecordFixture.mts';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';

const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock('2026-10-03T00:00:00Z')});
await modules.semanticIntake.submit(semanticLookupPayload());
const valid=syntheticSemanticWorld(await repository.load(),2),deleted=deleteFirstMeaning(valid);
await modules.semanticIntake.submit({...semanticLookupPayload(),sense:null});
const inbox={...valid,inboxItems:(await repository.load()).inboxItems};
const correctionRepository=new MemoryJourneyRepository(),correctionModules=createJourneyModules({repository:correctionRepository,clock:createSeededClock('2026-10-03T00:00:00Z')});
await correctionModules.semanticIntake.submit(semanticLookupPayload());
for(let index=0;index<2;index++){
 const state=await correctionRepository.load(),meaning=state.meanings[0]!,alignment=meaning.alignments.find(row=>isAlignmentActive(meaning,row))!,operationId=crypto.randomUUID();
 const payload=meaningCorrectionPayload(meaning,state.registry,alignment.personalMeaningAlignmentId);
 await correctionModules.personalMeaningJourney.correctPersonalMeaning({operationId,personalMeaningId:meaning.personalMeaning.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:await correctionRepository.captureSource('personal_meaning',meaning.personalMeaning.personalMeaningId),payload:{...payload,operationId,acceptance:{mode:'learner_direct'},sense:{...payload.sense!,senseKey:null,wordingSource:'learner_authored',semanticSpec:{...payload.sense!.semanticSpec,coreMeaningFocus:`学习者纠正后的理解 ${index}。`}}}});
}
const corrected=await correctionRepository.load();
const oldComplete=(records:SemanticCandidateRecord[])=>journeyStateFromRows(Object.fromEntries(semanticJourneyTables.map(table=>[table,records.filter(row=>row.table===table)])) as unknown as Parameters<typeof journeyStateFromRows>[0]);
const accepted=(work:()=>unknown)=>{try{work();return true;}catch{return false;}};
const corrupt=(state:JourneyState,work:(state:JourneyState)=>void)=>{const copy=structuredClone(state);work(copy);return copy;};
const cases:Array<{name:string;state:JourneyState;valid:boolean}>=[
 {name:'complete accepted World',state:valid,valid:true},
 {name:'deleted Meaning and exact lifecycle witness',state:deleted,valid:true},
 {name:'two genuine corrections of the same Meaning',state:corrected,valid:true},
 {name:'correction receipt has a different result',state:corrupt(corrected,s=>{s.commandReceipts.find(row=>row.command==='CorrectPersonalMeaning')!.result.revision=999;}),valid:false},
 {name:'incomplete capture with no forced draft',state:inbox,valid:true},
 {name:'orphan clarification draft',state:corrupt(valid,s=>{s.clarificationDrafts.push({intakeId:crypto.randomUUID(),startingPoint:'from_experience'} as JourneyState['clarificationDrafts'][number]);}),valid:false},
 {name:'missing Registry head',state:corrupt(valid,s=>{s.registry.senses[0]!.currentSenseVersionId=crypto.randomUUID();}),valid:false},
 {name:'head points to another Sense',state:corrupt(valid,s=>{s.registry.senses[0]!.currentSenseVersionId=s.registry.senseVersions[1]!.senseVersionId;}),valid:false},
 {name:'orphan version',state:corrupt(valid,s=>{s.registry.senseVersions[0]!.senseId=crypto.randomUUID();}),valid:false},
 {name:'duplicate Sense key',state:corrupt(valid,s=>{s.registry.senses[1]!.senseKey=s.registry.senses[0]!.senseKey;}),valid:false},
 {name:'duplicate version slot',state:corrupt(valid,s=>{s.registry.senseVersions.push({...s.registry.senseVersions[0]!,senseVersionId:crypto.randomUUID()});}),valid:false},
 {name:'BindingVersion crosses another Expression',state:corrupt(valid,s=>{s.registry.bindingVersions[0]!.expressionVersionId=s.registry.expressionVersions[1]!.expressionVersionId;}),valid:false},
 {name:'Context locator exceeds its original text',state:corrupt(valid,s=>{s.meanings[0]!.personalSemanticAnchorRevisions[0]!.bodyText='short';}),valid:false},
 {name:'Alignment belongs to a different learner',state:corrupt(valid,s=>{s.meanings[0]!.alignments[0]!.learnerUserId=crypto.randomUUID();}),valid:false},
 {name:'one scene belongs to two Meanings',state:corrupt(valid,s=>{const sceneId=crypto.randomUUID();for(const meaning of s.meanings)meaning.personalSemanticAnchorRevisions[0]!.structuredPayload.learningScene={sceneId};}),valid:false},
 {name:'missing delete receipt',state:corrupt(deleted,s=>{s.commandReceipts=[];}),valid:false},
 {name:'orphan lifecycle receipt',state:corrupt(deleted,s=>{s.commandReceipts.push({...s.commandReceipts[0]!,operationId:crypto.randomUUID()});}),valid:false},
 {name:'orphan correction receipt',state:corrupt(valid,s=>{s.commandReceipts.push({operationId:crypto.randomUUID(),command:'CorrectPersonalMeaning',requestDigest:'d'.repeat(64),result:{personalMeaningId:s.meanings[0]!.personalMeaning.personalMeaningId}});}),valid:false},
];
for(const sample of cases)test(`complete and indexed candidate validation agree: ${sample.name}`,async()=>{
 const records=[...semanticRecords(sample.state)],candidate=await sqliteSemanticCandidate(records);
 try{
  expect(accepted(()=>oldComplete(records))).toBe(sample.valid);
  expect(accepted(()=>assertPersonalSemanticWorldRecords(memorySemanticReader(records)))).toBe(sample.valid);
  expect(accepted(()=>assertPersonalSemanticWorldRecords(candidate.reader))).toBe(sample.valid);
  expect(candidate.metrics.largestPage).toBeLessThanOrEqual(64);
 }finally{candidate.close();}
});

test('storage identities, orphan receipts and a missing root cannot be hidden by indexed lookups',async()=>{
 const original=[...semanticRecords(valid)];
 const variants=[
  original.filter(row=>row.table!=='semanticState'),
  original.map(row=>row.table==='semanticMeanings'?{...row,key:crypto.randomUUID()}:row),
  original.map(row=>row.table==='semanticRegistry'?{...row,key:'senses:'+crypto.randomUUID()}:row),
  [...original,{table:'semanticReceipts' as const,key:crypto.randomUUID(),value:{operationId:crypto.randomUUID(),command:'fixture',result:{}}}],
 ];
 for(const records of variants){const candidate=await sqliteSemanticCandidate(records);try{expect(()=>assertPersonalSemanticWorldRecords(candidate.reader)).toThrow();}finally{candidate.close();}}
 expect(()=>assertPersonalSemanticWorldRecords(memorySemanticReader([original[0]!,original[0]!]))).toThrow();
});

test('indexed validation reads 1000 complete Meanings in bounded pages without rebuilding JourneyState',async()=>{
 const candidate=await sqliteSemanticCandidate(semanticRecords(syntheticSemanticWorld(await repository.load(),1000)));
 try{
  assertPersonalSemanticWorldRecords(candidate.reader);expect(candidate.recordCount).toBe(7001);expect(candidate.metrics.largestPage).toBe(64);
  expect(candidate.metrics.pointReads).toBeGreaterThan(1000);expect(candidate.metrics.iteratedRecords).toBe(candidate.recordCount);
 }finally{candidate.close();}
},30_000);

test('replica admission rejects a nonempty semantic world without its root but accepts a genuinely empty world',async()=>{
 Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined,location:new URL('http://semantic-replica-validation.fixture.invalid/')});
 const {validateLibraryReplica}=await import('../../../apps/web/src/data/library/replication/libraryReplicaValidation');
 const id=crypto.randomUUID(),identity={id,learnerId:crypto.randomUUID(),deviceId:id,createdAt:'2026-10-03T00:00:00.000Z',schemaVersion:2};
 const rows=[{table:'meta' as const,key:'identity',value:encodeBackupValue(identity)},...[...semanticRecords(valid)].map(row=>({...row,value:encodeBackupValue(row.value)}))];
 expect(validateLibraryReplica(rows).semanticMeanings).toHaveLength(2);
 expect(()=>validateLibraryReplica(rows.filter(row=>row.table!=='semanticState'))).toThrow('libraryBackup.errors.inconsistent');
 expect(validateLibraryReplica([rows[0]!]).semanticMeanings).toEqual([]);
});
