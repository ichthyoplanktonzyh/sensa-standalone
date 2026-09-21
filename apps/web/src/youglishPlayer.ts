const channel='sensa.youglish.v1' as const;
const providerScript='https://youglish.com/public/emb/widget.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function configuredParentOrigin(){
 try{
  const value=new URL(import.meta.env.VITE_SENSA_WEB_ORIGIN);
  const loopback=['127.0.0.1','localhost'].includes(value.hostname);
  if((value.protocol!=='https:'&&!(loopback&&value.protocol==='http:'))||value.pathname!=='/'||value.username||value.password||value.search||value.hash)throw Error();
  return value.origin;
 }catch{throw Error('youglish_parent_origin_invalid');}
}

type Active={requestId:string;query:string;lang:string;accent?:string;components:number};
type Widget={fetch:(query:string,lang:string,accent?:string)=>void;play:()=>void;pause:()=>void;replay:()=>void;next:()=>void;previous:()=>void;move:(value:number)=>void;setSpeed:(value:number)=>void};
type WidgetConstructor=new(id:string,options:Record<string,unknown>)=>Widget;
const host=window as typeof window&{YG?:{Widget?:WidgetConstructor};onYouglishAPIReady?:()=>void};
const parentOrigin=configuredParentOrigin();let active:Active|null=null,widget:Widget|null=null,apiReady=false;
const own=(value:unknown,required:string[],optional:string[]=[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const emit=(message:Record<string,unknown>)=>parent.postMessage({channel,...message},parentOrigin);
const fail=(code:'provider_unavailable'|'invalid_command',requestId?:string)=>emit({type:'error',code,...(requestId?{requestId}:{})});
const validConfigure=(value:unknown)=>own(value,['channel','type','requestId','query','lang','components'],['accent'])&&value.channel===channel&&value.type==='configure'&&typeof value.requestId==='string'&&uuid.test(value.requestId)&&typeof value.query==='string'&&value.query.trim().length>0&&value.query.length<=200&&typeof value.lang==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(value.lang)&&Number.isInteger(value.components)&&Number(value.components)>=0&&Number(value.components)<=255&&(value.accent===undefined||typeof value.accent==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(value.accent));
const validCommand=(value:unknown)=>{
 if(!own(value,['channel','type','requestId','command'],['value'])||value.channel!==channel||value.type!=='command'||typeof value.requestId!=='string'||!uuid.test(value.requestId)||typeof value.command!=='string'||!['play','pause','replay','next','previous','move','setSpeed'].includes(value.command))return false;
 const needsValue=['move','setSpeed'].includes(value.command);if(needsValue!==Object.hasOwn(value,'value')||needsValue&&typeof value.value!=='number')return false;
 return value.command==='move'?Number.isFinite(value.value)&&Math.abs(value.value as number)<=30:value.command==='setSpeed'&&(value.value as number)>=0.5&&(value.value as number)<=2||!needsValue;
};
const current=()=>active?.requestId;
const build=()=>{
 if(widget||!apiReady||!active||!host.YG?.Widget)return;
 try{
  widget=new host.YG.Widget('widget',{width:Math.max(320,Math.round(innerWidth)),components:active.components===0?'0':active.components,events:{
   onFetchDone:(event:unknown)=>{const value=own(event,['totalResult'])&&Number.isInteger(event.totalResult)&&Number(event.totalResult)>=0?Math.min(Number(event.totalResult),100000):0;emit({type:'fetched',requestId:current(),totalResults:value});},
   onCaptionChange:(event:unknown)=>{let caption=own(event,['caption'])&&typeof event.caption==='string'?event.caption.slice(0,4000):null;if(caption)try{caption=decodeURIComponent(caption);}catch{}emit({type:'caption',requestId:current(),caption});},
   onPlayerStateChange:(event:unknown)=>emit({type:'playing',requestId:current(),playing:own(event,['state'])&&event.state===1}),
   onError:()=>fail('provider_unavailable',current()),
  }});
  widget.fetch(active.query,active.lang,active.accent);
 }catch{fail('provider_unavailable',current());}
};
const configure=(value:Record<string,unknown>)=>{
 active={requestId:value.requestId as string,query:(value.query as string).trim(),lang:value.lang as string,...(typeof value.accent==='string'?{accent:value.accent}:{}),components:Number(value.components)};
 emit({type:'playing',requestId:current(),playing:false});
 if(widget)try{widget.fetch(active.query,active.lang,active.accent);}catch{fail('provider_unavailable',current());}else build();
};
const command=(value:Record<string,unknown>)=>{
 if(!active||value.requestId!==active.requestId||!widget||typeof value.command!=='string')return;
 try{
  if(value.command==='move')widget.move(value.value as number);else if(value.command==='setSpeed')widget.setSpeed(value.value as number);
  else if(value.command==='play')widget.play();else if(value.command==='pause')widget.pause();else if(value.command==='replay')widget.replay();else if(value.command==='next')widget.next();else if(value.command==='previous')widget.previous();
 }catch{fail('provider_unavailable',current());}
};
addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==parentOrigin)return;
 if(validConfigure(event.data))configure(event.data);else if(validCommand(event.data))command(event.data);else fail('invalid_command');
});
host.onYouglishAPIReady=()=>{apiReady=!!host.YG?.Widget;if(apiReady)build();else fail('provider_unavailable',current());};
parent.postMessage({channel,type:'ready'},parentOrigin);
const timer=setTimeout(()=>{if(!apiReady)fail('provider_unavailable',current());},8000);
const script=document.createElement('script');script.src=providerScript;script.async=true;script.referrerPolicy='no-referrer';script.onload=()=>clearTimeout(timer);script.onerror=()=>{clearTimeout(timer);fail('provider_unavailable',current());};document.head.appendChild(script);
