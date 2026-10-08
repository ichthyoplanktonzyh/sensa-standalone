import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../apps/web/src/i18n/workspaceResources';
import {LocalDataControlPanel} from '../../apps/web/src/experience/components/LocalDataControlPanel';
import {CloudSyncPanel} from '../../apps/web/src/experience/components/CloudSyncPanel';
import {AccountContext,useAccountExperience,type AccountAccess} from '../../apps/web/src/experience/account/AccountContext';
import {AccountLibrarySync,type LibraryAvailability} from '../../apps/web/src/experience/account/AccountLibrarySync';
import AccountExperience from '../../apps/web/src/experience/account/AccountExperience';
import {LibraryRestorationScreen} from '../../apps/web/src/experience/account/LibraryRestorationScreen';

export function mountLocalDataControl(){
 document.body.innerHTML='<main id="local-clear-fixture"></main>';
 createRoot(document.getElementById('local-clear-fixture')!).render(
  <LocalDataControlPanel synchronize={()=>((window as any).sync as ()=>Promise<void>)()}/>,
 );
}

/** Real manual-sync renderer and automatic scheduler, controlled account
 * admission only. This is not the full login/AccountExperience application. */
function CloudSyncControl({automatic,initialAvailability}:{automatic:boolean;initialAvailability:LibraryAvailability}){
 const [availability,setAvailability]=useState(initialAvailability);
 const account:AccountAccess={deleteAccount:()=>{},notice:'',email:'sync@sensa.invalid',onlineService:true,publisherAccess:false,connectionConflict:false,libraryAvailability:availability,login:()=>{},retryConnection:async()=>{},logout:async()=>{}};
 return <AccountContext.Provider value={account}>{automatic&&<AccountLibrarySync online onAvailabilityChange={setAvailability}/>}<div data-testid="library-availability">{availability}</div>{availability!=='authoritative'&&<LibraryRestorationScreen id="restore-fixture" active failed={availability==='failed'} onRetry={account.retryConnection} onSettings={()=>{}}/>}<CloudSyncPanel/></AccountContext.Provider>;
}
export function mountCloudSyncControl({automatic=true,initialAvailability='authoritative'}:{automatic?:boolean;initialAvailability?:LibraryAvailability}={}){
 document.body.innerHTML='<main id="cloud-sync-fixture"></main>';
 createRoot(document.getElementById('cloud-sync-fixture')!).render(<CloudSyncControl automatic={automatic} initialAvailability={initialAvailability}/>);
}

function AccountConnectionControl(){
 const account=useAccountExperience();
 return <><div data-testid="connection-online">{String(account.onlineService)}</div><div data-testid="connection-notice">{account.notice}</div><LibraryRestorationScreen id="account-restore-fixture" active failed onRetry={account.retryConnection} onSettings={()=>{}}/></>;
}
/** Actual account admission and manual retry, but test-only child renderer and
 * controlled authentication. Not a full App or provider login acceptance. */
export function mountAccountConnectionControl(){
 document.body.innerHTML='<main id="account-connection-fixture"></main>';
 createRoot(document.getElementById('account-connection-fixture')!).render(<AccountExperience><AccountConnectionControl/></AccountExperience>);
}
