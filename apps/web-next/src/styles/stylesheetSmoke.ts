/**
 * Deterministic smoke for the stylesheet split.
 *
 * `src/index.css` is now nothing but an ordered list of `@import`s. Adding a
 * file under `src/styles/` and forgetting to import it loses those rules
 * silently -- the build succeeds, and only the affected screen looks wrong. So
 * the directory and the import list are asserted to agree.
 *
 * Order is layering: the imports must stay in the sequence the single file had,
 * because later rules rely on appearing after earlier ones. That sequence is
 * pinned here, so a reorder has to be a deliberate edit to this list.
 *
 * Run with `npm run smoke:styles`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'index.css');

/** The layering order, pinned. Editing this is how the order is meant to change. */
const EXPECTED_ORDER = [
  'base.css',
  'shell-screens.css',
  'learning-flow.css',
  'overlays.css',
  'dictionary.css',
  'notes-scene.css',
  'spelling.css',
  'word-list.css',
  'stats.css',
  'content-library.css',
  'listening.css',
  'semantic-world.css',
  'learning-journey.css',
];

const failures: string[] = [];

const imported = [...readFileSync(entry, 'utf8').matchAll(/@import\s+'\.\/styles\/([^']+)'/g)]
  .map((match) => match[1]);

const onDisk = readdirSync(here)
  .filter((name) => name.endsWith('.css'))
  .sort();

if (imported.join(',') !== EXPECTED_ORDER.join(',')) {
  failures.push(
    `import 顺序与预期不符:\n    实际: ${imported.join(', ')}\n    预期: ${EXPECTED_ORDER.join(', ')}`,
  );
}

for (const name of onDisk) {
  if (!imported.includes(name)) {
    failures.push(`styles/${name} 未被 index.css 引入——其规则不会生效`);
  }
}

for (const name of imported) {
  if (!onDisk.includes(name)) failures.push(`index.css 引入了不存在的 styles/${name}`);
}

console.log(`stylesheet smoke: ${onDisk.length} 个分片, ${imported.length} 条 import`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
