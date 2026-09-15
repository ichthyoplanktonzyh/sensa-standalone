import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {localModelQueue} from '../../data/library/modelExecution';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {setupButton} from './learning/LearningSetupFrame';
export function ModelExecutionPanel(){
 useTranslation();const [records,setRecords]=useState(localModelQueue.snapshot());
 useEffect(()=>localModelQueue.subscribe(()=>setRecords(localModelQueue.snapshot())),[]);
 return <section className="space-y-3 rounded-card border border-border-strong bg-surface-subtle p-5" aria-label={localFlowText('modelExecutionTitle')}>
  <h3 className="text-lg font-medium">{localFlowText('modelExecutionTitle')}</h3>
  <p className="text-sm">{localFlowText('modelExecutionPolicy',{active:records.filter(r=>r.state==='running').length,queued:records.filter(r=>r.state==='queued').length,max:localModelQueue.policy.maxConcurrent,providerMax:localModelQueue.policy.perProvider})}</p>
  <p className="text-sm text-fg-secondary">{localFlowText('modelExecutionScope')}</p>
  <button className={setupButton} onClick={localModelQueue.clear}>{localFlowText('modelExecutionClear')}</button>
  <ol className="divide-y divide-border-subtle">{records.slice(-15).reverse().map(r=><li key={r.id} className="space-y-1 break-all py-3 text-sm"><p>{r.model} · {r.execution==='device'?localFlowText('modelPlaceDevice'):localFlowText('modelPlaceService')} · {localFlowText(r.state==='queued'?'modelQueued':r.state==='running'?'modelRunning':r.state==='succeeded'?'modelSucceeded':r.state==='cancelled'?'modelCancelled':'modelFailed')}</p><p>{localFlowText('modelExecutionTiming',{wait:(r.startedAt??r.endedAt??Date.now())-r.queuedAt,run:r.startedAt?(r.endedAt??Date.now())-r.startedAt:0,input:r.inputTokens??'—',output:r.outputTokens??'—'})}</p>{r.traceId&&<p>{localFlowText('modelTrace',{id:r.traceId})}</p>}{r.error&&<p className="text-feedback-danger">{localFlowNotice(r.error.startsWith('localFlow.')?r.error:'localFlow.modelFailed')}</p>}</li>)}</ol>
 </section>;
}
