import {ArrowRight,BookOpen,ChevronLeft,ChevronRight} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {localFlowText} from '../../i18n/localFlowText';
import {setupButton} from '../components/learning/LearningSetupFrame';
import {catalogPageNumbers} from './packageCatalogBrowsing';
import type {PackageCenterItem} from './packageCenterProjection';
import {packagePresentation} from './packagePresentation';

export const packageItemState=(item:PackageCenterItem,installation?:{bookKey:string;phase:string}|null,progress?:number|null)=>installation?.bookKey===item.key
 ?installation.phase==='downloading'?`${localFlowText('downloading')}${progress??0}%`:localFlowText('processing')
 :localFlowText(
 item.updateDownloaded?'packageUpdateDownloaded':item.updateAvailable?'packageUpdateAvailable'
  :item.enrolled?'enrolled':item.installed.length?'downloaded':'packageNotDownloaded',
);

export function PackageRoute({target,support,compact=false}:{target:string;support:string;compact?:boolean}){
 const {i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 return <dl className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-secondary">
  <div><dt className={compact?'sr-only':'inline'}>{localFlowText('catalogTargetLanguage')}: </dt><dd className="inline"><bdi>{interfaceLanguageDisplayName(target,locale)}</bdi></dd></div>
  <div>{compact&&<span aria-hidden="true" className="me-2">/</span>}<dt className={compact?'sr-only':'inline'}>{localFlowText('catalogSupportLanguage')}: </dt><dd className="inline"><bdi>{interfaceLanguageDisplayName(support,locale)}</bdi></dd></div>
 </dl>;
}

export function PackageStatus({children,error=false,onRetry}:{children:ReactNode;error?:boolean;onRetry?:()=>void}){
 const {t}=useTranslation();
 return <div role={error?'alert':'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm leading-6 ${error?'border-feedback-danger':'border-border-subtle'} bg-surface-subtle`}>
  <div className="min-w-0 break-words">{children}</div>
  {onRetry&&<button type="button" className={setupButton} onClick={onRetry}>{t('reliability.retry')}</button>}
 </div>;
}

export function PackageCards({items,onOpen,emptyKey,loaded,learningStatus=loaded?'ready':'loading',view='cards',installation,progress}:{
 items:readonly PackageCenterItem[];onOpen:(item:PackageCenterItem)=>void;
 emptyKey:'packageEmpty'|'packageNoResults';loaded:boolean;view?:'cards'|'list';
 learningStatus?:'loading'|'ready'|'unavailable';
 installation?:{bookKey:string;phase:string}|null;progress?:number|null;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 return <>
  <ul aria-busy={!loaded} className={view==='list'?'sensa-package-list':'sensa-package-grid'}>
   {items.map(item=>{
    const presentation=packagePresentation(item);
    return <li key={item.listKey}>
     <button type="button" data-package-key={item.key} onClick={()=>onOpen(item)} className="sensa-package-entry group">
      <div className="sensa-package-entry-heading">
       <BookOpen size={20} className="shrink-0 text-action-primary" aria-hidden="true"/>
       <h2 className="min-w-0 break-words text-section-title font-medium"><bdi>{presentation.title}</bdi></h2>
       <ArrowRight size={17} className="sensa-package-entry-arrow text-fg-tertiary" aria-hidden="true"/>
      </div>
      {presentation.description&&<p className="line-clamp-2 break-words text-body-support text-fg-secondary"><bdi>{presentation.description}</bdi></p>}
      <div className="sensa-package-entry-footer">
       <PackageRoute target={item.targetLanguage} support={item.supportLanguage} compact/>
       <span className="text-sm text-fg-secondary">{localFlowText('packageExpressionCount',{count:item.count,formattedCount:new Intl.NumberFormat(locale).format(item.count)})}</span>
      </div>
      {learningStatus==='ready'?<span className={`sensa-package-state ${item.installed.length||item.updateAvailable?'text-action-primary':'text-fg-tertiary'}`}>{packageItemState(item,installation,progress)}</span>:learningStatus==='unavailable'?<span className="sensa-package-state text-fg-secondary">{localFlowText('learningReadFailed')}</span>:<span role="status" aria-label={t('reliability.loading')} className="h-4 w-20 animate-pulse rounded-control bg-surface-subtle"/>}
     </button>
    </li>;
   })}
  </ul>
  {!items.length&&(loaded?<PackageStatus><BookOpen size={20} className="mb-2 text-fg-tertiary" aria-hidden="true"/>{localFlowText(emptyKey)}</PackageStatus>:<PackageStatus>{t('reliability.loading')}</PackageStatus>)}
 </>;
}

export function CatalogPagination({page,pages,onPage,label}:{page:number;pages:number;onPage:(page:number)=>void;label?:string}){
 const {i18n}=useTranslation();
 const numberFormat=new Intl.NumberFormat(resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language));
 return <nav aria-label={label??localFlowText('catalogPagination')} className="sensa-package-pagination mt-5">
  <button type="button" className={setupButton+' sensa-package-page-previous'} aria-label={localFlowText('catalogPreviousPage')} disabled={page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={18}/></button>
  <div className="sensa-package-page-numbers">
  {catalogPageNumbers(page,pages).map((number,index)=>number==='gap'?<span key={`gap-${index}`} aria-hidden="true" className="px-1 text-fg-secondary">…</span>:<button type="button" key={number} aria-label={localFlowText('catalogPage',{page:numberFormat.format(number)})} aria-current={page===number?'page':undefined} className={`${setupButton} min-w-11 px-3 ${page===number?'border-action-primary bg-accent-soft font-semibold text-action-primary underline underline-offset-4':''}`} onClick={()=>onPage(number)}>{numberFormat.format(number)}</button>)}
  </div>
  <button type="button" className={setupButton+' sensa-package-page-next'} aria-label={localFlowText('catalogNextPage')} disabled={page>=pages} onClick={()=>onPage(page+1)}><ChevronRight size={18}/></button>
 </nav>;
}
