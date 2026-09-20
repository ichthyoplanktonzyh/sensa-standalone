import {z} from 'zod';

/** Generation input contains linguistic choices; persisted spans are computed below. */
export const generatedSceneSchema=z.object({
 example:z.string().trim().min(1),
 translation:z.string().trim().min(1).nullable().optional(),
 targetText:z.string().min(1).optional(),
 targetOccurrence:z.number().int().positive().optional(),
}).strict();

export function assembleGeneratedScene(raw:Record<string,unknown>,expression:Record<string,unknown>){
 // Old in-flight drafts may contain these fields. They never control assembly.
 const {targetStart:_,targetEnd:__,experienceResourceKey:___,...input}=raw;
 const parsed=generatedSceneSchema.parse(input);
 const forms=[expression.surface,expression.spokenForm,...(Array.isArray(expression.acceptedForms)?expression.acceptedForms:[])].filter((v):v is string=>typeof v==='string'&&!!v);
 const matches=new Map<string,{targetStart:number;targetEnd:number}>();
 for(const form of new Set(parsed.targetText?[parsed.targetText]:forms)){
  // Unicode/case-aware search preserves the original UTF-16 indices. Do not
  // normalize the sentence or guess inflections. CJK need no space boundaries.
  const pattern=new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  for(const match of parsed.example.matchAll(pattern)){
   const start=match.index,end=start+match[0].length;
   const wordChar=/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{M}\p{N}_]/u;
   const before=Array.from(parsed.example.slice(0,start)).at(-1)??'',after=Array.from(parsed.example.slice(end))[0]??'';
   if((wordChar.test(form[0]!)&&wordChar.test(before))||(wordChar.test(form.at(-1)!)&&wordChar.test(after)))continue;
   matches.set(`${start}:${end}`,{targetStart:start,targetEnd:end});
  }
 }
 const found=[...matches.values()].sort((a,b)=>a.targetStart-b.targetStart||a.targetEnd-b.targetEnd);
 if(!found.length)throw Error('scene_realization: target text not found as a complete occurrence. Supply targetText exactly as the expression appears in the example, including inflection; do not calculate offsets.');
 if(found.length>1&&!parsed.targetOccurrence)throw Error('scene_realization: multiple matches. Set targetText to the intended expression as it appears and targetOccurrence to its 1-based occurrence, or rewrite with one occurrence.');
 const span=found[(parsed.targetOccurrence??1)-1];
 if(!span)throw Error('scene_realization: targetOccurrence exceeds the number of matches.');
 return {example:parsed.example,...(parsed.translation!==undefined?{translation:parsed.translation}:{}),...span,experienceResourceKey:'experience_recall_cue:0'};
}
