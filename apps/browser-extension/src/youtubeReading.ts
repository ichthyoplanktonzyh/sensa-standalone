import {captureSnapshotSchema} from '@sensa/contracts/sensa';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {runReading,readingError} from './readingClient';
type Cue={text:string;start:number;end:number};
export function youtubeId(){if(!['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(location.hostname))return null;const u=new URL(location.href);const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/u)?.[1];return id&&/^[a-zA-Z0-9_-]{11}$/u.test(id)?id:null;}
function safeCues(cues:Cue[]){
  const ordered=cues.filter(c=>c.text.trim()&&c.text.length<=12000&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>=c.start&&c.end<=86400).sort((a,b)=>a.start-b.start).slice(0,10000);
  const sentences:Cue[]=[];
  // Caption display rows are often fragments of one sentence. Preserve source
  // words across adjacent rows, while bounding long unpunctuated speech/gaps.
  for(const cue of ordered){
    const previous=sentences.at(-1);
    if(previous&&!/[.!?]["'’”\])]*$/u.test(previous.text.trim())&&cue.start-previous.end<=2&&cue.end-previous.start<=25&&previous.text.length+cue.text.length<1200){
      previous.text+=' '+cue.text.trim();previous.end=Math.max(previous.end,cue.end);
    }else sentences.push({...cue,text:cue.text.trim()});
  }
  return sentences;
}
function parseJson(text:string):Cue[]{
  const data=JSON.parse(text);if(!Array.isArray(data.events))throw new Error('invalid_subtitles');
  return safeCues(data.events.filter((e:any)=>Array.isArray(e.segs)).map((e:any)=>({text:e.segs.map((s:any)=>typeof s.utf8==='string'?s.utf8:'').join('').trim(),start:e.tStartMs/1000,end:(e.tStartMs+e.dDurationMs)/1000})));
}
function parseFile(text:string):Cue[]{
  const seconds=(stamp:string)=>{const values=stamp.replace(',','.').split(':').map(Number);return values.reduce((total,n)=>total*60+n,0);};
  const cues:Cue[]=[];
  for(const block of text.replace(/\r/gu,'').split(/\n\s*\n/u)){
    const lines=block.split('\n');const index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
    const match=lines[index].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/u);if(!match)continue;
    const plain=new DOMParser().parseFromString(lines.slice(index+1).join('\n'),'text/html').body.textContent??'';
    cues.push({text:plain.trim(),start:seconds(match[1]),end:seconds(match[2])});
  }
  return safeCues(cues);
}
export function createYoutubeReading(accountId:string,isAuthorized:()=>boolean,onSelection:(snapshot:CaptureSnapshot,range:Range)=>void){
  const id=youtubeId();if(!id)return null;
  const host=document.createElement('div');host.dataset.sensaUi='youtube';
  host.style.cssText='position:fixed;left:20px;bottom:20px;width:min(640px,calc(100vw - 40px));z-index:2147483646';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>:host{font:14px/1.6 system-ui;color:#242a38}section{background:#fbfbfa;border:1px solid #b9c4d9;border-radius:12px;padding:12px;box-shadow:0 5px 24px #0003;max-height:42vh;overflow:auto}button,select{font:inherit;border:1px solid #bac5da;background:white;color:#303f76;border-radius:7px;min-height:36px;padding:4px 8px;margin:3px;cursor:pointer}button:disabled{opacity:.6}button:focus-visible,select:focus-visible{outline:3px solid #5268a9}p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.caption{font-size:19px;line-height:1.65;user-select:text;cursor:text}.translation{color:#405176}.status{font-size:12px;color:#66758c}input{max-width:100%}header{display:flex;justify-content:space-between;align-items:center}section.collapsed> :not(header){display:none}</style><section aria-label="Sensa 视频阅读"><header><strong>YouTube · Sensa 阅读</strong><button data-action="collapse">收起</button></header><div><button data-action="load">加载英文字幕</button><button data-action="pause">暂停 / 固定字幕</button><button data-action="play">继续播放</button><button data-action="previous">上一句</button><button data-action="replay">重听本句</button><button data-action="next">下一句</button></div><p class="caption" aria-label="当前原字幕"></p><p class="translation" aria-label="当前字幕译文"></p><div><button data-action="translate">翻译本句</button><label>字幕显示 <select aria-label="字幕显示"><option value="original">原文</option><option value="bilingual">双语（自动翻译）</option><option value="translation">仅译文（自动翻译）</option></select></label></div><p class="status" role="status">加载英文字幕后，选择表达即可解释与保存；选择时暂停视频。</p><details><summary>使用自己的英文字幕</summary><p>没有可读取字幕时，可加载当前视频的英文 VTT / SRT 文件。云端 AI 转录尚未接入。</p><input type="file" accept=".vtt,.srt" aria-label="加载英文字幕文件"></details></section>`;
  document.documentElement.append(host);
  const original=root.querySelector<HTMLElement>('.caption')!,translated=root.querySelector<HTMLElement>('.translation')!,status=root.querySelector<HTMLElement>('.status')!;
  const display=root.querySelector('select')!;
  let cues:Cue[]=[],current:Cue|null=null,pinned=false,disposed=false,loading=false,run=0;
  const translations=new Map<string,string>();const inFlight=new Set<string>();let autoPending:Cue|null=null,autoRunning=false;
  const video=()=>document.querySelector<HTMLVideoElement>('video.html5-main-video')??document.querySelector<HTMLVideoElement>('video');
  const valid=()=>!disposed&&isAuthorized()&&youtubeId()===id;
  function show(cue:Cue|null){if(current===cue)return;current=cue;original.textContent=cue?.text??'';translated.textContent=cue?translations.get(`${cue.start}:${cue.text}`)??'':'';if(cue&&display.value!=='original')queueTranslation(cue);}
  async function translate(cue:Cue){
    const key=`${cue.start}:${cue.text}`;if(translations.has(key)||inFlight.has(key))return;
    const generation=run;inFlight.add(key);status.textContent='正在翻译字幕…';
    try{const text=await runReading(accountId,'subtitles',cue.text);if(!valid()||generation!==run)return;translations.set(key,text);if(current===cue)translated.textContent=text;status.textContent='选择原字幕中的表达即可解释与保存。';}
    catch(e){if(valid()&&generation===run)status.textContent=readingError(e);}
    finally{inFlight.delete(key);}
  }
  function queueTranslation(cue:Cue){autoPending=cue;if(autoRunning)return;autoRunning=true;void(async()=>{try{while(autoPending&&valid()){const next=autoPending;autoPending=null;await translate(next);}}finally{autoRunning=false;}})();}
  function tick(){
    if(!valid())return;
    const fullscreen=document.fullscreenElement;if(fullscreen&&!fullscreen.contains(host))fullscreen.append(host);else if(!fullscreen&&host.parentElement!==document.documentElement)document.documentElement.append(host);
    const player=document.querySelector('.html5-video-player');const ad=player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting');
    if(ad){show(null);pinned=false;status.textContent='广告播放中，暂停字幕采集。';return;}
    if(pinned)return;
    const time=video()?.currentTime??0;
    const cue=cues.find(c=>time>=c.start&&time<c.end)??null;show(cue);
  }
  function pause(){video()?.pause();pinned=true;status.textContent='已固定字幕，继续播放后恢复跟随。';}
  original.addEventListener('pointerdown',event=>{if(event.button===0)pause();});
  original.addEventListener('pointerup',event=>{
    event.stopPropagation();if(!valid()||!current||!original.textContent)return;
    const selection=(root as ShadowRoot & {getSelection?:()=>Selection|null}).getSelection?.()??getSelection();
    if(!selection?.rangeCount||selection.isCollapsed)return;const range=selection.getRangeAt(0).cloneRange();
    if(!original.contains(range.startContainer)||!original.contains(range.endContainer))return;
    const prefix=document.createRange();prefix.selectNodeContents(original);prefix.setEnd(range.startContainer,range.startOffset);
    const text=range.toString(),start=Array.from(prefix.toString()).length;
    const snapshot=captureSnapshotSchema.safeParse({sentence:current.text,language:'en',expression:{text,start,end:start+Array.from(text).length},source:{url:location.href,title:document.title.slice(0,1000),capturedAt:new Date().toISOString(),video:{platform:'youtube',videoId:id,startMs:Math.round(current.start*1000),endMs:Math.round(current.end*1000)}}});
    if(snapshot.success)onSelection(snapshot.data,range);
  });
  async function load(){if(loading||!valid())return;loading=true;cues=[];pinned=false;show(null);translations.clear();status.textContent='正在读取当前视频的英文字幕…';const generation=++run;
    try{const response=await chrome.runtime.sendMessage({kind:'youtube-captions',accountId,pageUrl:location.href,videoId:id});if(response.error)throw new Error(response.error);if(!valid()||generation!==run)return;const data=response.value;
      cues=data?.json?parseJson(data.json):[];
      status.textContent=cues.length?`已加载 ${cues.length} 段英文字幕。选择文字即可解释与保存。`:data?.error==='live_unsupported'?'当前直播字幕尚不支持。':'未找到可读取的英文字幕。可检查视频字幕设置，或加载自己的字幕文件。';
      pinned=false;show(null);translations.clear();tick();
    }catch{if(valid())status.textContent='字幕读取失败，请重试或加载自己的字幕文件。';}finally{loading=false;}}
  root.querySelector('[data-action="load"]')!.addEventListener('click',()=>void load());
  root.querySelector('[data-action="pause"]')!.addEventListener('click',pause);
  root.querySelector('[data-action="play"]')!.addEventListener('click',()=>{pinned=false;void video()?.play().catch(()=>{status.textContent='请使用视频播放器的播放按钮继续。';});tick();});
  for(const [action,delta] of [['previous',-1],['next',1],['replay',0]] as const)root.querySelector(`[data-action="${action}"]`)!.addEventListener('click',()=>{const index=current?cues.indexOf(current):-1;const cue=cues[Math.max(0,index+delta)];const element=video();if(!cue||!element)return;pause();element.currentTime=cue.start;show(cue);});
  root.querySelector('[data-action="translate"]')!.addEventListener('click',()=>{translated.hidden=false;if(current)void translate(current);});
  root.querySelector('[data-action="collapse"]')!.addEventListener('click',event=>{const collapsed=root.querySelector('section')!.classList.toggle('collapsed');(event.target as HTMLElement).textContent=collapsed?'展开':'收起';});
  display.onchange=()=>{original.hidden=display.value==='translation';translated.hidden=display.value==='original';if(current&&display.value!=='original')queueTranslation(current);};
  root.querySelector('input')!.addEventListener('change',async event=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>2000000){status.textContent='字幕文件超过 2 MB，请选择较小的文件。';return;}const generation=++run;try{const parsed=parseFile(await file.text());if(!valid()||generation!==run)return;if(!parsed.length)throw new Error('invalid_subtitles');cues=parsed;show(null);pinned=false;translations.clear();status.textContent=`已加载 ${cues.length} 段字幕，请确认它们对应当前视频。`;tick();}catch{status.textContent='无法读取字幕，请使用有效的英文 VTT / SRT 文件。';}});
  const timer=setInterval(tick,250);
  return {host,destroy(){disposed=true;run++;autoPending=null;clearInterval(timer);host.remove();}};
}
