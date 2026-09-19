import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, RotateCcw, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SensaWorkspacePageLayout } from '../ui/SensaPageLayouts';
import { SensaAction } from '../ui/SensaComponents';
import { localFlowText } from '../../i18n/localFlowText';
import './HomeScreen.css';

interface HomeScreenProps {
  active: boolean;
  busy?: boolean;
  summaryReady?: boolean;
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

export function HomeScreen({ active, onGo, onStartMixed, onResume, onStartReview, onRecordContext, mixedReadyN, reviewDueN = 0, newAvailable, busy, summaryReady = true, status, accountDate }: HomeScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh-CN';
  const number = new Intl.NumberFormat(locale);
  const newCount = newAvailable ?? Math.max(0, mixedReadyN - reviewDueN);
  const hasWork = mixedReadyN > 0;
  const date = accountDate ? new Date(accountDate+'T12:00:00') : new Date();
  const dateLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  const heading = !summaryReady ? 'home.title' : onResume ? 'runtime.resume' : !hasWork ? 'home.beginTitle' : newCount ? 'home.readyTitle' : 'home.reviewTitle';

  return <SensaWorkspacePageLayout
    id="s-home"
    measure="standard"
    className={`screen sensa-today z-5 ${active ? 'active' : 'invisible pointer-events-none'}`}
    regions={{
      header: <div className="sensa-today-heading">
        <h1>{t('home.title')}</h1>
        <time dateTime={`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}>{dateLabel}</time>
      </div>,
      primary: <>
      {status && <div className="sensa-today-status">{status}</div>}
      <section aria-labelledby="today-learning-title" className="sensa-today-learning">
        <div className="sensa-today-invitation">
          <h2 id="today-learning-title">{t(heading)}</h2>
          <p className="sensa-today-hint">{summaryReady ? t(onResume ? 'runtime.resumeHint' : !hasWork ? 'home.emptyHint' : reviewDueN && newCount ? 'home.reviewFirst' : reviewDueN ? 'home.reviewOnlyHint' : 'home.newOnly') : localFlowText('loadingSensa')}</p>
          <div className="sensa-today-actions">
            <SensaAction type="button" loading={busy || !summaryReady} onClick={onResume ?? (hasWork ? onStartMixed : () => onGo('s-learning-entry'))}
              className="sensa-today-start" trailing={<ArrowRight aria-hidden="true" size={18} strokeWidth={1.6}/> }>
              {t(onResume ? 'runtime.resume' : hasWork ? 'home.start' : 'home.emptyAction')}
            </SensaAction>
            <SensaAction type="button" variant="quiet" onClick={onStartReview} disabled={busy || !summaryReady || !reviewDueN || !onStartReview}
              aria-label={reviewDueN ? t('home.reviewCount',{count:reviewDueN}) : t('home.noReview')}
              leading={<RotateCcw aria-hidden="true" size={16} strokeWidth={1.6}/> }>
              {t(reviewDueN ? 'home.reviewOnly' : 'home.noReview')}
            </SensaAction>
          </div>
          {summaryReady && !hasWork && !onResume && <p className="sensa-today-empty" role="status">{t('home.empty')}</p>}
        </div>
        <div className="sensa-today-plan">
          <h3>{t('home.plan')}</h3>
          <dl aria-label={t('home.summary')} className="sensa-today-counts">
            {[{label:t('home.new'),count:newCount},{label:t('home.review'),count:reviewDueN}].map(({label,count}) => <div key={label}>
              <dt>{label}</dt>
              <dd><strong>{summaryReady ? number.format(count) : '—'}</strong>{summaryReady && <span>{t('home.unit')}</span>}</dd>
            </div>)}
          </dl>
          <SensaAction type="button" variant="quiet" onClick={() => onGo('s-study')} trailing={<ArrowUpRight aria-hidden="true" size={16}/> }>{t('home.manage')}</SensaAction>
        </div>
      </section>

      <section aria-labelledby="add-learning-title" className="sensa-today-discover">
        <h2 id="add-learning-title">{t('home.add')}</h2>
        <div className="sensa-today-entries">
          {[{title:t('home.existing'),hint:t('home.existingHint'),icon:BookOpen,action:()=>onGo('s-learning-entry')},{title:t('home.personal'),hint:t('home.personalHint'),icon:MessageSquareText,action:onRecordContext}].map(({title,hint,icon:Icon,action})=><button key={title} type="button" onClick={action} className="sensa-today-entry">
            <Icon aria-hidden="true" size={22} strokeWidth={1.5}/>
            <span><strong>{title}</strong><span>{hint}</span></span><ArrowUpRight aria-hidden="true" size={18}/>
          </button>)}
        </div>
      </section>
      </>,
    }}
  />;
}
