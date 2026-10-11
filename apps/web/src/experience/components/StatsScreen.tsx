import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {LearningRecordKind} from '../learningJourney/learningHistory';
import {localRecordDate,type StatisticsRange} from '../learningJourney/learningStatistics';
import {StatisticsCalendar} from './StatisticsCalendar';
import {StatisticsForecast} from './StatisticsForecast';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {useLearningHistory} from '../library/useLearningHistory';
import {localFlowText} from '../../i18n/localFlowText';
import {LearningSetupFrame} from './learning/LearningSetupFrame';
import {studyButton} from './StudyScreen';
import {useScreenState} from '../ui/ScreenHost';
import type {LearningHistoryProjection} from '../../learning/system';

const kinds=['initial_learning','retention_review','relearning'] as const;
function RecordList({projection,limit,onOpenTarget}:{projection:LearningHistoryProjection;limit:number;onOpenTarget:(id:string)=>void}){
 const {t,i18n}=useTranslation();
 return <ol aria-label={t('statistics.details')} className="divide-y divide-border-subtle">{projection.records.slice(0,limit).map(record=><li key={record.recordId}><button type="button" onClick={()=>onOpenTarget(record.targetId)} className="sensa-stat-record flex w-full flex-wrap items-center gap-3 rounded-control py-4 text-start hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus">
  <span className="min-w-0 flex-1"><strong className="break-words font-language text-lg font-medium"><bdi dir="auto">{record.expression}</bdi></strong><span className="mt-1 block text-sm text-fg-secondary"><bdi>{record.meaning??record.detail}</bdi></span><span className="mt-1 block text-xs text-fg-tertiary">{t('study.'+record.kind)}</span></span><time dateTime={record.occurredAt} className="text-xs tabular-nums text-fg-secondary">{new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt))}</time><ArrowRight size={16} className="shrink-0 text-fg-tertiary" aria-hidden="true"/>
 </button></li>)}</ol>;
}
export function StatsScreen({active,onBack,onOpenTarget}:{active:boolean;onBack:()=>void;onOpenTarget:(id:string)=>void}){
 const {t,i18n}=useTranslation(),locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const [now,setNow]=useState(()=>new Date()),[range,setRange]=useScreenState<StatisticsRange>('stats:range','year'),[year,setYear]=useScreenState('stats:year',()=>new Date().getFullYear());
 const [start,setStart]=useScreenState('stats:start',()=>localRecordDate(new Date())),[end,setEnd]=useScreenState('stats:end',()=>localRecordDate(new Date()));
 const [kind,setKind]=useScreenState<'all'|LearningRecordKind>('stats:kind','all'),[limit,setLimit]=useScreenState('stats:limit',20),[languageChoice,setLanguageChoice]=useScreenState<string|null>('stats:language',null);
 const [selectedDay,setSelectedDay]=useScreenState<string|null>('stats:selected-day',null),[dayLimit,setDayLimit]=useScreenState('stats:day-limit',20);
 const [optionsOpen,setOptionsOpen]=useScreenState('stats:options-open',false);
 const history=useLearningHistory({surface:'statistics',range,start,end,kind,languageChoice,year},active,limit,now.getTime());
 const selected=useLearningHistory({surface:'statistics',range:'custom',start:selectedDay??'',end:selectedDay??'',kind,languageChoice,year},active&&selectedDay!==null,dayLimit,now.getTime());
 const projection=history.projection,languages=projection?.languages??[],languageScope=projection?.languageScope??'all';
 const number=(value:number)=>new Intl.NumberFormat(locale).format(value),quantity=(key:string,count:number)=>t(key,{count,formattedCount:number(count)});
 const formatDay=(key:string)=>new Intl.DateTimeFormat(locale,{dateStyle:'full'}).format(new Date(key+'T12:00:00'));
 const input='min-h-11 min-w-0 max-w-full rounded-control border border-border-subtle bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-focus';
 useEffect(()=>{if(!active)return;const refresh=()=>setNow(new Date()),timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};},[active]);
 const closeDay=()=>{const day=selectedDay;setSelectedDay(null);requestAnimationFrame(()=>[...document.querySelectorAll<HTMLElement>(`.sensa-stat-calendar [data-date="${day}"],.sensa-stat-calendar button[data-day="${day}"]`)].find(element=>element.getClientRects().length>0)?.focus());};
 const reset=()=>{setRange('year');setKind('all');setLimit(20);setSelectedDay(null);};
 return <LearningSetupFrame id="s-stats" className="sensa-statistics" active={active} onBack={onBack} header={<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><button type="button" onClick={onBack} aria-label={t('learningSetup.back')} className={studyButton+' min-w-11 px-0 text-fg-secondary'}><ArrowLeft size={20}/></button><h1 className="text-2xl font-medium sm:text-3xl">{t('statistics.title')}</h1></div><label className="flex items-center gap-2 text-sm text-fg-secondary">{t('statistics.year')}<input className={input+' w-24'} type="number" aria-label={t('statistics.calendarYear')} min={100} max={now.getFullYear()} value={year} onChange={event=>{const next=Number(event.target.value);if(Number.isInteger(next)&&next>=100&&next<=now.getFullYear()){setYear(next);setRange('year');setSelectedDay(null);setLimit(20);}}}/></label></div>}>
  {history.availability==='unavailable'?<div role="alert"><p>{localFlowText('progressReadFailed')}</p><button className={studyButton} onClick={history.retry}>{t('reliability.retry')}</button></div>:history.availability==='loading'?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:null}
  {projection&&!projection.invalidRange&&<><StatisticsCalendar summary={projection} year={year} selectedDay={selectedDay} onDay={day=>{setSelectedDay(day);setDayLimit(20);}}/>
   {selectedDay&&<section aria-label={t('statistics.dailyDetails')} className="sensa-stat-day-details border-t border-border-subtle py-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{formatDay(selectedDay)}</h2><button className={studyButton+' text-fg-secondary'} aria-label={t('statistics.closeDay')} onClick={closeDay}><X size={16}/>{t('statistics.closeDay')}</button></div>
    {selected.availability==='unavailable'?<div role="alert"><p>{localFlowText('progressReadFailed')}</p><button className={studyButton} onClick={selected.retry}>{t('reliability.retry')}</button></div>:!selected.projection?<p role="status" aria-busy="true">{localFlowText('loadingSensa')}</p>:<><p role="status" className="mt-2 text-xs text-fg-secondary">{quantity('statistics.count',selected.projection.total)}</p>{selected.projection.total===0?<p className="py-6 text-sm text-fg-secondary">{t('statistics.empty')}</p>:<RecordList projection={selected.projection} limit={dayLimit} onOpenTarget={onOpenTarget}/>} {selected.projection.total>dayLimit&&<button className={studyButton} disabled={selected.busy} onClick={()=>setDayLimit(value=>value+20)}>{t('statistics.more')}</button>}</>}
   </section>}
   <StatisticsForecast history={projection} kind={kind} onOpenTarget={onOpenTarget}/>
  </>}
  <details open={optionsOpen} onToggle={event=>setOptionsOpen(event.currentTarget.open)} className="sensa-study-disclosure mt-7"><summary className="text-sm text-fg-secondary">{t('statistics.options')}</summary><div className="pb-5">
   <div className="flex flex-wrap gap-1" role="group" aria-label={t('statistics.period')}>{(['today','week','month','year','all','custom'] as const).map(value=><button key={value} aria-pressed={range===value} className={studyButton+(range===value?' bg-surface-selected text-action-primary':' text-fg-secondary')} onClick={()=>{setRange(value);setSelectedDay(null);setLimit(20);}}>{t('statistics.'+value)}</button>)}</div>
   <div className="mt-3 flex flex-wrap items-end gap-3">
    {range==='custom'&&<><label className="flex min-w-0 flex-col gap-2 text-xs text-fg-secondary">{t('statistics.start')}<input className={input} type="date" value={start} max={end||localRecordDate(now)} aria-invalid={projection?.invalidRange??false} aria-describedby={projection?.invalidRange?'stats-date-error':undefined} onChange={event=>{setStart(event.target.value);setLimit(20);setSelectedDay(null);}}/></label><label className="flex min-w-0 flex-col gap-2 text-xs text-fg-secondary">{t('statistics.end')}<input className={input} type="date" value={end} min={start} max={localRecordDate(now)} aria-invalid={projection?.invalidRange??false} aria-describedby={projection?.invalidRange?'stats-date-error':undefined} onChange={event=>{setEnd(event.target.value);setLimit(20);setSelectedDay(null);}}/></label></>}
    <label className="flex min-w-0 flex-col gap-2 text-xs text-fg-secondary">{t('statistics.kind')}<select className={input} value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setSelectedDay(null);setLimit(20);}}><option value="all">{t('study.all')}</option>{kinds.map(value=><option key={value} value={value}>{t('study.'+value)}</option>)}</select></label>
    {languages.length>1&&<label className="flex min-w-0 flex-col gap-2 text-xs text-fg-secondary">{t('statistics.languageScope')}<select className={input} value={languageScope} onChange={event=>{setLanguageChoice(event.target.value);setSelectedDay(null);setLimit(20);}}><option value="all">{t('statistics.allLanguages')}</option>{languages.map(tag=><option key={tag} value={tag}>{interfaceLanguageDisplayName(tag,locale)}</option>)}</select></label>}
   </div>
   {projection?.invalidRange?<p id="stats-date-error" role="alert" className="mt-4 text-sm text-feedback-danger">{t('statistics.invalid')}</p>:projection&&<div className="mt-5"><p role="status" className="text-sm text-fg-secondary">{quantity('statistics.count',projection.total)}</p>{projection.total===0?<div className="py-6 text-sm text-fg-secondary"><p>{t(projection.hasRecords?'statistics.empty':'statistics.noRecords')}</p>{projection.hasRecords&&<button className={studyButton} onClick={reset}>{t('statistics.reset')}</button>}</div>:<><RecordList projection={projection} limit={limit} onOpenTarget={onOpenTarget}/>{projection.total>limit&&<button className={studyButton} disabled={history.busy} onClick={()=>setLimit(value=>value+20)}>{t('statistics.more')}</button>}</>}</div>}
   <details className="mt-4 text-sm text-fg-secondary"><summary className="min-h-11 cursor-pointer py-3">{t('statistics.readingGuide')}</summary><p className="max-w-3xl pb-2 leading-6">{t('statistics.countBasis')}</p><p className="pb-2 text-xs">{t('statistics.timezone',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone})}</p></details>
  </div></details>
 </LearningSetupFrame>;
}
