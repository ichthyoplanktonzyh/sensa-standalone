import {useTranslation} from 'react-i18next';
import type {LearningHistoryProjection} from '../../learning/system';
import type {LearningHistoryKind} from '../../learning/system/learningHistoryModel';
import {useLearningSchedule} from '../library/useLearningSchedule';
import {useScreenState} from '../ui/ScreenHost';
import {setupButton} from './learning/LearningSetupFrame';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
export function StatisticsForecast({history,kind,onOpenTarget}:{history:LearningHistoryProjection;kind:'all'|LearningHistoryKind;onOpenTarget:(id:string)=>void}){
 const {t,i18n}=useTranslation(),[days,setDays]=useScreenState<7|30>('stats:forecast-days',7),[day,setDay]=useScreenState<string|null>('stats:forecast-day',null),[offset,setOffset]=useScreenState('stats:forecast-offset',0);
 const forecast=useLearningSchedule({days,kind,languageScope:history.languageScope,day,offset,clock:history.clock},true),data=forecast.data;
 const quantity=(key:string,count:number)=>t(key,{count,formattedCount:new Intl.NumberFormat(i18n.language).format(count)});
 const number=(value:number)=>new Intl.NumberFormat(i18n.language).format(value);
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language),format=(value:string)=>new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium'}).format(new Date(value+'T12:00:00'));
 return <section className="mt-10 border-t border-border-subtle pt-7" aria-label={t('statistics.forecast')}>
  <h3 className="text-lg font-medium">{t('statistics.forecast')}</h3><details className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-3 text-fg-secondary">{t('statistics.forecastAbout')}</summary><p className="max-w-3xl pb-3 leading-6 text-fg-secondary">{t('statistics.forecastNote')}</p></details>
  <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('statistics.forecastPeriod')}>{([7,30] as const).map(value=><button type="button" key={value} aria-pressed={days===value} className={setupButton+(days===value?' bg-surface-selected font-medium':'')} onClick={()=>{setDays(value);setDay(null);setOffset(0);}}>{quantity('statistics.forecastDays',value)}</button>)}{day&&<button className={setupButton} onClick={()=>{setDay(null);setOffset(0);}}>{t('statistics.forecastReset')}</button>}</div>
  {forecast.status==='loading'?<p className="mt-4" role="status" aria-busy="true">{t('reliability.loading')}</p>:forecast.status==='unavailable'?<div role="alert" className="mt-4"><p>{t('statistics.forecastError')}</p><button className={setupButton} onClick={forecast.retry}>{t('reliability.retry')}</button></div>:forecast.reason?<p className="mt-4 text-sm">{t(forecast.reason==='initial'?'statistics.forecastInitial':'statistics.forecastLanguage')}</p>:data&&<>
   <p className="mt-4 text-xs text-fg-secondary">{t('statistics.forecastRoute',{language:interfaceLanguageDisplayName(forecast.context!.targetLanguageTag,locale),support:interfaceLanguageDisplayName(forecast.context!.supportLanguageTag,locale)})} · {day?format(day):format(data.fromDay)+' – '+format(data.throughDay)}</p>
   <p className="mt-3 text-xl font-medium" role="status">{quantity('statistics.forecastCount',data.total)}</p>
   <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{t('statistics.forecast')}</caption><thead><tr><th scope="col" className="py-3">{t('statistics.date')}</th><th scope="col">{t('statistics.retention_review')}</th><th scope="col">{t('statistics.relearning')}</th></tr></thead><tbody>{data.days.map(row=><tr key={row.day}><th scope="row" className="font-normal"><button className={setupButton+' px-0 text-left'} onClick={()=>{setDay(row.day);setOffset(0);}}>{format(row.day)}</button></th><td>{number(row.retention_review)}</td><td>{number(row.relearning)}</td></tr>)}</tbody></table></div>
   {data.total===0?<p className="mt-3 text-sm text-fg-secondary">{t('statistics.forecastEmpty')}</p>:<ol aria-label={t('statistics.forecast')} className="mt-4 divide-y divide-border-subtle">{data.targets.map(target=><li key={target.targetId}><button className="flex min-h-14 w-full flex-wrap items-center justify-between gap-3 rounded-control py-4 text-left focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>onOpenTarget(target.targetId)}><strong className="font-medium"><bdi lang={forecast.context?.targetLanguageTag} dir="auto">{target.expression}</bdi></strong><span className="text-xs text-fg-secondary">{t('study.'+target.kind)} · {new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(target.dueAt))}</span></button></li>)}</ol>}
   <div className="mt-3 flex gap-3">{offset>0&&<button className={setupButton} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('statistics.forecastPrevious')}</button>}{data.nextOffset!==null&&<button className={setupButton} onClick={()=>setOffset(data.nextOffset!)}>{t('statistics.forecastNext')}</button>}</div>
  </>}
 </section>;
}
