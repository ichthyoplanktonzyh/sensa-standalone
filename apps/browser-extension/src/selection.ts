import type {CaptureSnapshot} from '@sensa/contracts/sensa';

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
/** Capture visible source text with stable Unicode offsets, including cross-block selections. */
export function captureSelection(range:Range,scope:'sentence'|'block'='sentence'):CaptureSnapshot|null{
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
  let left=0,right=text.length;
  if(scope==='sentence'){
    const segments=Array.from(new Intl.Segmenter('en',{granularity:'sentence'}).segment(text));
    left=segments.find(s=>s.index<=from&&s.index+s.segment.length>from)?.index??from;
    const tail=segments.find(s=>s.index<to&&s.index+s.segment.length>=to);
    right=tail?tail.index+tail.segment.length:to;
  }
  const sentence=text.slice(left,right);
  if(sentence.length>12000)return null;
  return {sentence,language:'en',expression:{text:text.slice(from,to),start:Array.from(text.slice(left,from)).length,end:Array.from(text.slice(left,to)).length},
    source:{url:location.href,title:document.title.slice(0,1000),capturedAt:new Date().toISOString()}};
}
