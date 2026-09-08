import {useState} from 'react';
import {captureSnapshotSchema} from '@sensa/contracts/sensa';
import type {CaptureSnapshot} from '@sensa/contracts/sensa';
import type {AccountReplica} from '../data/replica/accountStore';
import {setupButton,setupPrimary} from '../experience/components/learning/LearningSetupFrame';
export function IntakeInbox({replica,onSave}:{replica:AccountReplica;onSave:(snapshot:CaptureSnapshot)=>Promise<void>}){
 const [adding,setAdding]=useState(false),[sentence,setSentence]=useState(''),[expression,setExpression]=useState<CaptureSnapshot['expression']>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const requested=new URLSearchParams(location.search).get('intake');
 const items=Object.values(replica.intakes).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
 const pending=replica.outbox.filter(x=>x.operation.kind==='intake.save');
 return <section className="space-y-4" aria-label="收件箱"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">收件箱</h2><button className={setupButton} onClick={()=>setAdding(!adding)}>保存文字材料</button></div>
 <p className="text-sm text-[#68748d]">这里保留尚未确认意思的材料，保存不会自动加入学习。</p>
 {requested&&!replica.intakes[requested]&&<p role="status">这条材料不可用。请确认当前账号，或检查原设备的同步结果。</p>}
 {adding&&<form className="space-y-3 rounded-2xl border p-5" onSubmit={async e=>{e.preventDefault();setBusy(true);setNotice('');try{const snapshot=captureSnapshotSchema.parse({sentence,expression,language:'en',source:{url:null,title:'手动保存',capturedAt:new Date().toISOString()}});await onSave(snapshot);setSentence('');setExpression(null);setAdding(false);}catch{setNotice('尚未完成保存，请检查原文或重试。已经保存在本机的请求仍会保留。');}finally{setBusy(false);}}}>
 <label className="block">原文<textarea maxLength={12000} required rows={4} className="mt-2 w-full rounded-xl border p-3" value={sentence} onChange={e=>{setSentence(e.target.value);setExpression(null);}} onSelect={e=>{const el=e.currentTarget;if(el.selectionEnd>el.selectionStart)setExpression({text:el.value.slice(el.selectionStart,el.selectionEnd),start:Array.from(el.value.slice(0,el.selectionStart)).length,end:Array.from(el.value.slice(0,el.selectionEnd)).length});}} /></label>
 <p className="text-sm">{expression?`已定位表达：${expression.text}`:'可在原文中选中想了解的表达，也可以先只保存原文。'}</p>
 <button className={setupPrimary} disabled={busy}>{busy?'正在保存…':'保存待处理'}</button></form>}
 {notice&&<p role="status">{notice}</p>}
 {pending.map(x=><article className="rounded-xl border p-4" key={x.operation.operationId}><p className="whitespace-pre-wrap">{x.operation.kind==='intake.save'&&x.operation.payload.snapshot.sentence}</p><p role="status" className="mt-2 text-sm">{x.state==='pending'?'已保存在本机，等待同步':'尚未接纳，原材料已保留。请检查同步结果。'}</p></article>)}
 {!items.length&&!pending.length&&<p className="py-5 text-[#68748d]">还没有待处理材料。</p>}
 {items.map(item=>{const {sentence,expression,source}=item.snapshot,chars=Array.from(sentence);return <article id={'intake-'+item.id} key={item.id} className={'space-y-3 rounded-2xl border bg-white p-5 '+(requested===item.id?'border-[#303f76]':'')}><p className="whitespace-pre-wrap leading-7">{expression?<>{chars.slice(0,expression.start).join('')}<mark>{expression.text}</mark>{chars.slice(expression.end).join('')}</>:sentence}</p><p className="text-sm text-[#68748d]">待处理 · {new Date(item.savedAt).toLocaleString()}</p>{source.url?<a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title||'查看来源'}</a>:<p className="text-sm">{source.title}</p>}</article>;})}
 </section>;
}
