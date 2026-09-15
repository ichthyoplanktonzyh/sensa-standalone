import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { previewStorage } from '../services/previewStorage';

export const checkinDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const storageKey = 'checkin-dates';
export function readCheckinDates(): string[] {
  const raw = previewStorage.getItem(storageKey);
  if (raw === null) return [];
  const dates: unknown = JSON.parse(raw);
  if (!Array.isArray(dates) || !dates.every(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error('Invalid check-in dates');
  return dates;
}
export function recordCheckin(date: Date): string[] {
  const dates = [...new Set([...readCheckinDates(), checkinDateKey(date)])].sort();
  previewStorage.setItem(storageKey, JSON.stringify(dates));
  window.dispatchEvent(new Event('sensa-checkin'));
  return dates;
}
export type AccountCalendarState = {today: string; dates: string[]; pending: string[]; busy: boolean; uncertain: boolean; timeZone: string; onCheckIn: () => void};
export function StudyCalendar({account}: {account?: AccountCalendarState} = {}) {
  const {t,i18n}=useTranslation();
  const [today,setToday]=useState(()=>new Date());
  const [month,setMonth]=useState(()=>new Date(today.getFullYear(),today.getMonth(),1));
  const [dates,setDates]=useState<string[]>([]);
  const [error,setError]=useState(false);
  useEffect(()=>{
    if(account)return;
    const refresh=()=>{setToday(new Date());try{setDates(readCheckinDates());setError(false);}catch{setError(true);}};
    refresh();
    const timer=window.setInterval(refresh,60000);
    window.addEventListener('storage',refresh);
    window.addEventListener('focus',refresh);
    window.addEventListener('sensa-checkin',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('sensa-checkin',refresh);};
  },[!!account]);
  const todayKey=account?.today ?? checkinDateKey(today);
  const visibleDates=account?.dates ?? dates;
  const signed=visibleDates.includes(todayKey),pending=account?.pending.includes(todayKey);
  const offset=(month.getDay()+6)%7;
  const dayCount=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const label=new Intl.DateTimeFormat(i18n.language,{year:'numeric',month:'long'}).format(month);
  const currentMonth=month.getFullYear()===today.getFullYear()&&month.getMonth()===today.getMonth();
  const move=(amount:number)=>setMonth(new Date(month.getFullYear(),month.getMonth()+amount,1));
  return <section className="mt-8 rounded-overlay border border-border-subtle bg-surface-panel p-6 sm:p-8" aria-labelledby="study-checkin-title">
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div><h2 id="study-checkin-title" className="text-xl font-medium">{t('study.calendar.title')}</h2><p className="mt-3 text-sm leading-6 text-fg-tertiary">{t('study.calendar.note')}</p>
        <button disabled={signed||pending||account?.busy} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-control bg-action-primary px-5 text-sm text-action-on-primary transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-surface-subtle disabled:text-fg-secondary" onClick={()=>{if(account){account.onCheckIn();return;}try{setDates(recordCheckin(new Date()));setToday(new Date());setError(false);}catch{setError(true);}}}>{signed&&<Check size={16}/ >}{pending ? '签到待同步' : t(signed?'study.calendar.signed':'study.calendar.sign')}</button>
        {account?.uncertain&&<p role="status" className="mt-3 text-sm text-feedback-warning">有签到时间需要核对。原记录已保留，请联网校准后重新确认今天的签到。</p>}
        {account&&<p className="mt-3 text-xs text-fg-tertiary">虚线为待同步，按账号时区 {account.timeZone} 记录。</p>}
        {error&&<p role="alert" className="mt-3 text-sm text-feedback-danger">{t('study.calendar.error')}</p>}
      </div>
      <div>
        <div className="mb-4 flex items-center justify-between gap-3"><h3 aria-live="polite" className="font-medium">{label}</h3><div className="flex items-center gap-1">
          <button className="grid size-10 place-items-center rounded-control hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>move(-1)} aria-label={t('study.calendar.previous')}><ChevronLeft size={18}/></button>
          {!currentMonth&&<button className="min-h-10 px-2 text-xs text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>setMonth(new Date(today.getFullYear(),today.getMonth(),1))}>{t('study.calendar.current')}</button>}
          <button disabled={currentMonth} className="grid size-10 place-items-center rounded-control hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-25" onClick={()=>move(1)} aria-label={t('study.calendar.next')}><ChevronRight size={18}/></button>
        </div></div>
        <div role="grid" aria-label="签到日历" className="grid grid-cols-7 gap-y-2 text-center text-sm">
          {Array.from({length:7},(_,index)=><span key={'week'+index} className="pb-2 text-xs text-fg-tertiary">{new Intl.DateTimeFormat(i18n.language,{weekday:'short'}).format(new Date(2026,8,7+index))}</span>)}
          {Array.from({length:offset},(_,index)=><span aria-hidden="true" key={'blank'+index}/>)}
          {Array.from({length:dayCount},(_,index)=>{
            const date=new Date(month.getFullYear(),month.getMonth(),index+1);
            const key=checkinDateKey(date), recorded=visibleDates.includes(key), isToday=key===todayKey,waiting=account?.pending.includes(key);
            return <span role="gridcell" key={key} aria-current={isToday?'date':undefined} aria-label={`${key} ${recorded?'已签到':waiting?'待同步':'未签到'}`} className={`relative mx-auto grid size-9 place-items-center rounded-pill tabular-nums ${recorded?'bg-surface-selected text-action-primary':key>todayKey?'text-fg-tertiary opacity-45':'text-fg-secondary'} ${waiting?'border border-dashed border-focus':''} ${isToday?'ring-1 ring-focus ring-offset-2 ring-offset-surface-panel':''}`}>{index+1}{recorded&&<span aria-hidden="true" className="absolute bottom-0.5 size-1 rounded-pill bg-action-primary"/>}</span>;
          })}
        </div>
      </div>
    </div>
  </section>;
}
