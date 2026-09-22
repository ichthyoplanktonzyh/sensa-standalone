import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const contentSupplySystemDirectory = join(sourceRoot, 'contentSupply/system/');
const sourceExtensions = /\.(?:ts|tsx)$/u;
const rawContentSupplyImport = /['"][^'"]*\/data\/library\/(?:packages|packageRecords)(?:\.ts)?['"]/u;

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

console.log('PASS: Content Supply exposes one deep application interface and keeps catalog, transfer and cache details behind it.');
