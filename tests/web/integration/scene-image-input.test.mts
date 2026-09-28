import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  MAX_SCENE_IMAGES,
  MAX_SCENE_IMAGE_SOURCE_BYTES,
  processSceneImageFiles,
  selectSceneImageFiles,
} from '../../../apps/web/src/experience/components/useSceneImageInput.ts';

test("scene-image-input", async () => {

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

const first = new File(['first-image'], 'first.jpg', {type: 'image/jpeg'});
const second = new File(['second-image'], 'second.jpg', {type: 'image/jpeg'});
const third = new File(['third-image'], 'third.jpg', {type: 'image/jpeg'});
const completedFileKeys = new Set<string>();
const attempts: string[] = [];
let secondShouldFail = true;
const addFile = async (file: File): Promise<void> => {
  attempts.push(file.name);
  if (file.name === second.name && secondShouldFail) {
    throw new Error('simulated single-file persistence failure');
  }
};

const partialAttempt = await processSceneImageFiles(
  [first, second, third],
  0,
  completedFileKeys,
  addFile,
);
assert.deepEqual(
  partialAttempt.statuses.map(({fileName, state}) => ({fileName, state})),
  [
    {fileName: 'first.jpg', state: 'added'},
    {fileName: 'second.jpg', state: 'failed'},
    {fileName: 'third.jpg', state: 'added'},
  ],
  'A failed image must not hide successful files or prevent later files from being attempted',
);
assert.equal(completedFileKeys.size, 2);

secondShouldFail = false;
const retryAttempt = await processSceneImageFiles(
  [
    new File(['first-image'], 'renamed-first.jpg', {type: 'image/jpeg'}),
    second,
    third,
  ],
  2,
  completedFileKeys,
  addFile,
);
assert.deepEqual(
  retryAttempt.statuses.map(({fileName, state}) => ({fileName, state})),
  [{fileName: 'second.jpg', state: 'added'}],
  'Retrying the full selection must add only the file that failed previously',
);
assert.deepEqual(
  attempts,
  ['first.jpg', 'second.jpg', 'third.jpg', 'second.jpg'],
  'Content identity must prevent already-successful images from being duplicated on retry',
);

for (const path of [
  'apps/web/src/experience/components/PersonalMeaningComposer.tsx',
  'apps/web/src/experience/components/SceneEditorModal.tsx',
  'apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx',
] as const) {
  const source = await readFile(path, 'utf8');
  assert(source.includes('useSceneImageInput({'), `${path} does not use the shared scene image boundary`);
  assert(source.includes('onAddFile:'), `${path} does not commit scene images one at a time`);
  assert(source.includes('<SceneImageAttemptStatus'), `${path} does not expose per-file partial failure status`);
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

console.log('PASS: scene image entry points share boundaries and retry only failed files after partial success.');

});
