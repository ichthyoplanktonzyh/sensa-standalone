import {test} from 'vitest';
/** A voice is chosen by the language of the text, never by anything else.
 *
 * The panel used to ask for an English voice whatever the learner was reading,
 * so a learner of Spanish was told their browser had no English voice and a
 * Chinese sentence was read with an English accent. This drives the real module
 * against a stand-in synthesizer, because what matters is not that a sound came
 * out but which language it was asked for: a word read with the wrong voice is a
 * wrong pronunciation presented as the word's. A learner's own voice choice is
 * honoured where it can pronounce the language and ignored where it cannot.
 */
import assert from 'node:assert/strict';

test("extension-speech", async () => {

interface FakeVoice {name: string; lang: string; localService: boolean}
const voice = (name: string, lang: string, localService = true): FakeVoice => ({name, lang, localService});

let installed: FakeVoice[] = [];
let spoken: {text: string; lang: string; rate: number; voice: string}[] = [];
let cancels = 0;
const synthesis = {
  getVoices: () => installed,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  cancel: () => { cancels++; },
  speak: (utterance: {text: string; lang: string; rate: number; voice: FakeVoice | null}) => {
    spoken.push({text: utterance.text, lang: utterance.lang, rate: utterance.rate, voice: utterance.voice?.name ?? ''});
  },
};
class FakeUtterance {
  text: string; lang = ''; rate = 1; pitch = 1;
  voice: FakeVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
Object.assign(globalThis, {
  window: {speechSynthesis: synthesis},
  SpeechSynthesisUtterance: FakeUtterance,
});
// `navigator` is a getter on this runtime, and the extension's message table
// reads it to decide which language to speak to the learner in.
Object.defineProperty(globalThis, 'navigator', {value: {language: 'zh-CN'}, configurable: true});
const {speakText, speechFailureText, speechLocaleFor} = await import('../../../apps/browser-extension/src/speech.ts');

// The locale a synthesizer is asked for comes from the catalog, because a bare
// language subtag matches no installed voice on most systems.
assert.equal(speechLocaleFor('en'), 'en-US');
assert.equal(speechLocaleFor('es'), 'es-ES');
assert.equal(speechLocaleFor('zh-CN'), 'zh-CN');
assert.equal(speechLocaleFor('ja'), 'ja-JP');
assert.equal(speechLocaleFor(null), null);
assert.equal(speechLocaleFor('yue'), null, 'a language this release cannot place has no locale, and nothing is guessed');

installed = [voice('Samantha', 'en-US'), voice('Daniel', 'en-GB'), voice('Mónica', 'es-ES'), voice('Ting-Ting', 'zh-CN')];
spoken = [];

// The text's own language decides the voice, and the voice's own locale is what
// the synthesizer is asked for.
const english = await speakText('She took her time.', 'en', {rate: 1});
assert.deepEqual(spoken, [{text: 'She took her time.', lang: 'en-US', rate: 0.92, voice: 'Samantha'}]);
assert.ok(english.ok);
// A learner's speed setting is theirs; the slight slowdown is the reading pace.
await speakText('Ella se tomó su tiempo.', 'es', {rate: 1.5});
assert.deepEqual({...spoken[1], rate: Number(spoken[1]!.rate.toFixed(3))}, {text: 'Ella se tomó su tiempo.', lang: 'es-ES', rate: 1.38, voice: 'Mónica'});
await speakText('这段话。', 'zh-CN', {rate: 0.5});
assert.deepEqual({...spoken[2], rate: Number(spoken[2]!.rate.toFixed(3))}, {text: '这段话。', lang: 'zh-CN', rate: 0.46, voice: 'Ting-Ting'});
// Out of range is clamped rather than passed on.
await speakText('One more.', 'en', {rate: 9});
assert.equal(Number(spoken[3]!.rate.toFixed(3)), 1.84);

// Only voices that live on the machine: a network voice would be a request the
// learner did not ask for.
installed = [voice('Remote English', 'en-US', false)];
assert.deepEqual(await speakText('Hello.', 'en'), {ok: false, reason: 'no_voice', languageTag: 'en'});
assert.equal(spoken.length, 4, 'nothing was spoken with a voice that is not installed');

// A language with no installed voice says so, naming the language, rather than
// falling back to a voice that cannot pronounce it.
installed = [voice('Samantha', 'en-US')];
const missing = await speakText('Ella se tomó su tiempo.', 'es');
assert.deepEqual(missing, {ok: false, reason: 'no_voice', languageTag: 'es'});
if (missing.ok) throw new Error('unreachable');
assert.match(speechFailureText(missing), /西班牙语/, 'the message names the voice that is missing');

// A voice the learner chose is used when it can pronounce this language, and not
// otherwise: using a Spanish voice for Japanese because it is the chosen one
// would be exactly the wrong pronunciation this module refuses to produce.
installed = [voice('Samantha', 'en-US'), voice('Daniel', 'en-GB'), voice('Mónica', 'es-ES')];
spoken = [];
const chosen = await speakText('She took her time.', 'en', {rate: 1, voice: 'Daniel'});
assert.equal(chosen.ok, true);
assert.deepEqual(spoken, [{text: 'She took her time.', lang: 'en-US', rate: 0.92, voice: 'Daniel'}], 'a chosen voice that can pronounce the language is the one used');
await speakText('Ella se tomó su tiempo.', 'es', {rate: 1, voice: 'Daniel'});
assert.equal(spoken[1]!.voice, 'Mónica', 'a voice chosen for another language is ignored rather than obeyed');
await speakText('Ella se tomó su tiempo.', 'es', {rate: 1, voice: 'Voice That Is Not Here'});
assert.equal(spoken[2]!.voice, 'Mónica', 'a name this machine does not have falls back to the platform choice');

// A text whose language nobody established is not read aloud in some other
// language, and it says which situation this is.
const unplaced = await speakText('hola', null);
assert.deepEqual(unplaced, {ok: false, reason: 'no_language', languageTag: null});
if (unplaced.ok) throw new Error('unreachable');
assert.match(speechFailureText(unplaced), /语言尚未确定/);

// A language whose only voices are regional is still spoken: the full locale is
// preferred, and the language subtag is the fallback rather than a refusal.
installed = [voice('Paulina', 'es-MX'), voice('Mónica', 'es-ES')];
spoken = [];
await speakText('Hola.', 'es');
assert.equal(spoken[0]!.lang, 'es-ES');
assert.equal(spoken[0]!.voice, 'Mónica');
installed = [voice('Paulina', 'es-MX')];
await speakText('Hola.', 'es');
assert.equal(spoken[1]!.lang, 'es-ES', 'the locale the catalog carries is what a synthesizer is asked for');

// Stopping is a state the caller can hold, and a finished utterance does not
// report back into a panel that has already moved on.
installed = [voice('Samantha', 'en-US')];
spoken = [];
cancels = 0;
let ended = 0;
const attempt = await speakText('One.', 'en', {onEnd: () => { ended++; }});
assert.ok(attempt.ok);
if (!attempt.ok) throw new Error('unreachable');
attempt.stop();
assert.equal(cancels, 2, 'one cancel cleared what came before, and stopping cancelled this one');
assert.equal(ended, 0, 'the caller stopped it, so it is not also reported as finished');

console.log('PASS: reading aloud speaks in the language of the text and nothing else — locale from the catalog, an unplaceable language refused instead of guessed, installed voices only, the full locale preferred over the bare subtag, the learner\'s rate clamped, and every failure named so the surface can say which one it was. Stand-in synthesizer; no sound, no network.');

});
