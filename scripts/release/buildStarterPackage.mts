/** Build one immutable Registry snapshot from an explicit set of authored Books.
 * The historic filename remains a release-workflow entry point; its output is
 * no longer a legacy multi-entry "Sense package". */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {stableUuid} from '@sensa/learning-kernel';
import {bookReleaseBundleSchema,bookReleaseDescriptorSchema,learningContentRegistrySchema,sensaSenseSemanticSpecSchema,type SensaSenseSemanticSpec,sensaLightweightExpressionSnapshotSchema,learningReferenceInputSchema} from '@sensa/contracts/sensa';
import {provisionLightweightInitialContent} from '../../apps/web/src/learning/runtime/lightweightInitialContent.ts';
import {createAuthoredMediaPackager,type AuthoredMediaInput,type AuthoredMediaReference} from './authoredMedia.mts';

type Source={
 bookKey:string;title:string;description:string;versionNumber:number;publishedAt:string;changeSummary:string;
 targetLanguage:string;supportLanguage:string;
 entries:{
  expressionKind?:"word"|"phrase"|"construction"|"utterance"|"sentence";spokenForm?:string;formParts?:{kind:"fixed"|"slot";text:string;constraint?:string}[];referenceFacts?:unknown[];
  key:string;acceptedForms?:string[];senseVersion:number;bindingVersion:number;expression:string;meaning:string;scene:string;
  featureLabels?:string[];sceneBridge?:string;
  pronunciation?:{audio?:AuthoredMediaInput;audioUrl?:string;phoneticNotation:string|null;accentLabel:string|null;source:string;method:"recording"|"tts"};
  languageStructure?:{expressionTypeLabel:string|null;partOfSpeech:string|null;usagePattern?:string|null;contrastNote?:string|null};
  sceneExample?:{targetStart:number;targetEnd:number;example:string;translation?:string|null;audio?:AuthoredMediaInput|null;audioUrl?:string|null};
  usageExamples?:{example:string;translation?:string|null;audio?:AuthoredMediaInput|null;audioUrl?:string|null}[];
  images?:{name:string;media:AuthoredMediaReference}[];
  semanticSpec:SensaSenseSemanticSpec;
 }[];
};

const configuredSources=process.env.SENSA_BOOK_RELEASE_SOURCES?.trim();
const sourcePaths=configuredSources?configuredSources.split(',').map(value=>value.trim()).filter(Boolean):(await readdir('content/authored',{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>'content/authored/'+entry.name);
if(!sourcePaths.length||new Set(sourcePaths).size!==sourcePaths.length)throw Error('Explicit unique authored Book release sources required');
const media=await createAuthoredMediaPackager({mediaRoot:resolve(process.env.SENSA_AUTHORED_MEDIA_ROOT??'content/data/media'),...(process.env.SENSA_AUTHORED_MEDIA_PACK?.trim()?{mediaPackPath:resolve(process.env.SENSA_AUTHORED_MEDIA_PACK)}:{})});
const mediaInput=(audio:AuthoredMediaInput|null|undefined,audioUrl:string|null|undefined,label:string)=>{
 if(audio!=null&&audioUrl!=null)throw Error(`Authored media has two competing references: ${label}`);
 return audio??audioUrl;
};
const origin=new URL(process.env.SENSA_WEB_ORIGIN??'https://candidate.invalid');
if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw Error('HTTPS origin required');
const defaultBase=new URL('/learning-packages/',origin),base=new URL(process.env.SENSA_PACKAGE_BASE_URL??defaultBase);
if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw Error('Safe package base URL required');
if(!base.pathname.endsWith('/'))base.pathname+='/'
const folder=resolve(process.env.SENSA_PACKAGE_OUTPUT??'release-candidate/learning-packages'),catalogOutput=resolve(process.env.SENSA_PACKAGE_CATALOG_OUTPUT??'release-candidate/catalog.json'),owner=stableUuid('sensa:publisher'),descriptors=[];
let totalEntries=0;

for(const path of sourcePaths.sort()){
 const source=JSON.parse(await readFile(path,'utf8')) as Source;
 if(!source.bookKey?.trim()||!Number.isInteger(source.versionNumber)||source.versionNumber<1||!Number.isFinite(Date.parse(source.publishedAt)))throw Error(`Invalid authored Book identity: ${path}`);
 if(!source.targetLanguage?.trim())throw Error('Authored resource must name its target language');
 if(!source.supportLanguage?.trim())throw Error('Authored resource must name its Support Language');
 if(!source.entries?.length||new Set(source.entries.map(entry=>entry.key)).size!==source.entries.length)throw Error(`Authored Book must contain unique entry keys: ${path}`);
 const bookId=stableUuid('sensa:book:'+source.bookKey),bookVersionId=stableUuid(`sensa:book:${source.bookKey}:version:${source.versionNumber}`),contentReleaseId=stableUuid(`sensa:content-release:${source.bookKey}:version:${source.versionNumber}`);
 const entries=await Promise.all(source.entries.map(async entry=>{
  if(!Number.isInteger(entry.senseVersion)||entry.senseVersion<1||!Number.isInteger(entry.bindingVersion)||entry.bindingVersion<1)throw Error(`Entry versions must be positive: ${entry.key}`);
  const semanticSpec=sensaSenseSemanticSpecSchema.parse(entry.semanticSpec),senseId=stableUuid('sensa:starter:sense:'+entry.key),senseVersionId=stableUuid(`sensa:starter:sense:${entry.key}:version:${entry.senseVersion}`),expressionKey=`${source.targetLanguage}:${entry.expression.trim().toLocaleLowerCase()}`,expressionId=stableUuid('sensa:starter:expression:'+expressionKey),expressionVersionId=stableUuid(`sensa:starter:expression:${expressionKey}:version:${entry.bindingVersion}`),bindingId=stableUuid('sensa:starter:binding:'+entry.key),bindingVersionId=stableUuid(`sensa:starter:binding:${entry.key}:version:${entry.bindingVersion}`);
  const expression=sensaLightweightExpressionSnapshotSchema.parse({surface:entry.expression,languageTag:source.targetLanguage,expressionKind:entry.expressionKind??'unspecified',...(entry.spokenForm?{spokenForm:entry.spokenForm}:{}),...(entry.formParts?{formParts:entry.formParts}:{}),...(entry.acceptedForms?{acceptedForms:entry.acceptedForms}:{})});
  if(expression.expressionKind==='unspecified')throw Error(`Authored expressionKind required: ${entry.key}`);
  const pronunciation=entry.pronunciation?await(async()=>{const {audio,audioUrl,...authored}=entry.pronunciation!;const packaged=await media.embed(mediaInput(audio,audioUrl,`${entry.key}:pronunciation`),`${entry.key}:pronunciation`);if(!packaged)throw Error(`Authored pronunciation audio required: ${entry.key}`);return {...authored,surface:entry.spokenForm??entry.expression,languageTag:source.targetLanguage,audioUrl:packaged};})():undefined;
  const authoredExamples=entry.usageExamples??[];
  const usageExamples=await Promise.all(authoredExamples.map(async(example,index)=>{const {audio,audioUrl,...authored}=example;return {...authored,audioUrl:await media.embed(mediaInput(audio,audioUrl,`${entry.key}:example:${index}`),`${entry.key}:example:${index}`)};}));
  const images=await Promise.all((entry.images??[]).map(async(image,index)=>({id:stableUuid(`sensa:authored-image:${entry.key}:${image.media.sha256}:${index}`),name:image.name,dataUrl:(await media.embed(image.media,`${entry.key}:image:${index}`))!})));
  const referenceFacts=[
   ...(entry.referenceFacts??[]).map(fact=>learningReferenceInputSchema.parse(fact)),
   ...(pronunciation?[{source:'pronunciation_lexicon' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:pronunciation`,fact:{factKind:'pronunciation' as const,...pronunciation}}]:[]),
   ...(entry.languageStructure?[{source:'dictionary' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:structure`,fact:{factKind:'language_structure' as const,...entry.languageStructure}}]:[]),
   ...usageExamples.map((example,index)=>({source:'other_authoritative_source' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:example:${index}`,fact:{factKind:'usage_example' as const,example:example.example,translation:example.translation??null,audioUrl:example.audioUrl}})),
  ];
  const result=provisionLightweightInitialContent({learnerUserId:owner,learningTargetId:stableUuid('sensa:starter:target:'+entry.key),senseId,senseVersionId,senseExpressionBindingId:bindingId,resolvedLearningPlanRevisionId:`authored:${source.bookKey}:${source.versionNumber}`,expressionSourceVersion:String(entry.bindingVersion),senseSourceVersion:String(entry.senseVersion),expression,sense:{meaning:entry.meaning,supportLanguageTag:source.supportLanguage},originExperience:{source:'other_authoritative_source',sourceVersion:String(source.versionNumber),personalAnchorUseGrantId:null,experience:{scene:entry.scene,senseFocus:entry.meaning,featureLabels:entry.featureLabels??[],...(images.length?{images}:{}),...(entry.sceneExample?{sceneRealization:{example:entry.sceneExample.example,targetStart:entry.sceneExample.targetStart,targetEnd:entry.sceneExample.targetEnd,translation:entry.sceneExample.translation??null,audioUrl:await media.embed(mediaInput(entry.sceneExample.audio,entry.sceneExample.audioUrl,`${entry.key}:scene`),`${entry.key}:scene`)}}:{}),...(entry.sceneBridge?{sceneBridge:entry.sceneBridge}:{})}},referenceFacts,requestedAt:source.publishedAt});
  if(result.status!=='ready')throw Error(`Authored resource failed material validation: ${entry.key} (${JSON.stringify(result.issues)})`);
  return {senseId,senseVersionId,bindingId,bindingVersionId,expression:entry.expression,meaning:entry.meaning,content:result.materialization.content,semantic:{senseKey:entry.key,senseVersionNumber:entry.senseVersion,semanticPolicyVersion:'sensa-editorial-starter-v1',semanticSpec,expressionId,expressionVersionId,expressionType:expression.expressionKind==='utterance'?'utterance_strategy' as const:expression.expressionKind,expressionVersionNumber:entry.bindingVersion,expressionStructure:{...(entry.spokenForm?{spokenForm:entry.spokenForm}:{}),...(entry.formParts?{formParts:entry.formParts}:{})},bindingVersionNumber:entry.bindingVersion,relation:'realizes' as const,semanticCoverage:'exact' as const,registerLabel:null,usageConstraints:[]}};
 }));
 const bundle=bookReleaseBundleSchema.parse({format:'sensa-book-release-bundle-v1',book:{bookId,bookKey:source.bookKey,bookVersionId,versionNumber:source.versionNumber,title:source.title,description:source.description},contentRelease:{contentReleaseId,versionNumber:source.versionNumber,schemaVersion:'sensa-consumer-content-v1'},targetLanguage:source.targetLanguage,supportLanguage:source.supportLanguage,publishedAt:source.publishedAt,changeSummary:source.changeSummary,entries});
 const bytes=Buffer.from(JSON.stringify(bundle)),sha256=createHash('sha256').update(bytes).digest('hex'),name=`${bookId}/${bookVersionId}/${sha256}.json`,file=resolve(folder,name);
 await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);
 descriptors.push(bookReleaseDescriptorSchema.parse({format:'sensa-book-release-descriptor-v1',book:bundle.book,contentRelease:bundle.contentRelease,targetLanguage:bundle.targetLanguage,supportLanguage:bundle.supportLanguage,publishedAt:bundle.publishedAt,changeSummary:bundle.changeSummary,entryCount:entries.length,byteLength:bytes.length,sha256,url:new URL(name,base).href}));
 totalEntries+=entries.length;
}

media.assertSealedPackFullyConsumed();

const publishedAt=descriptors.map(item=>item.publishedAt).sort().at(-1)!,registryWithoutRevision={format:'sensa-learning-content-registry-v1' as const,publishedAt,items:descriptors},revision=createHash('sha256').update(JSON.stringify(registryWithoutRevision)).digest('hex'),registry=learningContentRegistrySchema.parse({...registryWithoutRevision,revision});
await mkdir(dirname(catalogOutput),{recursive:true});await writeFile(catalogOutput,JSON.stringify(registry,null,2)+'\n');
console.log(`Built ${descriptors.length} Book release(s) with ${totalEntries} authored entries; material, bundle and Registry validation passed. No media generation, provider calls, publication or user acceptance claimed.`);
