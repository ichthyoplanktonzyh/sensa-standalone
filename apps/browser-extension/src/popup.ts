import {webUrl} from './config';
import type {NativeConnection} from './nativeDestination';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const progress:Record<string,string>={status:'正在检查账号…',login:'正在连接账号，请在打开的 Sensa 页面完成登录与连接…',toggle:'正在开启当前页阅读模式…',stop:'正在关闭当前页阅读模式…',sync:'正在检查保存与同步结果…',disconnect:'正在切换账号…'};
const success:Record<string,string>={login:'账号连接成功。',toggle:'当前页阅读模式已开启，可以划词查看意思。',stop:'当前页阅读模式已关闭。',sync:'已检查保存结果。',disconnect:'已断开当前账号，原账号材料已保留。'};
let busy=false,candidate:NativeConnection|null=null;
const errors:Record<string,string>={web_reconnect_required:'请重新连接 Sensa 账号以启用完整 Web 接收，旧队列仍保留。',web_queue_full:'插件暂存已满，请打开 Sensa 完成交接后再保存。',unsupported_library_version:'本机接入工具与学习库版本不兼容，请更新工具后重试，原队列已保留。',operation_conflict:'同一采集操作的内容发生了变化，已停止交接。请保留原请求并检查。',capture_resolution_conflict:'此上下文已有不同的词义处理结果，请到原生 Sensa 检查。',library_mismatch:'接收库标识不一致，已停止交接，原队列仍保留。',native_unavailable:'本机接入服务未就绪。请在原生 Sensa 的「采集接入」查看安装说明；已排队内容仍保留在原接收库队列。',connection_mismatch:'本机接入服务已换库，原队列不会转投。请重新选择接收库。',native_queue_full:'插件暂存队列已满，请先完成原队列交接。',client_update_required:'请更新插件，原队列已保留。',authentication_required:'请先登录 Sensa，登录后默认使用 Sensa 阅读服务。',access_revoked:'在线授权失效，请重新连接账号。本机保存不受影响。',unsupported_page:'此页面不支持采集，请打开普通文字网页。',account_mismatch:'接收目标已变化，请重新开启阅读模式。',authorization_cancelled:'登录已取消。'};
async function act(kind:string){
 if(busy)return;busy=true;buttons.forEach(b=>{b.disabled=true;});status.textContent=progress[kind]??'正在处理…';status.setAttribute('aria-busy','true');
 try{
  const response=await chrome.runtime.sendMessage({kind,...(kind==='native-select'?{connection:candidate}:{})});if(response.error)throw new Error(response.error);
  if(kind==='native-discover'){candidate=response.value;document.getElementById('native-candidate')!.textContent=`接收库：${candidate!.label}\n库标识：${candidate!.libraryId}\n网页采集将写入此库；不会复制到 Web，也不会自动加入学习。`;document.getElementById('native-candidate')!.hidden=false;document.getElementById('native-select')!.hidden=false;status.textContent='请确认接收库。';return;}
  if(kind==='native-select'||kind==='web-select'){candidate=null;document.getElementById('native-candidate')!.hidden=true;document.getElementById('native-select')!.hidden=true;}
  const v=response.value,native=v.destination==='native';
  status.textContent=native?`接收库：${v.label??'尚未选择'}\n${v.pending} 项等待交接${v.errors.length?'，存在交接错误，请恢复原连接后检查结果':''}`:v.accountId?`已连接账号 · Web 接收 · ${v.pending} 项等待交接${v.legacyPending?' · 另有 '+v.legacyPending+' 项旧版队列保留':''}`:'Web 接收 · 尚未连接账号';
  if(success[kind])status.textContent=success[kind]+'\n'+status.textContent;
  if(v.errors.length)status.textContent+='\n'+v.errors.map((e:string)=>errors[e]??e).join('\n');
  const recent=document.querySelector('#recent')!;recent.replaceChildren();
  for(const item of v.recent){const element=document.createElement(native?'p':'a');
   if(element instanceof HTMLAnchorElement){const url=new URL(v.destination==='web-local'?'/content/personal-meaning':webUrl,webUrl);url.searchParams.set(v.destination==='web-local'?'meaningId':('acceptanceId'in item||item.meaningId)?'meaning':'intake',item.meaningId??item.id);element.href=url.href;element.target='_blank';}
   element.textContent=(item.status==='removed'?'已移出 · ':item.status==='confirmed'?(native?'已确认词义 · ':'已加入 Sensa · '):'已存入收件箱 · ')+(item.snapshot.expression?.text??'文字材料');recent.append(element);
  }
  document.getElementById('recent-count')!.textContent=`${v.recent.length} 条`;
  const empty=document.getElementById('recent-empty')!;empty.hidden=v.recent.length>0;empty.textContent=native?'暂无已交接的内容。交接后可在原生 Sensa 刷新查看。':v.accountId?'暂无最近保存的内容。':'连接账号后查看最近保存的内容。';
 }catch(e){status.textContent=errors[e instanceof Error?e.message:'']??'暂时无法完成，原材料和交接队列仍保留。';}
 finally{busy=false;buttons.forEach(b=>{b.disabled=false;});status.setAttribute('aria-busy','false');}
}
for(const id of ['login','toggle','stop','sync','disconnect','native-discover','native-select','web-select'])document.getElementById(id)!.addEventListener('click',()=>void act(id));
document.getElementById('open-web')!.addEventListener('click',()=>void chrome.tabs.create({url:new URL('/content',webUrl).href}));
void act('status');document.getElementById('options')?.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
