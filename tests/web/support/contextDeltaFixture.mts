import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {semanticLookupPayload} from './semanticLookupFixtures';
import {semanticRecords} from './semanticWorldRecordFixture.mts';
import {backupEqual} from '../../../apps/web/src/data/library/backupCodec';
import type {LibraryRecordReader} from '../../../apps/web/src/data/library/libraryRecordReader';
import type {SqliteLibraryTable} from '../../../apps/web/src/data/library/sqliteProtocol';
export const contextRowId=(row:{table:string;key:string})=>JSON.stringify([row.table,row.key]);
export async function contextDeltaFixture(priorEdits=0){
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock('2026-10-15T08:00:00Z')});
 await modules.semanticIntake.submit(semanticLookupPayload());for(let i=0;i<priorEdits;i++){const current=(await repository.load()).meanings[0];await modules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:current.personalMeaning.personalMeaningId,expectedRevision:current.personalMeaning.currentRevision,blocks:[{kind:'text',bodyText:'Retained Context version '+i}]});}const before=[...semanticRecords(await repository.load())];
 const meaning=before.find(row=>row.table==='semanticMeanings')!.value as any;
 await modules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:meaning.personalMeaning.personalMeaningId,expectedRevision:meaning.personalMeaning.currentRevision,blocks:[{kind:'text',bodyText:'I returned the umbrella after the rain.'}]});
 const after=[...semanticRecords(await repository.load())],prior=new Map(before.map(row=>[contextRowId(row),row.value]));
 const changes=after.filter(row=>!backupEqual(prior.get(contextRowId(row)),row.value)).map(({table,key})=>({table,key}));
 const identity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:'2026-10-15T08:00:00.000Z',schemaVersion:2 as const};
 return {before:[{table:'meta' as const,key:'identity',value:identity},...before],after:[{table:'meta' as const,key:'identity',value:identity},...after],changes,identity};
}
export function contextReader(rows:readonly {table:SqliteLibraryTable;key:string;value:any}[],onRead?:(table:SqliteLibraryTable,key:string)=>void):LibraryRecordReader{
 const index=new Map(rows.map(row=>[contextRowId(row),row.value]));return {storageKeysUnique:true,get(table,key){onRead?.(table,key);return index.get(contextRowId({table,key}));},has:(table,key)=>index.has(contextRowId({table,key})),entries:table=>rows.filter(row=>row.table===table)};
}
