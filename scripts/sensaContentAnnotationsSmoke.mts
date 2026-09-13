import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';

const root = await mkdtemp(join(tmpdir(), 'sensa-content-annotations-'));
const outfile = join(root, 'bundle.mjs');
Object.assign(globalThis, {
  indexedDB: new IDBFactory(),
  window: new EventTarget(),
  BroadcastChannel: undefined,
});

try {
  const result = await build({
    stdin: {
      contents: [
        "export * from './apps/web/src/data/library/store';",
        "export * from './apps/web/src/data/library/contentAnnotations';",
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  await writeFile(outfile, result.outputFiles[0]!.contents);
  const api = await import(pathToFileURL(outfile).href);
  await api.openLibrary();

  const annotation = api.contentAnnotations;
  await annotation.setNote('River', 'cross the river');
  await annotation.setSenseNote('sense:river', 'movement across water');
  assert.equal(annotation.getNote('river'), 'cross the river');
  assert.equal(annotation.getSenseNote('sense:river'), 'movement across water');

  assert.equal(await annotation.toggleSense('sense:river'), true);
  assert.equal(annotation.isSenseSaved('sense:river'), true);
  assert.equal(await annotation.toggleSense('sense:river'), false);
  assert.equal(annotation.isSenseSaved('sense:river'), false);
  assert.equal(await annotation.toggleExample('example:river'), true);

  const anchorId = crypto.randomUUID();
  await annotation.saveSemanticAnchor({
    anchorId,
    senseId: 'sense:river',
    body: 'The river beside my childhood home.',
    media: [],
  });
  assert.equal(annotation.getSemanticAnchor(anchorId)?.senseId, 'sense:river');

  const rows = await api.readLibrary((tx: any) => tx.all('annotations'));
  assert.equal(rows.length, 4);
  assert(rows.every((row: any) => row.kind !== 'saved_sense'));
  console.log('PASS: notes, saved content and personal scenes share the authoritative local Library.');
} finally {
  await rm(root, { recursive: true, force: true });
}
