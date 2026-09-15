import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ImagePlus,Send,X} from 'lucide-react';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {prepareConversationImage,type ConversationImage} from '../../data/library/conversationImages';

export function ExpressionChatInput({busy,onSend,initialText='',initialImages=[],submitLabel,inputLabel,inputHint}:{inputLabel?:string;inputHint?:string;initialText?:string;initialImages?:ConversationImage[];submitLabel?:string;busy:boolean;onSend:(text:string,images:ConversationImage[])=>Promise<void>}){
 useTranslation();
 const [text,setText]=useState(initialText),[images,setImages]=useState<ConversationImage[]>(initialImages),[notice,setNotice]=useState(''),[reading,setReading]=useState(false),[dragging,setDragging]=useState(false);
 const readingLock=useRef(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const add=async(files:File[])=>{
  if(readingLock.current||busy)return;
  setNotice('');if(images.length+files.length>4){setNotice('localFlow.imageLimit');return;}
  readingLock.current=true;setReading(true);try{const next=await Promise.all(files.map(prepareConversationImage));setImages(current=>[...current,...next]);}catch(e){setNotice(e instanceof Error?e.message:'localFlow.imageRead');}finally{readingLock.current=false;setReading(false);setDragging(false);}
 };
 const send=async()=>{if(busy||reading||(!text.trim()&&!images.length))return;setNotice('');try{await onSend(text.trim(),images);setText('');setImages([]);}catch{/* The conversation retains the source and displays the service error. */}};
 return <form onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDragging(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy&&!reading)void add(Array.from(e.dataTransfer.files));}} data-dragging={dragging} className="mx-4 mb-4 rounded-card border border-border-strong bg-surface-panel p-3 data-[dragging=true]:ring-2 data-[dragging=true]:ring-focus sm:mx-6" onSubmit={e=>{e.preventDefault();void send();}}>
  {dragging&&<p role="status">{localFlowText('dropImages')}</p>}
  {!!images.length&&<div className="mb-3 flex flex-wrap gap-3">{images.map(image=><div key={image.id} className="relative"><img src={image.dataUrl} alt={image.name} className="h-20 w-24 rounded-control object-cover"/><button type="button" disabled={busy} aria-label={localFlowText('removeImage')} className="absolute right-0 top-0 rounded-pill bg-surface-raised p-1 focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>setImages(current=>current.filter(v=>v.id!==image.id))}><X size={16}/></button></div>)}</div>}
  <textarea aria-label={inputLabel??localFlowText('expressionInput')} placeholder={inputHint??localFlowText('expressionInputHint')} value={text} onChange={e=>setText(e.target.value)} maxLength={submitLabel?16000:2000} rows={3} disabled={busy||reading} className="w-full resize-none bg-transparent p-2 text-sm leading-6 outline-none" onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length&&!busy&&!reading){e.preventDefault();void add(files);}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
  {notice&&<p role="status" className="mb-2 text-sm text-feedback-danger">{localFlowNotice(notice)}</p>}
  <div className="flex items-center justify-between gap-3">
   <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={localFlowText('attachImages')} className="sr-only" disabled={busy||reading} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void add(files);}}/>
   <button type="button" disabled={busy||reading} onClick={()=>fileInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-subtle px-3 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus"><ImagePlus size={18}/>{localFlowText(reading?'readingImages':'attachImages')}</button>
   <button type="submit" disabled={busy||reading||(!text.trim()&&!images.length)} className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action-primary px-4 text-sm text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"><Send size={16}/>{submitLabel??localFlowText('sendMessage')}</button>
  </div>
 </form>;
}
