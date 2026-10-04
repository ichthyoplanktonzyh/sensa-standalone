import {z} from 'zod';
import {sensaExpressionTypeSchema,sensaIntakePayloadSchema,type SensaIntakePayload} from '@sensa/contracts/sensa';

/** A local editing draft is not an Intake item or an accepted Meaning. */
export const manualMeaningDraftSchema=z.object({
  operationId:z.string().uuid(),capturedAt:z.string().datetime({offset:true}),
  context:z.string().max(12000),occurrence:z.string().max(2000),occurrenceStart:z.number().int().nonnegative().nullable(),
  canonicalForm:z.string().max(2000),languageTag:z.string(),expressionType:sensaExpressionTypeSchema,
  meaning:z.string().max(4000),usage:z.string().max(4000),
}).strict();
export type ManualMeaningDraft=z.infer<typeof manualMeaningDraftSchema>;
export const newManualMeaningDraft=():ManualMeaningDraft=>({operationId:crypto.randomUUID(),capturedAt:new Date().toISOString(),context:'',occurrence:'',occurrenceStart:null,canonicalForm:'',languageTag:'',expressionType:'word',meaning:'',usage:''});

export function occurrencePositions(context:string,expression:string):number[]{
  const text=context.trim(),form=expression.trim(),positions:number[]=[];
  if(!form)return positions;
  for(let start=text.indexOf(form);start!==-1;start=text.indexOf(form,start+1))positions.push(start);
  return positions;
}

/** Called only by the explicit Save action. No model, invented example, or learning command. */
export function manualMeaningPayload(draft:ManualMeaningDraft):SensaIntakePayload{
  const context=draft.context.trim(),occurrence=draft.occurrence.trim();
  if(!context)throw new Error('manualMeaning.contextRequired');
  const positions=occurrencePositions(context,occurrence);
  const start=positions.length===1?positions[0]!:draft.occurrenceStart;
  if(start===null||!positions.includes(start))throw new Error('manualMeaning.occurrenceRequired');
  if(!draft.languageTag)throw new Error('manualMeaning.languageRequired');
  if(!draft.meaning.trim()||!draft.usage.trim())throw new Error('manualMeaning.meaningRequired');
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v3',operationId:draft.operationId,capturedAt:draft.capturedAt,
    context:{modality:'text',textSegment:context,mediaReferenceIds:[],languageTag:null,languageObservation:null,source:null},
    expression:{surfaceForm:draft.canonicalForm.trim()||occurrence,languageTag:draft.languageTag,expressionTypeHint:draft.expressionType,occurrence:{surfaceForm:occurrence,locator:{kind:'text_span',start,end:start+occurrence.length}}},
    sense:{senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:draft.meaning.trim(),prototypeScenes:[{summary:draft.usage.trim(),participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'learner_authored',resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null,policyVersion:null,sourceReferenceIds:[]}},
    acceptance:{mode:'learner_direct'},
  });
}
