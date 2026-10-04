/** Learner-only optimistic source witness. Never a teacher tool or model input. */
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {sha256Hex} from './digest';
import {isUuid} from './ids';
import type {JourneyState,MeaningJourneyRecord} from './store';

export type ClarificationSourceKind='personal_meaning'|'intake';
export interface ClarificationSourceWitness{kind:ClarificationSourceKind;id:string;incarnation:string;digest:string}
export class ClarificationSourceChangedError extends Error{
 constructor(){super('localFlow.clarificationSourceChanged');this.name='ClarificationSourceChangedError';}
}
export function clarificationSourceWitness(incarnation:string,kind:ClarificationSourceKind,id:string,value:unknown):ClarificationSourceWitness{
 return {kind,id,incarnation,digest:sha256Hex(canonicalConsumerJson(value))};
}
export function meaningSourceValue(record:MeaningJourneyRecord|undefined){
 if(!record||record.personalMeaning.status!=='active')throw new ClarificationSourceChangedError();
 return record;
}
export function intakeSourceValue(item:JourneyState['inboxItems'][number]|undefined,metadata:JourneyState['clarificationDrafts'][number]|undefined){
 if(!item)throw new ClarificationSourceChangedError();
 return {item,metadata:metadata??null};
}
export function sourceWitnessFromState(state:JourneyState,incarnation:string,kind:ClarificationSourceKind,id:string):ClarificationSourceWitness{
 const value=kind==='personal_meaning'?meaningSourceValue(state.meanings.find(record=>record.personalMeaning.personalMeaningId===id))
  :intakeSourceValue(state.inboxItems.find(item=>item.intakeId===id),state.clarificationDrafts.find(draft=>draft.intakeId===id));
 return clarificationSourceWitness(incarnation,kind,id,value);
}
export function sameClarificationSource(left:ClarificationSourceWitness|null|undefined,right:ClarificationSourceWitness|null|undefined):boolean{
 return !!left&&!!right&&left.kind===right.kind&&left.id===right.id&&left.incarnation===right.incarnation&&left.digest===right.digest;
}
export function assertClarificationSource(witness:ClarificationSourceWitness,kind:ClarificationSourceKind,id:string):void{
 if(!witness||witness.kind!==kind||witness.id!==id||!isUuid(id)||typeof witness.incarnation!=='string'||!witness.incarnation||witness.incarnation.length>200
  ||typeof witness.digest!=='string'||!/^[0-9a-f]{64}$/u.test(witness.digest))throw new ClarificationSourceChangedError();
}
