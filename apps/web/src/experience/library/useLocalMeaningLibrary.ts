import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
/** Connects the existing product screens to the local library; owns no page layout. */
import {useEffect,useRef,useState} from 'react';
import {captureSourceLink} from '@sensa/contracts/sensa';
import {openLibrary,observeLibrary} from '../../data/library/store';
import {listDrafts,saveDraft,type LocalDraft} from '../../data/library/drafts';
import {acceptTeacher,continueTeacher,createTeacher,listMeanings,listTeachers,sayToTeacher,stopTeacher,type LocalMeaning,type TeacherSession} from '../../data/library/teacher';
import {selectedProvider,type Provider} from '../../data/library/providers';
import type {ContentScreenSource} from '../components/ContentScreen';
import type {MeaningConversationController} from '../components/PersonalMeaningDetailScreen';
import {projectLocalWorld} from './projection';
import type {ConversationImage} from '../../data/library/conversationImages';
const errorText=(e:unknown)=>e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('operationFailed');
export function useLocalMeaningLibrary(draftId:string|null, active:boolean,startRequest:{id:string;draftId:string}|null=null,onCreated?:(id:string)=>void){
 const {i18n}=useTranslation();
 const [drafts,setDrafts]=useState<LocalDraft[]>([]),[sessions,setSessions]=useState<TeacherSession[]>([]),[meanings,setMeanings]=useState<LocalMeaning[]>([]);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[recipient,setRecipient]=useState<Provider|null>(null);
 const controller=useRef<AbortController|null>(null);
 const consumedStart=useRef<string|null>(null);
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
 const source:Pick<ContentScreenSource,'items'|'status'|'reload'|'composer'>={items:projectLocalWorld(drafts,sessions,meanings),status:{ok:loaded,error:localFlowNotice(notice),errorKind:loaded?null:'unavailable'},reload:()=>void refresh().catch(e=>setNotice(errorText(e))),composer:{save:async input=>{const text=input.texts.join('\n\n')||input.familiarExpression;const d=await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text,familiarExpression:input.familiarExpression,startingPoint:input.startingPoint});await refresh();return d.id;}}};
 const draft=drafts.find(d=>d.id===draftId);
 const session=sessions.filter(s=>s.draftId===draftId&&s.draftRevision===draft?.revision).at(-1);
 const run=async(id=session?.id)=>{if(!id)throw new Error('localFlow.checkSensa');const provider=await selectedProvider('teacher');const c=new AbortController();controller.current=c;try{await continueTeacher(id,provider,c.signal,()=>void refresh(),i18n.resolvedLanguage??'en');}finally{if(controller.current===c)controller.current=null;}};
 // Only a user navigation requests the first turn. A reload has no request,
 // and reopening a conversation with prior attempts never resumes it silently.
 useEffect(()=>{
  if(!active||!session||!startRequest||startRequest.draftId!==draftId||consumedStart.current===startRequest.id)return;
  consumedStart.current=startRequest.id;
  if(session.status!=='idle'||session.requests!==0||session.messages.length)return;
  void perform(run).catch(()=>{});
 },[active,startRequest,session?.id]);
 const conversation:MeaningConversationController|undefined=session?{material:session.input,images:session.inputImages,source:draft?.intake?{url:captureSourceLink(draft.intake.snapshot.source),title:draft.intake.snapshot.source.title}:undefined,messages:session.messages.flatMap<{role:'learner'|'assistant';body:string;images?:ConversationImage[]}>(m=>{
  if(m.role==='user')return [{role:'learner' as const,body:m.content??'',images:m.images}];
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
 }),candidate:session.candidate?{context:session.contextSummary??session.input,expression:session.candidate.expression.surface,meaning:session.candidate.semanticSpec.coreMeaningFocus,explanation:session.candidate.explanation}:null,accepted:session.status==='accepted',busy:busy||session.status==='inflight',notice:localFlowNotice(notice),recipient:recipient?(recipient.kind==='sensa'?'Sensa':recipient.name+' · '+recipient.endpoint):localFlowText('sensaUnavailable'),canContinue:!['waiting','proposal','accepted'].includes(session.status),onSend:async(text,images)=>{await perform(async()=>{await sayToTeacher(crypto.randomUUID(),session.id,session.revision,text,images);await run();});},onContinue:async()=>{await perform(run).catch(()=>{});},onStop:()=>{controller.current?.abort();void perform(async()=>{const latest=(await listTeachers()).find(s=>s.id===session.id);if(latest)await stopTeacher(crypto.randomUUID(),latest.id,latest.revision);}).catch(()=>{});},onConfirm:async()=>{await perform(()=>acceptTeacher(crypto.randomUUID(),session.id,session.revision));}}:draftId==='new'?{
  material:'',messages:[],candidate:null,accepted:false,busy,notice:localFlowNotice(notice),recipient:recipient?.kind==='compatible'?recipient.name:'Sensa',canContinue:false,
  onSend:async(text,images)=>{await perform(async()=>{
   const d=await saveDraft(crypto.randomUUID(),{id:crypto.randomUUID(),expectedRevision:0,text,images});
   const created=await createTeacher(crypto.randomUUID(),d);await refresh();onCreated?.(d.id);await run(created.id);
  });},onContinue:async()=>{},onStop:()=>controller.current?.abort(),onConfirm:async()=>{}
 }:undefined;
 return {meanings,meaning:meanings.find(m=>m.draftId===draftId&&m.draftRevision===draft?.revision),source,conversation,isLocal:!!draft||draftId==='new',loaded,notice:localFlowNotice(notice)};
}
