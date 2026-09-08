import type {CaptureSnapshot} from '@sensa/contracts/sensa';
// This bundle runs only after activeTab authorization. No whole-page text is read.
const key='__sensaCaptureInstalled';
const local=globalThis as typeof globalThis & {__sensaCaptureInstalled?:boolean};
if(!local[key]){
 local[key]=true;
 let accountId:string|null=null;let enabled=false,host:HTMLDivElement|null=null;
 let selectionTimer:ReturnType<typeof setTimeout>|null=null;
 const close=()=>{if(selectionTimer!==null){clearTimeout(selectionTimer);selectionTimer=null;}host?.remove();host=null;};
 const fromPanel=(event:Event)=>Boolean(host&&event.composedPath().includes(host));
 let outsideDismissSelection:Range|null=null;
 chrome.runtime.onMessage.addListener(message=>{if(message.kind==='reading'){if(accountId!==message.accountId)close();accountId=message.accountId??null;enabled=message.enabled===true&&Boolean(accountId);if(!enabled)close();}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 document.addEventListener('pointerdown',event=>{
  outsideDismissSelection=null;
  if(host&&!fromPanel(event)){
   const selection=getSelection();
   outsideDismissSelection=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
   close();
  }
 });
 function selected(){
 if(!enabled||!accountId||host?.matches(':hover'))return;const captureAccountId=accountId;
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
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent=snapshot.expression?'正在解释…':'请重新定位表达，或先保存待处理。';panel.append(status);
 const save=document.createElement('button'),dismiss=document.createElement('button');save.textContent='保存待处理';dismiss.textContent='关闭';dismiss.onclick=close;const operationId=crypto.randomUUID();
 save.onclick=async()=>{save.disabled=true;try{const response=await chrome.runtime.sendMessage({kind:'save',snapshot,operationId,accountId:captureAccountId});if(response.error)throw new Error(response.error);status.textContent='已保存在本机，联网后同步。可从 Sensa 图标查看结果。';save.hidden=true;}catch{status.textContent='尚未保存，请从 Sensa 图标检查登录并重试。';save.disabled=false;}};panel.append(save,dismiss);shadow.append(panel);document.documentElement.append(host);
 const lookupId=crypto.randomUUID(),acceptId=crypto.randomUUID();
 const check=document.createElement('button');check.textContent='检查解释结果';
 const explain=async()=>{check.disabled=true;try{const response=await chrome.runtime.sendMessage({kind:'lookup',snapshot,lookupId,accountId:captureAccountId});if(response.error)throw new Error(response.error);if(!enabled||accountId!==captureAccountId||!panel.isConnected)return;const result=response.value;
 if(result.status==='ready'&&result.proposal){status.textContent=result.proposal.explanation;check.remove();const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');summary.textContent='详细意思';body.textContent=result.proposal.semanticSpec.coreMeaningFocus+'\n'+result.proposal.semanticSpec.prototypeScenes.map((x:{summary:string})=>x.summary).join('\n');details.append(summary,body);panel.insertBefore(details,save);
 const accept=document.createElement('button');accept.textContent='加入 Sensa';accept.onclick=async()=>{accept.disabled=true;save.disabled=true;try{const answer=await chrome.runtime.sendMessage({kind:'accept',lookupId,operationId:acceptId,accountId:captureAccountId});if(answer.error)throw new Error(answer.error);status.textContent='确认已保存在本机，联网后同步。可从 Sensa 图标查看结果。';accept.hidden=true;save.hidden=true;}catch{status.textContent='确认尚未完成，请检查原操作结果或重试。';accept.disabled=false;save.disabled=false;}};panel.insertBefore(accept,save);
 }else{status.textContent=result.status==='running'?'仍在解释，可以稍后检查或保存待处理。':'暂时无法确定这个意思，可以保存待处理。';if(result.status==='running')panel.append(check);}
 }catch{status.textContent='暂时无法解释，可以检查结果或保存待处理。';panel.append(check);}finally{check.disabled=false;}};
 check.onclick=()=>void explain();if(snapshot.expression)void explain();
 }
 document.addEventListener('pointerup',event=>{
  // Check before click can remove the closed-shadow host. A deferred hover check
  // would otherwise capture the unchanged page selection and reopen the panel.
  if(fromPanel(event))return;
  const dismissed=outsideDismissSelection;outsideDismissSelection=null;
  const selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(dismissed&&range&&range.startContainer===dismissed.startContainer&&range.startOffset===dismissed.startOffset&&range.endContainer===dismissed.endContainer&&range.endOffset===dismissed.endOffset)return;
  if(selectionTimer!==null)clearTimeout(selectionTimer);
  selectionTimer=setTimeout(()=>{selectionTimer=null;selected();},0);
 });
 document.addEventListener('keyup',event=>{if(event.key==='Shift'&&!fromPanel(event))selected();});
}
