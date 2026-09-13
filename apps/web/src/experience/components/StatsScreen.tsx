import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LearningRecordKind, LearningRecordView } from '../learningJourney/learningHistory';
import { localRecordDate, projectLearningStatistics, type StatisticsRange } from '../learningJourney/learningStatistics';
import { sensaLanguageDisplayName } from '@sensa/contracts/sensa';
import i18n from '../../i18n';
import { useLanguageRoutes } from '../library/useLanguageRoutes';
import { inLanguageScope, languagesPresent, resolveLanguageScope } from '../library/languageScope';
import { LearningSetupFrame, setupButton } from './learning/LearningSetupFrame';

interface StatsScreenProps {
  active: boolean;
  records: readonly LearningRecordView[];
  onBack: () => void;
  onOpenTarget: (id: string) => void;
}
const kinds = ['initial_learning','retention_review','relearning'] as const;
export const StatsScreen = ({active,records,onBack,onOpenTarget}:StatsScreenProps) => {
  const {t,i18n}=useTranslation();
  const [now,setNow]=useState(()=>new Date());
  const [range,setRange]=useState<StatisticsRange>('week');
  const [start,setStart]=useState(()=>localRecordDate(new Date()));
  const [end,setEnd]=useState(()=>localRecordDate(new Date()));
  const [kind,setKind]=useState<'all'|LearningRecordKind>('all');
  const [limit,setLimit]=useState(20);
  const {activeRoute}=useLanguageRoutes();
  /** The exact languages the saved records are actually in. */
  const languages=useMemo(()=>languagesPresent(records.map(record=>record.languageTag)),[records]);
  const [languageChoice,setLanguageChoice]=useState<string|null>(null);
  const languageScope=resolveLanguageScope(languageChoice,languages,activeRoute.targetLanguageTag);
  /** Records in two languages are never added together: the sum describes the
   * learning of neither language. A scope of one language counts that language,
   * and the cross-language view breaks the counts down instead of merging. */
  const scopedRecords=useMemo(()=>languageScope==='all'?records:records.filter(record=>inLanguageScope(record.languageTag,languageScope)),[records,languageScope]);
  const breakdown=useMemo(()=>languageScope!=='all'?[]:languages.map(tag=>({tag,projection:projectLearningStatistics(records.filter(record=>record.languageTag===tag),{now,range,start,end,kind})})),[records,languages,languageScope,now,range,start,end,kind]);
  useEffect(()=>{
    if(!active)return;
    const refresh=()=>setNow(new Date());
    refresh();
    const timer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[active,records]);
  const projection=useMemo(()=>projectLearningStatistics(scopedRecords,{now,range,start,end,kind}),[scopedRecords,now,range,start,end,kind]);
  const reset=()=>{setRange('all');setKind('all');setLimit(20);};
  const dateFormat=new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium'});
  const formatDay=(key:string)=>{
    const [year,month,day]=key.split('-').map(Number);
    return dateFormat.format(new Date(year,month-1,day));
  };
  return <LearningSetupFrame id="s-stats" active={active} onBack={onBack} title={t('statistics.title')}>
    <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{t('statistics.intro')}</h2>
    <p className="mt-4 max-w-2xl text-sm leading-7 text-[#68748d]">{t('statistics.note')}</p>
    <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label={t('statistics.period')}>
      {(['today','week','month','all','custom'] as const).map(value=><button type="button" key={value} aria-pressed={range===value} onClick={()=>{setRange(value);setLimit(20);}} className={setupButton+(range===value?' bg-[#edf0f7] text-[#303f76]':' text-[#68748d] hover:bg-[#f0f2f5]')}>{t('statistics.'+value)}</button>)}
    </div>
    {languages.length>1&&<div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('statistics.languageScope')}>
      {languages.map(tag=><button type="button" key={tag} aria-pressed={languageScope===tag} onClick={()=>{setLanguageChoice(tag);setLimit(20);}} className={setupButton+(languageScope===tag?' bg-[#edf0f7] text-[#303f76]':' text-[#68748d] hover:bg-[#f0f2f5]')}>{sensaLanguageDisplayName(tag,i18n.language==='en'?'en':'zh-CN')}</button>)}
      <button type="button" aria-pressed={languageChoice==='all'} onClick={()=>{setLanguageChoice('all');setLimit(20);}} className={setupButton+(languageChoice==='all'?' bg-[#edf0f7] text-[#303f76]':' text-[#68748d] hover:bg-[#f0f2f5]')}>{t('statistics.allLanguages')}</button>
    </div>}
    <div className="mt-4 flex flex-wrap items-end gap-4">
      {range==='custom'&&<>
        <label className="flex flex-col gap-2 text-xs text-[#68748d]">{t('statistics.start')}<input type="date" value={start} max={end||localRecordDate(now)} aria-invalid={projection.invalidRange} aria-describedby={projection.invalidRange?'stats-date-error':undefined} onChange={event=>{setStart(event.target.value);setLimit(20);}} className="min-h-11 rounded-xl border border-[#dfe4ed] bg-white px-3 text-sm"/></label>
        <label className="flex flex-col gap-2 text-xs text-[#68748d]">{t('statistics.end')}<input type="date" value={end} min={start} max={localRecordDate(now)} aria-invalid={projection.invalidRange} aria-describedby={projection.invalidRange?'stats-date-error':undefined} onChange={event=>{setEnd(event.target.value);setLimit(20);}} className="min-h-11 rounded-xl border border-[#dfe4ed] bg-white px-3 text-sm"/></label>
      </>}
      <label className="flex flex-col gap-2 text-xs text-[#68748d]">{t('statistics.kind')}<select value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setLimit(20);}} className="min-h-11 rounded-xl border border-[#dfe4ed] bg-white px-3 text-sm">
        <option value="all">{t('study.all')}</option>{kinds.map(value=><option key={value} value={value}>{t('study.'+value)}</option>)}
      </select></label>
    </div>
    {projection.invalidRange?<p id="stats-date-error" role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{t('statistics.invalid')}</p>:<>
      {breakdown.length>0?<>
        <p className="mt-7 max-w-2xl text-xs leading-6 text-[#788398]">{t('statistics.languageNote')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('statistics.language')}</caption>
            <thead className="border-b border-[#dfe4ed] text-xs text-[#788398]"><tr><th scope="col" className="py-4 pr-4 font-medium">{t('statistics.language')}</th>{kinds.map(value=><th scope="col" key={value} className="px-3 py-4 text-right font-medium">{t('study.'+value)}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#e0e5ee]">{breakdown.map(row=><tr key={row.tag}><th scope="row" className="whitespace-nowrap py-4 pr-4 font-normal">{sensaLanguageDisplayName(row.tag,i18n.language==='en'?'en':'zh-CN')}</th>{kinds.map(value=><td key={value} className="px-3 py-4 text-right tabular-nums">{row.projection.counts[value].toLocaleString(i18n.language)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </>:<dl className="mt-7 grid gap-4 sm:grid-cols-3">
        {kinds.map(value=><div key={value} className="rounded-2xl border border-[#e0e5ee] bg-white p-6"><dt className="text-sm text-[#68748d]">{t('statistics.'+value)}</dt><dd className="mt-4 text-3xl font-medium tabular-nums text-[#303f76]">{projection.counts[value].toLocaleString(i18n.language)}</dd></div>)}
      </dl>}
      {projection.records.length===0?<section className="py-16 text-center" role="status">
        <h3 className="text-lg font-medium">{t(projection.hasRecords?'statistics.empty':'statistics.noRecords')}</h3>
        <p className="mt-3 text-sm text-[#788398]">{t(projection.hasRecords?'statistics.emptyHint':'statistics.noRecordsHint')}</p>
        {projection.hasRecords&&<button type="button" className={setupButton+' mt-5 bg-[#edf0f7] text-[#303f76]'} onClick={reset}>{t('statistics.reset')}</button>}
      </section>:<>
        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('statistics.daily')}</h3><p className="text-xs text-[#788398]">{t('statistics.days',{count:projection.days.length})}</p></div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('statistics.daily')}</caption>
              <thead className="border-b border-[#dfe4ed] text-xs text-[#788398]"><tr><th scope="col" className="py-4 pr-4 font-medium">{t('statistics.date')}</th>{kinds.map(value=><th scope="col" key={value} className="px-3 py-4 text-right font-medium">{t('study.'+value)}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#e0e5ee]">{projection.days.slice(0,limit).map(([day,counts])=><tr key={day}><th scope="row" className="whitespace-nowrap py-4 pr-4 font-normal">{formatDay(day)}</th>{kinds.map(value=><td key={value} className="px-3 py-4 text-right tabular-nums">{counts[value]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('statistics.details')}</h3><span role="status" className="text-xs text-[#788398]">{t('statistics.count',{count:projection.records.length})}</span></div>
          <ol className="mt-4 divide-y divide-[#e0e5ee]">{projection.records.slice(0,limit).map(record=><li key={record.recordId}>
            <button type="button" onClick={()=>onOpenTarget(record.targetId)} className="flex w-full items-center gap-4 rounded-lg px-1 py-5 text-left hover:bg-[#edf0f7] focus-visible:outline-2 focus-visible:outline-[#5268a9]">
              <span className="min-w-0 flex-1"><strong className="break-words text-lg font-medium">{record.expression}</strong><span className="mt-2 block text-xs text-[#68748d]">{t('study.'+record.kind)}</span></span>
              <time dateTime={record.occurredAt} className="text-right text-xs leading-6 tabular-nums text-[#788398]">{new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt))}</time>
              <ArrowRight size={16} className="shrink-0 text-[#788398]" aria-hidden="true"/>
            </button>
          </li>)}</ol>
          {projection.records.length>limit&&<button type="button" className={setupButton+' mt-4 border border-[#e0e5ee]'} onClick={()=>setLimit(value=>value+20)}>{t('statistics.more')}</button>}
        </section>
      </>}
    </>}
    <p className="mt-8 border-t border-[#e0e5ee] pt-5 pb-8 text-xs leading-6 text-[#788398]">{t('statistics.limits')}</p>
  </LearningSetupFrame>;
};
