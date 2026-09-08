import type {CaptureSnapshot} from '@sensa/contracts/sensa';
// This bundle runs only after activeTab authorization. No whole-page text is read.
const key='__sensaCaptureInstalled';
const local=globalThis as typeof globalThis & {__sensaCaptureInstalled?:boolean};
if(!local[key]){
 local[key]=true;
 let enabled=false,host:HTMLDivElement|null=null;
 const close=()=>{host?.remove();host=null;};
 chrome.runtime.onMessage.addListener(message=>{if(message.kind==='reading'){enabled=message.enabled;if(!enabled)close();}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 document.addEventListener('pointerdown',event=>{if(host&&!event.composedPath().includes(host))close();});
 function selected(){
 if(!enabled||host?.matches(':hover'))return;
 const selection=getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
 const range=selection.getRangeAt(0);if(host?.contains(range.commonAncestorContainer))return;
 const start=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer as Element;
 if(!start||start.closest('input,textarea,[contenteditable="true"],script,style'))return;
 const block=start.closest('p,li,blockquote,td,h1,h2,h3,h4,pre')??start;
 if(block===document.body||block===document.documentElement||!block.contains(range.endContainer))return;
 const text=block.textContent??'';if(text.length>24000)return;
 const prefix=document.createRange();prefix.selectNodeContents(block);prefix.setEnd(range.startContainer,range.startOffset);const from=prefix.toString().length,to=from+range.toString().length;
 if(!range.toString().trim()||to-from>2000)return;
 const segments=Array.from(new Intl.Segmenter('en',{granularity:'sentence'}).segment(text));
 const sentence=segments.find(s=>s.index<=from&&s.index+s.segment.length>=to);
 const raw=sentence?.segment??range.toString(),offset=sentence?from-sentence.index:0;
 const snapshot:CaptureSnapshot={sentence:raw,language:'en',expression:sentence?{text:range.toString(),start:Array.from(raw.slice(0,offset)).length,end:Array.from(raw.slice(0,offset+to-from)).length}:null,source:{url:location.href,title:document.title.slice(0,1000),capturedAt:new Date().toISOString()}};
 if(raw.length>12000)return;
 close();host=document.createElement('div');const shadow=host.attachShadow({mode:'closed'});const rect=range.getBoundingClientRect();host.style.cssText=`position:fixed;z-index:2147483647;left:${Math.max(8,Math.min(rect.left,innerWidth-376))}px;top:${Math.max(8,Math.min(rect.bottom+8,innerHeight-300))}px;width:min(360px,calc(100vw - 16px));`;
 const style=document.createElement('style');style.textContent=':host{all:initial}section{font:15px/1.6 system-ui,sans-serif;color:#242a38;background:#fbfbfa;border:1px solid #bec5d5;border-radius:16px;padding:16px;box-shadow:0 8px 32px #0002;max-height:65vh;overflow:auto}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}button{font:inherit;min-height:44px;padding:8px 12px;margin:4px 6px 0 0;border:1px solid #bec5d5;border-radius:10px;background:white;color:#242a38;cursor:pointer}button:focus-visible{outline:3px solid #303f76}mark{background:#f5e5a6;color:#242a38}';shadow.append(style);
 const panel=document.createElement('section');panel.setAttribute('aria-label','Sensa 采集');const title=document.createElement('strong');title.textContent='Sensa';panel.append(title);
 const original=document.createElement('p');const e=snapshot.expression,chars=Array.from(raw);if(e){original.append(chars.slice(0,e.start).join(''));const mark=document.createElement('mark');mark.textContent=e.text;original.append(mark,chars.slice(e.end).join(''));}else original.textContent=raw;panel.append(original);
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='句中解释尚未接通，可以先保存待处理。';panel.append(status);
 const save=document.createElement('button'),dismiss=document.createElement('button');save.textContent='保存待处理';dismiss.textContent='关闭';dismiss.onclick=close;const operationId=crypto.randomUUID();
 save.onclick=async()=>{save.disabled=true;try{const response=await chrome.runtime.sendMessage({kind:'save',snapshot,operationId});if(response.error)throw new Error(response.error);status.textContent='已保存在本机，联网后同步。可从 Sensa 图标查看结果。';save.hidden=true;}catch{status.textContent='尚未保存，请从 Sensa 图标检查登录并重试。';save.disabled=false;}};panel.append(save,dismiss);shadow.append(panel);document.documentElement.append(host);
 }
 document.addEventListener('pointerup',()=>{setTimeout(selected,0);});
 document.addEventListener('keyup',event=>{if(event.key==='Shift')selected();});
}
