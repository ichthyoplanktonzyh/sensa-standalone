import {RuntimeFrame} from '../components/learning/RuntimeFrame';
import type {AccountReplica} from '../../data/replica/accountStore';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
export function AccountLearningSummary({replica,busy,notice,onNext,onEarly,onEnd,onHome}:{replica:AccountReplica;busy:boolean;notice:string;onNext:()=>void;onEarly:()=>void;onEnd:()=>void;onHome:()=>void}){
 const s=replica.summary,pending=replica.outbox.filter(x=>x.state==='pending').length;
 return <RuntimeFrame id="s-activity-summary" active title="本次学习" stepLabel="学习汇总" progress={100} onExit={onHome}><div className="mx-auto max-w-xl space-y-6">
  {notice&&<p role="status">{notice}</p>}{pending>0&&<p role="status">还有 {pending} 项记录待确认。</p>}
  <h2 className="pt-8 text-3xl font-medium tracking-tight">{s?.waitingTargetIds.length?`稍后还有 ${s.waitingTargetIds.length} 个需要再回想`:'本次学习记录'}</h2>
  {s&&<><dl className="grid grid-cols-2 gap-4">{[['首次学习',s.initialTargetIds.length],['已复习',s.reviewTargetIds.length],['重学已恢复',s.restoredTargetIds.length],['仍需回想',s.needsRecallTargetIds.length]].map(([label,count])=><div key={label} className="rounded-2xl border border-[#e0e5ee] bg-white p-6"><dt className="text-sm text-[#68748d]">{label}</dt><dd className="mt-4 text-4xl text-[#303f76]">{count}</dd></div>)}</dl>{s.nextEligibleAt&&<p>最近可继续时间：{new Date(s.nextEligibleAt).toLocaleString()}</p>}</>}
  <p className="text-sm text-[#68748d]">只统计服务器已确认的学习目标。原复习评价与之后的恢复分别保留。</p>
  <div className="flex flex-wrap gap-3"><button className={s?.immediateAvailable?setupPrimary:setupButton} disabled={busy||pending>0} onClick={onNext}>{s?.status==='ended'?'继续学习':s?.immediateAvailable?'继续其他内容':'检查可继续内容'}</button>
   {!!s?.waitingTargetIds.length&&s.status!=='ended'&&!s.immediateAvailable&&<button className={setupButton} disabled={busy||pending>0} onClick={onEarly}>提前继续</button>}
   {s?.status!=='ended'&&<button className={setupPrimary} disabled={busy||pending>0} onClick={onEnd}>结束本次</button>}<button className={setupButton} onClick={onHome}>回首页</button></div>
 </div></RuntimeFrame>;
}
