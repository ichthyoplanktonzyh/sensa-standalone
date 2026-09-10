import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {clearAllCredentials} from '../../data/library/providers';
import {auth} from '../../data/consumer/client';
import {command,readLibrary} from '../../data/library/store';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';

type Access={email:string|null;onlineService:boolean;login:()=>void;logout:()=>Promise<void>};
const AccountContext=createContext<Access>({email:null,onlineService:false,login:()=>{},logout:async()=>{}});
export const useAccountExperience=()=>useContext(AccountContext);
type Owner={subject:string;email:string};
/** Authentication is an online-service boundary, not a consumer sync bootstrap. */
export default function AccountExperience({children}:{children:ReactNode}){
 const [ready,setReady]=useState(false),[local,setLocal]=useState(false),[loginOpen,setLoginOpen]=useState(false),[onlineService,setOnlineService]=useState(false);
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[owner,setOwner]=useState<Owner|null>(null);
 const [retryAt,setRetryAt]=useState(0),[now,setNow]=useState(Date.now());
 const generation=useRef(0);
 const recover=async()=>{
  const gen=++generation.current;
  try{
   const stored=await readLibrary(async tx=>({owner:await tx.get<Owner>('meta','service-owner'),identity:await tx.get('meta','identity'),signedOut:await tx.get<boolean>('meta','signed-out')}));
   if(gen!==generation.current)return;
   setOwner(stored.owner??null);setOnlineService(false);
   const session=(await auth?.getSession())?.data.session;
   if(gen!==generation.current)return;
   if(!session){setLocal(!!stored.identity&&!stored.signedOut);return;}
   if(stored.owner&&stored.owner.subject!==session.user.id){setLocal(false);setNotice('此设备的资料属于另一个账号。请使用原账号登录；本机资料没有改变。');return;}
   setLocal(!!stored.identity&&!stored.signedOut);
   const endpoint=import.meta.env.VITE_SENSA_API_URL;
   if(!endpoint){setNotice('在线服务暂未开放，已有本机内容可以继续使用。');return;}
   const installationId=await command({id:crypto.randomUUID(),kind:'service.installation',input:{}},async tx=>{const existing=await tx.get<string>('meta','service-installation');if(existing)return existing;const id=crypto.randomUUID();tx.put('meta','service-installation',id);return id;});
   if(gen!==generation.current)return;
   const response=await fetch(endpoint.replace(/\/+$/,'')+'/sensa/native/access/session',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify({installationId}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(gen!==generation.current)return;
   if(!response.ok){setNotice(response.status===403?'当前账号尚未获得服务访问权限，请联系 Sensa 支持。':'在线服务暂时不可用，请稍后重试。');return;}
   if((await response.json()).authorized!==true)throw new Error('invalid authorization');
   if(gen!==generation.current)return;
   const next={subject:session.user.id,email:session.user.email??''};
   await command({id:crypto.randomUUID(),kind:'service.connect',input:next},async tx=>{const current=await tx.get<Owner>('meta','service-owner');if(gen!==generation.current)throw new Error('stale login');if(current&&current.subject!==next.subject)throw new Error('account mismatch');tx.put('meta','service-owner',next);tx.put('meta','signed-out',false);return null;});
   if(gen!==generation.current)return;
   setOwner(next);setLocal(true);setOnlineService(true);setLoginOpen(false);setNotice('');
  }catch{if(gen===generation.current)setNotice('暂时无法连接服务，请检查网络后重试。已保存的资料仍保留。');}
  finally{if(gen===generation.current)setReady(true);}
 };
 useEffect(()=>{void recover();const sub=auth?.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')clearAllCredentials();setOnlineService(false);if(event==='SIGNED_OUT'||event==='SIGNED_IN')setLocal(false);setTimeout(()=>void recover(),0);});const online=()=>void recover();window.addEventListener('online',online);const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{generation.current++;sub?.data.subscription.unsubscribe();window.removeEventListener('online',online);clearInterval(timer);};},[]);
 const perform=async(work:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await work();}catch{setNotice('操作未完成，请稍后重试。');}finally{setBusy(false);}};
 const send=async()=>{if(!auth)return;const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true}});if(error){setNotice(error.status===429?'发送过于频繁，请稍后重试。':'验证码未能发送，请检查邮箱后重试。');return;}setSent(true);setRetryAt(Date.now()+60000);};
 const logout=async()=>{clearAllCredentials();await command({id:crypto.randomUUID(),kind:'service.signout',input:{}},async tx=>{tx.put('meta','signed-out',true);return null;});generation.current++;setLocal(false);setOnlineService(false);setLoginOpen(false);const result=await auth?.signOut({scope:'local'});if(result?.error)setNotice('已锁定本机入口，在线会话退出未完成，请重试。');};
 if(!ready)return <main role="status" className="grid min-h-screen place-content-center">正在读取 Sensa…</main>;
 if(local&&!loginOpen)return <AccountContext.Provider value={{email:owner?.email??null,onlineService,login:()=>setLoginOpen(true),logout}}>{children}</AccountContext.Provider>;
 // Reuses the established email/OTP entry layout from the account application.
 return <main className="flex min-h-screen items-center justify-center bg-[#fbfbfa] px-6 text-[#242a38]"><form className="w-full max-w-sm space-y-5" onSubmit={e=>{e.preventDefault();void perform(sent?async()=>{const result=await auth!.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});if(result.error){setNotice('验证码不正确或已过期，请重新输入。');return;}await recover();}:send);}}>
  <p className="text-sm text-[#68748d]">Sensa</p><h1 className="text-3xl font-semibold">{sent?'输入邮箱验证码':'欢迎来到 Sensa'}</h1>
  <p className="text-sm leading-6">{sent?`验证码已发送至 ${email}`:'使用邮箱注册或登录，无需设置密码。登录后选择学习内容，即可开始。'}</p>
  {!auth?<p role="status">登录服务暂时不可用，请稍后重试。</p>:<>{sent?<label className="block text-sm">验证码<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={e=>setCode(e.target.value)} required/></label>:<label className="block text-sm">邮箱<input className="mt-2 w-full rounded-xl border border-[#bec5d5] bg-white p-3" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>}<button className={setupPrimary+' w-full'} disabled={busy}>{busy?'正在处理…':sent?'验证并继续':'发送验证码'}</button></>}
  {notice&&<p role="status">{notice}</p>}
  {sent&&<div className="flex flex-wrap gap-2"><button type="button" className={setupButton} disabled={busy||now<retryAt} onClick={()=>void perform(send)}>{now<retryAt?'稍后可重新发送':'重新发送'}</button><button type="button" className={setupButton} disabled={busy} onClick={()=>{setSent(false);setCode('');}}>更换邮箱</button></div>}
  <button type="button" className={setupButton} disabled={busy} onClick={()=>void perform(recover)}>重新检查登录</button>
  {local&&<button type="button" className={setupButton} onClick={()=>setLoginOpen(false)}>继续使用已有本机内容</button>}
 </form></main>;
}
