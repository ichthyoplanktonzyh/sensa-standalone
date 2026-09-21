/** Node host adapter; the consumer API and browser never import Python details. */
import {spawn} from 'node:child_process';
import {sensaLightweightPronunciationMaterialSchema} from '@sensa/contracts/sensa';
import type {z} from 'zod';

type LocalBookSpeechProvider=(input:{surface:string;languageTag:string},signal:AbortSignal)=>Promise<z.infer<typeof sensaLightweightPronunciationMaterialSchema>>;

export function edgeSpeechProvider(allowExternal:boolean):LocalBookSpeechProvider {
 let running=0;
 return async(input,signal)=>{
  if(running>=2)throw Error('speech_busy');
  running++;
  try{
   return await new Promise((resolve,reject)=>{
    const child=spawn(process.env.SENSA_TTS_PYTHON??'python3',['content/tools/spoken_resource.py',...(allowExternal?['--allow-tts']:[])],{stdio:['pipe','pipe','pipe']});
    let output='',error='',settled=false;
    const stop=()=>{child.kill('SIGKILL');finish(Error('speech_cancelled'));};
    const timer=setTimeout(stop,45000);
    const finish=(failure?:Error)=>{
     if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);
     if(failure){reject(failure);return;}
     try{resolve(sensaLightweightPronunciationMaterialSchema.parse(JSON.parse(output)));}catch(e){reject(e);}
    };
    child.on('error',finish);
    child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>3_000_000)stop();});
    child.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-1000);});
    child.on('close',code=>finish(code===0?undefined:Error(error||'speech_failed')));
    child.stdin.on('error',()=>{});
    signal.addEventListener('abort',stop,{once:true});
    if(signal.aborted){stop();return;}
    child.stdin.end(JSON.stringify(input));
   });
  }finally{running--;}
 };
}
