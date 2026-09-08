import {webUrl} from './config';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const progress:Record<string,string>={status:'正在检查账号…',login:'正在连接账号，请在打开的 Sensa 页面完成登录与连接…',toggle:'正在开启当前页阅读模式…',stop:'正在关闭当前页阅读模式…',sync:'正在检查保存与同步结果…',disconnect:'正在切换账号…'};
const success:Record<string,string>={login:'账号连接成功。',toggle:'当前页阅读模式已开启，可以划词查看意思。',stop:'当前页阅读模式已关闭。',sync:'已检查保存结果。',disconnect:'已断开当前账号，请点击「连接 Sensa 账号」连接其他账号。原账号材料已保留。'};
let busy=false;
const errors:Record<string,string>={client_update_required:'本机数据需要兼容的插件版本。请更新插件，原队列已保留。',authentication_required:'请先连接 Sensa 账号。',access_revoked:'授权已失效，请重新连接原账号。材料仍保留。',unsupported_page:'此页面不支持采集，请打开普通文字网页。',account_mismatch:'请连接原账号以恢复待同步材料。',authorization_cancelled:'登录已取消，原材料仍保留。'};
async function act(kind:string){
 if(busy)return;busy=true;buttons.forEach(button=>{button.disabled=true;});status.textContent=progress[kind];status.setAttribute('aria-busy','true');
 const trigger=buttons.find(button=>button.id===kind),label=trigger?.textContent;if(trigger)trigger.textContent=kind==='login'?'等待账号连接…':'正在处理…';
 try{const response=await chrome.runtime.sendMessage({kind});if(response.error)throw new Error(response.error);const value=response.value;const account=value.accountId?`已连接账号 · ${value.pending} 项待同步${value.errors.length?'，请重新连接原账号后检查结果':''}`:'尚未连接账号';status.textContent=[success[kind],account].filter(Boolean).join('\n');
 const recent=document.querySelector('#recent')!;recent.replaceChildren();for(const item of value.recent){const link=document.createElement('a');const url=new URL(webUrl);url.searchParams.set(('acceptanceId' in item||item.meaningId)?'meaning':'intake',item.meaningId??item.id);link.href=url.href;link.target='_blank';link.textContent=(item.status==='removed'?'已移出我的内容 · ':item.status==='confirmed'?'已加入 Sensa · ':'已存入收件箱 · ')+(item.snapshot.expression?.text??'文字材料');recent.append(link);}
 }catch(error){status.textContent=errors[error instanceof Error?error.message:'']??'暂时无法完成，请重试。原账号材料仍保留。';}
 finally{busy=false;buttons.forEach(button=>{button.disabled=false;});if(trigger&&label)trigger.textContent=label;status.setAttribute('aria-busy','false');}}
for(const id of ['login','toggle','stop','sync','disconnect'])document.getElementById(id)!.addEventListener('click',()=>void act(id));void act('status');
