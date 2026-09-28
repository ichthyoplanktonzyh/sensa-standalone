/** Exercise the actual prepared Portable Book through the runtime without a browser. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

import {test} from 'vitest';
import {
  defaultSensaLanguageRoute,
  sensaPinnedLanguageContext,
  sensaPortableLearningContentRegistrySchema,
} from '@sensa/contracts/sensa';
import {readSensaPortableBook} from '@sensa/content-validator/portable-book';

import {installPublishedPortableBookMembers} from '../../../apps/web/src/contentSupply/portable/portablePackage.ts';
import {command,openLibrary} from '../../../apps/web/src/data/library/store.ts';
import {
  actLearning,
  confirmLearningQuantity,
  enrollPackage,
  finishLearning,
  readLearning,
  startLearning,
} from '../../../apps/web/src/data/library/learning.ts';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

test('prepared Portable Book installs and completes offline through due review',async()=>{
  Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
  const id=()=>crypto.randomUUID();
  await openLibrary();
  await command({id:id(),kind:'fixture.owner',input:{}},async tx=>{
    tx.put('meta','service-owner',{subject:id()});
  });
  const registry=sensaPortableLearningContentRegistrySchema.parse(JSON.parse(
    await readFile('release-candidate/portable-catalog.json','utf8'),
  ));
  const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
  const selectedDescriptor=registry.items.find(item=>item.book.bookKey==='daily-exchanges');
  assert(selectedDescriptor,'the prepared daily-exchanges Book must exist');
  await confirmLearningQuantity(id(),context,20);
  const fetchBefore=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('Offline validation must not fetch');};
  try{
    for(const descriptor of [selectedDescriptor]){
      const bookBytes=await readFile(`apps/web/public${new URL(descriptor.url).pathname}`);
      assert.equal(digest(bookBytes),descriptor.sha256);
      const bookArchive=readSensaPortableBook(bookBytes);
      const manifest=bookArchive.manifest;
      assert.equal(manifest.members.length,3);
      const installed=await installPublishedPortableBookMembers(bookArchive.members.map(({member,bytes,archive})=>({
        bytes,
        archive,
        publication:{
          format:'sensa-portable-publication-attestation-v2',
          publisher:manifest.publisher,
          book:manifest.book,
          contentRelease:manifest.contentRelease,
          route:manifest.route,
          publishedAt:manifest.publishedAt,
          changeSummary:manifest.changeSummary,
          bookArchiveSha256:descriptor.sha256,
          memberCount:manifest.members.length,
          member,
        },
      })));
      for(const pack of installed){
        const entry=pack.content.entries[0]!;
        assert(entry.semantic,'Registry-attested members retain official semantic facts');
        const targetIds=await enrollPackage(id(),pack.key,context,descriptor.sha256);
        for(const target of targetIds){
          const now=new Date().toISOString();
          let run=await startLearning(id(),target,context,20,now);
          run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},now);
          run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},now);
          assert(run.completedAt);await finishLearning(id(),run.id);
          const learned=(await readLearning()).targets.find(value=>value.id===target)!;
          assert(learned.memory);
          const due=learned.memory.dueAt.toISOString();
          run=await startLearning(id(),target,context,20,due);
          assert.equal(run.purpose,'retention_review');
          run=await actLearning(id(),run.id,run.revision,{kind:'reveal'},due);
          run=await actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'},due);
          assert(run.completedAt);await finishLearning(id(),run.id);
        }
      }
    }
  }finally{
    globalThis.fetch=fetchBefore;
  }
});
