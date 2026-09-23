import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateCsp} from '../../../scripts/release/releaseCandidate.mjs';

const hook=await readFile(new URL('../../../apps/web/src/experience/useYouglishWidget.ts',import.meta.url),'utf8');
assert.match(hook,/https:\/\/youglish\.com\/public\/emb\/widget\.js/u);
assert.match(hook,/if\(!active\|\|widgetRef\.current\)return/u);
assert.match(hook,/document\.createElement\('script'\)/u);
assert.match(hook,/script\.referrerPolicy = 'no-referrer'/u);
assert(!hook.includes('VITE_SENSA_YOUGLISH_ORIGIN'));
assert(!hook.includes('youglish-player.html'));

const productionCsp=candidateCsp();
assert.match(productionCsp,/script-src 'self' 'wasm-unsafe-eval' https:\/\/youglish\.com;/u);
assert.match(productionCsp,/frame-src 'self' https:\/\/youglish\.com;/u);
console.log('PASS: the official YouGlish Widget mounts lazily in its product surface without a second deployment origin or startup request.');
