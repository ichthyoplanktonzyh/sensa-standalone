/** Personal media is a first-class Library row, not a localStorage sidecar. */
import assert from 'node:assert/strict';

Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});

const {openLibrary,readLibrary}=await import('../apps/web/src/data/library/store.ts');
const {getMedia,parseStoredMedia,putMedia,readMedia,removeMedia}=await import('../apps/web/src/experience/personalMeaningJourney/mediaStore.ts');

await openLibrary();
const media={
  mediaId:crypto.randomUUID(),
  mediaKind:'image' as const,
  mimeType:'image/jpeg',
  dataUrl:'data:image/jpeg;base64,YQ==',
  sizeBytes:1,
  createdAt:'2026-09-19T00:00:00.000Z',
};
await putMedia(media);
assert.deepEqual(getMedia(media.mediaId),media,'the synchronous render cache reflects committed media');
assert.deepEqual(await readMedia(media.mediaId),media,'async readers load from the same Library authority');
assert.deepEqual(await readLibrary(tx=>tx.get('media',media.mediaId)),media,'SQLite logical media row owns the bytes');
assert.throws(()=>parseStoredMedia({...media,dataUrl:'https://example.invalid/image.jpg'}),/inconsistent/);
await removeMedia(media.mediaId);
assert.equal(getMedia(media.mediaId),null);
assert.equal(await readLibrary(tx=>tx.get('media',media.mediaId)),undefined);

console.log('PASS: personal media commits to the Library media table, refreshes the render cache and deletes from the same authority.');
