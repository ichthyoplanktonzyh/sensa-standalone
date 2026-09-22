import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';

const root = await mkdtemp(join(tmpdir(), 'sensa-personal-content-'));
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
        "export * from './apps/web/src/personalContent/system';",
        "export * from './apps/web/src/personalContent/system/personalContentAuthority';",
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

  const personalContent = api.personalContentSystem;
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across water',
  });
  assert.equal(
    personalContent.read({ kind: 'sense', senseId: 'sense:river' }).note,
    'movement across water',
  );
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across water',
  });
  const unchangedNote = await api.readLibrary((tx: any) => tx.get('annotations', 'sense_note:sense%3Ariver'));
  assert.equal(unchangedNote.revision, 1, 'identical note saves do not invent revisions');
  await personalContent.execute({
    kind: 'set_sense_note',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    body: 'movement across the river',
  });
  const revisedNote = await api.readLibrary((tx: any) => tx.get('annotations', 'sense_note:sense%3Ariver'));
  assert.equal(revisedNote.revision, 2);

  assert.equal(await personalContent.execute({
    kind: 'set_saved_sense',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    saved: true,
  }), true);
  assert.equal(personalContent.read({ kind: 'sense', senseId: 'sense:river' }).saved, true);
  assert.equal(await personalContent.execute({
    kind: 'set_saved_sense',
    operationId: crypto.randomUUID(),
    senseId: 'sense:river',
    saved: false,
  }), false);
  assert.equal(personalContent.read({ kind: 'sense', senseId: 'sense:river' }).saved, false);
  assert.equal(await personalContent.execute({
    kind: 'set_saved_example',
    operationId: crypto.randomUUID(),
    exampleId: 'example:river',
    saved: true,
  }), true);

  const contextId = crypto.randomUUID();
  await personalContent.execute({
    kind: 'save_sense_context',
    operationId: crypto.randomUUID(),
    contextId,
    senseId: 'sense:river',
    body: 'The river beside my childhood home.',
    media: [],
  });
  assert.equal(
    personalContent.read({ kind: 'sense_context', contextId })?.senseId,
    'sense:river',
  );
  await assert.rejects(
    api.command({id:crypto.randomUUID(),kind:'personal_content.test_invalid',input:{}},async(tx:any)=>{
      const key=`sense_context:${encodeURIComponent(contextId)}`;
      const current=await tx.get('annotations',key);
      tx.put('annotations',key,{...current,senseId:'sense:rewritten',revision:current.revision+1});
      await api.assertPersonalContentChanges(tx);
    }),
    /annotationInvalid/,
    'authority rejects changing a Sense Context identity',
  );

  const rows = await api.readLibrary((tx: any) => tx.all('annotations'));
  assert.equal(rows.length, 3);
  assert(rows.every((row: any) => row.kind !== 'saved_sense'));
  assert(rows.every((row: any) => row.kind !== 'semantic_anchor'));
  console.log('PASS: Personal Content commands own saved references, notes and Sense Context Notes behind one interface.');
} finally {
  await rm(root, { recursive: true, force: true });
}
