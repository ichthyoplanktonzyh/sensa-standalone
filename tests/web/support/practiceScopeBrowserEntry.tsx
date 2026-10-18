/** Shipped Practice workspace and real OPFS. Only read faults are controlled. */
import {createRoot,type Root} from 'react-dom/client';
import {RouterProvider,createRootRoute,createRoute,createRouter} from '@tanstack/react-router';
import '../../../apps/web/src/i18n/workspaceResources';
import i18n from '../../../apps/web/src/i18n';
import {PracticeWorkspace} from '../../../apps/web/src/experience/PracticeWorkspace';
import {LanguagePanelHost} from '../../../apps/web/src/experience/components/language/LanguagePanel';
import {ScreenMemoryProvider} from '../../../apps/web/src/experience/ui/ScreenHost';
import {practiceMaterialsRepository} from '../../../apps/web/src/experience/practiceMaterials';
import {practiceExpressionId} from '../../../apps/web/src/data/library/practiceExpressionProjection';
import {previewStorage} from '../../../apps/web/src/experience/services/previewStorage';
import {LibraryJourneyRepository,MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {restoreLibraryTransaction} from '../../../apps/web/src/data/library/store';
import {semanticLookupPayload} from './semanticLookupFixtures';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {addLanguageRoute,setActiveLanguageRoute} from '../../../apps/web/src/data/library/language';
import {sqliteRecordAdapter} from '../../../apps/web/src/data/library/sqliteAdapter';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/contentSupplySystem';
const preferenceKey='sensa.practice.materials.v4:en';
let root:Root|undefined,release:(()=>void)|undefined,barrier:Promise<unknown>|undefined;
let failPersonal=false,failBooks=false,failLearning=false,learningReads=0,heldLanguage:string|null=null;
let failLanguage=false,failAvailability=false;
let holdRouteAvailability=false;const routeAvailabilityHolds:Array<()=>void>=[];
let lostRouteCommitReplies=0,routeCommitCalls=0;
const materialListeners=new Set<()=>void>();
let holdStart=false;
let startQuery:Parameters<typeof readMaterials>[0]|null=null;
const pendingReads:Array<()=>Promise<void>>=[];
const readMaterials=practiceMaterialsRepository.page.bind(practiceMaterialsRepository),subscribeMaterials=practiceMaterialsRepository.subscribe.bind(practiceMaterialsRepository),readLearning=learningSystem.read.bind(learningSystem);
Object.defineProperty(practiceMaterialsRepository,'subscribe',{value:(listener:()=>void)=>{
 materialListeners.add(listener);const stop=subscribeMaterials(listener);
 return()=>{materialListeners.delete(listener);stop();};
}});
Object.defineProperty(practiceMaterialsRepository,'page',{value:(query:Parameters<typeof readMaterials>[0])=>{
 if(holdStart&&query.limit===1){startQuery=query;return new Promise((resolve,reject)=>pendingReads.push(async()=>{try{resolve(await readMaterials(query));}catch(error){reject(error);}}));}
 if(query.source==='books'&&failBooks)return Promise.reject(new Error('fixture book material read failure'));
 if(query.source==='personal'&&failPersonal)return Promise.reject(new Error('fixture personal material read failure'));
 if(query.languageTag===heldLanguage)return new Promise((resolve,reject)=>pendingReads.push(async()=>{try{resolve(await readMaterials(query));}catch(error){reject(error);}}));
 return readMaterials(query);
}});
Object.defineProperty(learningSystem,'read',{value:(query:Parameters<typeof readLearning>[0])=>{learningReads++;return failLearning?Promise.reject(new Error('fixture learning failure')):readLearning(query);}});
const readSupply=contentSupplySystem.read.bind(contentSupplySystem);
contentSupplySystem.read=async query=>{if(query.kind==='route_counts'&&failAvailability)throw new Error('fixture availability read failure');const result=await readSupply(query);if(query.kind==='route_counts'&&holdRouteAvailability)await new Promise<void>(resolve=>routeAvailabilityHolds.push(resolve));return result;};
export async function prepare(){
 await i18n.changeLanguage('zh-CN');
 const memory=new MemoryJourneyRepository(),modules=createJourneyModules({repository:memory,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 const saved=await modules.semanticIntake.submit(semanticLookupPayload());if(saved.route!=='fast_track')throw new Error('expected accepted fixture');
 const after=await memory.load(),repository=new LibraryJourneyRepository(),before=await repository.load();if(before.meanings.length)throw new Error('requires empty isolated origin');await repository.commit({before,after});
 const preference={source:'personal',expressionIds:[practiceExpressionId('borrow','en')]};previewStorage.setItem(preferenceKey,JSON.stringify(preference));return preference;
}
export function mount(languagePanel=false){
 const parent=createRootRoute({component:()=> <ScreenMemoryProvider>{languagePanel?<LanguagePanelHost onClose={()=>{}}/>:<PracticeWorkspace/>}</ScreenMemoryProvider>});
 const router=createRouter({routeTree:parent.addChildren([createRoute({getParentRoute:()=>parent,path:'/'}),createRoute({getParentRoute:()=>parent,path:'$'})])});
 root=createRoot(document.getElementById('root')!);root.render(<RouterProvider router={router}/>);
}
export async function holdAndMount(languagePanel=false){
 let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 barrier=restoreLibraryTransaction(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});});await waiting;mount(languagePanel);
}
export async function releaseRead(){release?.();release=undefined;await barrier;}
export function preference(){return JSON.parse(previewStorage.getItem(preferenceKey)??'null');}
export function currentExpression(){return JSON.parse(previewStorage.getItem('sensa.practice.current-expression.v4')??'null');}
export function expressionId(){return practiceExpressionId('borrow','en');}
export function holdStartRead(){holdStart=true;}
export function capturedStartQuery(){return startQuery;}
export async function changeLanguage(supportLanguage='zh-CN'){const route=await addLanguageRoute(crypto.randomUUID(),'fr',supportLanguage);await setActiveLanguageRoute(crypto.randomUUID(),route.id);}
export async function breakLanguageRead(){
 const adapter=await sqliteRecordAdapter(),get=adapter.get.bind(adapter);failLanguage=true;
 adapter.get=(table,key)=>table==='settings'&&key==='language-learning-routes'&&failLanguage?Promise.reject(new Error('fixture saved route read failure')):get(table,key);
}
export function repairLanguageRead(){failLanguage=false;}
export function breakAvailability(){failAvailability=true;}
export function repairAvailability(){failAvailability=false;}
export function holdAvailabilityReads(){holdRouteAvailability=true;}
export function availabilityReadsHeld(){return routeAvailabilityHolds.length;}
export function releaseFirstAvailabilityRead(){routeAvailabilityHolds.shift()?.();}
export function releaseAvailabilityReads(){holdRouteAvailability=false;for(const release of routeAvailabilityHolds.splice(0))release();}
export async function loseNextRouteCommitReply(){
 const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);let armed=true;
 adapter.commit=async mutation=>{await commit(mutation);if(mutation.puts.some(row=>row.table==='meta'&&row.key==='active-language-route:web')){routeCommitCalls++;if(armed){armed=false;lostRouteCommitReplies++;throw new Error('fixture route commit reply lost');}}};
}
export function lostRouteCommitReplyCount(){return lostRouteCommitReplies;}
export function routeCommitCallCount(){return routeCommitCalls;}
export function breakLearning(){failLearning=true;}
export function learningReadCount(){return learningReads;}
export function breakBooks(){failBooks=true;}
export function repairBooks(){failBooks=false;}
export function breakExpression(){failPersonal=true;for(const listener of materialListeners)listener();}
export function repairExpression(){failPersonal=false;for(const listener of materialListeners)listener();}
export async function breakSense(){
 const state=await new LibraryJourneyRepository().load(),value=state.registry.senseVersions[0]!;
 await restoreLibraryTransaction(async tx=>{tx.delete('semanticRegistry',`senseVersions:${value.senseVersionId}`);});
}
export async function changeLanguageWhileHoldingRead(){
 heldLanguage='fr';const route=await addLanguageRoute(crypto.randomUUID(),'fr','zh-CN');await setActiveLanguageRoute(crypto.randomUUID(),route.id);return route;
}
export function readIsHeld(){return pendingReads.length>0;}
export async function releaseMaterialRead(){heldLanguage=null;holdStart=false;const pending=pendingReads.splice(0);await Promise.all(pending.map(run=>run()));}
export function dispose(){release?.();root?.unmount();releaseAvailabilityReads();}
