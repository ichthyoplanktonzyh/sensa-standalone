import {useState} from 'react';
import type {LocalMeaning} from '../../data/library/teacher';
import type {PersonalLearning} from '../../data/library/personalLearning';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
type Controller=ReturnType<typeof usePersonalLearning>;
export function PersonalLearningControls({meaning,c,onStart}:{meaning:LocalMeaning;c:Controller;onStart:(targetId:string)=>void}){
 const [useContext,setUseContext]=useState(false);const task=c.tasks.find(t=>t.id===meaning.id);
 const running=!!task&&['generating','reviewing'].includes(task.status)&&task.leaseUntil>c.clock;
 const providerLabel=(p:NonNullable<Controller['providers']>['content'])=>p.kind==='sensa'?'Sensa':`${p.name}（${p.endpoint}）`;
 return <section className="mx-5 my-4 space-y-3 rounded-2xl border border-[#dfe4ed] p-5" aria-label="个人内容学习准备">
  <h3 className="font-medium">{task?'已加入学习':'把这个意思加入学习'}</h3>
  <p className="text-sm">{task?.status==='ready'?'学习资源已保存到本机，可以开始学习。':'资源生成后还会独立审核，通过后才能开始学习。'}确认意思本身不会启动学习。</p>
  {c.providers&&task?.status!=='ready'&&<p className="text-sm">生成：{providerLabel(c.providers.content)}；审核：{providerLabel(c.providers.review)}。点击生成时发送已确认的意思与表达{task?.useContext?'及这段原文':'，默认不发送原始采集内容'}。</p>}
  {!task&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useContext} onChange={e=>setUseContext(e.target.checked)}/>同时允许上述生成与审核服务使用这段原文，生成贴合原场景的学习材料。</label>}
  {(c.notice||task?.notice)&&<p role="status" className="text-sm">{c.notice||task?.notice}</p>}
  {!task?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.enroll(meaning.id,useContext)}>加入学习</button>:task.status==='ready'?<button className={setupPrimary} onClick={()=>onStart(task.targetId)}>开始 / 继续学习</button>:running?<><p role="status">{task.status==='generating'?'正在生成学习资源…':'正在独立审核…'}</p><button className={setupButton} onClick={()=>c.stop(task.id)}>停止准备</button></>:<button className={setupPrimary} disabled={c.busy||!c.providers} onClick={()=>void c.prepare(task.id)}>{task.status==='waiting'?'生成学习资源':task.status==='rejected'?'重新生成并审核':'重试 / 恢复准备'}</button>}
 </section>;
}
export const pendingPersonalTargetView=(t:PersonalLearning)=>({targetId:t.targetId,expression:t.meaning.proposal.expression.surface,meaning:t.meaning.proposal.semanticSpec.coreMeaningFocus,example:'',partOfSpeech:'',expressionTypeLabel:'表达',sourceKind:'personal_semantic_world' as const,sourceLabel:'我的语义世界',runtimeSenseId:null,personalExperienceGrounding:null,policy:'lightweight' as const,lightweightReadiness:{status:'preparing' as const,label:'准备学习资源',detail:t.notice}});
export function PersonalPreparationTarget({task,c,active,onBack,onHome,onStart,onSource}:{task:PersonalLearning;c:Controller;active:boolean;onBack:()=>void;onHome:()=>void;onStart:(id:string)=>void;onSource:()=>void}){
 return <LearningTargetDetailScreen active={active} target={pendingPersonalTargetView(task)} selectedPolicy="lightweight" fixedPolicy preparation={task.status==='rejected'||task.status==='failed'?'blocked':'preparing'} committedPolicy={null} initialCompletionKind={null} reviewDue={false} relearning={false} retentionRuntimeState={null} nextReviewLabel={null} declaredMastery={false} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>{}} onOpenSource={onSource} onRefreshPreparation={()=>{}} onGoHome={onHome} onStartReview={()=>{}} onContinueRetentionRuntime={()=>{}} onContinueRuntime={()=>{}} onRevokeDeclaredMastery={()=>{}} actions={<PersonalLearningControls meaning={task.meaning} c={c} onStart={onStart}/>}/>;
}
