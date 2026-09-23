import {test} from 'vitest';
/** Personal media is a first-class Library row, not a localStorage sidecar. */
import assert from 'node:assert/strict';

test("media-library", async () => {

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});

const {openLibrary,readLibrary}=await import('../../../apps/web/src/data/library/store.ts');
const {getMedia,parseStoredMedia,readMedia,removeMedia,stageMedia}=await import('../../../apps/web/src/experience/personalMeaningJourney/mediaStore.ts');

await openLibrary();
const media={
  mediaId:crypto.randomUUID(),
  mediaKind:'image' as const,
  mimeType:'image/jpeg',
  dataUrl:'data:image/jpeg;base64,YQ==',
  sizeBytes:1,
  createdAt:'2026-09-19T00:00:00.000Z',
};
stageMedia(media);
assert.deepEqual(getMedia(media.mediaId),media,'the synchronous render cache reflects prepared media');
assert.deepEqual(await readMedia(media.mediaId),media,'async readers preserve prepared preview bytes');
assert.equal(await readLibrary(tx=>tx.get('media',media.mediaId)),undefined,'previews do not create orphaned durable rows');
assert.throws(()=>parseStoredMedia({...media,dataUrl:'https://example.invalid/image.jpg'}),/inconsistent/);
await removeMedia(media.mediaId);
assert.equal(getMedia(media.mediaId),null);
assert.equal(await readLibrary(tx=>tx.get('media',media.mediaId)),undefined);

const {createJourneyGateway}=await import('../../../apps/web/src/experience/personalMeaningJourney/gateway.ts');
const atomicMedia={...media,mediaId:crypto.randomUUID()};
stageMedia(atomicMedia);
assert.deepEqual(getMedia(atomicMedia.mediaId),atomicMedia,'prepared media is available for preview');
assert.equal(await readLibrary(tx=>tx.get('media',atomicMedia.mediaId)),undefined,'preview bytes are not orphaned in SQLite before semantic acceptance');
const gateway=createJourneyGateway({languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'image',personalMediaObjectId:atomicMedia.mediaId}]});
assert.deepEqual(await readLibrary(tx=>tx.get('media',atomicMedia.mediaId)),atomicMedia,'media and its Inbox reference commit together');
const before=await readLibrary(async tx=>(await tx.entries('semanticInbox')).length);
await assert.rejects(
  gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'image',personalMediaObjectId:crypto.randomUUID()}]}),
  /尚未准备完成/,
  'a dangling media reference aborts the semantic transaction',
);
assert.equal(await readLibrary(async tx=>(await tx.entries('semanticInbox')).length),before,'a rejected media reference leaves no partial Inbox row');
await assert.rejects(removeMedia(atomicMedia.mediaId),/仍被个人意义引用/,'committed media cannot be removed while a semantic row references it');

console.log('PASS: personal media previews from staging, commits atomically with its semantic reference, rejects dangling references and cannot be deleted while referenced.');

});
