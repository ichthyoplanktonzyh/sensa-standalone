import {useNavigate,useRouterState} from '@tanstack/react-router';
import {parseMainStack} from '../router/shellLocation';
import {WebShell} from '../ui/WebShell';
import {HomeScreen} from '../components/HomeScreen';
import {StudyScreen} from '../components/StudyScreen';
import {StudyCalendar} from '../components/StudyCalendar';
import {ProfileScreen} from '../components/ProfileScreen';
import {StatsScreen} from '../components/StatsScreen';
import {LearningTargetLibraryScreen} from '../components/learning/LearningTargetLibraryScreen';
import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {LearningSetupFrame,setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {AccountCatalog} from './AccountCatalog';
import {AccountContent} from './AccountContent';
import {AccountLearning} from './AccountLearning';
import {AccountLearningSummary} from './AccountLearningSummary';
import {checkInDate} from '../../data/replica/checkin';
import {clockSample} from '../../data/replica/clock';
import {learningRecords,presentTarget} from './projections';
import {queueAnchorUse,queueContentMembership} from '../../data/replica/accountStore';
import {preparePersonalTarget} from '../../data/consumer/client';
import type {TargetView} from '@sensa/contracts/sensa';
import {connectExtension} from '../../data/consumer/client';
import {queuePersonalLearning,queueCancelPreparation,queueSemanticAcceptance,queueIntake} from '../../data/replica/accountStore';
import {queueCheckIn} from '../../data/replica/checkin';
import {queueRuntimeCommand,queueRunAction,useLatestRunProgress} from '../../data/replica/initialRuntime';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountContext } from '@sensa/contracts/sensa';
import { auth,cachedAccount,ConsumerClientError,initializeAccount,revokeSession,syncAccount,cacheRunMaterial } from '../../data/consumer/client';
import { loadAccountReplica,queueQuantity,queueTarget,queueMastery } from '../../data/replica/accountStore';
import type { AccountReplica } from '../../data/replica/accountStore';

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

export default function SensaApp(){
  const [account,setAccount]=useState<AccountContext|null>(null);
  const [replica,setReplicaState]=useState<AccountReplica|null>(null);
  const accountScope=useRef<string|null>(null);
  const setReplica=(value:AccountReplica|null)=>{if(!value||value.accountId===accountScope.current)setReplicaState(value);};
  const [connectedEmail,setConnectedEmail]=useState('');
  const [boot,setBoot]=useState(true);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
  const [email,setEmail]=useState('');const [code,setCode]=useState('');const [sent,setSent]=useState(false);
  const [retryAt,setRetryAt]=useState(0);const [now,setNow]=useState(Date.now());
  const [quantity,setQuantity]=useState<(typeof choices)[number]>(5);const [settings,setSettings]=useState(false);
  const [showSummary,setShowSummary]=useState(false);
  const [runId,setRunId]=useState<string|null>(null);
  const routePath=useRouterState({select:state=>state.location.pathname});
  const navigate=useNavigate();
  const [current,setCurrentState]=useState(()=>parseMainStack(location.pathname).at(-1)??'s-home');
  const [createRequested,setCreateRequested]=useState(false);
  const [selectedTarget,setSelectedTarget]=useState<TargetView|null>(null);
  const setCurrent=(id:string)=>{setCurrentState(id);setCreateRequested(false);setSelectedTarget(null);void navigate({to:'/$',params:{_splat:id==='s-home'?'':id.slice(2)},search:{}});};
  useEffect(()=>{setCurrentState(parseMainStack(routePath).at(-1)??'s-home');},[routePath]);const generation=useRef(0);
  const recover=useCallback(async()=>{
    if(!auth){setBoot(false);return;}
    const own=++generation.current;
    const {data}=await auth.getSession();
    if(!data.session){setAccount(null);setReplica(null);setBoot(false);return;}
    if(own===generation.current)setConnectedEmail(data.session.user.email??'');
    let next:AccountContext;
    try {next=await initializeAccount(data.session.user.id);}
    catch(e){
      // An explicit denial must never fall back to cached authorization.
      const cached=!(e instanceof ConsumerClientError)&&cachedAccount(data.session.user.id);
      if(!cached){if(own===generation.current){setNotice(message(e));setAccount(null);setReplica(null);setBoot(false);}return;}
      next=cached;
    }
    if(own!==generation.current)return;
    if(accountScope.current!==next.accountId){setReplica(null);setRunId(null);setShowSummary(false);setSettings(false);setCurrentState((new URLSearchParams(location.search).has('intake')||new URLSearchParams(location.search).has('meaning'))?'s-content':parseMainStack(location.pathname).at(-1)??'s-home');}
    accountScope.current=next.accountId;setAccount(next);
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
  async function saveQuantity(value=quantity){
    if(!account)return;
    const saved=await queueQuantity(account,value);setReplica(saved);setNotice('已保存在本机，正在同步。');
    try{const synced=await syncAccount(account);setReplica(synced);setQuantity(synced.plan?.dailyNewLimit??5);if(!replica?.plan)setSettings(false);setNotice(synced.outbox.some(x=>x.state==='retained')?'数量已在另一处更新。已保留你的选择，请查看最新设置后重新确认。':'');}
    catch(e){setNotice(message(e));}
  }
  async function startLearning(next=false,mode:'mixed'|'review_only'=replica?.activity?.mode??'mixed',early=false){
    if(!account)return;
    let state=await loadAccountReplica(account);
    if(!navigator.onLine){const active=Object.values(state.runs).find(r=>r.status==='active'&&r.currentStep&&(mode==='mixed'||r.purpose!=='initial_learning'));if(!active)throw new Error('请联网开始学习');setReplica(state);setRunId(active.id);return;}
    state=await syncAccount(account);setReplica(state);
    if(state.outbox.some(x=>x.state==='pending'&&x.operation.kind!=='check_in.record')){setNotice('请先检查本次结果。');return;}
    state=await queueRuntimeCommand(account,next?'activity.next':'activity.start_or_resume',{mode,early});setReplica(state);
    state=await syncAccount(account);setReplica(state);
    const run=state.activity?.runId?state.runs[state.activity.runId]:null;
    if(run){setShowSummary(false);setRunId(run.id);if(!state.materials[run.materializationId]){state=await cacheRunMaterial(account,run);setReplica(state);}}
    else {setRunId(null);setShowSummary(true);}
  }
  async function endLearning(){if(!account)return;setReplica(await queueRuntimeCommand(account,'activity.end'));setRunId(null);setShowSummary(true);setReplica(await syncAccount(account));}
  async function checkIn(automatic=false){
    if(!account)return;
    try{const saved=await queueCheckIn(account,automatic&&runId?replica?.runs[runId]:undefined);setReplica(saved);if(!automatic)setNotice('签到已保存在本机，等待确认。');setReplica(await syncAccount(account));if(!automatic)setNotice('');}
    catch(e){setNotice(automatic?'学习可以继续，签到暂未确认。已保存的签到会在联网后重试。':message(e));}
  }
  async function pauseLearning(){
    if(!account)return;setReplica(await queueRuntimeCommand(account,'activity.pause'));setRunId(null);
    try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}
  }
  async function checkLearning(){
    if(!account)return;const state=await syncAccount(account);setReplica(state);
    const run=runId?state.runs[runId]:null;if(run?.completion)return;
    if(runId){const conflicted=(s:AccountReplica|null)=>s?.outbox.some(x=>x.state==='retained'&&!x.resolved&&x.operation.kind==='run.record_action'&&x.operation.payload.runId===runId);if(conflicted(state)&&!conflicted(replica))return;setReplica(await useLatestRunProgress(account,runId));}
    await startLearning();
  }
  async function addMeaning(meaningId:string){if(!account)return;if(!replica?.plan){setNotice('请先确认每日学习数量，再将这个意思加入学习。意思已保留。');setCurrent('s-home');return;}setReplica(await queuePersonalLearning(account,meaningId));setReplica(await syncAccount(account));}
  async function prepareMeaning(target:TargetView,cancel=false){if(!account||!target.learningTarget)return;if(cancel){setReplica(await queueCancelPreparation(account,target));setReplica(await syncAccount(account));return;}if(target.plan?.readiness==='blocked'){setReplica(await queueTarget(account,target.candidate,target));setReplica(await syncAccount(account));}setReplica(await preparePersonalTarget(account,target.learningTarget.learningTargetId));setReplica(await syncAccount(account));}
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
  const extensionParams=new URLSearchParams(location.search);
  if(extensionParams.get('extension')==='connect')return <main className="mx-auto max-w-lg space-y-5 p-8"><h1 className="text-2xl">连接 Sensa 浏览器插件</h1><p>当前账号：{connectedEmail}</p><p>允许插件将你主动保存的网页材料同步到当前账号。未点击保存的网页不会进入收件箱。</p>{alert}<button className={setupPrimary} disabled={busy} onClick={()=>void perform(async()=>{const result=await connectExtension({installationId:extensionParams.get('installationId'),state:extensionParams.get('state'),challenge:extensionParams.get('challenge'),redirectUri:extensionParams.get('redirectUri')});window.location.assign(result.redirectUri);})}>连接当前账号</button><button className={setupButton} onClick={()=>window.close()}>取消</button></main>;
  const setup=!replica?.plan&&current!=='s-content';
  if(setup)return <LearningSetupFrame id="s-quantity" active title="每日新学数量" onBack={()=>{if(replica?.plan)setSettings(false);else setNotice('请先明确确认每日数量，再开始学习。');}}>
    <div className="mx-auto max-w-lg space-y-6"><h2 className="text-3xl font-semibold">每天想新学多少个？</h2><p className="text-[#68748d] leading-7">这是每天新内容的上限。以后可以修改，已经开始的学习会保持原样。</p>
      <fieldset><legend className="mb-3 text-sm">每日新学数量</legend><div className="flex flex-wrap gap-3">{choices.map(n=><label key={n} className={'flex min-h-12 min-w-14 cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 '+(quantity===n?'border-[#303f76] bg-[#edf0f7]':'border-[#bec5d5]')}><input type="radio" name="quantity" value={n} checked={quantity===n} onChange={()=>setQuantity(n)} />{n}</label>)}</div></fieldset>
      {alert}{pending>0&&<p role="status">有 {pending} 项设置已保存在本机，等待联网确认。</p>}
      <button className={setupPrimary+' w-full'} disabled={busy||(!replica?.plan&&pending>0)||!replica?.replicaId} onClick={()=>void perform(saveQuantity)}>{busy?'正在保存…':'确认数量并继续'}</button>
      {(pending>0||!replica?.replicaId)&&<button className={setupButton} onClick={()=>void perform(recover)}>检查同步结果</button>}
    </div>
  </LearningSetupFrame>;
  if(!replica)return <main role="status">正在读取你的学习…</main>;
  const showContent=()=>{setCurrent('s-content');setCreateRequested(true);};
  const openTarget=(target:TargetView)=>{setCurrentState('s-learning-target');setCreateRequested(false);setSelectedTarget(target);void navigate({to:'/$',params:{_splat:'learning-target'},search:{candidate:target.candidate.candidateId}});};
  const counts=replica.homeCounts;
  const targets=Object.values(replica.targets).filter(t=>t.membership&&t.learningTarget);
  const ids=targets.map(t=>t.learningTarget!.learningTargetId);
  const matching=(predicate:(target:TargetView)=>boolean)=>new Set(targets.filter(predicate).map(t=>t.learningTarget!.learningTargetId));
  const hasPendingRun=replica.outbox.some(x=>x.state==='pending'&&x.operation.kind==='run.record_action');
  const activeRun=Object.values(replica.runs).find(r=>r.status==='active');
  const records=learningRecords(replica);
  const day=clockSample(account.clockGrant)?.occurredAt;
  const today=day?checkInDate(day,account.timeZone):replica.plan?.accountDate??new Date().toISOString().slice(0,10);
  const pendingDates=replica.outbox.filter(x=>x.state==='pending'&&x.operation.kind==='check_in.record').map(x=>checkInDate(x.operation.occurredAt,account.timeZone));
  const status=<>{alert}{pending>0&&<div role="status" className="my-5 rounded-xl bg-[#edf0f7] p-4 text-sm leading-7">有 {pending} 项请求待同步。<button className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>检查本次结果</button></div>}{retained>0&&<details className="my-5 rounded-xl border border-[#e0e5ee] p-4 text-sm"><summary>有 {retained} 项未接受的请求，查看原选择</summary>{replica.outbox.filter(x=>x.state==='retained').map(x=><p className="mt-3" key={x.operation.operationId}>{'dailyNewLimit' in x.operation.payload?`每日 ${x.operation.payload.dailyNewLimit} 个`:'原请求'}：未被接受。原选择已保留，请查看最新状态后重试。</p>)}</details>}</>;
  const screenStatus=settings?null:status;
  const focused=showSummary||!!runId;
  const home=()=>{setRunId(null);setShowSummary(false);setCurrent('s-home');};
  return <WebShell current={focused?showSummary?'s-activity-summary':'s-initial-learning':current} focused={focused} onNavigate={setCurrent} availableSections={['s-home','s-content','s-study']}>
   {showSummary?<AccountLearningSummary replica={replica} busy={busy} notice={notice} onNext={()=>void perform(()=>startLearning(replica.summary?.status!=='ended'))} onEarly={()=>void perform(()=>startLearning(true,replica.activity?.mode??'mixed',true))} onEnd={()=>void perform(endLearning)} onHome={home}/>:
   runId&&replica.runs[runId]?<AccountLearning replica={replica} run={replica.runs[runId]!} busy={busy} notice={notice} onAction={action=>void perform(async()=>{const saved=await queueRunAction(account,runId,action);setReplica(saved);setBusy(false);try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}})} onPause={()=>void perform(pauseLearning)} onCheck={()=>void perform(checkLearning)} onNext={()=>void perform(()=>startLearning(true))} onHome={home} onEntered={()=>void checkIn(true)}/>:
   <>
    {current==='s-home'&&<HomeScreen active onGo={setCurrent} busy={busy} status={screenStatus} accountDate={replica.plan?.accountDate} newAvailable={counts?.newAvailable??0} mixedReadyN={counts?.distinctExecutableTargets??0} reviewDueN={counts?.dueReviews??0} onStartMixed={()=>void perform(()=>startLearning(false,'mixed'))} onResume={activeRun||hasPendingRun?()=>void perform(()=>startLearning(false,'mixed')):undefined} onStartReview={()=>void perform(()=>startLearning(false,'review_only'))} onRecordContext={showContent}/>}
    {current==='s-content'&&<AccountContent key={account.accountId} status={screenStatus} createRequested={createRequested} replica={replica} onBrowse={()=>setCurrent('s-learning-entry')} onTarget={openTarget} onAnchorUse={async(id,enabled)=>{setReplica(await queueAnchorUse(account,id,enabled));setReplica(await syncAccount(account));}} onMembership={async(entity,id,active)=>{setReplica(await queueContentMembership(account,entity,id,active));setReplica(await syncAccount(account));}} onAdd={addMeaning} onPrepare={prepareMeaning} onHome={home} onAccept={async(lookupId,intakeId)=>{setReplica(await queueSemanticAcceptance(account,lookupId,intakeId));const state=await syncAccount(account);setReplica(state);return state.intakes[intakeId]?.meaningId??null;}} onSave={async snapshot=>{setReplica(await queueIntake(account,snapshot));try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}}}/>}
    {(current==='s-learning-entry'||current==='s-learning-target')&&<AccountCatalog status={screenStatus} screenId={current} key={selectedTarget?.learningTarget?.learningTargetId??'catalog'} initialTarget={selectedTarget} account={account} replica={replica} onPrepare={prepareMeaning} onPersonal={()=>setCurrent('s-content')} onBack={()=>setCurrent(current==='s-learning-target'?'s-learning-library':'s-home')} onMastery={async(target)=>{setReplica(await queueMastery(account,target));setReplica(await syncAccount(account));}} onHome={home} onSubmit={async(candidate,retry)=>{const saved=await queueTarget(account,candidate,retry);setReplica(saved);try{setReplica(await syncAccount(account));}catch(e){setNotice(message(e));}}}/>}
    {current==='s-study'&&<StudyScreen active tab="a" onTabChange={()=>setSettings(true)} status={screenStatus} onOpenPreferences={()=>setSettings(true)} onAddLearning={()=>setCurrent('s-learning-entry')} onOpenTargetLibrary={()=>setCurrent('s-learning-library')} onOpenStats={()=>setCurrent('s-stats')} onOpenTarget={id=>{const target=replica.targets[id];if(target)openTarget(target);}} defaultPolicy="lightweight" onPolicyChange={()=>{}} learningTargetCount={ids.length} readyInitialCount={(counts?.newAvailable??0)+(counts?.initialContinuations??0)} reviewCount={counts?.dueReviews??0} dailyNewCount={replica.plan?.dailyNewLimit??5} learningRecords={records} onDailyNewCountChange={value=>void perform(()=>saveQuantity(value as typeof quantity))} calendar={<StudyCalendar account={{today,dates:Object.keys(replica.checkins),pending:pendingDates,busy,uncertain:replica.outbox.some(x=>x.state==='retained'&&x.error==='clock_untrusted'),timeZone:account.timeZone,onCheckIn:()=>void perform(()=>checkIn())}}/>}/>}
    {current==='s-learning-library'&&<LearningTargetLibraryScreen active targetIds={ids} targets={Object.fromEntries(targets.map(t=>[t.learningTarget!.learningTargetId,presentTarget(t.candidate,t)]))} policyByTarget={Object.fromEntries(ids.map(id=>[id,'lightweight' as const]))} preparationByTarget={Object.fromEntries(targets.map(t=>[t.learningTarget!.learningTargetId,t.plan?.readiness??'preparing']))} committedTargetIds={matching(t=>t.phase==='acquiring')} completedTargetIds={matching(t=>t.phase==='retaining')} reviewDueTargetIds={matching(t=>!!t.dueAt&&Date.parse(t.dueAt)<=Date.now())} relearningTargetIds={new Set(Object.values(replica.runs).filter(r=>r.status==='active'&&r.purpose==='relearning').map(r=>r.learningTargetId))} reviewingTargetIds={new Set(Object.values(replica.runs).filter(r=>r.status==='active'&&r.purpose==='retention_review').map(r=>r.learningTargetId))} relearningRepairTargetIds={new Set()} relearningRetestTargetIds={new Set()} declaredMasteryTargetIds={matching(t=>t.declaredMastery.active)} onBack={()=>setCurrent('s-study')} onAddLearning={()=>setCurrent('s-learning-entry')} onOpenTarget={id=>{const target=replica.targets[id];if(target)openTarget(target);}}/>}
    {current==='s-stats'&&<StatsScreen active records={records} onBack={()=>setCurrent('s-study')} onOpenTarget={id=>{const target=replica.targets[id];if(target)openTarget(target);}}/>}
    {current==='s-profile'&&<ProfileScreen active status={screenStatus} account={{email:connectedEmail,pending,busy,onSync:()=>void perform(recover),onLogout:()=>void perform(async()=>{await revokeSession();setAccount(null);setReplica(null);setSent(false);setCode('');})}} onOpenPreferences={()=>setSettings(true)} onGoStudyPlan={()=>setCurrent('s-study')} defaultPolicy="lightweight" dailyNewCount={replica.plan?.dailyNewLimit??5} onPolicyChange={()=>{}} onDailyNewCountChange={value=>void perform(()=>saveQuantity(value as typeof quantity))}/>}
    {settings&&<LearningPreferencesPanel fixedPolicy busy={busy} status={status} closeLabel="完成" defaultPolicy="lightweight" dailyNewCount={replica.plan?.dailyNewLimit??5} onPolicyChange={()=>{}} onDailyNewCountChange={value=>void perform(()=>saveQuantity(value as typeof quantity))} onClose={()=>setSettings(false)}/>}
   </>}
  </WebShell>;
}
