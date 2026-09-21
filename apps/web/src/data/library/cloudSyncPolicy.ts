export type CloudSyncFailureKind='transient'|'terminal';

export const cloudSyncRetryDelaysMs=[15_000,60_000,300_000] as const;

const transientErrors=new Set([
 'library_sync_network',
 'library_sync_rate_limited',
 'library_sync_server_error',
]);

export function cloudSyncFailurePolicy(message:string,online:boolean,priorFailures=0,now=Date.now()){
 if(!online)return {status:'offline' as const,failureKind:undefined,retryCount:undefined,retryAt:undefined};
 if(!transientErrors.has(message))return {status:'failed' as const,failureKind:'terminal' as const,retryCount:undefined,retryAt:undefined};
 const retryCount=priorFailures+1,delay=cloudSyncRetryDelaysMs[retryCount-1];
 return {status:'failed' as const,failureKind:'transient' as const,retryCount,retryAt:delay===undefined?undefined:new Date(now+delay).toISOString()};
}

export function automaticCloudSyncRetryAt(state:{status:string;failureKind?:CloudSyncFailureKind;retryAt?:string}|undefined){
 if(state?.status!=='failed'||state.failureKind!=='transient'||!state.retryAt)return null;
 const value=Date.parse(state.retryAt);return Number.isFinite(value)?value:null;
}

export function blocksAutomaticCloudSync(state:{status:string;failureKind?:CloudSyncFailureKind;retryAt?:string}|undefined){
 return state?.status==='conflict'||(state?.status==='failed'&&automaticCloudSyncRetryAt(state)===null);
}
