import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KNOWN_SHEET_IDS, parseMainStack, buildPathname, parseViewMode } from '../apps/web/src/experience/router/shellLocation';
import { useOverlayStore } from '../apps/web/src/experience/stores/overlayStore';
import { usePresentationStore } from '../apps/web/src/experience/stores/presentationStore';

for (const path of ['/wordlist', '/academy/wordlist', '/s-wordlist', '/academy/wordlist/listening']) {
  assert.deepEqual(parseMainStack(path), ['s-study', 's-learning-library'], path);
}
assert.deepEqual(parseMainStack('/academy/listening'), ['s-academy']);
assert.deepEqual(parseMainStack('/listening'), ['s-academy']);
assert.deepEqual(parseMainStack('/academy/real-world-listening'), ['s-academy', 's-real-world-listening']);
const canonical = buildPathname(parseMainStack('/academy/wordlist'));
assert.equal(canonical, '/study/learning-library');
assert.deepEqual(parseMainStack(canonical), ['s-study', 's-learning-library']);
assert.equal(parseViewMode('fourStage'), 'fourStage', 'formal protocols remain unchanged');
assert.ok(!KNOWN_SHEET_IDS.some(id => id === 's-wordlist' as string || id === 's-listening' as string));
assert.ok(!('openSpelling' in useOverlayStore.getState()));
assert.ok(!('spellingWord' in useOverlayStore.getState()));
assert.ok(!('portableListening' in usePresentationStore.getState()));
assert.equal(typeof useOverlayStore.getState().openNoteEditor, 'function');
assert.equal(typeof useOverlayStore.getState().openSceneEditor, 'function');

const root = resolve('apps/web/src/experience');
for (const name of ['PortableListeningScreen', 'SensaPortableListeningScreen', 'SpellingModal', 'WordListScreen']) {
  assert.ok(!existsSync(resolve(root, 'components', name + '.tsx')), name + ' removed');
}
const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
assert.ok(!/PortableListeningScreen|SpellingModal|WordListScreen|openSpelling/.test(app));
assert.ok(app.includes('查看学习内容'));
assert.ok(app.includes("setMainStack(['s-study', 's-learning-library'])"));
assert.ok(app.includes('<YouGlishListeningScreen'));
assert.ok(app.includes('<NoteEditorModal'));
assert.ok(app.includes('<SceneEditorModal'));
console.log('Retired surfaces smoke passed: removed components/stores, word-list compatibility, listening fallback, preserved real-world listening, notes, scenes and formal flow. No data deletion or provider calls.');
