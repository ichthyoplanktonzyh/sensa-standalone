import {auth} from '../account/auth';

const callbackKeys=['code','error','error_code','error_description','access_token','refresh_token','expires_in','expires_at','token_type','type'];

/** Preserve the current in-app destination, including an extension handoff. */
export function emailLinkRedirect():string {
 const url=new URL(window.location.href);
 for(const key of callbackKeys)url.searchParams.delete(key);
 url.hash='';
 return url.toString();
}

type CallbackResult='none'|'signed-in'|'failed';
let completion:Promise<CallbackResult>|undefined;
let callbackSignoutEpoch:string|null|undefined;
export const emailLinkSignoutEpoch=()=>callbackSignoutEpoch;
/** One exchange per page, including StrictMode and concurrent recovery events.
 * The SDK validates the browser's PKCE verifier; URL tokens are never trusted.
 */
export function completeEmailLink(signoutEpoch?:string|null):Promise<CallbackResult> {
 if(!completion){callbackSignoutEpoch=signoutEpoch;completion=consumeCallback();}
 return completion;
}

async function consumeCallback():Promise<CallbackResult> {
 const url=new URL(window.location.href),fragment=new URLSearchParams(url.hash.slice(1));
 const code=url.searchParams.get('code');
 const failed=['error','error_code','access_token','refresh_token'].some(key=>url.searchParams.has(key)||fragment.has(key));
 if(!url.searchParams.has('code')&&!failed)return 'none';
 // Remove credentials and provider error text before rendering or making requests.
 for(const key of callbackKeys){url.searchParams.delete(key);fragment.delete(key);}
 url.hash=fragment.toString();
 window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 if(failed||!code||code.length>2048||!auth)return 'failed';
 try {
  const {data,error}=await auth.exchangeCodeForSession(code);
  return error||!data.session?'failed':'signed-in';
 }catch{return 'failed';}
}
