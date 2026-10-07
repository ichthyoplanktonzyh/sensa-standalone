import type {SensaPersonalMeaningAlignmentEvent,SensaPersonalMeaningAlignmentSnapshot} from '@sensa/contracts/sensa';

export type AlignmentEvents=Pick<SensaPersonalMeaningAlignmentEvent,'personalMeaningAlignmentId'|'ordinal'|'eventType'>;
export function alignmentStatusAt(events:readonly AlignmentEvents[],id:string,ordinal=Infinity):'active'|'withdrawn'{
 let latest:AlignmentEvents|undefined;
 for(const event of events)if(event.personalMeaningAlignmentId===id&&event.ordinal<=ordinal&&(!latest||latest.ordinal<event.ordinal))latest=event;
 if(!latest)throw Error('alignment_history_invalid');
 return latest.eventType==='withdrawn'?'withdrawn':'active';
}
export function isAlignmentActive(record:{alignmentEvents:readonly AlignmentEvents[]},alignment:Pick<SensaPersonalMeaningAlignmentSnapshot,'personalMeaningAlignmentId'>):boolean{
 return alignmentStatusAt(record.alignmentEvents,alignment.personalMeaningAlignmentId)==='active';
}
/** Acceptances stay immutable; lifecycle is the contiguous event history. */
export function assertAlignmentHistory(record:{alignmentEvents:readonly SensaPersonalMeaningAlignmentEvent[]},alignment:SensaPersonalMeaningAlignmentSnapshot){
 const events=record.alignmentEvents.filter(event=>event.personalMeaningAlignmentId===alignment.personalMeaningAlignmentId).sort((a,b)=>a.ordinal-b.ordinal);
 let status:'active'|'withdrawn'='withdrawn',priorTime=-Infinity;
 for(const [index,event] of events.entries()){
  if(event.ordinal!==index+1||Date.parse(event.occurredAt)<priorTime||event.eventType!==(index===0?'confirmed':status==='active'?'withdrawn':'restored'))throw Error('alignment_history_invalid');
  status=event.eventType==='withdrawn'?'withdrawn':'active';priorTime=Date.parse(event.occurredAt);
 }
 if(!events.length||alignment.status!==alignmentStatusAt(events,alignment.personalMeaningAlignmentId,alignment.revision)||!events.some(event=>event.ordinal===alignment.revision))throw Error('alignment_history_invalid');
}
