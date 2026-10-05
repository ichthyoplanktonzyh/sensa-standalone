/** Provider-free fixture generation uses the shipped commands over the actual
 * SQLite/Wasm kernel. Only storage transport differs from Chromium/OPFS. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../apps/web/src/data/library/sqliteDatabase.ts';
import {sqliteRecordAdapter,type SqliteRecordAdapter} from '../../apps/web/src/data/library/sqliteAdapter.ts';

export async function useNodeLearningCapacityStorage(){
 const sqlite=await sqlite3InitModule();
 const database=new SqliteRecordDatabase(sqlite,new sqlite.oo1.DB(':memory:','c'),'memory');
 database.initialize();
 const adapter=await sqliteRecordAdapter();
 const methods=[
  'get','entries','entriesPage','existingRecordKeys','packageCacheProjection','lookupMeanings','worldBrowse','registrySelection','worldLearningChoices','existingJourneyIdentities',
  'changesSince','hasChangesSince','syncBaseEntries','count','estimateRecordBytes','homeLearningProjection','countIntroducedLearningTargets','learningRunIdsForTarget','openLearningRunTargets',
  'countContentAttemptsSince','learningTargetIdsForBookUpgrade','isMediaReferenced','portableMedia','portableMediaDiagnostics','commit','diagnostics','learningHistoryPage','learningManagementSummary','runtimeLearningCandidates','studyScopeMember',
 ] as const satisfies readonly (keyof SqliteRecordAdapter)[];
 for(const name of methods){
  const method=Reflect.get(database,name);
  if(typeof method!=='function')throw new Error(`Capacity storage adapter missing ${name}`);
  Reflect.set(adapter,name,async(...args:unknown[])=>Reflect.apply(method,database,args));
 }
 return database;
}
