import { StudyCalendar } from './StudyCalendar';
import { type ReactNode } from 'react';
import { ArrowRight, BookOpen, Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {localFlowText} from '../../i18n/localFlowText';
import type { LearningRecordKind, LearningRecordView } from '../learningJourney/learningHistory';
import type { LearningPolicy, LearningPolicyOption } from '../../learning/system';
import { LearningPreferencesPanel } from './learning/LearningPreferencesPanel';
import { SensaWorkspacePageLayout } from '../ui/SensaPageLayouts';
import { useScreenState } from '../ui/ScreenHost';

interface StudyScreenProps {
  policySummary?: string;
  fixedPolicy?: boolean;
  active: boolean;
  status?: ReactNode;
  calendar?: ReactNode;
  onOpenPreferences?: () => void;
  tab: 'a' | 'b';
  onTabChange: (tab: 'a' | 'b') => void;
  onAddLearning: () => void;
  onOpenTargetLibrary: () => void;
  onOpenStats: () => void;
  onOpenTarget: (id: string) => void;
  onPolicyChange: (policy: LearningPolicy) => void;
  defaultPolicy: LearningPolicy;
  policyOptions?: readonly LearningPolicyOption[];
  learningTargetCount: number;
  /** The language the counts and the queue act on. The daily limit is the
   * account's, so it is named separately from the language counts. */
  languageLabel: string;
  readyInitialCount: number;
  reviewCount: number;
  dailyNewCount: number;
  learningRecords: readonly LearningRecordView[];
  onDailyNewCountChange: (count: number) => void;
}
export const studyButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
export const StudyScreen = (props: StudyScreenProps) => {
  const {t,i18n}=useTranslation();
  const [filter,setFilter]=useScreenState<'all'|LearningRecordKind>('study:history-filter','all');
  const [limit,setLimit]=useScreenState('study:history-limit',10);
  const records=props.learningRecords.filter(record=>filter==='all'||record.kind===filter);
  const closePreferences=()=>{
    props.onTabChange('a');
    requestAnimationFrame(()=>document.getElementById('study-preferences-button')?.focus());
  };
  return <>
    <SensaWorkspacePageLayout
      id="s-study"
      measure="wide"
      className={`screen z-10 ${props.active?'active':'invisible pointer-events-none'}`}
      regions={{
        header: <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-medium tracking-tight lg:text-4xl">{t('study.title')}</h1>
        <button id="study-preferences-button" className={`${studyButton} border border-border-subtle bg-surface-panel hover:bg-surface-selected`} onClick={()=>props.onOpenPreferences ? props.onOpenPreferences() : props.onTabChange('b')}><SlidersHorizontal size={17}/>{t('study.preferences')}</button>
        </div>,
        primary: <>
      {props.status}
      <div className="sensa-study-overview grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col rounded-overlay bg-surface-subtle p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm text-fg-secondary"><BookOpen size={18}/>{t('study.scope')}</div>
          <h2 className="mt-5 text-3xl font-medium tracking-tight">{props.learningTargetCount?t('study.count',{count:props.learningTargetCount}):t('study.empty')}</h2>
          <p className="mt-2 text-xs text-fg-tertiary">{t('study.currentLanguage',{language:props.languageLabel})}</p>
          {!props.learningTargetCount&&<p className="mt-3 text-sm text-fg-secondary">{t('study.emptyHint')}</p>}
          <dl className="my-7 grid grid-cols-2 divide-x divide-border-subtle">
            {([['ready',props.readyInitialCount],['review',props.reviewCount]] as const).map(([key,value])=><div key={key} className="last:pl-6"><dt className="text-sm text-fg-secondary">{t('study.'+key)}</dt><dd className="mt-2 text-2xl tabular-nums">{value.toLocaleString(i18n.language)}</dd></div>)}
          </dl>
          <div className="mt-auto flex flex-wrap gap-2">
            {props.learningTargetCount>0&&<button className={`${studyButton} bg-action-primary text-action-on-primary hover:bg-action-primary-hover`} onClick={props.onOpenTargetLibrary}>{t('study.browse')}<ArrowRight size={16}/></button>}
            <button className={`${studyButton} border border-border-strong hover:bg-surface-panel`} onClick={props.onAddLearning}><Plus size={16}/>{t('study.add')}</button>
          </div>
        </section>
        <section className="rounded-overlay border border-border-subtle bg-surface-panel p-6 sm:p-8">
          <h2 className="text-lg font-medium">{t('study.plan')}</h2>
          <button className="mt-7 block w-full rounded-control text-left focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>props.onOpenPreferences ? props.onOpenPreferences() : props.onTabChange('b')}>
            <span className="text-sm text-fg-secondary">{t('study.daily')}</span><span className="mt-2 flex items-center justify-between gap-3 text-2xl">{t('study.count',{count:props.dailyNewCount})}<ArrowRight size={18}/></span>
          </button>
          <p className="mt-3 text-xs leading-6 text-fg-tertiary">{t('study.dailyNote')}</p>
          <div className="mt-7 border-t border-border-subtle pt-6"><p className="text-sm text-fg-secondary">{t('study.method')}</p><p className="mt-2 font-medium">{props.policySummary??t('learningPreferences.policies.'+props.defaultPolicy)}</p></div>
        </section>
      </div>
      {props.calendar ?? <StudyCalendar/>}
      <section className="mt-12" aria-labelledby="study-history-title">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><h2 id="study-history-title" className="text-xl font-medium">{t('study.history')}</h2><button type="button" className={studyButton+' text-action-primary hover:bg-accent-soft'} onClick={props.onOpenStats}>{t('statistics.title')}<ArrowRight size={16}/></button></div>
          <div className="flex flex-wrap gap-1" aria-label={t('study.history')}>
            {(['all','initial_learning','retention_review','relearning'] as const).map(kind=><button key={kind} aria-pressed={filter===kind} className={`${studyButton} ${filter===kind?'bg-surface-selected text-action-primary':'text-fg-secondary hover:bg-surface-subtle'}`} onClick={()=>{setFilter(kind);setLimit(10);}}>{t('study.'+kind)}</button>)}
          </div>
        </div>
        <p className="mt-3 text-xs leading-6 text-fg-tertiary">{t('study.historyNote')}</p>
        {records.length===0?<div className="py-16 text-center"><p className="font-medium">{t(props.learningRecords.length?'study.noMatches':'study.noRecords')}</p>{!props.learningRecords.length&&<p className="mt-2 text-sm text-fg-tertiary">{t('study.noRecordsHint')}</p>}</div>:<ol className="mt-5 divide-y divide-border-subtle">
          {records.slice(0,limit).map(record=><li key={record.recordId}><button className="flex w-full flex-wrap items-center gap-4 rounded-control py-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus sm:flex-nowrap" onClick={()=>props.onOpenTarget(record.targetId)}>
            <span className="min-w-0 flex-1"><strong className="font-medium">{record.expression}</strong><span className="mt-1 block text-sm text-fg-secondary">{record.meaning ?? record.detail}</span></span>
            <span className="rounded-control bg-accent-soft px-2 py-1 text-xs text-fg-secondary">{t('study.'+record.kind)}</span>
            <time className="w-full text-xs tabular-nums text-fg-tertiary sm:w-auto" dateTime={record.occurredAt}>{new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt))}</time><ArrowRight className="hidden shrink-0 text-fg-tertiary sm:block" size={16}/>
          </button></li>)}
        </ol>}
        {records.length>limit&&<button className={`${studyButton} mt-4 border border-border-subtle`} onClick={()=>setLimit(value=>value+10)}>{t('study.more')}</button>}
      </section>
        </>,
      }}
    />
    {props.active&&props.tab==='b'&&<LearningPreferencesPanel policyOptions={props.policyOptions} fixedPolicy={props.fixedPolicy} defaultPolicy={props.defaultPolicy} dailyNewCount={props.dailyNewCount} onPolicyChange={props.onPolicyChange} onDailyNewCountChange={props.onDailyNewCountChange} onClose={closePreferences} closeLabel={t('study.done')}/>}
  </>;
};
