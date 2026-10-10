import {test,expect} from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {registrySelectionSql,memoryRegistrySelection,type RegistrySelectionQuery} from '../../../apps/web/src/data/library/semanticRegistrySelection';
import {learningPackageChoicesSql} from '../../../apps/web/src/data/library/packageCacheProjection';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {semanticLookupPayload,syntheticSemanticWorld} from '../support/semanticLookupFixtures';
import {directPublishedFixture} from '../support/directPublishedFixture';

test('direct discovery uses bounded SQLite expression indexes, exact current connections and independent published sources',async()=>{
 const sqlite3=await sqlite3InitModule(),raw=new sqlite3.oo1.DB(':memory:','c'),db=new SqliteRecordDatabase(sqlite3,raw,'memory');
 const encoded=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
 try{
  db.initialize();const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
  const state=syntheticSemanticWorld(await repository.load(),250);
  state.registry.bindingVersions[0]!.reviewStatus='rejected';state.registry.bindingVersions[1]!.semanticCoverage='overlapping';state.registry.senseVersions[2]!.reviewStatus='rejected';
  const rows=Object.entries(state.registry).flatMap(([kind,values])=>values.map((value:any,ordinal)=>({key:`${kind}:${kind==='senses'?value.senseId:kind==='senseVersions'?value.senseVersionId:kind==='expressions'?value.expressionId:kind==='expressionVersions'?value.expressionVersionId:kind==='bindings'?value.senseExpressionBindingId:value.bindingVersionId}`,value:{kind,ordinal,value}})));
  db.commit({clears:[],deletes:[],puts:rows.map(row=>({table:'semanticRegistry',key:row.key,encodedValue:encoded(row.value)}))});
  const queries:RegistrySelectionQuery[]=[
   {kind:'learningChoices',normalizedPrefix:'borrow-24',languageTag:'en',offset:0,limit:21},
   {kind:'learningChoices',normalizedPrefix:'borrow',languageTag:'en',offset:0,limit:21},
   {kind:'learningChoices',normalizedPrefix:'borrow',languageTag:'en',offset:21,limit:21},
   {kind:'learningChoices',normalizedPrefix:'borrow',languageTag:'ja',offset:0,limit:21},
   {kind:'learningChoices',normalizedPrefix:"' OR 1=1 --",languageTag:'en',offset:0,limit:21},
  ];
  for(const query of queries)expect(db.registrySelection(query)).toEqual(memoryRegistrySelection(query,rows));
  expect(db.registrySelection(queries[0]!).keys).toHaveLength(11);expect(db.registrySelection(queries[1]!).keys).toHaveLength(21);
  expect(new Set([...db.registrySelection(queries[1]!).keys,...db.registrySelection(queries[2]!).keys]).size).toBe(42);
  const sql=registrySelectionSql(queries[0]!);
  const plan=raw.exec({sql:'EXPLAIN QUERY PLAN '+sql.sql,bind:sql.bind as any[],rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(plan.some(row=>/SEARCH ev USING INDEX sensa_registry_expression_form/.test(row.detail))).toBe(true);
  expect(plan.some(row=>/SCAN (?:ev|binding|bv|sv|expression)\b/.test(row.detail))).toBe(false);
  const pub=directPublishedFixture();db.commit({clears:[],deletes:[],puts:[{table:'packageCache',key:pub.pack.key,encodedValue:encoded(pub.pack)}]});
  const packageQuery={kind:'learning_choices' as const,normalizedPrefix:'bor',languageTag:'en',limit:21,offset:0};
  const choices=db.packageCacheProjection(packageQuery);expect(choices).toHaveLength(1);expect(choices[0]!.key).toBe(pub.pack.key);expect(JSON.stringify(choices)).not.toContain('data:audio/');
  const packagePlan=raw.exec({sql:'EXPLAIN QUERY PLAN '+learningPackageChoicesSql,bind:['en','bor','bor\u{10ffff}',21,0],rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(packagePlan.some(row=>/SEARCH.*sensa_package_learning_expression/.test(row.detail))).toBe(true);
  expect(db.packageCacheProjection({...packageQuery,languageTag:'ja'})).toEqual([]);
  const unaligned=structuredClone(pub.pack);unaligned.portableOrigin.publications=[];
  db.commit({clears:[],deletes:[],puts:[{table:'packageCache',key:pub.pack.key,encodedValue:encoded(unaligned)}]});expect(db.packageCacheProjection(packageQuery)).toEqual([]);
  expect(db.count('semanticMeanings')).toBe(0);expect(db.count('curriculumEnrollments')).toBe(0);expect(db.count('learningTargets')).toBe(0);
 }finally{db.close();}
});
