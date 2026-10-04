/** Actual scope hook/screens and OPFS, with an isolated read barrier and synthetic Study projection. */
import {createRoot,type Root} from 'react-dom/client';
import {useLayoutEffect,useState} from 'react';
import '../../../apps/web/src/i18n/workspaceResources';
import {usePracticeScope} from '../../../apps/web/src/experience/usePracticeScope';
import {AcademyScreen} from '../../../apps/web/src/experience/components/AcademyScreen';
import {PracticeScopeScreen} from '../../../apps/web/src/experience/components/PracticeScopeScreen';
import {ScreenMemoryProvider} from '../../../apps/web/src/experience/ui/ScreenHost';
import {previewStorage} from '../../../apps/web/src/experience/services/previewStorage';
import {createPracticeScopeSnapshot,PERSONAL_SEMANTIC_WORLD_SCOPE_ID,type PracticeStudyTarget,type PracticeScopeSnapshot} from '../../../apps/web/src/experience/practiceScope';
import {LibraryJourneyRepository,MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules,journeyGateway} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {createSeededClock} from '../../../apps/web/src/experience/personalMeaningJourney/ports';
import {restoreLibraryTransaction} from '../../../apps/web/src/data/library/store';
import {semanticLookupPayload} from './semanticLookupFixtures';
import {usePackageLearning} from '../../../apps/web/src/experience/library/usePackageLearning';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {languageRoutesSnapshot,updateLanguageRouteSupport} from '../../../apps/web/src/data/library/language';

const preferenceKey='sensa.free-practice.scope-selection.v2';
// Deliberately distinct from the saved Personal target. This is a resolver
// input, not a fabricated persisted Learning Target/outcome.
const studyTargets:PracticeStudyTarget[]=[{target:{
 targetId:'study-only',curriculumMembershipId:'study-membership',
 identity:{senseId:'study-sense',senseVersionId:'study-sense-version',bindingId:'study-binding',bindingVersionId:'study-binding-version'},
 presentation:{expression:'study-only',targetLanguageTag:'en'},
 material:{snapshot:{learningMaterializationId:'study-material',validationStatus:'validated'},content:{resources:[
  {materialRoleKey:'target_expression',contentPayload:{surface:'study-only'}},
  {materialRoleKey:'sense_confirmation',contentPayload:{meaning:'Synthetic Current Study fallback'}},
  {materialRoleKey:'language_structure',contentPayload:{expressionKind:'word'}},
 ]}},
}} as never];
let root:Root|undefined,session:PracticeScopeSnapshot|null=null;
let release:(()=>void)|undefined,barrier:Promise<unknown>|undefined;
let version:{key:string;value:unknown}|undefined;
let failWorkspaceRead=false;
let holdWorkspaceRead=false;
let pendingWorkspaceReads:Array<()=>Promise<void>>=[];
const routeFrames:Array<{revision:number;status:string}>=[];
const learningFailures:Array<{kind:string;message:string}>=[];
const readLearning=learningSystem.read.bind(learningSystem);
const executeLearning=learningSystem.execute.bind(learningSystem);
const readSupply=contentSupplySystem.read.bind(contentSupplySystem),executeSupply=contentSupplySystem.execute.bind(contentSupplySystem);
Object.defineProperty(contentSupplySystem,'read',{value:async(query:Parameters<typeof contentSupplySystem.read>[0])=>{
 try{return await readSupply(query);}catch(error){learningFailures.push({kind:'supply read '+query.kind,message:error instanceof Error?error.message:String(error)});throw error;}
}});
Object.defineProperty(contentSupplySystem,'execute',{value:async(command:Parameters<typeof contentSupplySystem.execute>[0])=>{
 try{return await executeSupply(command);}catch(error){learningFailures.push({kind:'supply execute '+command.kind,message:error instanceof Error?error.message:String(error)});throw error;}
}});
Object.defineProperty(learningSystem,'execute',{value:async(command:Parameters<typeof learningSystem.execute>[0])=>{
 try{return await executeLearning(command);}catch(error){learningFailures.push({kind:command.kind,message:error instanceof Error?error.message:String(error)});throw error;}
}});
// Controlled adapter failure at the public read interface. Source records and
// domain admission stay real; do not bypass SQLite protection to insert junk.
Object.defineProperty(learningSystem,'read',{value:(query:Parameters<typeof learningSystem.read>[0])=>{
 if(query.kind==='workspace'&&failWorkspaceRead)return Promise.reject(new Error('fixture learning workspace read failure'));
 if(query.kind==='workspace'&&holdWorkspaceRead)return new Promise((resolve,reject)=>pendingWorkspaceReads.push(async()=>{try{resolve(await readLearning(query));}catch(error){reject(error);}}));
 return readLearning(query);
}});

function Probe(){
 const scope=usePracticeScope({studyTargets,activeLanguageTag:'en'});
 const [view,setView]=useState<'academy'|'scope'>('academy');
 return <ScreenMemoryProvider>
  <output data-testid="scope-availability">{scope.availability}</output>
  {view==='academy'?<AcademyScreen active onBack={()=>{}} practiceScope={scope.catalog.currentScope}
   scopeAvailability={scope.availability} onRetryScope={scope.reload} onOpenPracticeScope={()=>setView('scope')}
   onOpenRealWorldListening={()=>{if(scope.availability!=='ready')return;session=createPracticeScopeSnapshot(scope.catalog.currentScope,crypto.randomUUID(),new Date().toISOString());}}/>
   :<PracticeScopeScreen active catalog={scope.catalog} scopeAvailability={scope.availability}
    onRetryScope={scope.reload} onBack={()=>setView('academy')} onSelectScope={scope.selectScope}/>}
 </ScreenMemoryProvider>;
}

function PackageProbe(){
 const learning=usePackageLearning(false);
 const scope=usePracticeScope({studyTargets:learning.activeTargets.map(target=>({target})),activeLanguageTag:learning.languageContext.targetLanguageTag});
 const availability=scope.availability==='unavailable'||learning.loadStatus==='unavailable'?'unavailable'
  :scope.availability==='loading'||learning.loadStatus==='loading'?'loading':'ready';
 useLayoutEffect(()=>{routeFrames.push({revision:learning.languageContext.languageRouteRevision,status:learning.loadStatus});},[learning.languageContext.languageRouteRevision,learning.loadStatus]);
 return <>
  <output data-testid="scope-availability">{availability}</output>
  <AcademyScreen active onBack={()=>{}} practiceScope={scope.catalog.currentScope}
   scopeAvailability={availability} onRetryScope={()=>{scope.reload();void learning.retryInitialLoad();}} onOpenPracticeScope={()=>{}}
   onOpenRealWorldListening={()=>{if(availability!=='ready')return;session=createPracticeScopeSnapshot(scope.catalog.currentScope,crypto.randomUUID(),new Date().toISOString());}}/>
 </>;
}

export async function prepare(){
 const memory=new MemoryJourneyRepository(),modules=createJourneyModules({repository:memory,clock:createSeededClock(),languages:{read:async()=>({targetLanguageTag:'en',supportLanguageTag:'zh-CN'})}});
 const saved=await modules.semanticIntake.submit(semanticLookupPayload());
 if(saved.route!=='fast_track')throw new Error('expected accepted fixture');
 const after=await memory.load(),repository=new LibraryJourneyRepository(),before=await repository.load();
 if(before.meanings.length)throw new Error('practice acceptance requires an empty isolated origin');
 await repository.commit({before,after});
 const reference=modules.personalMeaningJourney.getLearningSources(saved.personalMeaningId)[0]!.reference;
 const preference={sourceId:PERSONAL_SEMANTIC_WORLD_SCOPE_ID,targetIds:[`personal:${reference.personalMeaningAlignmentId}:${reference.bindingVersionId}`]};
 previewStorage.setItem(preferenceKey,JSON.stringify(preference));return preference;
}
export async function holdAndMount(){
 let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 barrier=restoreLibraryTransaction(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});});
 await waiting;root=createRoot(document.getElementById('root')!);root.render(<Probe/>);
}
export async function releaseRead(){release?.();release=undefined;await barrier;}
export function preference(){return JSON.parse(previewStorage.getItem(preferenceKey)??'null');}
export function snapshot(){return session;}
export async function breakVersion(){
 const state=await new LibraryJourneyRepository().load(),value=state.registry.senseVersions[0]!;
 version={key:`senseVersions:${value.senseVersionId}`,value:{kind:'senseVersions',ordinal:0,value}};
 // Explicit corruption injection to verify that unavailable sources cannot
 // silently replace the saved Personal choice with Current Study.
 await restoreLibraryTransaction(async tx=>{tx.delete('semanticRegistry',version!.key);});
 journeyGateway.reload();
}
export async function repairVersion(){
 if(!version)throw new Error('no version to repair');
 await restoreLibraryTransaction(async tx=>{tx.put('semanticRegistry',version!.key,version!.value);});
}
export async function breakLearningAndMount(){
 failWorkspaceRead=true;
 root=createRoot(document.getElementById('root')!);root.render(<PackageProbe/>);
}
export function repairLearning(){failWorkspaceRead=false;}
export function mountLearning(){root=createRoot(document.getElementById('root')!);root.render(<PackageProbe/>);}
export async function changeRouteWhileHoldingRead(){
 holdWorkspaceRead=true;
 const {activeRoute}=await languageRoutesSnapshot();
 return updateLanguageRouteSupport(crypto.randomUUID(),activeRoute.id,'ja');
}
export function observedRouteFrames(){return routeFrames;}
export function observedLearningFailures(){return learningFailures;}
export function readIsHeld(){return pendingWorkspaceReads.length>0;}
export async function releaseWorkspaceRead(){holdWorkspaceRead=false;const pending=pendingWorkspaceReads;pendingWorkspaceReads=[];await Promise.all(pending.map(run=>run()));}
export function dispose(){release?.();root?.unmount();}
