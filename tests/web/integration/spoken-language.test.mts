import {test} from 'vitest';
/** What the learner actually hears, in the language they are learning.
 *
 * Two providers speak for the learner: the device speech synthesizer and the
 * clip provider behind real-world listening. Both were asked for English no
 * matter which language was being studied. This exercises the real playback
 * service and the real clip-language mapping against a fake synthesizer and a
 * fake audio element, and asserts the learner's active target language decides
 * the spoken locale, the chosen voice and the corpus — never the interface.
 */
import assert from 'node:assert/strict';
import {sensaLanguages} from '@sensa/contracts/sensa';
import {indexedDB} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test("spoken-language", async () => {

const compiled=await build({
  stdin:{
    contents:[
      `export {audioService} from './apps/web/src/experience/services/audioService';`,
      `export {speechLocaleFor,clipAccentsFor,clipLanguageFor,activeSpeechLanguage,spokenLanguageSupport} from './apps/web/src/experience/services/speechLanguage';`,
      ...['store','language'].map(n=>`export * from './apps/web/src/data/library/${n}';`),
    ].join('\n'),
    resolveDir:process.cwd(),
  },
  bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},
});

/** The spoken utterances the fake synthesizer was asked for. */
const spoken:{text:string;lang:string;voice:string|undefined}[]=[];
/** Every audio element the service tried to play. */
const played:string[]=[];
const voices=[
  {name:'Samantha',lang:'en-US',localService:true},
  {name:'Daniel',lang:'en-GB',localService:true},
  {name:'Mónica',lang:'es-ES',localService:true},
  {name:'Google español',lang:'es-ES',localService:true},
  {name:'Kyoko',lang:'ja-JP',localService:true},
];
let speechFails=false,speechHeld=false;

class FakeUtterance {
  text:string;lang='';rate=1;pitch=1;voice:{name:string;lang:string}|null=null;
  onend:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(text:string){this.text=text;}
}
class FakeAudio {
  src:string;onended:(()=>void)|null=null;onerror:(()=>void)|null=null;playbackRate=1;paused=false;currentTime=0;
  constructor(src:string){this.src=src;played.push(src);}
  play(){return Promise.reject(new Error('fixture audio cannot play'));}
  pause(){}
}
const speechSynthesis=Object.assign(new EventTarget(),{
  getVoices:()=>voices,
  speak:(utterance:FakeUtterance)=>{spoken.push({text:utterance.text,lang:utterance.lang,voice:utterance.voice?.name});queueMicrotask(()=>{if(speechFails)utterance.onerror?.();else if(!speechHeld)utterance.onend?.();});},
  cancel(){},
  pause(){},
  resume(){},
  speaking:false,
  paused:false,
});
/** The library broadcasts on `window`, so the stub has to be a real event
 * target as well as the synthesizer holder. */
const fakeWindow=new EventTarget() as EventTarget&{speechSynthesis:typeof speechSynthesis};
fakeWindow.speechSynthesis=speechSynthesis;
Object.assign(globalThis,{
  indexedDB,
  window:fakeWindow as unknown as Window&typeof globalThis,
  SpeechSynthesisUtterance:FakeUtterance,
  Audio:FakeAudio,
  location:{origin:'http://127.0.0.1:9997'},
  BroadcastChannel:undefined,
});
const requested:string[]=[];
globalThis.fetch=async(url:string|URL|Request)=>{
  const href=typeof url==='string'?url:url instanceof URL?url.href:url.url;
  requested.push(href);
  return new Response('{}',{status:404});
};

const temp=await mkdtemp(join(tmpdir(),'sensa-spoken-'));
await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID();

try{
  const library=await api.openLibrary(),accountId=id();
  await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:accountId,accountId}));

  // Every language the product carries can be spoken and searched for, and the
  // clip provider is asked for a language it actually has.
  const clipLanguages=new Set(['english','spanish','french','german','italian','portuguese','russian','chinese','japanese','korean','arabic','dutch','polish','turkish','thai','vietnamese','indonesian','hindi']);
  for(const language of sensaLanguages){
    assert.equal(api.speechLocaleFor(language.tag),language.speechLocale);
    assert.ok(/^[a-z]{2}-[A-Z]{2}$/u.test(api.speechLocaleFor(language.tag)),`${language.tag} names a locale a synthesizer can match`);
    assert.ok(clipLanguages.has(api.clipLanguageFor(language.tag)),`${language.tag} is searchable in the clip corpus`);
    assert.deepEqual(api.clipAccentsFor(language.tag),language.wiktionaryCode==='en'?['all','us','uk','aus','ca','ie']:['all'],`${language.tag} only offers accent filters its corpus has`);
  }
  assert.equal(api.clipLanguageFor('zh-CN'),'chinese','a catalog name carrying its script still names the corpus language');
  assert.equal(api.spokenLanguageSupport('en-US').status,'fallback','a regional tag uses an explicit catalog fallback without changing its identity');
  assert.equal(api.speechLocaleFor('en-US'),'en-US');
  assert.equal(api.spokenLanguageSupport('xx-unknown').status,'unavailable');
  assert.throws(()=>api.clipLanguageFor('xx-unknown'),/languageCapabilityUnavailable/u,'an unplaceable language is unavailable rather than silently becoming English');

  // The shipped pair: English, and the two English accents still choose between
  // the locales English actually has.
  const shipped=await api.activeSpeechLanguage();
  assert.equal(shipped.languageTag,'en','the shipped active Route decides before anything is stored');
  assert.equal(shipped.speechLocale,'en-US');
  await api.audioService.playSpeechSynthesis('hello','us');
  assert.equal(spoken.at(-1)!.lang,'en-US');
  assert.equal(spoken.at(-1)!.voice,'Samantha','an English voice is preferred by name');
  await api.audioService.playSpeechSynthesis('hello','uk');
  assert.equal(spoken.at(-1)!.lang,'en-GB');
  assert.equal(spoken.at(-1)!.voice,'Daniel');

  // Missing approved media stays on-device; reference playback never reaches an
  // unlicensed dictionary voice endpoint.
  const playedBeforeEnglishWord=played.length;
  await api.audioService.playWord('hello','us');
  assert.equal(played.length,playedBeforeEnglishWord,'an English word without Package media must not make a network audio request');
  assert.equal(spoken.at(-1)!.lang,'en-US');
  assert.equal(spoken.at(-1)!.text,'hello');

  // Choosing Spanish changes what every later playback speaks, with no call site
  // passing a language.
  const englishRoute=(await api.languageRoutesSnapshot()).activeRoute;
  const spanishRoute=await api.addLanguageRoute(id(),'es','zh-CN');
  await api.setActiveLanguageRoute(id(),spanishRoute.id);
  assert.equal((await api.activeSpeechLanguage()).speechLocale,'es-ES');

  const playedBefore=played.length;
  await api.audioService.playWord('hola','us');
  assert.equal(played.length,playedBefore,'no English dictionary voice answers for a Spanish word');
  assert.equal(spoken.at(-1)!.lang,'es-ES','the word is spoken in its own language');
  assert.equal(spoken.at(-1)!.voice,'Mónica','a voice installed for that locale is chosen');
  assert.equal(spoken.at(-1)!.text,'hola');

  await api.audioService.playSentence('¿Cómo estás?','us');
  assert.equal(spoken.at(-1)!.lang,'es-ES');
  assert.equal(spoken.at(-1)!.text,'¿Cómo estás?','the sentence is spoken unchanged');

  // A recorded asset still plays, and its fallback voice is the learner's.
  await api.audioService.playAudioUrl('https://example.invalid/hola.mp3','hola','us');
  assert.ok(played.at(-1)?.endsWith('/hola.mp3'),'a recorded asset is played as given');
  assert.equal(spoken.at(-1)!.lang,'es-ES','the fallback voice follows the target language too');

  // Reference carries its own language. Changing the Route cannot change that
  // source, or silently turn a broken provider recording into another voice.
  await api.audioService.playReferencePronunciation({text:'hello',languageTag:'en'});
  assert.equal(spoken.at(-1)!.lang,'en-US');assert.equal(spoken.at(-1)!.voice,'Samantha');
  assert.equal((await api.activeSpeechLanguage()).speechLocale,'es-ES','Reference playback never changes the Route');
  await api.audioService.playReferencePronunciation({text:'hello',languageTag:'en-GB'});assert.equal(spoken.at(-1)!.lang,'en-GB');assert.equal(spoken.at(-1)!.voice,'Daniel');
  const beforeMissing=spoken.length;
  await assert.rejects(api.audioService.playReferencePronunciation({text:'bonjour',languageTag:'fr'}),/reference_pronunciation_unavailable/u);
  await assert.rejects(api.audioService.playReferencePronunciation({text:'unknown',languageTag:'xx-unknown'}),/reference_pronunciation_unavailable/u);
  const savedVoices=voices.splice(0);
  try{await assert.rejects(api.audioService.playReferencePronunciation({text:'hello',languageTag:'en'}),/reference_pronunciation_unavailable/u);}
  finally{voices.push(...savedVoices);}
  assert.equal(spoken.length,beforeMissing,'missing source voices never ask the browser to guess a voice');
  const delayedVoices=voices.splice(0);
  try{
    const reading=api.audioService.playReferencePronunciation({text:'hello',languageTag:'en'});
    assert.equal(spoken.length,beforeMissing,'an initially empty inventory does not guess a voice');
    voices.push(...delayedVoices);speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    await reading;
    assert.equal(spoken.at(-1)!.voice,'Samantha','voiceschanged enables the actual source voice');
    voices.splice(0);
    const cancelled=api.audioService.playReferencePronunciation({text:'never speak',languageTag:'en'});
    api.audioService.stop();await cancelled;
    const beforeCancelled=spoken.length;
    voices.push(...delayedVoices);speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    await Promise.resolve();assert.equal(spoken.length,beforeCancelled,'stop settles the inventory wait without late speech');
    voices.splice(0);
    const readyThenStopped=api.audioService.playReferencePronunciation({text:'also never speak',languageTag:'en'});
    voices.push(...delayedVoices);speechSynthesis.dispatchEvent(new Event('voiceschanged'));api.audioService.stop();
    await readyThenStopped;assert.equal(spoken.length,beforeCancelled,'stop also wins after inventory arrival but before the playback continuation');
  }finally{voices.splice(0,voices.length,...delayedVoices);}
  const beforeBrokenRecording=spoken.length;
  await assert.rejects(api.audioService.playReferencePronunciation({text:'hello',languageTag:'en',audioUrl:'https://example.invalid/broken-reference.mp3'}),/reference_pronunciation_unavailable/u);
  assert.equal(spoken.length,beforeBrokenRecording,'a failed source recording is not silently replaced with TTS');
  speechFails=true;
  try{await assert.rejects(api.audioService.playReferencePronunciation({text:'hello',languageTag:'en'}),/reference_pronunciation_unavailable/u);}finally{speechFails=false;}
  speechHeld=true;
  try{const reading=api.audioService.playReferencePronunciation({text:'hello',languageTag:'en'});api.audioService.stop();await reading;}finally{speechHeld=false;}

  // Back to English: nothing about the switch is cached past a playback.
  await api.setActiveLanguageRoute(id(),englishRoute.id);
  await api.audioService.playSpeechSynthesis('hello','us');
  assert.equal(spoken.at(-1)!.lang,'en-US','the next playback belongs to the newly chosen language');

  console.log('PASS: device speech and clip lookup follow the learner\u2019s active target language \u2014 locale, voice, corpus and accent filters \u2014 without an unlicensed dictionary audio request.');
}finally{
  await rm(temp,{recursive:true,force:true});
}

});
