/** No network: convert source-backed shared reference facts into a local import excerpt. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sensaLightweightReferenceFactSchema } from '../packages/contracts/src/sensa/lightweightLearningContent.ts';
const text=z.string().trim().min(1).max(2000);
const input=z.object({sourceId:text,edition:text,entryId:text,sourceUrl:z.string().url(),license:text,attribution:text,reviewer:text,expression:text,expressionKind:z.enum(['word','phrase','construction','utterance','unspecified']),facts:z.array(sensaLightweightReferenceFactSchema).min(1).max(3)}).strict();
function canonical(v:unknown):unknown { return Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([k,x])=>[k,canonical(x)])):v; }
export function compileReferenceExcerpt(raw:unknown) {
 const {facts,expressionKind,...source}=input.parse(raw);
 const url=new URL(source.sourceUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new Error('invalid_reference_url');
 const roles=new Set<string>();
 const resources=facts.map(fact=>{
   if(fact.factKind==='pronunciation' && (fact.audioUrl !== null || !fact.phoneticNotation?.trim())) throw new Error('Audio requires the source-bound pronunciation pipeline');
   const materialRoleKey=fact.factKind==='pronunciation'?'pronunciation':fact.factKind==='language_structure'?'language_structure':'usage_guidance';
   if(roles.has(materialRoleKey))throw new Error('duplicate_reference_role');roles.add(materialRoleKey);
   return {materialRoleKey,contentPayload:fact.factKind==='pronunciation'?{audioUrl:null,phoneticNotation:fact.phoneticNotation,accentLabel:fact.accentLabel}:fact.factKind==='language_structure'?{expressionKind,expressionTypeLabel:fact.expressionTypeLabel,partOfSpeech:fact.partOfSpeech}:{example:fact.example}};
 });
 const payload={...source,resources};
 return {...payload,digest:createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [source,destination]=process.argv.slice(2);
 if(!source||!destination) throw new Error('Usage: node --import tsx scripts/compileNativeReferenceExcerpt.mts input.json output.json');
 const raw=await readFile(source,'utf8'); if(Buffer.byteLength(raw)>32000)throw new Error('reference_too_large');
 await writeFile(destination,JSON.stringify(compileReferenceExcerpt(JSON.parse(raw)),null,2)+'\n',{flag:'wx'});
 console.log('Reference excerpt compiled. Local attachment still requires explicit target alignment.');
}
