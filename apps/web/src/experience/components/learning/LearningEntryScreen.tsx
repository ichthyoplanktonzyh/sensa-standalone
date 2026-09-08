import { useState, type ReactNode } from 'react';
import { ArrowRight, Search, BookOpen, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROTOTYPE_LEARNING_TARGETS } from '../../learningJourney/prototypeLearning';
import { LearningSetupFrame, setupButton } from './LearningSetupFrame';

interface LearningEntryScreenProps {
  active: boolean;
  screenId?: string;
  catalog?: readonly {targetId: string; expression: string; meaning: string; example: string; partOfSpeech: string; sourceKind: string; sourceLabel: string}[];
  status?: ReactNode;
  onSearch?: (query: string) => void;
  onMore?: () => void;
  busy?: boolean;
  onBack: () => void;
  onOpenTarget: (targetId: string) => void;
  onOpenPersonalSemanticWorld: () => void;
}
export const LearningEntryScreen = ({active,screenId,onBack,onOpenTarget,onOpenPersonalSemanticWorld,catalog: suppliedCatalog,status,onSearch,onMore,busy}:LearningEntryScreenProps) => {
  const {t}=useTranslation();
  const [query,setQuery]=useState('');
  const [source,setSource]=useState<'all'|'book'|'direct'>('all');
  const catalog=suppliedCatalog ?? Object.values(PROTOTYPE_LEARNING_TARGETS).filter(target=>target.sourceKind!=='personal_semantic_world');
  const normalized=query.trim().toLocaleLowerCase();
  const results=catalog.filter(target=>(source==='all'||target.sourceKind===source)&&
    [target.expression,target.meaning,target.example,target.sourceLabel].join(' ').toLocaleLowerCase().includes(normalized));
  return <LearningSetupFrame id={screenId??"s-learning-entry"} active={active} onBack={onBack} title={t('learningSetup.entry')}>
    <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{t('learningSetup.entryTitle')}</h2>
    <p className="mt-4 max-w-xl text-sm leading-7 text-[#68748d]">{t('learningSetup.entryHint')}</p>
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <section className="min-w-0">
        {status}
        <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#dfe4ed] bg-white px-4 focus-within:ring-2 focus-within:ring-[#5268a9]">
          <Search size={19} className="shrink-0 text-[#788398]" aria-hidden="true"/>
          <input type="search" aria-label={t('learningSetup.search')} placeholder={t('learningSetup.search')} value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"/>
          {onSearch&&<button type="button" disabled={busy} className={setupButton} onClick={()=>onSearch(query)}>搜索</button>}
          {query&&<button type="button" className={setupButton+' px-2 text-[#68748d]'} onClick={()=>setQuery('')}>{t('learningSetup.clear')}</button>}
        </div>
        <div role="group" aria-label={t('learningSetup.source')} className="mt-4 flex flex-wrap gap-2">
          {(['all','book','direct'] as const).map(value=><button type="button" key={value} aria-pressed={source===value} onClick={()=>setSource(value)} className={setupButton+(source===value?' bg-[#edf0f7] text-[#303f76]':' text-[#68748d] hover:bg-[#f0f1f3]')}>{t('learningSetup.'+value)}</button>)}
        </div>
        <div className="mb-2 mt-7 flex items-center justify-between gap-3 text-xs text-[#788398]">
          <span>{t('learningSetup.available')}</span><span role="status">{t('learningSetup.results',{count:results.length})}</span>
        </div>
        <ul className="divide-y divide-[#e0e5ee] border-y border-[#e0e5ee]">
          {results.map(target=><li key={target.targetId}>
            <button type="button" onClick={()=>onOpenTarget(target.targetId)} className="group flex w-full items-center gap-4 rounded-lg px-2 py-6 text-left hover:bg-[#edf0f7]/50 focus-visible:outline-2 focus-visible:outline-[#5268a9]">
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-3"><strong className="text-2xl font-medium">{target.expression}</strong><span className="text-xs text-[#788398]">{target.partOfSpeech}</span></span>
                <span className="mt-2 block text-sm leading-6 text-[#546078]">{target.meaning}</span>
                <span className="mt-3 flex items-center gap-2 text-xs text-[#788398]"><BookOpen size={13} aria-hidden="true"/>{target.sourceLabel}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-[#788398]" aria-hidden="true"/>
            </button>
          </li>)}
        </ul>
        {onMore&&<button className={setupButton} disabled={busy} onClick={onMore}>加载更多</button>}
        {results.length===0&&<div className="py-16 text-center" role="status"><h3 className="font-medium">{t('learningSetup.empty')}</h3><p className="mt-3 text-sm text-[#788398]">{t('learningSetup.emptyHint')}</p></div>}
      </section>
      <aside className="rounded-3xl bg-[#edf0f7] p-6">
        <Layers size={25} className="text-[#5268a9]" aria-hidden="true"/>
        <h3 className="mt-5 text-lg font-medium">{t('learningSetup.world')}</h3>
        <p className="mt-3 text-sm leading-6 text-[#68748d]">{t('learningSetup.worldHint')}</p>
        <button type="button" onClick={onOpenPersonalSemanticWorld} className={setupButton+' mt-5 bg-white text-[#303f76]'}>{t('learningSetup.explore')}<ArrowRight size={16}/></button>
      </aside>
    </div>
  </LearningSetupFrame>;
};
