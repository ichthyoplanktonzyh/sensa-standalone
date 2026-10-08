import '../../i18n/profileResources';
import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {LoaderCircle,CheckCircle2,AlertCircle,Download,Upload} from 'lucide-react';
import {estimateLibraryBackupSize,exportLibraryBackup,inspectLibraryBackup,restoreLibraryBackup,type BackupSizeEstimate,type BackupSummary} from '../../data/library/backup';

export function LibraryBackupPanel({active=true,restoreOnly=false,onBusyChange}:{active?:boolean;restoreOnly?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const {t,i18n}=useTranslation();
 const [password,setPassword]=useState(''),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<BackupSummary|null>(null),[busy,setBusy]=useState<'export'|'check'|'restore'|null>(null),[notice,setNotice]=useState(''),[noticeTone,setNoticeTone]=useState<'success'|'warning'|'danger'>('success'),[restored,setRestored]=useState(false);
 const [size,setSize]=useState<BackupSizeEstimate|null>(null);
 const fileInput=useRef<HTMLInputElement>(null),passwordInput=useRef<HTMLInputElement>(null),locked=useRef(false);
 useEffect(()=>{if(!active||restoreOnly)return;let mounted=true;void estimateLibraryBackupSize().then(value=>{if(mounted)setSize(value);}).catch(()=>{});return()=>{mounted=false;};},[active,restoreOnly]);
 const run=async(action:NonNullable<typeof busy>,work:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(action);onBusyChange?.(true);setNotice('');setNoticeTone('success');try{await work();}catch(e){setNoticeTone('danger');setNotice(e instanceof Error&&e.message.startsWith('libraryBackup.')?e.message:'libraryBackup.failed');}finally{setBusy(null);locked.current=false;onBusyChange?.(false);}};
 const bytes=async()=>{if(!file)throw Error('libraryBackup.fileRequired');if(file.size>90*1024*1024)throw Error('libraryBackup.tooLarge');return new Uint8Array(await file.arrayBuffer());};
 const ready=()=>{if(password.length<12){setNoticeTone('danger');setNotice('libraryBackup.passwordHint');passwordInput.current?.focus();return false;}return true;};
 const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 text-sm font-medium transition-colors active:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60';
 const primary=button+' bg-action-primary text-action-on-primary hover:bg-action-primary-hover',secondary=button+' border border-border-strong bg-surface-panel hover:bg-surface-selected';
 const spinner=<LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>;
 return <section aria-labelledby="library-backup-title" aria-busy={busy!==null} className="mt-10 rounded-card border border-border-subtle bg-surface-panel p-6">
  <h2 id="library-backup-title" className="text-lg font-medium">{t('libraryBackup.title')}</h2>
  {!restoreOnly&&<p className="mt-3 text-sm leading-6 text-fg-secondary">{t('libraryBackup.intro')}</p>}
  {size&&<p className={'mt-3 text-sm '+(size.usedBytes/size.capacityBytes>=.8?'text-feedback-danger':'text-fg-secondary')}>{t(size.usedBytes/size.capacityBytes>=.8?'libraryBackup.sizeWarning':'libraryBackup.size',{used:(size.usedBytes/1024/1024).toFixed(1),capacity:(size.capacityBytes/1024/1024).toFixed(0)})}</p>}
  <fieldset disabled={!!busy||restored} className="mt-5 space-y-4">
   <label className="block text-sm">{t('libraryBackup.password')}<input ref={passwordInput} aria-label={t('libraryBackup.password')} aria-describedby="backup-password-hint" type="password" autoComplete="off" maxLength={1024} value={password} onChange={e=>{setPassword(e.target.value);setPreview(null);setNotice('');}} className="mt-2 block min-h-11 w-full max-w-lg rounded-control border border-border-strong bg-surface-panel px-3 focus-visible:outline-2 focus-visible:outline-focus"/></label>
   <p id="backup-password-hint" className="text-xs leading-6 text-fg-secondary">{t('libraryBackup.passwordHint')}{password.length>0&&password.length<12&&' '+t('libraryBackup.short',{count:12-password.length})}</p>
   {!restoreOnly&&<button className={primary} onClick={()=>{if(ready())void run('export',async()=>{const result=await exportLibraryBackup(password),url=URL.createObjectURL(new Blob([result.file as BlobPart],{type:'application/octet-stream'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`sensa-library-${result.summary.createdAt.slice(0,10)}.sensa-backup`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('libraryBackup.exported');});}}>{busy==='export'?spinner:<Download size={17} aria-hidden="true"/>}{t(busy==='export'?'libraryBackup.exporting':'libraryBackup.export')}</button>}
   <div className="space-y-3 border-t border-border-subtle pt-5">
    <p className="text-sm text-fg-secondary">{t('libraryBackup.restoreHint')}</p>
    <input ref={fileInput} aria-label={t('libraryBackup.file')} type="file" accept=".sensa-backup" className="sr-only" tabIndex={-1} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setNotice('');}}/>
    <div className="flex flex-wrap items-center gap-3"><button className={secondary} onClick={()=>fileInput.current?.click()}><Upload size={17} aria-hidden="true"/>{t('libraryBackup.file')}</button><span className="break-all text-sm text-fg-secondary">{file?.name??t('libraryBackup.noFile')}</span></div>
    {file&&<button className={primary} onClick={()=>{if(ready())void run('check',async()=>{setPreview(null);setPreview(await inspectLibraryBackup(await bytes(),password));});}}>{busy==='check'&&spinner}{t(busy==='check'?'libraryBackup.checking':'libraryBackup.check')}</button>}
   </div>
   {preview&&<div className="rounded-control bg-surface-subtle p-4 text-sm leading-7">{preview.account&&<p>{t('libraryBackup.account',{account:preview.account})}</p>}<p>{t('libraryBackup.date',{date:new Date(preview.createdAt).toLocaleString(i18n.language)})}</p><p>{t('libraryBackup.summary',preview)}</p>{preview.interrupted>0&&<p>{t('libraryBackup.interrupted',{count:preview.interrupted})}</p>}<button className={`${primary} mt-3`} onClick={()=>void run('restore',async()=>{const result=await restoreLibraryBackup(await bytes(),password);setPassword('');setRestored(true);setNoticeTone(result.resourceRefresh==='complete'?'success':'warning');setNotice(result.resourceRefresh==='complete'?'libraryBackup.restored':'libraryBackup.restoredResourcesDeferred');})}>{busy==='restore'&&spinner}{t(busy==='restore'?'libraryBackup.restoring':'libraryBackup.restore')}</button></div>}
  </fieldset>
  {notice&&<div role={noticeTone==='success'?'status':'alert'} className={`mt-4 flex items-start gap-2 rounded-control bg-accent-soft p-4 text-sm leading-6 ${noticeTone==='danger'?'text-feedback-danger':noticeTone==='warning'?'text-feedback-warning':'text-feedback-success'}`}>{noticeTone==='success'?<CheckCircle2 size={18} className="mt-1 shrink-0"/>:<AlertCircle size={18} className="mt-1 shrink-0"/>}<span>{t(notice)}</span></div>}
  {restored&&<button className={`${primary} mt-3`} onClick={()=>location.reload()}>{t('libraryBackup.reopen')}</button>}
  <details className="mt-5 text-xs leading-6 text-fg-secondary"><summary className="cursor-pointer">{t('libraryBackup.details')}</summary><p className="mt-2 max-w-2xl">{t('libraryBackup.detailText')}</p></details>
 </section>;
}
