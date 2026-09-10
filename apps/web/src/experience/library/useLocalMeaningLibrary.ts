/** Connects the existing product screens to the local library; owns no page layout. */
import {useEffect,useRef,useState} from 'react';
import {openLibrary,observeLibrary} from '../../data/library/store';
import {listDrafts,saveDraft,type LocalDraft} from '../../data/library/drafts';
import {acceptTeacher,continueTeacher,createTeacher,listMeanings,listTeachers,sayToTeacher,stopTeacher,type LocalMeaning,type TeacherSession} from '../../data/library/teacher';
import {selectedProvider,type Provider} from '../../data/library/providers';
import type {ContentScreenSource} from '../components/ContentScreen';
import type {MeaningConversationController} from '../components/PersonalMeaningDetailScreen';
import {projectLocalWorld} from './projection';
const errorText=(e:unknown)=>e instanceof Error&&/[\u4e00-\u9fff]/u.test(e.message)?e.message:'这次操作未完成，已保存的资料仍在，请检查服务或网络后重试。';
export function useLocalMeaningLibrary(draftId:string|null, active:boolean){
 const [drafts,setDrafts]=useState<LocalDraft[]>([]),[sessions,setSessions]=useState<TeacherSession[]>([]),[meanings,setMeanings]=useState<LocalMeaning[]>([]);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[recipient,setRecipient]=useState<Provider|null>(null);
 const controller=useRef<AbortController|null>(null);
 const refresh=async()=>{const [d,s,m]=await Promise.all([listDrafts(),listTeachers(),listMeanings()]);setDrafts(d);setSessions(s);setMeanings(m);setLoaded(true);};
 useEffect(()=>{void openLibrary().then(refresh).catch(e=>setNotice(errorText(e)));const stop=observeLibrary(()=>void refresh().catch(e=>setNotice(errorText(e))));return ()=>{stop();controller.current?.abort();};},[]);
 useEffect(()=>{void selectedProvider('teacher').then(setRecipient).catch(()=>setRecipient(null));},[draftId,active,busy]);
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();}catch(e){setNotice(errorText(e));throw e;}finally{setBusy(false);}};
 useEffect(()=>{
  if(!active||!loaded||!draftId)return;
  const draft=drafts.find(d=>d.id===draftId);
  if(!draft||sessions.some(s=>s.draftId===draftId&&s.draftRevision===draft.revision))return;
  void createTeacher(crypto.randomUUID(),draft).then(refresh).catch(e=>setNotice(errorText(e)));
 },[active,loaded,draftId,drafts,sessions]);
 const source:Pick<ContentScreenSource,'items'|'status'|'reload'|'composer'>={items:projectLocalWorld(drafts,sessions,meanings),status:{ok:loaded,error:notice,errorKind:loaded?null:'unavailable'},reload:()=>void refresh().catch(e=>setNotice(errorText(e))),composer:{save:async input=>{const text=input.texts.join('\n\n')||input.familiarExpression;const d=await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text,familiarExpression:input.familiarExpression,startingPoint:input.startingPoint});await refresh();return d.id;}}};
 const draft=drafts.find(d=>d.id===draftId);
 const session=sessions.filter(s=>s.draftId===draftId&&s.draftRevision===draft?.revision).at(-1);
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
 return {source,conversation,isLocal:!!draft,loaded,notice};
}
