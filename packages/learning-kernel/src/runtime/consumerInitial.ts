import {stableUuid} from './browserSafe.js';
export function consumerInitialStepId(runId:string,ordinal:number,phase:'recall'|'reveal'){
 return stableUuid(`consumer-initial-v1:${runId}:${ordinal}:${phase}`);
}
export function transitionConsumerInitial(phase:'recall'|'reveal',action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'}){
 if(phase==='recall'&&action.kind==='reveal')return 'reveal' as const;
 if(phase==='reveal'&&action.kind==='rate')return action.rating==='again'?'recall' as const:'completed' as const;
 throw new Error('Action is not allowed at this step');
}

export function consumerRunStepId(runId:string,ordinal:number,phase:'recall'|'reveal',protocolVersion:string){
 return protocolVersion==='consumer-initial-v1'?consumerInitialStepId(runId,ordinal,phase):stableUuid(`${protocolVersion}:${runId}:${ordinal}:${phase}`);
}
export function transitionConsumerRun(protocolVersion:string,phase:'recall'|'reveal',action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'}){
 if(protocolVersion==='consumer-initial-v1')return transitionConsumerInitial(phase,action);
 if(!['consumer-review-v1','consumer-relearning-v1'].includes(protocolVersion))throw new Error('Unsupported protocol');
 if(phase==='recall'&&action.kind==='reveal')return 'reveal' as const;
 if(phase==='reveal'&&action.kind==='rate')return protocolVersion==='consumer-relearning-v1'&&action.rating==='again'?'waiting' as const:'completed' as const;
 throw new Error('Action is not allowed at this step');
}
