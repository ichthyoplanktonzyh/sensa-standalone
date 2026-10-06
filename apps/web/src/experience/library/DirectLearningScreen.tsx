import '../../i18n/learningResources';
import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {learningSystem,type DirectLearningChoicePage,type DirectLearningReference,type DirectLearningSource,type DirectLearningEnrollment} from '../../learning/system';
import {contentSupplySystem,type ContentProvisioningTask} from '../../contentSupply/system';
import {localFlowText,localFlowNotice,localFlowErrorKey} from '../../i18n/localFlowText';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {useScreenState} from '../ui/ScreenHost';

export function LearningEntryScreen({active,onBack,onCatalog,onDirect,onWorld}:{active:boolean;onBack:()=>void;onCatalog:()=>void;onDirect:()=>void;onWorld:()=>void}){
 const {t}=useTranslation();
 return <LearningSetupFrame id="s-learning-entry" active={active} title={t('study.add')} onBack={onBack}>
  <nav className="flex flex-wrap gap-4" aria-label={t('study.add')}>
   <button className={setupPrimary} onClick={onCatalog}>{localFlowText('packageCatalogTitle')}</button>
   <button className={setupButton} onClick={onDirect}>{t('directLearning.title',{ns:'learning'})}</button>
   <button className={setupButton} onClick={onWorld}>{localFlowText('semanticWorld')}</button>
  </nav>
 </LearningSetupFrame>;
}

export function DirectLearningScreen({active,languageContext,enrollmentId,onEnrolled,onBack,onCatalog,onSettings,onTarget}:{
 active:boolean;languageContext:SensaFormalPinnedLanguageContext;enrollmentId?:string;
 onEnrolled:(id:string)=>void;onBack:()=>void;onCatalog:()=>void;onSettings:()=>void;onTarget:(id:string)=>void;
}){
 const {t,i18n}=useTranslation(),locale=resolveInterfaceLocale(i18n.language),label=(key:string)=>t('directLearning.'+key,{ns:'learning'});
 const [query,setQuery]=useScreenState('direct-learning:query',''),[page,setPage]=useState(0);
 const [choices,setChoices]=useState<DirectLearningChoicePage|null>(null),[selection,setSelection]=useState<DirectLearningSource|null>(null);
 const [enrollment,setEnrollment]=useState<DirectLearningEnrollment|null>(null),[task,setTask]=useState<ContentProvisioningTask|null>(null);
 const [notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[clock,setClock]=useState(Date.now());
 const readSequence=useRef(0),controller=useRef<AbortController|null>(null),operation=useRef<string|null>(null),mounted=useRef(true),stopInFlight=useRef(false);
 const [stopping,setStopping]=useState(false);
 const contextKey=JSON.stringify(languageContext);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readSequence.current++;controller.current?.abort();};},[]);
 useEffect(()=>{if(!enrollmentId){readSequence.current++;setSelection(null);setEnrollment(null);setTask(null);setPage(0);operation.current=null;}},[contextKey,enrollmentId]);
 useEffect(()=>{
  if(!active||enrollmentId||selection)return;
  return learningSystem.subscribe({kind:'direct_choices',query,targetLanguageTag:languageContext.targetLanguageTag,page},()=>setRefresh(value=>value+1));
 },[active,query,page,contextKey,enrollmentId,selection]);
 useEffect(()=>{
  if(!active||enrollmentId||selection)return;
  const request=++readSequence.current;setLoading(true);setChoices(null);setNotice('');
  const timer=setTimeout(()=>{void learningSystem.read({kind:'direct_choices',query,targetLanguageTag:languageContext.targetLanguageTag,page}).then(result=>{
   if(mounted.current&&request===readSequence.current)setChoices(result);
  }).catch(error=>{if(mounted.current&&request===readSequence.current)setNotice(localFlowErrorKey(error,'localFlow.preparationReadFailed'));})
   .finally(()=>{if(mounted.current&&request===readSequence.current)setLoading(false);});},150);
  return()=>{clearTimeout(timer);readSequence.current++;};
 },[active,query,page,contextKey,enrollmentId,selection,refresh]);
 useEffect(()=>{
  if(!active||!enrollmentId)return;
  let live=true,generation=0;setLoading(true);setNotice('');
  const read=async()=>{const sequence=++generation;try{
   const [saved,current]=await Promise.all([learningSystem.read({kind:'direct_enrollment',enrollmentId}),contentSupplySystem.read({kind:'direct_provisioning_task',enrollmentId})]);
   if(!live||sequence!==generation)return;
   if(!saved)throw new Error('localFlow.enrollFirst');setEnrollment(saved);setSelection(saved.selection);setTask(current);
   if(saved.status==='removed')controller.current?.abort();
  }catch(error){if(live&&sequence===generation)setNotice(localFlowErrorKey(error,'localFlow.preparationReadFailed'));}
   finally{if(live&&sequence===generation)setLoading(false);}};
  void read();const stop=learningSystem.subscribe({kind:'direct_enrollment',enrollmentId},()=>void read()),stopTask=contentSupplySystem.subscribe({kind:'direct_provisioning_task',enrollmentId},()=>void read());
  return()=>{live=false;stop();stopTask();};
 },[active,enrollmentId,refresh]);
 useEffect(()=>{if(!task||!['generating','reviewing'].includes(task.status))return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[task?.id,task?.status]);
 const choose=async(reference:DirectLearningReference)=>{
  const request=++readSequence.current;setLoading(true);setNotice('');operation.current=null;
  try{const source=await learningSystem.read({kind:'direct_source',reference});if(mounted.current&&request===readSequence.current)setSelection(source);}
  catch(error){if(mounted.current&&request===readSequence.current)setNotice(localFlowErrorKey(error,'localFlow.meaningChanged'));}
  finally{if(mounted.current&&request===readSequence.current)setLoading(false);}
 };
 const run=async(work:()=>Promise<void>)=>{
  if(busy)return;setBusy(true);setNotice('');
  try{await work();}catch(error){if(mounted.current)setNotice(localFlowErrorKey(error,'localFlow.preparationFailed'));}
  finally{if(mounted.current){setBusy(false);setRefresh(value=>value+1);}}
 };
 const confirm=()=>run(async()=>{
  if(!selection)return;const locationAtConfirmation=window.location.href;operation.current??=crypto.randomUUID();
  const saved=await learningSystem.execute({kind:'enroll_direct',operationId:operation.current,reference:selection.reference,expectedDigest:selection.sourceDigest,languageContext});
  // The confirmed intent remains saved, but a late result must not undo Back.
  if(!mounted.current||window.location.href!==locationAtConfirmation)return;setEnrollment(saved);
  if(saved.enrollmentId){onEnrolled(saved.enrollmentId);await learningSystem.execute({kind:'prepare_direct',operationId:crypto.randomUUID(),enrollmentId:saved.enrollmentId});}
  else onTarget(saved.targetId);
 });
 const prepare=()=>run(async()=>{
  if(!enrollmentId)return;const abort=new AbortController();controller.current=abort;
  try{await contentSupplySystem.execute({kind:'prepare_direct_materialization',enrollmentId,signal:abort.signal});}finally{if(controller.current===abort)controller.current=null;}
 });
 const stop=async()=>{
  if(!task||stopInFlight.current)return;stopInFlight.current=true;setStopping(true);controller.current?.abort();
  try{await contentSupplySystem.execute({kind:'stop_provisioning',operationId:crypto.randomUUID(),taskId:task.id});}
  catch(error){if(mounted.current)setNotice(localFlowErrorKey(error,'localFlow.preparationFailed'));}
  finally{stopInFlight.current=false;if(mounted.current)setStopping(false);}
  if(mounted.current)setRefresh(value=>value+1);
 };
 const pinned=enrollment?.languageContext??languageContext,routeChanged=!!enrollment&&JSON.stringify(pinned)!==contextKey;
 const running=!!task&&['generating','reviewing'].includes(task.status)&&task.leaseUntil>clock;
 const routeLabel=`${interfaceLanguageDisplayName(pinned.targetLanguageTag,locale)} / ${interfaceLanguageDisplayName(pinned.supportLanguageTag,locale)}`;
 return <LearningSetupFrame id="s-direct-learning" active={active} title={label('title')} onBack={onBack}>
  <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-fg-secondary">{routeLabel}</p><button className={setupButton} onClick={onSettings}>{label('settings')}</button></div>
  {notice&&<div role="alert" className="my-4"><p>{localFlowNotice(notice)}</p>{(!selection||notice==='localFlow.preparationReadFailed')&&<button className={setupButton} disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{localFlowText('retryPreparation')}</button>}</div>}
  {routeChanged&&<p role="alert">{localFlowText('languageRouteChanged')}</p>}
  {loading&&<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>}
  {selection?<section className="space-y-5" aria-label={label('confirm')}>
   <h2 className="font-language text-3xl" lang={selection.targetLanguageTag}>{selection.expression.surfaceForm}</h2>
   <p className="text-body">{selection.semanticSpec.coreMeaningFocus}</p>
   <p className="text-sm text-fg-secondary">{selection.semanticSpec.prototypeScenes[0]?.summary}</p>
   {!!selection.binding.usageConstraints.length&&<ul>{selection.binding.usageConstraints.map((constraint,index)=><li key={index}>{constraint}</li>)}</ul>}
   <p className="text-xs text-fg-tertiary">{label(selection.reference.origin.kind==='published_package'?'published':'local')}</p>
   {task?.notice&&task.notice!==notice&&task.status!=='ready'&&<p role="status">{localFlowNotice(task.notice)}</p>}
   <div className="flex flex-wrap gap-3">
    {!enrollment&&!enrollmentId?<><button className={setupPrimary} disabled={busy||loading} onClick={()=>void confirm()}>{label('confirm')}</button><button className={setupButton} disabled={busy} onClick={()=>{readSequence.current++;setSelection(null);operation.current=null;}}>{localFlowText('cancel')}</button></>
     :enrollment?.status==='removed'?<button className={setupPrimary} disabled={busy||loading||routeChanged} onClick={()=>void run(async()=>{await learningSystem.execute({kind:'change_supplemental_membership',operationId:crypto.randomUUID(),source:{kind:'stable_sense',id:enrollment.enrollmentId!},expectedRevision:enrollment.membershipRevision??0,active:true,languageContext});})}>{localFlowText('restoreToLearning')}</button>
     :enrollment?.status==='already_in_scope'?<button className={setupPrimary} disabled={busy||loading||routeChanged} onClick={()=>onTarget(enrollment.targetId)}>{label('view')}</button>
      :running?<><p role="status">{localFlowText(task?.status==='reviewing'?'reviewing':'generating')}</p><button className={setupButton} disabled={stopping} onClick={()=>void stop()}>{localFlowText('stopPreparation')}</button></>
       :<button className={setupPrimary} disabled={busy||loading||routeChanged} onClick={()=>void prepare()}>{localFlowText(task&&task.status!=='waiting'?'retryPreparation':'prepareResources')}</button>}
   </div>
  </section>:!enrollmentId?<>
   <input className="mb-5 min-h-12 w-full rounded-control border border-border-subtle bg-surface-panel px-4" type="search" aria-label={label('search')} placeholder={label('search')} value={query} maxLength={500} onChange={event=>{setQuery(event.target.value);setPage(0);}}/>
   <ul className="divide-y divide-border-subtle">{choices?.items.map(choice=><li key={JSON.stringify(choice.reference)}><button className="w-full rounded-control px-3 py-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" disabled={loading} onClick={()=>void choose(choice.reference)}>
    <strong className="font-language text-xl" lang={languageContext.targetLanguageTag}>{choice.expression}</strong><span className="mt-2 block text-sm text-fg-secondary">{choice.meaning}</span><span className="mt-2 block text-xs text-fg-tertiary">{choice.publication?`${choice.publication.title} · v${choice.publication.version} · ${interfaceLanguageDisplayName(choice.publication.supportLanguageTag,locale)}`:label('local')}</span>
   </button></li>)}</ul>
   {!loading&&choices?.items.length===0&&<p role="status" className="py-8 text-fg-secondary">{label('empty')}</p>}
   <div className="my-6 flex flex-wrap gap-3"><button className={setupButton} disabled={loading||page===0} onClick={()=>setPage(value=>value-1)}>{label('previous')}</button><button className={setupButton} disabled={loading||!choices?.hasMore} onClick={()=>setPage(value=>value+1)}>{label('next')}</button><button className={setupButton} onClick={onCatalog}>{localFlowText('packageCatalogTitle')}</button></div>
  </>:null}
 </LearningSetupFrame>;
}
