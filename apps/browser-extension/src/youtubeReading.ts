import {captureSnapshotSchema,sensaCanonicalLanguageTag} from '@sensa/contracts/sensa';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {runReading,readingError} from './readingClient';
import {t,extensionLanguage} from './i18n';
import {interfaceLanguageName} from './interfaceLanguageName';
import {parseYoutubeCaptions,parseSubtitleFile} from './subtitleCues';
import {detectCaptureLanguage,readerLanguage,unknownCaptureLanguage} from './language';
import {speakText,speechFailureText} from './speech';
import {defaultPreferences} from './preferences';
import type {ReadingPreferences} from './preferences';
import type {CaptureLanguage,ReaderLanguage} from './language';
import type {Cue} from './subtitleCues';
export function youtubeId(){if(!['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(location.hostname))return null;const u=new URL(location.href);const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/u)?.[1];return id&&/^[a-zA-Z0-9_-]{11}$/u.test(id)?id:null;}
export function createYoutubeReading(accountId:string,isAuthorized:()=>boolean,onSelection:(snapshot:CaptureSnapshot,range:Range)=>void,continuity?:{autoLoad:boolean;onLoaded:()=>void},preferences?:ReadingPreferences){
  const id=youtubeId();if(!id)return null;
  const host=document.createElement('div');host.dataset.sensaUi='youtube';host.lang=extensionLanguage();
  host.style.cssText='position:fixed;left:20px;bottom:20px;width:min(640px,calc(100vw - 40px));z-index:2147483646';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>:host{font:14px/1.6 system-ui;color:#242a38}section{background:#fbfbfa;border:1px solid #b9c4d9;border-radius:12px;padding:12px;box-shadow:0 5px 24px #0003;max-height:42vh;overflow:auto}button,select{font:inherit;border:1px solid #bac5da;background:white;color:#303f76;border-radius:7px;min-height:36px;padding:4px 8px;margin:3px;cursor:pointer}button:disabled{opacity:.6}button:focus-visible,select:focus-visible{outline:3px solid #5268a9}p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.caption{font-size:19px;line-height:1.65;user-select:text;cursor:text}.translation{color:#405176}.status{font-size:12px;color:#66758c}input{max-width:100%}header{display:flex;justify-content:space-between;align-items:center}section.collapsed> :not(header){display:none}</style><section><header><strong></strong><button data-action="collapse"></button></header><div><button data-action="load"></button><button data-action="pause"></button><button data-action="play"></button><button data-action="previous"></button><button data-action="replay"></button><button data-action="speak"></button><button data-action="next"></button></div><p class="caption"></p><p class="translation"></p><div><button data-action="translate"></button><label><span data-label="display"></span> <select><option value="original"></option><option value="bilingual"></option><option value="translation"></option></select></label></div><p class="status" role="status"></p><details><summary></summary><p></p><input type="file" accept=".vtt,.srt"></details></section>`;
  const label=(selector:string,key:Parameters<typeof t>[0])=>{root.querySelector<HTMLElement>(selector)!.textContent=t(key);};
  root.querySelector('section')!.setAttribute('aria-label',t('videoLabel'));
  for(const [selector,key] of [['header strong','videoHeading'],['[data-action="collapse"]','panelCollapse'],['[data-action="load"]','videoLoad'],['[data-action="pause"]','videoPause'],['[data-action="play"]','videoPlay'],['[data-action="previous"]','videoPrevious'],['[data-action="replay"]','videoReplay'],['[data-action="speak"]','videoSpeak'],['[data-action="next"]','videoNext'],['[data-action="translate"]','videoTranslate'],['[data-label="display"]','videoDisplay'],['option[value="original"]','videoOriginal'],['option[value="bilingual"]','videoBilingual'],['option[value="translation"]','videoTranslation'],['.status','videoHint'],['details summary','videoOwnFile'],['details p','videoFileHint']] as const)label(selector,key);
  root.querySelector('.caption')!.setAttribute('aria-label',t('videoOriginalLabel'));
  root.querySelector('.translation')!.setAttribute('aria-label',t('videoTranslationLabel'));
  root.querySelector('select')!.setAttribute('aria-label',t('videoDisplay'));
  root.querySelector('input')!.setAttribute('aria-label',t('videoLoadFile'));
  document.documentElement.append(host);
  const original=root.querySelector<HTMLElement>('.caption')!,translated=root.querySelector<HTMLElement>('.translation')!,status=root.querySelector<HTMLElement>('.status')!;
  const display=root.querySelector('select')!;
  let cues:Cue[]=[],current:Cue|null=null,pinned=false,disposed=false,loading=false,run=0;
  /** The language the loaded captions are actually in. A subtitle track states its
   * own code and a file the learner loads is detected from its own text, so the
   * captured sentence and the translation beside it never assume English. */
  let captionLanguage:CaptureLanguage=unknownCaptureLanguage;
  /** Whether these captions are already in the learner's own language, asked
   * once per track: a caption track is one language for the whole of it, so one
   * answer covers every cue, unlike a page whose paragraphs can differ. */
  let trackReadable=false;
  const translations=new Map<string,string>(),errors=new Map<string,string>();
  type TranslationJob={cue:Cue;generation:number;manual:boolean;controller:AbortController};
  let pending:TranslationJob|null=null,running:TranslationJob|null=null;
  /** How to stop the current reading, or nothing when this panel is silent. */
  let speaking:(()=>void)|null=null;
  let speechGeneration=0;
  /** This panel writes its own labels in one language, as its neighbours do. */
  const speakLabel=t('videoSpeak');
  const translateButton=root.querySelector<HTMLButtonElement>('[data-action="translate"]')!;
  const loadButton=root.querySelector<HTMLButtonElement>('[data-action="load"]')!;
  const video=()=>document.querySelector<HTMLVideoElement>('video.html5-main-video')??document.querySelector<HTMLVideoElement>('video');
  const valid=()=>!disposed&&isAuthorized()&&youtubeId()===id;
  const keyOf=(cue:Cue)=>`${cue.start}:${cue.end}:${cue.text}`;
  /**
   * What the cue is sitting in: the video's title and the cues on either side.
   *
   * A subtitle cue is a fragment of something being said, and a translator shown
   * one fragment alone is guessing at what it continues. The neighbours are the
   * cheapest evidence that it is not guessing, and they are not to be translated
   * themselves.
   */
  function contextFor(cue:Cue){
    const index=cues.indexOf(cue);
    return [document.title.trim().slice(0,200),cues[index-1]?.text??'',cues[index+1]?.text??''].map(part=>part.trim()).filter(Boolean).join('\n').slice(0,1200);
  }
  const matches=(job:TranslationJob|null,cue:Cue|null)=>Boolean(cue&&job?.generation===run&&job.cue===cue);
  function renderTranslation(){
    const key=current?keyOf(current):'',busy=matches(running,current)||matches(pending,current);
    translated.textContent=translations.get(key)??(busy?t('pageTranslating'):errors.get(key)??'');
    translated.setAttribute('aria-busy',String(busy));
    translateButton.disabled=!current||busy;
    translateButton.textContent=t(errors.has(key)?'videoRetry':'videoTranslate');
    const index=current?cues.indexOf(current):-1;
    for(const action of ['previous','next','replay']){
      const button=root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
      button.disabled=!cues.length||(action==='previous'&&index===0)||(action==='next'&&index===cues.length-1);
    }
  }
  function show(cue:Cue|null){
    if(current===cue)return;cancelTranslations();stopSpeaking();current=cue;original.textContent=cue?.text??'';
    if(cue&&display.value!=='original')queueTranslation(cue);else renderTranslation();
  }
  function queueTranslation(cue:Cue,manual=false){
    const key=keyOf(cue);
    if(translations.has(key)||matches(running,cue)||matches(pending,cue)){renderTranslation();return;}
    if(!manual&&errors.has(key)){renderTranslation();return;}
    // Automatic translation is what a track in the learner's own language does
    // not need; asking for it by name still gets it.
    if(!manual&&trackReadable){renderTranslation();return;}
    errors.delete(key);pending={cue,generation:run,manual,controller:new AbortController()};renderTranslation();void drainTranslations();
  }
  function cancelTranslations(){pending?.controller.abort();pending=null;const old=running;running=null;old?.controller.abort();}
  async function drainTranslations(){
    if(running)return;
    while(pending&&valid()&&!running){
      const job:TranslationJob=pending;pending=null;
      if(job.generation!==run||job.cue!==current||(!job.manual&&display.value==='original'))continue;
      running=job;renderTranslation();const key=keyOf(job.cue);
      try{
        const text=await runReading(accountId,'subtitles',job.cue.text,contextFor(job.cue),'',crypto.randomUUID(),partial=>{if(valid()&&!job.controller.signal.aborted&&job.generation===run&&current===job.cue)translated.textContent=partial;},job.controller.signal,captionLanguage.language);
        if(valid()&&!job.controller.signal.aborted&&job.generation===run&&current===job.cue){
          translations.set(key,text);if(translations.size>150)translations.delete(translations.keys().next().value!);
        }
      }catch(e){if(valid()&&!job.controller.signal.aborted&&job.generation===run&&current===job.cue)errors.set(key,readingError(e));}
      finally{if(running===job)running=null;if(valid())renderTranslation();}
    }
  }
  function resetCues(){run++;cancelTranslations();cues=[];captionLanguage=unknownCaptureLanguage;pinned=false;trackReadable=false;stopSpeaking();translations.clear();errors.clear();original.removeAttribute('lang');translated.removeAttribute('lang');show(null);renderTranslation();}
  function stopSpeaking(){speechGeneration++;speaking?.();speaking=null;root.querySelector('[data-action="speak"]')!.textContent=speakLabel;}
  /**
   * Read the cue aloud in the track's own language.
   *
   * The video's own audio is the better pronunciation when it can be heard; this
   * is for when it cannot — muted, unclear, or worth hearing more slowly — and it
   * is the browser's own voice, so nothing is sent anywhere. A track whose
   * language this release cannot place is not read aloud in some other language.
   */
  async function speakCue(){
    if(!valid()||!current)return;
    if(speaking){stopSpeaking();return;}
    const cue=current,generation=++speechGeneration;let ended=false;
    const attempt=await speakText(cue.text,captionLanguage.language,{rate:preferences?.speechRate??defaultPreferences.speechRate,voice:preferences?.speechVoice,onEnd:()=>{ended=true;if(!disposed&&generation===speechGeneration)stopSpeaking();}});
    if(!valid()||current!==cue||generation!==speechGeneration||ended){if(attempt.ok)attempt.stop();return;}
    if(!attempt.ok){status.textContent=speechFailureText(attempt);return;}
    speaking=attempt.stop;root.querySelector('[data-action="speak"]')!.textContent=t('pageStopSpeaking');
  }
  /**
   * Labels the two lines this panel writes, and asks whether the learner needs
   * the second one at all.
   *
   * The caption line is labelled with the language the track or the file
   * actually is, and the translation line with the learner's own language, which
   * only the background knows. Neither is left to inherit the surrounding page's
   * language, which is what the video site happens to be written in.
   */
  async function placeLanguages(generation:number){
    if(captionLanguage.language)original.setAttribute('lang',captionLanguage.language);
    const reader:ReaderLanguage|null=await readerLanguage('',captionLanguage.language);
    if(!valid()||generation!==run)return;
    trackReadable=reader?.alreadyReadable===true;
    if(reader)translated.setAttribute('lang',reader.supportLanguageTag);
  }
  function tick(){
    if(!valid())return;
    const fullscreen=document.fullscreenElement;if(fullscreen&&!fullscreen.contains(host))fullscreen.append(host);else if(!fullscreen&&host.parentElement!==document.documentElement)document.documentElement.append(host);
    const player=document.querySelector('.html5-video-player');const ad=player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting');
    if(ad){show(null);pending=null;pinned=false;status.textContent=t('videoAd');return;}
    if(pinned)return;
    const time=video()?.currentTime??0;
    let low=0,high=cues.length;while(low<high){const middle=(low+high)>>>1;if(cues[middle].start<=time)low=middle+1;else high=middle;}
    const cue=cues[low-1];show(cue&&time<cue.end?cue:null);
  }
  function pause(){video()?.pause();pinned=true;status.textContent=t('videoPinned');}
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
    status.textContent=t('videoLoading');const generation=run;
    try{
      const response=await chrome.runtime.sendMessage({kind:'youtube-captions',accountId,pageUrl:location.href,videoId:id});
      if(response.error)throw new Error(response.error);if(!valid()||generation!==run)return;
      const data=response.value;
      if(data?.error){status.textContent=t(data.error==='live_unsupported'?'videoLiveUnsupported':data.error==='captions_too_large'?'videoCaptionLimit':data.error==='no_captions'?'videoNoCaptions':'videoLoadFailed');return;}
      const track=typeof data?.language==='string'?data.language:'';
      const declared=track?sensaCanonicalLanguageTag(track):null;
      const candidate:CaptureLanguage=declared?{language:declared,languageSource:'declared',languageConfidence:1}:unknownCaptureLanguage;
      const parsed=data?.json?parseYoutubeCaptions(data.json,candidate.language??undefined):[];
      captionLanguage=candidate;cues=parsed;
      await placeLanguages(generation);
      if(!valid()||generation!==run)return;
      if(cues.length)continuity?.onLoaded();
      status.textContent=cues.length?t(trackReadable?'videoLoadedReadable':'videoLoaded',{count:cues.length,language:captionLanguage.language?interfaceLanguageName(captionLanguage.language):t('videoUnknownLanguage')}):t(data?.error==='live_unsupported'?'videoLiveUnsupported':'videoNoCaptions');
      tick();renderTranslation();
    }catch(error){if(valid()&&generation===run)status.textContent=t(error instanceof Error&&error.message==='captions_too_large'?'videoCaptionLimit':'videoLoadFailed');}
    finally{if(valid()&&generation===run){loading=false;loadButton.disabled=false;}}
  }
  root.querySelector('[data-action="load"]')!.addEventListener('click',()=>void load());
  root.querySelector('[data-action="pause"]')!.addEventListener('click',pause);
  root.querySelector('[data-action="speak"]')!.addEventListener('click',()=>void speakCue());
  root.querySelector('[data-action="play"]')!.addEventListener('click',()=>{pinned=false;void video()?.play().catch(()=>{status.textContent=t('videoPlayerPlay');});tick();});
  for(const [action,delta] of [['previous',-1],['next',1],['replay',0]] as const)root.querySelector(`[data-action="${action}"]`)!.addEventListener('click',()=>{const index=current?cues.indexOf(current):-1;const cue=cues[Math.max(0,index+delta)];const element=video();if(!cue||!element)return;pause();element.currentTime=cue.start;show(cue);});
  translateButton.addEventListener('click',()=>{translated.hidden=false;if(current)queueTranslation(current,true);});
  root.querySelector('[data-action="collapse"]')!.addEventListener('click',event=>{const collapsed=root.querySelector('section')!.classList.toggle('collapsed');(event.target as HTMLElement).textContent=t(collapsed?'videoExpand':'panelCollapse');});
  display.onchange=()=>{original.hidden=display.value==='translation';translated.hidden=display.value==='original';if(display.value==='original')cancelTranslations();else if(current)queueTranslation(current);renderTranslation();};
  root.querySelector('input')!.addEventListener('change',async event=>{
    const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    if(file.size>2000000){status.textContent=t('videoFileTooLarge');return;}
    resetCues();loading=false;loadButton.disabled=false;const generation=run;
    try{const contents=await file.text();if(!valid()||generation!==run)return;const candidate=await detectCaptureLanguage(contents,{documentElement:null});if(!valid()||generation!==run)return;const parsed=parseSubtitleFile(contents,candidate.language??undefined);if(!parsed.length)throw new Error('invalid_subtitles');captionLanguage=candidate;cues=parsed;await placeLanguages(generation);if(!valid()||generation!==run)return;status.textContent=t('videoFileLoaded',{count:cues.length,suffix:trackReadable?t('videoReadableSuffix'):''});tick();renderTranslation();}
    catch(error){if(valid()&&generation===run)status.textContent=t(error instanceof Error&&error.message==='captions_too_large'?'videoCaptionLimit':'videoInvalidFile');}
  });
  // Native player controls must resume following too, not just our own button.
  const resumed=(event:Event)=>{if(event.target===video()&&valid()){pinned=false;status.textContent=t('videoFollowing');tick();}};
  document.addEventListener('play',resumed,true);
  const seeked=(event:Event)=>{if(event.target!==video()||!valid())return;pinned=false;tick();if(video()?.paused){pinned=true;status.textContent=t('videoSeeked');}};
  document.addEventListener('seeked',seeked,true);
  renderTranslation();
  const timer=setInterval(tick,250);
  if(continuity?.autoLoad)void load();
  return {host,destroy(){disposed=true;run++;cancelTranslations();stopSpeaking();clearInterval(timer);document.removeEventListener('play',resumed,true);document.removeEventListener('seeked',seeked,true);host.remove();}};
}
