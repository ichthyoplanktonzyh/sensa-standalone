import {test,expect} from 'vitest';
import {WorldWindowReader,WorldDetailReader,WorldSnapshotReader,collectLearningChoices,type WorldReadPort} from '../../../apps/web/src/experience/personalMeaningJourney/worldReaders';
import type {WorldBrowseItem,WorldBrowseQuery} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import type {WorldPageSnapshot,WorldDetailSnapshot} from '../../../apps/web/src/experience/personalMeaningJourney/worldRepository';
import type {WorldLearningChoice,WorldLearningChoiceQuery} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import type {WorldLearningChoiceSnapshot} from '../../../apps/web/src/experience/personalMeaningJourney/worldRepository';
const item=(index:number):WorldBrowseItem=>({personalMeaningId:`meaning-${index}`,status:'active',label:`label-${index}`,primaryLabel:'private preview',updatedAt:'2026-10-04',
 senseFormation:{phase:'sense_confirmed',focusCount:0,acceptedFocusCount:0,pendingFocusCount:0,clarifyingFocusCount:0,proposalPendingCount:0,confirmedSenseCount:1,nextFocusId:null},
 expressionBinding:{phase:'bound',confirmedSenseCount:1,boundSenseCount:1,confirmedBindingCount:1,pendingBindingCount:0,nextFocusId:null}});
const page=(offset=0,revision=1,incarnation='one'):WorldPageSnapshot=>({incarnation,revision,total:10_000,pending:0,inboxCount:2,next:null,items:Array.from({length:64},(_,index)=>item(offset+index))});
const detail=(revision=1):WorldDetailSnapshot=>({incarnation:'one',revision,detail:null,draft:null,sources:[],source:null});
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('Inbox snapshot invalidation fences old reads and preserves loading/error/retry without fabricated empty success',async()=>{
 const pending:Array<{resolve:(value:{revision:number;items:string[]})=>void;reject:(error:Error)=>void;signal:AbortSignal}>=[];let notify=()=>{};
 const reader=new WorldSnapshotReader({subscribe:(listener:()=>void)=>{notify=listener;return()=>{};},read:signal=>new Promise<{revision:number;items:string[]}>((resolve,reject)=>pending.push({resolve,reject,signal}))});
 const stop=reader.subscribe(()=>{});expect(reader.read()).toMatchObject({value:null,status:{loading:true}});
 notify();expect(pending[0]!.signal.aborted).toBe(true);pending[0]!.resolve({revision:1,items:['stale']});await tick();expect(reader.read().value).toBeNull();
 pending[1]!.reject(new Error('Inbox unavailable'));await tick();expect(reader.read()).toMatchObject({value:null,status:{ok:false,loading:false}});
 reader.reload();pending[2]!.resolve({revision:3,items:['pending capture']});await tick();expect(reader.read().value?.items).toEqual(['pending capture']);
 notify();expect(reader.read().status.loading).toBe(true);pending[3]!.resolve({revision:4,items:[]});await tick();expect(reader.read()).toMatchObject({value:{revision:4,items:[]},status:{ok:true,loading:false}});
 reader.reload();stop();expect(pending[4]!.signal.aborted).toBe(true);pending[4]!.resolve({revision:5,items:['detached']});await tick();expect(reader.read().value?.revision).toBe(4);
});
function fixture(){
 let notify:()=>void=()=>{},connects=0,disconnects=0;
 const pages:Array<{query:WorldBrowseQuery;resolve:(page:WorldPageSnapshot)=>void;reject:(cause:Error)=>void}>=[];
 const details:Array<{id:string;resolve:(value:WorldDetailSnapshot)=>void;reject:(cause:Error)=>void}>=[];
 const port:WorldReadPort={subscribe:listener=>{connects++;notify=listener;return()=>{disconnects++;};},
  page:query=>new Promise((resolve,reject)=>pages.push({query,resolve,reject})),
  detail:id=>new Promise((resolve,reject)=>details.push({id,resolve,reject}))};
 return {port,pages,details,notify:()=>notify(),counts:()=>({connects,disconnects})};
}

test('a World window deduplicates concurrent reads, retains at most 512 summaries, and has no total-sized array',async()=>{
 const f=fixture(),reader=new WorldWindowReader(f.port,{query:'borrow',filter:'all'}),stop=reader.subscribe(()=>{});
 expect(reader.read().status.loading).toBe(true);expect(f.pages[0]!.query).toEqual({query:'borrow',filter:'all',offset:0,limit:64});
 f.pages[0]!.resolve(page());await tick();
 reader.request([63,64,65]);reader.request([63,64]);expect(f.pages).toHaveLength(2);
 f.pages[1]!.resolve(page(64));await tick();expect(reader.read().items.get(65)?.label).toBe('label-65');
 for(let index=2;index<20;index++){reader.request([index*64]);f.pages.at(-1)!.resolve(page(index*64));await tick();expect(reader.read().items.size).toBeLessThanOrEqual(512);}
 expect(reader.read().total).toBe(10_000);expect(reader.read().inboxCount).toBe(2);
 expect(()=>reader.request(Array.from({length:9},(_,index)=>index*64))).toThrow('world_window_too_wide');
 stop();expect(f.counts()).toEqual({connects:1,disconnects:1});
});

test('a new Library frame invalidates both cached and in-flight windows, including a replacement incarnation',async()=>{
 const f=fixture(),reader=new WorldWindowReader(f.port,{query:'',filter:'all'}),stop=reader.subscribe(()=>{});
 f.pages[0]!.resolve(page());await tick();reader.request([64,128]);expect(f.pages).toHaveLength(3);
 f.pages[2]!.resolve(page(128,2,'restored'));await tick();
 expect(reader.read().items.has(0)).toBe(false);expect(reader.read().items.get(128)?.label).toBe('label-128');
 f.pages[1]!.resolve(page(64));await tick();expect(reader.read().items.has(64)).toBe(false);
 reader.request([64,128]);f.pages.at(-1)!.resolve(page(64,2,'restored'));await tick();expect(reader.read().items.has(64)).toBe(true);
 stop();
});

test('notification and detach ignore late page success/failure; errors are not fabricated empty results and retry recovers',async()=>{
 const f=fixture(),reader=new WorldWindowReader(f.port,{query:'',filter:'all'}),stop=reader.subscribe(()=>{});
 f.notify();expect(f.pages).toHaveLength(2);
 f.pages[0]!.resolve(page());await tick();expect(reader.read().items.size).toBe(0);
 f.pages[1]!.reject(new Error('storage unavailable'));await tick();expect(reader.read().status.ok).toBe(false);expect(reader.read().status.loading).toBe(false);
 reader.reload();f.pages.at(-1)!.resolve({...page(),total:0,items:[]});await tick();expect(reader.read().status.ok).toBe(true);expect(reader.read().total).toBe(0);
 reader.reload();stop();const before=reader.read();f.pages.at(-1)!.reject(new Error('late'));await tick();expect(reader.read()).toBe(before);
});

test('rechecking or failed page reads cannot leave a stale continuation action or Inbox badge',async()=>{
 const f=fixture(),reader=new WorldWindowReader(f.port,{query:'',filter:'all'}),stop=reader.subscribe(()=>{});
 f.pages[0]!.resolve({...page(),pending:3,inboxCount:2,next:item(0)});await tick();
 expect(reader.read().next?.personalMeaningId).toBe('meaning-0');
 f.notify();expect(reader.read()).toMatchObject({next:null,pending:0,inboxCount:0});
 // The old total only reserves scroll geometry: there are no stale row actions.
 expect(reader.read().items.size).toBe(0);
 f.pages[1]!.reject(new Error('Library replaced'));await tick();expect(reader.read()).toMatchObject({next:null,pending:0,inboxCount:0});
 stop();
});

test('detail/draft/learning consumers share one connection; latest invalidation wins and explicit retry clears failure',async()=>{
 const f=fixture(),reader=new WorldDetailReader(f.port,'one'),first=reader.subscribe(()=>{}),second=reader.subscribe(()=>{});
 expect(f.details).toHaveLength(1);expect(f.counts().connects).toBe(1);
 f.notify();f.details[0]!.resolve(detail());await tick();expect(reader.read().status.loading).toBe(true);
 f.details[1]!.reject(new Error('read failed'));await tick();expect(reader.read().value).toBeNull();expect(reader.read().status.ok).toBe(false);
 reader.reload();f.details[2]!.resolve(detail(2));await tick();expect(reader.read().value?.revision).toBe(2);expect(reader.read().status.loading).toBe(false);
 reader.reload();expect(reader.read().value?.revision).toBe(2);expect(reader.read().status.loading).toBe(true);
 f.details[3]!.resolve(detail(3));await tick();
 first();expect(f.counts().disconnects).toBe(0);second();expect(f.counts().disconnects).toBe(1);
 const detach=reader.subscribe(()=>{});detach();const before=reader.read();f.details[4]!.resolve(detail(4));await tick();expect(reader.read()).toBe(before);
});

const choice=(index:number):WorldLearningChoice=>({key:`choice-${index}`,reference:{personalMeaningId:`meaning-${index}`,personalMeaningRevisionId:'revision',personalMeaningAlignmentId:`alignment-${index}`,alignmentRevision:1,alignmentBasisReferenceId:'basis',meaningFocusId:null,senseId:'sense',senseVersionId:'sense-version',expressionId:'expression',expressionVersionId:'expression-version',bindingId:'binding',bindingVersionId:'binding-version'},targetLanguageTag:'en',label:`borrow-${index}`});
const choicePage=(offset:number,limit:number,revision=1,incarnation='one'):WorldLearningChoiceSnapshot=>({revision,incarnation,total:10_000,items:Array.from({length:Math.min(limit,10_000-offset)},(_,index)=>choice(offset+index))});
const choiceQuery={query:'borrow',filter:'all' as const,targetLanguageTag:'en'};

test('compact choice windows share bounded caching without details; select-all covers every filtered binding',async()=>{
 const requests:WorldLearningChoiceQuery[]=[],port={subscribe:()=>()=>{},page:async(query:WorldLearningChoiceQuery)=>{requests.push(query);return choicePage(query.offset,query.limit);}};
 const reader=new WorldWindowReader<WorldLearningChoice,typeof choiceQuery>(port,choiceQuery),stop=reader.subscribe(()=>{});await tick();
 expect(reader.read().items.size).toBe(64);expect(reader.read().total).toBe(10_000);
 reader.request([9999]);await tick();expect(reader.read().items.get(9999)?.label).toBe('borrow-9999');expect(reader.read().items.size).toBeLessThanOrEqual(512);
 stop();requests.length=0;
 const selected=await collectLearningChoices({learningChoices:port.page},choiceQuery,new AbortController().signal);
 expect(selected).toHaveLength(10_000);expect(new Set(selected.map(choice=>choice.key)).size).toBe(10_000);expect(requests).toHaveLength(40);expect(requests.every(request=>request.limit===256&&request.targetLanguageTag==='en'&&request.query==='borrow')).toBe(true);
 expect(selected.some(choice=>'context'in choice||'semanticSpec'in choice)).toBe(false);
});

test('select-all rejects an inconsistent frame or cancelled read without publishing a partial result',async()=>{
 for(const replacement of [{revision:2,incarnation:'one'},{revision:1,incarnation:'restored'}]){
  let calls=0;
  await expect(collectLearningChoices({learningChoices:async query=>{const page=choicePage(query.offset,query.limit);return ++calls>1?{...page,...replacement}:page;}},choiceQuery,new AbortController().signal)).rejects.toThrow('localFlow.meaningChanged');
 }
 const controller=new AbortController();let calls=0;
 await expect(collectLearningChoices({learningChoices:async query=>{calls++;controller.abort();return choicePage(query.offset,query.limit);}},choiceQuery,controller.signal)).rejects.toThrow();expect(calls).toBe(1);
});

test('expression points preserve IDs, polysemy, real relation witnesses and isolated records under language filters',async()=>{
 const {expressionWorldFixture}=await import('../support/expressionWorldFixture');
 const {worldItemFromRegistry}=await import('../../../apps/web/src/experience/personalMeaningJourney/worldRead');
 const {buildMeaningGraph,relatedMeaningExpressions}=await import('../../../apps/web/src/experience/ui/meaningGraph');
 const state=await expressionWorldFixture(),items=state.meanings.map(record=>worldItemFromRegistry(record,state.registry));
 const graph=buildMeaningGraph(items);
 expect(graph.nodes).toHaveLength(6);expect(new Set(graph.nodes.map(node=>node.id)).size).toBe(6);
 expect(graph.nodes.filter(node=>node.label==='borrow')).toHaveLength(3);
 const polysemous=graph.nodes.find(node=>new Set(node.associations.map(row=>row.alignment.senseId)).size===2)!;
 expect(polysemous.label).toBe('borrow');expect(polysemous.associations).toHaveLength(2);
 expect(graph.edges.length).toBeGreaterThan(0);
 for(const node of graph.nodes){
  // Deliberately use the original pairwise oracle, independent of membership indexes.
  const expected=graph.nodes.filter(other=>other.id!==node.id).flatMap(other=>{
   const facts=new Map<string,{kind:'sense'|'meaning';id:string}>();
   for(const left of node.associations)for(const right of other.associations){
    if(left.alignment.senseId===right.alignment.senseId)facts.set(`sense:${left.alignment.senseId}`,{kind:'sense',id:left.alignment.senseId});
    if(left.item.personalMeaningId===right.item.personalMeaningId)facts.set(`meaning:${left.item.personalMeaningId}`,{kind:'meaning',id:left.item.personalMeaningId});
   }
   return facts.size?[{from:node.id,to:other.id,facts:[...facts.values()]}]:[];
  });
  expect(relatedMeaningExpressions(graph,node.id)).toEqual(expected);
 }
 const byId=new Map(graph.nodes.map(node=>[node.id,node]));
 for(const edge of graph.edges)for(const fact of edge.facts){
  const memberships=(id:string)=>byId.get(id)!.associations.map(row=>fact.kind==='sense'?row.alignment.senseId:row.item.personalMeaningId);
  expect(memberships(edge.from)).toContain(fact.id);expect(memberships(edge.to)).toContain(fact.id);
 }
 expect(new Set(graph.edges.flatMap(edge=>edge.facts.map(fact=>fact.kind)))).toEqual(new Set(['sense','meaning']));
 const isolated=graph.nodes.find(node=>node.label==='isolated expression')!;
 expect(graph.edges.some(edge=>edge.from===isolated.id||edge.to===isolated.id)).toBe(false);
 const fr=buildMeaningGraph(items,['fr']);expect(fr.nodes.map(node=>node.label)).toEqual(['emprunter']);expect(fr.edges).toEqual([]);
 expect(buildMeaningGraph(items,['en','fr']).nodes).toHaveLength(6);expect(buildMeaningGraph(items,['ja']).nodes).toEqual([]);
 expect(state.inboxItems).toHaveLength(1);expect(graph.nodes.some(node=>node.label.includes('尚待绑定'))).toBe(false);
 const large=await expressionWorldFixture(120),largeGraph=buildMeaningGraph(large.meanings.map(record=>worldItemFromRegistry(record,large.registry)));
 expect(largeGraph.nodes).toHaveLength(126);expect(new Set(largeGraph.nodes.map(node=>`${node.x}:${node.y}`)).size).toBe(126);
});
