import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test,vi} from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {openLibrary,command,writeLibraryCache,readLibrary,libraryTables} from '../../../apps/web/src/data/library/store.ts';
import type {BackupRows} from '../../../apps/web/src/data/library/backupValidation';
import {runBaselineMaterial,runMaterialDigest,validateRunMaterialPins} from '../../../apps/web/src/learning/runtime/runMaterialPins';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {validateInstalledLearningContent} from '../../../apps/web/src/contentSupply/portable/installedLearningContent.ts';
import {
  confirmLearningQuantity,
  enrollPackage,
  finishLearning,
  readLearning,
  selectLocalLearningPolicy,
  type LocalLearningRun,
  type LocalLearningTarget,
} from '../../../apps/web/src/data/library/learning.ts';
import {startLearning,actLearning} from '../support/learningRunFixture';
import { assuranceView, localAssuranceState } from '../../../apps/web/src/learning/protocols/assurance.ts';
import {
  fourStageContent,
  fourStageQueue,
} from '../../../apps/web/src/learning/protocols/fourStage.ts';
import {canonicalJsonDigest,lightweightSchedulingPolicy,initializeRetentionMemory,scheduleMemoryOutcome,sha256,stableUuid} from '@sensa/learning-kernel';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {localExecutableTargetForParticipant} from '../../../apps/web/src/learning/runtime/localCurriculum.ts';

Object.assign(globalThis, {
  indexedDB,
  location:new URL('http://runtime.fixture.invalid/'),
  window: new EventTarget(),
  BroadcastChannel: undefined,
});

const id = () => crypto.randomUUID();
const languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const schedulerTarget=id(),schedulerStart=new Date('2026-09-01T00:00:00.000Z');
const initialized=initializeRetentionMemory(schedulerTarget,lightweightSchedulingPolicy,schedulerStart);
const beforeDue=new Date(schedulerStart.getTime()+60_000);
const memory={retentionTargetId:schedulerTarget,revision:initialized.resultingMemoryRevision,dueAt:initialized.schedule.dueAt,schedule:{...initialized.schedule,cardId:schedulerTarget}};
test('independent Relearning cannot impersonate an early due Review',()=>{
assert.throws(()=>scheduleMemoryOutcome({memory,trigger:{kind:'due_review',memoryRevision:1,dueAt:initialized.schedule.dueAt},outcome:{grade:'good'},occurredAt:beforeDue},lightweightSchedulingPolicy),'a due Review cannot run before its due trigger');
const independent= scheduleMemoryOutcome({memory,trigger:{kind:'independent_relearning_evaluation',memoryRevision:1,evaluationId:id()},outcome:{grade:'good'},occurredAt:beforeDue},lightweightSchedulingPolicy);
assert.equal(independent.resultingMemoryRevision,2,'an explicitly eligible independent Relearning evaluation advances Memory without impersonating a due Review');
});
await openLibrary();
await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{
  tx.put('meta','service-owner',{subject:id()});
});

const assurancePortable=async(word:'borrow'|'lend',version=1)=>{
  const release=JSON.parse(await readFile(
    new URL('../../../apps/web/src/learning/content/releases/golden-learning-release-v1.json',import.meta.url),
    'utf8',
  ));
  const audio:Record<string,string>={};
  for(const media of release.media){
    const bytes=new TextEncoder().encode(`synthetic-assurance-audio:${media.mediaKey}`);
    const digest=sha256(bytes);
    media.sha256='sha256:'+digest;
    media.uri='content://sha256/'+digest;
    audio[media.mediaKey]=`data:audio/mpeg;base64,${Buffer.from(bytes).toString('base64')}`;
  }
  release.release={
    ...release.release,
    releaseKey:`sensa.assurance-test.${word}`,
    sourceDigest:'sha256:'+canonicalJsonDigest({
      packages:release.packages,
      media:release.media,
      lexemes:release.lexemes,
      relations:release.relations,
    }),
  };
  assert.deepEqual(validateRuntimeLearningRelease(release).issues,[]);
  const definition=release.packages.find((candidate:any)=>candidate.identity.lexemeKey===word)!;
  const lexeme=release.lexemes.find((candidate:any)=>candidate.lexemeKey===word)!;
  const fixture=portablePackageFixture({
    packageId:stableUuid(`sensa:${word}-runtime-portable`),
    version,
    expression:lexeme.lemma,
    meaning:definition.sense.guideLabelL1,
    scene:definition.experience.recap.bodyL1,
  });
  let installed=await contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes:fixture.bytes,
    expectedArchiveDigest:fixture.archiveDigest,
  });
  const content=structuredClone(installed.content);
  content.entries[0]!.assurancePackageKey=definition.identity.packageKey;
  content.assurance={release,audio};
  installed={...installed,content:validateInstalledLearningContent(content)};
  await writeLibraryCache(async tx=>tx.put('packageCache',installed.key,installed));
  return installed;
};

vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-09-11T04:00:00.000Z');
const pack=await assurancePortable('borrow');
const fourStagePack=await assurancePortable('lend');
const targetIds=[
  ...await enrollPackage(id(),pack.key,languageContext),
  ...await enrollPackage(id(),fourStagePack.key,languageContext),
];
vi.useRealTimers();
assert.equal(targetIds.length, 2);
assert((await readLearning()).targets.every(
  candidate=>candidate.curriculumMemberships[0]?.assurancePackageKey,
));
await confirmLearningQuantity(id(),languageContext,20);

async function act(run:LocalLearningRun, response:unknown, at:string) {
  return actLearning(id(),run.id,run.revision,{kind:'assurance',response} as any,at);
}

async function driveAssurance(
  initial:LocalLearningRun,
  at:string,
  failFirstAssessment=false,
) {
  let run=initial,failed=false,steps=0;
  while(!run.completedAt&&steps++<100){
    const view=assuranceView(run,pack),state=localAssuranceState(run);
    if(!view)throw new Error('missing assurance step');
    if(view.introduction){
      run=await act(run,state.revealed?{kind:'continue'}:{kind:'reveal'},at);
      continue;
    }
    if(state.feedback){run=await act(run,{kind:'continue'},at);continue;}
    const resource=view.resource!;
    if(failFirstAssessment&&!failed){failed=true;run=await act(run,{kind:'skip'},at);continue;}
    if(resource.kind==='meaning_to_form_recall'){
      run=await act(run,{kind:'try_recall',value:resource.acceptedForms[0]},at);
    }else{
      const options=resource.kind==='novel_context_transfer'?resource.scenario.options:resource.options;
      const correct=options.find(option=>'isCorrect' in option&&option.isCorrect);
      if(!correct)throw new Error('missing correct option');
      run=await act(run,{kind:'answer',value:correct.id},at);
    }
  }
  if(!run.completedAt)throw new Error('assurance runtime did not complete');
  return run;
}

const assuranceTargetId=targetIds[0]!;
await selectLocalLearningPolicy(id(),assuranceTargetId,languageContext,'high_assurance');
const fourStageTargetId=targetIds[1]!;
await selectLocalLearningPolicy(id(),fourStageTargetId,languageContext,'interleaved_four_stage');
let run=await startLearning(id(),assuranceTargetId,languageContext,20,'2026-09-11T04:00:00.000Z');
let state!:Awaited<ReturnType<typeof readLearning>>;
let target!:Awaited<ReturnType<typeof readLearning>>['targets'][number];
test('assurance initial learning creates formal evidence and a scheduling handoff',async()=>{
run=await driveAssurance(run,'2026-09-11T04:00:00.000Z');
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===assuranceTargetId)!;
assert.equal(target.memoryRevision,1);
assert(state.events.some(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='initial_learning_completion'));
const assuranceEvaluations=state.events.filter(event=>event.runId===run.id&&event.detail.formalEvaluation).map(event=>event.detail.formalEvaluation!);
assert(assuranceEvaluations.length>0,'assessment actions materialize the formal evaluation pipeline');
for(const facts of assuranceEvaluations){
 assert.equal(facts.action.protocolStepInstanceId,facts.step.protocolStepInstanceId);
 assert.equal(facts.attempt.actionId,facts.action.actionId);
 assert.equal(facts.observation.attemptId,facts.attempt.attemptId);
 assert.equal(facts.transitionDecision.observationId,facts.observation.observationId);
 assert.deepEqual(facts.observation.evidenceIds,facts.evidence.map(evidence=>evidence.learningEvidenceId));
}
const assuranceEvidenceIds=assuranceEvaluations.flatMap(facts=>facts.evidence.map(evidence=>evidence.learningEvidenceId));
assert(assuranceEvidenceIds.length>0,'independent structured assessments create explicit Evidence facts');
const assuranceCompletion=state.events.find(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='initial_learning_completion')!.detail.transition.retention!;
if(assuranceCompletion.kind!=='initial_learning_completion')throw new Error('missing assurance completion');
assert.deepEqual(new Set(assuranceCompletion.handoff.evidenceIds),new Set(assuranceEvidenceIds),'Scheduling Handoff references accumulated Evidence instead of a UI claim');
});

test('cacheless Structured restore still validates source readiness on frozen Run material, without claiming full Protocol replay',async()=>{
 const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
 const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
 rows.packageCache=[];rows.operations=[];validateBackupRows(rows);
 for(const mutation of ['before_admission','after_start'] as const){
  const changed=structuredClone(rows),saved=changed.learningRuns.find(row=>row.key===run.id)!.value as LocalLearningRun,pin=saved.participants[saved.targetId]!;
  const previous=pin.material,material=structuredClone(runBaselineMaterial(pin));
  material.snapshot.provenance.sourceReadyAt=new Date(Date.parse(saved.startedAt)+(mutation==='after_start'?1:-1)).toISOString();
  const reference=runMaterialDigest(material);delete pin.materializations[previous];pin.materializations[reference]=material;pin.material=reference;
  for(const step of pin.presentationOrder)pin.presentedMaterials[step]=reference;
  for(const row of changed.learningEvents){const event=row.value;if(event.runId===saved.id&&event.detail.nextPresentation)event.detail.nextPresentation.material=reference;}
  assert.doesNotThrow(()=>validateRunMaterialPins(pin),'correctly rehashed references alone do not establish source readiness');
  assert.throws(()=>validateBackupRows(changed),'Structured cache absence cannot bypass the source admission clock');
 }
});

let assuranceReviewRevision: number;
test('assurance due Review emits one memory outcome and schedules Relearning',async()=>{
run=await startLearning(id(),assuranceTargetId,languageContext,20,target.memory!.dueAt.toISOString());
assert.equal(run.purpose,'retention_review');
run=await driveAssurance(run,target.memory!.dueAt.toISOString(),true);
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===assuranceTargetId)!;
assert.equal(target.memoryRevision,2);
assert(target.relearnAt);
assert(target.relearningState);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='memory_outcome').length,1);
assuranceReviewRevision=target.memoryRevision;
});

test('assurance Relearning clears its state without updating FSRS',async()=>{
run=await startLearning(id(),assuranceTargetId,languageContext,20,target.relearnAt!);
assert.equal(run.purpose,'relearning');
run=await driveAssurance(run,target.relearnAt!);
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===assuranceTargetId)!;
assert.equal(target.memoryRevision,assuranceReviewRevision,'Relearning must not update FSRS');
assert.equal(target.relearnAt,null);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='memory_outcome').length,0);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='relearning_completion').length,1);
});


async function driveFourStage(initial:LocalLearningRun,at:string,reviewAnswer:'known'|'forgotten'='known'){
  let current=initial,steps=0;
  while(!current.completedAt&&steps++<100){
    const queue=fourStageQueue(current),session=queue.getCurrentSession();
    if(!session)throw new Error('missing four-stage step');
    let response:unknown;
    if(session.phase==='feedback')response={kind:'continue'};
    else if('presentation' in session){
      if(session.presentation==='meaning_choice'||session.presentation==='sound_choice'){
        const currentTarget=(await readLearning()).targets.find(item=>item.id===session.targetId)!;
        const content=fourStageContent(localExecutableTargetForParticipant(currentTarget,current.participants[currentTarget.id]!),fourStagePack);
        response={kind:'choice',optionId:content.recognitionAssessment.options.find(option=>option.isCorrect)!.id};
      }else response={kind:'self_report',known:true};
    }else response={kind:'review',answer:session.mode==='review'?reviewAnswer:'known'};
    current=await actLearning(id(),current.id,current.revision,{kind:'protocol',response},at);
  }
  if(!current.completedAt)throw new Error('four-stage runtime did not complete');
  return current;
}

let fourStageReviewRevision: number;
test('four-stage initial learning and due Review create distinct retention facts',async()=>{
run=await startLearning(id(),fourStageTargetId,languageContext,20,'2026-09-12T04:00:00.000Z');
run=await driveFourStage(run,'2026-09-12T04:00:00.000Z');
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===fourStageTargetId)!;
assert.equal(target.memoryRevision,1);
run=await startLearning(id(),fourStageTargetId,languageContext,20,target.memory!.dueAt.toISOString());
assert.equal(run.purpose,'retention_review');
run=await driveFourStage(run,target.memory!.dueAt.toISOString(),'forgotten');
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===fourStageTargetId)!;
assert.equal(target.memoryRevision,2);
assert(target.relearnAt);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='memory_outcome').length,1);
fourStageReviewRevision=target.memoryRevision;
});

test('four-stage Relearning completes without another FSRS update',async()=>{
run=await startLearning(id(),fourStageTargetId,languageContext,20,target.relearnAt!);
assert.equal(run.purpose,'relearning');
run=await driveFourStage(run,target.relearnAt!);
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===fourStageTargetId)!;
assert.equal(target.memoryRevision,fourStageReviewRevision,'Four-stage Relearning must not update FSRS');
assert.equal(target.relearnAt,null);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='memory_outcome').length,0);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='relearning_completion').length,1);
});

test('cacheless Structured refresh cannot use a material snapshot or source that becomes Ready after its actual presentation event',async()=>{
 const base=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(base);
 try{
  const review=await startLearning(id(),assuranceTargetId,languageContext,20);
  vi.setSystemTime(base+1000);const updated=await assurancePortable('borrow',2);
  await enrollPackage(id(),updated.key,languageContext);
  const {validateBackupRows}=await import('../../../apps/web/src/data/library/backupValidation');
  const rows=await readLibrary(async tx=>Object.fromEntries(await Promise.all(libraryTables.map(async table=>[table,await tx.entries(table)])))) as BackupRows;
  rows.packageCache=[];rows.operations=[];validateBackupRows(rows);
  const saved=rows.learningRuns.find(row=>row.key===review.id)!.value as LocalLearningRun;
  assert(saved.lifecycleEvents.some(event=>event.kind==='current_step_material_refreshed'),'actual compatible Portable admission must refresh the unfinished Structured Step');
  for(const mutation of ['snapshot_after_event','source_after_event'] as const){
   const changed=structuredClone(rows),run=changed.learningRuns.find(row=>row.key===review.id)!.value as LocalLearningRun;
   const event=run.lifecycleEvents.find(event=>event.kind==='current_step_material_refreshed')!;
   if(event.kind!=='current_step_material_refreshed')throw Error('Missing refresh');
   const pin=run.participants[event.targetId]!,previous=pin.presentedMaterials[event.stepId]!,material=structuredClone(pin.materializations[previous]!);
   const future=new Date(Date.parse(event.at)+1).toISOString();material.snapshot.createdAt=future;
   if(mutation==='source_after_event'){
    material.snapshot.provenance.sourceReadyAt=future;
    const target=changed.learningTargets.find(row=>row.key===event.targetId)!.value as LocalLearningTarget;
    const source=target.curriculumMemberships.find(member=>member.packageKey===updated.key)!;
    Object.assign(source,{createdAt:future,updatedAt:future});source.material.snapshot.provenance.sourceReadyAt=future;
    Object.assign(source.material.snapshot,{createdAt:future});
   }
   const reference=runMaterialDigest(material);delete pin.materializations[previous];pin.materializations[reference]=material;pin.presentedMaterials[event.stepId]=reference;
   assert.doesNotThrow(()=>validateRunMaterialPins(pin),'all content hashes remain exact');
   assert.throws(()=>validateBackupRows(changed),'the presentation event cannot precede the material/source it actually used');
  }
 }finally{vi.useRealTimers();}
});
