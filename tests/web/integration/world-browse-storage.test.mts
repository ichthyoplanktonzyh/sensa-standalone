/** Actual SQLite/Wasm: bounded PRIVATE browsing, shared authority and atomic derivation. */
import {test,expect,describe,beforeAll,afterAll} from 'vitest';
import init from '@sqlite.org/sqlite-wasm';
import {SqliteRecordDatabase} from '../../../apps/web/src/data/library/sqliteDatabase';
import {SqliteMeaningLookupProjection} from '../../../apps/web/src/data/library/meaningLookupProjection';
import {MemoryRecordAdapter} from '../../../apps/web/src/data/library/sqliteMemoryAdapter';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {summarizeWorldItem,worldLearningChoice} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import type {JourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store';
import type {SqliteMutation} from '../../../apps/web/src/data/library/sqliteProtocol';
import {semanticLookupPayload,semanticLookupSpec,syntheticSemanticWorld,advanceSemanticHeads,deleteFirstMeaning} from '../support/semanticLookupFixtures';
import {directPublishedFixture} from '../support/directPublishedFixture';

const sqlite=await init(),encode=(value:unknown)=>JSON.stringify(encodeBackupValue(value));
const ids={senses:'senseId',senseVersions:'senseVersionId',expressions:'expressionId',expressionVersions:'expressionVersionId',bindings:'senseExpressionBindingId',bindingVersions:'bindingVersionId'} as const;
function rows(state:JourneyState):SqliteMutation['puts']{
 const result:SqliteMutation['puts']=[{table:'semanticState',key:'root',encodedValue:encode({version:state.version})}];
 for(const value of state.meanings)result.push({table:'semanticMeanings',key:value.personalMeaning.personalMeaningId,encodedValue:encode(value)});
 for(const kind of Object.keys(ids) as Array<keyof typeof ids>)state.registry[kind].forEach((value,ordinal)=>result.push({table:'semanticRegistry',key:`${kind}:${(value as unknown as Record<string,string>)[ids[kind]]}`,encodedValue:encode({kind,ordinal,value})}));
 return result;
}
async function seed(){
 const repository=new MemoryJourneyRepository(),modules=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 await modules.semanticIntake.submit(semanticLookupPayload());return {repository,modules,state:await repository.load()};
}
const query={query:'',filter:'all' as const,offset:0,limit:20};

for(const budget of ['entry-count','source-chars','aggregate-source-chars'] as const)test(`public lookup reuses exact Registry facts after bounded-cache eviction (${budget})`,async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 let projection:SqliteMeaningLookupProjection|undefined;
 try{
  const world=syntheticSemanticWorld((await seed()).state,budget==='entry-count'?50:budget==='source-chars'?2:4),last=world.meanings.length-1,references=new Map<string,string>();
  // The last independent Meaning confirms the first one's immutable Registry
  // versions. This is a read/storage fixture, not a public intake command.
  for(const kind of Object.keys(ids) as Array<keyof typeof ids>){const list=world.registry[kind] as unknown as Record<string,string>[];references.set(list.at(-1)![ids[kind]]!,list[0]![ids[kind]]!);list.pop();}
  world.meanings[last]=JSON.parse(JSON.stringify(world.meanings[last],(_key,value)=>typeof value==='string'?references.get(value)??value:value));
  const mutation={clears:[],deletes:[],puts:rows(world)} as SqliteMutation;
  const firstKey=`senses:${world.registry.senses[0]!.senseId}`;
  for(const row of mutation.puts){
   // Valid JSON whitespace changes representation cost, not the source fact.
   const padding=row.table==='semanticRegistry'?(budget==='source-chars'&&row.key===firstKey?256*1024:budget==='aggregate-source-chars'&&row.key.startsWith('senses:')?96*1024:0):0;
   const encoded=' '.repeat(padding)+row.encodedValue;
   raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,1)',bind:[row.table,row.key,encoded]});
  }
  const before=database.entries('semanticMeanings');let firstReads=0;
  projection=new SqliteMeaningLookupProjection(raw,(table,key)=>{if(table==='semanticRegistry'&&key===firstKey)firstReads++;return database.get(table,key);});
  projection.initialize();projection.update(mutation);
  expect(firstReads).toBe(budget==='source-chars'?4:2);
  const result=projection.query('借用编号0');expect(result.meanings).toHaveLength(1);expect(result.meanings[0]!.senseId).toBe(world.registry.senses[0]!.senseId);
  expect(result.meanings[0]!.expressions).toMatchObject([{expression:'borrow-0',languageTag:'en'}]);
  expect(database.entries('semanticMeanings')).toEqual(before);
 }finally{projection?.close();database.close(false);}
});

test('lookup negative references are reused only within one transaction and explicit source repair rebuilds the same owner',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();let projection:SqliteMeaningLookupProjection|undefined;
 try{
  const state=(await seed()).state,mutation={clears:[],deletes:[],puts:rows(state)} as SqliteMutation,key=`senses:${state.registry.senses[0]!.senseId}`;
  const missing=mutation.puts.find(row=>row.table==='semanticRegistry'&&row.key===key)!;
  for(const row of mutation.puts)if(row!==missing)raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,1)',bind:[row.table,row.key,row.encodedValue]});
  const before=database.entries('semanticMeanings');let reads=0;
  projection=new SqliteMeaningLookupProjection(raw,(table,id)=>{if(table==='semanticRegistry'&&id===key)reads++;return database.get(table,id);});
  projection.initialize();projection.update(mutation);expect(reads).toBe(1);expect(projection.query('临时').meanings).toEqual([]);
  raw.exec({sql:'INSERT INTO sensa_records(table_name,record_key,value_json,content_revision) VALUES(?,?,?,2)',bind:[missing.table,key,missing.encodedValue]});
  projection.update({clears:[],deletes:[],puts:[missing]});expect(reads).toBe(2);expect(projection.query('临时').meanings).toHaveLength(1);expect(database.entries('semanticMeanings')).toEqual(before);
 }finally{projection?.close();database.close(false);}
});

test('a transaction changing Meaning and Registry derives practice material once per affected owner',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const {state}=await seed(),get=database.get.bind(database);let meaningReads=0;
  database.get=(table,key)=>{if(table==='semanticMeanings')meaningReads++;return get(table,key);};
  database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  database.get=get;
  // Public lookup, private World and practice material each need this owner;
  // newly written Registry dependencies must not trigger a second pass.
  expect(meaningReads).toBeGreaterThan(0);expect(meaningReads).toBeLessThanOrEqual(3);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:20}).items.map(item=>item.text)).toEqual(['borrow']);
  expect(database.worldBrowse(query).total).toBe(1);expect(database.lookupMeanings('临时').meanings).toHaveLength(1);
  const identities=state.meanings[0]!.personalExpressionAnchors.map(anchor=>anchor.personalExpressionAnchorId);
  expect(database.existingJourneyIdentities(identities).sort()).toEqual(identities.sort());
 }finally{database.close();}
});

test('memory and SQLite World reads agree on a deleted unbound Meaning and keep active continuation independent of the selected partition',async()=>{
 const {repository,modules}=await seed(),gateway=modules.personalMeaningJourney,id=()=>crypto.randomUUID();
 const meaningId=(await repository.load()).meanings[0]!.personalMeaning.personalMeaningId;
 const {schemaVersion:_schema,...spec}=semanticLookupSpec;
 const clarification={languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},sense:{proposedSenseKey:'pending-loan-perspective',...spec,unresolvedQuestions:[]},expression:null,confirmExpression:false,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'fixture'},semanticPolicyVersion:'fixture'};
 await gateway.confirmClarification({...clarification,operationId:id(),personalMeaningId:meaningId,source:await gateway.captureClarificationSource('personal_meaning',meaningId),focus:{statement:'另一条尚未确认表达的借用视角',distinguishingNotes:[],aspectLabel:''}});
 const accepted=await modules.semanticIntake.submit(semanticLookupPayload());if(accepted.route!=='fast_track')throw Error('Expected a complete accepted source');
 await gateway.changeMeaningLifecycle({operationId:id(),personalMeaningId:accepted.personalMeaningId,expectedRevision:gateway.getDetail(accepted.personalMeaningId)!.revision,action:'delete'});
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory'),memory=new MemoryRecordAdapter();database.initialize();
 try{
  const state=await repository.load();
  // Read-adapter parity fixture only: represent a valid historical deleted
  // Meaning with no currently confirmed binding. This is not a public create
  // command permitting incomplete Meaning acceptance.
  state.meanings.find(record=>record.personalMeaning.personalMeaningId===accepted.personalMeaningId)!.bindingConfirmations=[];
  const mutation={clears:[],deletes:[],puts:rows(state),contentRevision:1};database.commit(mutation);await memory.commit(mutation);
  const trash=database.worldBrowse({...query,filter:'deleted'});
  expect(trash.items).toMatchObject([{personalMeaningId:accepted.personalMeaningId,status:'deleted'}]);
  expect(trash.pending).toBe(1);expect(trash.next?.personalMeaningId).toBe(meaningId);
  for(const filter of ['all','pending','deleted','binding','complete'] as const)for(const term of ['', 'borrow', 'no such context']){
   const selection={...query,filter,query:term};expect(await memory.worldBrowse(selection)).toEqual(database.worldBrowse(selection));
  }
 }finally{database.close();}
});

test('World pages preserve exact labels/phases, search private Context, and never change the public model lookup',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const {state,modules}=await seed();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  expect(database.worldBrowse(query)).toEqual({items:modules.personalMeaningJourney.getWorldItems().map(summarizeWorldItem),total:1,pending:0,next:null});
  const choices=modules.personalMeaningJourney.getLearningSources(state.meanings[0]!.personalMeaning.personalMeaningId).map(worldLearningChoice);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en'})).toEqual({items:choices,total:1});
  expect(database.worldLearningChoices({...query,query:'ＭＡＹ',targetLanguageTag:'en'}).items).toEqual(choices);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'fr'}).total).toBe(0);
  expect(database.worldLearningChoices({...query,filter:'binding',targetLanguageTag:'en'}).total).toBe(0);
  expect(database.worldBrowse({...query,query:'ＭＡＹ'}).total).toBe(1);
  expect(database.lookupMeanings('May').meanings).toEqual([]);
  expect(database.worldBrowse({...query,query:'%'}).total).toBe(0);
  expect(database.worldBrowse({...query,query:'临'}).total).toBe(1);
  expect(database.worldBrowse({...query,query:'临时'}).total).toBe(1);
  expect(database.worldBrowse({...query,filter:'complete'}).total).toBe(1);
  expect(database.worldBrowse({...query,filter:'binding'}).total).toBe(0);
  const next=advanceSemanticHeads(state);database.commit({clears:[],deletes:[],puts:rows(next).filter(row=>row.table==='semanticRegistry'),contentRevision:2});
  expect(database.worldBrowse(query).items[0]?.label).toBe('borrow');
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en'}).items).toEqual(choices);
  expect(database.worldBrowse({...query,query:'borrow-v2'}).total).toBe(0);
  const key=`senseVersions:${state.registry.senseVersions[0]!.senseVersionId}`,old=database.get('semanticRegistry',key)!;
  database.commit({clears:[],deletes:[{table:'semanticRegistry',key}],puts:[],contentRevision:3});
  expect(()=>database.worldBrowse(query)).toThrow('world_source_invalid');
  expect(()=>database.worldLearningChoices({...query,targetLanguageTag:'en'})).toThrow('world_source_invalid');
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:1}).items.map(item=>item.text),'Expression listening does not require the missing Sense dependency').toEqual(['borrow']);
  database.commit({clears:[],deletes:[],puts:[{table:'semanticRegistry',key,encodedValue:old}],contentRevision:4});
  expect(database.worldBrowse(query).total).toBe(1);
  database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(next)).filter(row=>row.table==='semanticMeanings'),contentRevision:5});
  expect(database.worldBrowse(query).total).toBe(0);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en'}).total).toBe(0);
 }finally{database.close();}
});

test('a failed World-index write rolls back source facts and existing pages; missing cache rebuilds unchanged sources',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const {state}=await seed();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const source=database.entries('semanticMeanings'),before=database.worldBrowse(query),choices=database.worldLearningChoices({...query,targetLanguageTag:'en'});
  raw.exec("CREATE TEMP TRIGGER reject_world_delete BEFORE DELETE ON sensa_world_browse BEGIN SELECT RAISE(ABORT,'fixture-world-index-failure'); END;");
  expect(()=>database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(state)).filter(row=>row.table==='semanticMeanings'),contentRevision:2})).toThrow('fixture-world-index-failure');
  expect(database.entries('semanticMeanings')).toEqual(source);expect(database.worldBrowse(query)).toEqual(before);
  raw.exec('DROP TRIGGER reject_world_delete;');
  raw.exec("CREATE TEMP TRIGGER reject_choice_delete BEFORE DELETE ON sensa_world_learning_choices BEGIN SELECT RAISE(ABORT,'fixture-choice-index-failure'); END;");
  expect(()=>database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(state)).filter(row=>row.table==='semanticMeanings'),contentRevision:2})).toThrow('fixture-choice-index-failure');
  expect(database.entries('semanticMeanings')).toEqual(source);expect(database.worldLearningChoices({...query,targetLanguageTag:'en'})).toEqual(choices);
  raw.exec('DROP TRIGGER reject_choice_delete;DROP TABLE sensa_world_browse_search;');
  // Initialization only replaces derived tables and their own metadata.
  new SqliteRecordDatabase(sqlite,raw,'memory').initialize();
  expect(database.worldBrowse(query)).toEqual(before);expect(database.entries('semanticMeanings')).toEqual(source);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en'})).toEqual(choices);
 }finally{database.close();}
});

test('one Meaning with multiple accepted bindings exposes every exact pin and separates target languages',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const repository=new MemoryJourneyRepository(),gateway=createJourneyModules({repository,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
  const draft=await gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:'May asked to borrow an umbrella.'}]});
  const expressions=[{surfaceForm:'borrow',languageTag:'en',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},{surfaceForm:'take on loan',languageTag:'en',expressionType:'phrase' as const,relation:'realizes' as const,semanticCoverage:'exact' as const},{surfaceForm:'emprunter',languageTag:'fr',expressionType:'word' as const,relation:'realizes' as const,semanticCoverage:'exact' as const}];
  const {schemaVersion:_schema,...spec}=semanticLookupSpec;
  const accepted=await gateway.completeClarificationDraft({operationId:crypto.randomUUID(),intakeId:draft.intakeId,source:await gateway.captureClarificationSource('intake',draft.intakeId),context:semanticLookupPayload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:{statement:'临时借用物品',distinguishingNotes:[],aspectLabel:''},sense:{proposedSenseKey:'temporary-borrow',...spec,unresolvedQuestions:[]},expression:{...expressions[0]!},expressionCandidates:expressions,confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'fixture'},semanticPolicyVersion:'fixture'});
  for(const expression of expressions.slice(1)){
   const record=(await repository.load()).meanings[0]!,focus=gateway.getDetail(accepted.personalMeaningId)!.focuses[0]!;
   const candidate=record.proposalVersions[0]!.expressionCandidates.find(candidate=>candidate.surfaceForm===expression.surfaceForm)!;
   await gateway.confirmExpressionBinding({operationId:crypto.randomUUID(),personalMeaningId:accepted.personalMeaningId,source:await gateway.captureClarificationSource('personal_meaning',accepted.personalMeaningId),meaningFocusId:focus.meaningFocusId,senseVersionId:focus.alignment!.senseVersionId,candidateId:candidate.candidateId,...expression});
  }
  database.commit({clears:[],deletes:[],puts:rows(await repository.load()),contentRevision:1});
  const sources=gateway.getLearningSources(accepted.personalMeaningId);
  expect(sources).toHaveLength(3);
  const en=database.worldLearningChoices({...query,targetLanguageTag:'en'});
  expect(en.total).toBe(2);expect(en.items.map(choice=>choice.label).sort()).toEqual(['borrow','take on loan']);
  expect(new Set(en.items.map(choice=>choice.reference.personalMeaningAlignmentId)).size).toBe(1);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en',limit:1,offset:1}).items[0]?.key).not.toBe(database.worldLearningChoices({...query,targetLanguageTag:'en',limit:1}).items[0]?.key);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'fr'}).items).toEqual(sources.filter(source=>source.targetLanguageTag==='fr').map(worldLearningChoice));
 }finally{database.close();}
});

test('a SQLite read failure during World maintenance is not converted into committed corrupt-source metadata',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const {state,modules,repository}=await seed();database.commit({clears:[],deletes:[],puts:rows(state),contentRevision:1});
  const before=database.worldBrowse(query),source=database.entries('semanticMeanings'),materialFrame=database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:1}).revision;
  const id=state.meanings[0]!.personalMeaning.personalMeaningId;
  await modules.personalMeaningJourney.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:id,expectedRevision:state.meanings[0]!.personalMeaning.currentRevision,blocks:[{kind:'text',bodyText:'Changed private source'}]});
  expect(modules.personalMeaningJourney.getDetail(id)?.materialBlocks[0]?.bodyText).toBe('Changed private source');
  const replacement=rows(await repository.load()).filter(row=>row.table==='semanticMeanings');
  const get=database.get.bind(database);let meaningReads=0,injected=false;
  database.get=(table,key)=>{
   if(table==='semanticMeanings'&&key===id)meaningReads++;
   // The public lookup projection reads the changed Meaning first. Inject
   // only into the succeeding PRIVATE World projection's dependency read.
   if(table==='semanticRegistry'&&meaningReads>=2){injected=true;throw new Error('fixture-sqlite-read-failure');}
   return get(table,key);
  };
  expect(()=>database.commit({clears:[],deletes:[],puts:replacement,contentRevision:2})).toThrow('fixture-sqlite-read-failure');
  expect(injected).toBe(true);expect(meaningReads).toBe(2);
  database.get=get;expect(database.entries('semanticMeanings')).toEqual(source);expect(database.worldBrowse(query)).toEqual(before);
  database.commit({clears:[],deletes:[],puts:replacement,contentRevision:2});
  expect(database.worldBrowse({...query,query:'May asked'}).total,'retired capture remains searchable after Context replacement').toBe(1);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:1}).revision,'Context-only changes do not revise Expression material').toBe(materialFrame);
 }finally{database.close();}
});

describe('private World reads over a prepared synthetic 10k library',()=>{
 let raw:InstanceType<typeof sqlite.oo1.DB>,database:SqliteRecordDatabase;
 beforeAll(async()=>{
  const started=performance.now();
  raw=new sqlite.oo1.DB(':memory:');database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
  const {state}=await seed(),world=syntheticSemanticWorld(state,10_000);
  const puts=rows(world);
  database.commit({clears:[],deletes:[],puts,contentRevision:1});
  console.log('SQLite synthetic fixture preparation:',{meanings:10_000,records:puts.length,preparationMs:Math.round(performance.now()-started)});
 // This watchdog covers synthetic generation, encoding and bulk index setup,
 // not user-facing lookup latency. CI's initial full fixture exceeded 60s.
 },120_000);
 afterAll(()=>database?.close());
 test('10k World facts page/search without reading source rows or transporting private details/media',()=>{
  const started=performance.now();
  const originalGet=database.get.bind(database);let sourceReads=0;
  database.get=(table,key)=>{if(table==='semanticMeanings'||table==='semanticRegistry')sourceReads++;return originalGet(table,key);};
  const page=database.worldBrowse({...query,limit:40}),last=database.worldBrowse({...query,offset:9960,limit:40});
  const choices=database.worldLearningChoices({...query,targetLanguageTag:'en',limit:64});
  expect(choices.total).toBe(10_000);expect(choices.items).toHaveLength(64);
  expect(JSON.stringify(choices.items)).not.toContain('May asked');expect(choices.items.every(choice=>!('context'in choice)&&!('semanticSpec'in choice))).toBe(true);
  expect(choices.items.every(choice=>!('practiceTarget'in choice))).toBe(true);
  const materials=database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:64});
  expect(materials.total).toBe(10_000);expect(materials.items).toHaveLength(64);
  expect(materials.items.every(item=>JSON.stringify(Object.keys(item).sort())===JSON.stringify(['id','languageTag','source','text']))).toBe(true);
  expect(JSON.stringify(materials)).not.toContain('May asked');expect(JSON.stringify(materials)).not.toContain('senseVersion');
  const identityPage=database.practiceExpressions({source:'personal',languageTag:'en',query:'',offset:0,limit:256,idsOnly:true});
  expect(identityPage.items).toEqual([]);expect(identityPage.ids).toHaveLength(256);
  expect(identityPage.ids.every(id=>id.length===36&&!id.includes('borrow'))).toBe(true);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'ＢＯＲＲＯＷ-９９９９',offset:0,limit:1}).items.map(item=>item.text)).toEqual(['borrow-9999']);
  expect(database.practiceExpressions({source:'personal',languageTag:'en',query:'',selectedIds:materials.ids.slice(0,2),offset:0,limit:1}).total).toBe(2);
  expect(database.practiceExpressions({source:'personal',languageTag:'fr',query:'',offset:0,limit:1}).total).toBe(0);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en',query:'ＢＯＲＲＯＷ-９９９９'}).items.map(choice=>choice.label)).toEqual(['borrow-9999']);
  expect(database.worldLearningChoices({...query,targetLanguageTag:'en',offset:9960,limit:40}).items).toHaveLength(40);
  expect(page.total).toBe(10_000);expect(page.items).toHaveLength(40);expect(last.items).toHaveLength(40);
  expect(new Set([...page.items,...last.items].map(item=>item.personalMeaningId)).size).toBe(80);
  // The learner's existing compact preview remains visible; the complete
  // private Context and detail/media payload are not list transport data.
  expect(page.items[0]?.primaryLabel).toBe('Private source: May aske…');
  expect(JSON.stringify(page.items)).not.toContain('May asked to borrow an umbrella.');expect(page.items.every(item=>!('detail'in item))).toBe(true);
  expect(database.worldBrowse({...query,query:'ＢＯＲＲＯＷ-９９９９'}).items.map(item=>item.label)).toEqual(['borrow-9999']);
  expect(database.worldBrowse({...query,query:'临时'}).total).toBe(10_000);
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
  console.log('SQLite synthetic 10k / private identity reservations / physical cache bytes:',identityBytes);
  expect(identityBytes,'identity cache should not repeat table/key/UUID text per reservation').toBeLessThan(32*1024*1024);
  expect(raw.selectValue('SELECT MAX(length(identity_id)) FROM sensa_journey_identities')).toBe(16);
  const plans=raw.exec({sql:'EXPLAIN QUERY PLAN SELECT summary_json FROM sensa_world_browse WHERE visible=1 ORDER BY updated_at DESC,meaning_id LIMIT 40',rowMode:'object',returnValue:'resultRows'}) as {detail:string}[];
  expect(plans.some(row=>row.detail.includes('USING INDEX sensa_world_browse_order'))).toBe(true);
  expect(()=>database.worldBrowse({...query,limit:257})).toThrow('world_query_invalid');
  console.log('SQLite prepared synthetic 10k read assertions:',{queryAndAssertionMs:Math.round(performance.now()-started)});
 },60_000);
});

test('Expression cache rebuild and failed updates preserve all source facts, with independent downloaded material',async()=>{
 const raw=new sqlite.oo1.DB(':memory:'),database=new SqliteRecordDatabase(sqlite,raw,'memory');database.initialize();
 try{
  const {state}=await seed(),book=directPublishedFixture().pack;
  // Controlled cache representation: exercise every entry, deduplication and
  // language filtering, not another assertion of public package admission.
  const pack=structuredClone(book);pack.content.entries=[book.content.entries[0]!,{...book.content.entries[0]!,expression:'water'},book.content.entries[0]!];
  database.commit({clears:[],deletes:[],puts:[...rows(state),{table:'packageCache',key:pack.key,encodedValue:encode(pack)},{table:'settings',key:'fixture-language-routes',encodedValue:encode(['en','es'])}],contentRevision:1});
  const personal={source:'personal' as const,languageTag:'en',query:'',offset:0,limit:20},downloaded={...personal,source:'books' as const};
  expect(database.practiceExpressions(downloaded).items.map(item=>item.text)).toEqual(['borrow','water']);
  expect(database.practiceExpressions({...downloaded,languageTag:'fr'}).total).toBe(0);
  expect(database.count('learningTargets')).toBe(0);expect(database.count('curriculumEnrollments')).toBe(0);
  const sourceTables=['semanticMeanings','semanticRegistry','packageCache','settings'] as const;
  const before=sourceTables.map(table=>database.entries(table)),material=database.practiceExpressions(personal);
  raw.exec("CREATE TEMP TRIGGER reject_expression_delete BEFORE DELETE ON sensa_practice_expressions BEGIN SELECT RAISE(ABORT,'fixture-expression-index-failure'); END;");
  expect(()=>database.commit({clears:[],deletes:[],puts:rows(deleteFirstMeaning(state)).filter(row=>row.table==='semanticMeanings'),contentRevision:2})).toThrow('fixture-expression-index-failure');
  expect(sourceTables.map(table=>database.entries(table))).toEqual(before);expect(database.practiceExpressions(personal)).toEqual(material);
  raw.exec('DROP TRIGGER reject_expression_delete;DROP TABLE sensa_practice_expression_dependencies;');
  new SqliteRecordDatabase(sqlite,raw,'memory').initialize();
  expect(sourceTables.map(table=>database.entries(table))).toEqual(before);
  expect(database.practiceExpressions(personal).items).toEqual(material.items);
  expect(database.practiceExpressions(downloaded).items.map(item=>item.text)).toEqual(['borrow','water']);
  const versionKey=`expressionVersions:${state.registry.expressionVersions[0]!.expressionVersionId}`,version=database.get('semanticRegistry',versionKey)!;
  database.commit({clears:[],deletes:[{table:'semanticRegistry',key:versionKey}],puts:[],contentRevision:2});
  expect(()=>database.practiceExpressions(personal)).toThrow('practice_material_source_invalid');
  expect(database.practiceExpressions(downloaded).total).toBe(2);
  database.commit({clears:[],deletes:[],puts:[{table:'semanticRegistry',key:versionKey,encodedValue:version}],contentRevision:3});
  expect(database.practiceExpressions(personal).items).toEqual(material.items);
 }finally{database.close();}
});
