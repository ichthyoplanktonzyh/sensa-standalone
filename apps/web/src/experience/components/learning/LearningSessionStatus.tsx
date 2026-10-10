import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import '../../../i18n/accountResources';
import {localFlowText} from '../../../i18n/localFlowText';
import type {LearningSessionSummary} from '../../../learning/system/learningReadModels';
import type {CloudSyncState} from '../../../data/library/cloudSync';
import {useAccountExperience} from '../../account/AccountContext';

export function LearningSessionStatus({summary,repeatCount=0}:{summary:LearningSessionSummary|null;repeatCount?:number}){
 if(!summary)return <p role="status">{localFlowText('sessionSummaryUnavailable')}</p>;
 return <section aria-label={localFlowText('sessionCompleted')} className="mb-6 space-y-2 text-sm text-fg-secondary">
  <p><span data-session-completed>{localFlowText('sessionCompleted')} {summary.completedCount}</span><span className="mx-3" aria-hidden="true">·</span><span data-session-pending>{localFlowText('sessionPending')} {summary.pendingCount}</span></p>
  <p className="text-xs leading-5">{localFlowText('sessionQueueHint')}</p>
  {summary.completedCount>0&&<p className="text-xs">{localFlowText('completionLocalSaved')}</p>}
  {repeatCount>0&&<p data-session-repeat className="text-sm text-action-primary">{localFlowText('repeatHint')}</p>}
 </section>;
}

/** Read-only status: completion never starts or retries synchronization. */
function CompletionCloudStatus(){
 const {t}=useTranslation();
 const account=useAccountExperience();
 const [state,setState]=useState<CloudSyncState|undefined>();
 const [readState,setReadState]=useState<'loading'|'ready'|'error'>('loading');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true,generation=0,stop:undefined|(()=>void);
  setState(undefined);setReadState('loading');
  if(!account.onlineService)return ()=>{active=false;};
  void Promise.all([import('../../../data/library/cloudSync'),import('../../../data/library/store')]).then(([cloud,store])=>{
   if(!active)return;
   const refresh=()=>{const current=++generation;void cloud.readCloudSync().then(value=>{if(active&&current===generation){setState(value);setReadState('ready');}},()=>{if(active&&current===generation){setState(undefined);setReadState('error');}});};
   stop=store.observeCloudSync(refresh);refresh();
  }).catch(()=>{if(active)setReadState('error');});
  return ()=>{active=false;generation++;stop?.();};
 },[account.onlineService,account.email,retry]);
 const key=state?.error==='library_sync_identity'?'identity':state?.error==='library_sync_incompatible_checkpoint'?'incompatible':state?.failureKind==='terminal'?'attention':state?.status;
 return <div data-completion-cloud className="space-y-2 text-sm text-fg-secondary">
  <p role={readState==='error'?'alert':undefined} aria-live="polite">{!account.onlineService?t('account.localSync'):readState!=='ready'||!key?localFlowText('completionSyncUnknown'):t('cloudSync.'+key)}</p>
  {account.onlineService&&readState==='error'&&<button className="min-h-11 underline focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>setRetry(value=>value+1)}>{t('reliability.retry')}</button>}
 </div>;
}

export function LearningCompletionDetails({summary}:{summary:LearningSessionSummary|null}){
 const {i18n}=useTranslation();
 return <div className="mx-auto mt-6 max-w-xl space-y-5 text-left">
  {summary?<>
   <dl className="grid grid-cols-3 gap-3 rounded-card border border-border-subtle bg-surface-panel p-4 text-center">
    {(['initial_learning','retention_review','relearning'] as const).map(kind=><div key={kind}><dt className="text-xs text-fg-secondary">{localFlowText(kind==='initial_learning'?'initialRecord':kind==='retention_review'?'reviewRecord':'relearningRecord')}</dt><dd data-completion-kind={kind} className="mt-2 text-2xl font-medium">{summary.completed[kind]}</dd></div>)}
   </dl>
   <p data-completion-next-review className="text-sm text-fg-secondary">{summary.nextReviewAt?<>{localFlowText('nextReviewLabel')} <time dateTime={summary.nextReviewAt}>{new Intl.DateTimeFormat(i18n.resolvedLanguage??i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(summary.nextReviewAt))}</time></>:localFlowText('completionNoSchedule')}</p>
  </>:<p role="alert">{localFlowText('sessionSummaryUnavailable')}</p>}
  <div className="space-y-2 border-t border-border-subtle pt-4"><p data-completion-local className="text-sm font-medium">{localFlowText('completionLocalSaved')}</p><CompletionCloudStatus/></div>
  <p className="text-xs leading-5 text-fg-tertiary">{localFlowText('completionNotMastery')}</p>
 </div>;
}
