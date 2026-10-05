import assert from 'node:assert/strict';
import {test,vi} from 'vitest';
import {indexedDB} from 'fake-indexeddb';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';

import {libraryCloudPackageFixture} from '../../../scripts/support/libraryCloudPackageFixture.mts';
import {learningCommand} from '../../../apps/web/src/data/library/learningAdmission.ts';
import {LearningSystemInvariantError} from '../../../apps/web/src/data/library/learningAuthority.ts';
import {
  confirmLearningQuantity,
  enrollPackage,
  readLearning,
  startLearning,
  type LocalLearningRun,
  type LocalLearningTarget,
} from '../../../apps/web/src/data/library/learning.ts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {
  command,
  openLibrary,
  readLibrary,
  readLocalLibraryRevision,
} from '../../../apps/web/src/data/library/store.ts';

  Object.assign(globalThis,{indexedDB,window:new EventTarget(),BroadcastChannel:undefined});
  const id=()=>crypto.randomUUID();
  const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);

  await openLibrary();
  await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{
    tx.put('meta','service-owner',{subject:id(),accountId:id()});
  });
  const fixture=await libraryCloudPackageFixture();
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-09-20T08:00:00.000Z');
  const pack=await contentSupplySystem.execute({
    kind:'install_portable_package',
    bytes:fixture.bytes,
    expectedArchiveDigest:fixture.archiveDigest,
  });
  const [targetId]=await enrollPackage(id(),pack.key,context);
  vi.useRealTimers();
  await confirmLearningQuantity(id(),context,20);
  const run=await startLearning(id(),targetId!,context,20,'2026-09-20T08:00:00.000Z');
  const revision=await readLibrary(readLocalLibraryRevision);

  const assertUnchanged=async()=>{
    const state=await readLearning();
    assert.equal(state.runs.length,1);
    assert.equal(state.runs[0]!.revision,run.revision);
    assert.equal(state.targets[0]!.memoryRevision,0);
    assert.equal(state.events.length,0);
    assert.equal(await readLibrary(readLocalLibraryRevision),revision,'rejected transitions never reach SQLite');
  };

test('physical deletion cannot erase append-only Run history', async()=>{
await assert.rejects(
  learningCommand({id:id(),kind:'fixture.delete-run',input:{runId:run.id}},async tx=>{
    tx.delete('learningRuns',run.id);
  }),
  LearningSystemInvariantError,
  'local commands cannot physically delete append-only Run history',
);
await assertUnchanged();
});

test('scheduler projections cannot be manufactured without a Learning Event', async()=>{
await assert.rejects(
  learningCommand({id:id(),kind:'learning.act',input:{runId:run.id,at:run.startedAt,action:{kind:'forged'}}},async tx=>{
    const target=(await tx.get<LocalLearningTarget>('learningTargets',targetId!))!;
    target.memoryRevision++;
    tx.put('learningTargets',target.id,target);
  }),
  LearningSystemInvariantError,
  'a command cannot manufacture a scheduler projection without a Learning Event',
);
await assertUnchanged();
});

test('Run revisions require a replayable Event or lifecycle fact', async()=>{
await assert.rejects(
  learningCommand({id:id(),kind:'learning.start',input:{targetId,at:run.startedAt}},async tx=>{
    const saved=(await tx.get<LocalLearningRun>('learningRuns',run.id))!;
    saved.revision++;
    tx.put('learningRuns',saved.id,saved);
  }),
  LearningSystemInvariantError,
  'a Run revision cannot advance without a replayable Event or lifecycle fact',
);
await assertUnchanged();
});

test('orphan Events cannot be appended without their Run transition', async()=>{
const forgedEventId=id();
await assert.rejects(
  learningCommand({id:forgedEventId,kind:'learning.act',input:{runId:run.id,at:run.startedAt,action:{kind:'forged'}}},async tx=>{
    tx.put('learningEvents',forgedEventId,{
      id:forgedEventId,
      runId:run.id,
      targetId:targetId!,
      kind:'forged',
      at:run.startedAt,
      detail:{action:{kind:'forged'}},
    });
  }),
  LearningSystemInvariantError,
  'an Event cannot be appended without its exact Run transition',
);
await assertUnchanged();
});
