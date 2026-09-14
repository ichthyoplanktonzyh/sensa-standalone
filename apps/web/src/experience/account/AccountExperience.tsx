import {AccountLibrarySync} from './AccountLibrarySync';
import {authorizeExtensionConnection,notifyExtensionSignout} from './extensionConnection';
import {eraseDeletedAccount} from '../../data/library/dataControl';
import {AccountDeletion,pendingAccountDeletion} from './AccountDeletion';
import {LanguageSwitch} from '../../i18n/LanguageSwitch';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {z} from 'zod';
import {ExtensionIntake} from './ExtensionIntake';
import {RemoteIntakeDelivery} from './RemoteIntakeDelivery';
import {LocalAgentIntake} from './LocalAgentIntake';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {clearAllCredentials} from '../../data/library/providers';
import {auth,cachedAuthSubject,authStorageKey} from '../../data/account/auth';
import {completeEmailLink,emailLinkRedirect} from '../../data/consumer/emailLink';
import {command,readLibrary,openLibrary,observeLibrary} from '../../data/library/store';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';

type Access={deleteAccount:()=>void;notice:string;email:string|null;onlineService:boolean;login:()=>void;logout:()=>Promise<void>};
const AccountContext=createContext<Access>({deleteAccount:()=>{},notice:'',email:null,onlineService:false,login:()=>{},logout:async()=>{}});
export const useAccountExperience=()=>useContext(AccountContext);
type Owner={subject:string;email:string;accountId?:string};
/** Authentication is an online-service boundary, not a consumer sync bootstrap. */
export default function AccountExperience({children}:{children:ReactNode}){
 useTranslation();
 const [deletionOpen,setDeletionOpen]=useState(()=>!!pendingAccountDeletion());const deletionRef=useRef(deletionOpen);deletionRef.current=deletionOpen;
 const [ready,setReady]=useState(false),[local,setLocal]=useState(false),[loginOpen,setLoginOpen]=useState(false),[onlineService,setOnlineService]=useState(false);
 const [webSession,setWebSession]=useState<'checking'|'present'|'absent'>('checking');
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[owner,setOwner]=useState<Owner|null>(null);
 const [retryAt,setRetryAt]=useState(0),[now,setNow]=useState(Date.now());
 const [useCode,setUseCode]=useState(false);const callbackDismissed=useRef(false);
 const observedAuth=useRef<{subject:string|null;token:string|null}|null>(null);
 const generation=useRef(0),localRef=useRef(false);localRef.current=local;
 const extension=new URLSearchParams(location.search),extensionRequest=extension.get('extension')==='connect';
 const recover=async()=>{
  if(deletionRef.current)return;
  const gen=++generation.current;
  try{
   const callback=await completeEmailLink();
   if(gen!==generation.current)return;
   if(callback==='failed'&&!callbackDismissed.current){setLocal(false);setNotice(localFlowText('emailLinkInvalid'));return;}
   const stored=await readLibrary(async tx=>({owner:await tx.get<Owner>('meta','service-owner'),identity:await tx.get('meta','identity'),signedOut:await tx.get<boolean>('meta','signed-out'),usable:!!(await tx.get<{revision:number}>('meta','cloud-sync'))?.revision||(await tx.all('drafts')).length>0||(await tx.all('packages')).length>0||(await tx.all('learningTargets')).length>0}));
   if(gen!==generation.current)return;
   setOwner(stored.owner??null);
   // Local access uses the already admitted owner. Refreshing an expired online
   // token may wait indefinitely offline; it must not hold the local library gate.
   const cachedSubject=cachedAuthSubject();
   if(stored.owner&&(cachedSubject===undefined||cachedSubject!==null&&cachedSubject!==stored.owner.subject)){
    setLocal(false);setNotice(localFlowText('accountUnreadable'));return;
   }
   if(stored.signedOut){setLocal(false);setReady(true);}
   else if(stored.owner&&stored.identity&&stored.usable){setLocal(true);if(!extensionRequest)setReady(true);}
   const session=(await auth?.getSession())?.data.session;
   if(gen!==generation.current)return;
   if(!session){setWebSession('absent');setOnlineService(false);setLocal(!!stored.identity&&stored.usable&&!stored.signedOut);return;}
   setWebSession('present');
   if(stored.owner&&stored.owner.subject!==session.user.id){setLocal(false);setNotice(localFlowText('wrongAccount'));return;}
   // A valid account session may open the local product before the online admission
   // request completes. The account id is added later and only gates online services.
   const provisional:Owner={...stored.owner,subject:session.user.id,email:session.user.email??stored.owner?.email??''};
   if(!stored.owner||stored.signedOut||stored.owner.email!==provisional.email)await command({id:crypto.randomUUID(),kind:'service.local-access',input:{subject:provisional.subject}},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(current&&current.subject!==provisional.subject)throw new Error('account mismatch');tx.put('meta','service-owner',provisional);tx.put('meta','signed-out',false);return null;});
   if(gen!==generation.current)return;
   await openLibrary();
   if(gen!==generation.current)return;
   setOwner(provisional);setLocal(true);if(!extensionRequest)setReady(true);setLoginOpen(false);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint){setNotice(localFlowText('onlineUnavailable'));return;}
   const installationId=await readLibrary(tx=>tx.get<string>('meta','service-installation'))??await command({id:crypto.randomUUID(),kind:'service.installation',input:{}},async tx=>{const existing=await tx.get<string>('meta','service-installation');if(existing)return existing;const id=crypto.randomUUID();tx.put('meta','service-installation',id);return id;});
   if(gen!==generation.current)return;
   const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/web/access/session',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({installationId}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(gen!==generation.current)return;
   if(!response.ok){setOnlineService(false);const failure=await response.json().catch(()=>({}));if(failure.code==='account_deleted'){await eraseDeletedAccount(session.user.id);setLocal(false);setNotice(localFlowText('deleteDone'));await auth?.signOut({scope:'local'});return;}setNotice(response.status===403?localFlowText('contactSupport'):localFlowText('serviceRetry'));return;}
   const access=z.object({authorized:z.literal(true),accountId:z.string().uuid()}).parse(await response.json());
   if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('account changed');
   if(gen!==generation.current)return;
   const next={subject:session.user.id,email:session.user.email??'',accountId:access.accountId};
   const currentOwner=await readLibrary(tx=>tx.get<Owner>('meta','service-owner'));
   if(currentOwner?.subject!==next.subject||currentOwner.accountId!==next.accountId||currentOwner.email!==next.email)await command({id:crypto.randomUUID(),kind:'service.connect',input:next},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(gen!==generation.current)throw new Error('stale login');if(current&&current.subject!==next.subject)throw new Error('account mismatch');tx.put('meta','service-owner',next);tx.put('meta','signed-out',false);return null;});
   if(gen!==generation.current)return;
   if(extensionRequest){
    const result=await authorizeExtensionConnection({installationId:extension.get('installationId'),state:extension.get('state'),challenge:extension.get('challenge'),redirectUri:extension.get('redirectUri')},AbortSignal.timeout(15000),next.subject);
    const destination=new URL(result.redirectUri);destination.searchParams.set('libraryId',(await openLibrary()).id);
    location.assign(destination.toString());return;
   }
   // The local library is the product authority. Account cloud restore is a background
   // adapter: a slow, failed or offline cloud copy must never hold the App Shell closed.
   // AccountLibrarySync runs the pass; status is available in account settings.
   setOwner(next);setLocal(true);setOnlineService(true);setLoginOpen(false);setNotice('');
  }catch{if(gen===generation.current)setNotice(localFlowText('networkRetry'));}
  finally{if(gen===generation.current)setReady(true);}
 };
 useEffect(()=>{void recover();const sub=auth?.onAuthStateChange((event,session)=>{
  if(deletionRef.current)return;
  const next={subject:session?.user.id??null,token:session?.access_token??null},previous=observedAuth.current;
  // Supabase also emits SIGNED_IN when a tab regains focus. It is not a logout
  // or a new account; tearing down the app here interrupts extension PKCE.
  if(previous?.subject===next.subject&&previous.token===next.token&&event!=='USER_UPDATED')return;
  observedAuth.current=next;
  if(event==='SIGNED_OUT'||previous&&previous.subject!==next.subject){generation.current++;clearAllCredentials();setWebSession(event==='SIGNED_OUT'?'absent':'checking');setOnlineService(false);setLocal(false);}
  setTimeout(()=>void recover(),0);
 });const online=()=>void recover();const storage=(event:StorageEvent)=>{if(event.key===null||event.key===authStorageKey)void recover();};window.addEventListener('online',online);window.addEventListener('storage',storage);const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{generation.current++;sub?.data.subscription.unsubscribe();window.removeEventListener('online',online);window.removeEventListener('storage',storage);clearInterval(timer);};},[]);
 useEffect(()=>observeLibrary(()=>{void readLibrary(async tx=>({signedOut:await tx.get('meta','signed-out')})).then(state=>{if(state.signedOut&&localRef.current){generation.current++;clearAllCredentials();setLocal(false);setOnlineService(false);}}).catch(()=>setNotice(localFlowText('localStatusFailed')));}),[]);
 const perform=async(work:()=>Promise<void>)=>{callbackDismissed.current=true;setBusy(true);setNotice('');try{await work();}catch{setNotice(localFlowText('tryLater'));}finally{setBusy(false);}};
 const send=async()=>{if(!auth)return;const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true,emailRedirectTo:emailLinkRedirect()}});if(error){setNotice(error.status===429?localFlowText('otpRateLimit'):localFlowText('emailLinkSendFailed'));return;}setSent(true);setRetryAt(Date.now()+60000);};
 const logout=async()=>{notifyExtensionSignout(owner?.accountId);clearAllCredentials();await command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);return null;});generation.current++;setLocal(false);setOnlineService(false);setLoginOpen(false);setSent(false);setCode('');setUseCode(false);const result=await auth?.signOut({scope:'local'});if(result?.error)setNotice(localFlowText('signoutIncomplete'));};
 if(deletionOpen)return <AccountDeletion onClose={()=>{location.assign('/profile');}}/>;
 if(!ready)return <main role="status" className="grid min-h-screen place-content-center">{localFlowText(extensionRequest?'extensionConnecting':'loadingSensa')}</main>;
 if(extensionRequest&&webSession==='present')return <main className="grid min-h-screen place-content-center gap-4 p-8 text-center"><p role="status">{notice?localFlowNotice(notice):localFlowText('extensionConnecting')}</p>{notice&&<div className="flex justify-center gap-2"><button className={setupPrimary} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('extensionRetry')}</button><button className={setupButton} onClick={()=>location.assign('/profile')}>{localFlowText('cancel')}</button></div>}</main>;
 if(local&&!loginOpen&&extension.get('extension')!=='connect')return <AccountContext.Provider value={{deleteAccount:()=>{generation.current++;setDeletionOpen(true);},notice:localFlowNotice(notice),email:owner?.email??null,onlineService,login:()=>setLoginOpen(true),logout:()=>perform(logout)}}><AccountLibrarySync online={onlineService}/><LocalAgentIntake/>{onlineService&&<RemoteIntakeDelivery online/>}{owner?.accountId&&<ExtensionIntake accountId={owner.accountId} onlineService={onlineService}/>} {children}</AccountContext.Provider>;
 // Default Supabase templates send links; custom OTP templates remain supported.
 return <main className="flex min-h-screen items-center justify-center bg-[#fbfbfa] px-6 text-[#242a38]"><form className="w-full max-w-sm space-y-5" onSubmit={e=>{e.preventDefault();void perform(sent?useCode?async()=>{const result=await auth!.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});if(result.error){setNotice(localFlowText('otpInvalid'));return;}await recover();}:recover:send);}}>
  <div className="flex items-center justify-between"><p className="text-sm text-[#68748d]">Sensa</p><LanguageSwitch/></div><h1 className="text-3xl font-semibold">{sent?localFlowText(useCode?'enterOtp':'checkEmailLink'):localFlowText('welcome')}</h1>
  <p className="text-sm leading-6">{sent?localFlowText(useCode?'otpSent':'emailLinkSent',{email}):localFlowText('loginIntro')}</p>
  {!auth?<p role="status">{localFlowText('loginUnavailable')}</p>:<>{sent?useCode&&<label className="block text-sm">{localFlowText('otp')}<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={e=>setCode(e.target.value)} required/></label>:<label className="block text-sm">{localFlowText('email')}<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>}{(!sent||useCode)&&<button className={setupPrimary+' w-full'} disabled={busy}>{busy?localFlowText('processing'):sent?localFlowText('verify'):localFlowText('sendEmailLink')}</button>}</>}
  {notice&&<p role="status">{localFlowNotice(notice)}</p>}
  {sent&&<div className="flex flex-wrap gap-2"><button type="button" className={setupButton} disabled={busy||now<retryAt} onClick={()=>void perform(send)}>{now<retryAt?localFlowText('resendLater'):localFlowText('resend')}</button><button type="button" className={setupButton} disabled={busy} onClick={()=>{setSent(false);setCode('');setUseCode(false);}}>{localFlowText('changeEmail')}</button>{!useCode&&<button type="button" className={setupButton} disabled={busy} onClick={()=>setUseCode(true)}>{localFlowText('useEmailCode')}</button>}</div>}
  <button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('checkLogin')}</button>
  {owner&&<button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(logout)}>{localFlowText('switchAccount')}</button>}
  {local&&extension.get('extension')!=='connect'&&<button type="button" className={setupButton} onClick={()=>setLoginOpen(false)}>{localFlowText('continueLocal')}</button>}
 </form></main>;
}
