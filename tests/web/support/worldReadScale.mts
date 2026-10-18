/** One assertion body at two scales; only the capacity entry constructs 10k rows. */
import {expect} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {semanticRecords} from './semanticWorldRecordFixture.mts';
import {semanticLookupPayload,syntheticSemanticWorld} from './semanticLookupFixtures';

export async function checkWorldReadScale(count:256|10000){
 const sqlite=await init(),raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const preparedAt=performance.now();
  const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await modules.semanticIntake.submit(semanticLookupPayload());
  const world=syntheticSemanticWorld(await repository.load(),count);
  const puts=[...semanticRecords(world)].map(row=>({...row,encodedValue:JSON.stringify(encodeBackupValue(row.value))}));
  database.commit({clears:[],deletes:[],puts,contentRevision:1});
  console.log('SQLite synthetic fixture preparation:',{meanings:count,records:puts.length,preparationMs:Math.round(performance.now()-preparedAt)});
  const query={query:'',filter:'all' as const,offset:0,limit:20};
  const lastExpression=`borrow-${count-1}`,fullWidthLast=lastExpression.replace(/[!-~]/g,char=>String.fromCharCode(char.charCodeAt(0)+0xfee0));
  const started=performance.now();
  const originalGet=database.get.bind(database);let sourceReads=0;
  database.get=(table,key)=>{if(table==='semanticMeanings'||table==='semanticRegistry')sourceReads++;return originalGet(table,key);};
  const graph=database.worldGraph({query:'',filter:'all'});expect(graph.items).toHaveLength(count);expect(graph.expressionCount).toBe(count);expect(JSON.stringify(graph)).not.toMatch(/bodyText|capturedSources|semanticSpec|dataUrl/);
  const page=database.worldBrowse({...query,limit:40}),last=database.worldBrowse({...query,offset:count-40,limit:40});
  const choices=database.worldLearningChoices({...query,targetLanguageTag:'en',limit:64});
  expect(choices.total).toBe(count);expect(choices.items).toHaveLength(64);
  expect(JSON.stringify(choices.items)).not.toContain('May asked');expect(choices.items.every(choice=>!('context'in choice)&&!('semanticSpec'in choice))).toBe(true);
  expect(choices.items.every(choice=>!('practiceTarget'in choice))).toBe(true);
  const materials=database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:64});
  expect(materials.total).toBe(count);expect(materials.items).toHaveLength(64);
  expect(materials.items.every(item=>JSON.stringify(Object.keys(item).sort())===JSON.stringify(['id','languageTag','source','text']))).toBe(true);
  expect(JSON.stringify(materials)).not.toContain('May asked');expect(JSON.stringify(materials)).not.toContain('senseVersion');
  const identityPage=database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:256,idsOnly:true});
  expect(identityPage.items).toEqual([]);expect(identityPage.ids).toHaveLength(256);
  expect(identityPage.ids.every(id=>id.length===36&&!id.includes('borrow'))).toBe(true);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:fullWidthLast,offset:0,limit:1}).items.map(item=>item.text)).toEqual([lastExpression]);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'',selectedIds:materials.ids.slice(0,2),offset:0,limit:1}).total).toBe(2);
  expect(database.practiceExpressions({source:'personal',languageTag:'fr',query:'',offset:0,limit:1}).total).toBe(0);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en',query:fullWidthLast}).items.map(choice=>choice.label)).toEqual([lastExpression]);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en',offset:count-40,limit:40}).items).toHaveLength(40);
  expect(page.total).toBe(count);expect(page.items).toHaveLength(40);expect(last.items).toHaveLength(40);
  expect(new Set([...page.items,...last.items].map(item=>item.personalMeaningId)).size).toBe(80);
  // The learner's existing compact preview remains visible; the complete
  // private Context and detail/media payload are not list transport data.
  expect(page.items[0]?.primaryLabel).toBe('Private source: May aske…');
  expect(JSON.stringify(page.items)).not.toContain('May asked to borrow an umbrella.');expect(page.items.every(item=>!('detail'in item))).toBe(true);
  expect(database.worldBrowse({...query,query:fullWidthLast}).items.map(item=>item.label)).toEqual([lastExpression]);
  expect(database.worldBrowse({...query,query:'临时'}).total).toBe(count);
  expect(sourceReads,'page/search reads must not hydrate the full facts').toBe(0);
  expect(database.worldBrowse({...query,filter:'pending'})).toMatchObject({items:[],total:0,pending:0});
  const pendingPlan=raw.exec({sql:"EXPLAIN QUERY PLAN SELECT summary_json FROM sensa_world_browse INDEXED BY sensa_world_browse_pending WHERE visible=1 AND (formation<>'sense_confirmed' OR binding<>'bound') ORDER BY updated_at DESC,meaning_id LIMIT 40",rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(pendingPlan.some(row=>row.detail.includes('sensa_world_browse_pending'))).toBe(true);
  // Exercise both branches of the derived selector independently of domain
  // construction. These controlled projection rows are not learner evidence.
  const pendingRows=[{...page.items[0]!,senseFormation:{...page.items[0]!.senseFormation,phase:'clarifying'}},{...page.items[1]!,expressionBinding:{...page.items[1]!.expressionBinding,phase:'partial'}}];
  for(const item of pendingRows)raw.exec({sql:'UPDATE sensa_world_browse SET formation=?,binding=?,summary_json=? WHERE meaning_id=?',bind:[item.senseFormation.phase,item.expressionBinding.phase,JSON.stringify(item),item.personalMeaningId]});
  const pendingPage=database.worldBrowse({...query,filter:'pending',limit:1});
  expect(pendingPage.total).toBe(2);expect(pendingPage.pending).toBe(2);expect(pendingPage.items).toHaveLength(1);
  expect(database.worldBrowse({...query,filter:'pending',offset:1,limit:1}).items[0]!.personalMeaningId).not.toBe(pendingPage.items[0]!.personalMeaningId);
  expect(sourceReads).toBe(0);
  const identityBytes=Number(raw.selectValue("SELECT SUM(pgsize) FROM dbstat WHERE name LIKE 'sensa_journey_id%'"));
  console.log('SQLite synthetic World / private identity reservations / physical cache bytes:',identityBytes);
  expect(identityBytes,'identity cache should not repeat table/key/UUID text per reservation').toBeLessThan(32*1024*1024);
  expect(raw.selectValue('SELECT MAX(length(identity_id)) FROM sensa_journey_identities')).toBe(16);
  const plans=raw.exec({sql:'EXPLAIN QUERY PLAN SELECT summary_json FROM sensa_world_browse WHERE visible=1 ORDER BY updated_at DESC,meaning_id LIMIT 40',rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(plans.some(row=>row.detail.includes('USING INDEX sensa_world_browse_order'))).toBe(true);
  expect(()=>database.worldBrowse({...query,limit:257})).toThrow('world_query_invalid');
  console.log('SQLite prepared synthetic World read assertions:',{queryAndAssertionMs:Math.round(performance.now()-started)});

 }finally{database.close();}
}
