import {webUrl} from './config';
/**
 * The protocol this script speaks, injected at build time from the contracts.
 *
 * This bundle is a content script on every load of the Web application, so it
 * carries no schema and no language catalog: it knows the two channels, the id
 * bound and the kind allowlist, and nothing else. The service worker parses what
 * this forwards. The allowlist is still here rather than only there, because the
 * bridge's channel must not be a way for a page to reach the extension's other
 * features, and reading it from the contracts at build time is what keeps this
 * list from becoming a second, drifting copy of the protocol.
 */
declare const SENSA_BRIDGE:{request:string;response:string;notification:string;notificationKind:string;maxIdLength:number;kinds:readonly string[]};
// Only the configured Sensa origin gets this isolated-world bridge. Never forward tokens.
if(location.origin===new URL(webUrl).origin){
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!==SENSA_BRIDGE.request)return;
  const id=event.data.id;
  // Without an id there is nobody to answer, so the message is not ours to take.
  if(typeof id!=='string'||id.length===0||id.length>SENSA_BRIDGE.maxIdLength)return;
  const answer=(payload:Record<string,unknown>)=>window.postMessage({channel:SENSA_BRIDGE.response,id,...payload},location.origin);
  // A refusal is answered at once rather than by staying silent: a page that
  // speaks a protocol this extension does not have should learn that now, not
  // after waiting out a timeout meant for an extension that is not installed.
  if(typeof event.data.kind!=='string'||!SENSA_BRIDGE.kinds.includes(event.data.kind)){answer({error:'unsupported_message'});return;}
  try{
   void chrome.runtime.sendMessage(event.data).then(
    result=>answer(result&&typeof result==='object'?result as Record<string,unknown>:{error:'extension_unavailable'}),
    ()=>answer({error:'extension_unavailable'}));
  }catch{answer({error:'extension_unavailable'});}
 });
 // The background announces only that work exists. Learner content remains on
 // the typed pull/ack wire above and never appears in an unsolicited message.
 chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id||message?.kind!==SENSA_BRIDGE.notificationKind||message.accountId!==null&&typeof message.accountId!=='string')return;
  window.postMessage({channel:SENSA_BRIDGE.notification,kind:SENSA_BRIDGE.notificationKind,accountId:message.accountId},location.origin);
 });
}
