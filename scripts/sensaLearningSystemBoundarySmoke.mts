import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const learningSystemDirectory = join(sourceRoot, 'learning/system/');
const sourceExtensions = /\.(?:ts|tsx)$/u;
const rawLearningStoreImport = /['"][^'"]*\/data\/library\/(?:learning|personalLearning)(?:\.ts)?['"]/u;
const kernelImport = /['"]@sensa\/learning-kernel(?:\/[^'"]*)?['"]/u;

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtensions.test(entry.name) ? [path] : [];
  }))).flat();
};

const files = await sourceFiles(sourceRoot);
const rawLearningConsumers: string[] = [];
for (const file of files) {
  if (file.startsWith(join(sourceRoot, 'data/library/')) || file.startsWith(learningSystemDirectory)) continue;
  const source = await readFile(file, 'utf8');
  if (rawLearningStoreImport.test(source)) rawLearningConsumers.push(relative('.', file));
}
assert.deepEqual(
  rawLearningConsumers,
  [],
  'application code must submit Learning commands and queries through the Learning System interface',
);

const experienceFiles = files.filter((file) => file.startsWith(join(sourceRoot, 'experience/')));
const kernelConsumers: string[] = [];
for (const file of experienceFiles) {
  if (kernelImport.test(await readFile(file, 'utf8'))) kernelConsumers.push(relative('.', file));
}
assert.deepEqual(
  kernelConsumers,
  [],
  'experience code must not couple directly to the pure Learning Kernel',
);

const publicKernel = await readFile('packages/learning-kernel/src/index.ts', 'utf8');
assert(!/export\s+\*/u.test(publicKernel), 'the Learning Kernel must keep an explicit public interface');
for (const lowLevelExport of [
  'computeReviewSchedule',
  'createEmptyReviewableCardScheduleState',
  'rebuildCardScheduleState',
  'resolveSensaExecutableLearningCapabilities',
]) {
  assert(
    !new RegExp(`export[\\s\\S]{0,120}\\b${lowLevelExport}\\b`, 'u').test(publicKernel),
    `${lowLevelExport} is an internal primitive, not a public Learning Kernel operation`,
  );
}

console.log('PASS: Learning application code uses one deep system interface and the pure kernel exposes an explicit, narrow API.');
