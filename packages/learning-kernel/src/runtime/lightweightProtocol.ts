import {stableUuid} from './canonical.js';

export const lightweightProtocolVersions=Object.freeze({
  initial:'sensa-lightweight-initial-v1',
  review:'sensa-lightweight-review-v1',
  relearning:'sensa-lightweight-relearning-v1',
} as const);

export const lightweightSchedulingPolicy=Object.freeze({
  algorithm:'fsrs-6' as const,
  desiredRetention:0.9,
  maximumIntervalDays:36500,
  learningStepsMinutes:Object.freeze([] as number[]),
  relearningStepsMinutes:Object.freeze([] as number[]),
  enableFuzz:false,
});

export function lightweightProtocolStepId(runId:string,ordinal:number,phase:'recall'|'reveal',protocolVersion:string){
  return stableUuid(`${protocolVersion}:${runId}:${ordinal}:${phase}`);
}

export function transitionLightweightProtocol(protocolVersion:string,phase:'recall'|'reveal',action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'}){
  if(!Object.values(lightweightProtocolVersions).includes(protocolVersion as typeof lightweightProtocolVersions[keyof typeof lightweightProtocolVersions]))throw new Error('Unsupported protocol');
  if(phase==='recall'&&action.kind==='reveal')return 'reveal' as const;
  if(phase==='reveal'&&action.kind==='rate')return protocolVersion===lightweightProtocolVersions.relearning&&action.rating==='again'?'waiting' as const:'completed' as const;
  throw new Error('Action is not allowed at this step');
}
