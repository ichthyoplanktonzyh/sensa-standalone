import {InterleavedFourStageRuntimeScreen} from '../components/learning/InterleavedFourStageRuntimeScreen';
import {InterleavedFourStageReviewScreen} from '../components/learning/InterleavedFourStageReviewScreen';
import {InterleavedFourStageQueue,InterleavedFourStageReviewQueue} from '../learningRuntime/interleavedFourStageProtocol';
import {fourStageQueue,fourStageContent,type FourStageAction} from '../../data/library/fourStage';
import {learningPolicyProfileRegistry} from '../learningRuntime/policyProfiles';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {localRunTargetIds} from '../../data/library/learning';
import {assuranceContent} from '../../data/library/assurance';
import {cardText} from '../../i18n/originalCards';
import {RuntimeTools} from '../components/learning/RuntimeTools';
import {localRunBinding,localTargetPolicy} from '../learningRuntime/localRuntimeBindings';
import {learningRuntimeCoordinator} from '../learningRuntime/runtimeCoordinator';
import {runtimeSurfaceRegistry} from '../learningRuntime/runtimeSurfaces';
import type {AssuranceSupportHost} from './AssuranceLearningViews';
import {AssuranceRuntime,StudyResources} from './AssuranceLearningViews';
import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState,useRef,useEffect} from 'react';
import {ArrowRight,BookOpen,Search,RefreshCw,Upload,Check,Download} from 'lucide-react';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {LightweightRuntimeStartScreen} from '../components/learning/LightweightRuntimeStartScreen';
import {localLightweightStep} from '../learningRuntime/lightweightInitialProtocol';
import {packageKey} from '../../data/library/packages';
import type {LocalLearningTarget} from '../../data/library/learning';
import type {usePackageLearning} from './usePackageLearning';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
type Controller=ReturnType<typeof usePackageLearning>;
export const localTargetView=(t:LocalLearningTarget)=>({targetId:t.id,expression:t.expression,meaning:t.meaning,example:String(t.material.content.resources.find(r=>r.materialRoleKey==='usage_guidance')?.contentPayload.example??''),partOfSpeech:'',expressionTypeLabel:localFlowText('expression'),sourceKind:t.packageKey?'book' as const:'personal_semantic_world' as const,sourceLabel:t.packageKey?localFlowText('downloadedPackages'):localFlowText('semanticWorld'),runtimeSenseId:null,personalExperienceGrounding:null,policy:localTargetPolicy(t),lightweightReadiness:{status:'ready' as const,label:localFlowText('downloaded'),detail:localFlowText('resourcesLocal')}});
export function PackageEntry({active,c,onBack,onLearning,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onLearning:()=>void;onTarget:(id:string)=>void}){
 useTranslation();
 const [selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(''),[downloadKey,setDownloadKey]=useState<string|null>(null);
 const importInput=useRef<HTMLInputElement>(null),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(!active)setSelected(null);},[active]);
 useEffect(()=>{if(active)heading.current?.focus({preventScroll:true});},[selected,active]);
 const enrolledFor=(p:Controller['packages'][number])=>p.bundle.entries.map(e=>c.targets.find(t=>e.senseVersionId===t.material.snapshot.provenance.senseVersionId&&e.bindingVersionId===t.material.snapshot.provenance.bindingVersionId));
 const items=new Map(c.catalog.map(d=>[packageKey(d),{key:packageKey(d),title:d.title,description:d.description,count:d.entryCount,installed:false,enrolled:false}]));
 for(const p of c.packages)items.set(p.key,{key:p.key,title:p.bundle.title,description:items.get(p.key)?.description??'',count:p.bundle.entries.length,installed:true,enrolled:enrolledFor(p).every(Boolean)});
 const installed=c.packages.find(p=>p.key===selected),descriptor=c.catalog.find(d=>packageKey(d)===selected),item=selected?items.get(selected):undefined;
 const enrolled=installed?enrolledFor(installed):[];
 const normalized=query.trim().toLocaleLowerCase();
 const results=[...items.values()].filter(p=>[p.title,p.description].join(' ').toLocaleLowerCase().includes(normalized));
 const stateLabel=(p:{installed:boolean;enrolled:boolean})=>localFlowText(p.enrolled?'enrolled':p.installed?'downloaded':'packageNotDownloaded');
 const notice=c.notice&&<p role="status" className="rounded-xl border border-[#dfe4ed] bg-[#f4f6fb] p-4 text-sm leading-6">{localFlowNotice(c.notice)}</p>;
 return <LearningSetupFrame key={selected??'catalog'} id="s-learning-entry" active={active} onBack={()=>selected?setSelected(null):onBack()} title={item?localFlowText('packageCatalogTitle'):undefined}>
  {item?<>
   <div className="mb-8 space-y-4">
    <span className="inline-flex items-center gap-2 rounded-lg bg-[#edf0f7] px-3 py-2 text-sm text-[#303f76]">{item.enrolled?<Check size={16}/>:<BookOpen size={16}/>} {stateLabel(item)}</span>
    <h2 ref={heading} tabIndex={-1} className="break-words text-3xl font-medium tracking-tight outline-none sm:text-4xl">{item.title}</h2>
    {item.description&&<p className="max-w-xl text-sm leading-7 text-[#68748d]">{item.description}</p>}
    <p className="text-sm text-[#68748d]">{localFlowText('packageExpressionCount',{count:item.count})}</p>
   </div>
   <section aria-label={localFlowText('packageActions')} className="mb-8 space-y-4 rounded-2xl border border-[#bdc8dd] bg-white p-5 sm:p-6">
    {notice}
    {c.progress!==null&&downloadKey===item.key?<>
     <p role="status" className="text-sm">{localFlowText('downloading')}{c.progress}%</p>
     <progress aria-label={localFlowText('downloadPackage')} max={100} value={c.progress} className="h-2 w-full accent-[#303f76]"/>
     <button className={setupButton} onClick={c.cancelDownload}>{localFlowText('cancelDownload')}</button>
    </>:<>
     <p className="text-sm leading-6 text-[#68748d]">{localFlowText(item.enrolled?'packageReadyHint':installed?.bundle.assurance?'assuranceMethodHint':installed?'packageJoinHint':'packageDownloadHint')}</p>
     <button className={setupPrimary+' w-full sm:w-auto'} disabled={c.busy||(!installed&&!descriptor)} onClick={()=>{if(item.enrolled)onLearning();else if(installed)void c.enroll(installed.key);else if(descriptor){setDownloadKey(item.key);void c.download(descriptor).finally(()=>setDownloadKey(null));}}}>
      {item.enrolled?<ArrowRight size={18}/>:installed?<Check size={18}/>:<Download size={18}/>}{localFlowText(c.busy?'processing':item.enrolled?'packageGoLearning':installed?'enroll':'downloadPackage')}
     </button>
    </>}
   </section>
   <section aria-label={localFlowText('packageContents')}>
    <h3 className="mb-4 text-lg font-medium">{localFlowText('packageContents')}</h3>
    {installed?<ul className="divide-y divide-[#e0e5ee] overflow-hidden rounded-2xl border border-[#e0e5ee] bg-white">{installed.bundle.entries.map((e,index)=><li key={e.bindingVersionId} className="flex flex-wrap items-center justify-between gap-4 p-5">
     <div className="min-w-0 flex-1"><p className="break-words text-xl font-medium">{e.expression}</p><p className="mt-2 text-sm leading-6 text-[#68748d]">{e.meaning}</p></div>
     {enrolled[index]&&<button className={setupButton+' shrink-0'} aria-label={localFlowText('packageViewExpression',{expression:e.expression})} onClick={()=>onTarget(enrolled[index]!.id)}>{localFlowText('packageViewDetails')}<ArrowRight size={16}/></button>}
    </li>)}</ul>:<p className="rounded-2xl border border-dashed border-[#bdc8dd] p-6 text-sm leading-6 text-[#68748d]">{localFlowText('packageContentsAfterDownload')}</p>}
   </section>
  </>:<>
   <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
    <h1 ref={heading} tabIndex={-1} className="text-3xl font-medium tracking-tight outline-none sm:text-4xl">{localFlowText('packageCatalogTitle')}</h1>
    <div className="flex flex-wrap gap-2">
     <button className={setupButton} disabled={c.catalogBusy} aria-busy={c.catalogBusy} onClick={()=>void c.reloadCatalog(true)}><RefreshCw size={16}/>{localFlowText(c.catalogBusy?'refreshingCatalog':'packageRefresh')}</button>
     <button className={setupButton} disabled={c.busy} onClick={()=>importInput.current?.click()}><Upload size={16}/>{localFlowText(c.busy?'processing':'importPackage')}</button>
    </div>
   </div>
   <div className="mb-6">{notice}</div>
   <div className="mb-8 flex min-h-14 items-center gap-3 rounded-2xl border border-[#bdc8dd] bg-white px-4 focus-within:ring-2 focus-within:ring-[#5268a9]">
    <Search size={20} className="shrink-0 text-[#68748d]" aria-hidden="true"/>
    <input type="search" aria-label={localFlowText('packageSearch')} placeholder={localFlowText('packageSearch')} value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/>
    {query&&<button className={setupButton} onClick={()=>setQuery('')}>{localFlowText('packageClearSearch')}</button>}
   </div>
   <ul className="grid gap-4 sm:grid-cols-2">{results.map(p=><li key={p.key}><button onClick={()=>setSelected(p.key)} className="group flex h-full w-full flex-col gap-5 rounded-2xl border border-[#bdc8dd] bg-white p-6 text-left transition-colors hover:bg-[#f4f6fb] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5268a9]">
    <div className="flex w-full items-center justify-between gap-4"><BookOpen size={24} className="text-[#5268a9]" aria-hidden="true"/><span className="rounded-lg bg-[#edf0f7] px-3 py-1 text-xs text-[#303f76]">{downloadKey===p.key&&c.progress!==null?localFlowText('downloading')+c.progress+'%':stateLabel(p)}</span></div>
    <div className="min-w-0 w-full flex-1"><h3 className="break-words text-xl font-medium">{p.title}</h3>{p.description&&<p className="mt-3 line-clamp-3 text-sm leading-6 text-[#68748d]">{p.description}</p>}</div>
    <div className="flex w-full items-center justify-between gap-3 text-sm text-[#68748d]"><span>{localFlowText('packageExpressionCount',{count:p.count})}</span><ArrowRight size={18} aria-hidden="true"/></div>
   </button></li>)}</ul>
   {!results.length&&<div role="status" className="rounded-2xl border border-dashed border-[#bdc8dd] px-6 py-12 text-center"><BookOpen size={32} className="mx-auto mb-4 text-[#788398]" aria-hidden="true"/><h3 className="text-lg font-medium">{localFlowText(c.catalogBusy&&!items.size?'packageLoading':query?'packageNoResults':'packageEmpty')}</h3></div>}
  </>}
  <input ref={importInput} hidden tabIndex={-1} aria-label={localFlowText('importPackage')} type="file" accept="application/json,.json" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void c.importFile(file).then(p=>{if(p)setSelected(p.key);});}}/>
 </LearningSetupFrame>;
}
export function PackageTarget({active,target,c,onBack,onHome,onStart,onSource}:{active:boolean;target:LocalLearningTarget;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void;onSource?:()=>void}){
 useTranslation();
 const pack=c.packages.find(p=>p.key===target.packageKey);
 const policy=localTargetPolicy(target);
 const [editingPolicy,setEditingPolicy]=useState(false);
 const canSelectPolicy=!!target.assurancePackageKey&&!target.startedAt;
 const content=pack&&target.assurancePackageKey?assuranceContent(pack,target.assurancePackageKey).template.content:null;
 return <><LearningTargetDetailScreen active={active} target={localTargetView(target)} selectedPolicy={policy} fixedPolicy={!canSelectPolicy} preparation="ready" committedPolicy={target.startedAt?policy:null} initialCompletionKind={target.completedAt?'study_completion':null} reviewDue={c.due.includes(target)} relearning={!!target.relearnAt} retentionRuntimeState={null} nextReviewLabel={target.memory?.dueAt.toLocaleString(i18n.language)??null} declaredMastery={!!target.declaredMastery} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>setEditingPolicy(true)} onOpenSource={onSource??onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>void c.declareKnown(target.id,false)} notice={c.notice&&<p role="status">{localFlowNotice(c.notice)}</p>} actions={<><LearningResourceDetails material={target.material}/>{content&&<StudyResources content={content}/>}{target.declaredMastery?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.declareKnown(target.id,false)}>{cardText('revokeKnown')}</button>:<button className={setupPrimary} disabled={c.busy||!!target.completedAt&&!c.due.includes(target)&&(!c.run||!localRunTargetIds(c.run).includes(target.id))} onClick={onStart}>{target.completedAt?localFlowText('startReview'):localFlowText('startLearning')}</button>}</>}/>{editingPolicy&&canSelectPolicy&&<LearningPreferencesPanel closeLabel={i18n.t('learningPreferences.finishSelection')} allowedPolicies={learningPolicyProfileRegistry.list().filter(p=>p.localSelectable).map(p=>p.profileId)} showDailyQuantity={false} defaultPolicy={policy} dailyNewCount={c.dailyLimit??20} onDailyNewCountChange={()=>{}} onPolicyChange={value=>{void c.selectPolicy(target.id,value);}} busy={c.busy} status={c.notice&&<p role="status">{c.notice}</p>} onClose={()=>setEditingPolicy(false)}/>}</>;
}
type PackageRuntimeProps={active:boolean;c:Controller;host:AssuranceSupportHost;onExit:()=>void;onFinish:()=>void};
export function PackageRuntime(props:PackageRuntimeProps){
 const run=props.c.run;
 if(!run)return <LightweightPackageRuntime {...props}/>;
 const surface=learningRuntimeCoordinator.adapterForBinding(localRunBinding(run)).surfaceFor(run.purpose);
 const Surface=runtimeSurfaceRegistry.localRenderer<PackageRuntimeProps>(surface);
 return <Surface {...props}/>;
}
function StructuredPackageRuntime({active,c,onExit,onFinish,host}:PackageRuntimeProps){
 const run=c.run,target=c.targets.find(t=>t.id===run?.targetId),pack=c.packages.find(p=>p.key===target?.packageKey);
 if(!run?.assurance||!target||!pack)throw new Error('Missing structured runtime resources');
 return <AssuranceRuntime host={host} key={run.id+':'+run.revision} active={active} run={run} target={target} pack={pack} busy={c.busy} notice={c.notice} onMarkKnown={()=>void c.declareKnown(target.id).then(ok=>{if(ok)onExit();})} onAction={action=>{if(!c.busy)void c.act(action);}} onExit={onExit} onFinish={onFinish}/>;
}
function LightweightPackageRuntime({active,c,onExit,onFinish,host}:PackageRuntimeProps){
 useTranslation();
 const run=c.run,target=c.targets.find(t=>t.id===run?.targetId);
 if(!run||!target)return <LightweightRuntimeStartScreen active={active} target={null} materialization={null} step={null} completed={false} hasNextTarget={false} onExit={onExit} onReveal={()=>{}} onRate={()=>{}} onFinish={onFinish}/>;
 // Reuse the existing role-based card presentations; formal transitions remain in the local core.
 const material=run.material??target.material;
 const step=localLightweightStep(run,target);
 const content={senseKey:String(material.snapshot.provenance.senseId),lemma:target.expression,guideLabelL1:target.meaning};
 return <><LightweightRuntimeStartScreen tools={!run.completedAt&&<RuntimeTools content={content} personalContent={run.phase==='reveal'?content:null} showSave={run.phase==='reveal'} onMarkKnown={()=>void c.declareKnown(target.id).then(ok=>{if(ok)onExit();})} onOpenMenuMore={host.onOpenMenuMore} toast={host.toast} busy={c.busy}/>} active={active} target={localTargetView(target)} materialization={material} step={run.completedAt?null:step} completed={!!run.completedAt} hasNextTarget={!!c.nextTarget} onExit={onExit} onReveal={()=>{if(!c.busy)void c.act({kind:'reveal'});}} onRate={rating=>{if(!c.busy)void c.act({kind:'rate',rating});}} onFinish={onFinish} purpose={run.purpose} completionDetail={target.relearnAt?localFlowText('nextRelearning',{date:new Date(target.relearnAt).toLocaleString(i18n.language)}):target.memory?localFlowText('nextReview',{date:target.memory.dueAt.toLocaleString(i18n.language)}):localFlowText('progressSaved')} completionLabel={run.purpose==='initial_learning'?localFlowText('initialCompleted'):run.purpose==='retention_review'?localFlowText('reviewCompleted'):localFlowText('relearningCompleted')}/>{active&&c.notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-amber-50 p-3">{localFlowNotice(c.notice)}</p>}</>;
}

// Existing surfaces receive data adapters at composition; no second surface registry.
runtimeSurfaceRegistry.bindLocalRenderer('lightweight_initial',LightweightPackageRuntime);
runtimeSurfaceRegistry.bindLocalRenderer('lightweight_retention',LightweightPackageRuntime);
runtimeSurfaceRegistry.bindLocalRenderer('structured_session',StructuredPackageRuntime);

function fourStagePresentation(c:Controller){
 const run=c.run;if(!run)throw new Error('Missing runtime');
 const queue=fourStageQueue(run),session=queue.getCurrentSession();
 const target=c.targets.find(t=>t.id===session?.targetId);
 const pack=c.packages.find(p=>p.key===target?.packageKey);
 const content=target?fourStageContent(target,pack):null;
 return {run,queue,session,content,target:target&&content?{expression:target.expression,meaning:target.meaning,example:content.learningExamples[0]?.textL2??'',partOfSpeech:''}:null};
}
function FourStageInitialPackageRuntime({active,c,onExit,onFinish}:PackageRuntimeProps){
 const {queue,target,content}=fourStagePresentation(c);
 if(!(queue instanceof InterleavedFourStageQueue))throw new Error('Invalid initial queue');
 const act=(response:FourStageAction['response'])=>{if(!c.busy)void c.act({kind:'protocol',response});};
 return <InterleavedFourStageRuntimeScreen active={active} targetIds={[]} onExit={onExit} onFinish={onFinish} onComplete={()=>{}} execution={{session:queue.getCurrentSession(),projection:queue.getProjection(),target,content,busy:c.busy,notice:c.notice&&<p role="alert">{c.notice}</p>,onChoice:optionId=>act({kind:'choice',optionId}),onSelfReport:known=>act({kind:'self_report',known}),onContinue:()=>act({kind:'continue'})}}/>;
}
function FourStageReviewPackageRuntime({active,c,onExit,onFinish}:PackageRuntimeProps){
 const {run,queue,target}=fourStagePresentation(c);
 if(!(queue instanceof InterleavedFourStageReviewQueue))throw new Error('Invalid review queue');
 const act=(response:FourStageAction['response'])=>{if(!c.busy)void c.act({kind:'protocol',response});};
 return <InterleavedFourStageReviewScreen active={active} targetIds={[]} relearningTargetIds={new Set()} onExit={onExit} onFinish={onFinish} onMemoryOutcome={()=>{}} onRelearningComplete={()=>{}} execution={{session:queue.getCurrentSession(),target,done:!!run.completedAt,targetCount:localRunTargetIds(run).length,busy:c.busy,notice:c.notice&&<p role="alert">{c.notice}</p>,onAnswer:answer=>act({kind:'review',answer}),onContinue:()=>act({kind:'continue'})}}/>;
}
runtimeSurfaceRegistry.bindLocalRenderer('interleaved_four_stage',FourStageInitialPackageRuntime);
runtimeSurfaceRegistry.bindLocalRenderer('interleaved_four_stage_review',FourStageReviewPackageRuntime);
