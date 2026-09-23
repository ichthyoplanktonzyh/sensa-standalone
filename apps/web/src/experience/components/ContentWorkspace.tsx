import type {ReactNode} from 'react';
import {Inbox,Plus,X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {SensaOverlayLayout} from '../ui/SensaComponents';
export const contentButton='inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';
export function ContentHeader({inboxCount,onInbox,onAdd}:{inboxCount:number;onInbox:()=>void;onAdd:()=>void}){
 const {t}=useTranslation();
 return <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('content.title')}</h1><div className="flex gap-2"><button className={contentButton+' border border-border-subtle bg-surface-panel hover:bg-surface-selected'} onClick={onInbox}><Inbox size={17}/>{t('content.inbox')}{inboxCount>0&&<span className="rounded-control bg-accent-soft px-1.5 text-xs">{inboxCount}</span>}</button><button className={contentButton+' bg-action-primary text-action-on-primary hover:bg-action-primary-hover'} onClick={onAdd}><Plus size={17}/>{t('content.add')}</button></div></div>;
}
export function ContentDrawer({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const {t}=useTranslation();
 return <SensaOverlayLayout variant="sheet" measure="standard" className="z-[100]" label={title} onDismiss={onClose} dismissOnBackdrop onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}} regions={{header:<div className="flex items-center justify-between gap-3"><h2 className="text-xl font-medium">{title}</h2><button autoFocus className={contentButton} aria-label={t('content.close')} onClick={onClose}><X size={20}/></button></div>,primary:children}}/>;
}
