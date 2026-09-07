import {InitialLearning} from './InitialLearning';
import {queueRuntimeCommand,queueRunAction,useLatestRunProgress} from '../data/replica/initialRuntime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TargetLibrary } from './TargetLibrary';
import type { AccountContext } from '@sensa/contracts/sensa';
import { WebShell } from '../experience/ui/WebShell';
import { LearningSetupFrame, setupButton, setupPrimary } from '../experience/components/learning/LearningSetupFrame';
import { auth,cachedAccount,ConsumerClientError,initializeAccount,revokeSession,syncAccount,cacheRunMaterial } from '../data/consumer/client';
import { loadAccountReplica,queueQuantity,queueTarget,queueMastery } from '../data/replica/accountStore';
import type { AccountReplica } from '../data/replica/accountStore';

const choices=[5,10,15,20,30] as const;
const message=(error:unknown)=> {
  if(error instanceof ConsumerClientError){
    if(error.code==='invite_required')return '此账号尚未获得 Sensa 使用资格。';
    if(error.code==='auth_not_configured')return '登录服务暂时不可用，请稍后重试。';
    if(error.status===401)return '登录已过期，请重新登录。你的本机记录仍然保留。';
  }
  if(error instanceof Error&&/[\u4e00-\u9fff]/u.test(error.message))return error.message;
  return navigator.onLine?'暂时无法完成，请重试。已保存的本机记录仍然保留。':'当前离线，已保存在本机的记录会在联网后同步。';
};

export default function AccountRoot(){
  const [account,setAccount]=useState<AccountContext|null>(null);
  const [replica,setReplica]=useState<AccountReplica|null>(null);
  const [boot,setBoot]=useState(true);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
  const [email,setEmail]=useState('');const [code,setCode]=useState('');const [sent,setSent]=useState(false);
  const [retryAt,setRetryAt]=useState(0);const [now,setNow]=useState(Date.now());
  const [quantity,setQuantity]=useState<(typeof choices)[number]>(5);const [settings,setSettings]=useState(false);
  const [runId,setRunId]=useState<string|null>(null);
  const [current,setCurrent]=useState('s-home');const generation=useRef(0);
  const recover=useCallback(async()=>{
    if(!auth){setBoot(false);return;}
    const own=++generation.current;
    const {data}=await auth.getSession();
    if(!data.session){setAccount(null);setReplica(null);setBoot(false);return;}
    let next:AccountContext;
    try {next=await initializeAccount(data.session.user.id);}
    catch(e){
      // An explicit denial must never fall back to cached authorization.
      const cached=!(e instanceof ConsumerClientError)&&cachedAccount(data.session.user.id);
      if(!cached){if(own===generation.current){setNotice(message(e));setAccount(null);setBoot(false);}return;}
      next=cached;
    }
    if(own!==generation.current)return;
    setAccount(next);
    try {
      const local=await loadAccountReplica(next);if(own!==generation.current)return;setReplica(local);setQuantity(local.plan?.dailyNewLimit??5);
      const synced=await syncAccount(next);if(own!==generation.current)return;
      setReplica(synced);setQuantity(synced.plan?.dailyNewLimit??5);setNotice('');
    }catch(e){if(own===generation.current){if(e instanceof ConsumerClientError&&(e.status===401||e.status===403))setAccount(null);setNotice(message(e));}}
    finally {if(own===generation.current)setBoot(false);}
  },[]);
  useEffect(()=>{
    void recover();const {data}=auth?.onAuthStateChange(()=>{queueMicrotask(()=>void recover());})??{data:null};
    const refresh=()=>void recover();window.addEventListener('online',refresh);
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>{generation.current++;data?.subscription.unsubscribe();window.removeEventListener('online',refresh);clearInterval(timer);};
  },[recover]);
  const perform=async(action:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await action();}catch(e){setNotice(message(e));}finally{setBusy(false);}};
  async function sendCode(){
    if(!auth)return;
    const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false}});
    if(error){setNotice(error.status===429?'发送过于频繁，请稍后重试。':'验证码暂时无法发送，请检查邮箱或稍后重试。');return;}
    setSent(true);setRetryAt(Date.now()+60_000);
  }
  async function verifyCode(){
    if(!auth)return;const {error}=await auth.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});
    if(error)setNotice('验证码不正确或已过期，请重新输入或发送。');
  }
  async function saveQuantity(){
    if(!account)return;
    const saved=await queueQuantity(account,quantity);setReplica(saved);setNotice('已保存在本机，正在同步。');
    try{const synced=await syncAccount(account);setReplica(synced);setSettings(false);setNotice(synced.outbox.some(x=>x.state==='retained')?'数量已在另一处更新。已保留你的选择，请查看最新设置后重新确认。':'');}
    catch(e){setNotice(message(e));}
  }
  async function startLearning(next=false){
    if(!account)return;
    let state=await loadAccountReplica(account);
    if(!navigator.onLine){const active=Object.values(state.runs).find(r=>r.status==='active');if(!active)throw new Error('请联网开始学习');setReplica(state);setRunId(active.id);return;}
    state=await syncAccount(account);setReplica(state);
    if(state.outbox.some(x=>x.state==='pending')){setNotice('请先检查本次结果。');return;}
    state=await queueRuntimeCommand(account,next?'activity.next':'activity.start_or_resume');setReplica(state);
    state=await syncAccount(account);setReplica(state);
    const run=state.activity?.runId?state.runs[state.activity.runId]:null;
    if(run){setRunId(run.id);if(!state.materials[run.materializationId]){state=await cacheRunMaterial(account,run);setReplica(state);}}
    else {setRunId(null);setNotice(state.plan?.newRemaining===0?'今天的新学数量已达到上限。':'目前没有可开始的新内容。可以选择其他学习目标。');}
  }
  async function pauseLearning(){
    if(!account)return;setReplica(await queueRuntimeCommand(account,'activity.pause'));setRunId(null);
    try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}
  }
  async function checkLearning(){
    if(!account)return;const state=await syncAccount(account);setReplica(state);
    const run=runId?state.runs[runId]:null;if(run?.completion)return;
    if(runId)setReplica(await useLatestRunProgress(account,runId));
    await startLearning();
  }
  const pending=replica?.outbox.filter(x=>x.state==='pending').length??0;
  const retained=replica?.outbox.filter(x=>x.state==='retained').length??0;
  const alert=notice?<p role="status" className="my-4 rounded-xl bg-[#edf0f7] p-4 text-sm leading-6">{notice}</p>:null;
  if(boot)return <main className="grid min-h-screen place-content-center bg-[#fbfbfa]" role="status">正在读取你的学习…</main>;
  if(!auth)return <main className="grid min-h-screen place-content-center gap-4 bg-[#fbfbfa] p-6"><h1 className="text-2xl">Sensa</h1><p role="status">登录服务暂时不可用，请稍后重试。</p></main>;
  if(!account)return <main className="flex min-h-screen items-center justify-center bg-[#fbfbfa] px-6 text-[#242a38]">
    <form className="w-full max-w-sm space-y-5" onSubmit={e=>{e.preventDefault();void perform(sent?verifyCode:sendCode);}}>
      <p className="text-sm text-[#68748d]">Sensa · 受邀使用</p><h1 className="text-3xl font-semibold">{sent?'输入邮箱验证码':'欢迎来到 Sensa'}</h1>
      <p className="text-sm leading-6">{sent?`验证码已发送至 ${email}`:'使用受邀邮箱登录，无需设置密码。'}</p>
      {!sent?<label className="block text-sm">邮箱<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>:
        <label className="block text-sm">验证码<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} /></label>}
      {alert}<button className={setupPrimary+' w-full'} disabled={busy}>{busy?'正在处理…':sent?'验证并继续':'发送验证码'}</button>
      {sent&&<div className="flex flex-wrap justify-between gap-2"><button className={setupButton} type="button" disabled={busy||retryAt>now} onClick={()=>void perform(sendCode)}>{retryAt>now?`${Math.ceil((retryAt-now)/1000)} 秒后可重发`:'重新发送'}</button><button type="button" className={setupButton} onClick={()=>{setSent(false);setCode('');setNotice('');}}>更换邮箱</button></div>}
      {notice&&<button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>重新检查登录</button>}
    </form>
  </main>;
  const setup=!replica?.plan||settings;
  if(setup)return <LearningSetupFrame id="s-quantity" active title="每日新学数量" onBack={()=>{if(replica?.plan)setSettings(false);else setNotice('请先明确确认每日数量，再开始学习。');}}>
    <div className="mx-auto max-w-lg space-y-6"><h2 className="text-3xl font-semibold">每天想新学多少个？</h2><p className="text-[#68748d] leading-7">这是每天新内容的上限。以后可以修改，已经开始的学习会保持原样。</p>
      <fieldset><legend className="mb-3 text-sm">每日新学数量</legend><div className="flex flex-wrap gap-3">{choices.map(n=><label key={n} className={'flex min-h-12 min-w-14 cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 '+(quantity===n?'border-[#303f76] bg-[#edf0f7]':'border-[#bec5d5]')}><input type="radio" name="quantity" value={n} checked={quantity===n} onChange={()=>setQuantity(n)} />{n}</label>)}</div></fieldset>
      {alert}{pending>0&&<p role="status">有 {pending} 项设置已保存在本机，等待联网确认。</p>}
      <button className={setupPrimary+' w-full'} disabled={busy||(!replica?.plan&&pending>0)||!replica?.replicaId} onClick={()=>void perform(saveQuantity)}>{busy?'正在保存…':'确认数量并继续'}</button>
      {(pending>0||!replica?.replicaId)&&<button className={setupButton} onClick={()=>void perform(recover)}>检查同步结果</button>}
    </div>
  </LearningSetupFrame>;
  if(runId&&replica.runs[runId])return <InitialLearning replica={replica} run={replica.runs[runId]!} busy={busy} notice={notice} onAction={action=>void perform(async()=>{const saved=await queueRunAction(account,runId,action);setReplica(saved);setBusy(false);try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}})} onPause={()=>void perform(pauseLearning)} onCheck={()=>void perform(checkLearning)} onNext={()=>void perform(()=>startLearning(true))} onHome={()=>{setRunId(null);setCurrent('s-home');}}/>;
  return <WebShell current={current} focused={false} onNavigate={setCurrent} availableSections={['s-home','s-content','s-study']}>
    <section id={current} className="screen active absolute inset-0 overflow-y-auto p-6 sm:p-10">
      <div className="mx-auto max-w-3xl space-y-6"><h1 className="text-3xl font-semibold">{current==='s-home'?'今天的学习':current==='s-study'?'我的学习':current==='s-content'?'我的内容':current==='s-profile'?'账号与设置':'自由练习'}</h1>
        {alert}{pending>0&&<div role="status" className="rounded-2xl bg-[#edf0f7] p-5">有 {pending} 项请求待同步。<button className={setupButton} onClick={()=>void perform(recover)}>检查本次结果</button></div>}
        {retained>0&&<details><summary className="cursor-pointer py-3">有 {retained} 项未接受的请求，查看原选择</summary><ul>{replica.outbox.filter(x=>x.state==='retained').map(x=><li key={x.operation.operationId} className="py-2 text-sm">{'dailyNewLimit' in x.operation.payload?`每日 ${x.operation.payload.dailyNewLimit} 个`:x.operation.kind==='run.record_action'?`学习回答：${x.operation.payload.action.kind==='reveal'?'查看表达':x.operation.payload.action.rating==='again'?'没想起':x.operation.payload.action.rating==='hard'?'有点困难':'想起来了'}`:'学习或目标请求'}：未被接受。请查看最新状态后重新确认。</li>)}</ul></details>}
        {current==='s-home'&&<div className="rounded-2xl border p-6 space-y-4"><p>今天已开始 {replica.plan?.newStartedToday??0} 个新目标</p><button className={setupPrimary} disabled={busy} onClick={()=>void perform(()=>startLearning())}>{Object.values(replica.runs).some(r=>r.status==='active')?'继续本次学习':'开始学习'}</button></div>}
        {current==='s-content'?<TargetLibrary account={account} replica={replica} onMastery={async(target)=>{setReplica(await queueMastery(account,target));setReplica(await syncAccount(account));}} onHome={()=>setCurrent('s-home')} onSubmit={async(candidate,retry)=>{const saved=await queueTarget(account,candidate,retry);setReplica(saved);try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}}}/>:<>
        <div className="rounded-2xl border border-[#e2e6ef] bg-white p-6"><p className="text-sm text-[#68748d]">每日新学上限</p><p className="my-3 text-4xl font-semibold">{replica.plan!.dailyNewLimit}<span className="ml-2 text-base font-normal">个</span></p><button className={setupButton} onClick={()=>setSettings(true)}>修改数量</button></div>
        <div className="rounded-2xl border border-[#e2e6ef] p-6 space-y-4"><h2 className="text-xl">{Object.keys(replica.targets).length?'你的学习目标':'还没有学习目标'}</h2>
          {Object.values(replica.targets).map(target=><div key={target.learningTarget!.learningTargetId} className="border-b py-3"><p className="font-semibold">{target.candidate.expression}</p><p className="my-2 text-[#68748d]">{target.candidate.meaning}</p><p className="text-sm">{target.declaredMastery.active?'已声明会用':target.phase==='retaining'?'已完成首次学习，等待复习':target.phase==='acquiring'?'首次学习进行中':target.plan?.readiness==='ready'?'学习内容已准备好':target.plan?.readiness==='preparing'?'学习内容准备中':'暂时无法准备，目标已保留'}</p></div>)}
          <button className={setupPrimary} onClick={()=>setCurrent('s-content')}>选择学习内容</button>
        </div></>}
        <button className={setupButton} disabled={busy||pending>0} onClick={()=>void perform(async()=>{await revokeSession();setAccount(null);setReplica(null);setSent(false);setCode('');})}>退出登录</button>
        {pending>0&&<p className="text-sm text-[#68748d]">请先同步本机请求，再退出登录。</p>}
      </div>
    </section>
  </WebShell>;
}
