import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sourceRoot = 'apps/web/src';
const sourceExtensions = /\.(?:ts|tsx)$/u;

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : sourceExtensions.test(entry.name) ? [path] : [];
  }))).flat();
};

const files = await sourceFiles(sourceRoot);
const experienceLeaks: string[] = [];
for (const file of files.filter((path) => path.startsWith(join(sourceRoot, 'experience/')))) {
  const source = await readFile(file, 'utf8');
  if (/data\/library\/contentAnnotations/u.test(source)) {
    experienceLeaks.push(relative('.', file));
  }
}
assert.deepEqual(
  experienceLeaks,
  [],
  'experience code must use Personal Content and Learner Semantic Projection interfaces',
);

const personalContent = await readFile(
  'apps/web/src/personalContent/system/personalContentSystem.ts',
  'utf8',
);
assert(!personalContent.includes("kind: 'semantic_anchor'"), 'Personal Content must not counterfeit Personal Semantic Anchors');
for (const command of [
  'set_saved_sense',
  'set_saved_example',
  'set_sense_note',
  'save_sense_context',
  'save_learning_scene',
  'mark_learning_scene_accepted',
]) {
  assert(personalContent.includes(command), `Personal Content must own ${command}`);
}

const projection = await readFile(
  'apps/web/src/learnerSemanticProjection/system/learnerSemanticProjectionSystem.ts',
  'utf8',
);
assert(
  /interface LearnerSemanticProjectionSystem[\s\S]*read\(\)[\s\S]*subscribe\(/u.test(projection),
  'Learner Semantic Projection must expose one read-only deep interface',
);
assert(
  !/interface LearnerSemanticProjectionSystem[\s\S]*execute\(/u.test(projection),
  'Learner Semantic Projection cannot accept commands or become a second source of truth',
);
assert(!projection.includes('data/library/'), 'the projection must compose domain interfaces, not storage tables');

const replicaRegistry = await readFile(
  'apps/web/src/data/library/replication/libraryReplica.ts',
  'utf8',
);
assert(replicaRegistry.includes('personalContentReplica'), 'Personal Content must declare replica ownership');
assert(!replicaRegistry.includes('learnerArtifactReplica'), 'the ambiguous Learner Artifact replica must not return');

const semanticReplica = await readFile(
  'apps/web/src/data/library/replication/personalSemanticWorldReplica.ts',
  'utf8',
);
assert(semanticReplica.includes("'media'"), 'Personal Semantic World must own its private media rows');

console.log('PASS: learner-owned facts and the read-only Learner Semantic Projection have explicit, non-overlapping boundaries.');
