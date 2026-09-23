import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import { libraryCloudPackageFixture } from '../../../scripts/support/libraryCloudPackageFixture.mts';
import { openLibrary, command } from '../../../apps/web/src/data/library/store.ts';
import { installPackage } from '../../../apps/web/src/data/library/packages.ts';
import {
  actLearning,
  confirmLearningQuantity,
  enrollPackage,
  finishLearning,
  readLearning,
  selectLocalLearningPolicy,
  startLearning,
  type LocalLearningRun,
} from '../../../apps/web/src/data/library/learning.ts';
import { assuranceView, localAssuranceState } from '../../../apps/web/src/learning/protocols/assurance.ts';
import {
  fourStageContent,
  fourStageQueue,
} from '../../../apps/web/src/learning/protocols/fourStage.ts';
import {lightweightSchedulingPolicy,initializeRetentionMemory,scheduleMemoryOutcome} from '@sensa/learning-kernel';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {localExecutableTargetForParticipant} from '../../../apps/web/src/learning/runtime/localCurriculum.ts';

Object.assign(globalThis, {
  indexedDB,
  window: new EventTarget(),
  BroadcastChannel: undefined,
});

const id = () => crypto.randomUUID();
const languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const schedulerTarget=id(),schedulerStart=new Date('2026-09-01T00:00:00.000Z');
const initialized=initializeRetentionMemory(schedulerTarget,lightweightSchedulingPolicy,schedulerStart);
const beforeDue=new Date(schedulerStart.getTime()+60_000);
const memory={retentionTargetId:schedulerTarget,revision:initialized.resultingMemoryRevision,dueAt:initialized.schedule.dueAt,schedule:{...initialized.schedule,cardId:schedulerTarget}};
await test('independent Relearning cannot impersonate an early due Review',()=>{
assert.throws(()=>scheduleMemoryOutcome({memory,trigger:{kind:'due_review',memoryRevision:1,dueAt:initialized.schedule.dueAt},outcome:{grade:'good'},occurredAt:beforeDue},lightweightSchedulingPolicy),'a due Review cannot run before its due trigger');
const independent= scheduleMemoryOutcome({memory,trigger:{kind:'independent_relearning_evaluation',memoryRevision:1,evaluationId:id()},outcome:{grade:'good'},occurredAt:beforeDue},lightweightSchedulingPolicy);
assert.equal(independent.resultingMemoryRevision,2,'an explicitly eligible independent Relearning evaluation advances Memory without impersonating a due Review');
});
await openLibrary();
await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{
  tx.put('meta','service-owner',{subject:id()});
});

const fixture = await libraryCloudPackageFixture();
const pack = await installPackage(new Uint8Array(fixture.bytes), fixture.descriptor);
const targetIds = await enrollPackage(id(), pack.key,languageContext);
assert.equal(targetIds.length, 2);
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
let run=await startLearning(id(),assuranceTargetId,languageContext,20,'2026-09-11T04:00:00.000Z');
let state!:Awaited<ReturnType<typeof readLearning>>;
let target!:Awaited<ReturnType<typeof readLearning>>['targets'][number];
await test('assurance initial learning creates formal evidence and a scheduling handoff',async()=>{
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

await test('assurance due Review emits one memory outcome and schedules Relearning',async()=>{
run=await startLearning(id(),assuranceTargetId,languageContext,20,target.memory!.dueAt.toISOString());
assert.equal(run.purpose,'retention_review');
run=await driveAssurance(run,target.memory!.dueAt.toISOString(),true);
await finishLearning(id(),run.id);
state=await readLearning();target=state.targets.find(item=>item.id===assuranceTargetId)!;
assert.equal(target.memoryRevision,2);
assert(target.relearnAt);
assert(target.relearningState);
assert.equal(state.events.filter(event=>event.runId===run.id&&event.detail.transition.retention?.kind==='memory_outcome').length,1);
});

const assuranceReviewRevision=target.memoryRevision;
await test('assurance Relearning clears its state without updating FSRS',async()=>{
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

const fourStageTargetId=targetIds[1]!;
await selectLocalLearningPolicy(id(),fourStageTargetId,languageContext,'interleaved_four_stage');

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
        const content=fourStageContent(localExecutableTargetForParticipant(currentTarget,run.participants[currentTarget.id]!),pack);
        response={kind:'choice',optionId:content.recognitionAssessment.options.find(option=>option.isCorrect)!.id};
      }else response={kind:'self_report',known:true};
    }else response={kind:'review',answer:session.mode==='review'?reviewAnswer:'known'};
    current=await actLearning(id(),current.id,current.revision,{kind:'protocol',response},at);
  }
  if(!current.completedAt)throw new Error('four-stage runtime did not complete');
  return current;
}

await test('four-stage initial learning and due Review create distinct retention facts',async()=>{
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
});

const fourStageReviewRevision=target.memoryRevision;
await test('four-stage Relearning completes without another FSRS update',async()=>{
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
