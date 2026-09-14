import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {learningPackageSchema,learningPackageDescriptorSchema,learningBundleBookId,learningBundleBookVersionId,learningBundleVersionLabel,learningBundleTitle,learningDescriptorBookId,learningDescriptorBookVersionId,learningDescriptorVersionLabel,learningDescriptorTitle,type LearningPackageBundle,type LearningPackageDescriptor,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {canonicalJsonDigest,sha256 as syncSha256} from '@sensa/learning-kernel';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
export type InstalledPackage={key:string;digest:string;bundle:LearningPackageBundle;installedAt:string};
export const packageKey=(value:LearningPackageBundle|LearningPackageDescriptor)=>{
 const bookVersionId='entries' in value?learningBundleBookVersionId(value):learningDescriptorBookVersionId(value);
 if(bookVersionId&&'targetLanguage' in value&&'supportLanguage' in value)return JSON.stringify(['book-version',bookVersionId,value.targetLanguage,value.supportLanguage]);
 return JSON.stringify(['entries' in value?learningBundleBookId(value):learningDescriptorBookId(value),'entries' in value?learningBundleVersionLabel(value):learningDescriptorVersionLabel(value)]);
};
export async function learningOwner(tx:LibraryTransaction){const identity=await tx.get<LibraryIdentity>('meta','identity');if(!identity||!await tx.get('meta','service-owner')||await tx.get('meta','signed-out'))throw new Error('localFlow.originalAccount');return identity;}
export const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');
export function validatePackage(raw:unknown){
 const bundle=learningPackageSchema.parse(raw);
 if(bundle.assurance){
  const {release,audio}=bundle.assurance;
  if(validateRuntimeLearningRelease(release).issues.length)throw new Error('localFlow.resourceInvalid');
  if(release.packages.length!==bundle.entries.length||new Set(bundle.entries.map(e=>e.assurancePackageKey)).size!==bundle.entries.length)throw new Error('localFlow.packageMismatch');
  for(const m of release.media){const data=audio[m.mediaKey];if(m.kind!=='audio'||!data)throw new Error('localFlow.audioIncomplete');const bytes=Uint8Array.from(atob(data.split(',')[1]!),c=>c.charCodeAt(0));if('sha256:'+syncSha256(bytes)!==m.sha256)throw new Error('localFlow.resourceInvalid');}
  if(Object.keys(audio).length!==release.media.length)throw new Error('localFlow.resourceInvalid');
  for(const e of bundle.entries){const p=release.packages.find(p=>p.identity.packageKey===e.assurancePackageKey),lexeme=release.lexemes.find(l=>l.lexemeKey===p?.identity.lexemeKey);if(!p||lexeme?.lemma!==e.expression||p.sense.guideLabelL1!==e.meaning)throw new Error('localFlow.packageMismatch');}
 }else if(bundle.entries.some(e=>e.assurancePackageKey))throw new Error('localFlow.packageMismatch');
 for(const entry of bundle.entries){
  const expression=entry.content.resources.find(r=>r.materialRoleKey==='target_expression')?.contentPayload.surface;
  if(expression!==entry.expression||entry.content.resources.find(r=>r.materialRoleKey==='sense_confirmation')?.contentPayload.meaning!==entry.meaning)throw new Error('localFlow.packageMismatch');
  for(const resource of entry.content.resources){
   if(resource.contentDigest!==canonicalJsonDigest(resource.contentPayload))throw new Error('localFlow.resourceInvalid');
   const audio=resource.contentPayload.audioUrl;
   if(audio!=null&&(typeof audio!=='string'||!/^data:audio\/(?:mpeg|mp3|wav|ogg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(audio)))throw new Error('localFlow.audioIncomplete');
  }
 }
 return bundle;
}
export async function installPackage(bytes:Uint8Array,descriptor?:LearningPackageDescriptor,signal?:AbortSignal){
 if(bytes.length>64*1024*1024)throw new Error('localFlow.packageTooLarge');
 const digest=await sha256(bytes),bundle=validatePackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(descriptor){const d=learningPackageDescriptorSchema.parse(descriptor);if(bytes.length!==d.byteLength||digest!==d.sha256||learningBundleBookId(bundle)!==learningDescriptorBookId(d)||learningBundleBookVersionId(bundle)!==learningDescriptorBookVersionId(d)||learningBundleVersionLabel(bundle)!==learningDescriptorVersionLabel(d)||learningBundleTitle(bundle)!==learningDescriptorTitle(d)||bundle.targetLanguage!==('targetLanguage' in d?d.targetLanguage:bundle.targetLanguage)||bundle.supportLanguage!==('supportLanguage' in d?d.supportLanguage:bundle.supportLanguage)||bundle.entries.length!==d.entryCount||'format' in d&&(bundle.format!=='sensa-book-release-bundle-v1'||bundle.book.bookKey!==d.book.bookKey||bundle.contentRelease.contentReleaseId!==d.contentRelease.contentReleaseId||bundle.contentRelease.versionNumber!==d.contentRelease.versionNumber||bundle.contentRelease.schemaVersion!==d.contentRelease.schemaVersion||bundle.publishedAt!==d.publishedAt||bundle.changeSummary!==d.changeSummary))throw new Error('localFlow.catalogMismatch');}
 return command({id:crypto.randomUUID(),kind:'package.install',input:{key:packageKey(bundle),digest}},async tx=>{
  await learningOwner(tx);if(signal?.aborted)throw new Error('localFlow.downloadCancelled');const key=packageKey(bundle),old=await tx.get<InstalledPackage>('packages',key);
  if(old){if(canonicalConsumerJson(old.bundle)!==canonicalConsumerJson(bundle))throw new Error('localFlow.packageVersionChanged');return old;}
  const installed={key,digest,bundle,installedAt:new Date().toISOString()};tx.put('packages',key,installed);return installed;
 });
}
export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packages'));
export async function downloadPackage(descriptor:LearningPackageDescriptor,signal:AbortSignal,progress:(bytes:number)=>void){
 const d=learningPackageDescriptorSchema.parse(descriptor);
 const response=await fetch(d.url,{signal,redirect:'error',credentials:'omit'});
 if(!response.ok||!response.body)throw new Error('localFlow.downloadFailed');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>d.byteLength)throw new Error('localFlow.downloadSizeMismatch');parts.push(next.value);progress(total);}}finally{await reader.cancel();}
 if(signal.aborted)throw new Error('localFlow.downloadCancelled');
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return installPackage(bytes,d,signal);
}
