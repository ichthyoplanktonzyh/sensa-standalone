import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {learningSystem,type SupplementalMembershipProjection,type SupplementalMembershipPage} from '../../learning/system';
import {localFlowText} from '../../i18n/localFlowText';
import {useActiveLanguageContext} from './useActiveLanguageContext';
import {createRefreshCoordinator} from './refreshCoordinator';
import {settleReconciledOperation} from './operationSettlement';

const button='min-h-11 shrink-0 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus';
export function SupplementalPlanPanel({active}:{active:boolean}){
 const {t}=useTranslation(),context=useActiveLanguageContext(),routeKey=JSON.stringify(context),[positions,setPositions]=useState<(string|null)[]>([null]);
 const cursor=positions.at(-1)??null,key=JSON.stringify([context,cursor]),current=useRef(key);current.current=key;
 const [state,setState]=useState<{key:string;page:SupplementalMembershipPage|null;failed:boolean}>({key,page:null,failed:false});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[needsRead,setNeedsRead]=useState(false);
 const retry=useRef<()=>void>(()=>{}),saved=useRef(false);
 useEffect(()=>{setPositions([null]);},[routeKey]);
 useEffect(()=>{
  if(!active)return;let live=true;
  setState({key,page:null,failed:false});setBusy(false);setNotice('');setNeedsRead(false);saved.current=false;
  const coordinator=createRefreshCoordinator(async()=>{
   try{const page=await learningSystem.read({kind:'supplemental_memberships',languageContext:context,cursor});if(live&&current.current===key)setState({key,page,failed:false});}
   catch{if(live&&current.current===key)setState({key,page:null,failed:true});}
  });
  retry.current=()=>{void coordinator.request();};retry.current();
  const stop=learningSystem.subscribe({kind:'supplemental_memberships',languageContext:context,cursor},retry.current);
  return()=>{live=false;stop();};
 },[active,key]);
 const reread=async()=>{
  const page=await learningSystem.read({kind:'supplemental_memberships',languageContext:context,cursor});
  if(current.current===key)setState({key,page,failed:false});
 };
 const retryRead=async()=>{
  if(busy)return;setBusy(true);
  try{await reread();if(current.current===key){setNeedsRead(false);setNotice(saved.current?'':localFlowText('membershipUnconfirmed'));}}
  catch{if(current.current===key)setNotice(localFlowText(saved.current?'membershipSavedReadFailed':'progressReadFailed'));}
  finally{if(current.current===key)setBusy(false);}
 };
 const change=async(member:SupplementalMembershipProjection)=>{
  if(busy||needsRead)return;setBusy(true);setNotice('');
  const outcome=await settleReconciledOperation(()=>learningSystem.execute({kind:'change_supplemental_membership',operationId:crypto.randomUUID(),source:member.source,expectedRevision:member.revision,active:!member.active,languageContext:context}),reread);
  if(current.current!==key)return;
  saved.current=outcome.kind==='committed';setNeedsRead(outcome.projection==='stale');
  if(outcome.projection==='stale'){setState({key,page:null,failed:true});setNotice(localFlowText(saved.current?'membershipSavedReadFailed':'progressReadFailed'));}
  else if(outcome.kind==='unconfirmed')setNotice(localFlowText('membershipUnconfirmed'));
  setBusy(false);
 };
 if(!active)return null;const page=state.key===key?state.page:null,members=page?.members;
 return <>
  {!members&&!(state.key===key&&state.failed)&&<p role="status" aria-busy="true" className="mt-7 text-sm text-fg-tertiary">{localFlowText('loadingSensa')}</p>}
  {members&&<section className="mt-7 rounded-overlay border border-border-subtle bg-surface-panel p-6" aria-labelledby="supplemental-plan-title">
   <h2 id="supplemental-plan-title" className="text-lg font-medium">{localFlowText('supplementalLearning')}</h2>
   {members.length===0&&positions.length===1&&<p className="mt-3 text-sm text-fg-secondary">{localFlowText('supplementalEmpty')}</p>}
   <ul className="mt-3 divide-y divide-border-subtle">{members.map(member=><li key={member.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
    <div className="min-w-0 flex-1"><h3 className="break-words font-language font-medium" lang={context.targetLanguageTag}>{member.expression||localFlowText('semanticWorld')}</h3><p className="mt-1 text-sm text-fg-secondary">{localFlowText(!member.active?'membershipRemoved':member.readiness==='ready'?'learningReady':'learningPreparation')}</p></div>
    <button className={button} disabled={busy||needsRead} aria-label={`${localFlowText(member.active?'removeFromLearning':'restoreToLearning')} · ${member.expression}`} onClick={()=>void change(member)}>{localFlowText(member.active?'removeFromLearning':'restoreToLearning')}</button>
   </li>)}</ul>
   {(positions.length>1||page?.nextCursor)&&<nav className="mt-3 flex flex-wrap gap-3" aria-label={localFlowText('supplementalLearning')}><button className={button} disabled={busy||needsRead||positions.length===1} onClick={()=>setPositions(value=>value.slice(0,-1))}>{t('directLearning.previous')}</button><button className={button} disabled={busy||needsRead||!page?.nextCursor} onClick={()=>setPositions(value=>[...value,page!.nextCursor])}>{t('directLearning.next')}</button></nav>}
  </section>}
  {(notice||state.key===key&&state.failed)&&<div role="alert" className="mt-4"><p>{notice||localFlowText('progressReadFailed')}</p>{(needsRead||state.failed)&&<button className={button+' mt-3'} disabled={busy} onClick={()=>needsRead?void retryRead():retry.current()}>{localFlowText('retryPreparation')}</button>}</div>}
 </>;
}
