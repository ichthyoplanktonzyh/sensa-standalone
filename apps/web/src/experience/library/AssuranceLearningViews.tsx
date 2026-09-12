import {LearnScreen} from '../components/LearnScreen';
import type {RuntimeToolsProps} from '../components/learning/RuntimeTools';
import {toReviewSpec} from '../content/prototypeReviewCards';
import {resolveReviewMemoryOutcome} from '../review/types';
import type {StepRendererHost} from '../learningRuntime/stepRenderers';
import type {CardExecution} from '../components/cards/CardExecution';
import {toWordPresentation} from '../content/learningCatalog';
import {ExampleScreen} from '../components/ExampleScreen';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {assuranceContent,assuranceView,localAssuranceState,type AssuranceAction} from '../../data/library/assurance';
import type {LocalLearningRun,LocalLearningTarget} from '../../data/library/learning';
import type {InstalledPackage} from '../../data/library/packages';
import {AssuranceSummary} from '../components/learning/AssuranceSummary';
import type {PrototypeIntroductionPackage} from '../content/learningCatalog';
export function StudyResources({content}:{content:PrototypeIntroductionPackage}){
 return <div className="space-y-6">
  <div><h2 className="text-3xl font-medium">{content.lemma}</h2><p className="mt-3 text-lg">{content.guideLabelL1}</p><p className="mt-3 text-sm leading-7 text-[#68748d]">{content.definitionL2}</p></div>
  <section className="space-y-3"><h3 className="font-medium">{localFlowText('assurancePronunciation')}</h3>{content.pronunciations.map(p=><div key={p.accentLocale} className="rounded-xl border border-[#dfe4ed] p-4"><p className="mb-3 text-sm">{p.accentLocale} · {p.ipa}</p>{p.audioUrl&&<audio controls preload="none" src={p.audioUrl} aria-label={localFlowText('assuranceAudio',{label:p.accentLocale})} className="w-full max-w-full"/>}</div>)}</section>
  <section className="space-y-4"><h3 className="font-medium">{localFlowText('assuranceExamples')}</h3>{content.learningExamples.map(e=><div key={e.exampleKey} className="space-y-3 rounded-xl border border-[#dfe4ed] p-4"><p className="text-lg leading-8">{e.textL2}</p><p className="text-sm leading-6 text-[#68748d]">{e.textL1}</p>{e.audioUrl&&<audio controls preload="none" src={e.audioUrl} aria-label={localFlowText('assuranceAudio',{label:e.textL2})} className="w-full max-w-full"/>}</div>)}</section>
  {content.supportTabs.flatMap(t=>t.patterns).map(p=><p key={p.canonicalPattern} className="text-sm leading-7">{p.canonicalPattern}</p>)}
 </div>;
}
export type AssuranceSupportHost = Pick<StepRendererHost, 'toast' | 'openDict' | 'openNoteEditor' | 'openSceneEditor' | 'lookupDictionary'> & Pick<RuntimeToolsProps, 'onOpenMenuMore'>;
export function AssuranceRuntime(props:{active:boolean;run:LocalLearningRun;target:LocalLearningTarget;pack:InstalledPackage;busy:boolean;notice:string;host:AssuranceSupportHost;onMarkKnown:()=>void;onAction:(action:AssuranceAction)=>void;onExit:()=>void;onFinish:()=>void}){
 useTranslation();
 const {run,pack,host}=props,view=assuranceView(run,pack),state=localAssuranceState(run);
 const [exampleIndex,setExampleIndex]=useState<number|null>(null);
 const resetScroll=()=>{document.getElementById('s-lightweight-runtime')?.scrollTo({top:0});};
 const [phase,setPhase]=useState<'experience'|'reveal'>(state.revealed?'reveal':'experience');
 useEffect(resetScroll,[run.id,run.revision]);
 const act=(response:AssuranceAction['response'])=>props.onAction({kind:'assurance',response});
 const content=view?.content,resource=view?.resource;

 const next=()=>act({kind:'continue'});
 const execution:CardExecution={mode:state.mode,feedback:state.feedback,continue:next,hint:mode=>act({kind:'hint',mode}),submit:answer=>act(answer===null?{kind:'skip'}:{kind:resource?.kind==='meaning_to_form_recall'?'try_recall':'answer',value:answer})};
 const runtimeHost:StepRendererHost={...host,openExample:(_sense,index=0)=>setExampleIndex(index),completeIntroduction:next,completeRecognition:next,completeMeaningToFormRecall:next,completeNovelTransfer:next,completeReviewAssessment:r=>execution.submit(r.responseId),continueReviewFeedback:next};
 const spec=resource&&content?toReviewSpec(resource,content):null;
 const result=spec&&state.feedback?{assessmentId:spec.id,kind:spec.kind,focusDimension:spec.focusDimension,correct:state.feedback.correct,responseId:state.feedback.answer||null,memoryOutcome:run.purpose==='initial_learning'?null:resolveReviewMemoryOutcome(spec.kind,state.feedback.correct),evidenceEligible:run.purpose!=='initial_learning'&&spec.evidenceEligible}:null;
 return <>
 {run.completedAt?<AssuranceSummary id="s-lightweight-runtime" active={props.active} review={run.purpose!=='initial_learning'} completed={[props.target.id]} declared={[]} targetPresentation={()=>props.target} continueLabel={localFlowText('assuranceContinueLearning')} onExit={props.onFinish}/>:view&&content&&<LearnScreen screenId="s-lightweight-runtime" hasTask active={props.active} isBehind={exampleIndex!==null} curWord={toWordPresentation(content)} stage={view.stepKind} step={view.action.ordinal} groupSize={view.action.totalTarget} introductionContent={content} repairContent={view.action.intent==='repair'?content:null} introductionPosition={1} introductionTotal={1} reviewAssessmentPurpose={run.purpose==='initial_learning'?'acquisition':'retention'} onExit={props.onExit} onUndo={()=>act({kind:'undo'})} onMarkKnown={props.onMarkKnown} onOpenMenuMore={host.onOpenMenuMore} reviewAssessmentKind={resource?.kind??null} reviewAssessmentTaskKey={resource?.taskKey??null} assessmentPackageIdentity={null} reviewAssessmentResult={result} repairResourceRef={view.action.repairResourceRef??null} host={runtimeHost} execution={execution} preparedAssessmentResource={resource??null} controlledPhase={phase} onControlledPhaseChange={nextPhase=>{if(nextPhase==='reveal'&&!state.revealed)act({kind:'reveal'});else{setPhase(nextPhase);resetScroll();}}} busy={props.busy} notice={props.notice&&<p role="alert" className="mb-6 rounded-xl bg-amber-50 p-4">{localFlowNotice(props.notice)}</p>}/>}
 {content&&exampleIndex!==null&&<ExampleScreen screenId="s-package-example" active={props.active} curWord={toWordPresentation(content)} initialSentenceIdx={exampleIndex} sentenceSequence={content.learningExamples.map((_,i)=>i)} onClose={()=>setExampleIndex(null)} onOpenDict={host.openDict} onNextWord={()=>setExampleIndex(null)} nextLabel={localFlowText('assuranceContinue')} toast={host.toast}/>}
 </>;
}
