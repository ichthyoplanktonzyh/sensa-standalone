import { StudyCalendar } from './StudyCalendar';
import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LearningRecordKind, LearningRecordView } from '../learningJourney/learningHistory';
import type { LearningPolicyId } from '../../learning/runtime/policyProfiles';
import { LearningPreferencesPanel } from './learning/LearningPreferencesPanel';

interface StudyScreenProps {
  policySummary?: string;
  fixedPolicy?: boolean;
  active: boolean;
  status?: ReactNode;
  calendar?: ReactNode;
  onOpenPreferences?: () => void;
  tab: 'a' | 'b';
  onTabChange: (tab: 'a' | 'b') => void;
  onAddLearning: () => void;
  onOpenTargetLibrary: () => void;
  onOpenStats: () => void;
  onOpenTarget: (id: string) => void;
  onPolicyChange: (policy: LearningPolicyId) => void;
  defaultPolicy: LearningPolicyId;
  learningTargetCount: number;
  /** The language the counts and the queue act on. The daily limit is the
   * account's, so it is named separately from the language counts. */
  languageLabel: string;
  readyInitialCount: number;
  reviewCount: number;
  dailyNewCount: number;
  learningRecords: readonly LearningRecordView[];
  onDailyNewCountChange: (count: number) => void;
}
export const studyButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5268a9]';
export const StudyScreen = (props: StudyScreenProps) => {
  const {t,i18n}=useTranslation();
  const [filter,setFilter]=useState<'all'|LearningRecordKind>('all');
  const [limit,setLimit]=useState(10);
  const records=props.learningRecords.filter(record=>filter==='all'||record.kind===filter);
  const closePreferences=()=>{
    props.onTabChange('a');
    requestAnimationFrame(()=>document.getElementById('study-preferences-button')?.focus());
  };
  return <section id="s-study" className={`screen absolute inset-0 z-10 overflow-y-auto bg-[#fbfbfa] text-[#222631] ${props.active?'active':'invisible pointer-events-none'}`}>
    <main className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('study.title')}</h1>
        <button id="study-preferences-button" className={`${studyButton} border border-[#e3e5ea] bg-white`} onClick={()=>props.onOpenPreferences ? props.onOpenPreferences() : props.onTabChange('b')}><SlidersHorizontal size={17}/>{t('study.preferences')}</button>
      </header>
      {props.status}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col rounded-3xl bg-[#edf0f7] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm text-[#68748d]"><BookOpen size={18}/>{t('study.scope')}</div>
          <h2 className="mt-5 text-3xl font-medium tracking-tight">{props.learningTargetCount?t('study.count',{count:props.learningTargetCount}):t('study.empty')}</h2>
          <p className="mt-2 text-xs text-[#788398]">{t('study.currentLanguage',{language:props.languageLabel})}</p>
          {!props.learningTargetCount&&<p className="mt-3 text-sm text-[#68748d]">{t('study.emptyHint')}</p>}
          <dl className="my-7 grid grid-cols-2 divide-x divide-[#d8dfea]">
            {([['ready',props.readyInitialCount],['review',props.reviewCount]] as const).map(([key,value])=><div key={key} className="last:pl-6"><dt className="text-sm text-[#68748d]">{t('study.'+key)}</dt><dd className="mt-2 text-2xl tabular-nums">{value.toLocaleString(i18n.language)}</dd></div>)}
          </dl>
          <div className="mt-auto flex flex-wrap gap-2">
            {props.learningTargetCount>0&&<button className={`${studyButton} bg-[#2f3b70] text-white hover:bg-[#25305c]`} onClick={props.onOpenTargetLibrary}>{t('study.browse')}<ArrowRight size={16}/></button>}
            <button className={`${studyButton} border border-[#cfd7e6] hover:bg-white`} onClick={props.onAddLearning}><Plus size={16}/>{t('study.add')}</button>
          </div>
        </section>
        <section className="rounded-3xl border border-[#e3e5ea] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-medium">{t('study.plan')}</h2>
          <button className="mt-7 block w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-[#5268a9]" onClick={()=>props.onOpenPreferences ? props.onOpenPreferences() : props.onTabChange('b')}>
            <span className="text-sm text-[#68748d]">{t('study.daily')}</span><span className="mt-2 flex items-center justify-between gap-3 text-2xl">{t('study.count',{count:props.dailyNewCount})}<ArrowRight size={18}/></span>
          </button>
          <p className="mt-3 text-xs leading-6 text-[#788398]">{t('study.dailyNote')}</p>
          <div className="mt-7 border-t border-[#e3e5ea] pt-6"><p className="text-sm text-[#68748d]">{t('study.method')}</p><p className="mt-2 font-medium">{props.policySummary??t('learningPreferences.policies.'+props.defaultPolicy)}</p></div>
        </section>
      </div>
      {props.calendar ?? <StudyCalendar/>}
      <section className="mt-12" aria-labelledby="study-history-title">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><h2 id="study-history-title" className="text-xl font-medium">{t('study.history')}</h2><button type="button" className={studyButton+' text-[#5268a9] hover:bg-[#edf0f7]'} onClick={props.onOpenStats}>{t('statistics.title')}<ArrowRight size={16}/></button></div>
          <div className="flex flex-wrap gap-1" aria-label={t('study.history')}>
            {(['all','initial_learning','retention_review','relearning'] as const).map(kind=><button key={kind} aria-pressed={filter===kind} className={`${studyButton} ${filter===kind?'bg-[#edf0f7] text-[#303f76]':'text-[#68748d] hover:bg-[#f0f2f5]'}`} onClick={()=>{setFilter(kind);setLimit(10);}}>{t('study.'+kind)}</button>)}
          </div>
        </div>
        <p className="mt-3 text-xs leading-6 text-[#788398]">{t('study.historyNote')}</p>
        {records.length===0?<div className="py-16 text-center"><p className="font-medium">{t(props.learningRecords.length?'study.noMatches':'study.noRecords')}</p>{!props.learningRecords.length&&<p className="mt-2 text-sm text-[#788398]">{t('study.noRecordsHint')}</p>}</div>:<ol className="mt-5 divide-y divide-[#e3e5ea]">
          {records.slice(0,limit).map(record=><li key={record.recordId}><button className="flex w-full flex-wrap items-center gap-4 rounded-lg py-5 text-left hover:bg-[#f2f4f8] focus-visible:outline-2 focus-visible:outline-[#5268a9] sm:flex-nowrap" onClick={()=>props.onOpenTarget(record.targetId)}>
            <span className="min-w-0 flex-1"><strong className="font-medium">{record.expression}</strong><span className="mt-1 block text-sm text-[#68748d]">{record.meaning ?? record.detail}</span></span>
            <span className="rounded-md bg-[#edf0f7] px-2 py-1 text-xs text-[#546582]">{t('study.'+record.kind)}</span>
            <time className="w-full text-xs tabular-nums text-[#788398] sm:w-auto" dateTime={record.occurredAt}>{new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt))}</time><ArrowRight className="hidden shrink-0 text-[#788398] sm:block" size={16}/>
          </button></li>)}
        </ol>}
        {records.length>limit&&<button className={`${studyButton} mt-4 border border-[#e3e5ea]`} onClick={()=>setLimit(value=>value+10)}>{t('study.more')}</button>}
      </section>
    </main>
    {props.active&&props.tab==='b'&&<LearningPreferencesPanel fixedPolicy={props.fixedPolicy} defaultPolicy={props.defaultPolicy} dailyNewCount={props.dailyNewCount} onPolicyChange={props.onPolicyChange} onDailyNewCountChange={props.onDailyNewCountChange} onClose={closePreferences} closeLabel={t('study.done')}/>}
  </section>;
};
