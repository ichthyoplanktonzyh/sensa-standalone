import {isUuid} from './ids';
import {meaningHistoryRecords} from './meaningHistoryRead';
import type {MeaningJourneyRecord,CommandReceipt,JourneyState} from './store';

export const journeyIdentityTables=['semanticMeanings','semanticContexts','semanticRegistry','semanticInbox','semanticDrafts','semanticReceipts'] as const;
export type JourneyIdentityTable=typeof journeyIdentityTables[number];
/** The same shallow fact fields reserved by the command ID generator. Opaque
 * Context, learner prose, provenance payloads and arbitrary JSON are not edges. */
export function journeyReservedIdentities(table:JourneyIdentityTable,value:unknown):string[]{
 const ids=new Set<string>();
 const fact=(item:unknown)=>{if(item&&typeof item==='object'&&!Array.isArray(item))for(const [field,id] of Object.entries(item))if(field.endsWith('Id')&&isUuid(id))ids.add(id);};
 if(table==='semanticMeanings'){
  const record=value as MeaningJourneyRecord;
  for(const branch of meaningHistoryRecords(record)){
   fact(branch.personalMeaning);
   for(const rows of Object.values(branch))if(Array.isArray(rows))for(const row of rows)fact(row);
   for(const version of branch.proposalVersions??[])for(const candidate of version.expressionCandidates??[])fact(candidate);
  }
  for(const decision of record.conflictHistory?.decisions??[])if(isUuid(decision.id))ids.add(decision.id);
 }else if(table==='semanticContexts')fact((value as {value:unknown}).value);
 else if(table==='semanticRegistry')fact((value as {value:unknown}).value);
 else if(table==='semanticInbox'){
  const item=value as JourneyState['inboxItems'][number];fact(item);fact(item.payload);
  for(const id of item.payload?.context?.mediaReferenceIds??[])if(isUuid(id))ids.add(id);
 }else if(table==='semanticReceipts'){const receipt=value as CommandReceipt;fact(receipt);fact(receipt.result);}
 else fact(value);
 return [...ids];
}
