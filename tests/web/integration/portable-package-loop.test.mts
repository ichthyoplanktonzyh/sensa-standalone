import assert from 'node:assert/strict';

import {test} from 'vitest';
import {
  createSensaPortableLightweightPackage,
  validateSensaPortableLightweightPackage,
} from '@sensa/content-validator/portable-lightweight';
import {
  defaultSensaLanguageRoute,
  sensaPinnedLanguageContext,
  type SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';

import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {learningSystem} from '../../../apps/web/src/learning/system/index.ts';
import {
  command,
  openLibrary,
  readLibrary,
  readPortableMediaStorageDiagnostics,
  writeLibraryCache,
} from '../../../apps/web/src/data/library/store.ts';
import {localCurriculumMembershipForContext} from '../../../apps/web/src/learning/runtime/localCurriculum.ts';
import type {LocalLearningRun,LocalLearningTarget} from '../../../apps/web/src/learning/runtime/localProtocol.ts';
import {prepareLearningQueue} from '../../../apps/web/src/data/library/learning.ts';

Object.assign(globalThis,{window:new EventTarget(),location:new URL('https://sensa.local/'),BroadcastChannel:undefined});
await openLibrary();
await command({id:crypto.randomUUID(),kind:'fixture.owner',input:{}},async tx=>{
  tx.put('meta','service-owner',{subject:crypto.randomUUID(),accountId:crypto.randomUUID()});
});

const audioBytes=new TextEncoder().encode('ID3 portable loop fixture');
const audioDigest=sha256(audioBytes);
const media=new Map<string,Uint8Array>([['pronunciation',audioBytes]]);
const languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);

const manifest=():SensaPortableLightweightPackage=>({
  format:'sensa-portable-lightweight-package-v2',
  metadata:{
    packageId:'28d3301b-c5f7-4f52-8328-b7c5ec2bdc7b',
    version:1,
    title:'Portable water fixture',
    description:'Exercises the complete local portable package loop.',
    createdAt:'2026-09-25T00:00:00Z',
    author:{name:'Fixture Author'},
    license:{name:'CC0'},
  },
  route:{targetLanguage:'en',supportLanguage:'zh-CN'},
  sense:{senseId:'fixture:drinking-water',meaning:'日常饮用的水'},
  targetExpression:{text:'water',expressionKind:'word'},
  resources:{
    // External creators may deliberately reveal the expression in their cue.
    experienceRecallCue:{text:'看到 water 时，想象运动后喝下一杯清水。',senseFocus:'饮用水'},
    senseConfirmation:{text:'这里说的是日常饮用的水。'},
    pronunciation:{surface:'water',audioMediaId:'pronunciation',method:'recording',source:'Fixture recording'},
    sceneBridge:{text:'杯中的饮品就是句子里请求的东西。'},
    sceneRealization:{example:'Could I have some water?',translation:'可以给我一些水吗？',targetStart:18,targetEnd:23},
    optional:{},
  },
  media:[{mediaId:'pronunciation',kind:'audio',mimeType:'audio/x-fixture',sha256:audioDigest,sizeBytes:audioBytes.byteLength}],
});

const declaredManifest=():SensaPortableLightweightPackage=>{
  const value=manifest();
  value.metadata.packageId='da52c793-bf9f-40cc-bdf2-1849302a34c5';
  value.metadata.title='Portable water fixture with a semantic declaration';
  value.semanticDeclaration={
    contractVersion:'sensa-portable-semantic-declaration-v1',
    sense:{
      senseId:'e2a2e33e-c0f0-4554-a3e1-1b09311e1d90',
      senseVersionId:'b3e9d456-1a87-4d84-ac10-c9fd0dbc822a',
      senseKey:'water-drinking',
      versionNumber:1,
      semanticPolicyVersion:'fixture-editorial-v1',
      semanticSpec:{
        schemaVersion:'sensa-sense-semantic-spec-v1',
        coreMeaningFocus:'Water considered as something people drink.',
        prototypeScenes:[{summary:'A person drinks water after exercise.',participantRoles:['drinker','water'],states:['thirsty','drinking'],directionOrCausality:'Drinking water relieves thirst.'}],
        includedCases:['a glass of drinking water'],
        excludedCases:['a municipal water supply'],
        neighborContrasts:[],
        openQuestions:[],
      },
    },
    expression:{expressionId:'7be22e77-c9f8-46d5-9094-1a332785301e',expressionVersionId:'dcbecb7e-7471-4eb4-a475-4f36ade07f38',versionNumber:1,expressionType:'word',structure:{}},
    binding:{senseExpressionBindingId:'ae4840c5-b0ec-4caf-859c-c21764342160',bindingVersionId:'82ecabfd-b967-4608-be45-f73bdf3f3c67',versionNumber:1,relation:'realizes',semanticCoverage:'exact',registerLabel:null,usageConstraints:[]},
  };
  return value;
};

const bytes=createSensaPortableLightweightPackage(manifest(),media);

test('preview is read-only and explicit install preserves the portable origin',async()=>{
  const before={
    packages:await readLibrary(tx=>tx.count('packageCache')),
    installations:await readLibrary(tx=>tx.count('packageInstallations')),
    targets:await readLibrary(tx=>tx.count('learningTargets')),
  };
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes});
  assert.equal(preview.status,'new');
  assert.equal(preview.package.targetExpression.text,'water');
  assert.deepEqual({
    packages:await readLibrary(tx=>tx.count('packageCache')),
    installations:await readLibrary(tx=>tx.count('packageInstallations')),
    targets:await readLibrary(tx=>tx.count('learningTargets')),
  },before,'preview must not install or enroll content');

  const installed=await contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes,
    expectedArchiveDigest:preview.archiveDigest,
  });
  assert.equal(installed.portableOrigin.packageDigest,preview.packageDigest);
  assert.equal((await readLibrary(tx=>tx.count('learningTargets'))),before.targets,'install must not enroll content');
  const cue=installed.content.entries[0]!.content.resources.find(item=>item.materialRoleKey==='experience_recall_cue');
  assert.match(String(cue?.contentPayload.scene),/water/u,'public admission must not apply Sensa Official editorial rules');

  const again=await contentSupplySystem.execute({kind:'preview_portable_package',bytes});
  assert.equal(again.status,'installed');
  const idempotent=await contentSupplySystem.execute({kind:'install_portable_package',bytes,expectedArchiveDigest:again.archiveDigest});
  assert.equal(idempotent.installedAt,installed.installedAt);
  assert.equal(await readLibrary(tx=>tx.count('packageCache')),before.packages+1);
});

test('a local semantic declaration is preserved but cannot claim official identity',async()=>{
  const claimed=declaredManifest();
  const claimedBytes=createSensaPortableLightweightPackage(claimed,media);
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:claimedBytes});
  const installed=await contentSupplySystem.execute({kind:'install_portable_package',bytes:claimedBytes,expectedArchiveDigest:preview.archiveDigest});
  const entry=installed.content.entries[0]!;
  assert.deepEqual(installed.portableOrigin.manifest.semanticDeclaration,claimed.semanticDeclaration);
  assert.notEqual(entry.senseId,claimed.semanticDeclaration!.sense.senseId);
  assert.notEqual(entry.senseVersionId,claimed.semanticDeclaration!.sense.senseVersionId);
  assert.notEqual(entry.bindingId,claimed.semanticDeclaration!.binding.senseExpressionBindingId);
  assert.notEqual(entry.bindingVersionId,claimed.semanticDeclaration!.binding.bindingVersionId);
});

test('same package identity cannot silently replace different content',async()=>{
  const changed=manifest();
  changed.metadata.description='Different bytes under the same public identity.';
  const changedBytes=createSensaPortableLightweightPackage(changed,media);
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:changedBytes});
  assert.equal(preview.status,'version_conflict');
  await assert.rejects(contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes:changedBytes,
    expectedArchiveDigest:preview.archiveDigest,
  }),/localFlow\.packageVersionChanged/u);
});

test('installed content re-exports deterministically and runs through Lightweight learning',async()=>{
  const workspace=await contentSupplySystem.read({kind:'workspace'});
  const installed=workspace.packages.find(item=>item.portableOrigin.manifest.metadata.packageId===manifest().metadata.packageId)!;
  assert.equal('resources' in installed.content.entries[0]!,false,'inventory reads must not expose or hydrate Runtime resources');
  assert.equal('assurance' in installed.content,false,'inventory reads must project assurance presence instead of its Runtime payload');
  const exported=await contentSupplySystem.execute({kind:'export_portable_package',packageKey:installed.key});
  assert.match(exported.fileName,/\.sensa$/u);
  assert.deepEqual(exported.bytes,bytes);
  assert.equal(validateSensaPortableLightweightPackage(exported.bytes).status,'satisfied');

  const [targetId]=await learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:installed.key,languageContext});
  assert(targetId);
  await learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext,dailyLimit:1});
  await learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId,languageContext,dailyLimit:1});
  let learning=await learningSystem.read({kind:'workspace',languageContext});
  assert.equal(learning.runtime?.kind,'lightweight');
  assert.equal(learning.runtime?.kind==='lightweight'?learning.runtime.phase:null,'experience');
  await learningSystem.execute({
    kind:'act',
    operationId:crypto.randomUUID(),
    runId:learning.runtime!.runId,
    expectedRevision:learning.runtime!.revision,
    action:{kind:'reveal'},
  });
  learning=await learningSystem.read({kind:'workspace',languageContext});
  assert.equal(learning.runtime?.kind,'lightweight');
  assert.equal(learning.runtime?.kind==='lightweight'?learning.runtime.phase:null,'reveal');
});

test('a portable content update keeps Target progress and refreshes the unfinished current Step',async()=>{
  const beforeTarget=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets')))[0]!;
  const beforeRun=(await readLibrary(tx=>tx.all<LocalLearningRun>('learningRuns')))[0]!;
  const beforeParticipant=beforeRun.participants[beforeTarget.id]!;
  const originalMembershipId=beforeParticipant.curriculumMembershipId;

  const updated=manifest();
  updated.metadata.version=2;
  updated.metadata.title='Portable water fixture, revised';
  updated.metadata.description='A revised scene under the same learning identity.';
  updated.metadata.createdAt='2026-09-25T01:00:00Z';
  updated.resources.sceneBridge.text='刚运动完，你拿起杯子，请求其中清凉的饮品。';
  const updatedBytes=createSensaPortableLightweightPackage(updated,media);
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:updatedBytes});
  assert.equal(preview.status,'update_available');
  const installed=await contentSupplySystem.execute({kind:'install_portable_package',bytes:updatedBytes,expectedArchiveDigest:preview.archiveDigest});

  const [updatedTargetId]=await learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:installed.key,languageContext});
  assert.equal(updatedTargetId,beforeTarget.id,'stable Sense and Binding identity must reuse the Learning Target');

  const afterTarget=await readLibrary(tx=>tx.get<LocalLearningTarget>('learningTargets',beforeTarget.id));
  assert(afterTarget);
  assert.equal(afterTarget.retentionId,beforeTarget.retentionId);
  assert.equal(afterTarget.startedAt,beforeTarget.startedAt);
  assert.deepEqual(afterTarget.memory,beforeTarget.memory);
  assert.equal(afterTarget.memoryRevision,beforeTarget.memoryRevision);
  assert.deepEqual(afterTarget.committedPolicy,beforeTarget.committedPolicy);
  const oldMembership=afterTarget.curriculumMemberships.find(item=>item.id===originalMembershipId);
  assert.notEqual(oldMembership?.status,'superseded');
  const activeMembership=localCurriculumMembershipForContext(afterTarget,languageContext);
  assert.equal(activeMembership?.packageKey,installed.key);
  assert.equal(activeMembership?.material.snapshot.provenance.packageVersion,'2');

  const afterRun=await readLibrary(tx=>tx.get<LocalLearningRun>('learningRuns',beforeRun.id));
  assert(afterRun);
  const pinnedParticipant=afterRun.participants[beforeTarget.id]!;
  assert.equal(pinnedParticipant.curriculumMembershipId,originalMembershipId);
  assert.equal(pinnedParticipant.material.snapshot.provenance.packageVersion,'1');
  const refreshEvent=afterRun.lifecycleEvents.at(-1)!;
  const presentedVersions=Object.values(pinnedParticipant.presentedMaterials).map(item=>item.snapshot.provenance.packageVersion);
  assert.deepEqual([...presentedVersions].sort(),['1','2'],'the acted Step remains v1 while the current unacted Step refreshes to v2');
  assert.equal(
    pinnedParticipant.presentedMaterials[refreshEvent.stepId]?.content.resources.find(item=>item.materialRoleKey==='scene_bridge')?.contentPayload.text,
    updated.resources.sceneBridge.text,
  );
  assert.equal(refreshEvent.kind,'current_step_material_refreshed');
  const {estimateLibraryBackupSize}=await import('../../../apps/web/src/data/library/backup.ts');
  assert((await estimateLibraryBackupSize()).usedBytes>0,'the refreshed Step must pass complete Library replay validation');
});

test('an update with a new semantic identity defers its fresh Target to the next scheduler window',async()=>{
  const oldTarget=(await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'))).find(target=>
    localCurriculumMembershipForContext(target,languageContext)?.material.snapshot.provenance.packageVersion==='2',
  )!;
  const changed=manifest();
  changed.metadata.version=3;
  changed.metadata.title='Portable water fixture, new sense';
  changed.metadata.createdAt='2026-09-25T02:00:00Z';
  changed.sense.senseId='fixture:water-supply';
  changed.sense.meaning='可供使用的一份水资源';
  changed.resources.senseConfirmation.text='这里说的是可供使用的一份水资源。';
  const changedBytes=createSensaPortableLightweightPackage(changed,media);
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:changedBytes});
  assert.equal(preview.status,'update_available');
  const installed=await contentSupplySystem.execute({kind:'install_portable_package',bytes:changedBytes,expectedArchiveDigest:preview.archiveDigest});

  const eagerTargetIds=await learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:installed.key,languageContext});
  assert.deepEqual(eagerTargetIds,[],'an exhausted daily window must not eagerly materialize a replacement Target');
  const [newTargetId]=await prepareLearningQueue(languageContext,'2099-09-26T00:00:00.000Z');
  assert.notEqual(newTargetId,oldTarget.id);
  const targets=await readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
  const prior=targets.find(target=>target.id===oldTarget.id)!;
  const replacement=targets.find(target=>target.id===newTargetId)!;
  assert.equal(localCurriculumMembershipForContext(prior,languageContext)?.material.snapshot.provenance.packageVersion,'2');
  assert.equal(localCurriculumMembershipForContext(replacement,languageContext)?.packageKey,installed.key);
  assert.equal(replacement.startedAt,null);
  assert.equal(replacement.memory,null);
  assert.equal(replacement.memoryRevision,0);
  assert.equal(prior.startedAt,oldTarget.startedAt,'the prior Target and its progress remain learner-owned');

  const workspace=await contentSupplySystem.read({kind:'workspace'});
  const priorRelease=workspace.packages.find(item=>item.portableOrigin.manifest.metadata.version===2)!;
  await assert.rejects(
    learningSystem.execute({kind:'enroll_package',operationId:crypto.randomUUID(),packageKey:priorRelease.key,languageContext}),
    /localFlow\.packageVersionChanged/u,
    'an older installed release must not replace the active newer curriculum version',
  );
});

test('installed Portable media is content-addressed, shared, and garbage-collected',async()=>{
  const before=await readPortableMediaStorageDiagnostics();
  const uniqueBytes=new TextEncoder().encode('ID3 unique portable cache fixture');
  const uniqueDigest=sha256(uniqueBytes);
  const temporary=manifest();
  temporary.metadata.packageId='f2386798-d8c2-4ec0-9c4d-5f1fa936d80e';
  temporary.metadata.title='Temporary portable cache fixture';
  temporary.media=[{
    mediaId:'pronunciation',
    kind:'audio',
    mimeType:'audio/x-fixture',
    sha256:uniqueDigest,
    sizeBytes:uniqueBytes.byteLength,
  }];
  const temporaryBytes=createSensaPortableLightweightPackage(
    temporary,
    new Map([['pronunciation',uniqueBytes]]),
  );
  const secondTemporary=structuredClone(temporary);
  secondTemporary.metadata.packageId='93f796b5-a36a-4f66-a1e3-d1027bd35a92';
  secondTemporary.metadata.title='Second temporary portable cache fixture';
  const secondTemporaryBytes=createSensaPortableLightweightPackage(
    secondTemporary,
    new Map([['pronunciation',uniqueBytes]]),
  );
  const preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:temporaryBytes});
  const installed=await contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes:temporaryBytes,
    expectedArchiveDigest:preview.archiveDigest,
  });
  const secondPreview=await contentSupplySystem.execute({
    kind:'preview_portable_package',
    bytes:secondTemporaryBytes,
  });
  const secondInstalled=await contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes:secondTemporaryBytes,
    expectedArchiveDigest:secondPreview.archiveDigest,
  });
  const stored=await readPortableMediaStorageDiagnostics();
  assert.deepEqual(stored,{
    blobCount:before.blobCount+1,
    totalBytes:before.totalBytes+uniqueBytes.byteLength,
    referenceCount:before.referenceCount+2,
  });
  const roundTrip=await contentSupplySystem.execute({
    kind:'export_portable_package',
    packageKey:installed.key,
  });
  assert.deepEqual(roundTrip.bytes,temporaryBytes,'hydration must stay transparent to export');

  await writeLibraryCache(async tx=>tx.delete('packageCache',installed.key));
  assert.deepEqual(await readPortableMediaStorageDiagnostics(),{
    blobCount:before.blobCount+1,
    totalBytes:before.totalBytes+uniqueBytes.byteLength,
    referenceCount:before.referenceCount+1,
  });
  await writeLibraryCache(async tx=>tx.delete('packageCache',secondInstalled.key));
  assert.deepEqual(await readPortableMediaStorageDiagnostics(),before);
});
