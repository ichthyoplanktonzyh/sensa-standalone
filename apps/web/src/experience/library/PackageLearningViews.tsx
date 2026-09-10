import {useState} from 'react';
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
export const localTargetView=(t:LocalLearningTarget)=>({targetId:t.id,expression:t.expression,meaning:t.meaning,example:String(t.material.content.resources.find(r=>r.materialRoleKey==='usage_guidance')?.contentPayload.example??''),partOfSpeech:'',expressionTypeLabel:'表达',sourceKind:'book' as const,sourceLabel:'已下载学习包',runtimeSenseId:null,personalExperienceGrounding:null,policy:'lightweight' as const,lightweightReadiness:{status:'ready' as const,label:'已下载',detail:'学习资源已保存在本机'}});
export function PackageEntry({active,c,onBack,onPersonal,onTarget}:{active:boolean;c:Controller;onBack:()=>void;onPersonal:()=>void;onTarget:(id:string)=>void}){
 const [selected,setSelected]=useState<string|null>(null);
 const items=new Map(c.catalog.map(d=>[packageKey(d),{targetId:packageKey(d),expression:d.title,meaning:d.description,example:'',partOfSpeech:`${d.entryCount} 个学习目标`,sourceKind:'book',sourceLabel:'可下载学习包'}]));
 for(const p of c.packages)items.set(p.key,{targetId:p.key,expression:p.bundle.title,meaning:'已下载，可在本机使用',example:'',partOfSpeech:`${p.bundle.entries.length} 个学习目标`,sourceKind:'book',sourceLabel:'已下载学习包'});
 const installed=c.packages.find(p=>p.key===selected),descriptor=c.catalog.find(d=>packageKey(d)===selected);
 const enrolled=installed?c.targets.filter(t=>installed.bundle.entries.some(e=>e.senseVersionId===t.material.snapshot.provenance.senseVersionId&&e.bindingVersionId===t.material.snapshot.provenance.bindingVersionId)):[];
 const fullyEnrolled=!!installed&&enrolled.length===installed.bundle.entries.length;
 return <LearningEntryScreen active={active} onBack={onBack} onOpenPersonalSemanticWorld={onPersonal} onOpenTarget={setSelected} catalog={[...items.values()]} status={<div className="mb-6 space-y-4">
  {c.notice&&<p role="status">{c.notice}</p>}<button className={setupButton} disabled={c.busy} onClick={()=>void c.reloadCatalog()}>刷新学习包目录</button>
  {selected&&<div className="rounded-2xl border p-5"><h3 className="text-xl">{installed?.bundle.title??descriptor?.title}</h3>
   {c.progress!==null&&<p role="status">正在下载：{c.progress}%</p>}
   {installed?<><p className="my-3">已完整保存到当前浏览器。加入学习后才会进入学习计划。</p><button className={setupPrimary} disabled={c.busy||fullyEnrolled} onClick={()=>void c.enroll(installed.key)}>{fullyEnrolled?'已加入学习':'加入学习'}</button><ul>{enrolled.map(t=><li key={t.id}><button className={setupButton} onClick={()=>onTarget(t.id)}>{t.expression} · 查看学习目标</button></li>)}</ul></>:descriptor&&<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.download(descriptor)}>下载学习包</button>}
   {c.progress!==null&&<button className={setupButton} onClick={c.cancelDownload}>取消下载</button>}
  </div>}
  <details><summary>从文件导入已有学习包</summary><p className="my-3 text-sm">导入完整的 Sensa 学习包；不会自动加入学习或写入学习历史。</p><input aria-label="导入学习包" type="file" accept="application/json,.json" disabled={c.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void c.importFile(file).then(p=>{if(p)setSelected(p.key);});}}/></details>
 </div>}/>;
}
export function PackageTarget({active,target,c,onBack,onHome,onStart}:{active:boolean;target:LocalLearningTarget;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void}){
 return <LearningTargetDetailScreen active={active} target={localTargetView(target)} selectedPolicy="lightweight" fixedPolicy preparation="ready" committedPolicy={target.startedAt?'lightweight':null} initialCompletionKind={target.completedAt?'study_completion':null} reviewDue={c.due.includes(target)} relearning={!!target.relearnAt} retentionRuntimeState={null} nextReviewLabel={target.memory?.dueAt.toLocaleString()??null} declaredMastery={false} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>{}} onOpenSource={onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>{}} notice={c.notice&&<p role="status">{c.notice}</p>} actions={<button className={setupPrimary} disabled={c.busy||!!target.completedAt&&!c.due.includes(target)&&c.run?.targetId!==target.id} onClick={onStart}>{target.completedAt?'开始 / 继续复习':'开始 / 继续学习'}</button>}/>;
}
export function PackageRuntime({active,c,onExit,onFinish}:{active:boolean;c:Controller;onExit:()=>void;onFinish:()=>void}){
 const run=c.run,target=c.targets.find(t=>t.id===run?.targetId);
 if(!run||!target)return <LightweightRuntimeStartScreen active={active} target={null} materialization={null} step={null} completed={false} hasNextTarget={false} onExit={onExit} onReveal={()=>{}} onRate={()=>{}} onFinish={onFinish}/>;
 // Reuse the existing role-based card presentations; formal transitions remain in the local core.
 const definition=run.phase==='recall'?LIGHTWEIGHT_EXPERIENCE_RECALL_STEP:LIGHTWEIGHT_EXPRESSION_REVEAL_STEP;
 const step:LightweightProtocolStepInstance={protocolStepInstanceId:consumerRunStepId(run.id,run.ordinal,run.phase,run.protocolVersion),protocolRunId:run.id,retentionTargetId:target.retentionId,ordinal:run.ordinal,definition,materialBindings:target.material.content.resources.filter(r=>definition.materialRequirements.some(m=>m.materialRoleKey===r.materialRoleKey)).map(r=>({materialRoleKey:r.materialRoleKey,resourceKey:r.resourceKey,learningMaterializationId:target.material.snapshot.learningMaterializationId}))};
 return <><LightweightRuntimeStartScreen active={active} target={localTargetView(target)} materialization={target.material} step={run.completedAt?null:step} completed={!!run.completedAt} hasNextTarget={!!c.nextTarget} onExit={onExit} onReveal={()=>{if(!c.busy)void c.act({kind:'reveal'});}} onRate={rating=>{if(!c.busy)void c.act({kind:'rate',rating});}} onFinish={onFinish} purpose={run.purpose} completionDetail={target.relearnAt?`下次再学习：${new Date(target.relearnAt).toLocaleString()}`:target.memory?`下次复习：${target.memory.dueAt.toLocaleString()}`:'进度已保存到本机。'} completionLabel={run.purpose==='initial_learning'?'本次首次学习已完成':run.purpose==='retention_review'?'本次复习已记录':'本次再学习已记录'}/>{active&&c.notice&&<p role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl bg-amber-50 p-3">{c.notice}</p>}</>;
}
