import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import {detectCaptureLanguage} from './language';

const excluded='input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),script,style,noscript,[hidden],[aria-hidden="true"],[data-sensa-ui]';
const blockSelector='p,li,blockquote,td,th,dt,dd,h1,h2,h3,h4,h5,h6,pre,figcaption';
function localBlock(node:Node){
  let element=node instanceof Element?node:node.parentElement;
  while(element&&element!==document.body&&element!==document.documentElement){
    if(element.matches(blockSelector)||['block','list-item'].includes(getComputedStyle(element).display))return element;
    element=element.parentElement;
  }
  return null;
}
interface CapturedText{text:string;from:number;to:number;}
/**
 * Walk the selection and freeze its text with stable Unicode offsets, including
 * cross-block selections.
 *
 * Deliberately synchronous and separate from `captureSelection`: everything this
 * function reads lives in the live DOM, so it must finish before any `await`.
 * The captured text is then a value, and detection can take as long as it likes
 * without the page being able to move the ground under the capture.
 */
function captureText(range:Range):CapturedText|null{
  const start=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;
  const end=range.endContainer instanceof Element?range.endContainer:range.endContainer.parentElement;
  if(!start||!end||start.closest(excluded)||end.closest(excluded)||range.collapsed)return null;
  const first=localBlock(range.startContainer),last=localBlock(range.endContainer);
  if(!first||!last||!first.getClientRects().length||!last.getClientRects().length||getComputedStyle(first).visibility==='hidden'||getComputedStyle(last).visibility==='hidden')return null;
  const bounds=document.createRange();bounds.setStartBefore(first);bounds.setEndAfter(last);
  const ancestor=first===last?first:bounds.commonAncestorContainer;
  const walker=document.createTreeWalker(ancestor,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      if(node instanceof Element&&(node.matches(excluded)||getComputedStyle(node).display==='none'||getComputedStyle(node).visibility==='hidden'))return NodeFilter.FILTER_REJECT;
      return bounds.intersectsNode(node)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    },
  });
  let text='',from=-1,to=-1,previous:Element|null=null,count=0;
  while(walker.nextNode()){
    const node=walker.currentNode;if(++count>12000)return null;
    if(node instanceof HTMLBRElement){if(text&&!text.endsWith('\n'))text+='\n';continue;}
    if(node.nodeType!==Node.TEXT_NODE||!node.textContent)continue;
    const block=localBlock(node);
    if(previous&&block!==previous&&text&&!text.endsWith('\n'))text+='\n';
    const value=node.textContent,offset=text.length;text+=value;previous=block;
    if(text.length>24000)return null;
    if(range.intersectsNode(node)){
      const left=node===range.startContainer?range.startOffset:range.comparePoint(node,0)>=0?0:value.length;
      const right=node===range.endContainer?range.endOffset:range.comparePoint(node,value.length)<=0?value.length:0;
      if(right>left){if(from<0)from=offset+left;to=offset+right;}
    }
  }
  if(from<0||to<=from)return null;
  while(from<to&&/\s/u.test(text[from]))from++;
  while(to>from&&/\s/u.test(text[to-1]))to--;
  if(to<=from||to-from>2000)return null;
  return {text,from,to};
}
/**
 * Capture one visible selection, labelled with the language it is actually in.
 *
 * The sentence is cut with a segmenter set to that language, and an undetermined
 * language leaves the segmenter on the runtime default rather than asserting
 * English — the boundaries are then the runtime's best guess, which is honest,
 * where `en` would have been a claim nobody made.
 */
export async function captureSelection(range:Range,scope:'sentence'|'block'='sentence'):Promise<CaptureSnapshot|null>{
  const captured=captureText(range);
  if(!captured)return null;
  const {text,from,to}=captured;
  const {language,languageSource,languageConfidence}=await detectCaptureLanguage(text);
  let left=0,right=text.length;
  if(scope==='sentence'){
    const segments=Array.from(new Intl.Segmenter(language??undefined,{granularity:'sentence'}).segment(text));
    left=segments.find(s=>s.index<=from&&s.index+s.segment.length>from)?.index??from;
    const tail=segments.find(s=>s.index<to&&s.index+s.segment.length>=to);
    right=tail?tail.index+tail.segment.length:to;
  }
  const sentence=text.slice(left,right);
  if(sentence.length>12000)return null;
  return {sentence,language,languageSource,languageConfidence,expression:{text:text.slice(from,to),start:Array.from(text.slice(left,from)).length,end:Array.from(text.slice(left,to)).length},
    source:{url:location.href,title:document.title.slice(0,1000),capturedAt:new Date().toISOString()}};
}
