import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { studyButton } from '../StudyScreen';
import type {LearningPolicy,LearningReadiness} from '../../../learning/system';
import { SensaCollectionBrowserLayout } from '../../ui/SensaPageLayouts';
import { useScreenState } from '../../ui/ScreenHost';
import type {ReactNode} from 'react';

interface LearningTargetLibraryScreenProps {
  active: boolean;
  notice?:ReactNode;
  targets: Readonly<Record<string, {expression: string; meaning: string; sourceKind: string}>>;
  targetIds: readonly string[];
  /** Effective policy and readiness are projected from the persisted local Target. */
  policyByTarget: Readonly<Record<string, LearningPolicy>>;
  preparationByTarget: Readonly<Record<string, LearningReadiness>>;
  committedTargetIds: ReadonlySet<string>;
  completedTargetIds: ReadonlySet<string>;
  reviewDueTargetIds: ReadonlySet<string>;
  relearningTargetIds: ReadonlySet<string>;
  reviewingTargetIds: ReadonlySet<string>;
  relearningRepairTargetIds: ReadonlySet<string>;
  relearningRetestTargetIds: ReadonlySet<string>;
  declaredMasteryTargetIds: ReadonlySet<string>;
  onBack: () => void;
  onAddLearning: () => void;
  onOpenTarget: (targetId: string) => void;
}


type Filter = 'all' | 'new' | 'active' | 'review' | 'complete';
export const LearningTargetLibraryScreen = (props: LearningTargetLibraryScreenProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useScreenState('learning-library:query', '');
  const [filter, setFilter] = useScreenState<Filter>('learning-library:filter', 'all');
  const items = props.targetIds.map(id => {
    const state = props.declaredMasteryTargetIds.has(id) ? 'declared'
      : props.relearningRetestTargetIds.has(id) ? 'relearning-retest'
      : props.relearningRepairTargetIds.has(id) ? 'relearning-repair'
      : props.reviewingTargetIds.has(id) ? 'reviewing'
      : props.relearningTargetIds.has(id) ? 'relearning'
      : props.reviewDueTargetIds.has(id) ? 'review-due'
      : props.completedTargetIds.has(id) ? 'completed'
      : props.committedTargetIds.has(id) ? 'committed' : props.preparationByTarget[id];
    const group: Filter = ['declared', 'completed'].includes(state) ? 'complete'
      : ['review-due', 'relearning', 'relearning-repair', 'relearning-retest', 'reviewing'].includes(state) ? 'review'
      : state === 'committed' ? 'active' : 'new';
    const target=props.targets[id];
    if(!target)throw new Error(`Missing Learning Target presentation: ${id}`);
    return { id, target, state, group };
  });
  const visible = items.filter(item => (filter === 'all' || item.group === filter)
    && `${item.target.expression} ${item.target.meaning}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <SensaCollectionBrowserLayout
    id="s-learning-library"
    measure="wide"
    className={`screen z-20 ${props.active ? 'active' : 'invisible pointer-events-none'}`}
    regions={{
      header: <>
      {props.notice}
      <button className={`${studyButton} -ml-4 text-fg-secondary`} onClick={props.onBack}><ArrowLeft size={18}/>{t('study.back')}</button>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-3xl font-medium tracking-tight">{t('study.library')}</h1><p className="mt-3 text-sm text-fg-secondary">{t('study.count', { count: items.length })}</p></div>
        <button className={`${studyButton} bg-action-primary text-action-on-primary hover:bg-action-primary-hover`} onClick={props.onAddLearning}><Plus size={17}/>{t('study.add')}</button>
      </div>
      </>,
      controls: <div className="flex flex-wrap gap-3">
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4 focus-within:outline-2 focus-within:outline-focus"><Search size={18} className="shrink-0 text-fg-tertiary"/><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('study.search')} placeholder={t('study.search')} className="min-w-0 flex-1 bg-transparent py-3 text-sm text-fg-primary outline-none"/></label>
        <select aria-label={t('study.status')} value={filter} onChange={event => setFilter(event.target.value as Filter)} className="min-h-12 max-w-full rounded-control border border-border-subtle bg-surface-panel px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus">
          {(['all','new','active','review','complete'] as const).map(value => <option key={value} value={value}>{t('study.filters.' + value)}</option>)}
        </select>
      </div>,
      collection: <>
      <ul className="divide-y divide-border-subtle">
        {visible.map(({id, target, state}) => <li key={id}><button onClick={() => props.onOpenTarget(id)} className="flex w-full items-center gap-4 rounded-control py-6 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus">
          <span className="min-w-0 flex-1"><strong className="font-language text-xl font-medium">{target.expression}</strong><span className="mt-2 block text-sm text-fg-secondary">{target.meaning}</span><span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-tertiary"><span className="rounded-control bg-surface-selected px-2 py-1 text-action-primary">{t('study.states.' + state)}</span><span>{t('study.sources.' + target.sourceKind)}</span><span>{t('learningPreferences.policies.' + props.policyByTarget[id])}</span></span></span>
          <ArrowRight size={18} className="shrink-0 text-fg-tertiary"/>
        </button></li>)}
      </ul>
      {!visible.length && <p className="py-20 text-center text-sm text-fg-tertiary">{t(items.length ? 'study.noMatches' : 'study.empty')}</p>}
      </>,
    }}
  />;
};
