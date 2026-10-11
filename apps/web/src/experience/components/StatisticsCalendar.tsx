import {cloneElement,useEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {ActivityCalendar,type BlockElement,type DayIndex} from 'react-activity-calendar';
import {DayPicker,DayButton,type DayButtonProps} from '@daypicker/react';
import {zhCN,zhTW,enUS,ja,ko,es,fr,de,ptBR,it,ru,id,vi,pl,tr} from '@daypicker/react/locale';
import {FloatingPortal,autoUpdate,offset,shift,useFloating,useFocus,useHover,useInteractions,useRole,useDismiss} from '@floating-ui/react';
import {useTranslation} from 'react-i18next';
import type {LearningHistorySummary} from '../../learning/system/learningHistoryModel';
import {statisticsCalendar,statisticsCount} from '../learningJourney/statisticsCalendar';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {useScreenState} from '../ui/ScreenHost';
import '@daypicker/react/style.css';
import './StatisticsCalendar.css';

const activityColors=['var(--sensa-surface-subtle)',...([40,60,80,100] as const).map(amount=>`color-mix(in srgb, var(--sensa-action-primary) ${amount}%, var(--sensa-surface-panel))`)];
const locales={'zh-CN':zhCN,'zh-TW':zhTW,en:enUS,ja,ko,es,fr,de,'pt-BR':ptBR,it,ru,id,vi,pl,tr};
type Day=ReturnType<typeof statisticsCalendar>[number];
const date=(key:string)=>new Date(key+'T12:00:00');
function ActivityBlock({block,day,label,tabIndex,selected,onFocus,onDay,onKeyDown}:{block:BlockElement;day:Day;label:string;tabIndex:number;selected:boolean;onFocus:()=>void;onDay:()=>void;onKeyDown:(event:KeyboardEvent<SVGRectElement>)=>void}){
 const [open,setOpen]=useState(false);
 const {refs,floatingStyles,context}=useFloating({open,onOpenChange:setOpen,placement:'top',middleware:[offset(8),shift({padding:12})],whileElementsMounted:autoUpdate});
 const {getReferenceProps,getFloatingProps}=useInteractions([useHover(context),useFocus(context,{visibleOnly:false}),useRole(context,{role:'tooltip'}),useDismiss(context)]);
 const disabled=day.future||!day.inRange;
 const props=getReferenceProps({role:'button',tabIndex, 'aria-label':label,'aria-disabled':disabled,'aria-pressed':selected,
  onFocus,onClick:()=>{if(!disabled)onDay();},onKeyDown,
  className:'sensa-activity-block',style:{...block.props.style,...(disabled?{fill:'var(--sensa-surface-subtle)',stroke:'var(--sensa-border-subtle)',strokeDasharray:'2 1'}:{})}});
 return <g>{cloneElement(block,{...props,ref:refs.setReference} as typeof block.props)}{open&&<FloatingPortal><div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="sensa-activity-tooltip">{label}</div></FloatingPortal>}</g>;
}
export function StatisticsCalendar({summary,year,onDay,selectedDay=null}:{summary:LearningHistorySummary;year:number;onDay:(day:string)=>void;selectedDay?:string|null}){
 const {t,i18n}=useTranslation(),locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language),days=statisticsCalendar(summary,year);
 const byDay=new Map(days.map(day=>[day.day,day])),number=(value:number)=>new Intl.NumberFormat(locale).format(value);
 const selectable=days.filter(day=>!day.future&&day.inRange),fallback=selectable.at(-1)?.day??null;
 const [focused,setFocused]=useState<string|null>(null),root=useRef<HTMLDivElement>(null);
 const [month,setMonth]=useScreenState('stats:calendar-month',()=>year===new Date(summary.clock).getFullYear()?new Date(summary.clock).getMonth():0);
 const [calendarYear,setCalendarYear]=useScreenState('stats:calendar-year',year);
 useEffect(()=>{if(calendarYear!==year){setFocused(null);setMonth(year===new Date(summary.clock).getFullYear()?new Date(summary.clock).getMonth():0);setCalendarYear(year);}},[year,calendarYear]);
 const focusedItem=byDay.get(focused??'');
 const focusDay=focusedItem&&!focusedItem.future&&focusedItem.inRange?focused:fallback;
 const describe=(day:Day)=>new Intl.DateTimeFormat(locale,{dateStyle:'full'}).format(date(day.day))+' · '+(day.future?t('statistics.future'):!day.inRange?t('statistics.outside'):t('statistics.count',{count:day.total,formattedCount:number(day.total)}));
 const weekStart=(locales[locale].options?.weekStartsOn??1) as DayIndex;
 const keyboard=(event:KeyboardEvent<SVGRectElement>,day:Day)=>{
  if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!day.future&&day.inRange)onDay(day.day);return;}
  const move={ArrowRight:7,ArrowLeft:-7,ArrowDown:1,ArrowUp:-1}[event.key];
  if(move===undefined)return;event.preventDefault();const next=days[days.indexOf(day)+move];
  if(next&&!next.future&&next.inRange)root.current?.querySelector<SVGRectElement>(`[data-date="${next.day}"]`)?.focus();
 };
 const MonthDayButton=useMemo(()=>function MonthDayButton(props:DayButtonProps){
  const key=String(props.day.date.getFullYear()).padStart(4,'0')+'-'+String(props.day.date.getMonth()+1).padStart(2,'0')+'-'+String(props.day.date.getDate()).padStart(2,'0');
  const day=byDay.get(key);
  return <DayButton {...props} data-day={key} data-level={!day||day.future||!day.inRange?'unavailable':day.total===0?'zero':day.total<2?'one':day.total<5?'few':'many'}>
   <span>{number(props.day.date.getDate())}</span><small aria-hidden="true">{!day||day.future?'—':!day.inRange?'·':number(day.total)}</small>
  </DayButton>;
 },[summary,year,locale]);
 const total=days.reduce((sum,day)=>sum+(!day.future&&day.inRange?statisticsCount(day.counts):0),0),activeDays=days.filter(day=>day.inRange&&!day.future&&day.total>0).length;
 return <section className="sensa-stat-calendar" aria-label={t('statistics.calendar')}>
  <div className="sensa-activity-summary"><h2 className="text-lg font-medium">{t('statistics.activity')}</h2><p>{t('statistics.count',{count:total,formattedCount:number(total)})}<span aria-hidden="true"> · </span>{t('statistics.days',{count:activeDays,formattedCount:number(activeDays)})}</p></div>
  <div ref={root} className="sensa-activity-year">
   <ActivityCalendar data={days.map(day=>({date:day.day,count:day.future||!day.inRange?0:day.total,level:day.total===0?0:day.total<2?1:day.total<5?2:day.total<10?3:4}))}
    blockSize={12} blockMargin={4} blockRadius={3} fontSize={11} weekStart={weekStart} showTotalCount={false} showColorLegend={false} showWeekdayLabels={['mon','wed','fri']}
    labels={{months:Array.from({length:12},(_,month)=>new Intl.DateTimeFormat(locale,{month:'short'}).format(new Date(year,month,1))),weekdays:Array.from({length:7},(_,index)=>new Intl.DateTimeFormat(locale,{weekday:'short'}).format(new Date(2026,9,4+index)))}}
    theme={{light:activityColors,dark:activityColors}}
    renderBlock={(block,activity)=>{const day=byDay.get(activity.date)!;return <ActivityBlock block={block} day={day} label={describe(day)} tabIndex={activity.date===focusDay?0:-1} selected={selectedDay===activity.date} onFocus={()=>setFocused(activity.date)} onDay={()=>onDay(activity.date)} onKeyDown={event=>keyboard(event,day)}/>;}}/>
  </div>
  <div className="sensa-activity-month"><DayPicker mode="single" month={new Date(year,month,1)} onMonthChange={value=>setMonth(value.getMonth())} startMonth={new Date(year,0,1)} endMonth={new Date(year,11,1)}
   selected={selectedDay?date(selectedDay):undefined} onSelect={value=>{if(value)onDay(String(value.getFullYear()).padStart(4,'0')+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0'));}}
   locale={locales[locale]} weekStartsOn={weekStart} disabled={value=>{const day=days.find(day=>date(day.day).toDateString()===value.toDateString());return !day||day.future||!day.inRange;}}
   components={{DayButton:MonthDayButton}} labels={{labelDayButton:value=>{const day=days.find(day=>date(day.day).toDateString()===value.toDateString());return day?describe(day):new Intl.DateTimeFormat(locale,{dateStyle:'full'}).format(value);},labelNext:()=>t('directLearning.next',{ns:'learning'}),labelPrevious:()=>t('directLearning.previous',{ns:'learning'})}}/></div>
  <div className="sensa-activity-legend" aria-label={t('statistics.calendar')}><span>{t('statistics.less')}</span>{[0,1,2,3,4].map(level=><i key={level} data-level={level} aria-hidden="true"/>)}<span>{t('statistics.moreActivity')}</span></div>
 </section>;
}
