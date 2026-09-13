import {sensaExtensionAuthorizationSchema,sensaExtensionAuthorizeResultSchema,sensaBridgeRequestChannel,type SensaBridgeRequestOf} from '@sensa/contracts/sensa';
import {auth} from '../../data/account/auth';
/** Exchange authority stays on the API; the Web forwards only a one-time code.
 * Both ends of this wire read the shapes from the contracts, so the request the
 * Web sends and the request the API accepts cannot be two different things. */
export async function authorizeExtensionConnection(input:unknown,signal:AbortSignal,expectedSubject?:string){
 const request=sensaExtensionAuthorizationSchema.parse(input);
 const session=(await auth?.getSession())?.data.session;
 if(!session||expectedSubject&&session.user.id!==expectedSubject)throw new Error('authentication_required');
 const response=await fetch(import.meta.env.VITE_SENSA_API_URL.replace(/\/+$/,'')+'/sensa/extension/authorize',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(request),signal,redirect:'error'});
 if(!response.ok)throw new Error('extension_connect_failed');
 const result=sensaExtensionAuthorizeResultSchema.parse(await response.json());
 const destination=new URL(result.redirectUri);
 if(destination.origin+destination.pathname!==request.redirectUri||destination.searchParams.get('state')!==request.state||signal.aborted||(await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('authorization_invalid');
 return result;
}

/** Signing out is account-scoped and fire-and-forget: the page names its account
 * and nothing else, because ending the connection is not a use of a library. */
export function notifyExtensionSignout(accountId?:string){
 if(!accountId)return;
 const signOut:SensaBridgeRequestOf<'web-session-ended'>={channel:sensaBridgeRequestChannel,id:crypto.randomUUID(),kind:'web-session-ended',accountId};
 window.postMessage(signOut,location.origin);
}
