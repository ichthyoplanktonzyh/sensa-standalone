import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, RotateCcw, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SensaWorkspacePageLayout } from '../ui/SensaPageLayouts';
import { SensaAction } from '../ui/SensaComponents';
import { localFlowText } from '../../i18n/localFlowText';
import './HomeScreen.css';
import type {HomeLearningState} from '../library/homeLearningState';

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
  state?:HomeLearningState;
  nextReviewAt?:string|null;
  resumeRoute?:string;
  onOpenTargets?:(filter:'new'|'due')=>void;
}

export function HomeScreen({ active, onGo, onStartMixed, onResume, onStartReview, onRecordContext, mixedReadyN, reviewDueN = 0, newAvailable, busy, summaryReady = true, status, accountDate,state,nextReviewAt,resumeRoute,onOpenTargets }: HomeScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh-CN';
  const number = new Intl.NumberFormat(locale);
  const newCount = newAvailable ?? Math.max(0, mixedReadyN - reviewDueN);
  const hasWork = mixedReadyN > 0;
  const currentState=state??(!summaryReady?'loading':onResume?'resume':hasWork?newCount?'ready':'review':'empty');
  const chooseSource = currentState==='empty';
  const date = accountDate ? new Date(accountDate+'T12:00:00') : new Date();
  const dateLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  const heading = currentState==='loading'?'home.title':currentState==='resume'?'home.resume':currentState==='ready'?'home.readyTitle':currentState==='review'?'home.reviewTitle':null;
  const primaryAction=onResume??(hasWork?onStartMixed:chooseSource?()=>onGo('s-catalog'):()=>onGo('s-learning-library'));
  const nextReviewLabel=nextReviewAt?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(nextReviewAt)):null;

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
          <h2 id="today-learning-title">{heading?t(heading):localFlowText(currentState==='empty'?'todayEmptyTitle':currentState==='waiting'?'todayWaitingTitle':currentState==='route_empty'?'todayRouteEmptyTitle':'todayIdleTitle')}</h2>
          {resumeRoute&&<p className="sensa-today-hint">{resumeRoute}</p>}
          {summaryReady&&nextReviewLabel&&currentState==='waiting'&&<p className="sensa-today-hint">{localFlowText('nextReviewLabel')}: <time dateTime={nextReviewAt!}>{nextReviewLabel}</time></p>}
          {!summaryReady && <p role="status" className="sensa-today-hint">{localFlowText('loadingSensa')}</p>}
          <div className="sensa-today-actions">
            <SensaAction type="button" loading={busy || !summaryReady} onClick={primaryAction}
              className="sensa-today-start" trailing={<ArrowRight aria-hidden="true" size={18} strokeWidth={1.6}/> }>
              {onResume ? t('home.resume') : hasWork ? t('home.start') : chooseSource?localFlowText('packageCenterCatalog'):t('study.library')}
            </SensaAction>
            {chooseSource && <SensaAction type="button" variant="quiet" onClick={onRecordContext} leading={<MessageSquareText aria-hidden="true" size={16}/>}>{t('home.personal')}</SensaAction>}
            {summaryReady && reviewDueN > 0 && onStartReview && <SensaAction type="button" variant="quiet" onClick={onStartReview} disabled={busy}
              aria-label={t('home.reviewCount',{count:reviewDueN})}
              leading={<RotateCcw aria-hidden="true" size={16} strokeWidth={1.6}/> }>
              {t('home.reviewOnly')}
            </SensaAction>}
          </div>
        </div>
        {chooseSource ? <SensaAction type="button" variant="quiet" onClick={() => onGo('s-study')} className="mt-6" trailing={<ArrowUpRight aria-hidden="true" size={16}/>}>{t('home.manage')}</SensaAction> : <div className="sensa-today-plan">
          <h3>{t('home.plan')}</h3>
          <dl aria-label={t('home.summary')} className="sensa-today-counts">
            {[{label:t('home.new'),count:newCount,filter:'new' as const},{label:t('home.review'),count:reviewDueN,filter:'due' as const}].map(({label,count,filter}) => <div key={label}>
              <dt>{label}</dt>
              <dd><button disabled={!summaryReady} onClick={()=>onOpenTargets?.(filter)} aria-label={`${label} ${summaryReady?number.format(count):'—'}`} className="rounded-control focus-visible:outline-2 focus-visible:outline-focus"><strong>{summaryReady ? number.format(count) : '—'}</strong>{summaryReady && <span>{t('home.unit')}</span>}</button></dd>
            </div>)}
          </dl>
          <SensaAction type="button" variant="quiet" onClick={() => onGo('s-study')} trailing={<ArrowUpRight aria-hidden="true" size={16}/> }>{t('home.manage')}</SensaAction>
        </div>}
      </section>

      {!chooseSource && <section aria-labelledby="add-learning-title" className="sensa-today-discover">
        <h2 id="add-learning-title">{t('home.add')}</h2>
        <div className="sensa-today-entries">
          {[{title:localFlowText('packageCenterCatalog'),icon:BookOpen,action:()=>onGo('s-catalog')},{title:t('home.personal'),icon:MessageSquareText,action:onRecordContext}].map(({title,icon:Icon,action})=><button key={title} type="button" onClick={action} className="sensa-today-entry">
            <Icon aria-hidden="true" size={22} strokeWidth={1.5}/>
            <span><strong>{title}</strong></span><ArrowUpRight aria-hidden="true" size={18}/>
          </button>)}
        </div>
      </section>}
      </>,
    }}
  />;
}
