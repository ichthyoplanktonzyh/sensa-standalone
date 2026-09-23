import {test} from 'vitest';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test("speech-provider", async () => {

const compiled=await build({
 stdin:{resolveDir:process.cwd(),contents:`export * from './apps/web/src/data/library/spokenResource'; export * from './apps/web/src/data/library/speech/defaultProvider'; export * from './apps/web/src/data/library/speech/edgeTtsClientProvider';`},
 bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},
});
const temp=await mkdtemp(join(tmpdir(),'sensa-client-speech-'));
await writeFile(join(temp,'speech.mjs'),compiled.outputFiles[0]!.text);

const sent:string[]=[];let openedUrl='';
class FakeWebSocket {
 static readonly CONNECTING=0;
 static readonly OPEN=1;
 static readonly CLOSED=3;
 readyState=FakeWebSocket.CONNECTING;
 binaryType='blob';
 onopen:((event:Event)=>void)|null=null;
 onmessage:((event:MessageEvent)=>void)|null=null;
 onerror:((event:Event)=>void)|null=null;
 onclose:((event:CloseEvent)=>void)|null=null;
 constructor(url:string){openedUrl=url;queueMicrotask(()=>{this.readyState=FakeWebSocket.OPEN;this.onopen?.(new Event('open'));});}
 send(value:string){
  sent.push(value);if(sent.length!==2)return;
  const header=new TextEncoder().encode('Content-Type:audio/mpeg\r\nPath:audio\r\n');
  const audio=Uint8Array.from([0xff,0xfb,0x90,0x64,0,1,2,3]);
  const frame=new Uint8Array(2+header.length+audio.length);
  frame[0]=header.length>>8;frame[1]=header.length&255;frame.set(header,2);frame.set(audio,2+header.length);
  queueMicrotask(()=>{
   this.onmessage?.(new MessageEvent('message',{data:frame.buffer}));
   this.onmessage?.(new MessageEvent('message',{data:'X-RequestId:fixture\r\nPath:turn.end\r\n\r\n'}));
  });
 }
 close(){this.readyState=FakeWebSocket.CLOSED;}
}

const original=globalThis.WebSocket;
Object.assign(globalThis,{WebSocket:FakeWebSocket});
try{
 const api=await import(pathToFileURL(join(temp,'speech.mjs')).href);
 assert.equal(api.activeClientSpeechProvider().id,'microsoft-edge-read-aloud');
 const edge=api.createEdgeTtsClientProvider({clock:()=>new Date('2026-09-21T00:01:00.000Z'),randomId:()=> '11111111-2222-4333-8444-555555555555'});
 const signal=new AbortController().signal;
 const sound=await edge.synthesize({surface:'put <up> & with',languageTag:'en'},signal);
 assert.equal(sound.surface,'put <up> & with');assert.equal(sound.languageTag,'en');assert.equal(sound.method,'tts');
 assert.match(sound.audioUrl,/^data:audio\/mpeg;base64,\/\//u);
 assert.match(openedUrl,/^wss:\/\/speech\.platform\.bing\.com\//u);
 assert.match(openedUrl,/Sec-MS-GEC=[A-F0-9]{64}/u);assert.match(openedUrl,/ConnectionId=11111111222243338444555555555555/u);
 assert.equal(sent.length,2);assert.match(sent[0]!,/Path:speech\.config/u);assert.match(sent[1]!,/Path:ssml/u);
 assert.match(sent[0]!,/X-Timestamp:Mon Sep 21 2026 00:01:00 GMT\+0000 \(Coordinated Universal Time\)/u);
 assert.match(sent[1]!,/put &lt;up&gt; &amp; with/u);assert.doesNotMatch(sent[1]!,/put <up>/u);
 await assert.rejects(()=>edge.synthesize({surface:'hola',languageTag:'es'},signal),/speech_language_unavailable/);
 await assert.rejects(async()=>edge.synthesize({surface:' ',languageTag:'en'},signal));

 let genericCalls=0;
 const restore=api.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>{genericCalls++;return {...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',source:'fixture',method:'tts',phoneticNotation:null,accentLabel:null};}});
 const generic=await api.prepareSpokenResource('borrow',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},signal);
 assert.equal(generic.source,'fixture');assert.equal(genericCalls,1);restore();
 const mismatched=api.replaceClientSpeechProvider({id:'bad',revision:1,displayName:'Bad',synthesize:async()=>({...generic,surface:'lend'})});
 await assert.rejects(api.prepareSpokenResource('borrow',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},signal),/spokenResourceUnavailable/);mismatched();
 console.log('PASS: provider-neutral client speech boundary, default Edge TTS wire adapter, saved bytes and exact identity; no external calls.');
}finally{
 Object.assign(globalThis,{WebSocket:original});
 await rm(temp,{recursive:true,force:true});
}

});
