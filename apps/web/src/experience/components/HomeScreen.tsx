import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Plus, RotateCcw, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SensaWorkspacePageLayout } from '../ui/SensaPageLayouts';

interface HomeScreenProps {
  active: boolean;
  busy?: boolean;
  status?: ReactNode;
  newAvailable?: number;
  accountDate?: string;
  onGo: (id: string) => void;
  onStartMixed: () => void;
  onResume?: () => void;
  onStartReview?: () => void;
  onRecordContext: () => void;
  mixedReadyN: number;
  reviewDueN?: number;
}

export function HomeScreen({ active, onGo, onStartMixed, onResume, onStartReview, onRecordContext, mixedReadyN, reviewDueN = 0, newAvailable, busy, status, accountDate }: HomeScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh-CN';
  const number = new Intl.NumberFormat(locale);
  const newCount = newAvailable ?? Math.max(0, mixedReadyN - reviewDueN);
  const hasWork = mixedReadyN > 0;
  const date = accountDate ? new Date(accountDate+'T12:00:00') : new Date();
  const dateLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  const focus = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus';

  return <SensaWorkspacePageLayout
    id="s-home"
    measure="standard"
    className={`screen z-5 ${active ? 'active' : 'invisible pointer-events-none'}`}
    regions={{
      header: <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-medium tracking-[-0.04em] lg:text-5xl">{t('home.title')}</h1>
        <time dateTime={`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`} className="pb-1 text-xs text-fg-tertiary sm:text-sm">{dateLabel}</time>
      </div>,
      primary: <>
      {status}
      <section aria-labelledby="today-learning-title" className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel shadow-raised">
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-6 py-5 sm:px-9">
          <h2 id="today-learning-title" className="flex items-center gap-2.5 text-sm font-medium"><span aria-hidden="true" className="h-3 w-1 rounded-full bg-action-primary"/>{t('home.plan')}</h2>
          <button type="button" onClick={() => onGo('s-study')} aria-label={t('home.manage')} className={`flex min-h-11 items-center gap-2 text-xs text-fg-secondary transition-colors hover:text-action-primary ${focus}`}><span className="hidden sm:inline">{t('home.manage')}</span><ArrowUpRight size={17}/></button>
        </div>
        <div className="px-6 py-7 sm:px-9 sm:py-10 lg:px-12">
          <div className="grid grid-cols-2 divide-x divide-border-subtle" aria-label={t('home.summary')}>
            {[{label:t('home.new'),count:newCount},{label:t('home.review'),count:reviewDueN}].map(({label,count},index) => <div key={index} className={index ? 'pl-7 sm:pl-12' : 'pr-7'}>
              <span className="text-sm text-fg-secondary">{label}</span>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="font-language text-6xl font-normal leading-none tracking-[-0.06em] tabular-nums sm:text-7xl lg:text-[88px]">{number.format(count)}</strong><span className="text-xs text-fg-tertiary">{t('home.unit')}</span></div>
            </div>)}
          </div>
          <p className="mb-7 mt-9 text-sm leading-6 text-fg-secondary">{t(onResume ? 'runtime.resumeHint' : !hasWork ? 'home.emptyHint' : reviewDueN && newCount ? 'home.reviewFirst' : reviewDueN ? 'home.reviewOnlyHint' : 'home.newOnly')}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <button type="button" disabled={busy} onClick={onResume ?? (hasWork ? onStartMixed : () => onGo('s-learning-entry'))}
              className={`flex min-h-14 items-center justify-between gap-12 rounded-control bg-action-primary px-6 text-sm font-medium text-action-on-primary transition-colors hover:bg-action-primary-hover motion-reduce:transition-none sm:min-w-64 ${focus}`}>
              {t(onResume ? 'runtime.resume' : hasWork ? 'home.start' : 'home.emptyAction')}<ArrowRight size={18} strokeWidth={1.6}/>
            </button>
            <button type="button" onClick={onStartReview} disabled={busy || !reviewDueN || !onStartReview}
              aria-label={reviewDueN ? t('home.reviewCount',{count:reviewDueN}) : t('home.noReview')}
              className={`flex min-h-12 items-center justify-center gap-2.5 rounded-control px-3 text-sm text-fg-secondary hover:bg-surface-subtle disabled:cursor-default disabled:text-fg-tertiary disabled:hover:bg-transparent ${focus}`}>
              <RotateCcw size={16} strokeWidth={1.6}/>{t(reviewDueN ? 'home.reviewOnly' : 'home.noReview')}
            </button>
          </div>
          {!hasWork && !onResume && <p className="mt-4 text-xs text-fg-secondary" role="status">{t('home.empty')}</p>}
        </div>
      </section>

      <section aria-labelledby="add-learning-title" className="mt-10 lg:mt-12">
        <h2 id="add-learning-title" className="mb-4 flex items-center gap-2 text-sm font-medium"><Plus size={16} strokeWidth={1.6}/>{t('home.add')}</h2>
        <div className="grid border-y border-border-subtle sm:grid-cols-2 sm:divide-x sm:divide-border-subtle">
          {[{title:t('home.existing'),hint:t('home.existingHint'),icon:BookOpen,action:()=>onGo('s-learning-entry')},{title:t('home.personal'),hint:t('home.personalHint'),icon:MessageSquareText,action:onRecordContext}].map(({title,hint,icon:Icon,action},index)=><button key={index} type="button" onClick={action}
            className={`group flex min-h-28 items-center gap-4 py-6 text-left transition-colors hover:bg-surface-subtle ${index ? 'border-t border-border-subtle sm:border-0 sm:pl-7' : 'sm:pr-7'} ${focus}`}>
            <span className="grid size-11 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface-panel text-action-primary"><Icon size={20} strokeWidth={1.4}/></span>
            <span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{title}</strong><span className="mt-2 block text-xs leading-5 text-fg-tertiary">{hint}</span></span><ArrowUpRight size={17} className="shrink-0 text-fg-tertiary group-hover:text-action-primary"/>
          </button>)}
        </div>
      </section>
      </>,
    }}
  />;
}
