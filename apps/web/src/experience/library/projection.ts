import {localFlowText} from '../../i18n/localFlowText';
import type {LocalDraft} from '../../data/library/drafts';
import type {TeacherSession,LocalMeaning} from '../../data/library/teacher';
import type {JourneyWorldItemView,JourneyAlignmentView} from '../personalMeaningJourney/types';
export function projectLocalWorld(drafts:LocalDraft[],sessions:TeacherSession[],meanings:LocalMeaning[]):JourneyWorldItemView[]{
 return drafts.map(d=>{
  const session=sessions.filter(s=>s.draftId===d.id&&s.draftRevision===d.revision).at(-1);
  const meaning=meanings.find(m=>m.draftId===d.id&&m.draftRevision===d.revision);
  const label=d.text||session?.contextSummary||localFlowText('imageConversation');
  const confirmed=meaning?1:0;
  const phase=meaning?'aligned':session?.candidate?'proposal_ready':session?'constructing':'unclarified';
  const senseFormation:JourneyWorldItemView['senseFormation']={phase:meaning?'sense_confirmed':session?.candidate?'proposal_pending':session?'clarifying':'focus_missing',focusCount:0,acceptedFocusCount:0,pendingFocusCount:0,clarifyingFocusCount:0,proposalPendingCount:session?.candidate?1:0,confirmedSenseCount:confirmed,nextFocusId:null};
  const expressionBinding:JourneyWorldItemView['expressionBinding']={phase:meaning?'bound':'not_ready',confirmedSenseCount:confirmed,boundSenseCount:confirmed,confirmedBindingCount:confirmed,pendingBindingCount:0,nextFocusId:null};
  const directAlignments:JourneyAlignmentView[]=meaning?[{personalMeaningAlignmentId:meaning.alignmentId,basisKind:'sense_construction',status:'active',senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,senseShortId:meaning.senseId.slice(0,8),senseVersionShortId:meaning.senseVersionId.slice(0,8),senseVersionNumber:1,origin:'on_demand',reviewStatus:'unreviewed',resolution:'create_new',coreMeaningFocus:meaning.proposal.semanticSpec.coreMeaningFocus,semanticSpec:meaning.proposal.semanticSpec,semanticSpecVersion:1,semanticPolicyVersion:'language-teacher-v1',generator:null,expressionCandidates:[],unresolvedQuestions:[],confirmedBindings:[{expressionBindingConfirmationId:meaning.acceptanceId,senseVersionId:meaning.senseVersionId,expressionVersionId:meaning.bindingVersionId,bindingVersionId:meaning.bindingVersionId,expressionType:meaning.proposal.expression.type,surfaceForm:meaning.proposal.expression.surface,languageTag:'en',relation:'realizes',semanticCoverage:'exact'}]}]:[];
  const experienceAnchors:JourneyWorldItemView['experienceAnchors']=[{anchorId:meaning?.contextAnchorId??d.id,kind:'experience',surfaceForm:label,expressionType:null,revision:d.revision}];
  const familiarAnchors:JourneyWorldItemView['familiarAnchors']=d.familiarExpression?[{anchorId:d.id+':familiar',kind:'familiar_expression',surfaceForm:d.familiarExpression,expressionType:'utterance_strategy',revision:d.revision}]:[];
  return {personalMeaningId:d.id,shortId:d.id.slice(0,8),phase,primaryLabel:label,familiarAnchors,experienceAnchors,focusCount:0,confirmedSenseCount:confirmed,confirmedExpressionCount:confirmed,senseFormation,expressionBinding,updatedAt:meaning?.acceptedAt??d.updatedAt,detail:{personalMeaningId:d.id,shortId:d.id.slice(0,8),displayLabel:null,learnerIntentNote:null,phase,senseFormation,expressionBinding,familiarAnchors,experienceAnchors,materialBlocks:[{anchorId:d.id,kind:'text',bodyText:d.text,personalMediaObjectId:null,revision:d.revision}],startingPoint:d.startingPoint??null,focuses:[],directAlignments,createdAt:d.createdAt,updatedAt:d.updatedAt}};
 });
}
