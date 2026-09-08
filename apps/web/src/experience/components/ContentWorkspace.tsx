import type {ReactNode} from 'react';
import {Inbox,Plus,X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
export const contentButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3c51ad] disabled:opacity-50';
export function ContentHeader({inboxCount,onInbox,onAdd}:{inboxCount:number;onInbox:()=>void;onAdd:()=>void}){
 const {t}=useTranslation();
 return <header className="mb-9 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('content.title')}</h1><div className="flex gap-2"><button className={contentButton+' border border-[#e1e4eb] bg-white'} onClick={onInbox}><Inbox size={17}/>{t('content.inbox')}{inboxCount>0&&<span className="rounded bg-[#edf0f7] px-1.5 text-xs">{inboxCount}</span>}</button><button className={contentButton+' bg-[#2f3b70] text-white hover:bg-[#25305c]'} onClick={onAdd}><Plus size={17}/>{t('content.add')}</button></div></header>;
}
export function ContentDrawer({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 return <div className="fixed inset-0 z-[100] flex justify-end bg-[#1f2937]/20" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}><section role="dialog" aria-modal="true" aria-label={title} className="h-full w-full overflow-y-auto bg-[#fbfbfa] p-6 shadow-xl sm:max-w-xl sm:p-9"><header className="mb-8 flex items-center justify-between gap-3"><h2 className="text-xl font-medium">{title}</h2><button autoFocus className={contentButton} aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}
