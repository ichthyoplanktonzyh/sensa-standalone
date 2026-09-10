/** Connects the existing product screens to the local library; owns no page layout. */
import {useEffect,useRef,useState} from 'react';
import {useNavigate,useRouterState} from '@tanstack/react-router';
import {openLibrary,observeLibrary} from '../../data/library/store';
import {listDrafts,saveDraft,type LocalDraft} from '../../data/library/drafts';
import {acceptTeacher,continueTeacher,createTeacher,listMeanings,listTeachers,sayToTeacher,stopTeacher,type LocalMeaning,type TeacherSession} from '../../data/library/teacher';
import {selectedProvider,type Provider} from '../../data/library/providers';
import {ContentScreen,type ContentScreenSource} from '../components/ContentScreen';
import {PersonalMeaningDetailScreen,type MeaningConversationController} from '../components/PersonalMeaningDetailScreen';
import {ProfileScreen} from '../components/ProfileScreen';
import {ProviderPanel} from '../components/ProviderPanel';
import {HomeScreen} from '../components/HomeScreen';
import {IconSprite} from '../components/IconSprite';
import {WebShell} from '../ui/WebShell';
import {projectLocalWorld} from './projection';
const emptyProjection:ContentScreenSource['projection']={recent:[],learned:[],known:[],savedSenses:[],savedExamples:[],notes:[],semanticSenses:[],personalSemanticRegions:[],personalMeanings:[]};
const errorText=(e:unknown)=>e instanceof Error&&/[\u4e00-\u9fff]/u.test(e.message)?e.message:'这次操作未完成，已保存的资料仍在，请检查服务或网络后重试。';
export default function LibraryWorkspace(){
 const navigate=useNavigate();const path=useRouterState({select:s=>s.location.pathname});
 const params=new URLSearchParams(location.search);const sessionId=params.get('conversation');
 const current=path==='/profile'?'s-profile':path==='/content'?'s-content':sessionId?'s-personal-meaning':'s-home';
 const [drafts,setDrafts]=useState<LocalDraft[]>([]),[sessions,setSessions]=useState<TeacherSession[]>([]),[meanings,setMeanings]=useState<LocalMeaning[]>([]);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[recipient,setRecipient]=useState<Provider|null>(null),[create,setCreate]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const refresh=async()=>{const [d,s,m]=await Promise.all([listDrafts(),listTeachers(),listMeanings()]);setDrafts(d);setSessions(s);setMeanings(m);setLoaded(true);};
 useEffect(()=>{void openLibrary().then(refresh).catch(e=>setNotice(errorText(e)));const stop=observeLibrary(()=>void refresh().catch(e=>setNotice(errorText(e))));return ()=>{stop();controller.current?.abort();};},[]);
 useEffect(()=>{void selectedProvider('teacher').then(setRecipient).catch(()=>setRecipient(null));},[sessionId,current,busy]);
 const go=(screen:string,conversation?:string)=>{setCreate(false);setNotice('');void navigate({to:'/$',params:{_splat:screen==='s-home'?'':screen==='s-profile'?'profile':screen==='s-personal-meaning'?'personal-meaning':'content'},search:{library:'local',...(conversation?{conversation}:{})}});};
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();}catch(e){setNotice(errorText(e));throw e;}finally{setBusy(false);}};
 const openMeaning=(draftId:string)=>{void perform(async()=>{const draft=(await listDrafts()).find(d=>d.id===draftId);if(!draft)throw new Error('材料尚未读取，请重试。');const existing=(await listTeachers()).filter(s=>s.draftId===draftId&&s.draftRevision===draft.revision).at(-1);const next=existing??await createTeacher(crypto.randomUUID(),draft);go('s-personal-meaning',next.id);}).catch(()=>{});};
 const source:ContentScreenSource={items:projectLocalWorld(drafts,sessions,meanings),status:{ok:loaded,error:notice,errorKind:loaded?null:'unavailable'},inbox:[],projection:emptyProjection,reload:()=>void refresh().catch(e=>setNotice(errorText(e))),composer:{save:async input=>{const text=input.texts.join('\n\n')||input.familiarExpression;const d=await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text,familiarExpression:input.familiarExpression,startingPoint:input.startingPoint});await refresh();return d.id;}}};
 const session=sessions.find(s=>s.id===sessionId);
 const run=async()=>{if(!recipient||!session)throw new Error('请先到账号与设置中选择澄清模型服务。');const c=new AbortController();controller.current=c;try{await continueTeacher(session.id,recipient,c.signal,()=>void refresh());}finally{if(controller.current===c)controller.current=null;}};
 const conversation:MeaningConversationController|undefined=session?{material:session.input,messages:session.messages.flatMap<{role:'learner'|'assistant';body:string}>(m=>{
  if(m.role==='user')return [{role:'learner' as const,body:m.content??''}];
  if(m.role!=='assistant')return [];
  const bodies=m.content?[m.content]:[];
  for(const call of m.tool_calls??[]){
   const result=session.messages.find(r=>r.role==='tool'&&r.tool_call_id===call.id);
   if(!result)continue;
   const output=JSON.parse(result.content??'{}'),args=JSON.parse(call.function.arguments);
   if(call.function.name==='ask_learner'&&output.waitingForLearner)bodies.push(args.question);
   if(call.function.name==='propose_meaning'&&output.candidateStored)bodies.push(args.explanation);
  }
  return bodies.map(body=>({role:'assistant' as const,body}));
 }),candidate:session.candidate?{expression:session.candidate.expression.surface,meaning:session.candidate.semanticSpec.coreMeaningFocus,explanation:session.candidate.explanation}:null,accepted:session.status==='accepted',busy:busy||session.status==='inflight',notice,recipient:recipient?recipient.name+' · '+recipient.endpoint:'尚未选择，请先到设置配置模型服务。',canContinue:!['waiting','proposal','accepted'].includes(session.status),onSend:async text=>{await perform(async()=>{await sayToTeacher(crypto.randomUUID(),session.id,session.revision,text);await run();});},onContinue:async()=>{await perform(run).catch(()=>{});},onStop:()=>{controller.current?.abort();void perform(async()=>{const latest=(await listTeachers()).find(s=>s.id===session.id);if(latest)await stopTeacher(crypto.randomUUID(),latest.id,latest.revision);}).catch(()=>{});},onConfirm:async()=>{await perform(()=>acceptTeacher(crypto.randomUUID(),session.id,session.revision));}}:undefined;
 const status=<>{notice&&<p role="status" className="my-5 rounded-xl bg-[#edf0f7] p-4 leading-7">{notice}</p>}<p className="my-4 text-xs leading-6 text-[#68748d]">资料保存在此浏览器，未启用备份或同步。<a className="ml-3 underline" href="/">返回原账号入口</a></p></>;
 return <WebShell current={current} focused={false} onNavigate={go} availableSections={['s-home','s-content']}><IconSprite/>
  {current==='s-home'&&<HomeScreen active onStartMixed={()=>go("s-content")} onGo={go} mixedReadyN={0} newAvailable={0} reviewDueN={0} busy={busy} status={status} onRecordContext={()=>{go('s-content');setCreate(true);}}/>}
  {current==='s-content'&&<ContentScreen active source={source} notice={status} initialAction={create?'create':undefined} onBrowseExisting={()=>setNotice('本机学习资源接入仍在推进，已有账号内容可从原账号入口使用。')} onOpenPersonalMeaning={openMeaning} onOpenConfirmedSense={openMeaning} onOpenSense={()=>setNotice('本机学习详情尚未接入。')} onOpenSection={()=>setNotice('本机收藏和笔记尚未接入。')} toast={setNotice}/>}
  {current==='s-personal-meaning'&&conversation&&<PersonalMeaningDetailScreen active personalMeaningId={session!.draftId} onBack={()=>go('s-content')} onOpenConfirmedSense={openMeaning} toast={setNotice} conversation={conversation}/>}
  {current==='s-personal-meaning'&&!conversation&&<ContentScreen active source={source} notice={status} onBrowseExisting={()=>go('s-content')} onOpenPersonalMeaning={openMeaning} onOpenConfirmedSense={openMeaning} onOpenSense={()=>{}} onOpenSection={()=>{}} toast={setNotice}/>}
  {current==='s-profile'&&<ProfileScreen active localLibrary status={status} modelSettings={<ProviderPanel/>} onOpenPreferences={()=>setNotice('本机学习计划与偏好会随学习闭环接入。')} onGoStudyPlan={()=>setNotice('本机学习计划尚未接入，现有账号学习保持原样。')} defaultPolicy="lightweight" dailyNewCount={0} onPolicyChange={()=>{}} onDailyNewCountChange={()=>{}}/>}
 </WebShell>;
}
