import {canonicalConsumerJson,sensaContentGenerationRequestSchema,sensaFormalPinnedLanguageContextSchema} from '@sensa/contracts/sensa';
import {sha256,stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';
import {provisioningTaskId,type PersonalMeaningLearningSource} from '../../contentSupply/provisioning/contracts';
import {assertReadyContentAttempt} from './contentAttemptEvidence';

const equal=(left:unknown,right:unknown)=>canonicalConsumerJson(left)===canonicalConsumerJson(right);
const reject=(detail:string):never=>{throw new Error(`Personal preparation ${detail}.`);};

/** Validate frozen personal evidence, including failed checkpoints which may
 * transmit their saved request on explicit retry. Historical attempts use their
 * own source, Route, Context and consent, never today's task preferences. */
export function assertPersonalAttemptSource(attempt:any,task:any,source:PersonalMeaningLearningSource,learnerId:string):void{
 const fixed=attempt.fixedInput;
 if(!fixed||!equal(fixed.source,source.reference))reject('has a different accepted source');
 const context=sensaFormalPinnedLanguageContextSchema.parse(fixed.languageContext);
 z.string().uuid().parse(fixed.planRevision);z.boolean().parse(fixed.useContext);
 if(attempt.taskId!==task.id||provisioningTaskId(source.reference,context.languageRouteId)!==task.id
   ||stableUuid(`sensa-learning-target:${learnerId}:${source.reference.senseVersionId}:${source.reference.bindingVersionId}`)!==task.targetId
   ||source.targetLanguageTag!==context.targetLanguageTag||!equal(attempt.contextPin,source.context.personalSemanticAnchorRevisionIds))reject('has inconsistent fixed identities');
 if(!attempt.request){
  if(attempt.grant!==null||attempt.bundle||attempt.status==='ready')reject('has evidence without its request');
  return;
 }
 const request=sensaContentGenerationRequestSchema.parse(attempt.request),reference=source.reference;
 if(request.contentProvisioningTaskId!==task.id||request.learningTargetId!==task.targetId||request.learnerUserId!==learnerId
   ||request.senseId!==reference.senseId||request.senseVersionId!==reference.senseVersionId||request.senseExpressionBindingId!==reference.bindingId
   ||request.resolvedLearningPlanRevisionId!==fixed.planRevision)reject('request has different fixed identities');
 const single=(kind:string)=>{const artifacts=request.contextArtifacts.filter(artifact=>artifact.contextKind===kind);if(artifacts.length!==1)reject('request has ambiguous source artifacts');return artifacts[0]!;};
 const expression=single('expression_snapshot'),sense=single('sense_snapshot'),origin=single('origin_experience');
 const expectedExpression={surface:source.expression.surfaceForm,languageTag:context.targetLanguageTag,
  expressionKind:source.expression.expressionType==='utterance_strategy'?'utterance':source.expression.expressionType,
  ...(source.expression.spokenForm?{spokenForm:source.expression.spokenForm}:{}),...(source.expression.formParts?{formParts:source.expression.formParts}:{})};
 if(expression.source!=='target_expression'||expression.sourceVersion!==reference.bindingVersionId||!equal(expression.payload,expectedExpression)
   ||sense.source!=='confirmed_sense'||sense.sourceVersion!==reference.senseVersionId||!equal(sense.payload,{meaning:source.semanticSpec.coreMeaningFocus,semanticSpec:source.semanticSpec,supportLanguageTag:context.supportLanguageTag}))reject('request changed accepted semantics or language');
 const grant=attempt.grant;
 if(fixed.useContext){
  if(!grant)reject('request is missing its Context grant');
  z.string().uuid().parse(grant.id);
  const recipients=[...new Set([attempt.contentProvider.endpoint,...(attempt.reviewProvider?[attempt.reviewProvider.endpoint]:[])])];
  if(grant.contextDigest!==sha256(canonicalConsumerJson(source.context))||!equal(grant.recipients,recipients)
    ||origin.source!=='personal_anchor'||origin.sourceVersion!==grant.contextDigest||origin.personalAnchorUseGrantId!==grant.id
    ||!equal(origin.payload,{scene:source.context.text,senseFocus:source.semanticSpec.coreMeaningFocus,featureLabels:[],...(source.context.images.length?{images:source.context.images}:{})}))reject('request does not match its pinned Context grant');
 }else if(grant!==null||origin.source!=='other_authoritative_source'||origin.sourceVersion!==reference.senseVersionId||origin.personalAnchorUseGrantId!==null
   ||!equal(origin.payload,{scene:source.semanticSpec.prototypeScenes[0]!.summary,senseFocus:source.semanticSpec.coreMeaningFocus,featureLabels:[]}))reject('request transmits ungranted personal Context');
 for(const artifact of request.contextArtifacts){
  if(artifact.contentDigest!==sha256(canonicalConsumerJson(artifact.payload)))reject('request has altered artifact evidence');
  if(artifact!==origin&&(artifact.source==='personal_anchor'||artifact.personalAnchorUseGrantId!==null))reject('request adds ungranted Context artifacts');
 }
 assertReadyContentAttempt(attempt);
}
