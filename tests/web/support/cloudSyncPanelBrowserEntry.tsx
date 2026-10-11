/** Actual sync panel; only its read port and sync command are controlled. */
import {createRoot} from 'react-dom/client';
import '../../../apps/web/src/i18n/workspaceResources';
import i18n from '../../../apps/web/src/i18n';
import {CloudSyncPanel} from '../../../apps/web/src/experience/components/CloudSyncPanel';
import {AccountContext,type AccountAccess} from '../../../apps/web/src/experience/account/AccountContext';
import {readCloudSyncPanel as readConfirmed,cloudSyncPanelMessage,cloudSyncCanChoose,cloudSyncNeedsRecovery} from '../../../apps/web/src/experience/components/cloudSyncPanelRead';
import {openLibrary} from '../../../apps/web/src/data/library/store';
import {inspectLibraryBackup} from '../../../apps/web/src/data/library/backup';
import type {CloudSyncState} from '../../../apps/web/src/data/library/cloudSync';
export {cloudSyncPanelMessage,cloudSyncCanChoose,cloudSyncNeedsRecovery};
let unavailable=false,syncCalls=0;
let saved={status:'synced',lastSyncedAt:'2026-10-10T12:00:00Z',storage:{usedBytes:1048576,capacityBytes:10485760}} as CloudSyncState;
export const readCloudSyncPanel=()=>readConfirmed(async()=>{if(unavailable)throw Error('controlled unavailable read');return [saved,false];});
export const syncAccountLibrary=async()=>{syncCalls++;};
export function fail(){unavailable=true;window.dispatchEvent(new Event('sensa-sync-state-changed'));}
export function repair(){unavailable=false;}
export function block(status:'conflict'|'failed'){
 saved={status,error:'libraryBackup.errors.inconsistent',failureKind:'terminal'} as CloudSyncState;
 window.dispatchEvent(new Event('sensa-sync-state-changed'));
}
export const commands=()=>syncCalls;
export const inspectExport=(bytes:number[])=>inspectLibraryBackup(new Uint8Array(bytes),'sync-recovery-backup-password');
export async function mount(){
 await openLibrary();
 await i18n.changeLanguage('zh-CN');
 const account:AccountAccess={deleteAccount:()=>{},notice:'',email:'fixture@example.test',onlineService:true,webSessionPresent:true,publisherAccess:false,connectionConflict:false,libraryAvailability:'authoritative',connectionBusy:false,checkConnection:()=>{},login:()=>{},retryConnection:async()=>{},logout:async()=>{}};
 createRoot(document.getElementById('root')!).render(<AccountContext.Provider value={account}><CloudSyncPanel/></AccountContext.Provider>);
}
