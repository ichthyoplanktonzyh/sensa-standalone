import {explanationPreview} from './explanationPreview.js';
import {completeReading} from '../reading/service.js';
import type {ReadingCompletion} from '../reading/service.js';
import {semanticProposalSchema,semanticResolutionPrompt} from '@sensa/contracts/sensa';
import type {CaptureSnapshot,SemanticProposal,SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
export {semanticResolutionPrompt} from '@sensa/contracts/sensa';
export type SemanticResolution={proposal:SemanticProposal|null;provider:string;model:string;policyVersion?:'sensa-semantic-v4'};
export type SemanticResolver=(snapshot:CaptureSnapshot,languages:SensaFormalPinnedLanguageContext,focus?:{text:string}|null,onExplanation?:(text:string)=>Promise<void>)=>Promise<SemanticResolution>;
/** Model output proposes only. This adapter cannot access SQL, acceptance, curriculum or runtime. */
export function semanticResolverFor(connection:Parameters<ReadingCompletion>[0],complete:ReadingCompletion=completeReading):SemanticResolver { return async(snapshot,languages,focus,onExplanation)=>{
 const body=await complete(connection,[{role:'system',content:semanticResolutionPrompt(snapshot,languages)},{role:'user',content:JSON.stringify({sentence:snapshot.sentence,expression:snapshot.expression,language:snapshot.language,languages,learnerFocus:focus?.text??null})}],true,onExplanation?async partial=>{const text=explanationPreview(partial);if(text)await onExplanation(text);}:undefined);
 const raw=JSON.parse(body);
 return {proposal:raw?.proposal===null?null:semanticProposalSchema.parse(raw?.proposal),provider:connection.name,policyVersion:'sensa-semantic-v4',model:connection.model};
};}
export const resolveSemantic:SemanticResolver=async(snapshot,languages,focus,onExplanation)=>{
 if(process.env.SENSA_SEMANTIC_PROVIDER!=='deepseek'||!process.env.DEEPSEEK_API_KEY)throw new Error('provider_unavailable');
 return semanticResolverFor({id:'00000000-0000-4000-8000-000000000001',name:'deepseek',baseUrl:'https://api.deepseek.com',enabled:true,model:process.env.SENSA_SEMANTIC_MODEL??'deepseek-flash',apiKey:process.env.DEEPSEEK_API_KEY})(snapshot,languages,focus,onExplanation);
};
