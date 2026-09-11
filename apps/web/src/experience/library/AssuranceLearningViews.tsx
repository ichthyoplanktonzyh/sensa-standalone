import {uiClass} from '../ui/classes';
import {originalStepRendererRegistry,type OriginalStepProps} from '../learningRuntime/originalStepRenderers';
import type {StepRendererHost} from '../learningRuntime/stepRenderers';
import type {QuickDictEntry} from '../types';
import type {CardExecution} from '../components/cards/CardExecution';
import {toWordPresentation} from '../content/learningCatalog';
import {ExampleScreen} from '../components/ExampleScreen';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {assuranceContent,assuranceView,type AssuranceAction} from '../../data/library/assurance';
import type {LocalLearningRun,LocalLearningTarget} from '../../data/library/learning';
import type {InstalledPackage} from '../../data/library/packages';
import {RuntimeFrame} from '../components/learning/RuntimeFrame';
import {LearningSetupFrame,setupPrimary} from '../components/learning/LearningSetupFrame';
import type {PrototypeIntroductionPackage} from '../content/learningCatalog';
function StudyResources({content}:{content:PrototypeIntroductionPackage}){
 return <div className="space-y-6">
  <div><h2 className="text-3xl font-medium">{content.lemma}</h2><p className="mt-3 text-lg">{content.guideLabelL1}</p><p className="mt-3 text-sm leading-7 text-[#68748d]">{content.definitionL2}</p></div>
  <section className="space-y-3"><h3 className="font-medium">{localFlowText('assurancePronunciation')}</h3>{content.pronunciations.map(p=><div key={p.accentLocale} className="rounded-xl border border-[#dfe4ed] p-4"><p className="mb-3 text-sm">{p.accentLocale} · {p.ipa}</p>{p.audioUrl&&<audio controls preload="none" src={p.audioUrl} aria-label={localFlowText('assuranceAudio',{label:p.accentLocale})} className="w-full max-w-full"/>}</div>)}</section>
  <section className="space-y-4"><h3 className="font-medium">{localFlowText('assuranceExamples')}</h3>{content.learningExamples.map(e=><div key={e.exampleKey} className="space-y-3 rounded-xl border border-[#dfe4ed] p-4"><p className="text-lg leading-8">{e.textL2}</p><p className="text-sm leading-6 text-[#68748d]">{e.textL1}</p>{e.audioUrl&&<audio controls preload="none" src={e.audioUrl} aria-label={localFlowText('assuranceAudio',{label:e.textL2})} className="w-full max-w-full"/>}</div>)}</section>
  {content.supportTabs.flatMap(t=>t.patterns).map(p=><p key={p.canonicalPattern} className="text-sm leading-7">{p.canonicalPattern}</p>)}
 </div>;
}
export function AssuranceTarget({active,target,pack,busy,notice,canResume,onBack,onStart}:{active:boolean;target:LocalLearningTarget;pack:InstalledPackage;busy:boolean;notice:string;canResume:boolean;onBack:()=>void;onStart:()=>void}){
 useTranslation();const {template}=assuranceContent(pack,target.assurancePackageKey!);
 return <LearningSetupFrame id="s-learning-target" active={active} title={localFlowText('assuranceTitle')} onBack={onBack}>
  <div className="mb-6 space-y-4">{notice&&<p role="status">{localFlowNotice(notice)}</p>}<p className="text-sm text-[#68748d]">{localFlowText('assuranceMethodHint')}</p><button className={setupPrimary} disabled={busy||!!target.completedAt&&!!target.memory&&target.memory.dueAt>new Date()&&!target.relearnAt&&!canResume} onClick={onStart}>{localFlowText(target.completedAt?'startReview':'startLearning')}</button>{target.memory&&<p className="text-sm">{localFlowText('nextReview',{date:target.memory.dueAt.toLocaleString()})}</p>}</div>
  <StudyResources content={template.content}/>
 </LearningSetupFrame>;
}
export type AssuranceSupportHost = Pick<StepRendererHost, 'toast' | 'openDict' | 'openNoteEditor' | 'openSceneEditor' | 'lookupDictionary'>;
export function AssuranceRuntime(props:{active:boolean;run:LocalLearningRun;target:LocalLearningTarget;pack:InstalledPackage;busy:boolean;notice:string;host:AssuranceSupportHost;onAction:(action:AssuranceAction)=>void;onExit:()=>void;onFinish:()=>void}){
 useTranslation();
 const {run,pack,host}=props,view=assuranceView(run,pack),state=run.assurance!;
 const [exampleIndex,setExampleIndex]=useState<number|null>(null);
 const resetScroll=()=>{document.getElementById('s-lightweight-runtime')?.scrollTo({top:0});};
 const [phase,setPhase]=useState<'experience'|'reveal'>(state.revealed?'reveal':'experience');
 useEffect(resetScroll,[run.id,run.revision]);
 const act=(response:AssuranceAction['response'])=>props.onAction({kind:'assurance',response});
 const content=view?.content,resource=view?.resource;
 const projection=view?.projection.targets[0];const gates=projection&&'gates' in projection?projection.gates:[];
 const progress=run.completedAt?100:gates.length?100*gates.filter(g=>g.status==='passed').length/gates.length:state.feedback?50:0;
 const title=run.completedAt?'assuranceCompleted':view?.introduction?'assuranceExperience':view?.action.capability==='contextual_recognition'?'assuranceRecognition':view?.action.capability==='meaning_to_form_recall'?'assuranceRecall':view?.action.capability==='novel_context_transfer'?'assuranceTransfer':'assuranceBoundary';
 const next=()=>act({kind:'continue'});
 const execution:CardExecution={mode:state.mode,feedback:state.feedback,continue:next,hint:mode=>act({kind:'hint',mode}),submit:answer=>act(answer===null?{kind:'skip'}:{kind:resource?.kind==='meaning_to_form_recall'?'try_recall':'answer',value:answer})};
 const supports=content?{
  onOpenDictionary:(word:string|QuickDictEntry)=>host.openDict(word),
  onOpenNote:()=>host.openNoteEditor(content.lemma,content.senseKey,content.guideLabelL1),
  onOpenScene:(anchorId?:string)=>host.openSceneEditor(content,anchorId),
  onOpenExample:(index=0)=>setExampleIndex(index),lookupDictionary:host.lookupDictionary,
  onViewChange:resetScroll,toast:host.toast,
 }:null;
 const card=view&&content&&supports?originalStepRendererRegistry.get<OriginalStepProps>(view.stepKind)({content,resource:resource??null,execution,purpose:run.purpose==='initial_learning'?'acquisition':'retention',phase,onPhaseChange:nextPhase=>{if(nextPhase==='reveal'&&!state.revealed)act({kind:'reveal'});else{setPhase(nextPhase);resetScroll();}},supports}):null;
 return <>
 <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={localFlowText('assuranceTitle')} stepLabel={localFlowText(title)} progress={progress} onExit={props.onExit}>
  {props.notice&&<p role="alert" className="mb-6 rounded-xl bg-amber-50 p-4">{localFlowNotice(props.notice)}</p>}
  {run.completedAt?<div className="space-y-6"><h1 className="text-3xl font-medium">{localFlowText('assuranceCompleted')}</h1><p>{localFlowText('assuranceCompletionHint')}</p><button className={setupPrimary} onClick={props.onFinish}>{localFlowText('assuranceContinueLearning')}</button></div>:<fieldset disabled={props.busy} className={uiClass('#s-learn','relative min-w-0 overflow-visible! disabled:opacity-60 [&_.intro-experience-footer]:translate-x-0! [&_.intro-experience-footer]:left-auto! [&_.intro-experience-footer]:px-0! [&_.lfoot]:translate-x-0! [&_.lfoot]:left-auto! [&_.lfoot]:px-0!')} data-assurance-original-cards>{card}</fieldset>}
 </RuntimeFrame>
 {content&&exampleIndex!==null&&<ExampleScreen screenId="s-package-example" active={props.active} curWord={toWordPresentation(content)} initialSentenceIdx={exampleIndex} sentenceSequence={content.learningExamples.map((_,i)=>i)} onClose={()=>setExampleIndex(null)} onOpenDict={host.openDict} onNextWord={()=>setExampleIndex(null)} nextLabel={localFlowText('assuranceContinue')} toast={host.toast}/>}
 </>;
}
