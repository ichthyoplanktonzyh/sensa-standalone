import {ArrowRight,BookOpen,ChevronLeft,ChevronRight} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {localFlowText} from '../../i18n/localFlowText';
import {setupButton} from '../components/learning/LearningSetupFrame';
import {catalogPageNumbers} from './packageCatalogBrowsing';
import type {PackageCenterItem} from './packageCenterProjection';

export const packageItemState=(item:PackageCenterItem,installation?:{bookKey:string;phase:string}|null,progress?:number|null)=>installation?.bookKey===item.key
 ?installation.phase==='downloading'?`${localFlowText('downloading')}${progress??0}%`:localFlowText('processing')
 :localFlowText(
 item.updateDownloaded?'packageUpdateDownloaded':item.updateAvailable?'packageUpdateAvailable'
  :item.enrolled?'enrolled':item.installed.length?'downloaded':'packageNotDownloaded',
);

export function PackageRoute({target,support}:{target:string;support:string}){
 const {i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 return <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
  <div><dt className="inline">{localFlowText('catalogTargetLanguage')}: </dt><dd className="inline">{interfaceLanguageDisplayName(target,locale)}</dd></div>
  <div><dt className="inline">{localFlowText('catalogSupportLanguage')}: </dt><dd className="inline">{interfaceLanguageDisplayName(support,locale)}</dd></div>
 </dl>;
}

export function PackageStatus({children,error=false,onRetry}:{children:ReactNode;error?:boolean;onRetry?:()=>void}){
 const {t}=useTranslation();
 return <div role={error?'alert':'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm leading-6 ${error?'border-feedback-danger':'border-border-subtle'} bg-surface-subtle`}>
  <div className="min-w-0 break-words">{children}</div>
  {onRetry&&<button type="button" className={setupButton} onClick={onRetry}>{t('reliability.retry')}</button>}
 </div>;
}

export function PackageCards({items,onOpen,emptyKey,loaded,view='cards',installation,progress}:{
 items:readonly PackageCenterItem[];onOpen:(item:PackageCenterItem)=>void;
 emptyKey:'packageEmpty'|'packageNoResults';loaded:boolean;view?:'cards'|'list';
 installation?:{bookKey:string;phase:string}|null;progress?:number|null;
}){
 const {t}=useTranslation();
 return <>
  <ul aria-busy={!loaded} className={view==='list'?'space-y-2':'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'}>
   {items.map(item=><li key={item.listKey}>
    <button type="button" data-package-key={item.key} onClick={()=>onOpen(item)} className={`group flex h-full w-full flex-col gap-3 rounded-xl border border-border-strong bg-surface-panel text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus ${view==='list'?'p-4':'p-4 sm:p-5'}`}>
     <div className="flex w-full flex-wrap items-start gap-3">
      <BookOpen size={19} className="mt-1 shrink-0 text-action-primary" aria-hidden="true"/>
      <h2 className="min-w-0 flex-1 break-words text-lg font-medium">{item.title}</h2>
      {loaded?<span className="rounded-md bg-accent-soft px-2 py-1 text-xs text-action-primary">{packageItemState(item,installation,progress)}</span>:<span role="status" aria-label={t('reliability.loading')} className="h-6 w-20 animate-pulse rounded-lg bg-surface-subtle"/>}
     </div>
     {item.description&&<p className={`${view==='list'?'line-clamp-2':'line-clamp-3'} w-full break-words text-sm leading-6 text-fg-secondary`}>{item.description}</p>}
     <div className="mt-auto flex w-full flex-wrap items-end justify-between gap-2">
      <PackageRoute target={item.targetLanguage} support={item.supportLanguage}/>
      <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:item.count})}<ArrowRight size={16} aria-hidden="true"/></span>
     </div>
    </button>
   </li>)}
  </ul>
  {!items.length&&(loaded?<PackageStatus><BookOpen size={20} className="mb-2 text-fg-tertiary" aria-hidden="true"/>{localFlowText(emptyKey)}</PackageStatus>:<PackageStatus>{t('reliability.loading')}</PackageStatus>)}
 </>;
}

export function CatalogPagination({page,pages,onPage}:{page:number;pages:number;onPage:(page:number)=>void}){
 return <nav aria-label={localFlowText('catalogPagination')} className="mt-5 flex flex-wrap items-center justify-center gap-2">
  <button type="button" className={setupButton} aria-label={localFlowText('catalogPreviousPage')} disabled={page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={18}/></button>
  {catalogPageNumbers(page,pages).map((number,index)=>number==='gap'?<span key={`gap-${index}`} aria-hidden="true" className="px-1 text-fg-secondary">…</span>:<button type="button" key={number} aria-label={localFlowText('catalogPage',{page:number})} aria-current={page===number?'page':undefined} className={`${setupButton} min-w-11 px-3 ${page===number?'border-action-primary bg-accent-soft font-semibold text-action-primary underline underline-offset-4':''}`} onClick={()=>onPage(number)}>{number}</button>)}
  <button type="button" className={setupButton} aria-label={localFlowText('catalogNextPage')} disabled={page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={18}/></button>
 </nav>;
}
