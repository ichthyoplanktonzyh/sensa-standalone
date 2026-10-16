import {libraryReplicaDependencies,replicaEntryId,type LibraryReplicaEntry} from './libraryReplica';
import {registryVersionSlot} from '../../../experience/personalMeaningJourney/registryVersionSlot';

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
