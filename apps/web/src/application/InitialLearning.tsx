import {checkInDate} from '../data/replica/checkin';
import {useEffect,useState} from 'react';
import type {ConsumerAction,ConsumerRun} from '@sensa/contracts/sensa';
import type {AccountReplica} from '../data/replica/accountStore';
import {canContinueRun,runProgress} from '../data/replica/initialRuntime';
import {LearningSetupFrame,setupButton,setupPrimary} from '../experience/components/learning/LearningSetupFrame';
export function InitialLearning({replica,run,busy,notice,onAction,onPause,onCheck,onNext,onHome,onEntered}:{replica:AccountReplica;run:ConsumerRun;busy:boolean;notice:string;onAction:(action:ConsumerAction)=>void;onPause:()=>void;onCheck:()=>void;onNext:()=>void;onHome:()=>void;onEntered:()=>void}){
 const material=replica.materials[run.materializationId],progress=runProgress(replica,run);
 const [audio,setAudio]=useState<string|null>(null);
 const pronunciation=material?.content.resources.find(r=>r.materialRoleKey==='pronunciation')?.contentPayload.audioUrl;
 useEffect(()=>{const blob=typeof pronunciation==='string'?replica.audio[pronunciation.slice(12)]:null;const url=blob?URL.createObjectURL(blob):null;setAudio(url);return ()=>{if(url)URL.revokeObjectURL(url);};},[pronunciation,replica.audio]);
 const payload=(role:string)=>material?.content.resources.find(r=>r.materialRoleKey===role)?.contentPayload;
 const text=(role:string,key:string)=>{const value=payload(role)?.[key];return typeof value==='string'?value:'';};
 const conflict=replica.outbox.some(x=>x.state==='retained'&&!x.resolved&&x.operation.kind==='run.record_action'&&x.operation.payload.runId===run.id);
 const entered=!!material&&!!run.currentStep&&!run.completion&&!conflict&&progress.phase!=='pending_result'&&canContinueRun(run);
 useEffect(()=>{if(entered)onEntered();},[run.id,run.offlineGrant?.id,entered]);
 const day=replica.plan?.accountDate;const signed=!!(day&&replica.checkins[day]);const signing=!!day&&replica.outbox.some(x=>x.state==='pending'&&x.operation.kind==='check_in.record'&&checkInDate(x.operation.occurredAt,replica.plan!.timeZone)===day);
 const complete=run.completion;
 const title=run.purpose==='initial_learning'?'首次学习':run.purpose==='retention_review'?'到期复习':'再次回想';
 return <LearningSetupFrame id="s-initial-learning" active title={title} onBack={onPause}>
  <div className="mx-auto max-w-xl space-y-6">
   {(signed||signing)&&<p className="text-xs text-[#68748d]">{signed?'今日已签到':'签到待同步'}</p>}
   {notice&&<p role="status" className="rounded-xl bg-[#edf0f7] p-4 leading-7">{notice}</p>}
   {complete?<><h2 className="text-3xl font-semibold">{complete.kind==='study_completion'?'已完成首次学习':complete.kind==='review_completed'?'本次复习已记录':'这次已重新想起'}</h2>{complete.dueAt&&<p className="leading-7">下次复习：{new Date(complete.dueAt).toLocaleString()}</p>}<p className="text-[#68748d]">{complete.rating==='again'?'这次没想起，稍后会再安排回想。先继续其他内容。':complete.kind==='relearning_completion'?'已记录本次恢复，原复习评价与复习时间保持原样。':'之后会通过复习巩固这条联系。'}</p><button className={setupPrimary} disabled={busy} onClick={onNext}>继续其他内容</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   conflict?<><h2 className="text-2xl">本次回答需要核对</h2><p>进度已在另一处更新，原回答已保留。请联网读取最新进度后继续。</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>使用最新进度继续</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   !run.currentStep&&run.nextEligibleAt?<><h2 className="text-2xl">稍后再回想这个目标</h2><p>最近可继续时间：{new Date(run.nextEligibleAt).toLocaleString()}</p><button className={setupPrimary} disabled={busy} onClick={onNext}>继续其他内容</button><button className={setupButton} onClick={onPause}>暂停并回首页</button></>:
   progress.phase==='pending_result'?<><h2 className="text-2xl">回答已保存在本机</h2><p>等待服务器确认本次结果。你可以先暂停。</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>检查本次结果</button><button className={setupButton} disabled={busy} onClick={onPause}>暂停并回首页</button></>:
   !material||!canContinueRun(run)?<><h2 className="text-2xl">请联网恢复学习</h2><p>{!material?'需要下载这次学习的材料。':'需要核对时间后才能继续。已保存的回答仍然保留。'}</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>联网恢复</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   <><p className="text-sm text-[#68748d]">{progress.phase==='recall'?'先回想一下':'对照刚才的回想'}</p>
    <h2 className="text-2xl leading-10">{text('experience_recall_cue','scene')}</h2><p className="leading-7 text-[#68748d]">{text('experience_recall_cue','senseFocus')}</p>
    {progress.phase==='recall'?<><p>试着想出合适的英语表达。</p><button className={setupPrimary} disabled={busy} onClick={()=>onAction({kind:'reveal'})}>查看表达</button></>:
    <><div className="space-y-4 rounded-2xl border bg-white p-6"><h3 className="text-4xl font-semibold">{text('target_expression','surface')}</h3><p className="text-lg leading-8">{text('sense_confirmation','meaning')}</p>{text('usage_guidance','example')&&<p className="leading-7">{text('usage_guidance','example')}</p>}{audio&&<audio aria-label="学习表达发音" controls src={audio} className="max-w-full"/>}</div>
     <p>刚才回想得怎么样？</p><div className="flex flex-wrap gap-3">{([{rating:'again',label:'没想起'},{rating:'hard',label:'有点困难'},{rating:'good',label:'想起来了'}] as const).map(x=><button key={x.rating} className={x.rating==='good'?setupPrimary:setupButton} disabled={busy} onClick={()=>onAction({kind:'rate',rating:x.rating})}>{x.label}</button>)}</div></>}
    <button className={setupButton} disabled={busy} onClick={onPause}>暂停并回首页</button>
   </>}
  </div>
 </LearningSetupFrame>;
}
