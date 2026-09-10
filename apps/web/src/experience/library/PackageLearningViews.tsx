import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState,useRef} from 'react';
import {LearningEntryScreen} from '../components/learning/LearningEntryScreen';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {LIGHTWEIGHT_EXPERIENCE_RECALL_STEP,LIGHTWEIGHT_EXPRESSION_REVEAL_STEP,type LightweightProtocolStepInstance} from '../learningRuntime/lightweightInitialProtocol';
import {consumerRunStepId} from '@sensa/learning-kernel';
import {packageKey} from '../../data/library/packages';
import type {LocalLearningTarget} from '../../data/library/learning';
import type {usePackageLearning} from './usePackageLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
type Controller=ReturnType<typeof usePackageLearning>;
export const localTargetView=(t:LocalLearningTarget)=>({targetId:t.id,expression:t.expression,meaning:t.meaning,example:String(t.material.content.resources.find(r=>r.materialRoleKey==='usage_guidance')?.contentPayload.example??''),partOfSpeech:'',expressionTypeLabel:localFlowText('expression'),sourceKind:t.packageKey?'book' as const:'personal_semantic_world' as const,sourceLabel:t.packageKey?localFlowText('downloadedPackages'):localFlowText('semanticWorld'),runtimeSenseId:null,personalExperienceGrounding:null,policy:'lightweight' as const,lightweightReadiness:{status:'ready' as const,label:localFlowText('downloaded'),detail:localFlowText('resourcesLocal')}});
export function PackageEntry({active,c,onBack,onPersonal,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onPersonal:()=>void;onTarget:(id:string)=>void}){
 useTranslation();
 const [selected,setSelected]=useState<string|null>(null);const importInput=useRef<HTMLInputElement>(null);
 const items=new Map(c.catalog.map(d=>[packageKey(d),{targetId:packageKey(d),expression:d.title,meaning:d.description,example:'',partOfSpeech:localFlowText('targetCount',{count:d.entryCount}),sourceKind:'book',sourceLabel:localFlowText('availablePackages')}]));
 for(const p of c.packages)items.set(p.key,{targetId:p.key,expression:p.bundle.title,meaning:localFlowText('packageLocal'),example:'',partOfSpeech:localFlowText('packageTargetCount',{count:p.bundle.entries.length}),sourceKind:'book',sourceLabel:localFlowText('downloadedPackages')});
 const installed=c.packages.find(p=>p.key===selected),descriptor=c.catalog.find(d=>packageKey(d)===selected);
 const enrolled=installed?c.targets.filter(t=>installed.bundle.entries.some(e=>e.senseVersionId===t.material.snapshot.provenance.senseVersionId&&e.bindingVersionId===t.material.snapshot.provenance.bindingVersionId)):[];
 const fullyEnrolled=!!installed&&enrolled.length===installed.bundle.entries.length;
 return <LearningEntryScreen active={active} onBack={onBack} onOpenPersonalSemanticWorld={onPersonal} onOpenTarget={setSelected} catalog={[...items.values()]} status={<div className="mb-6 space-y-4">
  {c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>}<button className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}>{localFlowText(c.catalogBusy?'refreshingCatalog':'refreshCatalog')}</button>
  {selected&&<div className="rounded-2xl border p-5"><h3 className="text-xl">{installed?.bundle.title??descriptor?.title}</h3>
   {c.progress!==null&&<p role="status">{localFlowText('downloading')}{c.progress}%</p>}
   {installed?<><p className="my-3">{localFlowText('packageSaved')}</p><button className={setupPrimary} disabled={c.busy||fullyEnrolled} onClick={()=>void c.enroll(installed.key)}>{fullyEnrolled?localFlowText('enrolled'):localFlowText('enroll')}</button><ul>{enrolled.map(t=><li key={t.id}><button className={setupButton} onClick={()=>onTarget(t.id)}>{t.expression} {localFlowText('viewTarget')}</button></li>)}</ul></>:descriptor&&<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.download(descriptor)}>{localFlowText('downloadPackage')}</button>}
   {c.progress!==null&&<button className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>}
  </div>}
  <details><summary>{localFlowText('importPackageTitle')}</summary><p className="my-3 text-sm">{localFlowText('importPackageHint')}</p><input ref={importInput} className="sr-only" tabIndex={-1} aria-label={localFlowText('importPackage')} type="file" accept="application/json,.json" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void c.importFile(file).then(p=>{if(p)setSelected(p.key);});}}/><button className={setupButton} disabled={c.busy} onClick={()=>importInput.current?.click()}>{localFlowText(c.busy?'processing':'importPackage')}</button></details>
 </div>}/>;
}
export function PackageTarget({active,target,c,onBack,onHome,onStart,onSource}:{active:boolean;target:LocalLearningTarget;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void;onSource?:()=>void}){
 useTranslation();
 return <LearningTargetDetailScreen active={active} target={localTargetView(target)} selectedPolicy="lightweight" fixedPolicy preparation="ready" committedPolicy={target.startedAt?'lightweight':null} initialCompletionKind={target.completedAt?'study_completion':null} reviewDue={c.due.includes(target)} relearning={!!target.relearnAt} retentionRuntimeState={null} nextReviewLabel={target.memory?.dueAt.toLocaleString(i18n.language)??null} declaredMastery={false} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>{}} onOpenSource={onSource??onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>{}} notice={c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>} actions={<button className={setupPrimary} disabled={c.busy||!!target.completedAt&&!c.due.includes(target)&&c.run?.targetId!==target.id} onClick={onStart}>{target.completedAt?localFlowText('startReview'):localFlowText('startLearning')}</button>}/>;
}
export function PackageRuntime({active,c,onExit,onFinish}:{active:boolean;c:Controller;onExit:()=>void;onFinish:()=>void}){
 useTranslation();
 const run=c.run,target=c.targets.find(t=>t.id===run?.targetId);
 if(!run||!target)return <LightweightRuntimeStartScreen active={active} target={null} materialization={null} step={null} completed={false} hasNextTarget={false} onExit={onExit} onReveal={()=>{}} onRate={()=>{}} onFinish={onFinish}/>;
 // Reuse the existing role-based card presentations; formal transitions remain in the local core.
 const definition=run.phase==='recall'?LIGHTWEIGHT_EXPERIENCE_RECALL_STEP:LIGHTWEIGHT_EXPRESSION_REVEAL_STEP;
 const step:LightweightProtocolStepInstance={protocolStepInstanceId:consumerRunStepId(run.id,run.ordinal,run.phase,run.protocolVersion),protocolRunId:run.id,retentionTargetId:target.retentionId,ordinal:run.ordinal,definition,materialBindings:target.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:target.material.snapshot.learningMaterializationId}))};
 return <><LightweightRuntimeStartScreen active={active} target={localTargetView(target)} materialization={target.material} step={run.completedAt?null:step} completed={!!run.completedAt} hasNextTarget={!!c.nextTarget} onExit={onExit} onReveal={()=>{if(!c.busy)void c.act({kind:'reveal'});}} onRate={rating=>{if(!c.busy)void c.act({kind:'rate',rating});}} onFinish={onFinish} purpose={run.purpose} completionDetail={target.relearnAt?localFlowText('nextRelearning',{date:new Date(target.relearnAt).toLocaleString(i18n.language)}):target.memory?localFlowText('nextReview',{date:target.memory.dueAt.toLocaleString(i18n.language)}):localFlowText('progressSaved')} completionLabel={run.purpose==='initial_learning'?localFlowText('initialCompleted'):run.purpose==='retention_review'?localFlowText('reviewCompleted'):localFlowText('relearningCompleted')}/>{active&&c.notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-amber-50 p-3">{localFlowNotice(c.notice)}</p>}</>;
}
