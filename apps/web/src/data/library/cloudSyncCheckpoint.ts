import type {CloudSyncState} from './cloudSync';
import {libraryReplicaValidationVersion} from './replication/libraryReplicaValidation';

/** Mixed conflict baselines and uncertain publications are not a confirmed replica. */
export function confirmedCheckpoint(state:CloudSyncState|undefined){
 return state?.checkpointVersion===7&&Number.isSafeInteger(state.revision)&&state.revision>=0&&Number.isSafeInteger(state.syncedLocalRevision)&&(state.syncedLocalRevision??-1)>=0
  &&!state.pending&&state.status!=='conflict'&&!state.conflicts?.length&&!state.conflict&&!state.resolution;
}
export const validatedCheckpoint=(state:CloudSyncState|undefined)=>confirmedCheckpoint(state)&&state!.validationVersion===libraryReplicaValidationVersion;

/** Durable evidence, read after acquiring the account sync lock. A timestamp
 * alone cannot suppress pending work or a check for another account/world. */
export function freshCheckpoint(state:CloudSyncState|undefined,current:{owner:{subject:string;accountId:string};incarnation:string;localRevision:number},maxAgeMs:number,now=Date.now()){
 if(!validatedCheckpoint(state)||state!.status!=='synced'||state!.error||state!.syncStartedAt||state!.syncedLocalRevision!==current.localRevision
  ||state!.owner.subject!==current.owner.subject||state!.owner.accountId!==current.owner.accountId||state!.incarnation!==current.incarnation)return false;
 const checkedAt=Date.parse(state!.lastCheckedAt??''),age=now-checkedAt;
 return Number.isFinite(age)&&age>=0&&age<maxAgeMs;
}
