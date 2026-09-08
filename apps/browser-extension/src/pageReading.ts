import {runReading,readingError} from './readingClient';
const blocks='p,li,blockquote,td,th,dt,dd,h1,h2,h3,h4,h5,h6,figcaption,div';
const excluded='input,textarea,select,button,nav,pre,code,script,style,[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-sensa-ui]';
type Item={source:HTMLElement;text:string;translation:HTMLElement;hidden:boolean;state:'waiting'|'running'|'ready'|'failed'};
/** Original nodes stay owned by the host page; we only insert/remove our translations. */
export function createPageReading(accountId:string,isAuthorized:()=>boolean){
  const host=document.createElement('div');host.dataset.sensaUi='page';
  host.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483646';
  const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>:host{font:13px/1.5 system-ui;color:#242a38}section{max-width:320px;padding:10px;background:#fbfbfa;border:1px solid #bbc5da;border-radius:12px;box-shadow:0 4px 20px #0002}button{font:inherit;min-height:36px;background:white;color:#303f76;border:1px solid #bcc7df;border-radius:7px;padding:5px 9px;margin:3px;cursor:pointer}p{margin:6px;overflow-wrap:anywhere}button:focus-visible{outline:3px solid #5268a9}</style><section aria-label="Sensa 网页阅读"><strong>Sensa 阅读</strong><div><button data-action="translate">翻译页面</button><button data-action="mode">仅译文</button><button data-action="restore">恢复原文</button><button data-action="retry" hidden>重试失败段落</button></div><p role="status">Alt + T 翻译鼠标所在段落</p></section>`;
  document.documentElement.append(host);
  const marker=crypto.randomUUID(),hideStyle=document.createElement('style');hideStyle.dataset.sensaUi='translation-style';hideStyle.textContent=`[data-sensa-hidden="${marker}"]{display:none!important}`;document.documentElement.append(hideStyle);
  const status=root.querySelector('p')!;
  const retry=root.querySelector<HTMLButtonElement>('[data-action="retry"]')!;
  const items=new Map<HTMLElement,Item>();let active=false,disposed=false,only=false,generation=0,running=0;
  const cache=new Map<string,string>();
  const requests=new Map<string,Promise<string>>();
  let hovered:HTMLElement|null=null,scanTimer:ReturnType<typeof setTimeout>|null=null;
  const url=location.href;
  const valid=()=>!disposed&&isAuthorized()&&location.href===url;
  const visibility=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void drain();},{rootMargin:'200px'});
  function reveal(item:Item){if(item.source.dataset.sensaHidden===marker)delete item.source.dataset.sensaHidden;item.hidden=false;}
  function restoreItem(item:Item){reveal(item);item.translation.remove();visibility.unobserve(item.source);}
  function eligible(element:HTMLElement){return !element.closest(excluded)&&!element.querySelector(excluded)&&!element.querySelector(blocks)&&element.getClientRects().length>0;}
  function add(element:HTMLElement){
    if(items.has(element)||!eligible(element)||!nearby(element))return;
    const text=element.textContent??'';if(text.trim().length<2||text.length>12000||!/[a-z]{2}/iu.test(text))return;
    const translation=document.createElement('div');translation.dataset.sensaUi='translation';translation.style.cssText='white-space:pre-wrap;line-height:1.7;padding:8px 0;color:#405176;font-family:system-ui';
    translation.setAttribute('lang','zh-CN');
    const item:Item={source:element,text,translation,hidden:false,state:'waiting'};items.set(element,item);visibility.observe(element);
  }
  function nearby(source:HTMLElement){const rect=source.getBoundingClientRect();return rect.bottom>=-200&&rect.top<=innerHeight+200;}
  function scan(){
    if(!valid())return;
    for(const [source,item] of items){
      if(!source.isConnected||source.textContent!==item.text){restoreItem(item);items.delete(source);}
      else if(item.state==='waiting'&&!nearby(source)){visibility.unobserve(source);items.delete(source);}
    }
    if(active)document.querySelectorAll<HTMLElement>(blocks).forEach(add);
    drain();
  }
  function feedback(){
    if(!valid())return;
    const ready=[...items.values()].filter(i=>i.state==='ready').length,failed=[...items.values()].filter(i=>i.state==='failed');
    retry.hidden=failed.length===0;
    status.textContent=`已翻译 ${ready} 段${running?' · 正在翻译…':''}${failed.length?` · ${failed.length} 段失败，可重试`:active?'；滚动时继续。':''}`;
  }
  function setMode(item:Item){if(item.state!=='ready')return;if(only&&!item.hidden){item.source.dataset.sensaHidden=marker;item.hidden=true;}else if(!only&&item.hidden)reveal(item);}
  function drain(){
    if(!valid())return;
    // Keep the viewport responsive with two bounded requests, choosing again after each result.
    const waiting=[...items.values()].filter(i=>i.state==='waiting'&&i.source.isConnected&&nearby(i.source)).sort((a,b)=>Math.abs(a.source.getBoundingClientRect().top)-Math.abs(b.source.getBoundingClientRect().top));
    while(running<2&&waiting.length){const item=waiting.shift()!;item.state='running';running++;void translateItem(item,generation);}
  }
  async function translationFor(text:string){
    const cached=cache.get(text);if(cached!==undefined)return cached;
    const existing=requests.get(text);if(existing)return existing;
    const request=runReading(accountId,'page',text);requests.set(text,request);
    try{return await request;}finally{if(requests.get(text)===request)requests.delete(text);}
  }
  async function translateItem(item:Item,run:number){
    item.translation.textContent='正在翻译…';item.translation.setAttribute('aria-busy','true');item.source.after(item.translation);feedback();
    try{
      const translated=await translationFor(item.text);
      if(!valid()||run!==generation||items.get(item.source)!==item||!item.source.isConnected||item.source.textContent!==item.text){item.translation.remove();return;}
      cache.delete(item.text);cache.set(item.text,translated);if(cache.size>150)cache.delete(cache.keys().next().value!);
      item.translation.textContent=translated;item.state='ready';setMode(item);
    }catch(e){
      if(valid()&&run===generation&&items.get(item.source)===item&&item.source.isConnected&&item.source.textContent===item.text){item.state='failed';item.translation.textContent=readingError(e);}
    }finally{
      running--;item.translation.removeAttribute('aria-busy');
      if(valid()){if(items.size)feedback();drain();}
    }
  }
  function restore(){generation++;active=false;for(const item of items.values())restoreItem(item);items.clear();retry.hidden=true;status.textContent='已恢复原文。Alt + T 翻译鼠标所在段落。';}
  root.querySelector('[data-action="translate"]')!.addEventListener('click',()=>{active=true;scan();});
  root.querySelector('[data-action="mode"]')!.addEventListener('click',()=>{only=!only;root.querySelector('[data-action="mode"]')!.textContent=only?'双语显示':'仅译文';for(const item of items.values())setMode(item);});
  root.querySelector('[data-action="restore"]')!.addEventListener('click',restore);
  retry.addEventListener('click',()=>{for(const item of items.values())if(item.state==='failed'&&nearby(item.source))item.state='waiting';drain();});
  const mouse=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target:null;hovered=target?.closest<HTMLElement>(blocks)??null;};
  const key=(e:KeyboardEvent)=>{if(!e.altKey||e.code!=='KeyT'||e.repeat||(e.target instanceof Element&&e.target.closest(excluded)))return;if(hovered&&valid()){e.preventDefault();add(hovered);void drain();}};
  const scheduleScan=()=>{if(scanTimer||!valid())return;scanTimer=setTimeout(()=>{scanTimer=null;scan();},150);};
  const scroll=()=>{if(active)scheduleScan();else drain();};
  document.addEventListener('pointerover',mouse);document.addEventListener('keydown',key);document.addEventListener('scroll',scroll,true);
  const owned=(node:Node)=>node instanceof Element?Boolean(node.closest('[data-sensa-ui]')):Boolean(node.parentElement?.closest('[data-sensa-ui]'));
  const observer=new MutationObserver(records=>{
    if(!items.size&&!active)return;
    // Translation feedback is our own mutation, not new host content to rescan.
    if(records.some(record=>!owned(record.target)&&(record.type==='characterData'||[...record.addedNodes,...record.removedNodes].some(node=>!owned(node)))))scheduleScan();
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  return {host,destroy(){disposed=true;restore();cache.clear();observer.disconnect();visibility.disconnect();if(scanTimer)clearTimeout(scanTimer);document.removeEventListener('pointerover',mouse);document.removeEventListener('keydown',key);document.removeEventListener('scroll',scroll,true);host.remove();hideStyle.remove();}};
}
