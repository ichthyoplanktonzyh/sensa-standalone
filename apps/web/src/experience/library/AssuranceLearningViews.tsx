import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {assuranceContent,assuranceView,type AssuranceAction} from '../../data/library/assurance';
import type {LocalLearningRun,LocalLearningTarget} from '../../data/library/learning';
import type {InstalledPackage} from '../../data/library/packages';
import {RuntimeFrame} from '../components/learning/RuntimeFrame';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
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
export function AssuranceRuntime(props:{active:boolean;run:LocalLearningRun;target:LocalLearningTarget;pack:InstalledPackage;busy:boolean;notice:string;onAction:(action:AssuranceAction)=>void;onExit:()=>void;onFinish:()=>void}){
 useTranslation();const {run,pack}=props,view=assuranceView(run,pack),state=run.assurance!;
 const [answer,setAnswer]=useState(''),[position,setPosition]=useState(0);
 const act=(response:AssuranceAction['response'])=>props.onAction({kind:'assurance',response});
 const resource=view?.resource,content=view?.content;
 const projection=view?.projection.targets[0];const gates=projection&&'gates' in projection?projection.gates:[];const progress=run.completedAt?100:gates.length?100*gates.filter(g=>g.status==='passed').length/gates.length:state.feedback?50:0;
 const options=resource?.kind==='meaning_to_form_recall'?resource.choiceOptions.map(o=>({id:o.id,label:o.textL2,correct:o.isTarget})):resource?.kind==='novel_context_transfer'?resource.scenario.options.map(o=>({id:o.id,label:o.labelL1,correct:o.isCorrect})):resource?.kind==='context_recognition'||resource?.kind==='boundary_contrast'?resource.options.map(o=>({id:o.id,label:o.textL1,correct:o.isCorrect})):[];
 const title=run.completedAt?'assuranceCompleted':view?.introduction?'assuranceExperience':view?.action.capability==='contextual_recognition'?'assuranceRecognition':view?.action.capability==='meaning_to_form_recall'?'assuranceRecall':view?.action.capability==='novel_context_transfer'?'assuranceTransfer':'assuranceBoundary';
 const experience=content?.experience,states=experience?.kind==='interaction'?experience.states:[],current=states[position]??states[0];
 return <RuntimeFrame id="s-lightweight-runtime" active={props.active} title={localFlowText('assuranceTitle')} stepLabel={localFlowText(title)} progress={progress} onExit={props.onExit}>
  <div className="mx-auto max-w-2xl space-y-6">
   <h1 className="text-2xl font-medium">{localFlowText(title)}</h1>
   {props.notice&&<p role="alert" className="rounded-xl bg-amber-50 p-4">{localFlowNotice(props.notice)}</p>}
   {run.completedAt?<><p>{localFlowText('assuranceCompletionHint')}</p><button className={setupPrimary} onClick={props.onFinish}>{localFlowText('assuranceContinueLearning')}</button></>:view&&content&&<fieldset disabled={props.busy} className="min-w-0 space-y-6 disabled:opacity-60">
    {view.introduction?<>
     {!state.revealed?<section className="space-y-5 rounded-2xl border border-[#dfe4ed] bg-white p-6">
      {experience?.kind==='interaction'?<><p className="text-lg leading-8">{experience.instructionL1}</p><label className="block text-sm">{experience.controlLabelL1}<input type="range" min={0} max={Math.max(0,states.length-1)} step={1} value={position} onChange={e=>setPosition(Number(e.target.value))} aria-valuetext={current?.labelL1} className="my-5 block min-h-11 w-full accent-[#303f76]"/></label><p className="font-medium">{current?.labelL1}</p><p className="text-lg leading-8">{current?.feedbackL1}</p></>:<p className="text-lg leading-8">{experience?.sceneL1}</p>}
      <button className={setupPrimary} onClick={()=>act({kind:'reveal'})}>{localFlowText('assuranceReveal')}</button>
     </section>:<><p className="text-lg leading-8">{content.experienceSketch.bodyL1}</p><p className="text-sm leading-7">{content.l1Bridge}</p><StudyResources content={content}/><button className={setupPrimary+' w-full'} onClick={()=>act({kind:'continue'})}>{localFlowText('assuranceBeginCheck')}</button></>}
    </>:resource&&<>
     <section className="space-y-4 rounded-2xl border border-[#dfe4ed] bg-white p-6">
      <p className="text-sm text-[#68748d]">{resource.instructionL1}</p>
      {resource.kind==='meaning_to_form_recall'?<p className="text-xl leading-9">{resource.cueL1}</p>:resource.kind==='novel_context_transfer'?<><p className="text-xl leading-9">{resource.scenario.setupL2}</p><p className="text-sm leading-7">{resource.scenario.setupL1}</p></>:<><p className="text-xl leading-9">{resource.example.textL2}</p><p className="leading-7">{resource.questionL1}</p></>}
      {!state.feedback&&(resource.kind==='meaning_to_form_recall'&&state.mode!=='choice'?<>
       {state.mode==='first_letter'&&<p>{localFlowText('assuranceFirstLetter',{letter:resource.primaryForm[0]})}</p>}
       <form onSubmit={e=>{e.preventDefault();if(answer.trim())act({kind:'answer',value:answer});}} className="space-y-4"><input autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label={localFlowText('assuranceAnswer')} value={answer} onChange={e=>setAnswer(e.target.value)} className="min-h-12 w-full rounded-xl border border-[#bdc8dd] px-4"/><button disabled={!answer.trim()} className={setupPrimary}>{localFlowText('assuranceSubmit')}</button></form>
       <div className="flex flex-wrap gap-3">{state.mode==='independent'&&<button className={setupButton} onClick={()=>act({kind:'hint',mode:'first_letter'})}>{localFlowText('assuranceHint')}</button>}<button className={setupButton} onClick={()=>act({kind:'hint',mode:'choice'})}>{localFlowText('assuranceChoices')}</button></div>
      </>:<div className="grid gap-3">{options.map(o=><button key={o.id} className={setupButton+' justify-start py-3 text-left'} onClick={()=>act({kind:'answer',value:o.id})}>{o.label}</button>)}</div>)}
     </section>
     {state.feedback&&<section className="space-y-4 rounded-2xl border border-[#bdc8dd] bg-[#eef2fa] p-6" role="status"><h2 className="text-lg font-medium">{localFlowText(state.feedback.correct?(state.mode==='independent'?'assuranceCorrect':'assuranceSupported'):'assuranceRepair')}</h2><p className="text-xl">{resource.kind==='meaning_to_form_recall'?resource.primaryForm:options.find(o=>o.correct)?.label}</p><p className="leading-7">{resource.kind==='meaning_to_form_recall'?(state.feedback.correct?resource.independentSuccessBodyL1:resource.repairBodyL1):resource.kind==='novel_context_transfer'?resource.scenario.options.find(o=>o.id===state.feedback!.answer)?.feedbackBodyL1:resource.options.find(o=>o.id===state.feedback!.answer)?.feedbackBodyL1}</p><button className={setupPrimary} onClick={()=>act({kind:'continue'})}>{localFlowText('assuranceContinue')}</button></section>}
    </>}
   </fieldset>}
  </div>
 </RuntimeFrame>;
}
