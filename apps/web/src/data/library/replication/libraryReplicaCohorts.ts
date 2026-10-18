import {libraryReplicaDependencies,replicaEntryId,type LibraryReplicaEntry} from './libraryReplica';
import {registryVersionSlot} from '../../../experience/personalMeaningJourney/registryVersionSlot';
import {personalMeaningSceneIds,registryValidationKeys} from '../../../experience/personalMeaningJourney/authority';
import {hydrateMeaningContexts,type ContextRecord} from '../../../experience/personalMeaningJourney/contextRecords';
import type {MeaningJourneyRecord} from '../../../experience/personalMeaningJourney/store';

/** Metadata for the complete merger component, not just forward reads.
 * Shared tokens make dependencies bidirectional. Route and version-slot rules
 * compare peers even when neither peer directly references the other. */
export function libraryReplicaMergeTokens(entry:Pick<LibraryReplicaEntry,'table'|'key'>,value:any):string[]{
 const tokens=[replicaEntryId(entry),...libraryReplicaDependencies({...entry,value:undefined},value).map(replicaEntryId)];
 if(entry.table==='curriculumEnrollments'&&value.source?.kind==='published_book'&&value.status==='active'&&(value.bookPlan?.mode??'active')==='active'&&typeof value.languageContext?.languageRouteId==='string')tokens.push(JSON.stringify(['enrollment-route',value.languageContext.languageRouteId]));
 if(entry.table==='semanticRegistry'){
  const slot=registryVersionSlot(value.kind,value.value??{});if(slot)tokens.push(JSON.stringify(['registry-slot',slot]));
 }
 if(entry.table==='learningSessions')tokens.push(JSON.stringify(['session-start',value.startedByOperationId,value.startedAt]));
 return [...new Set(tokens)];
}

const learningTables=new Set(['learningTargets','learningRuns','learningEvents','learningReconciliations','learningSessions','studyScopes']);
const contextTables=new Set(['semanticMeanings','semanticContexts','semanticReceipts']);
/** Joint merge owners are distinct from immutable source point reads. The
 * original conflict graph above remains authoritative when conflicts occur. */
export function dirtyRebaseCohortTokens(entry:Pick<LibraryReplicaEntry,'table'|'key'>,value:any):string[]{
 let tokens:string[];
 if(learningTables.has(entry.table)||entry.table==='meta')tokens=[replicaEntryId(entry),...libraryReplicaDependencies({...entry,value:undefined},value).filter(row=>learningTables.has(row.table)&&!(entry.table==='studyScopes'&&row.table==='learningTargets')).map(replicaEntryId)];
 else tokens=[replicaEntryId(entry),...libraryReplicaDependencies({...entry,value:undefined},value).filter(row=>contextTables.has(entry.table)&&contextTables.has(row.table)).map(replicaEntryId)];
 if(entry.table==='learningRuns')for(const participant of Object.values(value.participants??{}) as any[])for(const protocol of [participant.protocolRunId,participant.policyCommitment?.committedByProtocolRunId])if(typeof protocol==='string')tokens.push(JSON.stringify(['protocol-owner',protocol]));
 if(entry.table==='learningTargets'&&typeof value.committedPolicy?.committedByProtocolRunId==='string')tokens.push(JSON.stringify(['protocol-owner',value.committedPolicy.committedByProtocolRunId]));
 if(entry.table==='learningSessions')tokens.push(JSON.stringify(['session-start',value.startedByOperationId,value.startedAt]));
 if(entry.table==='semanticMeanings'){
  const pending:unknown[]=[value];while(pending.length){const item=pending.pop();if(Array.isArray(item)){for(const child of item)pending.push(child);continue;}if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){if(key.endsWith('OperationId')&&typeof child==='string')tokens.push(replicaEntryId({table:'semanticReceipts',key:child}));else if(child&&typeof child==='object')pending.push(child);}}
 }
 const scene=entry.table==='semanticContexts'&&value.kind==='anchorRevisions'?value.value?.structuredPayload?.learningScene:entry.table==='annotations'&&value.kind==='learning_scene'?value:null;
 if(typeof scene?.sceneId==='string')tokens.push(JSON.stringify(['scene-pin',scene.sceneId]));
 return [...new Set(tokens)].map(token=>JSON.stringify(['cohort',token]));
}

/** Extract through the same authority helpers used by complete validation. */
export function dirtyRebaseValidationTokens(entry:Pick<LibraryReplicaEntry,'table'|'key'>,value:any,context:(key:string)=>ContextRecord|undefined):string[]{
 if(entry.table==='semanticContexts'&&value.kind==='anchorRevisions'&&(value.value.lifecycle||value.value.structuredPayload?.learningScene))return [JSON.stringify(['context-history-special',value.value.personalSemanticAnchorId])];
 if(entry.table==='personalLearning'||entry.table==='contentAttempts'){const meaningId=entry.table==='personalLearning'?value.source?.personalMeaningId:value.fixedInput?.source?.personalMeaningId;if(typeof meaningId==='string'&&(!Array.isArray(value.contextPin)||!value.contextPin.length))return [JSON.stringify(['unpinned-meaning-consumer',meaningId])];}
 if(entry.table==='semanticRegistry')return registryValidationKeys(value.kind,value.value).map(row=>JSON.stringify(['validation-key',row.kind,row.value]));
 if(entry.table==='semanticMeanings')return [...new Set(personalMeaningSceneIds(hydrateMeaningContexts(value as MeaningJourneyRecord,context)))].map(sceneId=>JSON.stringify(['validation-scene',sceneId,entry.key]));
 return [];
}
