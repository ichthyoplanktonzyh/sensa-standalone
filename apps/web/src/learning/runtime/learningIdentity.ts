import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

/** Memory belongs to the learner's meaning and target expression. Source,
 * language Route, wording and content revisions do not create another memory. */
export const stableLearningTargetId=(learnerId:string,senseId:string,expressionId:string):string=>
  stableUuid(`sensa-learning-target:${learnerId}:${senseId}:${expressionId}`);

/** These versions describe one immutable source, not Target identity. */
export interface LearningSourcePin {
  senseId:string;
  senseVersionId:string;
  expressionId:string;
  expressionVersionId:string;
  bindingId:string;
  bindingVersionId:string;
}
export const learningSourcePinSchema=z.object({
  senseId:z.string().uuid(),senseVersionId:z.string().uuid(),expressionId:z.string().uuid(),
  expressionVersionId:z.string().uuid(),bindingId:z.string().uuid(),bindingVersionId:z.string().uuid(),
}).strict();
export const sameLearningSourcePin=(left:LearningSourcePin,right:LearningSourcePin):boolean=>
  !!left&&!!right&&Object.keys(learningSourcePinSchema.shape).every(field=>left[field as keyof LearningSourcePin]===right[field as keyof LearningSourcePin]);

/** A material carries its own source even when its package cache is absent. */
export function materialSourcePin(material:{snapshot:{provenance:Record<string,unknown>}}):LearningSourcePin{
  const provenance=material.snapshot.provenance;
  const fields=['senseId','senseVersionId','expressionId','expressionVersionId','bindingId','bindingVersionId'] as const;
  for(const field of fields)if(typeof provenance[field]!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.test(provenance[field]))throw new Error('localFlow.resourceInvalid');
  return Object.fromEntries(fields.map(field=>[field,provenance[field]])) as unknown as LearningSourcePin;
}
