import {validateRuntimeLearningRelease} from '@sensa/content-validator/runtime';
import {learningPackageSchema,learningPackageDescriptorSchema,learningBundleBookId,learningBundleBookVersionId,learningBundleVersionLabel,learningBundleTitle,learningDescriptorBookId,learningDescriptorBookVersionId,learningDescriptorVersionLabel,learningDescriptorTitle,type LearningPackageBundle,type LearningPackageDescriptor,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {canonicalJsonDigest,sha256 as syncSha256} from '@sensa/learning-kernel';
import {readLibrary,writeLibraryCache} from './store';
import {contentSupplyCommand} from './contentSupplyAdmission';
import {learningOwner} from './libraryOwnership';
import {descriptorMatchesInstallation,packageInstallationFor,packageInstallationSchema,packageKey,type InstalledPackage,type PackageInstallation} from './packageRecords';
export {installedPackages,packageInstallations,packageKey,type InstalledPackage,type PackageInstallation} from './packageRecords';
export {learningOwner} from './libraryOwnership';
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
async function readPackageBytes(bytes:Uint8Array,descriptor?:LearningPackageDescriptor){
 if(bytes.length>64*1024*1024)throw new Error('localFlow.packageTooLarge');
 const digest=await sha256(bytes),bundle=validatePackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(descriptor){const d=learningPackageDescriptorSchema.parse(descriptor);if(bytes.length!==d.byteLength||digest!==d.sha256||learningBundleBookId(bundle)!==learningDescriptorBookId(d)||learningBundleBookVersionId(bundle)!==learningDescriptorBookVersionId(d)||learningBundleVersionLabel(bundle)!==learningDescriptorVersionLabel(d)||learningBundleTitle(bundle)!==learningDescriptorTitle(d)||bundle.targetLanguage!==('targetLanguage' in d?d.targetLanguage:bundle.targetLanguage)||bundle.supportLanguage!==('supportLanguage' in d?d.supportLanguage:bundle.supportLanguage)||bundle.entries.length!==d.entryCount||'format' in d&&(bundle.format!=='sensa-book-release-bundle-v1'||bundle.book.bookKey!==d.book.bookKey||bundle.contentRelease.contentReleaseId!==d.contentRelease.contentReleaseId||bundle.contentRelease.versionNumber!==d.contentRelease.versionNumber||bundle.contentRelease.schemaVersion!==d.contentRelease.schemaVersion||bundle.publishedAt!==d.publishedAt||bundle.changeSummary!==d.changeSummary))throw new Error('localFlow.catalogMismatch');}
 return {digest,bundle,installation:packageInstallationFor(bundle,digest,bytes.length)};
}
export async function installPackage(bytes:Uint8Array,descriptor?:LearningPackageDescriptor,signal?:AbortSignal){
 const {digest,bundle,installation}=await readPackageBytes(bytes,descriptor);
 let installed:InstalledPackage|undefined;
 await contentSupplyCommand({id:crypto.randomUUID(),kind:'package.install',input:{key:packageKey(bundle),digest}},async tx=>{
  await learningOwner(tx);if(signal?.aborted)throw new Error('localFlow.downloadCancelled');const key=packageKey(bundle),old=await tx.get<InstalledPackage>('packageCache',key),prior=await tx.get<PackageInstallation>('packageInstallations',key);
  if(prior&&canonicalConsumerJson(packageInstallationSchema.parse(prior))!==canonicalConsumerJson(installation))throw new Error('localFlow.packageVersionChanged');
  if(old&&(old.digest!==digest||canonicalConsumerJson(old.bundle)!==canonicalConsumerJson(bundle)))throw new Error('localFlow.packageVersionChanged');
  installed=old??{key,digest,bundle,installedAt:new Date().toISOString()};
  tx.put('packageInstallations',key,installation);tx.put('packageCache',key,installed);return {key,digest};
 });
 if(!installed)throw new Error('localFlow.storageWrite');
 return installed;
}
async function fetchPackageBytes(descriptor:LearningPackageDescriptor,signal:AbortSignal,progress:(bytes:number)=>void){
 const d=learningPackageDescriptorSchema.parse(descriptor);
 const response=await fetch(d.url,{signal,redirect:'error',credentials:'omit'});
 if(!response.ok||!response.body)throw new Error('localFlow.downloadFailed');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>d.byteLength)throw new Error('localFlow.downloadSizeMismatch');parts.push(next.value);progress(total);}}finally{await reader.cancel();}
 if(signal.aborted)throw new Error('localFlow.downloadCancelled');
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return bytes;
}
export async function downloadPackage(descriptor:LearningPackageDescriptor,signal:AbortSignal,progress:(bytes:number)=>void){
 const d=learningPackageDescriptorSchema.parse(descriptor);
 return installPackage(await fetchPackageBytes(d,signal,progress),d,signal);
}

export type PackageRehydrationResult=Readonly<{ready:string[];blocked:string[];failed:string[]}>;
/** Reconcile device-local published bytes against synchronized installation facts. */
export async function rehydratePackageInstallations(
 descriptors?:readonly LearningPackageDescriptor[],
 signal:AbortSignal=AbortSignal.timeout(120000),
):Promise<PackageRehydrationResult>{
 const snapshot=await readLibrary(async tx=>{
  const installations=(await tx.all<PackageInstallation>('packageInstallations')).map(value=>packageInstallationSchema.parse(value));
  const cache=await tx.all<InstalledPackage>('packageCache');
  const catalog=await tx.get<LearningPackageDescriptor[]|{items:LearningPackageDescriptor[]}>('meta','package-catalog');
  const stored=descriptors??(Array.isArray(catalog)?catalog:catalog?.items??[]);
  return {installations,cache,descriptors:stored.map(value=>learningPackageDescriptorSchema.parse(value))};
 });
 const facts=new Map(snapshot.installations.map(value=>[value.key,value]));
 const stale=snapshot.cache.filter(value=>facts.get(value.key)?.artifact.digest!==value.digest).map(value=>value.key);
 if(stale.length)await writeLibraryCache(async tx=>{for(const key of stale)tx.delete('packageCache',key);});
 const ready=snapshot.cache.filter(value=>facts.get(value.key)?.artifact.digest===value.digest).map(value=>value.key),blocked:string[]=[],failed:string[]=[];
 const cached=new Set(ready);
 for(const installation of snapshot.installations){
  if(cached.has(installation.key))continue;
  const descriptor=snapshot.descriptors.find(value=>descriptorMatchesInstallation(value,installation));
  if(!descriptor){blocked.push(installation.key);continue;}
  try{
   const bytes=await fetchPackageBytes(descriptor,signal,()=>{}),loaded=await readPackageBytes(bytes,descriptor);
   if(canonicalConsumerJson(loaded.installation)!==canonicalConsumerJson(installation))throw new Error('localFlow.catalogMismatch');
   const installed:InstalledPackage={key:installation.key,digest:loaded.digest,bundle:loaded.bundle,installedAt:new Date().toISOString()};
   await writeLibraryCache(async tx=>tx.put('packageCache',installation.key,installed));ready.push(installation.key);
  }catch{failed.push(installation.key);}
 }
 return {ready:ready.sort(),blocked:blocked.sort(),failed:failed.sort()};
}
