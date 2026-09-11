import {webUrl} from './config';
// Only the configured Sensa origin gets this isolated-world bridge. Never forward tokens.
if(location.origin===new URL(webUrl).origin){
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='sensa-web-intake-request')return;
  const {id,kind,accountId,libraryId,receipt}=event.data;
  if(typeof id!=='string'||id.length>100||!['web-intake-pull','web-intake-ack','web-connect-prepare','web-connect-complete','web-connect-reset','web-delivery-config','web-session-ended'].includes(kind))return;
  void chrome.runtime.sendMessage({kind,accountId,libraryId,receipt}).then(result=>window.postMessage({channel:'sensa-web-intake-response',id,...result},location.origin)).catch(()=>window.postMessage({channel:'sensa-web-intake-response',id,error:'extension_unavailable'},location.origin));
 });
}
