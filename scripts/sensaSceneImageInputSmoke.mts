import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  MAX_SCENE_IMAGES,
  MAX_SCENE_IMAGE_SOURCE_BYTES,
  selectSceneImageFiles,
} from '../apps/web/src/experience/components/useSceneImageInput.ts';

const fakeFile = (type: string, size: number): File => ({type, size} as File);

const valid = [
  fakeFile('image/jpeg', 1_000),
  fakeFile('image/png', MAX_SCENE_IMAGE_SOURCE_BYTES),
];
assert.deepEqual(selectSceneImageFiles(valid, 0), {accepted: valid, rejected: false});

const oneSlot = selectSceneImageFiles(valid, MAX_SCENE_IMAGES - 1);
assert.equal(oneSlot.accepted.length, 1);
assert.equal(oneSlot.rejected, true);

const invalid = selectSceneImageFiles([
  fakeFile('text/plain', 100),
  fakeFile('image/jpeg', MAX_SCENE_IMAGE_SOURCE_BYTES + 1),
], 0);
assert.equal(invalid.accepted.length, 0);
assert.equal(invalid.rejected, true);

for (const path of [
  'apps/web/src/experience/components/PersonalMeaningComposer.tsx',
  'apps/web/src/experience/components/SceneEditorModal.tsx',
  'apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx',
] as const) {
  const source = await readFile(path, 'utf8');
  assert(source.includes('useSceneImageInput({'), `${path} does not use the shared scene image boundary`);
  assert(source.includes('onDrop={sceneImages.onDrop}'), `${path} does not support scene image drop`);
  assert(source.includes('onPaste={sceneImages.onPaste}'), `${path} does not support scene image paste`);
  assert(source.includes('capture="environment"'), `${path} does not offer camera capture`);
  assert(source.includes('multiple'), `${path} does not offer multi-image selection`);
  assert.equal(source.match(/onDrop=\{sceneImages\.onDrop\}/gu)?.length, 1, `${path} binds drop more than once`);
}

const composer = await readFile(
  'apps/web/src/experience/components/PersonalMeaningComposer.tsx',
  'utf8',
);
assert(
  composer.includes('disabled: busy || Boolean(persistence)'),
  'The persistence adapter can be bypassed by non-button image entry',
);

console.log('PASS: scene image entry points share limits, drag, paste, multi-select and camera behavior.');
