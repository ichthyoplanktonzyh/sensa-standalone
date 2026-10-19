import {pendingAccountDeletion} from './accountDeletionState';
import '../../i18n/accountResources';
import {LanguageSwitch} from '../../i18n/LanguageSwitch';
import {useTranslation} from 'react-i18next';
import {localFlowErrorKey,localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {z} from 'zod';
import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {auth,cachedAuthSubject,authStorageKey} from '../../data/account/auth';
import {accountSignoutEpoch,accountSignoutEpochKey,readAccountSignoutEpoch} from '../../data/account/accountSessionBoundary';
import {completeEmailLink,emailLinkRedirect,emailLinkSignoutEpoch} from '../../data/consumer/emailLink';
import {command,readLibrary,openLibrary,observeLibrary,type LibraryTransaction} from '../../data/library/store';
import {hasLocalLibraryHint} from '../../data/library/localLibraryHint';
import {hasLocalLibrarySelection} from '../../data/library/localLibraryLocation';
import {hasGuestLibraryContent} from './guestLibraryConnection';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {SensaLogo} from '../brand/SensaLogo';
import type {LibraryAvailability} from './AccountLibrarySync';
import {AccountContext,type AccountAccess} from './AccountContext';

const AccountLibrarySync=lazy(()=>import('./AccountLibrarySync').then(module=>({default:module.AccountLibrarySync})));
const ExtensionIntake=lazy(()=>import('./ExtensionIntake').then(module=>({default:module.ExtensionIntake})));
const RemoteIntakeDelivery=lazy(()=>import('./RemoteIntakeDelivery').then(module=>({default:module.RemoteIntakeDelivery})));
const AccountDeletion=lazy(()=>import('./AccountDeletion').then(module=>({default:module.AccountDeletion})));
const LocalLibraryRecovery=lazy(()=>import('./LocalLibraryRecovery'));
const preloadMedia=()=>import('../personalMeaningJourney/mediaStore').then(module=>module.preloadMedia());
const warmMedia=()=>{void preloadMedia().catch(()=>undefined);};
const clearAllCredentials=()=>import('../../data/library/providers').then(module=>module.clearAllCredentials());

type Owner={subject:string;email:string;accountId?:string};
const storageRecoveryCodes=new Set(['localFlow.storageOpen','localFlow.storageWrite','localFlow.storageFull','localFlow.storageBusy','localFlow.storageUnsupported','localFlow.storageUnavailable']);
/** Authentication is an online-service boundary, not a consumer sync bootstrap. */
export default function AccountExperience({children,onReturnToLanding}:{children:ReactNode;onReturnToLanding?:()=>void}){
 const {t}=useTranslation();
 const [deletionOpen,setDeletionOpen]=useState(()=>{const pending=pendingAccountDeletion();return !!pending&&!pending.dismissed;});const deletionRef=useRef(deletionOpen);deletionRef.current=deletionOpen;
 const [ready,setReady]=useState(false),[local,setLocal]=useState(false),[loginOpen,setLoginOpen]=useState(false),[onlineService,setOnlineService]=useState(false),[connectionConflict,setConnectionConflict]=useState(false);
 const [publisherAccess,setPublisherAccess]=useState(false);
 const [libraryMissing,setLibraryMissing]=useState(false);
 const [libraryAvailability,setLibraryAvailability]=useState<LibraryAvailability>('restoring');
 const [webSession,setWebSession]=useState<'checking'|'present'|'absent'>('checking');
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[owner,setOwner]=useState<Owner|null>(null);
 const [retryAt,setRetryAt]=useState(0),[now,setNow]=useState(Date.now());
 const codeInput=useRef<HTMLInputElement>(null);
 const callbackDismissed=useRef(false);
 const observedAuth=useRef<{subject:string|null;token:string|null}|null>(null);
 const generation=useRef(0),localRef=useRef(false);localRef.current=local;
 const checkingConnection=useRef(false);
 const explicitSignIn=useRef<string|null|undefined>(undefined),callbackAccepted=useRef(false);
 const observedSignoutEpoch=useRef<string|null|undefined>(undefined);
 const extension=new URLSearchParams(location.search),extensionRequest=extension.get('extension')==='connect';
 const recover=async(freshSignIn?:{epoch:string|null})=>{
  if(deletionRef.current)return;
  const gen=++generation.current;
  let needsInitialRestore=false,guestAttempt=false;
  let usableLocalFacts=false;
  let recheckGuestContent:((tx:LibraryTransaction)=>Promise<boolean>)|undefined;
  try{
   const entryEpoch=await accountSignoutEpoch();
   if(gen!==generation.current)return;
   if(observedSignoutEpoch.current===undefined)observedSignoutEpoch.current=entryEpoch;
   const callback=await completeEmailLink(entryEpoch);
   if(gen!==generation.current)return;
   if(callback==='signed-in'&&!callbackAccepted.current){callbackAccepted.current=true;explicitSignIn.current=emailLinkSignoutEpoch();}
   if(freshSignIn)explicitSignIn.current=freshSignIn.epoch;
   if(callback==='failed'&&!callbackDismissed.current)setNotice(localFlowText('emailLinkInvalid'));
   const cachedSubject=cachedAuthSubject();
   const inspect=()=>readLibrary(async tx=>{const checkpoint=await tx.get<{status?:string}>('meta','cloud-sync');return {owner:await tx.get<Owner>('meta','service-owner'),identity:await tx.get('meta','identity'),signedOut:await tx.get<boolean>('meta','signed-out'),epoch:await readAccountSignoutEpoch(tx),usable:checkpoint?.status==='synced'||await tx.get('meta','local-reset')==='local-clear'||await hasGuestLibraryContent(tx)};});
   let stored=await inspect();
   if(!stored.identity){await openLibrary();stored=await inspect();}
   setLibraryMissing(false);
   usableLocalFacts=stored.usable;
   if(gen!==generation.current)return;
   if(stored.identity)warmMedia();
   if(gen!==generation.current)return;
   setOwner(stored.owner??null);
   // Local access uses the already admitted owner. Refreshing an expired online
   // token may wait indefinitely offline; it must not hold the local library gate.
   if(stored.owner&&(cachedSubject===undefined||cachedSubject!==null&&cachedSubject!==stored.owner.subject)){
    const session=(await auth?.getSession())?.data.session;if(gen!==generation.current)return;setWebSession(session?'present':'absent');setLocal(false);setNotice(localFlowText('accountUnreadable'));return;
   }
   const staysSignedOut=stored.signedOut&&(explicitSignIn.current===undefined||explicitSignIn.current!==stored.epoch);
   if(stored.identity&&!extensionRequest&&(stored.usable||staysSignedOut)){
    await openLibrary();if(gen!==generation.current)return;
    setLibraryAvailability('authoritative');setLocal(true);setReady(true);
   }
   if(staysSignedOut){setOnlineService(false);setPublisherAccess(false);setConnectionConflict(false);setLoginOpen(extensionRequest);if(extensionRequest)setNotice(localFlowText('onlineLogin'));return;}
   const session=(await auth?.getSession())?.data.session;
   if(gen!==generation.current)return;
   setWebSession(session?'present':'absent');
   if(stored.identity&&!extensionRequest){setLibraryAvailability(session&&!stored.usable?'restoring':!stored.owner||stored.usable?'authoritative':'restoring');setLocal(true);setReady(true);}
   if(!session){setWebSession('absent');setOnlineService(false);setPublisherAccess(false);setConnectionConflict(false);setLoginOpen(false);return;}
   if(stored.owner&&stored.owner.subject!==session.user.id){setLocal(false);setNotice(localFlowText('wrongAccount'));return;}
   // A pending/failed remote signout cannot undo the locally committed choice.
   // Only a validated new email callback or OTP explicitly reconnects it.
   // A valid account session may open the local product before the online admission
   // request completes. The account id is added later and only gates online services.
   const provisional:Owner={...stored.owner,subject:session.user.id,email:session.user.email??stored.owner?.email??''};
   needsInitialRestore=!stored.usable;
   setLibraryAvailability(needsInitialRestore?'restoring':'authoritative');
   let guestAdmission:{accountId:string;installationId:string;publisherAccess:boolean}|undefined;
   if(!stored.owner){
    guestAttempt=true;
    const endpoint=import.meta.env.VITE_SENSA_API_URL;
    if(!endpoint){setLibraryAvailability(usableLocalFacts?'authoritative':'failed');setNotice(localFlowText('onlineUnavailable'));setLoginOpen(false);return;}
    const installationId=await readLibrary(tx=>tx.get<string>('meta','service-installation'))??crypto.randomUUID();
    const guestConnection=await import('./guestLibraryConnection');
    const admission=await guestConnection.preflightGuestLibrary(endpoint,session.access_token,installationId);
    if(gen!==generation.current)return;
    if(admission.kind!=='ready'){setLibraryAvailability(usableLocalFacts?'authoritative':'failed');setNotice(localFlowText(admission.kind==='access-failed'&&admission.status===403?'contactSupport':'serviceRetry'));setLoginOpen(false);return;}
    if(admission.cloudHasContent&&admission.localHasContent){setLibraryAvailability('authoritative');setConnectionConflict(true);setNotice(localFlowText('accountLibraryConflict'));setLoginOpen(false);return;}
    if(admission.cloudHasContent)recheckGuestContent=guestConnection.hasGuestLibraryContent;
    setConnectionConflict(false);
    setLibraryAvailability(admission.cloudHasContent&&!admission.localHasContent?'restoring':'authoritative');
    guestAdmission={accountId:admission.accountId,installationId,publisherAccess:admission.publisherAccess};
   }
   if(!stored.owner||stored.signedOut||stored.owner.email!==provisional.email)await command({id:crypto.randomUUID(),kind:'service.local-access',input:{subject:provisional.subject}},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(gen!==generation.current||await readAccountSignoutEpoch(tx)!==stored.epoch)throw Error('stale login');if(current&&current.subject!==provisional.subject)throw new Error('account mismatch');if(recheckGuestContent&&await recheckGuestContent(tx))throw new Error('localFlow.accountLibraryConflict');tx.put('meta','service-owner',provisional);tx.put('meta','signed-out',false);return null;});
   explicitSignIn.current=undefined;
   if(gen!==generation.current)return;
   await openLibrary();
   if(gen!==generation.current)return;
   warmMedia();
   if(gen!==generation.current)return;
   setOwner(provisional);setLocal(true);if(!extensionRequest)setReady(true);setLoginOpen(false);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint){if(needsInitialRestore)setLibraryAvailability('failed');setNotice(localFlowText('onlineUnavailable'));return;}
   const installationId=await readLibrary(tx=>tx.get<string>('meta','service-installation'))??await command({id:crypto.randomUUID(),kind:'service.installation',input:{}},async tx=>{const existing=await tx.get<string>('meta','service-installation');if(existing)return existing;const id=guestAdmission?.installationId??crypto.randomUUID();tx.put('meta','service-installation',id);return id;});
   if(gen!==generation.current)return;
   let access:{authorized:true;accountId:string;capabilities?:{publishLearningContent:boolean}};
   if(guestAdmission)access={authorized:true,accountId:guestAdmission.accountId,capabilities:{publishLearningContent:guestAdmission.publisherAccess}};
   else{
    const deletionScope=await import('../../data/library/dataControl').then(module=>module.accountDeletionLocalScope(session.user.id));
    const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/web/access/session',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({installationId}),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(gen!==generation.current)return;
    if(!response.ok){setOnlineService(false);if(needsInitialRestore)setLibraryAvailability('failed');const failure=await response.json().catch(()=>({}));if(failure.code==='account_deleted'){await import('../../data/library/dataControl').then(module=>module.eraseDeletedAccount(session.user.id,deletionScope));if(gen!==generation.current)return;setLocal(false);setNotice(localFlowText('deleteDone'));return;}setNotice(response.status===403?localFlowText('contactSupport'):localFlowText('serviceRetry'));return;}
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
   if(currentOwner?.subject!==next.subject||currentOwner.accountId!==next.accountId||currentOwner.email!==next.email)await command({id:crypto.randomUUID(),kind:'service.connect',input:next},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(gen!==generation.current||await readAccountSignoutEpoch(tx)!==stored.epoch||await tx.get('meta','signed-out'))throw new Error('stale login');if(current&&current.subject!==next.subject)throw new Error('account mismatch');tx.put('meta','service-owner',next);tx.put('meta','signed-out',false);return null;});
   const signedOut=await readLibrary(async tx=>await tx.get('meta','signed-out')||await readAccountSignoutEpoch(tx)!==stored.epoch);
   if(signedOut)return;
   if(gen!==generation.current)return;
   if(extensionRequest){
    const result=await import('./extensionConnection').then(module=>module.authorizeExtensionConnection({installationId:extension.get('installationId'),state:extension.get('state'),challenge:extension.get('challenge'),redirectUri:extension.get('redirectUri')},AbortSignal.timeout(15000),next.subject));
    const destination=new URL(result.redirectUri);destination.searchParams.set('libraryId',(await openLibrary()).id);
    location.assign(destination.toString());return;
   }
   // The local library remains the mutation authority, while an empty device keeps
   // summary projections unknown until its first account restore settles. The App
   // Shell stays open throughout; AccountLibrarySync advances that availability.
   setOwner(next);setLocal(true);setOnlineService(true);setPublisherAccess(access.capabilities?.publishLearningContent??false);setConnectionConflict(false);setLoginOpen(false);setSent(false);setCode('');setNotice('');
   return true;
  }catch(cause){if(gen===generation.current){if(cause instanceof Error&&(cause.message==='localFlow.libraryMissing'||(hasLocalLibraryHint()||hasLocalLibrarySelection())&&storageRecoveryCodes.has(cause.message))){setLibraryMissing(true);setLocal(false);setOnlineService(false);setPublisherAccess(false);setLoginOpen(false);}if(needsInitialRestore)setLibraryAvailability(guestAttempt&&usableLocalFacts?'authoritative':'failed');if(cause instanceof Error&&cause.message==='localFlow.accountLibraryConflict'){setConnectionConflict(true);setLoginOpen(false);}setNotice(localFlowErrorKey(cause,'localFlow.networkRetry'));}}
  finally{if(gen===generation.current)setReady(true);}
 };
 useEffect(()=>{void recover();const sub=auth?.onAuthStateChange((event,session)=>{
  if(deletionRef.current)return;
  const next={subject:session?.user.id??null,token:session?.access_token??null},previous=observedAuth.current;
  // Supabase also emits SIGNED_IN when a tab regains focus. It is not a logout
  // or a new account; tearing down the app here interrupts extension PKCE.
  if(previous?.subject===next.subject&&previous.token===next.token&&event!=='USER_UPDATED')return;
  observedAuth.current=next;
  setWebSession(session?'present':'absent');
  if(event==='SIGNED_OUT'||previous&&previous.subject!==next.subject){generation.current++;void clearAllCredentials();setWebSession(event==='SIGNED_OUT'?'absent':'checking');setOnlineService(false);setPublisherAccess(false);if(event!=='SIGNED_OUT')setLocal(false);}
  setTimeout(()=>void recover(),0);
 });const online=()=>void recover();const storage=(event:StorageEvent)=>{if(event.key===null||event.key===authStorageKey)void recover();};window.addEventListener('online',online);window.addEventListener('storage',storage);return()=>{generation.current++;sub?.data.subscription.unsubscribe();window.removeEventListener('online',online);window.removeEventListener('storage',storage);};},[]);
 useEffect(()=>{if(!sent||now>=retryAt)return;const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(0,retryAt-Date.now())+20);return()=>window.clearTimeout(timer);},[now,retryAt,sent]);
 useEffect(()=>{if(sent&&!busy)codeInput.current?.focus();},[sent,busy]);
 useEffect(()=>{if(!local)return;return observeLibrary(()=>{void readLibrary(async tx=>({signedOut:await tx.get('meta','signed-out'),epoch:await readAccountSignoutEpoch(tx)})).then(state=>{if(state.signedOut&&localRef.current){if(state.epoch!==observedSignoutEpoch.current){generation.current++;explicitSignIn.current=undefined;callbackAccepted.current=true;}observedSignoutEpoch.current=state.epoch;void clearAllCredentials();setOnlineService(false);setPublisherAccess(false);}}).catch(()=>setNotice(localFlowText('localStatusFailed')));},['meta']);},[local]);
 const perform=useCallback(async(work:()=>Promise<unknown>)=>{callbackDismissed.current=true;setBusy(true);setNotice('');try{await work();}catch{setNotice(localFlowText('tryLater'));}finally{setBusy(false);}},[]);
 const send=async()=>{if(!auth)return;const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:emailLinkRedirect()}});if(error){setNotice(localFlowText(error.status===429?'otpRateLimit':error.code==='otp_disabled'||error.code==='signup_disabled'?'invitationRequired':'otpSendFailed'));return;}setCode('');setSent(true);setNow(Date.now());setRetryAt(Date.now()+60000);};
 const verify=async()=>{const epoch=await accountSignoutEpoch();const result=await auth!.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});if(result.error){setNotice(localFlowText('otpInvalid'));return;}await recover({epoch});};
 const logout=useCallback(async()=>{generation.current++;explicitSignIn.current=undefined;callbackAccepted.current=true;const extensionModule=await import('./extensionConnection');if(cachedAuthSubject()===owner?.subject)extensionModule.notifyExtensionSignout(owner?.accountId);await clearAllCredentials();const operationId=crypto.randomUUID();await command({id:operationId,kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);tx.put('meta',accountSignoutEpochKey,operationId);return null;});setOnlineService(false);setPublisherAccess(false);setLoginOpen(false);setSent(false);setCode('');const result=await auth?.signOut({scope:'local'});if(result?.error)setNotice(localFlowText('signoutIncomplete'));},[owner?.accountId,owner?.subject]);
 const updateLibraryAvailability=useCallback((value:LibraryAvailability)=>setLibraryAvailability(current=>current==='authoritative'?current:value),[]);
 const accountAccess=useMemo<AccountAccess>(()=>({
  deleteAccount:()=>{generation.current++;setDeletionOpen(true);},
  notice:localFlowNotice(notice),
  email:owner?.email??null,
  onlineService,
  webSessionPresent:webSession==='present',
  publisherAccess,
  connectionConflict,
  libraryAvailability,
  connectionBusy:busy,
  checkConnection:()=>{
   if(checkingConnection.current)return;
   checkingConnection.current=true;
   void perform(recover).finally(()=>{checkingConnection.current=false;});
  },
  login:()=>setLoginOpen(true),
  retryConnection:()=>perform(async()=>{
   if(!onlineService&&await recover()!==true)return;
   // Admission already succeeded. A manual retry must actually rerun the
   // failed sync, including terminal failures, not only repeat auth/preflight.
   updateLibraryAvailability('restoring');
   try{await import('../../data/library/cloudSyncService').then(module=>module.syncAccountLibrary({restoreAfterLocalClear:true}));
    const state=await import('../../data/library/cloudSync').then(module=>module.readCloudSync());
    updateLibraryAvailability(state?.status==='synced'?'authoritative':'failed');
   }catch(cause){updateLibraryAvailability('failed');throw cause;}
  }),
  logout:()=>perform(logout),
 }),[notice,onlineService,webSession,publisherAccess,connectionConflict,libraryAvailability,busy,owner?.email,perform,logout]);
 if(deletionOpen)return <Suspense fallback={<main role="status">{localFlowText('loadingSensa')}</main>}><AccountDeletion onClose={()=>{location.assign('/profile');}}/></Suspense>;
 if(!ready)return <main role="status" className="grid min-h-screen place-content-center">{localFlowText(extensionRequest?'extensionConnecting':'loadingSensa')}</main>;
 if(libraryMissing&&!loginOpen)return <Suspense fallback={<main role="status">{localFlowText('loadingSensa')}</main>}><LocalLibraryRecovery notice={notice||'localFlow.libraryMissing'} onLogin={()=>{setNotice('');setLoginOpen(true);}}/></Suspense>;
 if(extensionRequest&&webSession==='present'&&!loginOpen)return <main className="grid min-h-screen place-content-center gap-4 p-8 text-center"><p role="status">{notice?localFlowNotice(notice):localFlowText('extensionConnecting')}</p>{notice&&<div className="flex justify-center gap-2"><button className={setupPrimary} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('extensionRetry')}</button><button className={setupButton} onClick={()=>location.assign('/profile')}>{localFlowText('cancel')}</button></div>}</main>;
 if(local&&!loginOpen&&extension.get('extension')!=='connect')return <AccountContext.Provider value={accountAccess}><Suspense fallback={null}>{onlineService&&<AccountLibrarySync online onAvailabilityChange={updateLibraryAvailability}/>}{onlineService&&<RemoteIntakeDelivery online/>}<ExtensionIntake accountId={owner?.accountId??null} onlineService={onlineService}/></Suspense>{children}</AccountContext.Provider>;
 // Invited users verify email ownership with a code; service admission remains server-side.
 return <main className="sensa-account-entry flex min-h-screen items-center justify-center bg-surface-canvas px-6 font-product text-fg-primary"><form className="w-full max-w-sm space-y-5" onSubmit={e=>{e.preventDefault();void perform(sent?verify:send);}}>
  <div className="flex items-center justify-between"><SensaLogo/><LanguageSwitch/></div><h1 className="text-3xl font-semibold">{sent?localFlowText('enterOtp'):localFlowText('welcome')}</h1>
  <p className="text-sm leading-6">{sent?localFlowText('otpSent',{email}):localFlowText('loginIntro')}</p>
  {!auth?<p role="status">{localFlowText('loginUnavailable')}</p>:<>{sent?<label className="block text-sm">{localFlowText('otp')}<input className="mt-2 w-full rounded-control border border-border-strong bg-surface-panel p-3 text-fg-primary focus-visible:outline-2 focus-visible:outline-focus" ref={codeInput} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} disabled={busy} value={code} onChange={e=>setCode(e.target.value)} required/></label>:<label className="block text-sm">{localFlowText('email')}<input className="mt-2 w-full rounded-control border border-border-strong bg-surface-panel p-3 text-fg-primary focus-visible:outline-2 focus-visible:outline-focus" type="email" autoComplete="email" disabled={busy} value={email} onChange={e=>setEmail(e.target.value)} required/></label>}<button className={setupPrimary+' w-full'} disabled={busy}>{busy?localFlowText('processing'):sent?localFlowText('verify'):localFlowText('sendOtp')}</button></>}
  {notice&&<p role="status">{localFlowNotice(notice)}</p>}
  {sent&&<div className="flex flex-wrap gap-2"><button type="button" className={setupButton} disabled={busy||now<retryAt} onClick={()=>void perform(send)}>{now<retryAt?localFlowText('resendLater'):localFlowText('resend')}</button><button type="button" className={setupButton} disabled={busy} onClick={()=>{setSent(false);setCode('');}}>{localFlowText('changeEmail')}</button></div>}
  <button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>{localFlowText('checkLogin')}</button>
  {owner&&webSession==='present'&&<button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(logout)}>{localFlowText('switchAccount')}</button>}
  {local&&extension.get('extension')!=='connect'&&<button type="button" className={setupButton} onClick={()=>setLoginOpen(false)}>{localFlowText('continueLocal')}</button>}
  {libraryMissing&&loginOpen&&<button type="button" className={setupButton} disabled={busy} onClick={()=>{setNotice('');setLoginOpen(false);}}>{localFlowText('cancel')}</button>}
  {!local&&!sent&&(location.pathname==='/'||location.pathname==='/welcome')&&onReturnToLanding&&<button type="button" className={setupButton} onClick={onReturnToLanding}>{t('landing.back')}</button>}
 </form></main>;
}
