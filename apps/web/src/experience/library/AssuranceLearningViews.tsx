import {LearnScreen} from '../components/LearnScreen';
import type {RuntimeToolsProps} from '../components/learning/RuntimeTools';
import type {StepRendererHost} from '../learningRuntime/stepRenderers';
import type {CardExecution} from '../components/cards/CardExecution';
import {toWordPresentation} from '../learningPresentation';
import {ExampleScreen} from '../components/ExampleScreen';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';

import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import type {LearningAction,LearningStructuredRuntimeProjection} from '../../learning/system';
import {AssuranceSummary} from '../components/learning/AssuranceSummary';

export type AssuranceSupportHost = Pick<StepRendererHost, 'toast' | 'openDict' | 'openNoteEditor' | 'openSceneEditor' | 'lookupDictionary'> & Pick<RuntimeToolsProps, 'onOpenMenuMore'>;

export function AssuranceRuntime(props:{active:boolean;runtime:LearningStructuredRuntimeProjection;busy:boolean;notice:string;host:AssuranceSupportHost;onMarkKnown:()=>void;onAction:(action:LearningAction)=>void;onExit:()=>void;onFinish:()=>void}){
 useTranslation();
 const {runtime,host}=props;
 const {content,resource,state}=runtime;
 const [exampleIndex,setExampleIndex]=useState<number|null>(null);
 const resetScroll=()=>{document.getElementById('s-lightweight-runtime')?.scrollTo({top:0});};
 const [phase,setPhase]=useState<'experience'|'reveal'>(state.revealed?'reveal':'experience');
 useEffect(resetScroll,[runtime.runId,runtime.revision]);
 const act=(response:unknown)=>props.onAction({kind:'assurance',response});
 const next=()=>act({kind:'continue'});
 const execution:CardExecution={mode:state.mode,feedback:state.feedback,continue:next,hint:mode=>act({kind:'hint',mode}),submit:answer=>act(answer===null?{kind:'skip'}:{kind:resource?.kind==='meaning_to_form_recall'?'try_recall':'answer',value:answer})};
 const runtimeHost:StepRendererHost={...host,openExample:(_sense,index=0)=>setExampleIndex(index),completeIntroduction:next,completeRecognition:next,completeMeaningToFormRecall:next,completeNovelTransfer:next,completeReviewAssessment:r=>execution.submit(r.responseId),continueReviewFeedback:next};
 return <>
 {runtime.completed?<AssuranceSummary id="s-lightweight-runtime" active={props.active} review={runtime.purpose!=='initial_learning'} completed={[runtime.target.targetId]} declared={[]} targetPresentation={()=>runtime.target.presentation} continueLabel={localFlowText('assuranceContinueLearning')} onExit={props.onFinish}/>:runtime.action&&runtime.stepKind&&content&&<LearnScreen screenId="s-lightweight-runtime" hasTask active={props.active} isBehind={exampleIndex!==null} curWord={toWordPresentation(content)} stage={runtime.stepKind} step={runtime.action.ordinal} groupSize={runtime.action.totalTarget} introductionContent={content} repairContent={runtime.action.intent==='repair'?content:null} introductionPosition={1} introductionTotal={1} reviewAssessmentPurpose={runtime.purpose==='initial_learning'?'acquisition':'retention'} onExit={props.onExit} onUndo={()=>act({kind:'undo'})} onMarkKnown={props.onMarkKnown} onOpenMenuMore={host.onOpenMenuMore} reviewAssessmentKind={resource?.kind??null} reviewAssessmentResult={runtime.reviewResult} repairResourceRef={runtime.action.repairResourceRef??null} host={runtimeHost} execution={execution} preparedAssessmentResource={resource} controlledPhase={phase} onControlledPhaseChange={nextPhase=>{if(nextPhase==='reveal'&&!state.revealed)act({kind:'reveal'});else{setPhase(nextPhase);resetScroll();}}} busy={props.busy} notice={props.notice&&<p role="alert" className="mb-6 rounded-xl bg-accent-soft p-4">{localFlowNotice(props.notice)}</p>}/>}
 {content&&exampleIndex!==null&&<ExampleScreen screenId="s-package-example" active={props.active} curWord={toWordPresentation(content)} initialSentenceIdx={exampleIndex} sentenceSequence={content.learningExamples.map((_,i)=>i)} onClose={()=>setExampleIndex(null)} onOpenDict={host.openDict} onNextWord={()=>setExampleIndex(null)} nextLabel={localFlowText('assuranceContinue')} toast={host.toast}/>}
 </>;
}
