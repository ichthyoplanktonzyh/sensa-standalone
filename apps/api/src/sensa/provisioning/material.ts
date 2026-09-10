import {z} from 'zod';
import {modelFacts,generationSystem,independentReviewSystem} from '@sensa/contracts/sensa';
import type {ContentGenerator,ContentReviewer} from '@sensa/contracts/sensa';
export {makeRequest,makeBundle,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
export type {ContentGenerator,ContentReviewer,GeneratedCue} from '@sensa/contracts/sensa';
const cueSchema=z.object({scene:z.string().trim().min(10).max(1800),senseFocus:z.string().trim().min(2).max(500)}).strict();
async function modelJson(system:string,data:unknown,maxTokens:number){
 if(process.env.SENSA_CONTENT_PROVIDER!=='deepseek'||!process.env.DEEPSEEK_API_KEY)throw new Error('provider_unavailable');const model=process.env.SENSA_CONTENT_MODEL??'deepseek-flash';
 const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{authorization:'Bearer '+process.env.DEEPSEEK_API_KEY,'content-type':'application/json'},signal:AbortSignal.timeout(35000),body:JSON.stringify({model,max_tokens:maxTokens,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(data)}]})});if(!response.ok)throw new Error('provider_unavailable');const body=await response.text();if(body.length>32000)throw new Error('invalid_material');const parsed=JSON.parse(body);return {value:JSON.parse(parsed.choices?.[0]?.message?.content??'null'),model:typeof parsed.model==='string'?parsed.model:model,usage:{inputTokens:Number.isSafeInteger(parsed.usage?.prompt_tokens)?parsed.usage.prompt_tokens:null,outputTokens:Number.isSafeInteger(parsed.usage?.completion_tokens)?parsed.usage.completion_tokens:null}};
}
export const generateContent:ContentGenerator=async request=>{const personal=request.contextArtifacts.some(a=>a.source==='personal_anchor');const result=await modelJson(generationSystem(personal),modelFacts(request),1200);return {cue:cueSchema.parse(result.value),provider:'deepseek',model:result.model,usage:result.usage};};
export const reviewContent:ContentReviewer=async(request,cue)=>{const result=await modelJson(independentReviewSystem,{facts:modelFacts(request),cue},400);return {...z.object({accepted:z.boolean(),reason:z.string().max(2000)}).strict().parse(result.value),provider:'deepseek-independent-review',model:result.model};};
