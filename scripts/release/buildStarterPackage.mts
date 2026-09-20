/** Build one immutable Registry snapshot from an explicit set of authored Books.
 * The historic filename remains a release-workflow entry point; its output is
 * no longer a legacy multi-entry "Sense package". */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {stableUuid} from '@sensa/learning-kernel';
import {bookReleaseBundleSchema,bookReleaseDescriptorSchema,learningContentRegistrySchema,sensaSenseSemanticSpecSchema,type SensaSenseSemanticSpec} from '@sensa/contracts/sensa';
import {provisionLightweightInitialContent} from '../../apps/web/src/learning/runtime/lightweightInitialContent.ts';

type Source={
 bookKey:string;title:string;description:string;versionNumber:number;publishedAt:string;changeSummary:string;
 targetLanguage:string;supportLanguage:string;
 entries:{
  key:string;senseVersion:number;bindingVersion:number;expression:string;meaning:string;scene:string;
  featureLabels?:string[];sceneBridge?:string;
  pronunciation?:{audioUrl:string|null;phoneticNotation:string|null;accentLabel:string|null};
  languageStructure?:{expressionTypeLabel:string|null;partOfSpeech:string|null;usagePattern?:string|null;contrastNote?:string|null};
  usageExamples?:{example:string;translation?:string|null;audioUrl?:string|null}[];
  semanticSpec:SensaSenseSemanticSpec;
 }[];
};

const configuredSources=process.env.SENSA_BOOK_RELEASE_SOURCES?.trim();
const sourcePaths=configuredSources?configuredSources.split(',').map(value=>value.trim()).filter(Boolean):(await readdir('content/authored',{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>'content/authored/'+entry.name);
if(!sourcePaths.length||new Set(sourcePaths).size!==sourcePaths.length)throw Error('Explicit unique authored Book release sources required');
const mediaRoot=resolve(process.env.SENSA_WEB_MEDIA_ROOT??'content/data/media/audio');
const packagedAudioUrl=async(audioUrl:string|null|undefined,label:string)=>{
 if(audioUrl==null)return null;
 if(/^data:audio\/(?:mpeg|mp3|wav|ogg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(audioUrl))return audioUrl;
 const match=audioUrl.match(/^\/golden-audio\/([a-f0-9]{64})\.mp3$/u);
 if(!match)throw Error(`Authored audio must be a packaged data URL or approved golden audio reference: ${label}`);
 const bytes=await readFile(resolve(mediaRoot,match[1]+'.mp3')).catch(()=>{throw Error(`Missing approved audio for ${label}: ${match[1]}`);});
 const digest=createHash('sha256').update(bytes).digest('hex');
 if(digest!==match[1])throw Error(`Approved audio digest mismatch for ${label}`);
 return `data:audio/mpeg;base64,${bytes.toString('base64')}`;
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
  const pronunciation=entry.pronunciation?{...entry.pronunciation,audioUrl:await packagedAudioUrl(entry.pronunciation.audioUrl,`${entry.key}:pronunciation`)}:undefined;
  const usageExamples=await Promise.all((entry.usageExamples??[]).map(async(example,index)=>({...example,audioUrl:await packagedAudioUrl(example.audioUrl,`${entry.key}:example:${index}`)})));
  const referenceFacts=[
   ...(pronunciation?[{source:'pronunciation_lexicon' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:pronunciation`,fact:{factKind:'pronunciation' as const,...pronunciation}}]:[]),
   ...(entry.languageStructure?[{source:'dictionary' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:structure`,fact:{factKind:'language_structure' as const,...entry.languageStructure}}]:[]),
   ...usageExamples.map((example,index)=>({source:'other_authoritative_source' as const,sourceVersion:`authored:${source.bookKey}:${source.versionNumber}:${entry.key}:example:${index}`,fact:{factKind:'usage_example' as const,example:example.example,translation:example.translation??null,audioUrl:example.audioUrl}})),
  ];
  const result=provisionLightweightInitialContent({learnerUserId:owner,learningTargetId:stableUuid('sensa:starter:target:'+entry.key),senseId,senseVersionId,senseExpressionBindingId:bindingId,resolvedLearningPlanRevisionId:`authored:${source.bookKey}:${source.versionNumber}`,expressionSourceVersion:String(entry.bindingVersion),senseSourceVersion:String(entry.senseVersion),expression:{surface:entry.expression,languageTag:source.targetLanguage,expressionKind:entry.expression.includes(' ')?'phrase':'word'},sense:{meaning:entry.meaning,supportLanguageTag:source.supportLanguage},originExperience:{source:'other_authoritative_source',sourceVersion:String(source.versionNumber),personalAnchorUseGrantId:null,experience:{scene:entry.scene,senseFocus:entry.meaning,featureLabels:entry.featureLabels??[],...(entry.sceneBridge?{sceneBridge:entry.sceneBridge}:{})}},referenceFacts,requestedAt:source.publishedAt});
  if(result.status!=='ready')throw Error('Authored resource failed material validation: '+entry.key);
  return {senseId,senseVersionId,bindingId,bindingVersionId,expression:entry.expression,meaning:entry.meaning,content:result.materialization.content,semantic:{senseKey:entry.key,senseVersionNumber:entry.senseVersion,semanticPolicyVersion:'sensa-editorial-starter-v1',semanticSpec,expressionId,expressionVersionId,expressionType:entry.expression.includes(' ')?'phrase' as const:'word' as const,expressionVersionNumber:entry.bindingVersion,expressionStructure:{},bindingVersionNumber:entry.bindingVersion,relation:'realizes' as const,semanticCoverage:'exact' as const,registerLabel:null,usageConstraints:[]}};
 }));
 const bundle=bookReleaseBundleSchema.parse({format:'sensa-book-release-bundle-v1',book:{bookId,bookKey:source.bookKey,bookVersionId,versionNumber:source.versionNumber,title:source.title,description:source.description},contentRelease:{contentReleaseId,versionNumber:source.versionNumber,schemaVersion:'sensa-consumer-content-v1'},targetLanguage:source.targetLanguage,supportLanguage:source.supportLanguage,publishedAt:source.publishedAt,changeSummary:source.changeSummary,entries});
 const bytes=Buffer.from(JSON.stringify(bundle)),sha256=createHash('sha256').update(bytes).digest('hex'),name=`${bookId}/${bookVersionId}/${sha256}.json`,file=resolve(folder,name);
 await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);
 descriptors.push(bookReleaseDescriptorSchema.parse({format:'sensa-book-release-descriptor-v1',book:bundle.book,contentRelease:bundle.contentRelease,targetLanguage:bundle.targetLanguage,supportLanguage:bundle.supportLanguage,publishedAt:bundle.publishedAt,changeSummary:bundle.changeSummary,entryCount:entries.length,byteLength:bytes.length,sha256,url:new URL(name,base).href}));
 totalEntries+=entries.length;
}

const publishedAt=descriptors.map(item=>item.publishedAt).sort().at(-1)!,registryWithoutRevision={format:'sensa-learning-content-registry-v1' as const,publishedAt,items:descriptors},revision=createHash('sha256').update(JSON.stringify(registryWithoutRevision)).digest('hex'),registry=learningContentRegistrySchema.parse({...registryWithoutRevision,revision});
await mkdir(dirname(catalogOutput),{recursive:true});await writeFile(catalogOutput,JSON.stringify(registry,null,2)+'\n');
console.log(`Built ${descriptors.length} Book release(s) with ${totalEntries} authored entries; material, bundle and Registry validation passed. No media generation, provider calls, publication or user acceptance claimed.`);
