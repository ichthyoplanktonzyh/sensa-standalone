import {resourceSupplementRequestSchema,resourceSupplementResultSchema,type ResourceSupplementRequest,type ResourceSupplementResult,canonicalConsumerJson} from '@sensa/contracts/sensa';
export type SupplementProvider=(request:ResourceSupplementRequest,signal:AbortSignal)=>Promise<ResourceSupplementResult>;
export async function prepareSupplement(input:unknown,provider:SupplementProvider,signal:AbortSignal){
 const request=resourceSupplementRequestSchema.parse(input);
 const response=resourceSupplementResultSchema.parse(await provider(request,signal));
 if(canonicalConsumerJson(request)!==canonicalConsumerJson(response.request))throw Error('resource_identity_mismatch');
 return response;
}

/** Editorial reference adapter. Replace the provider to extend coverage; never let
 * a content model certify its own historical claims. Summaries, not quotations.
 * Checked against each linked dictionary's Word History on 2026-09-20. */
const etymologies:Record<string,{zh:string;en:string}>={
 fragile:{zh:'fragile 的历史来源包括中古法语和拉丁语 fragilis；拉丁语词干 frag- 与 frangere（打破）有关。这是历史词源，不是把现代英语单词任意拆分成词缀。',en:'Fragile was borrowed from Middle French and Latin. Latin fragilis contains a stem related to frangere, meaning to break. This is historical origin, not a productive modern English word-building rule.'},
 sustain:{zh:'sustain 经中古英语和盎格鲁法语追溯到拉丁语 sustinēre（支撑、托住）；其中 tenēre 表示持住。这里解释历史来源，不把词源当作当前义项的完整定义。',en:'Sustain came through Middle English and Anglo-French from Latin sustinēre, associated with holding up or supporting; tenēre means to hold. This history does not define every modern sense.'},
 borrow:{zh:'borrow 由中古英语 borwen 追溯到古英语 borgian。这是英语历史演变形成的词，不适合靠随意拆分现代拼写来解释“借入”。',en:'Borrow descends through Middle English borwen from Old English borgian. Its history is not explained by arbitrarily splitting its present-day spelling.'},
};
export const editorialSupplementProvider:SupplementProvider=async request=>{
 const base={request,provider:'sensa-editorial-reference',sourceVersion:'etymology-2026-09-20-v1'};
 if(['phrase','construction','utterance'].includes(request.expressionKind))return {...base,result:{status:'not_applicable',reason:'single_word_only'}};
 if(request.expressionKind==='unspecified')return {...base,result:{status:'unavailable',reason:'source_missing'}};
 if(request.targetLanguageTag!=='en'||!['zh-CN','zh-Hans','en'].includes(request.supportLanguageTag))return {...base,result:{status:'unavailable',reason:'language_unsupported'}};
 const item=etymologies[request.surface];
 if(!item)return {...base,result:{status:'unavailable',reason:'source_missing'}};
 return {...base,result:{status:'available',payload:{explanation:request.supportLanguageTag==='en'?item.en:item.zh,source:'Merriam-Webster · Word History（2026-09-20）',sourceUrl:`https://www.merriam-webster.com/dictionary/${request.surface}`}}};
};

/** Source acquisition during initial resource preparation; not a user-facing
 * append operation. Unsupported sources yield no fact, never a made-up one. */
export async function prepareLearningResourceFacts(raw:unknown){
 const {learningResourcePreparationInputSchema,learningResourcePreparationResultSchema}=await import('@sensa/contracts/sensa');
 const input=learningResourcePreparationInputSchema.parse(raw);
 const response=await editorialSupplementProvider({role:'etymology',surface:input.expression.surface,targetLanguageTag:input.expression.languageTag,supportLanguageTag:input.supportLanguageTag,expressionKind:input.expression.expressionKind==='sentence'?'utterance':input.expression.expressionKind},new AbortController().signal);
 const references=response.result.status==='available'?[{source:'dictionary' as const,sourceVersion:response.sourceVersion,fact:{factKind:'etymology' as const,...response.result.payload}}]:[];
 return learningResourcePreparationResultSchema.parse({input,references});
}
