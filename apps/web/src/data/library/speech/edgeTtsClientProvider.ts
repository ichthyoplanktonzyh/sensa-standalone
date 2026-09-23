import {clientSpeechInputSchema,type ClientSpeechInput,type ClientSpeechMaterial,type ClientSpeechProvider} from './provider';
import {edgeVoiceByLanguage} from './edgeVoiceCatalog';

const TRUSTED_CLIENT_TOKEN='6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_VERSION='143.0.3650.75';
const EDGE_TTS_URL='wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const MAX_AUDIO_BYTES=2_000_000;

type SocketFactory=(url:string)=>WebSocket;
type EdgeTtsDependencies=Readonly<{socket?:SocketFactory;clock?:()=>Date;randomId?:()=>string}>;

const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
const escapeXml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const wireDate=(date:Date)=>{
 const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],pad=(value:number)=>String(value).padStart(2,'0');
 return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
};

async function connectionUrl(now:Date,connectionId:string){
 const unixSeconds=Math.floor(now.getTime()/1000);
 const rounded=unixSeconds-unixSeconds%300;
 const windowsTicks=BigInt(rounded+11_644_473_600)*10_000_000n;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`));
 const query=new URLSearchParams({
  TrustedClientToken:TRUSTED_CLIENT_TOKEN,
  'Sec-MS-GEC':hex(digest),
  'Sec-MS-GEC-Version':`1-${EDGE_VERSION}`,
  ConnectionId:connectionId.replaceAll('-',''),
 });
 return `${EDGE_TTS_URL}?${query}`;
}

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
 const url=await connectionUrl(now,randomId());
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
   const timestamp=wireDate(now);
   socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}})}\r\n`);
   const ssml=`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${selection.locale}'><voice name='${selection.voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(input.surface)}</prosody></voice></speak>`;
   socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`);
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

export function createEdgeTtsClientProvider(dependencies:EdgeTtsDependencies={}):ClientSpeechProvider{
 return Object.freeze({
  id:'microsoft-edge-read-aloud',revision:1,displayName:'Microsoft Edge Read Aloud',
  synthesize:(input,signal)=>synthesizeEdge(clientSpeechInputSchema.parse(input),AbortSignal.any([signal,AbortSignal.timeout(45_000)]),dependencies),
 });
}

export const edgeTtsClientProvider=createEdgeTtsClientProvider();
