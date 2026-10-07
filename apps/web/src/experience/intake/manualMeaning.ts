import {z} from 'zod';
import {sensaExpressionTypeSchema,sensaIntakePayloadSchema,sensaSenseSemanticSpecSchema,type SensaIntakePayload,type SensaIntakeItem} from '@sensa/contracts/sensa';

/** A local editing draft is not an Intake item or an accepted Meaning. */
export const manualMeaningDraftSchema=z.object({
  operationId:z.string().uuid(),capturedAt:z.string().datetime({offset:true}),
  context:z.string().max(12000),occurrence:z.string().max(2000),occurrenceStart:z.number().int().nonnegative().nullable(),
  canonicalForm:z.string().max(2000),languageTag:z.string(),expressionType:sensaExpressionTypeSchema,
  meaning:z.string(),usage:z.string(),
  existingSense:z.object({senseId:z.string().uuid(),senseVersionId:z.string().uuid(),senseKey:z.string().min(1),semanticSpec:sensaSenseSemanticSpecSchema}).nullable().optional(),
}).strict();
export type ManualMeaningDraft=z.infer<typeof manualMeaningDraftSchema>;
export const newManualMeaningDraft=():ManualMeaningDraft=>({operationId:crypto.randomUUID(),capturedAt:new Date().toISOString(),context:'',occurrence:'',occurrenceStart:null,canonicalForm:'',languageTag:'',expressionType:'word',meaning:'',usage:''});

export function manualDraftFromIntake(item:SensaIntakeItem):ManualMeaningDraft{
 const {context,expression,sense}=item.payload,occurrence=expression?.occurrence;
 return {...newManualMeaningDraft(),context:context?.textSegment??'',occurrence:occurrence?.surfaceForm??expression?.surfaceForm??'',occurrenceStart:occurrence?.locator.kind==='text_span'?occurrence.locator.start:null,
  canonicalForm:expression?.surfaceForm??'',languageTag:expression?.languageTag??'',expressionType:expression?.expressionTypeHint??'word',meaning:sense?.semanticSpec.coreMeaningFocus??'',usage:sense?.semanticSpec.prototypeScenes[0]?.summary??''};
}

export function occurrencePositions(context:string,expression:string):number[]{
  const text=context.trim(),form=expression.trim(),positions:number[]=[];
  if(!form)return positions;
  for(let start=text.indexOf(form);start!==-1;start=text.indexOf(form,start+1))positions.push(start);
  return positions;
}

export function capturedMediaOccurrence(draft:ManualMeaningDraft,original?:SensaIntakeItem){
 const occurrence=original?.payload.expression?.occurrence;
 return !draft.context.trim()&&occurrence?.locator.kind==='media_region'&&occurrence.surfaceForm===draft.occurrence.trim()
  &&original?.payload.context?.mediaReferenceIds.includes(occurrence.locator.mediaReferenceId)?occurrence:null;
}

/** Same learner-authored Sense construction for initial acceptance and correction. */
export function manualMeaningSense(draft:ManualMeaningDraft,prior?:SensaIntakePayload):NonNullable<SensaIntakePayload['sense']>{
 if(!draft.meaning.trim()||!draft.usage.trim())throw Error('manualMeaning.meaningRequired');
 const selected=draft.existingSense,priorSpec=prior?.sense?.semanticSpec;
 if(selected&&(draft.meaning.trim()!==selected.semanticSpec.coreMeaningFocus||draft.usage.trim()!==selected.semanticSpec.prototypeScenes[0]?.summary))throw Error('manualMeaning.invalid');
 if(selected)return {senseKey:selected.senseKey,semanticSpec:selected.semanticSpec,wordingSource:'imported',resolutionProvenance:{resolverKind:'external_tool',provider:'sensa-local-registry',model:null,policyVersion:null,sourceReferenceIds:[selected.senseVersionId]}};
 if(priorSpec&&draft.meaning.trim()===priorSpec.coreMeaningFocus&&draft.usage.trim()===priorSpec.prototypeScenes[0]?.summary)return prior!.sense!;
 return {senseKey:null,semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:draft.meaning.trim(),prototypeScenes:[{summary:draft.usage.trim(),participantRoles:[],states:[],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]},wordingSource:'learner_authored',resolutionProvenance:{resolverKind:'learner',provider:'sensa-web-manual',model:null,policyVersion:null,sourceReferenceIds:[]}};
}

/** Called only by the explicit Save action. No model, invented example, or learning command. */
export function manualMeaningPayload(draft:ManualMeaningDraft,original?:SensaIntakeItem):SensaIntakePayload{
  const context=draft.context.trim(),occurrence=draft.occurrence.trim();
  const mediaOccurrence=capturedMediaOccurrence(draft,original);
  if(!context&&!mediaOccurrence)throw new Error('manualMeaning.contextRequired');
  const positions=occurrencePositions(context,occurrence);
  const start=positions.length===1?positions[0]!:draft.occurrenceStart;
  if(!mediaOccurrence&&(start===null||!positions.includes(start)))throw new Error('manualMeaning.occurrenceRequired');
  if(!draft.languageTag)throw new Error('manualMeaning.languageRequired');
  if(!draft.meaning.trim()||!draft.usage.trim())throw new Error('manualMeaning.meaningRequired');
  const prior=original?.payload;
  const retainContext=!!mediaOccurrence||prior?.context?.textSegment===context;
  return sensaIntakePayloadSchema.parse({
    contractVersion:'sensa-intake-v3',operationId:draft.operationId,capturedAt:draft.capturedAt,
    context:retainContext?prior!.context:{modality:prior?.context?.mediaReferenceIds.length?'mixed':'text',textSegment:context,mediaReferenceIds:prior?.context?.mediaReferenceIds??[],languageTag:null,languageObservation:null,source:null},
    expression:{surfaceForm:draft.canonicalForm.trim()||occurrence,languageTag:draft.languageTag,expressionTypeHint:draft.expressionType,occurrence:mediaOccurrence??{surfaceForm:occurrence,locator:{kind:'text_span',start:start!,end:start!+occurrence.length}}},
    sense:manualMeaningSense(draft,prior),
    acceptance:{mode:'learner_direct'},
  });
}
