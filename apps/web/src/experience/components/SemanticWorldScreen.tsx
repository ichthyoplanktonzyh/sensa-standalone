import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
import { useMemo, useState } from 'react';
import {
  semanticStatusLabel,
  type SemanticSenseItem,
  type SemanticStatus,
} from '../contentProjection';
import { useContentProjection } from '../useContentProjection';
import { SensaSemanticWorldScreen } from './SensaSemanticWorldScreen';

export type SemanticWorldPresentation = 'sensa' | 'baseline';

export interface SemanticWorldScreenProps {
  active: boolean;
  initialAction?: 'create';
  onBack: () => void;
  onOpenSense: (senseId: string) => void;
  /** Open a Personal Meaning's clarification journey by its canonical id. */
  onOpenPersonalMeaning: (personalMeaningId: string, meaningFocusId?: string) => void;
  /** Open the exact confirmed Sense projection for one Meaning Focus. */
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
  /** Surface journey command feedback through the app-level toast. */
  toast: (message: string) => void;
  presentation?: SemanticWorldPresentation;
}

type SemanticView = 'field' | 'list';

const statusOrder: SemanticStatus[] = ['established', 'forming', 'reinforce'];

const nodePositions = [
  [17, 23], [49, 18], [78, 28], [31, 48], [64, 50], [17, 72], [48, 76], [79, 70],
];

const SemanticListRow = ({ entry, onOpen }: { entry: SemanticSenseItem; onOpen: () => void }) => (
  <button className="grid min-h-16 w-full grid-cols-[0.75rem_1fr_auto] items-center gap-3 border-0 bg-transparent p-4 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus [&+button]:border-t [&+button]:border-border-subtle" onClick={onOpen}>
    <span className={`size-2.5 rounded-full ${entry.status === 'established' ? 'bg-feedback-success' : entry.status === 'reinforce' ? 'bg-feedback-warning' : 'bg-progress'}`} aria-hidden="true" />
    <span className="flex min-w-0 flex-col gap-1">
      <span><b className="font-language text-body">{entry.expression.formL2}</b><em className="ml-2 text-metadata not-italic text-fg-tertiary">{entry.expression.partOfSpeech}</em></span>
      <small className="truncate text-body-support text-fg-secondary">{entry.ground.labelL1}</small>
    </span>
    <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">
      {semanticStatusLabel[entry.status]}
    </span>
  </button>
);

const BaselineSemanticWorldScreen = ({ active, onBack, onOpenSense }: SemanticWorldScreenProps) => {
  const projection = useContentProjection();
  const [view, setView] = useState<SemanticView>('field');

  const counts = useMemo(() => {
    const result: Record<SemanticStatus, number> = { forming: 0, established: 0, reinforce: 0 };
    projection.semanticSenses.forEach((entry) => {
      result[entry.status] += 1;
    });
    return result;
  }, [projection.semanticSenses]);

  return (
    <section className={slideScreenClass(active)} id="s-semantic-world" data-anim="slide" aria-hidden={!active}>
      <header className={contentNavigationClass}>
        <button className={contentNavigationBackClass} onClick={onBack} aria-label="返回我的语义世界">
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>我的语义世界</h1>
        <button className="grid size-11 place-items-center justify-self-end rounded-control border-0 bg-transparent text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" aria-label="关于语义世界" title="这是学习事实的个人投影">i</button>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 py-8 pb-12 sm:px-10">
        <section className="rounded-card border border-border-subtle bg-surface-panel p-6 shadow-raised">
          <span className="text-metadata font-bold uppercase tracking-[0.14em] text-fg-tertiary">PERSONAL SENSE PROJECTION</span>
          <h2 className="mt-3 text-page-title font-semibold">{projection.semanticSenses.length > 0 ? '你正在形成自己的词义连接' : '从第一个意思开始形成连接'}</h2>
          <p className="mt-3 max-w-2xl text-body-support leading-7 text-fg-secondary">只呈现当前内容范围内的学习事实，不是能力评分，也不代表对整个语言的掌握。</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {statusOrder.map((status) => (
              <div className="rounded-control bg-surface-subtle p-4" key={status}>
                <b className="block text-2xl font-semibold">{counts[status]}</b>
                <span className="mt-1 block text-metadata text-fg-tertiary">{semanticStatusLabel[status]}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 grid grid-cols-2 rounded-control bg-surface-subtle p-1" role="tablist" aria-label="语义世界视图">
          <button className={`min-h-11 rounded-control border-0 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${view === 'field' ? 'bg-surface-panel text-action-primary shadow-raised' : 'bg-transparent text-fg-secondary'}`} onClick={() => setView('field')} role="tab" aria-selected={view === 'field'}>
            状态视图
          </button>
          <button className={`min-h-11 rounded-control border-0 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${view === 'list' ? 'bg-surface-panel text-action-primary shadow-raised' : 'bg-transparent text-fg-secondary'}`} onClick={() => setView('list')} role="tab" aria-selected={view === 'list'}>
            列表视图
          </button>
        </div>

        {projection.semanticSenses.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center text-center">
            <span className="relative mb-6 grid size-24 place-items-center rounded-full border border-border-strong bg-accent-soft" aria-hidden="true"><i className="size-3 rounded-full bg-action-primary" /><i className="absolute left-4 top-7 size-2 rounded-full bg-progress" /><i className="absolute bottom-6 right-5 size-2 rounded-full bg-decorative" /></span>
            <h3 className="text-section-title font-semibold">这里会慢慢长出你的语义世界</h3>
            <p className="mt-3 max-w-md text-body-support leading-6 text-fg-secondary">完成具体意思的学习后，系统会按事实显示它正在形成、已经建立或需要巩固。</p>
          </div>
        ) : view === 'field' ? (
          <>
            <div className="relative mt-6 min-h-[28rem] overflow-hidden rounded-overlay border border-border-subtle bg-surface-subtle" aria-label="已学意思状态分布">
              <span className="absolute -left-20 top-10 size-64 rounded-full bg-accent-soft blur-3xl" />
              <span className="absolute -right-20 bottom-6 size-64 rounded-full bg-surface-selected blur-3xl" />
              <svg className="absolute inset-0 size-full stroke-border-strong stroke-[0.35]" viewBox="0 0 100 100" aria-hidden="true">
                {projection.semanticSenses.slice(1, 8).map((_, index) => {
                  const [x1, y1] = nodePositions[index];
                  const [x2, y2] = nodePositions[index + 1];
                  return <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
                })}
              </svg>
              {projection.semanticSenses.slice(0, 8).map((entry, index) => {
                const [left, top] = nodePositions[index];
                return (
                  <button
                    key={entry.senseId}
                    className={`absolute grid max-w-32 -translate-x-1/2 -translate-y-1/2 place-items-center gap-1 rounded-card border bg-surface-panel px-3 py-2 text-center shadow-raised focus-visible:outline-2 focus-visible:outline-focus ${entry.status === 'established' ? 'border-feedback-success' : entry.status === 'reinforce' ? 'border-feedback-warning' : 'border-border-strong'}`}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    onClick={() => onOpenSense(entry.senseId)}
                    aria-label={`${entry.expression.formL2}，${entry.ground.labelL1}，${semanticStatusLabel[entry.status]}`}
                  >
                    <span className="font-language text-body font-semibold">{entry.expression.formL2}</span>
                    <small className="text-metadata text-fg-secondary">{entry.expression.partOfSpeech}</small>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-center text-metadata leading-5 text-fg-tertiary">节点位置仅用于呈现个人学习状态，不表示语言学距离或统一概念关系。</p>
          </>
        ) : (
          <div className="mt-6 overflow-hidden rounded-card border border-border-subtle bg-surface-panel">
            {statusOrder.map((status) => {
              const entries = projection.semanticSenses.filter((entry) => entry.status === status);
              if (entries.length === 0) return null;
              return (
                <div className="[&+div]:border-t [&+div]:border-border-subtle" key={status}>
                  <h3 className="flex items-center justify-between bg-surface-subtle px-4 py-3 text-control-label font-semibold">{semanticStatusLabel[status]}<span className="rounded-pill bg-accent-soft px-2 py-1 text-metadata text-fg-secondary">{entries.length}</span></h3>
                  {entries.map((entry) => (
                    <SemanticListRow
                      key={entry.senseId}
                      entry={entry}
                      onOpen={() => onOpenSense(entry.senseId)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export const SemanticWorldScreen = (props: SemanticWorldScreenProps) => (
  props.presentation === 'baseline' && props.initialAction !== 'create'
    ? <BaselineSemanticWorldScreen {...props} />
    : <SensaSemanticWorldScreen {...props} />
);
