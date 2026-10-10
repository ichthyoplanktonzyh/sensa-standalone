import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LearningRecordKind } from '../learningJourney/learningHistory';
import { localRecordDate, type StatisticsRange } from '../learningJourney/learningStatistics';
import {StatisticsCalendar} from './StatisticsCalendar';
import {StatisticsForecast} from './StatisticsForecast';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {useLearningHistory} from '../library/useLearningHistory';
import {localFlowText} from '../../i18n/localFlowText';
import { LearningSetupFrame, setupButton } from './learning/LearningSetupFrame';
import { useScreenState } from '../ui/ScreenHost';

interface StatsScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenTarget: (id: string) => void;
}
const kinds = ['initial_learning','retention_review','relearning'] as const;
export const StatsScreen = ({active,onBack,onOpenTarget}:StatsScreenProps) => {
  const {t,i18n}=useTranslation();
  const interfaceLocale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
  const [now,setNow]=useState(()=>new Date());
  const [range,setRange]=useScreenState<StatisticsRange>('stats:range','year');
  const [year,setYear]=useScreenState('stats:year',()=>new Date().getFullYear());
  const [start,setStart]=useScreenState('stats:start',()=>localRecordDate(new Date()));
  const [end,setEnd]=useScreenState('stats:end',()=>localRecordDate(new Date()));
  const [kind,setKind]=useScreenState<'all'|LearningRecordKind>('stats:kind','all');
  const [limit,setLimit]=useScreenState('stats:limit',20);
  const [languageChoice,setLanguageChoice]=useScreenState<string|null>('stats:language',null);
  const history=useLearningHistory({surface:'statistics',range,start,end,kind,languageChoice,year},active,limit,now.getTime());
  const projection=history.projection,languages=projection?.languages??[],languageScope=projection?.languageScope??'all',breakdown=projection?.breakdown??[];
  useEffect(()=>{
    if(!active)return;
    const refresh=()=>setNow(new Date());
    const timer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[active]);
  const reset=()=>{setRange('all');setKind('all');setLimit(20);};
  const dateFormat=new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium'});
  const formatDay=(key:string)=>{
    const [year,month,day]=key.split('-').map(Number);
    return dateFormat.format(new Date(year,month-1,day));
  };
  return <LearningSetupFrame id="s-stats" active={active} onBack={onBack} title={t('statistics.title')}>
    {history.availability==='unavailable'?<div role="alert"><p>{localFlowText('progressReadFailed')}</p><button className={setupButton} onClick={history.retry}>{t('reliability.retry')}</button></div>:history.availability==='loading'?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:null}
    <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{t('statistics.intro')}</h2>
    <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label={t('statistics.period')}>
      {(['today','week','month','year','all','custom'] as const).map(value=><button type="button" key={value} aria-pressed={range===value} onClick={()=>{setRange(value);setLimit(20);}} className={setupButton+(range===value?' bg-surface-selected text-action-primary':' text-fg-secondary hover:bg-surface-subtle')}>{t('statistics.'+value)}</button>)}
    </div>
    <label className="mt-4 flex items-center gap-3 text-sm text-fg-secondary">{t('statistics.year')}<input type="number" aria-label={t('statistics.calendarYear')} min={100} max={now.getFullYear()} value={year} onChange={event=>{const next=Number(event.target.value);if(Number.isInteger(next)&&next>=100&&next<=now.getFullYear()){setYear(next);setRange('year');setLimit(20);}}} className="min-h-11 w-24 rounded-control border border-border-subtle bg-surface-panel px-3"/></label>
    {languages.length>1&&<div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('statistics.languageScope')}>
      {languages.map(tag=><button type="button" key={tag} aria-pressed={languageScope===tag} onClick={()=>{setLanguageChoice(tag);setLimit(20);}} className={setupButton+(languageScope===tag?' bg-surface-selected text-action-primary':' text-fg-secondary hover:bg-surface-subtle')}>{interfaceLanguageDisplayName(tag,interfaceLocale)}</button>)}
      <button type="button" aria-pressed={languageChoice==='all'} onClick={()=>{setLanguageChoice('all');setLimit(20);}} className={setupButton+(languageChoice==='all'?' bg-surface-selected text-action-primary':' text-fg-secondary hover:bg-surface-subtle')}>{t('statistics.allLanguages')}</button>
    </div>}
    <div className="mt-4 flex flex-wrap items-end gap-4">
      {range==='custom'&&<>
        <label className="flex flex-col gap-2 text-xs text-fg-secondary">{t('statistics.start')}<input type="date" value={start} max={end||localRecordDate(now)} aria-invalid={projection?.invalidRange??false} aria-describedby={projection?.invalidRange?'stats-date-error':undefined} onChange={event=>{setStart(event.target.value);setLimit(20);}} className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus"/></label>
        <label className="flex flex-col gap-2 text-xs text-fg-secondary">{t('statistics.end')}<input type="date" value={end} min={start} max={localRecordDate(now)} aria-invalid={projection?.invalidRange??false} aria-describedby={projection?.invalidRange?'stats-date-error':undefined} onChange={event=>{setEnd(event.target.value);setLimit(20);}} className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus"/></label>
      </>}
      <label className="flex flex-col gap-2 text-xs text-fg-secondary">{t('statistics.kind')}<select value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setLimit(20);}} className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus">
        <option value="all">{t('study.all')}</option>{kinds.map(value=><option key={value} value={value}>{t('study.'+value)}</option>)}
      </select></label>
    </div>
    {projection&&<>{projection.invalidRange?<p id="stats-date-error" role="alert" className="mt-6 rounded-control bg-accent-soft p-4 text-sm text-feedback-danger">{t('statistics.invalid')}</p>:<>
      <p className="mt-5 text-xs text-fg-secondary">{t('statistics.timezone',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone})}</p>
      <StatisticsCalendar summary={projection} year={year} onDay={day=>{setStart(day);setEnd(day);setRange('custom');setLimit(20);}}/>
      {breakdown.length>0?<>
        <p className="mt-7 max-w-2xl text-xs leading-6 text-fg-tertiary">{t('statistics.languageNote')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('statistics.language')}</caption>
            <thead className="border-b border-border-subtle text-xs text-fg-tertiary"><tr><th scope="col" className="py-4 pr-4 font-medium">{t('statistics.language')}</th>{kinds.map(value=><th scope="col" key={value} className="px-3 py-4 text-right font-medium">{t('study.'+value)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border-subtle">{breakdown.map(row=><tr key={row.tag}><th scope="row" className="whitespace-nowrap py-4 pr-4 font-normal">{interfaceLanguageDisplayName(row.tag,interfaceLocale)}</th>{kinds.map(value=><td key={value} className="px-3 py-4 text-right tabular-nums">{row.counts[value].toLocaleString(i18n.language)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </>:<dl className="mt-7 grid gap-4 sm:grid-cols-3">
        {kinds.map(value=><div key={value} className="rounded-card border border-border-subtle bg-surface-panel p-6"><dt className="text-sm text-fg-secondary">{t('statistics.'+value)}</dt><dd className="mt-4 text-3xl font-medium tabular-nums text-action-primary">{projection.counts[value].toLocaleString(i18n.language)}</dd></div>)}
      </dl>}
      {projection.total===0?<section className="py-16 text-center" role="status">
        <h3 className="text-lg font-medium">{t(projection.hasRecords?'statistics.empty':'statistics.noRecords')}</h3>
        <p className="mt-3 text-sm text-fg-tertiary">{t(projection.hasRecords?'statistics.emptyHint':'statistics.noRecordsHint')}</p>
        {projection.hasRecords&&<button type="button" className={setupButton+' mt-5 bg-surface-selected text-action-primary'} onClick={reset}>{t('statistics.reset')}</button>}
      </section>:<>
        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('statistics.daily')}</h3><p className="text-xs text-fg-tertiary">{t('statistics.days',{count:new Set(projection.days.map(row=>row.day)).size})}</p></div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('statistics.daily')}</caption>
              <thead className="border-b border-border-subtle text-xs text-fg-tertiary"><tr><th scope="col" className="py-4 pr-4 font-medium">{t('statistics.date')}</th>{breakdown.length>0&&<th scope="col" className="px-3 py-4 font-medium">{t('statistics.language')}</th>}{kinds.map(value=><th scope="col" key={value} className="px-3 py-4 text-right font-medium">{t('study.'+value)}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-subtle">{projection.days.slice(0,limit).map(({day,languageTag,counts})=><tr key={`${day}:${languageTag}`}><th scope="row" className="whitespace-nowrap py-4 pr-4 font-normal">{formatDay(day)}</th>{breakdown.length>0&&<td className="whitespace-nowrap px-3 py-4">{interfaceLanguageDisplayName(languageTag,interfaceLocale)}</td>}{kinds.map(value=><td key={value} className="px-3 py-4 text-right tabular-nums">{counts[value]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-medium">{t('statistics.details')}</h3><span role="status" className="text-xs text-fg-tertiary">{t('statistics.count',{count:projection.total})}</span></div>
          <ol aria-label={t('statistics.details')} className="mt-4 divide-y divide-border-subtle">{projection.records.slice(0,limit).map(record=><li key={record.recordId}>
            <button type="button" onClick={()=>onOpenTarget(record.targetId)} className="flex w-full items-center gap-4 rounded-control px-1 py-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus">
              <span className="min-w-0 flex-1"><strong className="break-words text-lg font-medium">{record.expression}</strong><span className="mt-2 block text-xs text-fg-secondary">{t('study.'+record.kind)}</span></span>
              <time dateTime={record.occurredAt} className="text-right text-xs leading-6 tabular-nums text-fg-tertiary">{new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt))}</time>
              <ArrowRight size={16} className="shrink-0 text-fg-tertiary" aria-hidden="true"/>
            </button>
          </li>)}</ol>
          {(projection.total>limit||projection.days.length>limit)&&<button type="button" disabled={history.busy} className={setupButton+' mt-4 border border-border-subtle'} onClick={()=>setLimit(value=>value+20)}>{t('statistics.more')}</button>}
        </section>
    </>}
      <StatisticsForecast history={projection} kind={kind} onOpenTarget={onOpenTarget}/>
    </>}
    </>}
  </LearningSetupFrame>;
};
