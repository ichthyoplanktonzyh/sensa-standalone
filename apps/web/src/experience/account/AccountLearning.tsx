import {RuntimeFrame} from '../components/learning/RuntimeFrame';
import {ExperienceRecallCard} from '../components/cards/lightweight/ExperienceRecallCard';
import {ExpressionRevealCard} from '../components/cards/lightweight/ExpressionRevealCard';
import {checkInDate} from '../../data/replica/checkin';
import {useEffect,useState} from 'react';
import type {ConsumerAction,ConsumerRun} from '@sensa/contracts/sensa';
import type {AccountReplica} from '../../data/replica/accountStore';
import {canContinueRun,runProgress} from '../../data/replica/initialRuntime';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
export function AccountLearning({replica,run,busy,notice,onAction,onPause,onCheck,onNext,onHome,onEntered}:{replica:AccountReplica;run:ConsumerRun;busy:boolean;notice:string;onAction:(action:ConsumerAction)=>void;onPause:()=>void;onCheck:()=>void;onNext:()=>void;onHome:()=>void;onEntered:()=>void}){
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
 return <RuntimeFrame id="s-initial-learning" active title={title} stepLabel={complete?"本次结果":progress.phase==="recall"?"回想表达":"对照回想"} progress={complete?100:progress.phase==="recall"?0:50} onExit={onPause}>
  <div className="space-y-6">
   {(signed||signing)&&<p className="text-xs text-[#68748d]">{signed?'今日已签到':'签到待同步'}</p>}
   {notice&&<p role="status" className="rounded-xl bg-[#edf0f7] p-4 leading-7">{notice}</p>}
   {complete?<><h2 className="text-3xl font-semibold">{complete.kind==='study_completion'?'已完成首次学习':complete.kind==='review_completed'?'本次复习已记录':'这次已重新想起'}</h2>{complete.dueAt&&<p className="leading-7">下次复习：{new Date(complete.dueAt).toLocaleString()}</p>}<p className="text-[#68748d]">{complete.rating==='again'?'这次没想起，稍后会再安排回想。先继续其他内容。':complete.kind==='relearning_completion'?'已记录本次恢复，原复习评价与复习时间保持原样。':'之后会通过复习巩固这条联系。'}</p><button className={setupPrimary} disabled={busy} onClick={onNext}>继续其他内容</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   conflict?<><h2 className="text-2xl">本次回答需要核对</h2><p>进度已在另一处更新，原回答已保留。请联网读取最新进度后继续。</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>使用最新进度继续</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   !run.currentStep&&run.nextEligibleAt?<><h2 className="text-2xl">稍后再回想这个目标</h2><p>最近可继续时间：{new Date(run.nextEligibleAt).toLocaleString()}</p><button className={setupPrimary} disabled={busy} onClick={onNext}>继续其他内容</button><button className={setupButton} onClick={onPause}>暂停并回首页</button></>:
   progress.phase==='pending_result'?<><h2 className="text-2xl">回答已保存在本机</h2><p>等待服务器确认本次结果。你可以先暂停。</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>检查本次结果</button><button className={setupButton} disabled={busy} onClick={onPause}>暂停并回首页</button></>:
   !material||!canContinueRun(run)?<><h2 className="text-2xl">请联网恢复学习</h2><p>{!material?'需要下载这次学习的材料。':'需要核对时间后才能继续。已保存的回答仍然保留。'}</p><button className={setupPrimary} disabled={busy} onClick={onCheck}>联网恢复</button><button className={setupButton} onClick={onHome}>回首页</button></>:
   <fieldset disabled={busy} className="min-w-0 border-0 p-0">
    {progress.phase==='recall'?<ExperienceRecallCard presentation={{kind:'experience_recall',presentationKey:'lightweight-experience-recall-card',presentationVersion:'v1',slots:{experienceSketch:{scene:text('experience_recall_cue','scene'),senseFocus:text('experience_recall_cue','senseFocus')},auxiliaryCues:[]}}} onReveal={()=>onAction({kind:'reveal'})}/>:
     <><ExpressionRevealCard initial={run.purpose==='initial_learning'} key={run.id+':'+run.currentStep?.ordinal} presentation={{kind:'expression_reveal',presentationKey:'lightweight-expression-reveal-card',presentationVersion:'v1',slots:{expressionPrimary:{surface:text('target_expression','surface')},senseConfirmation:{meaning:text('sense_confirmation','meaning')},pronunciation:audio?{audioUrl:audio,phoneticNotation:null,accentLabel:null}:null,languageStructure:null,usageGuidance:text('usage_guidance','example')?{example:text('usage_guidance','example')}:null,sceneBridge:{text:text('experience_recall_cue','scene')}}}} onRate={rating=>onAction({kind:'rate',rating})}/>
     {!audio&&<p role="status" className="mt-5 text-sm text-[#68748d]">{pronunciation?'发音音频暂不可用，可继续文字学习。':'这份材料暂无发音音频，可继续文字学习。'}</p>}</>}
    <button className={setupButton+' mt-6'} disabled={busy} onClick={onPause}>暂停并回首页</button>
   </fieldset>}

  </div>
 </RuntimeFrame>;
}
