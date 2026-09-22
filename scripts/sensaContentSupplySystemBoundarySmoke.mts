import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const contentSupplySystemDirectory = join(sourceRoot, 'contentSupply/system/');
const sourceExtensions = /\.(?:ts|tsx)$/u;
const rawContentSupplyImport = /['"][^'"]*\/data\/library\/(?:packages|packageRecords|personalLearning|personalLearningSource)(?:\.ts)?['"]/u;

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtensions.test(entry.name) ? [path] : [];
  }))).flat();
};

const files = await sourceFiles(sourceRoot);
const surfaceLeaks: string[] = [];
for (const file of files.filter((path) => path.startsWith(join(sourceRoot, 'experience/')))) {
  if (rawContentSupplyImport.test(await readFile(file, 'utf8'))) surfaceLeaks.push(relative('.', file));
}
assert.deepEqual(
  surfaceLeaks,
  [],
  'experience code must discover, install and read published content through the Content Supply System interface',
);

const interfaceSource = await readFile(join(contentSupplySystemDirectory, 'contentSupplySystem.ts'), 'utf8');
for (const hiddenDetail of ['VITE_SENSA_API_URL', '/sensa/packages', 'if-none-match', 'package-catalog']) {
  assert(!interfaceSource.includes(hiddenDetail), `${hiddenDetail} must remain behind the Content Supply interface`);
}

const learningInterface = await readFile('apps/web/src/learning/system/learningSystem.ts', 'utf8');
assert(
  !/interface LearningOverview[\s\S]*?packages:/u.test(learningInterface),
  'Learning overview must not own the Content Supply installed-package projection',
);
for (const leakedIntent of [
  'prepare_personal',
  'stop_personal_preparation',
  'update_personal_resources',
  'personal_tasks',
  'personal_control',
]) {
  assert(
    !learningInterface.includes(leakedIntent),
    `${leakedIntent} belongs to Content Supply, not the Learning System interface`,
  );
}
const learningImplementation = await readFile(
  'apps/web/src/learning/system/learningSystemImplementation.ts',
  'utf8',
);
assert(
  !learningImplementation.includes("data/library/personalLearning"),
  'Learning must request provisioning through the Content Supply handoff port',
);

const supplyInterface = await readFile(
  join(contentSupplySystemDirectory, 'contentSupplySystem.ts'),
  'utf8',
);
for (const ownedCapability of [
  'prepare_materialization',
  'stop_provisioning',
  'revise_provisioning',
  'provisioning_control',
]) {
  assert(supplyInterface.includes(ownedCapability), `Content Supply must own ${ownedCapability}`);
}

const learningStore = await readFile('apps/web/src/data/library/learning.ts', 'utf8');
assert(
  !learningStore.includes('sensaLearningMaterializationSnapshotSchema'),
  'Learning must consume admitted materializations instead of assembling Content Supply snapshots',
);

for (const recoveryFile of [
  'apps/web/src/data/library/backup.ts',
  'apps/web/src/data/library/cloudSyncService.ts',
]) {
  const source = await readFile(recoveryFile, 'utf8');
  assert(
    !source.includes("from './packages'"),
    `${recoveryFile} must repair public artifacts through Content Supply`,
  );
}

console.log('PASS: Content Supply owns Published, On-demand and Hybrid provisioning behind one deep interface.');
