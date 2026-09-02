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
  <button className="semantic-list-row" onClick={onOpen}>
    <span className={`semantic-status-dot status-${entry.status}`} />
    <span className="semantic-list-copy">
      <span><b>{entry.expression.formL2}</b><em>{entry.expression.partOfSpeech}</em></span>
      <small>{entry.ground.labelL1}</small>
    </span>
    <span className={`semantic-status-pill status-${entry.status}`}>
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
    <section className={`screen semantic-world-screen${active ? ' active' : ''}`} id="s-semantic-world" data-anim="slide">
      <header className="content-nav semantic-nav">
        <button className="content-nav-back" onClick={onBack} aria-label="返回我的内容">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>我的词义世界</h1>
        <button className="semantic-info" aria-label="关于词义世界" title="这是学习事实的个人投影">i</button>
      </header>

      <div className="content-page-body semantic-body">
        <section className="semantic-overview">
          <span className="semantic-eyebrow">PERSONAL SENSE PROJECTION</span>
          <h2>{projection.semanticSenses.length > 0 ? '你正在形成自己的词义连接' : '从第一个意思开始形成连接'}</h2>
          <p>只呈现当前内容范围内的学习事实，不是能力评分，也不代表对整个语言的掌握。</p>

          <div className="semantic-facts">
            {statusOrder.map((status) => (
              <div key={status}>
                <b>{counts[status]}</b>
                <span>{semanticStatusLabel[status]}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="semantic-view-switch" role="tablist" aria-label="词义世界视图">
          <button className={view === 'field' ? 'on' : ''} onClick={() => setView('field')} role="tab" aria-selected={view === 'field'}>
            状态视图
          </button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} role="tab" aria-selected={view === 'list'}>
            列表视图
          </button>
        </div>

        {projection.semanticSenses.length === 0 ? (
          <div className="semantic-empty-field">
            <span className="semantic-orbit" aria-hidden="true"><i /><i /><i /></span>
            <h3>这里会慢慢长出你的词义世界</h3>
            <p>完成具体意思的学习后，系统会按事实显示它正在形成、已经建立或需要巩固。</p>
          </div>
        ) : view === 'field' ? (
          <>
            <div className="semantic-field" aria-label="已学意思状态分布">
              <span className="semantic-field-glow glow-one" />
              <span className="semantic-field-glow glow-two" />
              <svg className="semantic-links" viewBox="0 0 100 100" aria-hidden="true">
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
                    className={`semantic-node status-${entry.status}`}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    onClick={() => onOpenSense(entry.senseId)}
                    aria-label={`${entry.expression.formL2}，${entry.ground.labelL1}，${semanticStatusLabel[entry.status]}`}
                  >
                    <span>{entry.expression.formL2}</span>
                    <small>{entry.expression.partOfSpeech}</small>
                  </button>
                );
              })}
            </div>
            <p className="semantic-field-note">节点位置仅用于呈现个人学习状态，不表示语言学距离或统一概念关系。</p>
          </>
        ) : (
          <div className="semantic-list-card">
            {statusOrder.map((status) => {
              const entries = projection.semanticSenses.filter((entry) => entry.status === status);
              if (entries.length === 0) return null;
              return (
                <div className="semantic-list-group" key={status}>
                  <h3>{semanticStatusLabel[status]}<span>{entries.length}</span></h3>
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
  props.presentation === 'baseline'
    ? <BaselineSemanticWorldScreen {...props} />
    : <SensaSemanticWorldScreen {...props} />
);
