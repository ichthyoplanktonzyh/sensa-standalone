import {edgeSpeechConnectionUrl,edgeSpeechWireDate} from '@sensa/contracts/speech/edge-read-aloud';
import {clientSpeechInputSchema,type ClientSpeechInput,type ClientSpeechMaterial,type ClientSpeechProvider} from './provider';
import {edgeVoiceByLanguage} from './edgeVoiceCatalog';
import {auth} from '../../account/auth';
import {captureAccountSessionBoundary,assertAccountSessionBoundary} from '../../account/accountSessionBoundary';

const MAX_AUDIO_BYTES=2_000_000;

type SocketFactory=(url:string)=>WebSocket;
type EdgeTtsDependencies=Readonly<{socket?:SocketFactory;clock?:()=>Date;randomId?:()=>string}>;

const escapeXml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function audioFrame(data:ArrayBuffer){
 const bytes=new Uint8Array(data);
 if(bytes.byteLength<2)throw Error('edge_tts_invalid_audio_frame');
 const headerLength=(bytes[0]!<<8)|bytes[1]!;
 if(headerLength+2>bytes.byteLength)throw Error('edge_tts_invalid_audio_frame');
 const header=new TextDecoder().decode(bytes.subarray(2,headerLength+2));
 if(!/(?:^|\r\n)Path:audio(?:\r\n|$)/u.test(header)||/(?:^|\r\n)Content-Type:(?!audio\/mpeg(?:\r\n|$))/u.test(header))throw Error('edge_tts_invalid_audio_frame');
 return bytes.slice(headerLength+2);
}

function dataUrl(chunks:readonly Uint8Array[],size:number){
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let binary='';
 for(let start=0;start<bytes.length;start+=0x8000)binary+=String.fromCharCode(...bytes.subarray(start,start+0x8000));
 return `data:audio/mpeg;base64,${btoa(binary)}`;
}

async function synthesizeEdge(input:ClientSpeechInput,signal:AbortSignal,dependencies:EdgeTtsDependencies):Promise<ClientSpeechMaterial>{
 const selection=edgeVoiceByLanguage.get(input.languageTag);
 if(!selection)throw Error('speech_language_unavailable');
 const randomId=dependencies.randomId??(()=>crypto.randomUUID());
 const now=dependencies.clock?.()??new Date();
 const requestId=randomId().replaceAll('-','');
 const url=edgeSpeechConnectionUrl(now,randomId()).toString();
 signal.throwIfAborted();
 const socket=(dependencies.socket??(address=>new WebSocket(address)))(url);
 socket.binaryType='arraybuffer';
 return new Promise<ClientSpeechMaterial>((resolve,reject)=>{
  const chunks:Uint8Array[]=[];let size=0,settled=false,turnEnded=false,messageQueue=Promise.resolve();
  const finish=(error?:Error)=>{
   if(settled)return;settled=true;signal.removeEventListener('abort',cancel);
   if(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING)socket.close();
   if(error){reject(error);return;}
   if(!turnEnded||size===0){reject(Error('edge_tts_empty_audio'));return;}
   resolve({
    surface:input.surface,languageTag:input.languageTag,
    audioUrl:dataUrl(chunks,size),method:'tts',phoneticNotation:null,accentLabel:selection.locale,
    source:JSON.stringify({provider:'microsoft-edge-read-aloud',providerRevision:1,voice:selection.voice,locale:selection.locale,rate:'+0%',format:'audio-24khz-48kbitrate-mono-mp3'}),
   });
  };
  const cancel=()=>finish(Error('speech_cancelled'));
  signal.addEventListener('abort',cancel,{once:true});
  socket.onerror=()=>finish(Error('edge_tts_connection_failed'));
  socket.onclose=()=>{if(!settled)finish(Error('edge_tts_connection_closed'));};
  socket.onopen=()=>{
   const timestamp=edgeSpeechWireDate(now);
   socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}})}\r\n`);
   const ssml=`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${selection.locale}'><voice name='${selection.voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(input.surface)}</prosody></voice></speak>`;
   socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
  };
  socket.onmessage=event=>{
   messageQueue=messageQueue.then(async()=>{
    if(settled)return;
    if(typeof event.data==='string'){
     if(/(?:^|\r?\n)Path:turn\.end(?:\r?\n|$)/u.test(event.data)){turnEnded=true;finish();}
     return;
    }
    const buffer=event.data instanceof Blob?await event.data.arrayBuffer():event.data;
    if(!(buffer instanceof ArrayBuffer))throw Error('edge_tts_invalid_message');
    const chunk=audioFrame(buffer);size+=chunk.byteLength;
    if(size>MAX_AUDIO_BYTES)throw Error('edge_tts_audio_too_large');
    if(chunk.byteLength)chunks.push(chunk);
   }).catch(error=>finish(error instanceof Error?error:Error('edge_tts_invalid_message')));
  };
 });
}

async function synthesizeThroughService(input:ClientSpeechInput,signal:AbortSignal):Promise<ClientSpeechMaterial>{
 const selection=edgeVoiceByLanguage.get(input.languageTag);
 if(!selection)throw Error('speech_language_unavailable');
 const base=import.meta.env.VITE_SENSA_API_URL;
 const session=(await auth?.getSession())?.data.session;
 if(!base||!session)throw Error('localFlow.authUnavailable');
 const boundary=await captureAccountSessionBoundary(session.user.id);
 let response:Response;
 try{
  response=await fetch(base.replace(/\/+$/u,'')+'/sensa/speech/edge-tts',{
   method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},
   body:JSON.stringify({surface:input.surface,languageTag:input.languageTag,voice:selection.voice,locale:selection.locale}),
   signal:AbortSignal.any([signal,AbortSignal.timeout(50_000)]),credentials:'omit',redirect:'error',cache:'no-store',
  });
 }catch{signal.throwIfAborted();throw Error('edge_tts_connection_failed');}
 if(response.status===401||response.status===403)throw Error('localFlow.authUnavailable');
 if(!response.ok)throw Error('edge_tts_connection_failed');
 const result:unknown=await response.json();
 const audioBase64=(result as {audioBase64?:unknown})?.audioBase64;
 if(typeof audioBase64!=='string'||audioBase64.length<100||audioBase64.length>2_800_000||!/^[A-Za-z0-9+/]+={0,2}$/u.test(audioBase64))throw Error('edge_tts_invalid_message');
 if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw Error('localFlow.authUnavailable');
 await assertAccountSessionBoundary(boundary);
 return {surface:input.surface,languageTag:input.languageTag,audioUrl:`data:audio/mpeg;base64,${audioBase64}`,method:'tts',phoneticNotation:null,accentLabel:selection.locale,
  source:JSON.stringify({provider:'microsoft-edge-read-aloud',providerRevision:1,voice:selection.voice,locale:selection.locale,rate:'+0%',format:'audio-24khz-48kbitrate-mono-mp3'})};
}

export function createEdgeTtsClientProvider(dependencies:EdgeTtsDependencies={}):ClientSpeechProvider{
 return Object.freeze({
  id:'microsoft-edge-read-aloud',revision:1,displayName:'Microsoft Edge Read Aloud',
  synthesize:(input,signal)=>{
   const parsed=clientSpeechInputSchema.parse(input);
   return dependencies.socket||!import.meta.env.VITE_SENSA_API_URL
    ?synthesizeEdge(parsed,AbortSignal.any([signal,AbortSignal.timeout(45_000)]),dependencies)
    :synthesizeThroughService(parsed,signal);
  },
 });
}

export const edgeTtsClientProvider=createEdgeTtsClientProvider();
