import {z} from 'zod';
import {
  sensaSenseSnapshotSchema,sensaSenseVersionSnapshotSchema,
  sensaExpressionSnapshotSchema,sensaExpressionVersionSnapshotSchema,
  sensaSenseExpressionBindingSnapshotSchema,sensaSenseExpressionBindingVersionSnapshotSchema,
  publishedLearningSemanticFactsSchema,sensaPortableLightweightSemanticDeclarationSchema,sensaLanguageTagSchema,sensaExpressionTypeSchema,sensaSenseSemanticSpecSchema,
  type SensaExpressionType,type SensaSenseSemanticSpec,
} from '@sensa/contracts/sensa';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {packageInstallationSchema,type InstalledPackage} from '../../data/library/packageRecords';

const uuid=z.string().uuid();
const digest=z.string().regex(/^[a-f0-9]{64}$/u);
export const directLearningReferenceSchema=z.object({
  senseId:uuid,senseVersionId:uuid,bindingId:uuid,bindingVersionId:uuid,
  expressionId:uuid.optional(),expressionVersionId:uuid.optional(),
  origin:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('semantic_registry')}).strict(),
    z.object({kind:z.literal('published_package'),packageKey:z.string().min(1).max(2000),packageDigest:digest}).strict(),
  ]),
}).strict();
export type DirectLearningReference=z.infer<typeof directLearningReferenceSchema>;
export const resolvedDirectLearningReferenceSchema=directLearningReferenceSchema.extend({expressionId:uuid,expressionVersionId:uuid});
export type ResolvedDirectLearningReference=z.infer<typeof resolvedDirectLearningReferenceSchema>;

/** No Personal Meaning, Context, or learner progress is part of this source. */
export interface DirectLearningSource {
  sourceKind:'stable_sense';
  reference:ResolvedDirectLearningReference;
  senseKey:string;
  targetLanguageTag:string;
  expression:{surfaceForm:string;expressionType:SensaExpressionType;languageTag:string;spokenForm?:string;acceptedForms?:string[];formParts?:Array<{kind:'fixed'|'slot';text:string;constraint?:string}>};
  semanticSpec:SensaSenseSemanticSpec;
  binding:{registerLabel:string|null;usageConstraints:string[]};
  reviewStatus:'learner_confirmed'|'reviewed';
  /** Only an installed publication supplies a ready candidate; admission is separate. */
  publishedContent:null|{packageKey:string;packageDigest:string;archiveDigest:string;supportLanguageTag:string};
  sourceDigest:string;
}
export class DirectLearningSourceError extends Error {
  constructor(readonly reason:'missing'|'changed'|'not_learnable'){
    super(`direct_learning_source_${reason}`);this.name='DirectLearningSourceError';
  }
}
type SourceReader={get(table:'semanticRegistry'|'packageCache'|'packageInstallations',key:string):Promise<unknown>};
type SourceRead={table:Parameters<SourceReader['get']>[0];key:string};
const unavailable=(reason:DirectLearningSourceError['reason']):never=>{throw new DirectLearningSourceError(reason);};
const structureSchema=z.object({
  spokenForm:z.string().trim().min(1).optional(),
  acceptedForms:z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  formParts:z.array(z.object({kind:z.enum(['fixed','slot']),text:z.string(),constraint:z.string().optional()}).strict()).optional(),
});
function* registryRow<T>(kind:string,id:string,schema:z.ZodType<T>):Generator<SourceRead,T,unknown>{
  const raw=yield {table:'semanticRegistry',key:`${kind}:${id}`};
  if(raw===undefined||raw===null)return unavailable('missing');
  const row=z.object({kind:z.literal(kind),value:schema}).safeParse(raw);
  if(!row.success)return unavailable('changed');
  return row.data.value;
}

/** Resolve exact selected versions inside the caller's read/write transaction.
 * This never enumerates a World, follows current heads, calls a model, or writes.
 * The same interface is used for preview and revalidation before enrollment.
 */
function* directSourceSteps(input:DirectLearningReference,expectedDigest?:string):Generator<SourceRead,DirectLearningSource,unknown>{
  const parsed=directLearningReferenceSchema.safeParse(input);
  if(!parsed.success)return unavailable('not_learnable');
  const reference=parsed.data;
  let source:Omit<DirectLearningSource,'sourceDigest'>;
  if(reference.origin.kind==='semantic_registry'){
    const sense=yield* registryRow('senses',reference.senseId,sensaSenseSnapshotSchema);
    const version=yield* registryRow('senseVersions',reference.senseVersionId,sensaSenseVersionSnapshotSchema);
    const binding=yield* registryRow('bindings',reference.bindingId,sensaSenseExpressionBindingSnapshotSchema);
    const bindingVersion=yield* registryRow('bindingVersions',reference.bindingVersionId,sensaSenseExpressionBindingVersionSnapshotSchema);
    if(sense.senseId!==reference.senseId||version.senseVersionId!==reference.senseVersionId||version.senseId!==sense.senseId
      ||binding.senseExpressionBindingId!==reference.bindingId||binding.senseId!==sense.senseId
      ||bindingVersion.bindingVersionId!==reference.bindingVersionId||bindingVersion.senseExpressionBindingId!==binding.senseExpressionBindingId
      ||bindingVersion.senseVersionId!==version.senseVersionId)return unavailable('changed');
    if(version.reviewStatus==='rejected'||bindingVersion.reviewStatus==='rejected'||(binding.relation!==null&&binding.relation!=='realizes')||(bindingVersion.semanticCoverage!==null&&bindingVersion.semanticCoverage!=='exact'))return unavailable('not_learnable');
    const expression=yield* registryRow('expressions',binding.expressionId,sensaExpressionSnapshotSchema);
    const expressionVersion=yield* registryRow('expressionVersions',bindingVersion.expressionVersionId,sensaExpressionVersionSnapshotSchema);
    if(expression.expressionId!==binding.expressionId||expressionVersion.expressionVersionId!==bindingVersion.expressionVersionId||expressionVersion.expressionId!==expression.expressionId)return unavailable('changed');
    const structure=structureSchema.safeParse(expressionVersion.structure),language=sensaLanguageTagSchema.safeParse(expression.languageTag);
    if(!structure.success||!language.success)return unavailable('not_learnable');
    if(reference.expressionId&&reference.expressionId!==expression.expressionId||reference.expressionVersionId&&reference.expressionVersionId!==expressionVersion.expressionVersionId)return unavailable('changed');
    source={sourceKind:'stable_sense',reference:{...reference,expressionId:expression.expressionId,expressionVersionId:expressionVersion.expressionVersionId},senseKey:sense.senseKey,targetLanguageTag:language.data,
      expression:{surfaceForm:expressionVersion.surfaceForm,expressionType:expression.expressionType,languageTag:language.data,...structure.data},
      semanticSpec:version.semanticSpec,binding:{registerLabel:bindingVersion.registerLabel,usageConstraints:bindingVersion.usageConstraints},
      reviewStatus:version.reviewStatus==='reviewed'&&bindingVersion.reviewStatus==='reviewed'?'reviewed':'learner_confirmed',publishedContent:null};
  }else{
    const {packageKey,packageDigest}=reference.origin;
    const rawInstallation=yield {table:'packageInstallations',key:packageKey};
    const rawPack=yield {table:'packageCache',key:packageKey};
    if(!rawInstallation||!rawPack)return unavailable('missing');
    const installation=packageInstallationSchema.safeParse(rawInstallation),pack=rawPack as InstalledPackage;
    if(!installation.success||installation.data.key!==packageKey||installation.data.artifact.packageDigest!==packageDigest
      ||pack.key!==packageKey||pack.digest!==installation.data.artifact.digest||pack.portableOrigin?.archiveDigest!==pack.digest
      ||pack.portableOrigin.packageDigest!==packageDigest)return unavailable('changed');
    const entry=pack.content?.entries?.find(row=>row.senseVersionId===reference.senseVersionId&&row.bindingVersionId===reference.bindingVersionId);
    if(!entry||entry.senseId!==reference.senseId||entry.bindingId!==reference.bindingId)return unavailable('changed');
    // An unaligned Reference definition or self-declared private package must
    // not acquire editorial authority from a matching expression string.
    const semantic=publishedLearningSemanticFactsSchema.safeParse(entry.semantic);
    const manifest=pack.portableOrigin.manifest,declaration=sensaPortableLightweightSemanticDeclarationSchema.safeParse(manifest?.semanticDeclaration);
    if(!semantic.success||!declaration.success||semantic.data.relation!=='realizes'||semantic.data.semanticCoverage!=='exact')return unavailable('not_learnable');
    if(entry.expressionId!==semantic.data.expressionId||entry.expressionVersionId!==semantic.data.expressionVersionId)return unavailable('changed');
    const declared=declaration.data;
    if(manifest.metadata.packageId!==installation.data.artifact.packageId||manifest.metadata.version!==installation.data.artifact.version
      ||declared.sense.senseId!==reference.senseId||declared.sense.senseVersionId!==reference.senseVersionId
      ||declared.binding.senseExpressionBindingId!==reference.bindingId||declared.binding.bindingVersionId!==reference.bindingVersionId
      ||entry.expression!==manifest.targetExpression.text)return unavailable('changed');
    const expectedSemantic={senseKey:declared.sense.senseKey,senseVersionNumber:declared.sense.versionNumber,semanticPolicyVersion:declared.sense.semanticPolicyVersion,semanticSpec:declared.sense.semanticSpec,
      expressionId:declared.expression.expressionId,expressionVersionId:declared.expression.expressionVersionId,expressionType:declared.expression.expressionType,expressionVersionNumber:declared.expression.versionNumber,expressionStructure:declared.expression.structure,
      bindingVersionNumber:declared.binding.versionNumber,relation:declared.binding.relation,semanticCoverage:declared.binding.semanticCoverage,registerLabel:declared.binding.registerLabel,usageConstraints:declared.binding.usageConstraints};
    if(canonicalJsonDigest(semantic.data)!==canonicalJsonDigest(expectedSemantic))return unavailable('changed');
    if(!pack.portableOrigin.publications?.some(publication=>publication.member?.packageId===manifest.metadata.packageId&&publication.member.version===manifest.metadata.version
      &&publication.route?.targetLanguage===manifest.route.targetLanguage&&publication.route.supportLanguage===manifest.route.supportLanguage))return unavailable('not_learnable');
    const structure=structureSchema.safeParse(semantic.data.expressionStructure);
    // A published material's concrete spoken realization belongs to its
    // targetExpression, not to optional generic semantic structure metadata.
    const spokenForm=z.string().trim().min(1).max(500).optional().safeParse(manifest.targetExpression.spokenForm);
    const acceptedForms=structureSchema.shape.acceptedForms.safeParse(manifest.targetExpression.acceptedForms);
    const target=sensaLanguageTagSchema.safeParse(pack.content.targetLanguage),support=sensaLanguageTagSchema.safeParse(pack.content.supportLanguage);
    if(!structure.success||!spokenForm.success||!acceptedForms.success||!target.success||!support.success||target.data!==installation.data.artifact.targetLanguage||support.data!==installation.data.artifact.supportLanguage
      ||target.data!==manifest.route.targetLanguage||support.data!==manifest.route.supportLanguage)return unavailable('changed');
    if(reference.expressionId&&reference.expressionId!==semantic.data.expressionId||reference.expressionVersionId&&reference.expressionVersionId!==semantic.data.expressionVersionId)return unavailable('changed');
    source={sourceKind:'stable_sense',reference:{...reference,expressionId:semantic.data.expressionId,expressionVersionId:semantic.data.expressionVersionId},senseKey:semantic.data.senseKey,targetLanguageTag:target.data,
      expression:{surfaceForm:entry.expression,expressionType:semantic.data.expressionType,languageTag:target.data,
        ...(structure.data.formParts?{formParts:structure.data.formParts}:{}),...(spokenForm.data?{spokenForm:spokenForm.data}:{}),...(acceptedForms.data?{acceptedForms:acceptedForms.data}:{})},
      semanticSpec:semantic.data.semanticSpec,binding:{registerLabel:semantic.data.registerLabel,usageConstraints:semantic.data.usageConstraints},
      reviewStatus:'reviewed',publishedContent:{packageKey,packageDigest,archiveDigest:pack.digest,supportLanguageTag:support.data}};
  }
  const sourceDigest=canonicalJsonDigest(source);
  if(expectedDigest!==undefined&&expectedDigest!==sourceDigest)return unavailable('changed');
  return structuredClone({...source,sourceDigest});
}

export async function resolveDirectLearningSource(reader:SourceReader,input:DirectLearningReference,expectedDigest?:string):Promise<DirectLearningSource>{
  const steps=directSourceSteps(input,expectedDigest);let next=steps.next();
  while(!next.done)next=steps.next(await reader.get(next.value.table,next.value.key));
  return next.value;
}

/** Backup/reconciliation validates the same fixed source against its coherent row map. */
export function resolveDirectLearningSourceSnapshot(read:(table:SourceRead['table'],key:string)=>unknown,input:DirectLearningReference,expectedDigest?:string):DirectLearningSource{
  const steps=directSourceSteps(input,expectedDigest);let next=steps.next();
  while(!next.done)next=steps.next(read(next.value.table,next.value.key));
  return next.value;
}

export const directLearningSourceSchema=z.object({
  sourceKind:z.literal('stable_sense'),reference:resolvedDirectLearningReferenceSchema,senseKey:z.string().min(1),targetLanguageTag:sensaLanguageTagSchema,
  expression:structureSchema.extend({surfaceForm:z.string().min(1),expressionType:sensaExpressionTypeSchema,languageTag:sensaLanguageTagSchema}).strict(),
  semanticSpec:sensaSenseSemanticSpecSchema,binding:z.object({registerLabel:z.string().nullable(),usageConstraints:z.array(z.string())}).strict(),
  reviewStatus:z.enum(['learner_confirmed','reviewed']),
  publishedContent:z.object({packageKey:z.string().min(1),packageDigest:digest,archiveDigest:digest,supportLanguageTag:sensaLanguageTagSchema}).strict().nullable(),sourceDigest:digest,
}).strict().superRefine((source,context)=>{
  const {sourceDigest,...facts}=source;
  if(source.expression.languageTag!==source.targetLanguageTag||canonicalJsonDigest(facts)!==sourceDigest)context.addIssue({code:'custom',message:'Direct learning source digest or language is inconsistent'});
  const origin=source.reference.origin;
  if(origin.kind==='semantic_registry'?source.publishedContent!==null:!source.publishedContent||source.publishedContent.packageKey!==origin.packageKey||source.publishedContent.packageDigest!==origin.packageDigest)context.addIssue({code:'custom',message:'Direct learning source origin is inconsistent'});
});
