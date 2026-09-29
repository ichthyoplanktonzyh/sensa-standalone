import {pendingAccountDeletion} from './accountDeletionState';
import '../../i18n/accountResources';
import {LanguageSwitch} from '../../i18n/LanguageSwitch';
import {useTranslation} from 'react-i18next';
import {localFlowErrorKey,localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {z} from 'zod';
import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {auth,cachedAuthSubject,authStorageKey} from '../../data/account/auth';
import {completeEmailLink,emailLinkRedirect} from '../../data/consumer/emailLink';
import {command,readLibrary,openLibrary,observeLibrary,type LibraryTransaction} from '../../data/library/store';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {SensaLogo} from '../brand/SensaLogo';
import type {LibraryAvailability} from './AccountLibrarySync';
import {AccountContext,type AccountAccess} from './AccountContext';

const AccountLibrarySync=lazy(()=>import('./AccountLibrarySync').then(module=>({default:module.AccountLibrarySync})));
const ExtensionIntake=lazy(()=>import('./ExtensionIntake').then(module=>({default:module.ExtensionIntake})));
const RemoteIntakeDelivery=lazy(()=>import('./RemoteIntakeDelivery').then(module=>({default:module.RemoteIntakeDelivery})));
const AccountDeletion=lazy(()=>import('./AccountDeletion').then(module=>({default:module.AccountDeletion})));
const preloadMedia=()=>import('../personalMeaningJourney/mediaStore').then(module=>module.preloadMedia());
const clearAllCredentials=()=>import('../../data/library/providers').then(module=>module.clearAllCredentials());

type Owner={subject:string;email:string;accountId?:string};
/** Authentication is an online-service boundary, not a consumer sync bootstrap. */
export default function AccountExperience({children,onReturnToLanding}:{children:ReactNode;onReturnToLanding?:()=>void}){
 const {t}=useTranslation();
 const [deletionOpen,setDeletionOpen]=useState(()=>!!pendingAccountDeletion());const deletionRef=useRef(deletionOpen);deletionRef.current=deletionOpen;
 const [ready,setReady]=useState(false),[local,setLocal]=useState(false),[loginOpen,setLoginOpen]=useState(false),[onlineService,setOnlineService]=useState(false),[connectionConflict,setConnectionConflict]=useState(false);
 const [publisherAccess,setPublisherAccess]=useState(false);
 const [libraryAvailability,setLibraryAvailability]=useState<LibraryAvailability>('restoring');
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
  let needsInitialRestore=false,guestAttempt=false;
  let recheckGuestContent:((tx:LibraryTransaction)=>Promise<boolean>)|undefined;
  try{
   const callback=await completeEmailLink();
   if(gen!==generation.current)return;
   if(callback==='failed'&&!callbackDismissed.current)setNotice(localFlowText('emailLinkInvalid'));
   const session=(await auth?.getSession())?.data.session;
   if(gen!==generation.current)return;
   const cachedSubject=cachedAuthSubject();
   const inspect=()=>readLibrary(async tx=>{const checkpoint=await tx.get<{status?:string}>('meta','cloud-sync');return {owner:await tx.get<Owner>('meta','service-owner'),identity:await tx.get('meta','identity'),signedOut:await tx.get<boolean>('meta','signed-out'),usable:checkpoint?.status==='synced'||!!(await tx.get('semanticState','root'))||await tx.count('drafts')>0||await tx.count('packageInstallations')>0||await tx.count('learningTargets')>0};});
   let stored=await inspect();
   if(!stored.identity&&!stored.owner){await openLibrary();stored=await inspect();}
   if(gen!==generation.current)return;
   if(stored.identity)await preloadMedia();
   if(gen!==generation.current)return;
   setOwner(stored.owner??null);
   // Local access uses the already admitted owner. Refreshing an expired online
   // token may wait indefinitely offline; it must not hold the local library gate.
   if(stored.owner&&(cachedSubject===undefined||cachedSubject!==null&&cachedSubject!==stored.owner.subject)){
    setLocal(false);setNotice(localFlowText('accountUnreadable'));return;
   }
   if(stored.identity&&!extensionRequest){setLibraryAvailability(session&&!stored.usable?'restoring':!stored.owner||stored.usable?'authoritative':'restoring');setLocal(true);setReady(true);}
   if(!session){setWebSession('absent');setOnlineService(false);setPublisherAccess(false);setConnectionConflict(false);setLoginOpen(false);return;}
   setWebSession('present');
   if(stored.owner&&stored.owner.subject!==session.user.id){setLocal(false);setNotice(localFlowText('wrongAccount'));return;}
   // A valid account session may open the local product before the online admission
   // request completes. The account id is added later and only gates online services.
   const provisional:Owner={...stored.owner,subject:session.user.id,email:session.user.email??stored.owner?.email??''};
   needsInitialRestore=!stored.usable;
   setLibraryAvailability(needsInitialRestore?'restoring':'authoritative');
   let guestAdmission:{accountId:string;installationId:string;publisherAccess:boolean}|undefined;
   if(!stored.owner){
    guestAttempt=true;
    const endpoint=import.meta.env.VITE_SENSA_API_URL;
    if(!endpoint){setLibraryAvailability('authoritative');setNotice(localFlowText('onlineUnavailable'));setLoginOpen(false);return;}
    const installationId=await readLibrary(tx=>tx.get<string>('meta','service-installation'))??crypto.randomUUID();
    const guestConnection=await import('./guestLibraryConnection');
    const admission=await guestConnection.preflightGuestLibrary(endpoint,session.access_token,installationId);
    if(gen!==generation.current)return;
    if(admission.kind!=='ready'){setLibraryAvailability('authoritative');setNotice(localFlowText(admission.kind==='access-failed'&&admission.status===403?'contactSupport':'serviceRetry'));setLoginOpen(false);return;}
    if(admission.cloudHasContent&&admission.localHasContent){setLibraryAvailability('authoritative');setConnectionConflict(true);setNotice(localFlowText('accountLibraryConflict'));setLoginOpen(false);return;}
    if(admission.cloudHasContent)recheckGuestContent=guestConnection.hasGuestLibraryContent;
    setConnectionConflict(false);
    setLibraryAvailability(admission.cloudHasContent&&!admission.localHasContent?'restoring':'authoritative');
    guestAdmission={accountId:admission.accountId,installationId,publisherAccess:admission.publisherAccess};
   }
   if(!stored.owner||stored.signedOut||stored.owner.email!==provisional.email)await command({id:crypto.randomUUID(),kind:'service.local-access',input:{subject:provisional.subject}},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(current&&current.subject!==provisional.subject)throw new Error('account mismatch');if(recheckGuestContent&&await recheckGuestContent(tx))throw new Error('localFlow.accountLibraryConflict');tx.put('meta','service-owner',provisional);tx.put('meta','signed-out',false);return null;});
   if(gen!==generation.current)return;
   await openLibrary();
   if(gen!==generation.current)return;
   await preloadMedia();
   if(gen!==generation.current)return;
   setOwner(provisional);setLocal(true);if(!extensionRequest)setReady(true);setLoginOpen(false);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint){if(needsInitialRestore)setLibraryAvailability('failed');setNotice(localFlowText('onlineUnavailable'));return;}
   const installationId=await readLibrary(tx=>tx.get<string>('meta','service-installation'))??await command({id:crypto.randomUUID(),kind:'service.installation',input:{}},async tx=>{const existing=await tx.get<string>('meta','service-installation');if(existing)return existing;const id=guestAdmission?.installationId??crypto.randomUUID();tx.put('meta','service-installation',id);return id;});
   if(gen!==generation.current)return;
   let access:{authorized:true;accountId:string;capabilities?:{publishLearningContent:boolean}};
   if(guestAdmission)access={authorized:true,accountId:guestAdmission.accountId,capabilities:{publishLearningContent:guestAdmission.publisherAccess}};
   else{
    const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/web/access/session',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({installationId}),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(gen!==generation.current)return;
    if(!response.ok){setOnlineService(false);if(needsInitialRestore)setLibraryAvailability('failed');const failure=await response.json().catch(()=>({}));if(failure.code==='account_deleted'){await import('../../data/library/dataControl').then(module=>module.eraseDeletedAccount(session.user.id));setLocal(false);setNotice(localFlowText('deleteDone'));await auth?.signOut({scope:'local'});return;}setNotice(response.status===403?localFlowText('contactSupport'):localFlowText('serviceRetry'));return;}
    access=z.object({
     authorized:z.literal(true),
     accountId:z.string().uuid(),
     capabilities:z.object({publishLearningContent:z.boolean()}).optional(),
    }).parse(await response.json());
   }
   if((await auth?.getSession())?.data.session?.user.id!==session.user.id)throw new Error('account changed');
   if(gen!==generation.current)return;
   const next={subject:session.user.id,email:session.user.email??'',accountId:access.accountId};
   const currentOwner=await readLibrary(tx=>tx.get<Owner>('meta','service-owner'));
   if(currentOwner?.subject!==next.subject||currentOwner.accountId!==next.accountId||currentOwner.email!==next.email)await command({id:crypto.randomUUID(),kind:'service.connect',input:next},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(gen!==generation.current)throw new Error('stale login');if(current&&current.subject!==next.subject)throw new Error('account mismatch');tx.put('meta','service-owner',next);tx.put('meta','signed-out',false);return null;});
   if(gen!==generation.current)return;
   if(extensionRequest){
    const result=await import('./extensionConnection').then(module=>module.authorizeExtensionConnection({installationId:extension.get('installationId'),state:extension.get('state'),challenge:extension.get('challenge'),redirectUri:extension.get('redirectUri')},AbortSignal.timeout(15000),next.subject));
    const destination=new URL(result.redirectUri);destination.searchParams.set('libraryId',(await openLibrary()).id);
    location.assign(destination.toString());return;
   }
   // The local library remains the mutation authority, while an empty device keeps
   // summary projections unknown until its first account restore settles. The App
   // Shell stays open throughout; AccountLibrarySync advances that availability.
   setOwner(next);setLocal(true);setOnlineService(true);setPublisherAccess(access.capabilities?.publishLearningContent??false);setConnectionConflict(false);setLoginOpen(false);setNotice('');
  }catch(cause){if(gen===generation.current){if(needsInitialRestore)setLibraryAvailability(guestAttempt?'authoritative':'failed');if(cause instanceof Error&&cause.message==='localFlow.accountLibraryConflict'){setConnectionConflict(true);setLoginOpen(false);}setNotice(localFlowErrorKey(cause,'localFlow.networkRetry'));}}
  finally{if(gen===generation.current)setReady(true);}
 };
 useEffect(()=>{void recover();const sub=auth?.onAuthStateChange((event,session)=>{
  if(deletionRef.current)return;
  const next={subject:session?.user.id??null,token:session?.access_token??null},previous=observedAuth.current;
  // Supabase also emits SIGNED_IN when a tab regains focus. It is not a logout
  // or a new account; tearing down the app here interrupts extension PKCE.
  if(previous?.subject===next.subject&&previous.token===next.token&&event!=='USER_UPDATED')return;
  observedAuth.current=next;
  if(event==='SIGNED_OUT'||previous&&previous.subject!==next.subject){generation.current++;void clearAllCredentials();setWebSession(event==='SIGNED_OUT'?'absent':'checking');setOnlineService(false);setPublisherAccess(false);setLocal(false);}
  setTimeout(()=>void recover(),0);
 });const online=()=>void recover();const storage=(event:StorageEvent)=>{if(event.key===null||event.key===authStorageKey)void recover();};window.addEventListener('online',online);window.addEventListener('storage',storage);return()=>{generation.current++;sub?.data.subscription.unsubscribe();window.removeEventListener('online',online);window.removeEventListener('storage',storage);};},[]);
 useEffect(()=>{if(!sent||now>=retryAt)return;const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(0,retryAt-Date.now())+20);return()=>window.clearTimeout(timer);},[now,retryAt,sent]);
 useEffect(()=>observeLibrary(()=>{void readLibrary(async tx=>({signedOut:await tx.get('meta','signed-out')})).then(state=>{if(state.signedOut&&localRef.current){void clearAllCredentials();setOnlineService(false);}}).catch(()=>setNotice(localFlowText('localStatusFailed')));},['meta']),[]);
 const perform=useCallback(async(work:()=>Promise<void>)=>{callbackDismissed.current=true;setBusy(true);setNotice('');try{await work();}catch{setNotice(localFlowText('tryLater'));}finally{setBusy(false);}},[]);
 const send=async()=>{if(!auth)return;const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true,emailRedirectTo:emailLinkRedirect()}});if(error){setNotice(error.status===429?localFlowText('otpRateLimit'):localFlowText('emailLinkSendFailed'));return;}setSent(true);setRetryAt(Date.now()+60000);};
 const logout=useCallback(async()=>{const extensionModule=await import('./extensionConnection');extensionModule.notifyExtensionSignout(owner?.accountId);await clearAllCredentials();await command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);return null;});generation.current++;setLocal(false);setOnlineService(false);setPublisherAccess(false);setLoginOpen(false);setSent(false);setCode('');setUseCode(false);const result=await auth?.signOut({scope:'local'});if(result?.error)setNotice(localFlowText('signoutIncomplete'));},[owner?.accountId]);
 const updateLibraryAvailability=useCallback((value:LibraryAvailability)=>setLibraryAvailability(current=>current==='authoritative'?current:value),[]);
 const accountAccess=useMemo<AccountAccess>(()=>({
  deleteAccount:()=>{generation.current++;setDeletionOpen(true);},
  notice:localFlowNotice(notice),
  email:owner?.email??null,
  onlineService,
  publisherAccess,
  connectionConflict,
  libraryAvailability,
  login:()=>setLoginOpen(true),
  logout:()=>perform(logout),
 }),[notice,onlineService,publisherAccess,connectionConflict,libraryAvailability,owner?.email,perform,logout]);
 if(deletionOpen)return <Suspense fallback={<main role="status">{localFlowText('loadingSensa')}</main>}><AccountDeletion onClose={()=>{location.assign('/profile');}}/></Suspense>;
 if(!ready)return <main role="status" className="grid min-h-screen place-content-center">{localFlowText(extensionRequest?'extensionConnecting':'loadingSensa')}</main>;
 if(extensionRequest&&webSession==='present')return <main className="grid min-h-screen place-content-center gap-4 p-8 text-center"><p role="status">{notice?localFlowNotice(notice):localFlowText('extensionConnecting')}</p>{notice&&<div className="flex justify-center gap-2"><button className={setupPrimary} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('extensionRetry')}</button><button className={setupButton} onClick={()=>location.assign('/profile')}>{localFlowText('cancel')}</button></div>}</main>;
 if(local&&!loginOpen&&extension.get('extension')!=='connect')return <AccountContext.Provider value={accountAccess}><Suspense fallback={null}>{onlineService&&<AccountLibrarySync online onAvailabilityChange={updateLibraryAvailability}/>}{onlineService&&<RemoteIntakeDelivery online/>}<ExtensionIntake accountId={owner?.accountId??null} onlineService={onlineService}/></Suspense>{children}</AccountContext.Provider>;
 // Default Supabase templates send links; custom OTP templates remain supported.
 return <main className="sensa-account-entry flex min-h-screen items-center justify-center bg-surface-canvas px-6 font-product text-fg-primary"><form className="w-full max-w-sm space-y-5" onSubmit={e=>{e.preventDefault();void perform(sent?useCode?async()=>{const result=await auth!.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});if(result.error){setNotice(localFlowText('otpInvalid'));return;}await recover();}:recover:send);}}>
  <div className="flex items-center justify-between"><SensaLogo/><LanguageSwitch/></div><h1 className="text-3xl font-semibold">{sent?localFlowText(useCode?'enterOtp':'checkEmailLink'):localFlowText('welcome')}</h1>
  <p className="text-sm leading-6">{sent?localFlowText(useCode?'otpSent':'emailLinkSent',{email}):localFlowText('loginIntro')}</p>
  {!auth?<p role="status">{localFlowText('loginUnavailable')}</p>:<>{sent?useCode&&<label className="block text-sm">{localFlowText('otp')}<input className="mt-2 w-full rounded-control border border-border-strong bg-surface-panel p-3 text-fg-primary focus-visible:outline-2 focus-visible:outline-focus" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={e=>setCode(e.target.value)} required/></label>:<label className="block text-sm">{localFlowText('email')}<input className="mt-2 w-full rounded-control border border-border-strong bg-surface-panel p-3 text-fg-primary focus-visible:outline-2 focus-visible:outline-focus" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>}{(!sent||useCode)&&<button className={setupPrimary+' w-full'} disabled={busy}>{busy?localFlowText('processing'):sent?localFlowText('verify'):localFlowText('sendEmailLink')}</button>}</>}
  {notice&&<p role="status">{localFlowNotice(notice)}</p>}
  {sent&&<div className="flex flex-wrap gap-2"><button type="button" className={setupButton} disabled={busy||now<retryAt} onClick={()=>void perform(send)}>{now<retryAt?localFlowText('resendLater'):localFlowText('resend')}</button><button type="button" className={setupButton} disabled={busy} onClick={()=>{setSent(false);setCode('');setUseCode(false);}}>{localFlowText('changeEmail')}</button>{!useCode&&<button type="button" className={setupButton} disabled={busy} onClick={()=>setUseCode(true)}>{localFlowText('useEmailCode')}</button>}</div>}
  <button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('checkLogin')}</button>
  {owner&&<button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(logout)}>{localFlowText('switchAccount')}</button>}
  {local&&extension.get('extension')!=='connect'&&<button type="button" className={setupButton} onClick={()=>setLoginOpen(false)}>{localFlowText('continueLocal')}</button>}
  {!local&&!sent&&(location.pathname==='/'||location.pathname==='/welcome')&&onReturnToLanding&&<button type="button" className={setupButton} onClick={onReturnToLanding}>{t('landing.back')}</button>}
 </form></main>;
}
