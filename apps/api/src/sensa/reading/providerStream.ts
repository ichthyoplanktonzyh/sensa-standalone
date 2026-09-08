import {ConsumerError} from '../access/auth.js';

/** Consume actual provider SSE deltas; partial text is never a committed result. */
export async function providerStream(response:Response,onText:(text:string)=>Promise<void>):Promise<string>{
  if(!response.body)throw new ConsumerError(503,'provider_invalid_response');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',text='',bytes=0,finished=false,doneEvent=false;
  async function line(raw:string){
    if(!raw.startsWith('data:'))return;
    const payload=raw.slice(5).trim();if(!payload)return;
    if(payload==='[DONE]'){doneEvent=true;return;}
    const data=JSON.parse(payload),choice=data.choices?.[0];
    if(data.error)throw new ConsumerError(503,'provider_invalid_response');
    if(!choice)return;
    if(choice.finish_reason&&choice.finish_reason!=='stop')throw new ConsumerError(503,'provider_invalid_response');
    if(choice.finish_reason==='stop')finished=true;
    const delta=choice.delta?.content;
    if(delta!=null&&typeof delta!=='string')throw new ConsumerError(503,'provider_invalid_response');
    if(delta){text+=delta;if(text.length>24000)throw new ConsumerError(503,'provider_invalid_response');await onText(text);}
  }
  try{
    while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>1000000)throw new ConsumerError(503,'provider_invalid_response');
      buffer+=decoder.decode(next.value,{stream:true});let index;
      while((index=buffer.indexOf('\n'))>=0){await line(buffer.slice(0,index).replace(/\r$/u,''));buffer=buffer.slice(index+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())await line(buffer);
    if(!text.trim()||!finished||!doneEvent)throw new ConsumerError(503,'provider_invalid_response');
    return text;
  }finally{await reader.cancel().catch(()=>undefined);}
}
