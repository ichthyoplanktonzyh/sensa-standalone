import {stableUuid} from './browserSafe.js';
export function consumerInitialStepId(runId:string,ordinal:number,phase:'recall'|'reveal'){
 return stableUuid(`consumer-initial-v1:${runId}:${ordinal}:${phase}`);
}
export function transitionConsumerInitial(phase:'recall'|'reveal',action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'}){
 if(phase==='recall'&&action.kind==='reveal')return 'reveal' as const;
 if(phase==='reveal'&&action.kind==='rate')return action.rating==='again'?'recall' as const:'completed' as const;
 throw new Error('Action is not allowed at this step');
}
