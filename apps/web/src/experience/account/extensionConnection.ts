import {z} from 'zod';
import {auth} from '../../data/consumer/client';
const authorizationSchema=z.object({installationId:z.string().uuid(),state:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),redirectUri:z.string().regex(/^https:\/\/[a-p]{32}\.chromiumapp\.org\/sensa$/u)}).strict();
/** Exchange authority stays on the API; the Web forwards only a one-time code. */
export async function authorizeExtensionConnection(input:unknown,signal:AbortSignal,expectedSubject?:string){
 const request=authorizationSchema.parse(input);
 const session=(await auth?.getSession())?.data.session;
 if(!session||expectedSubject&&session.user.id!==expectedSubject)throw new Error('authentication_required');
 const response=await fetch(import.meta.env.VITE_SENSA_API_URL.replace(/\/+$/,'')+'/sensa/extension/authorize',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(request),signal,redirect:'error'});
 if(!response.ok)throw new Error('extension_connect_failed');
 const result=z.object({redirectUri:z.string().url()}).parse(await response.json());
 const destination=new URL(result.redirectUri);
 if(destination.origin+destination.pathname!==request.redirectUri||destination.searchParams.get('state')!==request.state||signal.aborted||(await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('authorization_invalid');
 return result;
}

export function notifyExtensionSignout(accountId?:string){if(accountId)window.postMessage({channel:'sensa-web-intake-request',id:crypto.randomUUID(),kind:'web-session-ended',accountId},location.origin);}
