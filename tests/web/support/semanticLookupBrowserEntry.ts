/** Test-only browser entry using the shipped gateway and real SQLite/OPFS adapter. */
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {LibraryJourneyRepository,MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {restoreLibraryTransaction,readLibraryStorageDiagnostics} from '../../../apps/web/src/data/library/store';
import {semanticLookupPayload,syntheticSemanticWorld,advanceSemanticHeads,deleteFirstMeaning} from './semanticLookupFixtures';
import type {MeaningLookupMatch} from '../../../apps/web/src/experience/personalMeaningJourney/meaningLookup';
import {worldReadRepository} from '../../../apps/web/src/experience/personalMeaningJourney/worldRepository';
import type {WorldBrowseQuery} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {WorldSnapshotReader} from '../../../apps/web/src/experience/personalMeaningJourney/worldReaders';

const repository=new LibraryJourneyRepository();
let held=false,release:(()=>void)|undefined,entered=false;
let measuring=false,refreshes=0;
const modules=createJourneyModules({repository:{load:()=>repository.load(),subscribe:listener=>repository.subscribe(listener),lookupMeanings:query=>repository.lookupMeanings(query),readReceipt:operationId=>repository.readReceipt(operationId),captureSource:(kind,id)=>repository.captureSource(kind,id),refresh:async(state,scope)=>{
  const start=performance.now(),result=await repository.refresh(state,scope);
  if(measuring&&refreshes++<3)console.log('semantic-lookup phase: refresh',performance.now()-start,'same frame',result===state);
  return result;
},commit:async change=>{
  if(held){held=false;entered=true;await new Promise<void>(resolve=>{release=resolve;});}
  return repository.commit(change);
}},clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
const gateway=modules.personalMeaningJourney;

export const initialize=()=>gateway.lookupMeanings('borrow');
export const submit=()=>modules.semanticIntake.submit(semanticLookupPayload());
export const submitPayload=(payload:ReturnType<typeof semanticLookupPayload>)=>modules.semanticIntake.submit(payload);
export const status=()=>gateway.getStatus();
export const storageDiagnostics=()=>readLibraryStorageDiagnostics();
export const replaceIncarnation=()=>restoreLibraryTransaction(async tx=>{tx.put('meta','local-incarnation',crypto.randomUUID());});
export const draft=(text='another borrower')=>gateway.createClarificationDraft({operationId:crypto.randomUUID(),blocks:[{kind:'text',bodyText:text}]});
export const lookup=(query='borrow')=>gateway.lookupMeanings(query);
export const worldPage=(query:WorldBrowseQuery)=>worldReadRepository.page(query);
export const worldDetail=(id:string)=>worldReadRepository.detail(id);
export const worldInbox=()=>worldReadRepository.inbox();
const inboxReader=new WorldSnapshotReader({subscribe:worldReadRepository.subscribe,read:worldInbox});
let stopInboxRead:(()=>void)|undefined;
export const watchInboxRead=()=>{stopInboxRead??=inboxReader.subscribe(()=>{});};
export const unwatchInboxRead=()=>{stopInboxRead?.();stopInboxRead=undefined;};
export const inboxReadState=()=>({status:inboxReader.read().status,ids:inboxReader.read().value?.items.map(item=>item.intakeId)??null});
export const dismissInbox=(intakeId:string)=>modules.semanticIntake.dismiss({operationId:crypto.randomUUID(),intakeId});
export const injectOrphanDraftHint=async()=>{const id=crypto.randomUUID();await restoreLibraryTransaction(async tx=>{tx.put('semanticDrafts',id,{intakeId:id,startingPoint:null});});return id;};
export const removeDraftHint=(id:string)=>restoreLibraryTransaction(async tx=>{tx.delete('semanticDrafts',id);});
function coldCommandGateway(){
 const holdScopedCommit:import('../../../apps/web/src/experience/personalMeaningJourney/repository').JourneyRepository['commit']=async change=>{
  if(held){held=false;entered=true;await new Promise<void>(resolve=>{release=resolve;});}return repository.commit(change);
 };
 const scopeCommit=(scoped:import('../../../apps/web/src/experience/personalMeaningJourney/repository').JourneyRepository)=>({...scoped,commit:async(change:Parameters<typeof holdScopedCommit>[0])=>{
  if(held){held=false;entered=true;await new Promise<void>(resolve=>{release=resolve;});}return scoped.commit(change);
 }});
 const scopedPort={load:()=>repository.load(),lookupMeanings:(query:string)=>repository.lookupMeanings(query),readReceipt:(id:string)=>repository.readReceipt(id),
  commit:holdScopedCommit,
  withMeaningCommand:async<T,>(input:Parameters<LibraryJourneyRepository['withMeaningCommand']>[0],ids:Parameters<LibraryJourneyRepository['withMeaningCommand']>[1],execute:(scoped:import('../../../apps/web/src/experience/personalMeaningJourney/repository').JourneyRepository,assigned:typeof ids)=>Promise<T>):Promise<T>=>repository.withMeaningCommand(input,ids,(scoped,assigned)=>execute(scopeCommit(scoped),assigned)),
  withDraftCreation:async<T,>(input:Parameters<LibraryJourneyRepository['withDraftCreation']>[0],ids:Parameters<LibraryJourneyRepository['withDraftCreation']>[1],execute:(scoped:import('../../../apps/web/src/experience/personalMeaningJourney/repository').JourneyRepository,assigned:typeof ids)=>Promise<T>):Promise<T>=>repository.withDraftCreation(input,ids,(scoped,assigned)=>execute(scopeCommit(scoped),assigned)),
  withClarificationCommand:async<T,>(input:Parameters<LibraryJourneyRepository['withClarificationCommand']>[0],ids:Parameters<LibraryJourneyRepository['withClarificationCommand']>[1],execute:(scoped:import('../../../apps/web/src/experience/personalMeaningJourney/repository').JourneyRepository,assigned:typeof ids)=>Promise<T>):Promise<T>=>repository.withClarificationCommand(input,ids,(scoped,assigned)=>execute(scopeCommit(scoped),assigned))};
 return createJourneyModules({repository:scopedPort,clock:createSeededClock('2026-10-04T00:00:00Z'),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}}).personalMeaningJourney;
}
export const reviseContext=(id:string,expectedRevision:number,text:string,operationId=crypto.randomUUID())=>coldCommandGateway().reviseContext({operationId,personalMeaningId:id,expectedRevision,blocks:[{kind:'text',bodyText:text}]});
export const createColdDraft=(text:string,operationId=crypto.randomUUID())=>coldCommandGateway().createClarificationDraft({operationId,blocks:[{kind:'text',bodyText:text}],startingPoint:'from_experience'});
export const receipt=(operationId:string)=>repository.readReceipt(operationId);
let stopCommandProbe:(()=>void)|undefined;
let commandReads:Array<{table:string;key:string}>=[];
export async function trackCommandReads(){
 if(stopCommandProbe)throw new Error('command probe already active');commandReads=[];
 const adapter=await sqliteRecordAdapter(),get=adapter.get.bind(adapter),entries=adapter.entries.bind(adapter),page=adapter.entriesPage.bind(adapter);
 adapter.get=async(table,key)=>{commandReads.push({table,key});return get(table,key);};
 adapter.entries=async table=>{if(table.startsWith('semantic'))throw new Error('cold command enumerated semantic source');return entries(table);};
 adapter.entriesPage=async(table,after,limit)=>{if(table.startsWith('semantic'))throw new Error('cold command paged the semantic source');return page(table,after,limit);};
 stopCommandProbe=()=>{adapter.get=get;adapter.entries=entries;adapter.entriesPage=page;stopCommandProbe=undefined;};
}
export const commandReadSnapshot=()=>[...commandReads];
export const stopTrackingCommandReads=()=>stopCommandProbe?.();
let versionRoot:unknown;
export async function removeVersionRoot(){await restoreLibraryTransaction(async tx=>{versionRoot=await tx.get('semanticState','root');tx.delete('semanticState','root');});}
export async function restoreVersionRoot(){if(!versionRoot)throw new Error('no removed root');await restoreLibraryTransaction(async tx=>{tx.put('semanticState','root',versionRoot);});}
export async function measureWorldRead(query='borrow-9999'){
 const started=performance.now(),page=await worldReadRepository.page({query:'',filter:'all',offset:0,limit:40}),firstPageMs=performance.now()-started;
 const searchStarted=performance.now(),found=await worldReadRepository.page({query,filter:'all',offset:0,limit:40}),searchMs=performance.now()-searchStarted;
 if(found.items.length!==1||found.items[0]!.label!==query)throw new Error('World query returned the wrong item');
 const detailStarted=performance.now(),detail=await worldReadRepository.detail(found.items[0]!.personalMeaningId),detailMs=performance.now()-detailStarted;
 if(detail.detail?.directAlignments[0]?.confirmedBindings[0]?.surfaceForm!==query)throw new Error('World detail returned the wrong fixed expression');
 return {total:page.total,rows:page.items.length,firstPageMs,searchMs,detailMs};
}
export const holdCommit=()=>{held=true;entered=false;};
export const commitEntered=()=>entered;
export const releaseCommit=()=>{release?.();release=undefined;};
export const captureSource=(intakeId:string)=>gateway.captureClarificationSource('intake',intakeId);
export const appendDraftMaterial=(intakeId:string,text:string)=>gateway.addClarificationMaterial(crypto.randomUUID(),intakeId,{kind:'text',bodyText:text});
export async function confirm(intakeId:string,match:MeaningLookupMatch,source?:Awaited<ReturnType<typeof captureSource>>,operationId=crypto.randomUUID()){
  return gateway.completeClarificationDraft({operationId,intakeId,source:source??await gateway.captureClarificationSource('intake',intakeId),context:semanticLookupPayload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
    sense:{proposedSenseKey:match.senseKey,reuseSense:{senseId:match.senseId,senseVersionId:match.senseVersionId},...match.semanticSpec,unresolvedQuestions:[]},
    expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],
    provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
}
export async function measureColdConfirmation(){
 const draft=await createColdDraft('a new capture accepted against an existing confirmed meaning');
 const match=(await lookup('borrow-9999')).meanings[0]!;
 const source=await captureSource(draft.intakeId),operationId=crypto.randomUUID();
 let previous=performance.now(),maxTimerGapMs=0;
 const timer=setInterval(()=>{const now=performance.now();maxTimerGapMs=Math.max(maxTimerGapMs,now-previous);previous=now;},10);
 try{
  const start=performance.now(),result=await coldConfirm(draft.intakeId,match,source,operationId),saveMs=performance.now()-start;
  await new Promise(resolve=>setTimeout(resolve,20));
  const detail=await worldDetail(result.personalMeaningId);
  return {saveMs,maxTimerGapMs,revision:detail.detail?.revision,expression:detail.detail?.directAlignments[0]?.confirmedBindings[0]?.surfaceForm,sourceRemoved:(await worldDetail(draft.intakeId)).draft===null,receipt:await receipt(operationId)};
 }finally{clearInterval(timer);}
}
export async function coldConfirm(intakeId:string,match:MeaningLookupMatch,source?:Awaited<ReturnType<typeof captureSource>>,operationId=crypto.randomUUID()){
 return coldCommandGateway().completeClarificationDraft({operationId,intakeId,source:source??await captureSource(intakeId),context:semanticLookupPayload().context!,languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},focus:null,
  sense:{proposedSenseKey:match.senseKey,reuseSense:{senseId:match.senseId,senseVersionId:match.senseVersionId},...match.semanticSpec,unresolvedQuestions:[]},expression:{surfaceForm:'borrow',languageTag:'en',expressionType:'word',relation:'realizes',semanticCoverage:'exact'},confirmExpression:true,transcript:[],provenance:{provider:'fixture',model:'fixture',promptVersion:'v9'},semanticPolicyVersion:'fixture-v1'});
}
export async function advanceHeads(){const before=await repository.load();await repository.commit({before,after:advanceSemanticHeads(before)});}
export async function deleteSource(){const before=await repository.load();await repository.commit({before,after:deleteFirstMeaning(before)});}
export async function checkpoint(){
  const state=await repository.load();
  return {meaningStatuses:state.meanings.map(row=>({id:row.personalMeaning.personalMeaningId,status:row.personalMeaning.status})),
    inboxIds:state.inboxItems.map(row=>row.intakeId).sort(),draftIds:state.clarificationDrafts.map(row=>row.intakeId).sort(),
    receiptIds:state.commandReceipts.map(row=>row.operationId).sort(),senseVersions:state.registry.senseVersions.map(row=>row.senseVersionId).sort()};
}
export function visible(){
  const items=gateway.getWorldItems();
  return items.map(item=>item.personalMeaningId);
}
let stopWatching:(()=>void)|undefined;
export function watch(){stopWatching??=gateway.subscribe(()=>undefined);}
export function unwatch(){stopWatching?.();stopWatching=undefined;}
export function inbox(){return modules.semanticIntake.snapshot().map(item=>item.intakeId).sort();}
export function learning(meaningId:string){return gateway.getLearningSources(meaningId).map(row=>({sense:row.reference.senseVersionId,binding:row.reference.bindingVersionId,expression:row.expression.surfaceForm}));}
let removedVersion:{key:string;value:unknown}|undefined;
export async function removeVersion(id:string){
  // Explicit corruption/fault injection, never a learner command or UAT seeding.
  await restoreLibraryTransaction(async tx=>{const key=`senseVersions:${id}`;removedVersion={key,value:await tx.get('semanticRegistry',key)};tx.delete('semanticRegistry',key);});
}
export async function restoreVersion(){
  const row=removedVersion;if(!row)throw new Error('no removed fixture version');
  await restoreLibraryTransaction(async tx=>{tx.put('semanticRegistry',row.key,row.value);});removedVersion=undefined;
}
export async function seed(count:number){
  const started=performance.now();
  const memory=new MemoryJourneyRepository();
  const fixture=createJourneyModules({repository:memory,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
  await fixture.semanticIntake.submit(semanticLookupPayload());
  const state=syntheticSemanticWorld(await memory.load(),count),before=await repository.load();
  if(before.meanings.length)throw new Error('capacity fixture requires its own empty browser context');
  await repository.commit({before,after:state});console.log('semantic-lookup phase: fixture committed',performance.now()-started);return state.meanings.length;
}
export async function measureQueries(query='borrow-9999'){
  measuring=true;
  let previous=performance.now(),maxTimerGapMs=0;
  const timer=setInterval(()=>{const now=performance.now();maxTimerGapMs=Math.max(maxTimerGapMs,now-previous);previous=now;},10);
  const firstStart=performance.now();console.log('semantic-lookup phase: first query start');
  const first=await gateway.lookupMeanings(query),firstQueryMs=performance.now()-firstStart;
  // Navigation timing's startTime is zero at this document's time origin;
  // includes module evaluation and storage initialization, not just the RPC.
  const navigation=performance.getEntriesByType('navigation')[0];
  const documentToFirstQueryMs=performance.now()-(navigation?.startTime??0);
  console.log('semantic-lookup phase: first query end',firstQueryMs);
  const times:number[]=[];
  for(let index=0;index<50;index++){
    const start=performance.now(),result=await gateway.lookupMeanings(query);times.push(performance.now()-start);
    if(!result.meanings.length||result.meanings.some(match=>!match.semanticSpec.coreMeaningFocus.includes(query)
      &&!match.expressions.some(expression=>expression.expression.includes(query))))throw new Error('capacity query returned the wrong fact');
    if(query.startsWith('borrow-')&&result.meanings[0]?.senseKey!==query)throw new Error('capacity query returned the wrong identity');
    if(index<3)console.log('semantic-lookup phase: warm query',index,times.at(-1));
  }
  console.log('semantic-lookup phase: warm queries end');
  await new Promise(resolve=>setTimeout(resolve,20));clearInterval(timer);times.sort((a,b)=>a-b);
  return {count:first.meanings.length,truncated:first.truncated,firstQueryMs,documentToFirstQueryMs,warmP95Ms:times[47]!,maxTimerGapMs};
}
