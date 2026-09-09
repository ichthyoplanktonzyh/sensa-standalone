import {ConsumerError} from '../access/auth.js';
export type ConsumerMediaReader=(digest:string)=>Promise<Uint8Array|null>;
/** Private object access. The route authorizes the learner before invoking this adapter. */
export const readConsumerMedia:ConsumerMediaReader=async digest=>{
 const project=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,bucket=process.env.SENSA_MEDIA_BUCKET;
 if(!project||!key||!bucket)throw new ConsumerError(503,'media_unavailable');
 if(new URL(project).protocol!=='https:')throw new ConsumerError(503,'media_unavailable');
 const response=await fetch(project.replace(/\/$/u,'')+'/storage/v1/object/authenticated/'+encodeURIComponent(bucket)+'/'+digest+'.mp3',{headers:{authorization:'Bearer '+key,apikey:key},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(response.status===404)return null;if(!response.ok)throw new ConsumerError(503,'media_unavailable');
 const limit=2*1024*1024,reader=response.body?.getReader();
 if(!reader)throw new ConsumerError(503,'media_unavailable');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new ConsumerError(503,'media_unavailable');chunks.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
};
export async function bytesDigest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),b=>b.toString(16).padStart(2,'0')).join('');}
