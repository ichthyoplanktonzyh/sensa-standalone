/** A small Expression-practice workspace, independent of Learning controllers. */
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import '../i18n/workspaceResources';
import {useTranslation} from 'react-i18next';
import {observeLibrary} from '../data/library/store';
import {languageRoutesSnapshot} from '../data/library/language';
import {WorldSnapshotReader} from './personalMeaningJourney/worldReaders';
import {useShellNavigation} from './router/useShellNavigation';
import {ScreenHost} from './ui/ScreenHost';
import {AcademyScreen} from './components/AcademyScreen';
import {PracticeMaterialScreen} from './components/PracticeMaterialScreen';
import {YouGlishListeningScreen} from './components/YouGlishListeningScreen';
import {usePracticeMaterials,readPracticeMaterialSelection} from './usePracticeMaterials';
import {resolvePracticeExpression,type PracticeExpression,type PracticeMaterialSelection} from './practiceMaterials';
import {previewStorage} from './services/previewStorage';
import {practiceSurface,practiceButton,practiceBody} from './components/SensaFreePracticeScreen';
const currentKey='sensa.practice.current-expression.v4';
function remembered():{id:string;languageTag:string;source:'books'|'personal'}|null{
 try{const value=JSON.parse(previewStorage.getItem(currentKey)??'null');if(value&&typeof value.id==='string'&&typeof value.languageTag==='string'&&['books','personal'].includes(value.source))return value;}catch{/* Device preference only. */}return null;
}
export function PracticeWorkspace({active=true}:{active?:boolean}){
 const {t}=useTranslation(),{mainStack,goMain,backMain}=useShellNavigation();
 const currentScreen=mainStack.at(-1)??'s-academy',screenRef=useRef(currentScreen);screenRef.current=currentScreen;
 const routeReader=useMemo(()=>new WorldSnapshotReader({subscribe:(listener:()=>void)=>observeLibrary(listener,['settings','meta'],{settings:['language-learning-routes'],meta:['active-language-route:web','identity','local-incarnation']}),read:()=>languageRoutesSnapshot()}),[]);
 const route=useSyncExternalStore(routeReader.subscribe,routeReader.read);
 const languageTag=route.status.ok&&!route.status.loading?route.value?.activeRoute.targetLanguageTag??null:null;
 const languageRef=useRef(languageTag);languageRef.current=languageTag;
 // Playback restores one exact expression, not the material-selection overview.
 const materials=usePracticeMaterials(languageTag,currentScreen!=='s-real-world-listening');
 const [expression,setExpression]=useState<PracticeExpression|null>(null),[playSelection,setPlaySelection]=useState<PracticeMaterialSelection|null>(null);
 const [pickingExpression,setPickingExpression]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [restoreAttempt,setRestoreAttempt]=useState(0);
 const generation=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 const adopt=(item:PracticeExpression,selection:PracticeMaterialSelection)=>{
  setExpression(item);setPlaySelection(selection);setError('');setBusy(false);
  try{previewStorage.setItem(currentKey,JSON.stringify({id:item.id,languageTag:item.languageTag,source:selection.source}));}catch{/* Current playback does not require preference persistence. */}
 };
 const start=async()=>{
  if(!languageTag||materials.availability!=='ready'||busy||!materials.count)return;
  const epoch=++generation.current;setBusy(true);setError('');
  const previous=remembered();
  const candidate=previous?.languageTag===languageTag&&previous.source===materials.selection.source&&(!materials.selection.expressionIds||materials.selection.expressionIds.includes(previous.id))?previous.id:materials.preview[0]?.id;
  if(!candidate){setBusy(false);return;}
  try{const item=await resolvePracticeExpression(materials.selection,languageTag,candidate);
   if(!mounted.current||epoch!==generation.current||screenRef.current!=='s-academy'||languageRef.current!==languageTag)return;
   if(!item)throw new Error('practice_expression_missing');adopt(item,materials.selection);goMain('s-real-world-listening');
  }catch{if(mounted.current&&epoch===generation.current)setError(t('content.loadError'));}
  finally{if(mounted.current&&epoch===generation.current)setBusy(false);}
 };
 const choose=async(id:string)=>{
  const selection=playSelection??materials.selection,language=expression?.languageTag??languageTag;if(!language)throw new Error('practice_language_unavailable');
  const epoch=++generation.current,item=await resolvePracticeExpression(selection,language,id);
  if(!mounted.current||epoch!==generation.current||screenRef.current!=='s-practice-scope')throw new DOMException('Retired selection','AbortError');
  if(!item)throw new Error('practice_expression_missing');adopt(item,selection);backMain();
 };
 // Reopening reads only the remembered expression; failure never plays a different one.
 useEffect(()=>{
  if(currentScreen!=='s-real-world-listening'||expression)return;
  const stored=remembered(),epoch=++generation.current;let alive=true;
  if(!stored){setError(t('practice.empty'));return;}
  setBusy(true);setError('');
  const savedSelection=readPracticeMaterialSelection(stored.languageTag),selection=savedSelection?.source===stored.source?savedSelection:{source:stored.source,expressionIds:null};
  void resolvePracticeExpression(selection,stored.languageTag,stored.id).then(item=>{
   if(!alive||!mounted.current||epoch!==generation.current)return;
   if(!item)throw new Error('practice_expression_missing');adopt(item,selection);
  }).catch(()=>{if(alive&&mounted.current&&epoch===generation.current)setError(t('content.loadError'));}).finally(()=>{if(alive&&mounted.current&&epoch===generation.current)setBusy(false);});
  return()=>{alive=false;generation.current++;if(mounted.current)setBusy(false);};
 },[currentScreen,expression,t,restoreAttempt]);
 const readyRoute=route.status.ok&&!route.status.loading;
 const availability=!route.status.ok?'unavailable' as const:!readyRoute||busy?'loading' as const:materials.availability;
 const select=(selection:PracticeMaterialSelection)=>{
  generation.current++;materials.select(selection);setPickingExpression(false);setExpression(null);setPlaySelection(null);
  try{previewStorage.removeItem(currentKey);}catch{/* Explicit new material choice remains usable in this mount. */}
  backMain();
 };
 const retry=()=>{setError('');routeReader.reload();materials.reload();};
 const render=(screenActive:boolean)=>{
  if(currentScreen==='s-practice-scope')return <PracticeMaterialScreen key={`${pickingExpression}:${pickingExpression?expression?.languageTag:languageTag}`} active={screenActive} languageTag={pickingExpression?expression?.languageTag??languageTag:languageTag} selection={pickingExpression?playSelection??materials.selection:materials.selection} mode={pickingExpression?'expression':'selection'} onBack={backMain} onSelect={select} onChoose={choose}/>;
  if(currentScreen==='s-real-world-listening'){
   if(!expression)return <section id="s-real-world-listening" className={practiceSurface(screenActive)}><main className={practiceBody}><button className={practiceButton} onClick={backMain}>{t('practice.back')}</button>{busy?<p role="status">{t('reliability.loading')}</p>:<div role="alert"><p>{error||t('practice.empty')}</p><button className={practiceButton} onClick={()=>setRestoreAttempt(value=>value+1)}>{t('content.retry')}</button><button className={practiceButton} onClick={()=>goMain('s-practice-scope')}>{t('practice.choose')}</button></div>}</main></section>;
   return <YouGlishListeningScreen active={screenActive} expression={expression} onBack={backMain} onChooseExpression={()=>{setPickingExpression(true);goMain('s-practice-scope');}}/>;
  }
  return <><AcademyScreen active={screenActive} onBack={backMain} onOpenPracticeScope={()=>{setPickingExpression(false);goMain('s-practice-scope');}} onOpenRealWorldListening={()=>void start()} onBrowseContent={()=>goMain('s-catalog')} onRecordContext={()=>goMain('s-personal-meaning',{meaningId:undefined,focusId:undefined,worldAction:undefined})} selection={materials.selection} preview={materials.preview} count={materials.count} scopeAvailability={availability} onRetryScope={retry}/>{error&&<p role="alert" className="absolute bottom-5 left-6 z-30 text-sm text-fg-primary">{error}</p>}</>;
 };
 return <ScreenHost active={active} screenKey={currentScreen} memoryKey={currentScreen} preserveScroll>{render}</ScreenHost>;
}
