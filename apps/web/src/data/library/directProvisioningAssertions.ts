import {sensaContentGenerationRequestSchema,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {assertReadyContentAttempt} from './contentAttemptEvidence';
import {directProvisioningReferenceSchema} from '../../contentSupply/provisioning/contracts';
import type {LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {DirectLearningSource} from '../../learning/system/directLearningSource';
import {backupEqual} from './backupCodec';

/** Shared local-admission and restore checks; no storage or model side effects. */
export function assertDirectTaskEnrollment(task:any,enrollment:LocalCurriculumEnrollment):DirectLearningSource{
 const reference=directProvisioningReferenceSchema.parse(task.source);
 if(enrollment.source.kind!=='stable_sense'||enrollment.id!==reference.enrollmentId)throw new Error('Direct provisioning enrollment is missing.');
 const selection=enrollment.source.selection,pins=selection.reference;
 if(reference.senseId!==pins.senseId||reference.senseVersionId!==pins.senseVersionId||reference.bindingId!==pins.bindingId||reference.bindingVersionId!==pins.bindingVersionId
   ||reference.sourceDigest!==selection.sourceDigest||task.useContext!==false||task.replacing===true||!backupEqual(task.languageContext,enrollment.languageContext))throw new Error('Direct provisioning differs from the accepted source or Route.');
 return selection;
}

export function assertDirectAttemptSource(attempt:any,task:any,selection:DirectLearningSource,learnerId:string):void{
 if(attempt.grant!==null)throw new Error('Direct preparation cannot use a personal Context grant.');
 if(!attempt.request){if(attempt.status==='ready')throw new Error('Ready direct preparation requires its request.');return;}
 const request=sensaContentGenerationRequestSchema.parse(attempt.request),reference=task.source;
 if(request.contentProvisioningTaskId!==task.id||request.learningTargetId!==task.targetId||request.learnerUserId!==learnerId
   ||request.senseId!==reference.senseId||request.senseVersionId!==reference.senseVersionId||request.senseExpressionBindingId!==reference.bindingId
   ||request.resolvedLearningPlanRevisionId!==task.planRevision)throw new Error('Direct preparation request has different fixed identities.');
 if(request.contextArtifacts.some(artifact=>artifact.source==='personal_anchor'||artifact.personalAnchorUseGrantId!==null))throw new Error('Direct preparation cannot transmit a personal Context.');
 const single=(kind:string)=>{const values=request.contextArtifacts.filter(artifact=>artifact.contextKind===kind);if(values.length!==1)throw new Error('Direct preparation source artifact is ambiguous.');return values[0]!;};
 const expression=single('expression_snapshot'),sense=single('sense_snapshot'),origin=single('origin_experience');
 const expectedExpression={surface:selection.expression.surfaceForm,languageTag:task.languageContext.targetLanguageTag,
  expressionKind:selection.expression.expressionType==='utterance_strategy'?'utterance':selection.expression.expressionType,
  ...(selection.expression.spokenForm?{spokenForm:selection.expression.spokenForm}:{}),...(selection.expression.acceptedForms?{acceptedForms:selection.expression.acceptedForms}:{}),...(selection.expression.formParts?{formParts:selection.expression.formParts}:{})};
 const equal=(a:unknown,b:unknown)=>canonicalConsumerJson(a)===canonicalConsumerJson(b);
 if(expression.sourceVersion!==reference.bindingVersionId||!equal(expression.payload,expectedExpression)
   ||sense.sourceVersion!==reference.senseVersionId||!equal(sense.payload,{meaning:selection.semanticSpec.coreMeaningFocus,semanticSpec:selection.semanticSpec,supportLanguageTag:task.languageContext.supportLanguageTag})
   ||origin.source!=='other_authoritative_source'||origin.sourceVersion!==reference.senseVersionId||!equal(origin.payload,{scene:selection.semanticSpec.prototypeScenes[0]!.summary,senseFocus:selection.semanticSpec.coreMeaningFocus,featureLabels:[]}))throw new Error('Direct preparation changed the accepted semantics or language.');
 assertReadyContentAttempt(attempt);
}
