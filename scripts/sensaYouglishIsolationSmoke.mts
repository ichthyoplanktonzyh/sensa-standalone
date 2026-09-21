import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseYouglishBridgeEvent} from '../apps/web/src/experience/useYouglishWidget.ts';
import {candidateCsp,youglishPlayerCsp} from './release/releaseCandidate.mjs';

const id=crypto.randomUUID();
assert(parseYouglishBridgeEvent({channel:'sensa.youglish.v1',type:'fetched',requestId:id,totalResults:4}));
assert(!parseYouglishBridgeEvent({channel:'sensa.youglish.v1',type:'fetched',requestId:id,totalResults:4,html:'<script>'}));
assert(!parseYouglishBridgeEvent({channel:'sensa.youglish.v1',type:'fetched',requestId:'not-a-uuid',totalResults:4}));

const hook=await readFile(new URL('../apps/web/src/experience/useYouglishWidget.ts',import.meta.url),'utf8');
assert.match(hook,/event\.source!==frame\.contentWindow\|\|event\.origin!==endpoint\.origin/u);
assert.match(hook,/sandbox','allow-scripts allow-same-origin allow-presentation'/u);
assert(!hook.includes('youglish.com/public/emb/widget.js'),'the Web origin must never load the provider script');
assert.match(hook,/VITE_SENSA_YOUGLISH_ORIGIN/u);
const player=await readFile(new URL('../apps/web/src/youglishPlayer.ts',import.meta.url),'utf8');
assert.match(player,/event\.source!==parent\|\|event\.origin!==parentOrigin/u);
assert.match(player,/parent\.postMessage\(\{channel,type:'ready'\},parentOrigin\)/u);
assert.match(player,/VITE_SENSA_WEB_ORIGIN/u);
assert.match(player,/https:\/\/youglish\.com\/public\/emb\/widget\.js/u);
const productionCsp=candidateCsp('https://player.example.com');
assert.match(productionCsp,/script-src 'self' 'wasm-unsafe-eval';/u);
assert(!productionCsp.includes('script-src \'self\' \'wasm-unsafe-eval\' https://youglish.com'));
assert.match(productionCsp,/frame-src https:\/\/player\.example\.com;/u);
const playerCsp=youglishPlayerCsp('https://learn.example.com');
assert.match(playerCsp,/script-src 'self' https:\/\/youglish\.com/u);assert.match(playerCsp,/frame-ancestors https:\/\/learn\.example\.com$/u);
console.log('PASS: YouGlish runs only on a dedicated player origin with strict parent/source/protocol checks; the Sensa page loads no provider script.');
