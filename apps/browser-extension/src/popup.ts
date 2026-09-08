import {webUrl} from './config';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const errors:Record<string,string>={authentication_required:'请先连接 Sensa 账号。',access_revoked:'授权已失效，请重新连接原账号。材料仍保留。',unsupported_page:'此页面不支持采集，请打开普通文字网页。',account_mismatch:'请连接原账号以恢复待同步材料。',authorization_cancelled:'登录已取消，原材料仍保留。'};
async function act(kind:string){
 try{const response=await chrome.runtime.sendMessage({kind});if(response.error)throw new Error(response.error);const value=response.value;status.textContent=value.accountId?`已连接账号 · ${value.pending} 项待同步${value.errors.length?'，请重新连接原账号后检查结果':''}`:'尚未连接账号';
 const recent=document.querySelector('#recent')!;recent.replaceChildren();for(const item of value.recent){const link=document.createElement('a');const url=new URL(webUrl);url.searchParams.set('intake',item.id);link.href=url.href;link.target='_blank';link.textContent='已存入收件箱 · '+(item.snapshot.expression?.text??'文字材料');recent.append(link);}
 }catch(error){status.textContent=errors[error instanceof Error?error.message:'']??'暂时无法完成，请重试。原账号材料仍保留。';}}
for(const id of ['login','toggle','stop','sync','disconnect'])document.getElementById(id)!.addEventListener('click',()=>void act(id));void act('status');
