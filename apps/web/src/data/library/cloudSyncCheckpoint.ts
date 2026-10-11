import type {CloudSyncState} from './cloudSync';
import {libraryReplicaValidationVersion} from './replication/libraryReplicaValidation';

/** Mixed conflict baselines and uncertain publications are not a confirmed replica. */
export function confirmedCheckpoint(state:CloudSyncState|undefined){
 return state?.checkpointVersion===7&&Number.isSafeInteger(state.revision)&&state.revision>=0&&Number.isSafeInteger(state.syncedLocalRevision)&&(state.syncedLocalRevision??-1)>=0
  &&!state.pending&&state.status!=='conflict'&&!state.conflicts?.length&&!state.conflict&&!state.resolution;
}
export const validatedCheckpoint=(state:CloudSyncState|undefined)=>confirmedCheckpoint(state)&&state!.validationVersion===libraryReplicaValidationVersion;
