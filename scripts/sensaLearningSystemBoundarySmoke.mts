import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const learningSystemDirectory = join(sourceRoot, 'learning/system/');
const sourceExtensions = /\.(?:ts|tsx)$/u;
const rawLearningStoreImport = /['"][^'"]*\/data\/library\/learning(?:\.ts)?['"]/u;
const kernelImport = /['"]@sensa\/learning-kernel(?:\/[^'"]*)?['"]/u;
const learningImplementationImport = /['"][^'"]*\/learning\/(?:runtime|protocols)\//u;

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
const implementationConsumers: string[] = [];
for (const file of experienceFiles) {
  const source = await readFile(file, 'utf8');
  if (kernelImport.test(source)) kernelConsumers.push(relative('.', file));
  if (learningImplementationImport.test(source)) implementationConsumers.push(relative('.', file));
}
assert.deepEqual(
  kernelConsumers,
  [],
  'experience code must not couple directly to the pure Learning Kernel',
);
assert.deepEqual(
  implementationConsumers,
  [],
  'experience code must render Learning projections instead of resolving Runtime or Protocol internals',
);

const learningInterface = await readFile('apps/web/src/learning/system/learningSystem.ts', 'utf8');
for (const leakedQuery of ['overview', 'state', 'targets']) {
  assert(
    !new RegExp(`kind:\\s*['"]${leakedQuery}['"]`, 'u').test(learningInterface),
    `${leakedQuery} is an aggregate leak, not a public Learning query`,
  );
}
for (const projectionQuery of ['home', 'workspace', 'personal_enrollment_index', 'semantic_memory']) {
  assert(
    new RegExp(`kind:\\s*['"]${projectionQuery}['"]`, 'u').test(learningInterface),
    `${projectionQuery} must remain an explicit Learning projection`,
  );
}

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
