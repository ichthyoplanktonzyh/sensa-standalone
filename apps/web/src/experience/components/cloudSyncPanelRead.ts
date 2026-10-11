import {readCloudSync,readCloudReconnectRequired} from '../../data/library/cloudSync';

export type CloudSyncPanelRead =
 | {availability:'loading'}
 | {availability:'error'}
 | {availability:'ready';state:Awaited<ReturnType<typeof readCloudSync>>;reconnectRequired:boolean};

/** Read failure cannot stand in for a saved pending or successful sync state. */
export async function readCloudSyncPanel(
 read=()=>Promise.all([readCloudSync(),readCloudReconnectRequired()]),
):Promise<CloudSyncPanelRead>{
 try{const [state,reconnectRequired]=await read();return {availability:'ready',state,reconnectRequired};}
 catch{return {availability:'error'};}
}

export function cloudSyncPanelMessage(read:CloudSyncPanelRead):string{
 if(read.availability==='loading')return 'reliability.loading';
 if(read.availability==='error')return 'account.unknown';
 if(!read.state)return read.reconnectRequired?'account.localSync':'account.unknown';
 const state=read.state;
 if(state.error!=='library_sync_identity'&&(state.failureKind==='terminal'||state.status==='conflict'&&!cloudSyncCanChoose(state)||state.error==='library_sync_incompatible_checkpoint'))return 'profile:syncRecovery.blocked';
 return 'cloudSync.'+(state.error==='library_sync_identity'?'identity':state.status);
}

/** A choice must cover exactly the versions the owner can actually inspect. */
export function cloudSyncCanChoose(state:Awaited<ReturnType<typeof readCloudSync>>):boolean{
 const conflict=state?.conflict,comparison=conflict?.comparison;
 const covered=comparison?.coveredRecordIds??comparison?.records.map(record=>record.id)??[];
 return state?.error!=='library_sync_conflict_unsupported'&&!!conflict&&!!comparison&&comparison.records.length>0&&covered.length===conflict.records.length&&conflict.records.every(record=>covered.includes(record.id))&&Number.isSafeInteger(conflict.localRevision)&&comparison.records.every(record=>record.local.available&&record.remote.available);
}
export function cloudSyncNeedsRecovery(state:Awaited<ReturnType<typeof readCloudSync>>):boolean{
 return !!state&&(state.failureKind==='terminal'||state.status==='conflict'&&!cloudSyncCanChoose(state)||state.error==='library_sync_identity'||state.error==='library_sync_incompatible_checkpoint');
}
