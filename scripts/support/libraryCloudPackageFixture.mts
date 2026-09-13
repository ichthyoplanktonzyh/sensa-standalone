/** Synthetic package for cloud-sync tests; no generated files, media downloads or provider calls. */
import {readFile} from 'node:fs/promises';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {provisionLightweightInitialContent} from '../../apps/web/src/learning/runtime/lightweightInitialContent.ts';
import {validatePackage,sha256} from '../../apps/web/src/data/library/packages.ts';
export async function libraryCloudPackageFixture(){
const release=JSON.parse(await readFile(new URL('../../apps/web/src/learning/content/releases/golden-learning-release-v1.json',import.meta.url),'utf8'));
const words=new Set(['borrow','lend']);release.packages=release.packages.filter((p:any)=>words.has(p.identity.lexemeKey));release.lexemes=release.lexemes.filter((l:any)=>words.has(l.lexemeKey));
const senses=new Set(release.packages.map((p:any)=>p.identity.senseKey));release.relations=release.relations.filter((r:any)=>senses.has(r.sourceSenseKey)&&senses.has(r.targetSenseKey));release.media=release.media.filter((m:any)=>[...words].some(w=>m.mediaKey.startsWith(w+'.')));
// Audio bytes only exercise digest, storage and restoration, not playback quality.
const audio:Record<string,string>={};
for(const media of release.media){
 const bytes=Buffer.from('synthetic-sync-audio:'+media.mediaKey),digest=await sha256(bytes);
 media.sha256='sha256:'+digest;media.uri='content://sha256/'+digest;
 audio[media.mediaKey]='data:audio/mpeg;base64,'+bytes.toString('base64');
}
release.release={...release.release,releaseKey:'sensa.sync-test.assurance',sourceDigest:'sha256:'+canonicalJsonDigest({packages:release.packages,media:release.media,lexemes:release.lexemes,relations:release.relations})};
const validation=validateRuntimeLearningRelease(release);
if(validation.issues.length)throw Error(JSON.stringify(validation.issues));
const version='1',owner=stableUuid('sensa:publisher'),packageId=stableUuid('sensa:borrow-lend:assurance');
const entries=release.packages.map((p:any)=>{
 const key=p.identity.packageKey,senseId=stableUuid('sensa:assurance:sense:'+key),senseVersionId=stableUuid('sensa:assurance:sense:'+key+':'+version),bindingId=stableUuid('sensa:assurance:binding:'+key),bindingVersionId=stableUuid('sensa:assurance:binding:'+key+':'+version),lexeme=release.lexemes.find((l:any)=>l.lexemeKey===p.identity.lexemeKey);
 const scene=p.experience.recap.bodyL1;
 const result=provisionLightweightInitialContent({learnerUserId:owner,learningTargetId:stableUuid('sensa:assurance:summary:'+key),senseId,senseVersionId,senseExpressionBindingId:bindingId,resolvedLearningPlanRevisionId:'assurance-summary-v1',expressionSourceVersion:version,senseSourceVersion:version,expression:{surface:lexeme.lemma,languageTag:'en',expressionKind:'word'},sense:{meaning:p.sense.guideLabelL1,familiarLanguageTag:'zh-CN'},originExperience:{source:'other_authoritative_source',sourceVersion:version,personalAnchorUseGrantId:null,experience:{scene,senseFocus:p.sense.guideLabelL1,featureLabels:[]}},referenceFacts:[],requestedAt:'2026-09-11T00:00:00Z'});
 if(result.status!=='ready')throw Error('Invalid overview');return {senseId,senseVersionId,bindingId,bindingVersionId,assurancePackageKey:key,expression:lexeme.lemma,meaning:p.sense.guideLabelL1,content:result.materialization.content};
});
const pack=validatePackage({format:'sensa-learning-package-v1',id:packageId,version,title:'Borrow & lend · 高保证学习',targetLanguage:'en',familiarLanguage:'zh-CN',entries,assurance:{release,audio}});
const bytes=Buffer.from(JSON.stringify(pack));
const descriptor={id:packageId,version,title:pack.title,description:'Synthetic cloud-sync fixture',entryCount:entries.length,byteLength:bytes.length,sha256:await sha256(bytes),url:'https://fixture.invalid/sync-package.json'};
return {bytes:Array.from(bytes),descriptor};
}
