import assert from 'node:assert/strict';

import {
  defaultSensaLanguageRoute,
  librarySyncTables,
  sensaInitialLearningCompletionSchema,
  sensaMemoryOutcomeSnapshotSchema,
  sensaPinnedLanguageContext,
  sensaRelearningCompletionSchema,
  sensaSchedulingDecisionSchema,
  sensaSchedulingHandoffSchema,
} from '@sensa/contracts/sensa';
import {test,vi} from 'vitest';

import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {libraryBackupTables} from '../../../apps/web/src/data/library/backupPolicy.ts';
import {
  actLearning,
  confirmLearningQuantity,
  enrollPackage,
  finishLearning,
  readLearning,
  setLocalDeclaredMastery,
  startLearning,
} from '../../../apps/web/src/data/library/learning.ts';
import {command,openLibrary,readLibrary} from '../../../apps/web/src/data/library/store.ts';
import {learningSystem} from '../../../apps/web/src/learning/system/index.ts';
import {hasDeclaredMasteryOverride} from '../../../apps/web/src/learning/runtime/targetPlanningOverrides.ts';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});

assert(librarySyncTables.includes('packageInstallations'));
assert.equal(
  (librarySyncTables as readonly string[]).includes('packageCache'),
  false,
  'public artifact caches must be outside the Cloud Checkpoint contract',
);
assert(libraryBackupTables.includes('packageInstallations'));
assert.equal(
  (libraryBackupTables as readonly string[]).includes('packageCache'),
  false,
  'public artifact caches must be outside encrypted account backups',
);

await openLibrary();
await command({id:crypto.randomUUID(),kind:'fixture.owner',input:{}},async tx=>{
  tx.put('meta','service-owner',{
    subject:crypto.randomUUID(),
    accountId:crypto.randomUUID(),
  });
});

const id=()=>crypto.randomUUID();
const languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
const fixture=portablePackageFixture({packageId:id()});
const preview=await contentSupplySystem.execute({
  kind:'preview_portable_package',
  bytes:fixture.bytes,
});
const pack=await contentSupplySystem.execute({
  kind:'install_portable_package',
  bytes:fixture.bytes,
  expectedArchiveDigest:preview.archiveDigest,
});

let targetId:string;
const at='2026-09-10T08:00:00.000Z';

test('Portable installation and enrollment remain separate idempotent authorities',async()=>{
  assert.equal((await readLearning()).targets.length,0);
  assert.equal((await contentSupplySystem.read({kind:'workspace'})).packages.length,1);
  assert.equal(
    'packages' in await learningSystem.read({kind:'workspace',languageContext}),
    false,
    'Learning workspace must not own installed Content Supply artifacts',
  );
  const installation=await readLibrary(
    tx=>tx.all<any>('packageInstallations').then(rows=>rows[0]),
  );
  assert.equal('content' in installation,false,'synchronized installation facts carry no Runtime bytes');

  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
  try{
    [targetId]=await enrollPackage(id(),pack.key,languageContext) as [string];
    await enrollPackage(id(),pack.key,languageContext);
  }finally{vi.useRealTimers();}
  const state=await readLearning();
  assert.equal(state.targets.length,1);
  assert.equal(state.targets[0]!.id,targetId);
  assert.equal(state.targets[0]!.targetLanguageTag,'en');
  assert.equal(state.targets[0]!.curriculumMemberships[0]!.languageContext.supportLanguageTag,'zh-CN');
});

test('initial learning, Review and Relearning settle only replayable outcomes',async()=>{
  await confirmLearningQuantity(id(),languageContext,20);
  let run=await startLearning(id(),targetId,languageContext,20,at);

  const declaration=id();
  await setLocalDeclaredMastery(declaration,targetId,true,at);
  let state=await readLearning();
  assert(hasDeclaredMasteryOverride(state.targets[0]!));
  assert.equal(state.active,undefined);
  assert.equal(state.targets[0]!.memory,null);
  assert.equal(state.events.length,0);
  await assert.rejects(actLearning(id(),run.id,run.revision,{kind:'reveal'},at));

  await setLocalDeclaredMastery(id(),targetId,false,at);
  run=await startLearning(id(),targetId,languageContext,20,at);
  run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},at);
  const initialAction=id();
  run=await actLearning(initialAction,run.id,run.revision,{kind:'rate',rating:'good'},at);
  assert(run.completedAt);

  state=await readLearning();
  const initial=state.events.find(event=>event.id===initialAction)!.detail.transition.retention;
  assert.equal(initial?.kind,'initial_learning_completion');
  if(initial?.kind!=='initial_learning_completion')throw new Error('missing initial completion');
  sensaInitialLearningCompletionSchema.parse(initial.completion);
  sensaSchedulingHandoffSchema.parse(initial.handoff);
  assert.equal(initial.handoff.initialLearningCompletionId,initial.completion.initialLearningCompletionId);
  await finishLearning(id(),run.id);

  const due=(await readLearning()).targets[0]!.memory!.dueAt.toISOString();
  run=await startLearning(id(),targetId,languageContext,20,due);
  assert.equal(run.purpose,'retention_review');
  run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},due);
  const reviewAction=id();
  run=await actLearning(reviewAction,run.id,run.revision,{kind:'rate',rating:'again'},due);
  await finishLearning(id(),run.id);

  state=await readLearning();
  const reviewed=state.targets[0]!;
  assert.equal(reviewed.memoryRevision,2);
  assert(reviewed.relearnAt);
  const review=state.events.find(event=>event.id===reviewAction)!.detail.transition.retention;
  assert.equal(review?.kind,'memory_outcome');
  if(review?.kind!=='memory_outcome')throw new Error('missing memory outcome');
  sensaMemoryOutcomeSnapshotSchema.parse(review.outcome);
  sensaSchedulingDecisionSchema.parse(review.schedulingDecision);

  run=await startLearning(id(),targetId,languageContext,20,reviewed.relearnAt!);
  assert.equal(run.purpose,'relearning');
  run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},reviewed.relearnAt!);
  const relearningAction=id();
  run=await actLearning(
    relearningAction,
    run.id,
    run.revision,
    {kind:'rate',rating:'good'},
    reviewed.relearnAt!,
  );
  const finalState=await readLearning();
  assert.equal(finalState.targets[0]!.memoryRevision,2);
  assert.equal(finalState.targets[0]!.relearnAt,null);
  const relearning=finalState.events.find(
    event=>event.id===relearningAction,
  )!.detail.transition.retention;
  assert.equal(relearning?.kind,'relearning_completion');
  if(relearning?.kind!=='relearning_completion')throw new Error('missing relearning completion');
  sensaRelearningCompletionSchema.parse(relearning.completion);
});

test('revoking a known declaration restores eligibility without replacing another active Run; explicit selection resumes its original revealed Step',async()=>{
  const clock='2027-01-10T08:00:00.000Z';
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(clock);
  try{
    const targets:string[]=[];
    for(const expression of ['retain','resume']){
      const fixture=portablePackageFixture({packageId:id(),expression});
      const installed=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
      targets.push(...await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:installed.key,languageContext}));
    }
    const [firstTarget,secondTarget]=targets as [string,string];
    const runtime=async()=>{const value=(await learningSystem.read({kind:'runtime',languageContext,clock:Date.parse(clock)})).runtime;assert(value?.kind==='lightweight');return value;};
    await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext,dailyLimit:20});
    await learningSystem.execute({kind:'start',operationId:id(),targetId:firstTarget,languageContext,dailyLimit:20,at:clock});
    const initial=await runtime();
    await learningSystem.execute({kind:'act',operationId:id(),runId:initial.runId,expectedRevision:initial.revision,action:{kind:'reveal'},at:clock});
    const first=await runtime();
    const before=await readLearning();
    await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId:firstTarget,active:true,languageContext,at:clock});
    await learningSystem.execute({kind:'start',operationId:id(),targetId:secondTarget,languageContext,dailyLimit:20,at:clock});
    const second=await runtime(),secondRun=(await readLearning()).runs.find(run=>run.id===second.runId);
    await learningSystem.execute({kind:'set_declared_mastery',operationId:id(),targetId:firstTarget,active:false,languageContext,at:clock});
    const eligible=await readLearning();
    assert.equal(eligible.active,second.runId,'revocation alone cannot replace the current Run');
    assert.deepEqual(eligible.runs.find(run=>run.id===second.runId),secondRun);
    assert.equal(hasDeclaredMasteryOverride(eligible.targets.find(target=>target.id===firstTarget)!),false);
    assert.deepEqual(eligible.events,before.events,'declaration and revocation create no grading events');
    for(const targetId of targets){
      const target=eligible.targets.find(target=>target.id===targetId)!;
      assert.equal(target.memory,null);assert.equal(target.memoryRevision,0);
    }
    await learningSystem.execute({kind:'start',operationId:id(),targetId:firstTarget,languageContext,dailyLimit:20,at:clock});
    const projection=await runtime();
    assert.equal(projection.runId,first.runId,'explicit selection lawfully resumes the interrupted Run');
    assert.equal(projection.phase,'reveal');
    assert.equal(projection.currentTargetId,firstTarget);
    assert.deepEqual(projection.step,first.step);
    assert.deepEqual((await readLearning()).events,before.events);
  }finally{vi.useRealTimers();}
});
