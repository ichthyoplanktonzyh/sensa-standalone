import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useJourneyGateway,type JourneyDetailView} from '../personalMeaningJourney';
import type {WorldDetailSnapshot} from '../personalMeaningJourney/worldRepository';
import type {ChangeMeaningLifecycleInput} from '../personalMeaningJourney/types';
import {personalContentSystem} from '../../personalContent/system';
import {useOverlayStore} from '../stores/overlayStore';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {contentButton} from './ContentWorkspace';
import {settleReconciledOperation} from '../library/operationSettlement';
import {localFlowText} from '../../i18n/localFlowText';
import {PersonalMeaningCorrectionEditor} from './PersonalMeaningCorrectionEditor';

export function PersonalMeaningGovernance({detail,disabled,readCurrent,reload,onNotice}:{detail:JourneyDetailView;disabled:boolean;readCurrent:()=>Promise<WorldDetailSnapshot>;reload:()=>void;onNotice:(key:string)=>void}){
 const {t}=useTranslation(),gateway=useJourneyGateway(),openNote=useOverlayStore(state=>state.openNoteEditor);
 const [more,setMore]=useState(false),[pending,setPending]=useState<ChangeMeaningLifecycleInput|null>(null),[pendingFailure,setPendingFailure]=useState<string|null>(null),[busy,setBusy]=useState(false),[,redraw]=useState(0);
 const [correction,setCorrection]=useState<string|null>(null),[history,setHistory]=useState(false);
 const alignments=[...detail.directAlignments,...detail.focuses.flatMap(focus=>focus.alignment?[focus.alignment]:[])];
 const mounted=useRef(false),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const alignment=detail.focuses.find(focus=>focus.alignment?.confirmedBindings.length)?.alignment??detail.directAlignments.find(row=>row.confirmedBindings.length);
 const binding=alignment?.confirmedBindings[0],senseId=alignment?.senseId;
 const personal=senseId?personalContentSystem.read({kind:'sense',senseId}):null;
 useEffect(()=>personalContentSystem.subscribe({kind:'snapshot'},()=>redraw(value=>value+1)),[]);
 useEffect(()=>{
  if(!more)return;
  const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();setMore(false);trigger.current?.focus();}};
  document.addEventListener('keydown',dismiss);return()=>document.removeEventListener('keydown',dismiss);
 },[more]);
 const mutate=async(request:ChangeMeaningLifecycleInput)=>{
  setBusy(true);setPendingFailure(null);onNotice('');
  const result=await settleReconciledOperation(()=>gateway.changeMeaningLifecycle(request),async()=>{try{await readCurrent();}finally{reload();}});
  if(!mounted.current)return;
  setBusy(false);
  if(result.projection==='stale'){const key=result.kind==='committed'?'meaningGovernance.savedReadFailed':'meaningGovernance.unconfirmed';setPendingFailure(key);onNotice(key);return;}
  if(result.kind==='unconfirmed'){
   if(result.error instanceof Error&&result.error.message==='localFlow.meaningChanged'){setPending(null);onNotice('meaningGovernance.changed');}
   else{setPendingFailure('meaningGovernance.unconfirmed');onNotice('meaningGovernance.unconfirmed');}
   return;
  }
  setPending(null);
 };
 const choose=(action:'delete'|'restore')=>{
  setMore(false);setPendingFailure(null);
  const request={operationId:crypto.randomUUID(),personalMeaningId:detail.personalMeaningId,expectedRevision:detail.revision,action};
  if(action==='restore')void mutate(request);else setPending(request);
 };
 const favorite=async()=>{
  if(!senseId||!personal||personal.status!=='ready'||busy)return;
  setMore(false);setBusy(true);onNotice('');
  try{await personalContentSystem.execute({kind:'set_saved_sense',operationId:crypto.randomUUID(),senseId,saved:!personal.saved});}
  catch{if(mounted.current)onNotice('meaningGovernance.unconfirmed');}
  finally{if(mounted.current)setBusy(false);}
 };
 const locked=disabled||busy;
 return <div className="mb-4 flex flex-wrap gap-3">
  {detail.status==='deleted'?<button disabled={locked} className={contentButton+' border border-border-strong'} onClick={()=>choose('restore')}>{t('meaningGovernance.restore')}</button>
   :<button ref={trigger} disabled={locked} className={contentButton+' border border-border-subtle'} onClick={()=>setMore(true)}>{t('meaningGovernance.more')}</button>}
  {more&&<SensaOverlayLayout variant="popover" measure="compact" className="z-[100]" label={t('meaningGovernance.more')} onDismiss={()=>setMore(false)} dismissOnBackdrop regions={{primary:<div className="flex flex-col p-2">
   {senseId&&<button autoFocus disabled={locked||personal?.status!=='ready'} className={contentButton+' justify-start'} onClick={()=>void favorite()}>{t(personal?.status==='ready'&&personal.saved?'meaningGovernance.unfavorite':'meaningGovernance.favorite')}</button>}
   {personal?.status==='error'&&<p role="alert">{localFlowText('progressReadFailed')}<button className={contentButton} onClick={()=>void personalContentSystem.refresh().catch(()=>undefined)}>{t('meaningGovernance.retryRead')}</button></p>}
   {senseId&&binding&&<button disabled={locked} className={contentButton+' justify-start'} onClick={()=>{setMore(false);openNote(binding.surfaceForm,senseId,alignment!.coreMeaningFocus);}}>{t('meaningGovernance.note')}</button>}
   {alignments.filter(row=>row.confirmedBindings.length).map(row=><button key={row.personalMeaningAlignmentId} disabled={locked} className={contentButton+' justify-start'} onClick={()=>{setMore(false);setCorrection(row.personalMeaningAlignmentId);}}>{t('meaningGovernance.correct')}{alignments.length>1?' · '+row.confirmedBindings[0]!.surfaceForm:''}</button>)}
   {!!detail.alignmentHistory?.length&&<button disabled={locked} className={contentButton+' justify-start'} onClick={()=>{setMore(false);setHistory(true);}}>{t('meaningGovernance.history')}</button>}
   <button disabled={locked} className={contentButton+' justify-start text-feedback-danger'} onClick={()=>choose('delete')}>{t('meaningGovernance.remove')}</button>
  </div>}}/>}
  {pending&&<SensaOverlayLayout variant="dialog" measure="compact" className="z-[110]" label={t('meaningGovernance.deleteTitle')} onDismiss={()=>{if(!busy)setPending(null);}} dismissOnBackdrop onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();setPending(null);}}} regions={{
   header:<h2 className="text-lg font-medium">{t('meaningGovernance.deleteTitle')}</h2>,
   primary:<div className="text-sm leading-6"><p>{t('meaningGovernance.consequence')}</p>{pendingFailure&&<p role="alert" className="mt-3">{t(pendingFailure)}</p>}</div>,
   controls:<div className="flex flex-wrap gap-3"><button disabled={locked} className={contentButton+' bg-action-primary text-action-on-primary'} onClick={()=>void mutate(pending)}>{t('meaningGovernance.remove')}</button><button disabled={busy} className={contentButton} onClick={()=>setPending(null)}>{t('meaningGovernance.cancel')}</button></div>,
  }}/>}
  {correction&&<PersonalMeaningCorrectionEditor key={correction} meaningId={detail.personalMeaningId} alignmentId={correction} onClose={()=>setCorrection(null)} onSaved={()=>{setCorrection(null);reload();}} readCurrent={readCurrent}/>}
  {history&&<SensaOverlayLayout variant="sheet" measure="standard" className="z-[115]" label={t('meaningGovernance.history')} onDismiss={()=>setHistory(false)} dismissOnBackdrop regions={{header:<h2 className="text-xl font-medium">{t('meaningGovernance.history')}</h2>,primary:<div className="space-y-5">{detail.alignmentHistory?.map(row=><section key={row.personalMeaningAlignmentId}><h3 className="font-language text-xl">{row.confirmedBindings.map(binding=>binding.surfaceForm).join(' / ')}</h3><p className="mt-2 whitespace-pre-wrap">{row.coreMeaningFocus}</p></section>)}</div>,controls:<button className={contentButton} onClick={()=>setHistory(false)}>{t('content.close')}</button>}}/>}
 </div>;
}
