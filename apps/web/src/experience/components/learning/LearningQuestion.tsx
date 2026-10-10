import {useEffect,useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {MessageCircle,X} from 'lucide-react';
import type {LearningLightweightRuntimeProjection} from '../../../learning/system';
import {learningQuestionService,learningQuestionScope,type LearningQuestionRecipient} from '../../../learning/system/learningQuestion';
import {localFlowErrorKey,localFlowNotice} from '../../../i18n/localFlowText';
import {SensaOverlayLayout} from '../../ui/SensaComponents';

/** Local conversation is scoped to one adopted Step. Closing cancels; no writes. */
export function LearningQuestion({runtime,personalScene}:{runtime:LearningLightweightRuntimeProjection;personalScene?:string}){
 const {t}=useTranslation();
 const titleId=useId();
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[useScene,setUseScene]=useState(false);
 const [history,setHistory]=useState<{role:'user'|'assistant';content:string}[]>([]);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[online,setOnline]=useState(navigator.onLine);
 const request=useRef<AbortController|null>(null),trigger=useRef<HTMLButtonElement>(null);
 const [recipient,setRecipient]=useState<LearningQuestionRecipient|null>(null);
 const recipientKey=useRef<string|null>(null);
 useEffect(()=>{
  if(!open)return;let current=true;
  void learningQuestionService.recipient().then(next=>{if(!current)return;
   if(recipientKey.current&&recipientKey.current!==next.key){setUseScene(false);setHistory([]);}
   recipientKey.current=next.key;setRecipient(next);
  }).catch(error=>{if(current)setNotice(localFlowNotice(localFlowErrorKey(error,'localFlow.modelUnavailable')));});
  return()=>{current=false;};
 },[open]);
 useEffect(()=>{
  const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);
  return()=>{request.current?.abort();window.removeEventListener('online',update);window.removeEventListener('offline',update);};
 },[]);
 const close=()=>{request.current?.abort();request.current=null;setBusy(false);setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
 useEffect(()=>{if(!open)return;const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};window.addEventListener('keydown',dismiss);return()=>window.removeEventListener('keydown',dismiss);},[open]);
 const ask=async()=>{
  if(busy||!question.trim()||!online||!recipient)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setNotice('');const submitted=question.trim();
  try{
   const answer=await learningQuestionService.ask({scope:learningQuestionScope(runtime),languageContext:runtime.target.languageContext,recipient:recipient.key,sharePersonalContext:useScene,question:submitted,history:history.slice(-8),...(useScene&&personalScene?{personalScene}:{}),signal:controller.signal});
   if(request.current!==controller||controller.signal.aborted)return;
   setHistory(previous=>[...previous,{role:'user',content:submitted},{role:'assistant',content:answer}]);setQuestion('');
  }catch(error){if(request.current===controller&&!controller.signal.aborted)setNotice(localFlowNotice(localFlowErrorKey(error,'localFlow.modelUnavailable')));}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 return <>
  <button ref={trigger} type="button" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-panel px-3 text-sm text-action-primary" onClick={()=>setOpen(true)}><MessageCircle size={17}/>{t('learningQuestion.title')}</button>
  {open&&<SensaOverlayLayout variant="dialog" measure="standard" labelledBy={titleId} onDismiss={close} dismissOnBackdrop className="z-[100]" regions={{
   header:<div className="flex items-center justify-between p-4"><h2 id={titleId} className="text-lg font-medium">{t('learningQuestion.title')}</h2><button type="button" className="min-h-11 min-w-11" aria-label={t('learningQuestion.close')} onClick={close}><X size={20}/></button></div>,
   primary:<div className="space-y-4 px-4 pb-4"><p className="font-medium">{runtime.target.presentation.expression}</p>
    <div role="log" aria-live="polite" className="max-h-[40vh] overflow-auto space-y-4">{history.map((item,index)=><div key={index} className="whitespace-pre-wrap break-words"><span className="text-xs text-fg-secondary">{item.role==='user'?t('learningQuestion.question'):t('learningQuestion.answer')}</span><p>{item.content}</p></div>)}</div>
    <form onSubmit={event=>{event.preventDefault();void ask();}} className="space-y-3"><label className="block text-sm">{t('learningQuestion.question')}<textarea value={question} maxLength={2000} disabled={busy} onChange={event=>setQuestion(event.target.value)} rows={3} className="mt-2 w-full rounded-control border border-border-strong bg-surface-panel p-3"/></label>
     {(runtime.questionUsesPersonalContext||personalScene)&&recipient&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useScene} disabled={busy} onChange={event=>{setUseScene(event.target.checked);setHistory([]);}}/>{t('learningQuestionConsent.sharePersonal',{recipient:recipient.label})}</label>}
     {!online&&<p role="status">{t('learningQuestion.offline')}</p>}{notice&&<p role="alert">{notice}</p>}
     <button type="submit" disabled={busy||!online||!question.trim()||!recipient} className="min-h-11 rounded-control bg-action-primary px-5 text-action-on-primary">{busy?t('learningQuestion.pending'):t('learningQuestion.send')}</button>
    </form></div>,
  }}/>}
 </>;
}
