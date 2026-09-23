import {runReading,readingError} from './readingClient';
import {surroundingText} from './pageReading';
import {t,extensionLanguage} from './i18n';

/**
 * What the learner is writing, translated into the language they are learning.
 *
 * Every other surface here translates something the learner met; this one
 * translates something they wrote. Their text is in the language they think in
 * and they want to see it in the one they are learning, so the request runs the
 * other way — the pair already tells the service which is which, and this side
 * never has to decide.
 *
 * Only fields a learner writes prose in: a password field is never read, and a
 * URL, number or date field cannot hold a sentence. The field is read when the
 * learner asks, with the same shortcut that translates a paragraph, and the page
 * is not modified until they say so.
 */
const writable=['text','search'].map(type=>`input[type="${type}"]`).join(',')+',textarea,[contenteditable]:not([contenteditable="false"])';
const maxWritableCharacters=12000;

/** The field under an event, when it is one this surface may touch. */
export function writableField(target:EventTarget|null):HTMLElement|null{
 const element=target instanceof Element?target.closest<HTMLElement>(writable):null;
 if(!element)return null;
 if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)return element.readOnly||element.disabled?null:element;
 return element.isContentEditable?element:null;
}
export const writableFieldText=(field:HTMLElement)=>field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement?field.value:field.innerText;

/**
 * Replaces what is in the field with the translation.
 *
 * Written as an insertion rather than as an assignment, for two reasons that have
 * both bitten this class of tool: a page's field is usually a controlled
 * component, and a plain `value =` is dropped by its next render; and an
 * insertion is the edit the browser already knows how to undo. Either path ends
 * with the events a page listens for, so whatever state the page keeps follows
 * the field it owns.
 */
export function replaceFieldText(field:HTMLElement,text:string){
 field.focus();
 if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement){
  field.select();
  const inserted=document.execCommand('insertText',false,text);
  if(!inserted||field.value!==text){
   const setter=Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;
   if(setter)setter.call(field,text);else field.value=text;
  }
 }else{
  const range=document.createRange();range.selectNodeContents(field);
  const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
  if(!document.execCommand('insertText',false,text))field.textContent=text;
 }
 field.dispatchEvent(new Event('input',{bubbles:true}));
 field.dispatchEvent(new Event('change',{bubbles:true}));
}

/** One field, one answer: the panel belongs to the element it was opened for, so a
 * translation can never be inserted into some other field the learner has since
 * clicked into. */
export function createInputTranslation(accountId:string,isAuthorized:()=>boolean){
 const host=document.createElement('div');host.dataset.sensaUi='writing';host.lang=extensionLanguage();
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>:host{all:initial}section{position:fixed;max-width:340px;padding:10px;background:#fbfbfa;border:1px solid #bbc5da;border-radius:12px;box-shadow:0 4px 20px #0002;font:13px/1.5 system-ui;color:#242a38}div{max-height:180px;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:white;border:1px solid #e0e5ee;border-radius:8px;padding:8px;margin-bottom:6px}button{font:inherit;min-height:34px;background:white;color:#303f76;border:1px solid #bcc7df;border-radius:7px;padding:5px 9px;margin:2px;cursor:pointer}button:focus-visible{outline:3px solid #5268a9}p{margin:6px 2px;overflow-wrap:anywhere}</style><section><div role="status" aria-live="polite"></div><button data-action="replace" hidden></button><button data-action="close"></button><p hidden></p></section>`;
 const panel=root.querySelector<HTMLElement>('section')!,answer=root.querySelector<HTMLDivElement>('div')!,replace=root.querySelector<HTMLButtonElement>('[data-action="replace"]')!,close=root.querySelector<HTMLButtonElement>('[data-action="close"]')!,note=root.querySelector<HTMLParagraphElement>('p')!;
 panel.setAttribute('aria-label',t('writingLabel'));replace.textContent=t('writingReplace');close.textContent=t('panelClose');
 let field:HTMLElement|null=null,generation=0,controller:AbortController|null=null,translated='';
 function hide(){
  generation++;controller?.abort();controller=null;field=null;translated='';
  answer.textContent='';answer.removeAttribute('aria-busy');replace.hidden=true;note.hidden=true;host.remove();
 }
 /** Placed under the field, or above it when the field is near the bottom of the
  * window: a panel that covers the thing it is translating is worse than none. */
 function place(){
  if(!field?.isConnected)return hide();
  const box=field.getBoundingClientRect(),height=panel.offsetHeight||120;
  panel.style.left=Math.max(8,Math.min(box.left,innerWidth-352))+'px';
  panel.style.top=(box.bottom+height+8<innerHeight?box.bottom+6:Math.max(8,box.top-6-height))+'px';
 }
 function say(message:string){note.textContent=message;note.hidden=false;}
 async function translate(target:HTMLElement){
  const text=writableFieldText(target).trim();
  hide();
  if(!isAuthorized())return;
  field=target;document.documentElement.append(host);place();
  if(!text)return say(t('writingEmpty'));
  if(text.length>maxWritableCharacters)return say(t('writingTooLong',{count:text.length}));
  const run=++generation;controller=new AbortController();
  answer.setAttribute('aria-busy','true');answer.textContent=t('writingTranslating');
  try{
   // The field's surroundings are what the learner is replying to, so the topic and
   // the tone travel with their sentence. Nothing is skipped here: this is the
   // learner asking for one piece of their own writing, and a request is never
   // skipped.
   translated=await runReading(accountId,'writing',text,surroundingText(target),'',crypto.randomUUID(),partial=>{if(run===generation&&field===target)answer.textContent=partial;},controller.signal);
   if(run!==generation||field!==target||!target.isConnected)return;
   answer.textContent=translated;answer.removeAttribute('aria-busy');replace.hidden=false;place();
  }catch(error){
   if(run!==generation||field!==target)return;
   answer.removeAttribute('aria-busy');answer.textContent=readingError(error);
  }
 }
 replace.addEventListener('click',()=>{if(field&&translated){replaceFieldText(field,translated);hide();}});
 close.addEventListener('click',hide);
 const key=(event:KeyboardEvent)=>{
  if(event.key==='Escape'&&field){event.preventDefault();event.stopPropagation();hide();return;}
  if(!event.altKey||event.code!=='KeyT'||event.repeat)return;
  const target=writableField(event.target);
  if(!target||!isAuthorized())return;
  event.preventDefault();event.stopPropagation();
  void translate(target);
 };
 // A field that leaves the document takes its answer with it; a panel that merely
 // lost focus does not, because the replace button is what focus moved to.
 const focusedOut=()=>{if(field&&!field.isConnected)hide();};
 const scrolled=()=>{if(field)place();};
 document.addEventListener('keydown',key,true);
 document.addEventListener('focusout',focusedOut,true);
 addEventListener('scroll',scrolled,true);
 return {host,destroy(){document.removeEventListener('keydown',key,true);document.removeEventListener('focusout',focusedOut,true);removeEventListener('scroll',scrolled,true);hide();}};
}
