import assert from 'node:assert/strict';
import {test} from 'vitest';

import { readRepositoryText, readTypeScriptSourceTree } from '../support/sourceTree.mts';

test('[contract][local-correctness] learner projection stays read-only and outside storage ownership', async () => {
  const files = await readTypeScriptSourceTree('apps/web/src');
  const experienceLeaks = files
    .filter(({ relativePath }) => relativePath.startsWith('apps/web/src/experience/'))
    .filter(({ source }) => /data\/library\/contentAnnotations/u.test(source))
    .map(({ relativePath }) => relativePath);
  assert.deepEqual(
    experienceLeaks,
    [],
    'experience code must use Personal Content and Learner Semantic Projection interfaces',
  );

  const personalContent = await readRepositoryText(
    'apps/web/src/personalContent/system/personalContentSystem.ts',
  );
  assert(
    !personalContent.includes("kind: 'semantic_anchor'"),
    'Personal Content must not counterfeit Personal Semantic Anchors',
  );
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

  const projection = await readRepositoryText(
    'apps/web/src/learnerSemanticProjection/system/learnerSemanticProjectionSystem.ts',
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

  const replicaRegistry = await readRepositoryText(
    'apps/web/src/data/library/replication/libraryReplica.ts',
  );
  assert(replicaRegistry.includes('personalContentReplica'), 'Personal Content must declare replica ownership');
  assert(!replicaRegistry.includes('learnerArtifactReplica'), 'the ambiguous Learner Artifact replica must not return');

  const semanticReplica = await readRepositoryText(
    'apps/web/src/data/library/replication/personalSemanticWorldReplica.ts',
  );
  assert(semanticReplica.includes("'media'"), 'Personal Semantic World must own its private media rows');
});
