import assert from 'node:assert/strict';
import {test} from 'vitest';

import { readRepositoryText, readTypeScriptSourceTree } from '../support/sourceTree.mts';

const rawLearningStoreImport = /['"][^'"]*\/data\/library\/learning(?:\.ts)?['"]/u;
const kernelImport = /['"]@sensa\/learning-kernel(?:\/[^'"]*)?['"]/u;
const learningImplementationImport = /['"][^'"]*\/learning\/(?:runtime|protocols)\//u;

test('[contract][local-correctness] application code uses the Learning System boundary', async () => {
  const files = await readTypeScriptSourceTree('apps/web/src');
  const rawLearningConsumers = files
    .filter(({ relativePath }) => (
      !relativePath.startsWith('apps/web/src/data/library/')
      && !relativePath.startsWith('apps/web/src/learning/system/')
    ))
    .filter(({ source }) => rawLearningStoreImport.test(source))
    .map(({ relativePath }) => relativePath);
  assert.deepEqual(
    rawLearningConsumers,
    [],
    'application code must submit Learning commands and queries through the Learning System interface',
  );

  const experienceFiles = files.filter(({ relativePath }) => relativePath.startsWith('apps/web/src/experience/'));
  assert.deepEqual(
    experienceFiles.filter(({ source }) => kernelImport.test(source)).map(({ relativePath }) => relativePath),
    [],
    'experience code must not couple directly to the pure Learning Kernel',
  );
  assert.deepEqual(
    experienceFiles
      .filter(({ source }) => learningImplementationImport.test(source))
      .map(({ relativePath }) => relativePath),
    [],
    'experience code must render Learning projections instead of resolving Runtime or Protocol internals',
  );

  const learningInterface = await readRepositoryText('apps/web/src/learning/system/learningSystem.ts');
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

  const publicKernel = await readRepositoryText('packages/learning-kernel/src/index.ts');
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
});
