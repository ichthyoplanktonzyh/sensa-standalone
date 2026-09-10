import {useState} from 'react';
import {exportLibraryBackup,inspectLibraryBackup,restoreLibraryBackup,type BackupSummary} from '../../data/library/backup';

export function LibraryBackupPanel(){
 const [password,setPassword]=useState(''),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<BackupSummary|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[restored,setRestored]=useState(false);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await work();}catch(error){setNotice(error instanceof Error?error.message:'备份操作失败，原资料没有改变。');}finally{setBusy(false);}};
 const bytes=async()=>{if(!file)throw Error('请先选择备份文件。');if(file.size>90*1024*1024)throw Error('备份文件超过 90 MiB 限制。');return new Uint8Array(await file.arrayBuffer());};
 const button='min-h-11 rounded-xl border border-[#cfd7e6] px-5 text-sm disabled:opacity-50';
 return <section aria-labelledby="library-backup-title" className="mt-10 rounded-2xl border border-[#e3e5ea] bg-white p-6">
  <h2 id="library-backup-title" className="text-lg font-medium">本机库备份与恢复</h2>
  <p className="mt-3 text-sm leading-6 text-[#68748d]">导出当前浏览器的材料、对话、已确认的意思、学习资源和学习进度。文件使用独立密码加密；请妥善保存密码，丢失后无法找回。登录凭据与 API Key 不包含在备份中。</p>
  <p className="mt-2 text-sm leading-6 text-[#68748d]">恢复需要在空的浏览器本机库中登录原账号，不会合并或覆盖已有资料。恢复后，自定义模型服务需要重新填写 Key。本机备份不包含云端其他资料，也不替代同步。</p>
  <fieldset disabled={busy||restored} className="mt-5 space-y-4">
   <label className="block text-sm">备份密码（至少 12 个字符）<input aria-label="备份密码" type="password" autoComplete="off" minLength={12} maxLength={1024} value={password} onChange={e=>{setPassword(e.target.value);setPreview(null);}} className="mt-2 block min-h-11 w-full max-w-lg rounded-xl border px-3"/></label>
   <button className={button} disabled={password.length<12} onClick={()=>void run(async()=>{const result=await exportLibraryBackup(password),url=URL.createObjectURL(new Blob([result.file as BlobPart],{type:'application/octet-stream'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`sensa-library-${result.summary.createdAt.slice(0,10)}.sensa-backup`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice(`备份已生成并交给浏览器下载，含 ${result.summary.meanings} 个意思、${result.summary.targets} 项学习内容。请确认文件已保存。`);})}>导出加密备份</button>
   <label className="block text-sm">选择备份文件<input aria-label="选择备份文件" type="file" accept=".sensa-backup" className="mt-2 block max-w-full" onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setNotice('');}}/></label>
   <button className={button} disabled={!file||password.length<12} onClick={()=>void run(async()=>{setPreview(null);setPreview(await inspectLibraryBackup(await bytes(),password));})}>检查备份</button>
   {preview&&<div className="rounded-xl bg-[#edf0f7] p-4 text-sm leading-7"><p>备份账号：{preview.account}</p><p>备份时间：{new Date(preview.createdAt).toLocaleString()}</p><p>{preview.drafts} 份材料 · {preview.meanings} 个意思 · {preview.packages} 个学习包 · {preview.targets} 项学习内容 · {preview.runs} 次运行 · {preview.events} 条学习记录</p>{preview.interrupted>0&&<p>{preview.interrupted} 个未完成的模型请求将停止，可在恢复后手动重试。</p>}<button className={`${button} mt-3 bg-white`} onClick={()=>void run(async()=>{await restoreLibraryBackup(await bytes(),password);setPassword('');setRestored(true);setNotice('本机库已完整恢复。重新打开应用后可继续学习。');})}>确认恢复到当前空本机库</button></div>}
  </fieldset>
  <p role="status" className="mt-3 text-sm leading-6">{busy?'正在处理备份，请稍候…':notice}</p>
  {restored&&<button className={`${button} mt-3`} onClick={()=>location.reload()}>重新打开应用</button>}
 </section>;
}
