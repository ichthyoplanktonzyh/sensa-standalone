import {z} from 'zod';
import {sensaLanguageTagSchema,sensaSenseExpressionBindingSnapshotSchema,sensaSenseExpressionBindingVersionSnapshotSchema} from '@sensa/contracts/sensa';
import {readLibrary,assertCurrentLibrary} from '../../data/library/store';
import {packageInstallationSchema} from '../../data/library/packageRecords';
import {learningExpressionForm} from '../../data/library/packageCacheProjection';
import {resolveDirectLearningSource,type DirectLearningReference} from './directLearningSource';

export type DirectLearningChoice={reference:DirectLearningReference;expression:string;meaning:string;publication?:{title:string;version:number;supportLanguageTag:string}};
export type DirectLearningChoicePage={items:DirectLearningChoice[];hasMore:boolean};
const querySchema=z.object({query:z.string().trim().max(500),targetLanguageTag:sensaLanguageTagSchema,page:z.number().int().nonnegative().max(1_000_000)}).strict();
const pageSize=20;

/** Candidate discovery is bounded and read-only. Selection still resolves the
 * authoritative source and explicit enrollment rechecks its digest and Route. */
export async function readDirectLearningChoices(input:z.input<typeof querySchema>):Promise<DirectLearningChoicePage>{
 const query=querySchema.parse(input),normalizedPrefix=learningExpressionForm(query.query,query.targetLanguageTag)!;
 return readLibrary(async tx=>{
  await assertCurrentLibrary(tx);
  const [registry,packages]=await Promise.all([
   tx.registrySelection({kind:'learningChoices',normalizedPrefix,languageTag:query.targetLanguageTag,offset:query.page*pageSize,limit:pageSize+1}),
   tx.packageCacheProjection({kind:'learning_choices',normalizedPrefix,languageTag:query.targetLanguageTag,offset:query.page*pageSize,limit:pageSize+1}),
  ]);
  const registryItems=await Promise.all(registry.keys.slice(0,pageSize).map(async key=>{
   const row=await tx.get<any>('semanticRegistry',key),version=sensaSenseExpressionBindingVersionSnapshotSchema.parse(row?.value);
   const binding=sensaSenseExpressionBindingSnapshotSchema.parse((await tx.get<any>('semanticRegistry',`bindings:${version.senseExpressionBindingId}`))?.value);
   const reference:DirectLearningReference={senseId:binding.senseId,senseVersionId:version.senseVersionId,bindingId:binding.senseExpressionBindingId,bindingVersionId:version.bindingVersionId,origin:{kind:'semantic_registry'}};
   const source=await resolveDirectLearningSource(tx,reference);
   return {reference,expression:source.expression.surfaceForm,meaning:source.semanticSpec.coreMeaningFocus};
  }));
  const packageItems=await Promise.all(packages.slice(0,pageSize).map(async summary=>{
   const installation=packageInstallationSchema.parse(await tx.get('packageInstallations',summary.key)),entry=summary.content.entries[0]!;
   if(installation.artifact.digest!==summary.digest)throw new Error('direct_learning_source_changed');
   return {reference:{senseId:entry.senseId,senseVersionId:entry.senseVersionId,bindingId:entry.bindingId,bindingVersionId:entry.bindingVersionId,
    origin:{kind:'published_package' as const,packageKey:summary.key,packageDigest:installation.artifact.packageDigest}},expression:entry.expression,meaning:entry.semantic!.semanticSpec.coreMeaningFocus,
    publication:{title:summary.portableOrigin.manifest.metadata.title,version:summary.portableOrigin.manifest.metadata.version,supportLanguageTag:summary.content.supportLanguage}};
  }));
  return {items:[...packageItems,...registryItems],hasMore:registry.keys.length>pageSize||packages.length>pageSize};
 });
}
