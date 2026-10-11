/** Actual sync panel; only its read port and sync command are controlled. */
import {createRoot} from 'react-dom/client';
import '../../../apps/web/src/i18n/workspaceResources';
import i18n from '../../../apps/web/src/i18n';
import {CloudSyncPanel} from '../../../apps/web/src/experience/components/CloudSyncPanel';
import {AccountContext,type AccountAccess} from '../../../apps/web/src/experience/account/AccountContext';
import {readCloudSyncPanel as readConfirmed,cloudSyncPanelMessage} from '../../../apps/web/src/experience/components/cloudSyncPanelRead';
import type {CloudSyncState} from '../../../apps/web/src/data/library/cloudSync';
export {cloudSyncPanelMessage};
let unavailable=false,syncCalls=0;
const saved={status:'synced',lastSyncedAt:'2026-10-10T12:00:00Z',storage:{usedBytes:1048576,capacityBytes:10485760}} as CloudSyncState;
export const readCloudSyncPanel=()=>readConfirmed(async()=>{if(unavailable)throw Error('controlled unavailable read');return [saved,false];});
export const syncAccountLibrary=async()=>{syncCalls++;};
export function fail(){unavailable=true;window.dispatchEvent(new Event('sensa-sync-state-changed'));}
export function repair(){unavailable=false;}
export const commands=()=>syncCalls;
export async function mount(){
 await i18n.changeLanguage('zh-CN');
 const account:AccountAccess={deleteAccount:()=>{},notice:'',email:'fixture@example.test',onlineService:true,webSessionPresent:true,publisherAccess:false,connectionConflict:false,libraryAvailability:'authoritative',connectionBusy:false,checkConnection:()=>{},login:()=>{},retryConnection:async()=>{},logout:async()=>{}};
 createRoot(document.getElementById('root')!).render(<AccountContext.Provider value={account}><CloudSyncPanel/></AccountContext.Provider>);
}
