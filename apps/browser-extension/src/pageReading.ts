import {runReading,readingError} from './readingClient';
import {declaredCaptureLanguage,detectBlockLanguage,minSkimmableCharacters,readerLanguage} from './language';
import {speakText,speechFailureText} from './speech';
import {t,extensionLanguage} from './i18n';
import {defaultPreferences,type ReadingPreferences} from './preferences';
const blocks='p,li,blockquote,td,th,dt,dd,h1,h2,h3,h4,h5,h6,figcaption,div';
const excluded='input,textarea,select,button,nav,pre,code,script,style,[contenteditable]:not([contenteditable="false"]),[translate="no"],[data-sensa-ui]';
type Item={source:HTMLElement;text:string;context:string;sourceLanguage:string|null;translation:HTMLElement;hidden:boolean;state:'waiting'|'running'|'ready'|'failed'|'skipped';forced:boolean};
/**
 * The nearest text before `element` that matches `selector`.
 *
 * Looks past this panel's own inserted translations, or the paragraph above
 * would hand its translation over as the context for the next one, and looks up
 * through ancestors, so a paragraph nested in a section still sees the heading
 * above the section.
 */
function preceding(element:Element,selector:string):string{
  for(let node:Element|null=element;node;node=node.parentElement){
    for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling){
      if(!sibling.matches('[data-sensa-ui]')&&sibling.matches(selector))return sibling.textContent??'';
    }
  }
  return '';
}
/**
 * What a piece of text is sitting in: the page's title, the heading that governs
 * it, and the text just before it.
 *
 * A translator shown one paragraph — or one sentence a learner is writing — has to
 * guess what a pronoun points at and which sense of a word is meant, and these
 * three are the cheapest evidence that it is not guessing. One rule for both
 * surfaces, because it is one question: a form field's surroundings are the
 * document around it, exactly as a paragraph's are. Bounded because they are paid
 * for by the learner's own connection, and the text nearest the element is the
 * part that matters.
 */
export function surroundingText(element:HTMLElement){
 return [document.title.trim().slice(0,200),preceding(element,'h1,h2,h3,h4,h5,h6').trim().slice(0,200),preceding(element,'p,li,blockquote,td,figcaption,label').trim().slice(-500)].filter(Boolean).join('\n').slice(0,1200);
}

/** Original nodes stay owned by the host page; we only insert/remove our translations. */
/** The reading preferences belong to the tab, not to this surface: the content
 * script is told them when reading is switched on and rebuilds these surfaces when
 * they change, so reading a whole page aloud speaks at the rate the learner set
 * without asking storage again for each paragraph. */
export function createPageReading(accountId:string,isAuthorized:()=>boolean,preferences:ReadingPreferences=defaultPreferences){
  const host=document.createElement('div');host.dataset.sensaUi='page';host.lang=extensionLanguage();
  host.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483646';
  const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>:host{font:13px/1.5 system-ui;color:#242a38}section{max-width:320px;padding:10px;background:#fbfbfa;border:1px solid #bbc5da;border-radius:12px;box-shadow:0 4px 20px #0002}button{font:inherit;min-height:36px;background:white;color:#303f76;border:1px solid #bcc7df;border-radius:7px;padding:5px 9px;margin:3px;cursor:pointer}p{margin:6px;overflow-wrap:anywhere}button:focus-visible{outline:3px solid #5268a9}</style><section><strong></strong><div><button data-action="translate"></button><button data-action="mode"></button><button data-action="restore"></button><button data-action="retry" hidden></button><button data-action="site"></button><button data-action="speak"></button></div><p role="status"></p><p role="status" data-sensa-speech hidden></p></section>`;
  root.querySelector('section')!.setAttribute('aria-label',t('pageLabel'));
  root.querySelector('strong')!.textContent=t('pageHeading');
  for(const [action,key] of [['translate','pageTranslate'],['mode','pageOnlyTranslation'],['restore','pageRestore'],['retry','pageRetry'],['site','siteDisable'],['speak','pageSpeak']] as const)
    root.querySelector(`[data-action="${action}"]`)!.textContent=t(key);
  root.querySelector('p')!.textContent=t('pageShortcut');
  document.documentElement.append(host);
  const marker=crypto.randomUUID(),hideStyle=document.createElement('style');hideStyle.dataset.sensaUi='translation-style';hideStyle.textContent=`[data-sensa-hidden="${marker}"]{display:none!important}[data-sensa-speaking]{outline:2px solid #5268a9;outline-offset:3px;border-radius:4px}`;document.documentElement.append(hideStyle);
  const status=root.querySelector('p')!;
  const speechStatus=root.querySelector<HTMLParagraphElement>('[data-sensa-speech]')!;
  const retry=root.querySelector<HTMLButtonElement>('[data-action="retry"]')!;
  const speak=root.querySelector<HTMLButtonElement>('[data-action="speak"]')!;
  const items=new Map<HTMLElement,Item>();let active=false,disposed=false,only=false,generation=0,running=0;
  /** Read-aloud state: what is speaking now, how to end it, and which run this is. */
  let speaking:{stop:()=>void}|null=null,finish:(()=>void)|null=null,speechRun=0,reading=false;
  /** The learner's own language, learned from the first answer that names it, so
   * the translations this panel writes are labelled with the language they are
   * actually in rather than with the one this panel's own buttons are written in. */
  let supportLanguage:string|null=null;
  const cache=new Map<string,string>();
  const requests=new Map<string,{promise:Promise<string>;controller:AbortController}>();
  let hovered:HTMLElement|null=null,scanTimer:ReturnType<typeof setTimeout>|null=null;
  const url=location.href;
  const valid=()=>!disposed&&isAuthorized()&&location.href===url;
  const visibility=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void drain();},{rootMargin:'200px'});
  function reveal(item:Item){if(item.source.dataset.sensaHidden===marker)delete item.source.dataset.sensaHidden;item.hidden=false;}
  function restoreItem(item:Item){reveal(item);item.translation.remove();visibility.unobserve(item.source);}
  function eligible(element:HTMLElement){return !element.closest(excluded)&&!element.querySelector(excluded.replace(',code',''))&&!element.querySelector(blocks)&&element.getClientRects().length>0;}
  function add(element:HTMLElement,forced=false){
    const existing=items.get(element);
    if(existing){
      // An explicit request outranks an automatic decision: a paragraph this
      // panel decided the learner can already read is translated when the
      // learner points at it and asks.
      if(forced&&existing.state==='skipped'){existing.forced=true;existing.state='waiting';void drain();}
      return;
    }
    if(!eligible(element)||!nearby(element))return;
    const text=element.textContent??'';
    // Two letters of any script, not two Latin ones: a page in Japanese, Thai or
    // Arabic is readable on the same terms as an English one, and a Latin-only
    // test quietly refused to translate whole languages.
    if(text.trim().length<2||text.length>12000||!/\p{L}{2}/u.test(text))return;
    const translation=document.createElement('div');translation.dataset.sensaUi='translation';translation.style.cssText='white-space:pre-wrap;line-height:1.7;padding:8px 0;color:#405176;font-family:system-ui';
    const item:Item={source:element,text,context:surroundingText(element),sourceLanguage:null,translation,hidden:false,state:'waiting',forced};items.set(element,item);visibility.observe(element);
  }
  function nearby(source:HTMLElement){const rect=source.getBoundingClientRect();return rect.bottom>=-200&&rect.top<=innerHeight+200;}
  function scan(){
    if(!valid())return;
    for(const [source,item] of items){
      if(!source.isConnected||source.textContent!==item.text||surroundingText(source)!==item.context){restoreItem(item);items.delete(source);}
      else if(item.state==='waiting'&&!nearby(source)){visibility.unobserve(source);items.delete(source);}
    }
    for(const [key,request] of requests)if(![...items.values()].some(item=>requestKey(item.text,item.context,item.sourceLanguage)===key)){request.controller.abort();requests.delete(key);}
    if(active)document.querySelectorAll<HTMLElement>(blocks).forEach(element=>add(element));
    drain();
  }
  function feedback(){
    if(!valid())return;
    const values=[...items.values()];
    const ready=values.filter(i=>i.state==='ready').length,skipped=values.filter(i=>i.state==='skipped').length,failed=values.filter(i=>i.state==='failed');
    retry.hidden=failed.length===0;
    status.textContent=[t('pageTranslated',{count:ready}),skipped?t('pageSkipped',{count:skipped}):'',running?t('pageTranslating'):'',failed.length?t('pageFailed',{count:failed.length}):active?t('pageContinue'):''].filter(Boolean).join(' · ');
  }
  function setMode(item:Item){if(item.state!=='ready')return;if(only&&!item.hidden){item.source.dataset.sensaHidden=marker;item.hidden=true;}else if(!only&&item.hidden)reveal(item);}
  function drain(){
    if(!valid())return;
    // Keep the viewport responsive with two bounded requests, choosing again after each result.
    const waiting=[...items.values()].filter(i=>i.state==='waiting'&&i.source.isConnected&&nearby(i.source)).sort((a,b)=>Math.abs(a.source.getBoundingClientRect().top)-Math.abs(b.source.getBoundingClientRect().top));
    while(running<2&&waiting.length){const item=waiting.shift()!;item.state='running';running++;void translateItem(item,generation);}
  }
  /**
   * The language this page declares, or nothing when it declares none.
   *
   * Read once per surface instead of once per paragraph: it is not the answer
   * for a paragraph — paragraphs of a page that quotes another language are in
   * that other language, which is why each one is asked about on its own — but
   * it is what a paragraph too short to detect inherits, and it is what this
   * panel tells the request the quoted text is in.
   */
  const surfaceLanguage=(element:HTMLElement)=>declaredCaptureLanguage({documentElement:element.closest<HTMLElement>('[lang]')??document.documentElement}).language;
  const requestKey=(text:string,context:string,language:string|null)=>JSON.stringify([text,context,language]);
  async function translationFor(text:string,context:string,language:string|null){
    const key=requestKey(text,context,language),cached=cache.get(key);if(cached!==undefined)return cached;
    const existing=requests.get(key);if(existing)return existing.promise;
    const run=generation,controller=new AbortController();
    const request=runReading(accountId,'page',text,context,'',crypto.randomUUID(),partial=>{
      if(!valid()||run!==generation)return;
      for(const item of items.values())if(requestKey(item.text,item.context,item.sourceLanguage)===key&&item.state==='running'&&item.source.isConnected&&item.source.textContent===text&&surroundingText(item.source)===context)item.translation.textContent=partial;
    },controller.signal,language);requests.set(key,{promise:request,controller});
    try{const translated=await request;if(valid()&&run===generation){cache.delete(key);cache.set(key,translated);if(cache.size>150)cache.delete(cache.keys().next().value!);}return translated;}
    finally{if(requests.get(key)?.promise===request)requests.delete(key);}
  }
  async function translateItem(item:Item,run:number){
    /**
     * Inserted at once so the page does not jump, but the placeholder waits.
     *
     * A page of short paragraphs answers from the cache in milliseconds, and a
     * learner watching a sentence arrive does not need to be told it is being
     * worked on for two frames — the flash is what makes a fast tool look slow.
     * The text is only written if nothing has arrived meanwhile, because a
     * streamed answer starts writing into this same element.
     */
    let placeholder:ReturnType<typeof setTimeout>|null=null;
    try{
      // Asked per paragraph, not per page: an article that quotes another
      // language holds paragraphs in two of them, and skipping is a decision
      // about the paragraph in hand.
      const declared=surfaceLanguage(item.source),reader=await readerLanguage(item.text,declared);
      if(!valid()||run!==generation||items.get(item.source)!==item||!item.source.isConnected||item.source.textContent!==item.text||surroundingText(item.source)!==item.context)return;
      item.sourceLanguage=reader?reader.sourceLanguageTag:item.text.trim().length<minSkimmableCharacters?declared:null;
      if(reader)supportLanguage=reader.supportLanguageTag;
      if(!item.forced&&reader?.alreadyReadable){item.state='skipped';return;}
      if(supportLanguage)item.translation.setAttribute('lang',supportLanguage);
      placeholder=setTimeout(()=>{if(item.state==='running'&&!item.translation.textContent){item.translation.textContent=t('pageTranslating');item.translation.setAttribute('aria-busy','true');}},200);
      item.source.after(item.translation);feedback();
      const translated=await translationFor(item.text,item.context,item.sourceLanguage);
      if(!valid()||run!==generation||items.get(item.source)!==item||!item.source.isConnected||item.source.textContent!==item.text||surroundingText(item.source)!==item.context){item.translation.remove();return;}
      item.translation.textContent=translated;item.state='ready';setMode(item);
    }catch(e){
      if(valid()&&run===generation&&items.get(item.source)===item&&item.source.isConnected&&item.source.textContent===item.text){item.state='failed';item.translation.textContent=readingError(e);}
    }finally{
      if(placeholder!==null)clearTimeout(placeholder);
      item.translation.removeAttribute('aria-busy');
      if(run===generation){running--;if(valid()){if(items.size)feedback();drain();}}
    }
  }
  function restore(){generation++;active=false;for(const request of requests.values())request.controller.abort();requests.clear();running=0;for(const item of items.values())restoreItem(item);items.clear();retry.hidden=true;status.textContent=t('pageRestored');}
  root.querySelector('[data-action="translate"]')!.addEventListener('click',()=>{active=true;scan();});
  root.querySelector('[data-action="mode"]')!.addEventListener('click',()=>{only=!only;root.querySelector('[data-action="mode"]')!.textContent=t(only?'pageBilingual':'pageOnlyTranslation');for(const item of items.values())setMode(item);});
  root.querySelector('[data-action="restore"]')!.addEventListener('click',restore);
  retry.addEventListener('click',()=>{for(const item of items.values())if(item.state==='failed'&&nearby(item.source))item.state='waiting';drain();});
  /**
   * The rule is written by the background, from this tab's own hostname, and it
   * stops reading here as well: the panel goes away because reading is off on
   * this site now, not because this button hid itself. A refusal is shown rather
   * than swallowed — a browser page has no site to write a rule about.
   */
  /**
   * Reading the whole page aloud.
   *
   * The blocks are the ones this panel translates, minus the containers: `div` is
   * in that selector for translation, where the panel is bounded by what the
   * learner can see, but a container and the paragraphs inside it would be read
   * twice — and hearing a sentence twice is harder to mistake for a quirk of the
   * page than seeing it twice. Editable regions are left out for the same reason
   * the reader does not translate them: they are the learner's own writing area,
   * not the document.
   *
   * Each block is spoken in the language it is written in, detected per block,
   * because one page can quote another language; the block is highlighted and
   * scrolled to while it is read. Text nothing can place is passed over, and if
   * nothing on the page can be placed — or the device has no voice for the
   * language — the learner is told which of those it is rather than left with a
   * button that did nothing.
   */
  function spokenBlocks():HTMLElement[]{
    return [...document.querySelectorAll<HTMLElement>(blocks)].filter(element=>{
      if(element.closest('[data-sensa-ui]')||element.closest(excluded)||element.isContentEditable)return false;
      if(element.querySelector(blocks))return false;
      const text=(element.textContent??'').trim();
      return text.length>=2&&text.length<=12000&&/\p{L}{2}/u.test(text);
    });
  }
  /** The language of one block: what the detector says, and the page's own
   * declaration only for text too short to detect — the order the skip rule uses,
   * because a sentence quoted in another language deserves its own voice. */
  async function spokenLanguage(text:string,element:HTMLElement){
    return (await detectBlockLanguage(text,{documentElement:element.closest<HTMLElement>('[lang]')??document.documentElement})).language;
  }
  async function readAloud(){
    const queue=spokenBlocks();
    if(!queue.length){speechStatus.hidden=false;speechStatus.textContent=t('pageNoReadableText');return;}
    const run=++speechRun;
    reading=true;speak.textContent=t('pageStopSpeaking');speechStatus.hidden=false;
    for(let index=0;index<queue.length;index++){
      if(run!==speechRun)return;
      const element=queue[index]!,text=(element.textContent??'').trim();
      const language=await spokenLanguage(text,element);
      if(run!==speechRun)return;
      if(!language){stopReadingAloud(speechFailureText({ok:false,reason:'no_language',languageTag:null}));return;}
      element.setAttribute('data-sensa-speaking','');element.scrollIntoView({block:'center'});
      speechStatus.textContent=t('pageSpeakingParagraph',{index:index+1,total:queue.length,preview:text.slice(0,40)+(text.length>40?'…':'')});
      let end!:()=>void;const ended=new Promise<void>(resolve=>{end=resolve;});finish=end;
      const attempt=await speakText(text,language,{rate:preferences.speechRate,voice:preferences.speechVoice,onEnd:end});
      if(run!==speechRun){if(attempt.ok)attempt.stop();return;}
      if(!attempt.ok){stopReadingAloud(speechFailureText(attempt));return;}
      speaking=attempt;
      await ended;
      if(run!==speechRun)return;
      speaking=null;finish=null;
      element.removeAttribute('data-sensa-speaking');
    }
    if(run===speechRun)stopReadingAloud(t('pageSpeechDone'));
  }
  /** Stopping clears the highlight with the speech: a page left with one paragraph
   * outlined looks like something is still happening. */
  function stopReadingAloud(message=''){
    speechRun++;reading=false;speaking?.stop();speaking=null;finish?.();finish=null;
    for(const element of document.querySelectorAll('[data-sensa-speaking]'))element.removeAttribute('data-sensa-speaking');
    speak.textContent=t('pageSpeak');
    speechStatus.hidden=message==='';speechStatus.textContent=message;
  }
  speak.addEventListener('click',()=>{if(reading)stopReadingAloud();else void readAloud();});
  root.querySelector('[data-action="site"]')!.addEventListener('click',()=>{void chrome.runtime.sendMessage({kind:'reading-site',enabled:false}).then(response=>{
    // Nothing is said on success: the background turns reading off for this tab,
    // so this panel is removed, and that is the answer. A refusal is said here,
    // because there is no other place it would appear.
    if(response?.error)status.textContent=readingError(new Error(response.error));
  },()=>{status.textContent=readingError(new Error('unsupported_page'));});});
  const mouse=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target:null;hovered=target?.closest<HTMLElement>(blocks)??null;};
  // What a shortcut must not interrupt is typing. Focus resting on one of this
  // panel's own buttons is not typing, and it is where focus lands after every
  // click here — so the panel's own chrome is not part of this guard.
  const typing='input,textarea,select,[contenteditable]:not([contenteditable="false"])';
  const key=(e:KeyboardEvent)=>{if(!e.altKey||e.code!=='KeyT'||e.repeat||(e.target instanceof Element&&e.target.closest(typing)))return;if(hovered&&valid()){e.preventDefault();add(hovered,true);void drain();}};
  const scheduleScan=()=>{if(scanTimer||!valid())return;scanTimer=setTimeout(()=>{scanTimer=null;scan();},150);};
  const scroll=()=>{if(active)scheduleScan();else drain();};
  document.addEventListener('pointerover',mouse);document.addEventListener('keydown',key);document.addEventListener('scroll',scroll,true);
  const owned=(node:Node)=>node instanceof Element?Boolean(node.closest('[data-sensa-ui]')):Boolean(node.parentElement?.closest('[data-sensa-ui]'));
  const observer=new MutationObserver(records=>{
    if(!items.size&&!active)return;
    // Translation feedback is our own mutation, not new host content to rescan.
    if(records.some(record=>!owned(record.target)&&(record.type==='characterData'||[...record.addedNodes,...record.removedNodes].some(node=>!owned(node)))))scheduleScan();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  return {host,destroy(){disposed=true;restore();cache.clear();observer.disconnect();visibility.disconnect();if(scanTimer)clearTimeout(scanTimer);document.removeEventListener('pointerover',mouse);document.removeEventListener('keydown',key);document.removeEventListener('scroll',scroll,true);stopReadingAloud();host.remove();hideStyle.remove();}};
}
