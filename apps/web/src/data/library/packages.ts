import {learningPackageSchema,learningPackageDescriptorSchema,type LearningPackageBundle,type LearningPackageDescriptor,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
export type InstalledPackage={key:string;digest:string;bundle:LearningPackageBundle;installedAt:string};
export const packageKey=(p:{id:string;version:string})=>JSON.stringify([p.id,p.version]);
export async function learningOwner(tx:LibraryTransaction){const identity=await tx.get<LibraryIdentity>('meta','identity');if(!identity||!await tx.get('meta','service-owner')||await tx.get('meta','signed-out'))throw new Error('请先登录原账号。');return identity;}
export const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');
export function validatePackage(raw:unknown){
 const bundle=learningPackageSchema.parse(raw);
 for(const entry of bundle.entries){
  const expression=entry.content.resources.find(r=>r.materialRoleKey==='target_expression')?.contentPayload.surface;
  if(expression!==entry.expression||entry.content.resources.find(r=>r.materialRoleKey==='sense_confirmation')?.contentPayload.meaning!==entry.meaning)throw new Error('学习包的表达与学习资源不一致。');
  for(const resource of entry.content.resources){
   if(resource.contentDigest!==canonicalJsonDigest(resource.contentPayload))throw new Error('学习资源校验失败，原有资料未改变。');
   const audio=resource.contentPayload.audioUrl;
   if(audio!=null&&(typeof audio!=='string'||!/^data:audio\/(?:mpeg|mp3|wav|ogg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(audio)))throw new Error('学习包音频尚未完整打包，不能标记为可离线使用。');
  }
 }
 return bundle;
}
export async function installPackage(bytes:Uint8Array,descriptor?:LearningPackageDescriptor,signal?:AbortSignal){
 if(bytes.length>8*1024*1024)throw new Error('学习包超过当前大小限制。');
 const digest=await sha256(bytes),bundle=validatePackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(descriptor){const d=learningPackageDescriptorSchema.parse(descriptor);if(bytes.length!==d.byteLength||digest!==d.sha256||bundle.id!==d.id||bundle.version!==d.version||bundle.entries.length!==d.entryCount)throw new Error('下载结果与目录版本不一致，请刷新目录后重试。');}
 return command({id:crypto.randomUUID(),kind:'package.install',input:{key:packageKey(bundle),digest}},async tx=>{
  await learningOwner(tx);if(signal?.aborted)throw new Error('下载已取消。');const key=packageKey(bundle),old=await tx.get<InstalledPackage>('packages',key);
  if(old){if(canonicalConsumerJson(old.bundle)!==canonicalConsumerJson(bundle))throw new Error('相同版本的学习包内容发生变化，已停止替换。');return old;}
  const installed={key,digest,bundle,installedAt:new Date().toISOString()};tx.put('packages',key,installed);return installed;
 });
}
export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packages'));
export async function downloadPackage(descriptor:LearningPackageDescriptor,signal:AbortSignal,progress:(bytes:number)=>void){
 const d=learningPackageDescriptorSchema.parse(descriptor);
 const response=await fetch(d.url,{signal,redirect:'error',credentials:'omit'});
 if(!response.ok||!response.body)throw new Error('学习包下载失败，请联网后重试。');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>d.byteLength)throw new Error('下载大小与目录不一致。');parts.push(next.value);progress(total);}}finally{await reader.cancel();}
 if(signal.aborted)throw new Error('下载已取消。');
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return installPackage(bytes,d,signal);
}
