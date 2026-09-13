/** Authored public text resources; no model calls or learner data. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {stableUuid} from '@sensa/learning-kernel';
import {learningPackageSchema,learningPackageDescriptorSchema} from '@sensa/contracts/sensa';
import {provisionLightweightInitialContent} from '../../apps/web/src/learning/runtime/lightweightInitialContent.ts';
const source=JSON.parse(await readFile('content/authored/web-starter.json','utf8')) as {
 title:string;description:string;version:string;
 /** The languages the authored text is in. They belong to the resource rather
  * than to this script, so authoring another language's starter resource is a
  * data change and cannot silently inherit this one's languages. */
 targetLanguage:string;supportLanguage:string;
 entries:{key:string;expression:string;meaning:string;scene:string}[];
};
if(!source.targetLanguage?.trim())throw Error('Authored resource must name its target language');
if(!source.supportLanguage?.trim())throw Error('Authored resource must name its Support Language');
if(source.targetLanguage===source.supportLanguage)throw Error('Authored resource cannot teach the language it explains in');
const origin=new URL(process.env.SENSA_WEB_ORIGIN??'https://candidate.invalid');
if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw Error('HTTPS origin required');
const packageId=stableUuid('sensa:authored:daily-exchanges'),owner=stableUuid('sensa:publisher');
const entries=source.entries.map(e=>{
 const senseId=stableUuid('sensa:starter:sense:'+e.key),senseVersionId=stableUuid('sensa:starter:sense:'+e.key+':'+source.version),bindingId=stableUuid('sensa:starter:binding:'+e.key),bindingVersionId=stableUuid('sensa:starter:binding:'+e.key+':'+source.version);
 const result=provisionLightweightInitialContent({learnerUserId:owner,learningTargetId:stableUuid('sensa:starter:target:'+e.key),senseId,senseVersionId,senseExpressionBindingId:bindingId,resolvedLearningPlanRevisionId:'authored-starter-v1',expressionSourceVersion:source.version,senseSourceVersion:source.version,expression:{surface:e.expression,languageTag:source.targetLanguage,expressionKind:e.expression.includes(' ')?'phrase':'word'},sense:{meaning:e.meaning,supportLanguageTag:source.supportLanguage},originExperience:{source:'other_authoritative_source',sourceVersion:source.version,personalAnchorUseGrantId:null,experience:{scene:e.scene,senseFocus:e.meaning,featureLabels:[]}},referenceFacts:[],requestedAt:'2026-09-10T00:00:00Z'});
 if(result.status!=='ready')throw Error('Authored resource failed material validation: '+e.key);
 return {senseId,senseVersionId,bindingId,bindingVersionId,expression:e.expression,meaning:e.meaning,content:result.materialization.content};
});
const pack=learningPackageSchema.parse({format:'sensa-learning-package-v1',id:packageId,version:source.version,title:source.title,targetLanguage:source.targetLanguage,supportLanguage:source.supportLanguage,entries});
const bytes=Buffer.from(JSON.stringify(pack)),sha256=createHash('sha256').update(bytes).digest('hex'),name=`${packageId}-${sha256}.json`;
const folder=resolve(process.env.SENSA_PACKAGE_OUTPUT??'release-candidate/learning-packages');await mkdir(folder,{recursive:true});await writeFile(resolve(folder,name),bytes);
const descriptor=learningPackageDescriptorSchema.parse({id:pack.id,version:pack.version,title:pack.title,description:source.description,entryCount:entries.length,byteLength:bytes.length,sha256,url:new URL('/learning-packages/'+name,origin).href});
await mkdir('release-candidate',{recursive:true});await writeFile('release-candidate/catalog.json',JSON.stringify({items:[descriptor]},null,2)+'\n');
console.log(`Built ${entries.length} authored text entries; material/package validation passed. No audio, provider calls or user acceptance claimed.`);
