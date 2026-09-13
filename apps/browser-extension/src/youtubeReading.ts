import {captureSnapshotSchema,sensaLanguageForDeclaredTag} from '@sensa/contracts/sensa';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {runReading,readingError} from './readingClient';
import {parseYoutubeCaptions,parseSubtitleFile} from './subtitleCues';
import {declaredCaptureLanguage,detectCaptureLanguage,unknownCaptureLanguage} from './language';
import type {CaptureLanguage} from './language';
import type {Cue} from './subtitleCues';
export function youtubeId(){if(!['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(location.hostname))return null;const u=new URL(location.href);const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/u)?.[1];return id&&/^[a-zA-Z0-9_-]{11}$/u.test(id)?id:null;}
export function createYoutubeReading(accountId:string,isAuthorized:()=>boolean,onSelection:(snapshot:CaptureSnapshot,range:Range)=>void,continuity?:{autoLoad:boolean;onLoaded:()=>void}){
  const id=youtubeId();if(!id)return null;
  const host=document.createElement('div');host.dataset.sensaUi='youtube';
  host.style.cssText='position:fixed;left:20px;bottom:20px;width:min(640px,calc(100vw - 40px));z-index:2147483646';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>:host{font:14px/1.6 system-ui;color:#242a38}section{background:#fbfbfa;border:1px solid #b9c4d9;border-radius:12px;padding:12px;box-shadow:0 5px 24px #0003;max-height:42vh;overflow:auto}button,select{font:inherit;border:1px solid #bac5da;background:white;color:#303f76;border-radius:7px;min-height:36px;padding:4px 8px;margin:3px;cursor:pointer}button:disabled{opacity:.6}button:focus-visible,select:focus-visible{outline:3px solid #5268a9}p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.caption{font-size:19px;line-height:1.65;user-select:text;cursor:text}.translation{color:#405176}.status{font-size:12px;color:#66758c}input{max-width:100%}header{display:flex;justify-content:space-between;align-items:center}section.collapsed> :not(header){display:none}</style><section aria-label="Sensa 视频阅读"><header><strong>YouTube · Sensa 阅读</strong><button data-action="collapse">收起</button></header><div><button data-action="load">加载字幕</button><button data-action="pause">暂停 / 固定字幕</button><button data-action="play">继续播放</button><button data-action="previous">上一句</button><button data-action="replay">重听本句</button><button data-action="next">下一句</button></div><p class="caption" aria-label="当前原字幕"></p><p class="translation" aria-label="当前字幕译文"></p><div><button data-action="translate">翻译本句</button><label>字幕显示 <select aria-label="字幕显示"><option value="original">原文</option><option value="bilingual">双语（自动翻译）</option><option value="translation">仅译文（自动翻译）</option></select></label></div><p class="status" role="status">加载字幕后，选择表达即可解释与保存；选择时暂停视频。</p><details><summary>使用自己的字幕文件</summary><p>没有可读取字幕时，可加载当前视频的 VTT / SRT 字幕文件。云端 AI 转录尚未接入。</p><input type="file" accept=".vtt,.srt" aria-label="加载字幕文件"></details></section>`;
  document.documentElement.append(host);
  const original=root.querySelector<HTMLElement>('.caption')!,translated=root.querySelector<HTMLElement>('.translation')!,status=root.querySelector<HTMLElement>('.status')!;
  const display=root.querySelector('select')!;
  let cues:Cue[]=[],current:Cue|null=null,pinned=false,disposed=false,loading=false,run=0;
  /** The language the loaded captions are actually in. A subtitle track states its
   * own code and a file the learner loads is detected from its own text, so the
   * captured sentence and the translation beside it never assume English. */
  let captionLanguage:CaptureLanguage=unknownCaptureLanguage;
  const translations=new Map<string,string>(),errors=new Map<string,string>();
  type TranslationJob={cue:Cue;generation:number;manual:boolean};
  let pending:TranslationJob|null=null,running:TranslationJob|null=null;
  const translateButton=root.querySelector<HTMLButtonElement>('[data-action="translate"]')!;
  const loadButton=root.querySelector<HTMLButtonElement>('[data-action="load"]')!;
  const video=()=>document.querySelector<HTMLVideoElement>('video.html5-main-video')??document.querySelector<HTMLVideoElement>('video');
  const valid=()=>!disposed&&isAuthorized()&&youtubeId()===id;
  const keyOf=(cue:Cue)=>`${cue.start}:${cue.end}:${cue.text}`;
  const matches=(job:TranslationJob|null,cue:Cue|null)=>Boolean(cue&&job?.generation===run&&job.cue===cue);
  function renderTranslation(){
    const key=current?keyOf(current):'',busy=matches(running,current)||matches(pending,current);
    translated.textContent=translations.get(key)??(busy?'正在翻译…':errors.get(key)??'');
    translated.setAttribute('aria-busy',String(busy));
    translateButton.disabled=!current||busy;
    translateButton.textContent=errors.has(key)?'重试翻译':'翻译本句';
    const index=current?cues.indexOf(current):-1;
    for(const action of ['previous','next','replay']){
      const button=root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
      button.disabled=!cues.length||(action==='previous'&&index===0)||(action==='next'&&index===cues.length-1);
    }
  }
  function show(cue:Cue|null){
    if(current===cue)return;current=cue;pending=null;original.textContent=cue?.text??'';
    if(cue&&display.value!=='original')queueTranslation(cue);else renderTranslation();
  }
  function queueTranslation(cue:Cue,manual=false){
    const key=keyOf(cue);
    if(translations.has(key)||matches(running,cue)||matches(pending,cue)){renderTranslation();return;}
    if(!manual&&errors.has(key)){renderTranslation();return;}
    errors.delete(key);pending={cue,generation:run,manual};renderTranslation();void drainTranslations();
  }
  async function drainTranslations(){
    if(running)return;
    while(pending&&valid()){
      const job:TranslationJob=pending;pending=null;
      if(job.generation!==run||job.cue!==current||(!job.manual&&display.value==='original'))continue;
      running=job;renderTranslation();const key=keyOf(job.cue);
      try{
        const text=await runReading(accountId,'subtitles',job.cue.text,'','',crypto.randomUUID(),partial=>{if(valid()&&job.generation===run&&current===job.cue)translated.textContent=partial;});
        if(valid()&&job.generation===run){
          translations.set(key,text);if(translations.size>150)translations.delete(translations.keys().next().value!);
        }
      }catch(e){if(valid()&&job.generation===run)errors.set(key,readingError(e));}
      finally{running=null;if(valid())renderTranslation();}
    }
  }
  function resetCues(){run++;pending=null;cues=[];pinned=false;translations.clear();errors.clear();show(null);renderTranslation();}
  function tick(){
    if(!valid())return;
    const fullscreen=document.fullscreenElement;if(fullscreen&&!fullscreen.contains(host))fullscreen.append(host);else if(!fullscreen&&host.parentElement!==document.documentElement)document.documentElement.append(host);
    const player=document.querySelector('.html5-video-player');const ad=player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting');
    if(ad){show(null);pending=null;pinned=false;status.textContent='广告播放中，暂停字幕采集。';return;}
    if(pinned)return;
    const time=video()?.currentTime??0;
    let low=0,high=cues.length;while(low<high){const middle=(low+high)>>>1;if(cues[middle].start<=time)low=middle+1;else high=middle;}
    const cue=cues[low-1];show(cue&&time<cue.end?cue:null);
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
    const snapshot=captureSnapshotSchema.safeParse({sentence:current.text,...captionLanguage,expression:{text,start,end:start+Array.from(text).length},source:{url:location.href,title:document.title.slice(0,1000),capturedAt:new Date().toISOString(),video:{platform:'youtube',videoId:id,startMs:Math.round(current.start*1000),endMs:Math.round(current.end*1000)}}});
    if(snapshot.success)onSelection(snapshot.data,range);
  });
  async function load(){
    if(loading||!valid())return;resetCues();loading=true;loadButton.disabled=true;
    status.textContent='正在读取当前视频的字幕…';const generation=run;
    try{
      const response=await chrome.runtime.sendMessage({kind:'youtube-captions',accountId,pageUrl:location.href,videoId:id});
      if(response.error)throw new Error(response.error);if(!valid()||generation!==run)return;
      const data=response.value;
      const track=typeof data?.language==='string'?data.language:'';
      const placed=track?sensaLanguageForDeclaredTag(track):undefined;
      captionLanguage=placed?{language:placed.tag,languageSource:'declared'}:declaredCaptureLanguage();
      cues=data?.json?parseYoutubeCaptions(data.json,captionLanguage.language??undefined):[];
      if(cues.length)continuity?.onLoaded();
      status.textContent=cues.length?`已加载 ${cues.length} 段字幕（${captionLanguage.language??'语言未定'}）。选择文字即可解释与保存。`:data?.error==='live_unsupported'?'当前直播字幕尚不支持。':'未找到可读取的字幕。可检查视频字幕设置，或加载自己的字幕文件。';
      tick();renderTranslation();
    }catch{if(valid()&&generation===run)status.textContent='字幕读取失败，请重试或加载自己的字幕文件。';}
    finally{if(valid()&&generation===run){loading=false;loadButton.disabled=false;}}
  }
  root.querySelector('[data-action="load"]')!.addEventListener('click',()=>void load());
  root.querySelector('[data-action="pause"]')!.addEventListener('click',pause);
  root.querySelector('[data-action="play"]')!.addEventListener('click',()=>{pinned=false;void video()?.play().catch(()=>{status.textContent='请使用视频播放器的播放按钮继续。';});tick();});
  for(const [action,delta] of [['previous',-1],['next',1],['replay',0]] as const)root.querySelector(`[data-action="${action}"]`)!.addEventListener('click',()=>{const index=current?cues.indexOf(current):-1;const cue=cues[Math.max(0,index+delta)];const element=video();if(!cue||!element)return;pause();element.currentTime=cue.start;show(cue);});
  translateButton.addEventListener('click',()=>{translated.hidden=false;if(current)queueTranslation(current,true);});
  root.querySelector('[data-action="collapse"]')!.addEventListener('click',event=>{const collapsed=root.querySelector('section')!.classList.toggle('collapsed');(event.target as HTMLElement).textContent=collapsed?'展开':'收起';});
  display.onchange=()=>{original.hidden=display.value==='translation';translated.hidden=display.value==='original';if(display.value==='original')pending=null;else if(current)queueTranslation(current);renderTranslation();};
  root.querySelector('input')!.addEventListener('change',async event=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    if(file.size>2000000){status.textContent='字幕文件超过 2 MB，请选择较小的文件。';return;}
    resetCues();loading=false;loadButton.disabled=false;const generation=run;
    try{const contents=await file.text();captionLanguage=await detectCaptureLanguage(contents);const parsed=parseSubtitleFile(contents,captionLanguage.language??undefined);if(!valid()||generation!==run)return;if(!parsed.length)throw new Error('invalid_subtitles');cues=parsed;status.textContent=`已加载 ${cues.length} 段字幕，请确认它们对应当前视频。`;tick();renderTranslation();}
    catch{if(valid()&&generation===run)status.textContent='无法读取字幕，请使用有效的 VTT / SRT 文件。';}
  });
  // Native player controls must resume following too, not just our own button.
  const resumed=(event:Event)=>{if(event.target===video()&&valid()){pinned=false;status.textContent='已恢复字幕跟随。';tick();}};
  document.addEventListener('play',resumed,true);
  const seeked=(event:Event)=>{if(event.target!==video()||!valid())return;pinned=false;tick();if(video()?.paused){pinned=true;status.textContent='已定位到新位置，播放后恢复字幕跟随。';}};
  document.addEventListener('seeked',seeked,true);
  renderTranslation();
  const timer=setInterval(tick,250);
  if(continuity?.autoLoad)void load();
  return {host,destroy(){disposed=true;run++;pending=null;clearInterval(timer);document.removeEventListener('play',resumed,true);document.removeEventListener('seeked',seeked,true);host.remove();}};
}
