import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {LearningHistorySummary} from '../../learning/system/learningHistoryModel';
import {statisticsCalendar,statisticsKinds,statisticsTrend} from '../learningJourney/statisticsCalendar';

export function StatisticsCalendar({summary,year,onDay}:{summary:LearningHistorySummary;year:number;onDay:(day:string)=>void}){
 const {t,i18n}=useTranslation(),days=statisticsCalendar(summary,year),today=new Date(summary.clock);
 const [month,setMonth]=useState(today.getFullYear()===year?today.getMonth():0),[focused,setFocused]=useState(''),[monthFocused,setMonthFocused]=useState('');
 const monthGrid=useRef<HTMLDivElement>(null);
 const format=(day:string)=>new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium'}).format(new Date(day+'T12:00:00'));
 const describe=(day:typeof days[number])=>`${format(day.day)} · ${day.future?t('statistics.future'):!day.inRange?t('statistics.outsideRange'):statisticsKinds.map(kind=>`${t('statistics.'+kind)} ${day.counts[kind]}`).join(' · ')}`;
 const focusDay=days.find(day=>day.day===focused&&day.inRange&&!day.future)??days.filter(day=>day.inRange&&!day.future).at(-1)??days[0]!;
 const monthDays=days.filter(day=>day.month===month),monthFocusDay=monthDays.find(day=>day.day===monthFocused&&day.inRange&&!day.future)??monthDays.filter(day=>day.inRange&&!day.future).at(-1)??monthDays[0]!;
 const chooseMonth=(value:number)=>{setMonth(value);setMonthFocused(days.filter(day=>day.month===value&&day.inRange&&!day.future).at(-1)?.day??'');};
 const dayButton=(day:typeof days[number],compact:boolean)=><button key={day.day} type="button" data-day={day.day} data-level={!day.inRange||day.future?'unavailable':day.total===0?'zero':day.total<2?'one':day.total<5?'few':'many'} disabled={day.future||!day.inRange} tabIndex={!day.future&&day.inRange&&day.day===(compact?focusDay:monthFocusDay).day?0:-1} aria-label={describe(day)} title={describe(day)} onFocus={()=>compact?setFocused(day.day):setMonthFocused(day.day)} onMouseEnter={()=>compact?setFocused(day.day):setMonthFocused(day.day)} onClick={()=>onDay(day.day)} onKeyDown={event=>{
  const move={ArrowRight:compact?7:1,ArrowLeft:compact?-7:-1,ArrowDown:compact?1:7,ArrowUp:compact?-1:-7}[event.key];if(move===undefined)return;event.preventDefault();const next=days[days.indexOf(day)+move];if(!next||next.future||!next.inRange)return;
  if(!compact&&next.month!==month){setMonth(next.month);setMonthFocused(next.day);requestAnimationFrame(()=>(monthGrid.current?.querySelector(`button[data-day="${next.day}"]`) as HTMLButtonElement|null)?.focus());}
  else (event.currentTarget.closest(compact?'.sensa-stat-year':'.sensa-stat-month-grid')?.querySelector(`button[data-day="${next.day}"]`) as HTMLButtonElement|null)?.focus();
 }} className={compact?'sensa-stat-day sensa-stat-day-compact':'sensa-stat-day sensa-stat-day-month'}>{compact?<span className="sr-only">{day.total}</span>:<><span>{day.date}</span><small>{day.future?'—':day.inRange?day.total:'·'}</small></>}</button>;
 const trend=statisticsTrend(summary),rows=trend.rows;const max=Math.max(1,...rows.flatMap(row=>statisticsKinds.map(kind=>row.counts[kind])));
 return <>
  <section className="sensa-stat-calendar mt-8 rounded-card border border-border-subtle bg-surface-panel p-4 sm:p-6" aria-label={t('statistics.calendar')}>
   <h3 className="text-lg font-medium">{year} · {t('statistics.calendar')}</h3>
   <p className="mt-2 text-xs leading-6 text-fg-secondary">{t('statistics.countBasis')}</p>
   <div className="sensa-stat-year-months mt-4" aria-hidden="true" style={{gridTemplateColumns:`repeat(${Math.ceil((days.length+days[0]!.weekday)/7)},minmax(0,1fr))`}}>{Array.from({length:12},(_,month)=><span key={month} style={{gridColumnStart:1+Math.floor((days.findIndex(day=>day.month===month)+days[0]!.weekday)/7)}}>{new Intl.DateTimeFormat(i18n.language,{month:'short'}).format(new Date(year,month,1))}</span>)}</div>
   <div className="sensa-stat-year mt-2" aria-label={t('statistics.calendar')}><span style={{gridRow:`span ${days[0]!.weekday||1}`,display:days[0]!.weekday?'block':'none'}}/>{days.map(day=>dayButton(day,true))}</div>
   <div className="sensa-stat-month mt-4">
    <label className="text-sm">{t('statistics.calendar')} <select aria-label={t('statistics.calendarMonth')} value={month} onChange={event=>chooseMonth(Number(event.target.value))} className="ml-2 min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3">{Array.from({length:12},(_,value)=><option key={value} value={value}>{new Intl.DateTimeFormat(i18n.language,{month:'long'}).format(new Date(year,value,1))}</option>)}</select></label>
    <div ref={monthGrid} className="sensa-stat-month-grid mt-4">{Array.from({length:7},(_,day)=><span className="text-center text-xs text-fg-secondary" key={'week'+day}>{new Intl.DateTimeFormat(i18n.language,{weekday:'narrow'}).format(new Date(2026,9,5+day))}</span>)}{monthDays.map((day,index)=><span key={day.day} style={index===0?{gridColumnStart:day.weekday+1}:undefined}>{dayButton(day,false)}</span>)}</div>
   </div>
   <p className="sensa-stat-year-status mt-4 text-sm" role="status">{describe(focusDay)}</p>
   <p className="sensa-stat-month-status mt-4 text-sm" role="status">{describe(monthFocusDay)}</p>
   <p className="mt-3 flex flex-wrap gap-3 text-xs text-fg-secondary">{[['zero','0'],['one','1'],['few','2–4'],['many','5+'],['unavailable','—']].map(([level,label])=><span key={level} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="sensa-stat-key" data-level={level}/>{label==='—'?t('statistics.futureOrOutside'):label+' '+t('statistics.recordsUnit')}</span>)}</p>
  </section>
  <section className="mt-8" aria-label={t('statistics.trend')}>
   <h3 className="text-lg font-medium">{t('statistics.trend')}</h3>
   <p className="mt-2 text-xs text-fg-secondary">{t('statistics.countBasis')}</p>
   {rows.length?<div className="mt-4 overflow-x-auto"><svg viewBox={`0 0 ${Math.max(500,rows.length*45)} 180`} className="min-w-[500px] w-full" tabIndex={0} role="img" aria-label={t('statistics.trend')}><title>{t('statistics.trend')}</title><desc>{rows.map(row=>`${row.key}: ${statisticsKinds.map(kind=>t('statistics.'+kind)+' '+row.counts[kind]).join(', ')}`).join('; ')}</desc>{statisticsKinds.map((kind,index)=><g key={kind} className={`sensa-stat-series sensa-stat-series-${index}`}><polyline fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={index===1?'8 4':index===2?'2 4':undefined} points={rows.map((row,x)=>`${24+x*(Math.max(500,rows.length*45)-48)/Math.max(1,rows.length-1)},${145-row.counts[kind]/max*120}`).join(' ')}/>{rows.map((row,x)=><g key={row.key}><circle cx={24+x*(Math.max(500,rows.length*45)-48)/Math.max(1,rows.length-1)} cy={145-row.counts[kind]/max*120} r={index+2}/>{index===0&&<text x={24+x*(Math.max(500,rows.length*45)-48)/Math.max(1,rows.length-1)} y="173" textAnchor="middle" fontSize="10" fill="currentColor">{row.key.slice(trend.daily?5:0)}</text>}</g>)}</g>)}</svg></div>:<p className="mt-4 text-sm">{t('statistics.empty')}</p>}
   <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-3">{t('statistics.trendValues')}</summary><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">{t('statistics.trendValues')}</caption><thead><tr><th scope="col">{t('statistics.date')}</th>{statisticsKinds.map(kind=><th scope="col" key={kind}>{t('statistics.'+kind)}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row" className="py-2 font-normal">{row.key}</th>{statisticsKinds.map(kind=><td key={kind}>{row.counts[kind]}</td>)}</tr>)}</tbody></table></div></details>
   <div className="mt-3 flex flex-wrap gap-4 text-xs">{statisticsKinds.map((kind,index)=><span key={kind} className={`sensa-stat-series sensa-stat-series-${index}`}>{index===0?'━':index===1?'┄':'┈'} {t('statistics.'+kind)}</span>)}</div>
  </section>
 </>;
}
