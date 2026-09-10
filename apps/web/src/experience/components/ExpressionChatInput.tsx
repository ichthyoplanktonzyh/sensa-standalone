import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ImagePlus,Send,X} from 'lucide-react';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {prepareConversationImage,type ConversationImage} from '../../data/library/conversationImages';

export function ExpressionChatInput({busy,onSend,initialText='',initialImages=[],submitLabel,inputLabel,inputHint}:{inputLabel?:string;inputHint?:string;initialText?:string;initialImages?:ConversationImage[];submitLabel?:string;busy:boolean;onSend:(text:string,images:ConversationImage[])=>Promise<void>}){
 useTranslation();
 const [text,setText]=useState(initialText),[images,setImages]=useState<ConversationImage[]>(initialImages),[notice,setNotice]=useState(''),[reading,setReading]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const add=async(files:File[])=>{
  setNotice('');if(images.length+files.length>4){setNotice('localFlow.imageLimit');return;}
  setReading(true);try{const next=await Promise.all(files.map(prepareConversationImage));setImages(current=>[...current,...next]);}catch(e){setNotice(e instanceof Error?e.message:'localFlow.imageRead');}finally{setReading(false);}
 };
 const send=async()=>{if(busy||reading||(!text.trim()&&!images.length))return;setNotice('');try{await onSend(text.trim(),images);setText('');setImages([]);}catch{/* The conversation retains the source and displays the service error. */}};
 return <form className="mx-4 mb-4 rounded-2xl border border-[#ccd3e2] bg-white p-3 sm:mx-6" onSubmit={e=>{e.preventDefault();void send();}}>
  {!!images.length&&<div className="mb-3 flex flex-wrap gap-3">{images.map(image=><div key={image.id} className="relative"><img src={image.dataUrl} alt={image.name} className="h-20 w-24 rounded-lg object-cover"/><button type="button" disabled={busy} aria-label={localFlowText('removeImage')} className="absolute right-0 top-0 rounded-full bg-white p-1" onClick={()=>setImages(current=>current.filter(v=>v.id!==image.id))}><X size={16}/></button></div>)}</div>}
  <textarea aria-label={inputLabel??localFlowText('expressionInput')} placeholder={inputHint??localFlowText('expressionInputHint')} value={text} onChange={e=>setText(e.target.value)} maxLength={submitLabel?16000:2000} rows={3} disabled={busy||reading} className="w-full resize-none bg-transparent p-2 text-sm leading-6 outline-none" onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length&&!busy&&!reading){e.preventDefault();void add(files);}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
  {notice&&<p role="status" className="mb-2 text-sm text-red-700">{localFlowNotice(notice)}</p>}
  <div className="flex items-center justify-between gap-3">
   <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={localFlowText('attachImages')} className="sr-only" disabled={busy||reading} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void add(files);}}/>
   <button type="button" disabled={busy||reading} onClick={()=>fileInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-[#59678f]"><ImagePlus size={18}/>{localFlowText(reading?'readingImages':'attachImages')}</button>
   <button type="submit" disabled={busy||reading||(!text.trim()&&!images.length)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#3c5087] px-4 text-sm text-white disabled:opacity-40"><Send size={16}/>{submitLabel??localFlowText('sendMessage')}</button>
  </div>
 </form>;
}
