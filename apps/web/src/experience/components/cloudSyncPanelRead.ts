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
 return 'cloudSync.'+(state.error==='library_sync_identity'?'identity':state.error==='library_sync_incompatible_checkpoint'?'incompatible':state.failureKind==='terminal'?'attention':state.status);
}
