/** Repackage the approved runtime release and verified local audio. No generation. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {provisionLightweightInitialContent} from '../../apps/web/src/experience/learningRuntime/lightweightInitialContent.ts';
import {validatePackage,sha256} from '../../apps/web/src/data/library/packages.ts';
const release=JSON.parse(await readFile('apps/web/src/experience/content/releases/golden-learning-release-v1.json','utf8'));
const words=new Set(['borrow','lend']);release.packages=release.packages.filter((p:any)=>words.has(p.identity.lexemeKey));release.lexemes=release.lexemes.filter((l:any)=>words.has(l.lexemeKey));
const senses=new Set(release.packages.map((p:any)=>p.identity.senseKey));release.relations=release.relations.filter((r:any)=>senses.has(r.sourceSenseKey)&&senses.has(r.targetSenseKey));release.media=release.media.filter((m:any)=>[...words].some(w=>m.mediaKey.startsWith(w+'.')));
release.release={...release.release,releaseKey:'sensa.borrow-lend.assurance',sourceDigest:'sha256:'+canonicalJsonDigest({packages:release.packages,media:release.media,lexemes:release.lexemes,relations:release.relations})};
if(validateRuntimeLearningRelease(release).issues.length)throw Error(JSON.stringify(validateRuntimeLearningRelease(release).issues));
const audio:Record<string,string>={};for(const m of release.media){const d=m.sha256.slice(7),bytes=await readFile('content/data/media/audio/'+d+'.mp3');if(await sha256(bytes)!==d)throw Error('Audio digest mismatch');audio[m.mediaKey]='data:audio/mpeg;base64,'+bytes.toString('base64');}
const version='1',owner=stableUuid('sensa:publisher'),packageId=stableUuid('sensa:borrow-lend:assurance');
const entries=release.packages.map((p:any)=>{
 const key=p.identity.packageKey,senseId=stableUuid('sensa:assurance:sense:'+key),senseVersionId=stableUuid('sensa:assurance:sense:'+key+':'+version),bindingId=stableUuid('sensa:assurance:binding:'+key),bindingVersionId=stableUuid('sensa:assurance:binding:'+key+':'+version),lexeme=release.lexemes.find((l:any)=>l.lexemeKey===p.identity.lexemeKey);
 const scene=p.experience.recap.bodyL1;
 const result=provisionLightweightInitialContent({learnerUserId:owner,learningTargetId:stableUuid('sensa:assurance:summary:'+key),senseId,senseVersionId,senseExpressionBindingId:bindingId,resolvedLearningPlanRevisionId:'assurance-summary-v1',expressionSourceVersion:version,senseSourceVersion:version,expression:{surface:lexeme.lemma,languageTag:'en',expressionKind:'word'},sense:{meaning:p.sense.guideLabelL1,familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:version,personalAnchorUseGrantId:null,experience:{scene,senseFocus:p.sense.guideLabelL1,featureLabels:[]}},referenceFacts:[],requestedAt:'2026-09-11T00:00:00Z'});
 if(result.status!=='ready')throw Error('Invalid overview');return {senseId,senseVersionId,bindingId,bindingVersionId,assurancePackageKey:key,expression:lexeme.lemma,meaning:p.sense.guideLabelL1,content:result.materialization.content};
});
const pack=validatePackage({format:'sensa-learning-package-v1',id:packageId,version,title:'Borrow & lend · 高保证学习',targetLanguage:'en',familiarLanguage:'zh-CN',entries,assurance:{release,audio}});
const bytes=Buffer.from(JSON.stringify(pack)),digest=await sha256(bytes),name=packageId+'-'+digest+'.json';const folder=resolve(process.env.SENSA_PACKAGE_OUTPUT??'release-candidate/learning-packages');await mkdir(folder,{recursive:true});await writeFile(resolve(folder,name),bytes);
const origin=process.env.SENSA_WEB_ORIGIN??'http://127.0.0.1:3001';const descriptor={id:packageId,version,title:pack.title,description:'借入与借出：场景经验、英美发音、例句、识别、回想、迁移及边界检验。',entryCount:entries.length,byteLength:bytes.length,sha256:digest,url:new URL('/learning-packages/'+name,origin).href};await writeFile('release-candidate/assurance-catalog.json',JSON.stringify({items:[descriptor]},null,2)+'\n');console.log('Verified assurance package: '+entries.length+' targets, '+Object.keys(audio).length+' audio assets, '+bytes.length+' bytes.');
