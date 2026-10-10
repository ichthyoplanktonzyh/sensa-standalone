import type {SensaIntakeContext} from '@sensa/contracts/sensa';
import type {AgentContextCandidate} from './semanticAgent';
import type {ClarificationDraftView} from './types';

/** Accepted wording is distinct from the captured source and its language observation. */
export function completedContextForDraft(
  draft:ClarificationDraftView,context:AgentContextCandidate,supportLanguageTag:string,learnerEdited=false,
):SensaIntakeContext|null{
  const textSegment=context.summary.trim();
  const mediaReferenceIds=draft.materialBlocks.filter(block=>block.kind==='image'&&block.personalMediaObjectId).map(block=>block.personalMediaObjectId!);
  if(!textSegment&&mediaReferenceIds.length===0)return null;
  const unchanged=textSegment===(draft.context?.textSegment?.trim()??'');
  const languageTag=!textSegment?null:unchanged?draft.context?.languageTag??null:learnerEdited?null:supportLanguageTag;
  const languageObservation=!languageTag?null:unchanged?draft.context?.languageObservation??null:{source:'model' as const,confidence:null};
  return {
    modality:textSegment?mediaReferenceIds.length?'mixed':'text':'image',textSegment:textSegment||null,mediaReferenceIds,
    languageTag,languageObservation,
    source:draft.context?.source??{client:'sensa-web',url:null,title:'Inbox clarification',sourceReferenceId:draft.intakeId,domSelector:null,paragraphContext:null},
  };
}
