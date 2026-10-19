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
 assert.match(openedUrl,/Sec-MS-GEC=[A-F0-9]{16}-[A-F0-9]{64}/u);assert.match(openedUrl,/ConnectionId=11111111222243338444555555555555/u);
 assert.equal(sent.length,2);assert.match(sent[0]!,/Path:speech\.config/u);assert.match(sent[1]!,/Path:ssml/u);
 assert.match(sent[0]!,/X-Timestamp:Mon Sep 21 2026 00:01:00 GMT\+0000 \(Coordinated Universal Time\)/u);
 assert.match(sent[1]!,/put &lt;up&gt; &amp; with/u);assert.doesNotMatch(sent[1]!,/put <up>/u);
 sent.splice(0);
 const spanish=await edge.synthesize({surface:'hola',languageTag:'es'},signal);
 assert.equal(spanish.languageTag,'es');
 assert.match(sent[1]!,/xml:lang='es-ES'/u);
 assert.match(sent[1]!,/name='es-ES-ElviraNeural'/u);
 assert.match(spanish.source,/es-ES-ElviraNeural/u);
 openedUrl='';
 await assert.rejects(()=>edge.synthesize({surface:'你好',languageTag:'zh-TW'},signal),/speech_language_unavailable/);
 assert.equal(openedUrl,'','an unsupported script must fail before opening a speech socket');
 await assert.rejects(async()=>edge.synthesize({surface:' ',languageTag:'en'},signal));

 let genericCalls=0;
 const restore=api.replaceClientSpeechProvider({id:'fixture',revision:1,displayName:'Fixture',synthesize:async(input:any)=>{genericCalls++;return {...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',source:'fixture',method:'tts',phoneticNotation:null,accentLabel:null};}});
 const generic=await api.prepareSpokenResource('borrow',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},signal);
 assert.equal(generic.source,'fixture');assert.equal(genericCalls,1);restore();
 const mismatched=api.replaceClientSpeechProvider({id:'bad',revision:1,displayName:'Bad',synthesize:async()=>({...generic,surface:'lend'})});
 await assert.rejects(api.prepareSpokenResource('borrow',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},signal),/spokenResourceUnavailable/);mismatched();
 for(const message of ['edge_tts_connection_failed','edge_tts_empty_audio','speech_language_unavailable','localFlow.authUnavailable']){
  const restoreFailure=api.replaceClientSpeechProvider({id:'failed',revision:1,displayName:'Failed',synthesize:async()=>{throw Error(message);}});
  try{await assert.rejects(api.prepareSpokenResource('phone',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},signal),message==='localFlow.authUnavailable'?/authUnavailable/:/spokenResourceUnavailable/);}finally{restoreFailure();}
 }
 const cancelled=new AbortController();cancelled.abort();
 const restoreAbort=api.replaceClientSpeechProvider({id:'aborted',revision:1,displayName:'Aborted',synthesize:async()=>{throw Error('edge_tts_connection_failed');}});
 try{await assert.rejects(api.prepareSpokenResource('phone',{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},cancelled.signal),error=>error===cancelled.signal.reason);}finally{restoreAbort();}
 console.log('PASS: provider-neutral client speech boundary, default Edge TTS wire adapter, saved bytes and exact identity; no external calls.');
}finally{
 Object.assign(globalThis,{WebSocket:original});
 await rm(temp,{recursive:true,force:true});
}

});

// Vectors independently calculated with edge-tts 7.3.0's reference implementation.
test('Edge Read Aloud v2 protocol vectors include the five-minute rollover', async () => {
 const {edgeSpeechConnectionUrl}=await import('@sensa/contracts/speech/edge-read-aloud');
 const vectors=[
  ['2026-09-21T00:01:00Z','F57C9AAC46669946-288FD147551925388A222EBF92CD4D0200E826848A1047DAD108C1364D7C52D4'],
  ['2026-10-19T07:15:00Z','E2219CFD3FDE9189-294A63DB992EDD3AA136D2D10E6F60D6833BFF9D930F00AE558D8D5CFA9DCDA7'],
  ['2026-10-19T07:19:59Z','E2219CFD3FDE9189-294A63DB992EDD3AA136D2D10E6F60D6833BFF9D930F00AE558D8D5CFA9DCDA7'],
  ['2026-10-19T07:20:00Z','4BF669ACBA5D04CC-F0C3F544CB9EFA4A7D67EFFD13D9F6AFE6C76D94E672D86D45463FF4EAC13D82'],
 ];
 for(const [time,token] of vectors){
  const url=edgeSpeechConnectionUrl(new Date(time!),'11111111-2222-4333-8444-555555555555');
  assert.equal(url.searchParams.get('Sec-MS-GEC'),token);
  assert.equal(url.searchParams.get('Sec-MS-GEC-Version'),'2-143.0.3650.75');
 }
 assert.throws(()=>edgeSpeechConnectionUrl(new Date(NaN),'fixture'),/invalid_clock/);
});

test('server speech transport negotiates v2, saves bounded audio and rejects failed or cancelled turns', async () => {
 const {WebSocket,WebSocketServer}=await import('ws');
 const {synthesizeEdgeSpeech}=await import('../../../apps/api/src/sensa/speech/edgeTts.js');
 const {once}=await import('node:events');
 const {failureDiagnostics}=await import('../../../apps/api/src/server/failureDiagnostics.js');
 let mode:'audio'|'empty'|'oversized'|'closed'|'cancel'|'rejected'|'invalid'='audio';
 const server=new WebSocketServer({host:'127.0.0.1',port:0,verifyClient:(_info,done)=>done(mode!=='rejected',403)});
 await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 server.on('connection',(socket,request)=>{
  assert.match(request.headers.cookie??'',/^muid=[A-F0-9]{32};$/u);
  let messages=0;
  socket.on('message',data=>{
   messages++;
   assert.match(String(data),/X-Timestamp:Mon Oct 19 2026 07:15:00 GMT\+0000 \(Coordinated Universal Time\)/u);
   if(messages!==2)return;
   assert.match(String(data),/Time\)Z\r\nPath:ssml/u);
   assert.match(String(data),/phone &amp; &lt;test&gt;/u);
   if(mode==='cancel')return;
   if(mode==='closed'){socket.close(1011,'private provider reason must not be logged');return;}
   if(mode==='invalid'){socket.send(Buffer.from([0]));return;}
   if(mode!=='empty'){
    const header=Buffer.from('Path:audio\r\nContent-Type:audio/mpeg\r\n');
    const audio=mode==='oversized'?Buffer.alloc(2_000_001):Buffer.from([0xff,0xfb,0x90,0x64]);
    const frame=Buffer.alloc(2+header.length+audio.length);frame.writeUInt16BE(header.length);header.copy(frame,2);audio.copy(frame,2+header.length);socket.send(frame);
   }
   socket.send('Path:turn.end\r\n\r\n');
  });
 });
 const dependencies={clock:()=>new Date('2026-10-19T07:15:00Z'),socket:(url:URL,options:import('ws').ClientOptions)=>{
  assert.equal(url.searchParams.get('Sec-MS-GEC'),'E2219CFD3FDE9189-294A63DB992EDD3AA136D2D10E6F60D6833BFF9D930F00AE558D8D5CFA9DCDA7');
  return new WebSocket(`ws://127.0.0.1:${address.port}`,options);
 }};
 const input={surface:'phone & <test>',voice:'en-US-AriaNeural',locale:'en-US'};
 try{
  assert.deepEqual(await synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),Buffer.from([0xff,0xfb,0x90,0x64]));
  mode='empty';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),error=>{assert.deepEqual(failureDiagnostics(error),{failureKind:'transport',failureCode:'EDGE_TTS_EMPTY_AUDIO',failurePhase:'synthesis'});return true;});
  mode='oversized';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),/audio_too_large/);
  mode='closed';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),error=>{assert.deepEqual(failureDiagnostics(error),{failureKind:'transport',failureCode:'EDGE_TTS_CONNECTION_CLOSED',failurePhase:'synthesis',upstreamCloseCode:1011});return true;});
  mode='rejected';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),error=>{assert.deepEqual(failureDiagnostics(error),{failureKind:'transport',failureCode:'EDGE_TTS_HANDSHAKE_REJECTED',failurePhase:'connect',upstreamStatus:403});return true;});
  mode='invalid';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(3000),dependencies),error=>{assert.equal(failureDiagnostics(error).failureCode,'EDGE_TTS_INVALID_AUDIO');return true;});
  mode='cancel';await assert.rejects(synthesizeEdgeSpeech(input,AbortSignal.timeout(50),dependencies),error=>{assert.equal(failureDiagnostics(error).failureCode,'EDGE_TTS_TIMEOUT');return true;});
 }finally{for(const socket of server.clients)socket.terminate();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
