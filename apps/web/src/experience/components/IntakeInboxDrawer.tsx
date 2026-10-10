import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {SensaIntakeItem} from '@sensa/contracts/sensa';
import {uiText} from '../../i18n/uiText';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {newUuid} from '../personalMeaningJourney/ids';
import {digestOf} from '../personalMeaningJourney/digest';
import type {JourneyGatewayStatus} from '../personalMeaningJourney/gateway';
import {useSemanticIntake} from '../intake';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {intakeSourceLabel} from '../personalMeaningJourney/sourcePresentation';
import {InboxMedia} from './InboxMedia';

interface IntakeInboxDrawerProps {
 open:boolean;
 drafts?:Array<{personalMeaningId:string;label:string}>;
 status?:JourneyGatewayStatus;
 onRetry?:()=>void;
 onOpenDraft?:(id:string)=>void;
 items:SensaIntakeItem[];
 onClose:()=>void;
 onSummoned:(intakeId:string)=>void;
 onResolved?:(personalMeaningId:string)=>void;
 onManual?:(item:SensaIntakeItem)=>void;
 toast:(message:string)=>void;
}
const statusLabels:Record<SensaIntakeItem['status'],()=>string>={
 pending_context:()=>uiText('addContext'),pending_sense:()=>uiText('confirmMeaning'),pending_expression:()=>uiText('selectExpression'),pending_acceptance:()=>uiText('readyForAcceptance'),
};
const action='min-h-12 rounded-control border border-border-strong px-5 text-control-label focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';
const safeSourceUrl=(value:string|null|undefined)=>{try{const url=new URL(value??'');return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};

/** Known material first, then the action for its actual missing fact. */
export function IntakeInboxDrawer({open,drafts=[],onOpenDraft,items,onClose,onSummoned,onResolved,onManual,toast,status,onRetry}:IntakeInboxDrawerProps){
 const {t}=useTranslation(),intake=useSemanticIntake();
 const [busyId,setBusyId]=useState<string|null>(null),[discarding,setDiscarding]=useState<SensaIntakeItem|null>(null),[failure,setFailure]=useState<{id:string;message:string}|null>(null);
 const busy=useRef(false),operations=useRef(new Map<string,string>());
 const [detailReady,setDetailReady]=useState(false),[detailError,setDetailError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!open)return;let active=true;setDetailError(false);void import('./PersonalMeaningDetailScreen').then(()=>{if(active)setDetailReady(true);}).catch(()=>{if(active)setDetailError(true);});return()=>{active=false;};},[open,attempt]);
 const close=()=>{if(!busy.current){setDiscarding(null);onClose();}};
 useEffect(()=>{if(!open)return;const listener=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);});
 const execute=async(item:SensaIntakeItem,kind:'resolve'|'discard')=>{
  if(busy.current)return;
  const expectedItemDigest=digestOf(item),key=kind+':'+item.intakeId+':'+expectedItemDigest;
  const operationId=operations.current.get(key)??newUuid();operations.current.set(key,operationId);
  busy.current=true;setBusyId(item.intakeId);setFailure(null);
  try{
   const command={operationId,intakeId:item.intakeId,expectedItemDigest};
   if(kind==='discard'){
    await intake.dismiss(command);setDiscarding(null);toast(uiText('materialDiscarded'));
   }else{
    if(!item.payload.sense)throw new Error(uiText('unableToProcessThisMaterial'));
    const result=await intake.resolve({...command,sense:structuredClone(item.payload.sense)});
    if(result.route!=='fast_track')throw new Error(uiText('unableToProcessThisMaterial'));
    toast(uiText('meaningConfirmedAndSaved'));onResolved?.(result.personalMeaningId);
   }
  }catch(cause){const message=cause instanceof Error?cause.message:uiText(kind==='discard'?'unableToDiscardThisMaterial':'unableToProcessThisMaterial');setFailure({id:item.intakeId,message:['localFlow.clarificationSourceChanged','localFlow.meaningChanged'].includes(message)?uiText('inboxMaterialChanged'):localFlowNotice(message)});}
  finally{busy.current=false;setBusyId(null);}
 };
 if(!open)return null;
 return <SensaOverlayLayout variant="sheet" measure="standard" className="sensa-intake-inbox z-[120]" labelledBy="intake-drawer-title" onDismiss={close} dismissOnBackdrop regions={{
  header:<div className="flex min-h-12 items-center justify-between gap-4"><h2 className="text-section-title font-semibold" id="intake-drawer-title">{status?.loading||status&&!status.ok?uiText('inbox'):uiText('inboxCount',{count:items.length+drafts.length})}</h2><button className={action} disabled={busyId!==null} type="button" onClick={close} aria-label={uiText('close')}>×</button></div>,
  primary:status?.loading?<div role="status" aria-busy="true" className="min-h-64 p-5">{localFlowText('loadingSensa')}</div>:status&&!status.ok?<div role="alert" className="min-h-64 space-y-4 p-5"><p>{uiText('unableToReadThisMaterial')}</p><button className={action} onClick={onRetry}>{t('content.retry')}</button></div>:<div>
   {detailError&&<div role="alert" className="mb-4"><p>{t('content.loadError')}</p><button className={action} onClick={()=>setAttempt(value=>value+1)}>{t('content.retry')}</button></div>}
   {drafts.map(item=><button key={item.personalMeaningId} type="button" onClick={()=>onOpenDraft?.(item.personalMeaningId)} className="mb-4 block w-full rounded-card border border-border-subtle p-5 text-left"><span className="text-xs text-fg-tertiary">{uiText('continueDraft')}</span><strong className="mt-3 block text-sm font-medium leading-6">{item.label}</strong></button>)}
   {items.map(item=>{
    const context=item.payload.context,source=context?.source,url=safeSourceUrl(source?.url),confirmable=item.status==='pending_acceptance'&&!!item.payload.sense;
    const confirmDiscard=discarding?.intakeId===item.intakeId;
    return <article className="mb-4 rounded-card border border-border-subtle bg-surface-panel p-5" key={item.intakeId} aria-busy={busyId===item.intakeId}>
     <header><span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">{statusLabels[item.status]()}</span></header>
     {(context?.textSegment||!item.payload.expression&&!item.payload.sense)&&<p className="mt-4 whitespace-pre-wrap break-words text-body leading-7 text-fg-primary">{context?.textSegment||item.summaryView}</p>}
     {item.payload.expression&&<p className="mt-3 break-words text-body font-medium">{item.payload.expression.surfaceForm}</p>}
     {item.payload.sense&&<p className="mt-3 whitespace-pre-wrap break-words text-body-support text-fg-secondary">{item.payload.sense.semanticSpec.coreMeaningFocus}</p>}
     {source&&<p className="mt-3 break-words text-metadata text-fg-tertiary">{url?<a href={url} target="_blank" rel="noreferrer" className="underline">{intakeSourceLabel(source)}</a>:intakeSourceLabel(source)}</p>}
     {!!context?.mediaReferenceIds.length&&<InboxMedia ids={context.mediaReferenceIds}/>}
     {failure?.id===item.intakeId&&<p role="alert" className="mt-4 text-sm text-status-error">{failure.message}</p>}
     {confirmDiscard?<div className="mt-5 space-y-3" role="group" aria-label={uiText('discard')}><p className="text-sm">{uiText('discardMaterialConfirmation')}</p><div className="flex gap-3"><button className={action} disabled={busyId!==null} onClick={()=>void execute(discarding!,'discard')}>{uiText('confirm')}</button><button className={action} disabled={busyId!==null} onClick={()=>setDiscarding(null)}>{localFlowText('cancel')}</button></div></div>:<footer className="mt-5 flex flex-wrap gap-3">
      {confirmable&&<button className={action+' bg-action-primary text-action-on-primary'} disabled={busyId!==null||!detailReady} onClick={()=>void execute(item,'resolve')}>{localFlowText('confirmSaveExpression')}</button>}
      <button className={action+(confirmable?' bg-surface-panel':' bg-action-primary text-action-on-primary')} disabled={busyId!==null||!detailReady} onClick={()=>onSummoned(item.intakeId)}>{localFlowText('continueConversation')}</button>
      {onManual&&<button className={action+' bg-surface-panel'} disabled={busyId!==null} onClick={()=>onManual(structuredClone(item))}>{t('manualMeaning.complete')}</button>}
      <button className={action+' bg-surface-panel'} disabled={busyId!==null} onClick={()=>{setDiscarding(structuredClone(item));setFailure(null);}}>{uiText('discard')}</button>
     </footer>}
    </article>;
   })}
   {!items.length&&!drafts.length&&<div className="flex min-h-64 items-center justify-center text-center"><p className="text-body-support text-fg-secondary">{uiText('yourInboxIsEmpty')}</p></div>}
  </div>,
 }}/>;
}
