import {executeModel} from '../models/executor.js';
import {z} from 'zod';
import {modelFacts,generationSystem,independentReviewSystem} from '@sensa/contracts/sensa';
import type {ContentGenerator,ContentReviewer} from '@sensa/contracts/sensa';
export {makeRequest,makeBundle,validateBundle,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND} from '@sensa/contracts/sensa';
export type {ContentGenerator,ContentReviewer,GeneratedCue} from '@sensa/contracts/sensa';
const cueSchema=z.object({scene:z.string().trim().min(10).max(1800),senseFocus:z.string().trim().min(2).max(500)}).strict();
async function modelJson(system:string,data:unknown,maxTokens:number){
 if(process.env.SENSA_CONTENT_PROVIDER!=='deepseek'||!process.env.DEEPSEEK_API_KEY)throw new Error('provider_unavailable');const model=process.env.SENSA_CONTENT_MODEL??'deepseek-flash';
 const parsed=await executeModel({baseUrl:'https://api.deepseek.com',apiKey:process.env.DEEPSEEK_API_KEY,model,temperature:0},{model,max_tokens:maxTokens,stream:false,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(data)}]},{purpose:maxTokens===400?'review':'content',signal:AbortSignal.timeout(35000)});return {value:JSON.parse(parsed.choices[0]?.message.content??'null'),model,usage:{inputTokens:parsed.usage.prompt_tokens,outputTokens:parsed.usage.completion_tokens}};
}
export const generateContent:ContentGenerator=async request=>{const personal=request.contextArtifacts.some(a=>a.source==='personal_anchor');const result=await modelJson(generationSystem(personal),modelFacts(request),1200);return {cue:cueSchema.parse(result.value),provider:'deepseek',model:result.model,usage:result.usage};};
export const reviewContent:ContentReviewer=async(request,cue)=>{const result=await modelJson(independentReviewSystem,{facts:modelFacts(request),cue},400);return {...z.object({accepted:z.boolean(),reason:z.string().max(2000)}).strict().parse(result.value),provider:'deepseek-independent-review',model:result.model};};
