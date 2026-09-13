import {t,errorText} from './i18n';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {captureSourceLink} from '@sensa/contracts/sensa';
import {runReading,runLookup,readingError} from './readingClient';
import {defaultPreferences} from './preferences';
import {detectCaptureLanguage} from './language';
import {speakText,speechFailureText} from './speech';
import type {ReadingPreferences} from './preferences';

interface ReadingPanelInput {
  snapshot: CaptureSnapshot;
  contextAlternative?: CaptureSnapshot;
  range: Range;
  accountId: string;
  isAuthorized: () => boolean;
  close: () => void;
  keyboard: boolean;
  preferences?:ReadingPreferences;
}

/** Sensa's in-page understanding and optional-save surface. */
export function showReadingPanel(input: ReadingPanelInput) {
  const {range, accountId, close} = input;
  let snapshot=input.snapshot;
  const host = document.createElement('div');
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial;position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483647;';
  const shadow = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:light}
    *{box-sizing:border-box}
    section{font:14px/1.55 system-ui,sans-serif;color:#242a38;background:#fbfbfa;border:1px solid #cbd1df;border-radius:13px;box-shadow:0 8px 32px #0002;overflow:auto;overscroll-behavior:contain;width:max-content;max-width:calc(100vw - 16px)}
    section.expanded{width:360px}
    button{font:inherit;color:inherit;background:transparent;border:0;border-radius:8px;min-height:40px;padding:8px 10px;cursor:pointer;white-space:nowrap}
    button:hover{background:#eaeef6}button:disabled{opacity:.55;cursor:wait}
    button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #303f76;outline-offset:-3px}
    .toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:4px}
    .toolbar .dismiss{color:#68748d;margin-left:auto}
    header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e4e7ed;padding:2px 8px}
    .drag{font-weight:650;cursor:move;touch-action:none;user-select:none}
    header span{font-size:12px;color:#68748d;padding-right:6px}
    .body{padding:4px 16px 16px}
    p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}
    .original{font-size:15px;margin:8px 0 4px}mark{background:#f5e5a6;color:inherit;border-radius:3px}
    .source{display:block;font-size:12px;color:#68748d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:12px;text-decoration:none}
    .source:hover{text-decoration:underline}
    .explanation{font-size:15px;border-top:1px solid #e4e7ed;padding-top:12px}
    .feedback{font-size:13px;color:#57627a}
    .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
    .actions button{border:1px solid #bec5d5;background:white}
    .actions .primary{background:#303f76;color:white;border-color:#303f76}
    summary{cursor:pointer;padding:8px 0;color:#57627a}
    details p{font-size:13px;color:#57627a}
    [hidden]{display:none!important}
  `;
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Sensa 阅读');
  const header = document.createElement('header');
  header.hidden = true;
  const button = (text: string, action: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.onclick = action;
    return element;
  };
  const drag = button('Sensa ⠿', () => undefined);
  drag.className = 'drag';
  drag.setAttribute('aria-label', '拖动阅读浮层');
  drag.title = '拖动位置；聚焦后可用方向键移动';
  const hint = document.createElement('span');
  hint.textContent = '阅读助手';
  const collapse=button('收起',()=>{expanded=false;header.hidden=body.hidden=true;preview.hidden=false;panel.classList.remove('expanded');manuallyMoved=false;layout();});
  header.append(drag, hint, collapse);
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', '选中文字的操作');
  const lookup = button('句中解释', () => { expand(); void explain(); });
  const speak = button(t('readAloud'), () => readAloud());
  const preview = button('保存…', () => expand());
  const translate = button('翻译', () => void assist('selection'));
  const custom = button(input.preferences?.actionName??defaultPreferences.actionName, () => void assist('action'));
  const dismiss = button('关闭', close);
  dismiss.className = 'dismiss';
  toolbar.append(lookup, translate, speak, custom, preview, dismiss);
  const body = document.createElement('div');
  body.className = 'body';
  body.hidden = true;
  const original = document.createElement('p');
  original.className = 'original';
  let expression = snapshot.expression;
  function renderOriginal(){
  original.replaceChildren();
  if (expression) {
    const chars = Array.from(snapshot.sentence);
    const mark = document.createElement('mark');
    mark.textContent = expression.text;
    original.append(chars.slice(0, expression.start).join(''), mark, chars.slice(expression.end).join(''));
  } else original.textContent = snapshot.sentence;
  }
  renderOriginal();
  const source = document.createElement('a');
  source.className = 'source';
  source.textContent = snapshot.source.title || snapshot.source.url || '当前网页';
  source.title = snapshot.source.url ?? '';
  if (snapshot.source.url) source.href = snapshot.source.url;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  const explanation = document.createElement('p');
  explanation.className = 'explanation';
  explanation.setAttribute('role', 'status');
  explanation.textContent = expression ? '点击「句中解释」了解这个表达；也可以先保存原句。' : '本次选区跨越句子，可先保存待处理。';
  const details = document.createElement('details');
  details.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = '详细意思';
  const detailText = document.createElement('p');
  details.append(summary, detailText);
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'actions';
  const accept = button(t('saveAction'), () => void persist('accept'));
  accept.className = 'primary';
  accept.hidden = true;
  const save = button(t('savePendingAction'), () => void persist('save'));
  const check = button(t('checkExplanation'), () => void explain());
  check.hidden = true;
  const contextToggle=button('扩展上下文',()=>changeContext());
  contextToggle.hidden=!input.contextAlternative||input.contextAlternative.sentence===input.snapshot.sentence;
  const openInbox = button(t('openInbox'), () => void chrome.runtime.sendMessage({kind:'open-inbox',accountId,operationId:savedOperation}).then(response=>{if(response.error)feedback.textContent=errorText(new Error(response.error));}).catch(error=>{feedback.textContent=errorText(error);}));
  openInbox.hidden=true;
  actions.append(accept, save, check, contextToggle, openInbox);
  const learningHint = document.createElement('p');
  learningHint.className = 'feedback';
  learningHint.textContent = t('deliveryHint');
  const assistance=document.createElement('p');assistance.setAttribute('role','status');assistance.hidden=true;
  body.append(original, source, assistance, explanation, details, feedback, actions, learningHint);
  if(snapshot.source.url)source.href=captureSourceLink(snapshot.source)!;
  if(snapshot.source.video)source.textContent=`${snapshot.source.title} · ${Math.floor(snapshot.source.video.startMs/60000)}:${String(Math.floor(snapshot.source.video.startMs%60000/1000)).padStart(2,'0')}`;
  panel.append(header, toolbar, body);
  shadow.append(style, panel);
  document.documentElement.append(host);
  host.showPopover();
  shadow.addEventListener('pointerdown',event=>{const target=event.target;if(target instanceof HTMLButtonElement&&(event as PointerEvent).button===0)event.preventDefault();});

  let disposed = false;
  let expanded = false;
  let position: {left: number; top: number} | null = null;
  let manuallyMoved = false;
  let frame = 0;
  let lookupBusy = false;
  let lookupReady = false;
  let lookupFailed = false;
  let saving = false;
  let saved = false;
  let savedOperation:string|undefined;
  let deliveryTimer:ReturnType<typeof setTimeout>|undefined;
  let speaking: (() => void) | null = null;
  let assistanceRun=0;
  let lookupId = crypto.randomUUID();
  let saveId = crypto.randomUUID();
  let acceptId = crypto.randomUUID();
  let revision=0;
  let assistanceController:AbortController|null=null;
  let lookupController:AbortController|null=null;
  let poll:ReturnType<typeof setTimeout>|null=null;
  let waitTimer:ReturnType<typeof setTimeout>|null=null;
  const alive = () => !disposed && host.isConnected && input.isAuthorized();
  async function assist(feature:'selection'|'action'){
    if(!mayAct())return;expand();const run=++assistanceRun;assistance.hidden=false;assistance.textContent='正在处理…';
    assistanceController?.abort();assistanceController=new AbortController();
    assistance.setAttribute('aria-busy','true');translate.disabled=custom.disabled=true;
    try{const text=await runReading(accountId,feature,expression?.text??snapshot.sentence,snapshot.sentence,input.preferences?.actionPrompt??defaultPreferences.actionPrompt,crypto.randomUUID(),partial=>{if(alive()&&run===assistanceRun)assistance.textContent=partial;},assistanceController.signal,snapshot.language);if(alive()&&run===assistanceRun)assistance.textContent=text;}
    catch(e){if(alive()&&run===assistanceRun)assistance.textContent=readingError(e);}
    finally{if(alive()&&run===assistanceRun){translate.disabled=custom.disabled=false;assistance.removeAttribute('aria-busy');layout();}}
  }
  function changeContext(){
    if(!mayAct()||saving||saved||!input.contextAlternative)return;
    revision++;lookupController?.abort();lookupBusy=false;lookupReady=false;lookupFailed=false;assistanceRun++;assistanceController?.abort();
    if(poll)clearTimeout(poll);if(waitTimer)clearTimeout(waitTimer);
    snapshot=snapshot===input.snapshot?input.contextAlternative:input.snapshot;expression=snapshot.expression;
    lookupId=crypto.randomUUID();saveId=crypto.randomUUID();acceptId=crypto.randomUUID();
    renderOriginal();hint.textContent=t('readingAssistant');contextToggle.textContent=snapshot===input.snapshot?'扩展上下文':'使用原上下文';
    explanation.textContent='上下文已调整，点击「句中解释」重新解释。';explanation.removeAttribute('aria-busy');
    assistance.hidden=true;assistance.removeAttribute('aria-busy');details.hidden=accept.hidden=check.hidden=true;
    lookup.disabled=!expression;check.disabled=false;translate.disabled=custom.disabled=false;feedback.textContent='';layout();
  }
  function mayAct() {
    if (!alive()) return false;
    if (location.href !== snapshot.source.url) {
      expand();
      feedback.textContent = '页面已变化，请在当前页面重新划选。';
      return false;
    }
    return true;
  }
  function layout() {
    if (disposed) return;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth;
    const height = viewport?.height ?? innerHeight;
    const x = viewport?.offsetLeft ?? 0;
    const y = viewport?.offsetTop ?? 0;
    panel.style.maxWidth = `${Math.max(0, width - 16)}px`;
    panel.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const size = panel.getBoundingClientRect();
    if (!manuallyMoved) {
      if (!range.startContainer.isConnected || !range.endContainer.isConnected) {
        if (!expanded) { queueMicrotask(close); return; }
      } else {
        const rect = range.getBoundingClientRect();
        if (!expanded && (rect.bottom <= y || rect.top >= y + height || rect.right <= x || rect.left >= x + width)) {
          queueMicrotask(close); return;
        }
        position = {left: rect.left, top: rect.bottom + 8};
        if (position.top + size.height > y + height - 8 && rect.top - size.height - 8 >= y + 8)
          position.top = rect.top - size.height - 8;
      }
    }
    position ??= {left: x + 8, top: y + 8};
    position.left = Math.max(x + 8, Math.min(position.left, x + width - size.width - 8));
    position.top = Math.max(y + 8, Math.min(position.top, y + height - size.height - 8));
    host.style.left = `${position.left}px`;
    host.style.top = `${position.top}px`;
  }
  function scheduleLayout() {
    if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }
  function expand() {
    expanded = true;
    header.hidden = false;
    body.hidden = false;
    preview.hidden = true;
    panel.classList.add('expanded');
    layout();
  }
  async function explain() {
    if (!mayAct() || lookupBusy || lookupReady || saved || !expression) return;
    if(lookupFailed){lookupId=crypto.randomUUID();lookupFailed=false;}
    check.textContent=t('checkExplanation');
    lookupBusy = true;
    lookup.disabled = check.disabled = true;
    const version=revision;const id=lookupId;
    lookupController?.abort();lookupController=new AbortController();
    if(poll)clearTimeout(poll);if(waitTimer)clearTimeout(waitTimer);
    waitTimer=setTimeout(()=>{if(alive()&&version===revision&&lookupBusy)explanation.textContent=t('explanationWaiting');},6000);
    explanation.textContent = t('explaining');
    explanation.setAttribute('aria-busy', 'true');
    try {
      const result=await runLookup(accountId,snapshot,id,partial=>{if(alive()&&version===revision){if(waitTimer)clearTimeout(waitTimer);explanation.textContent=partial;hint.textContent=t('explanationPartial');}},lookupController.signal);
      if (!alive()||version!==revision) return;
      if (result.status === 'ready' && result.proposal) {
        lookupReady = true;
        explanation.textContent = result.proposal.explanation;
        detailText.textContent = result.proposal.semanticSpec.coreMeaningFocus + '\n' +
          result.proposal.semanticSpec.prototypeScenes.map(scene => scene.summary).join('\n');
        details.hidden = false;
        accept.hidden = saved;
        check.hidden = true;
      } else {
        lookupFailed=result.status==='failed';
        explanation.textContent = lookupFailed?errorText(new Error(result.reason??'lookupFailed')):t(result.status==='running'?'explanationWaiting':'meaningUnresolved');
        check.hidden = (!lookupFailed&&result.status !== 'running') || saved;
        if(lookupFailed)check.textContent=t('retryExplanation');
        if(result.status==='running')poll=setTimeout(()=>{if(alive()&&version===revision)void explain();},2000);
      }
    } catch (error) {
      if (alive()&&version===revision) {
        explanation.textContent = errorText(error);
        check.hidden = saved;
      }
    } finally {
      if(version!==revision)return;
      if(waitTimer)clearTimeout(waitTimer);hint.textContent=t('readingAssistant');
      lookupBusy = false;
      lookup.disabled = lookupReady || saved || !expression;
      check.disabled = false;
      explanation.removeAttribute('aria-busy');
      if (alive()) layout();
    }
  }
  async function persist(kind: 'save' | 'accept') {
    if (!mayAct() || saving || saved || (kind === 'accept' && !lookupReady)) return;
    saving = true;
    save.disabled = accept.disabled = contextToggle.disabled = true;
    feedback.textContent = t('saving');
    try {
      const response = await chrome.runtime.sendMessage(kind === 'save'
        ? {kind, snapshot, operationId: saveId, accountId}
        : {kind, lookupId, operationId: acceptId, accountId});
      if (response.error) throw new Error(response.error);
      if (!alive()) return;
      saved = true;
      savedOperation=kind==='save'?saveId:acceptId;
      openInbox.hidden=response.value?.destination!=='web';
      save.hidden = accept.hidden = check.hidden = true;
      lookup.disabled = true;
      feedback.textContent = t(response.value?.committed?(kind==='save'?'savedInbox':'savedDone'):'savedPending');
      if(response.value?.destination==='web'&&!response.value.committed)void checkDelivery();
    } catch (error) {
      if (alive()) feedback.textContent = errorText(error);
    } finally {
      saving = false;
      save.disabled = accept.disabled = false;contextToggle.disabled=saved;
      if (alive()) layout();
    }
  }
  async function checkDelivery(){
    if(!alive()||!savedOperation)return;
    try{
      const result=await chrome.runtime.sendMessage({kind:'save-status',accountId,operationId:savedOperation});
      if(!alive())return;
      if(result.error){feedback.textContent=errorText(new Error(result.error));return;}
      if(result.value?.committed){feedback.textContent=t(result.value.status==='pending'?'savedInbox':'savedDone');return;}
    }catch {if(!alive())return;}
    deliveryTimer=setTimeout(()=>void checkDelivery(),2000);
  }
  function stopSpeech() {
    speaking?.();
    speaking = null;
    speak.textContent = t('readAloud');
    speak.setAttribute('aria-pressed', 'false');
  }
  /**
   * Read the quoted text in the language it is written in.
   *
   * The capture states that language when it could, and a detector is asked when
   * it could not: a voice is chosen by the language of the text, and this is the
   * one place that can still find it out. Nothing is spoken in a language nobody
   * established — a word read with the wrong voice is a wrong pronunciation
   * presented as the word's, which is what asking for English always did.
   */
  async function readAloud() {
    if (!mayAct()) return;
    if (speaking) { stopSpeech(); return; }
    const text = expression?.text ?? snapshot.sentence;
    let languageTag = snapshot.language;
    if (!languageTag) {
      const detected = await detectCaptureLanguage(text);
      if (!alive()) return;
      languageTag = detected.language;
    }
    const attempt = await speakText(text, languageTag, {
      rate: input.preferences?.speechRate ?? defaultPreferences.speechRate,
      voice: input.preferences?.speechVoice,
      onEnd: () => { if (!disposed) stopSpeech(); },
    });
    if (!alive()) { if (attempt.ok) attempt.stop(); return; }
    if (!attempt.ok) {
      expand();
      feedback.textContent = speechFailureText(attempt);
      return;
    }
    speaking = attempt.stop;
    speak.textContent = t('readingAloud');
    speak.setAttribute('aria-pressed', 'true');
  }
  let dragStart: {id: number; x: number; y: number; left: number; top: number} | null = null;
  drag.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !position) return;
    dragStart = {id: event.pointerId, x: event.clientX, y: event.clientY, ...position};
    drag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  drag.addEventListener('pointermove', event => {
    if (!dragStart || event.pointerId !== dragStart.id) return;
    manuallyMoved = true;
    position = {left: dragStart.left + event.clientX - dragStart.x, top: dragStart.top + event.clientY - dragStart.y};
    layout();
  });
  drag.addEventListener('lostpointercapture', () => { dragStart = null; });
  drag.addEventListener('keydown', event => {
    const delta: Record<string, [number, number]> = {ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16]};
    if (!position || !delta[event.key]) return;
    event.preventDefault();
    manuallyMoved = true;
    position.left += delta[event.key][0];
    position.top += delta[event.key][1];
    layout();
  });
  lookup.disabled = !expression;
  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(panel);
  document.addEventListener('scroll', scheduleLayout, true);
  window.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('scroll', scheduleLayout);
  layout();
  if (input.keyboard) (lookup.disabled ? preview : lookup).focus({preventScroll: true});
  return {
    host,
    destroy() {
      if(deliveryTimer)clearTimeout(deliveryTimer);
      disposed = true;assistanceRun++;assistanceController?.abort();lookupController?.abort();
      if(poll)clearTimeout(poll);if(waitTimer)clearTimeout(waitTimer);
      stopSpeech();
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', scheduleLayout, true);
      window.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('scroll', scheduleLayout);
      host.remove();
    },
  };
}
