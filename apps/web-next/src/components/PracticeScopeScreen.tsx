import { useEffect, useMemo, useState } from 'react';
import {
  CURRENT_STUDY_SCOPE_ID,
  PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  type PracticeScopeCatalog,
  type PracticeScopeSelection,
  type PracticeScopeTarget,
} from '../practiceScope';

export interface PracticeScopeScreenProps {
  active: boolean;
  catalog: PracticeScopeCatalog;
  onBack: () => void;
  onSelectScope: (selection: PracticeScopeSelection) => void;
}

type ScopeScreenView = 'targets' | 'sources' | 'personal_targets';

const expressionTypeLabel = (target: PracticeScopeTarget): string => {
  switch (target.expression.expressionType) {
    case 'word': return '单词';
    case 'phrase': return '短语';
    case 'construction': return '构式';
    case 'sentence': return '句子';
    case 'utterance_strategy': return '表达策略';
  }
};

const PracticeTargetCopy = ({ target }: { target: PracticeScopeTarget }) => (
  <span className="practice-scope-target-copy">
    <span className="practice-scope-target-expression">
      <strong>{target.expression.surfaceForm}</strong>
      <small>{expressionTypeLabel(target)}</small>
    </span>
    <span className="practice-scope-target-sense">{target.sense.label}</span>
    {target.context?.preview && (
      <span className="practice-scope-target-context">{target.context.preview}</span>
    )}
  </span>
);

export const PracticeScopeScreen = ({
  active,
  catalog,
  onBack,
  onSelectScope,
}: PracticeScopeScreenProps) => {
  const [view, setView] = useState<ScopeScreenView>('targets');
  const selectedPersonalIds = useMemo(
    () => catalog.selection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
      ? catalog.selection.targetIds
      : [],
    [catalog.selection],
  );
  const [draftTargetIds, setDraftTargetIds] = useState<readonly string[]>(selectedPersonalIds);
  const personalSource = catalog.sources.find(
    (source) => source.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  );

  useEffect(() => {
    if (!active) return;
    setView('targets');
    setDraftTargetIds(selectedPersonalIds);
  }, [active, selectedPersonalIds]);

  const returnOrClose = () => {
    if (view === 'personal_targets') {
      setView('sources');
      return;
    }
    if (view === 'sources') {
      setView('targets');
      return;
    }
    onBack();
  };

  const selectCurrentStudy = () => {
    onSelectScope({ sourceId: CURRENT_STUDY_SCOPE_ID });
    setView('targets');
  };

  const openPersonalTargets = () => {
    if (!personalSource || personalSource.targets.length === 0) return;
    setDraftTargetIds(selectedPersonalIds);
    setView('personal_targets');
  };

  const togglePersonalTarget = (targetId: string) => {
    setDraftTargetIds((current) => current.includes(targetId)
      ? current.filter((candidate) => candidate !== targetId)
      : [...current, targetId]);
  };

  const commitPersonalScope = () => {
    if (draftTargetIds.length === 0) return;
    onSelectScope({
      sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
      targetIds: draftTargetIds,
    });
    setView('targets');
  };

  return (
    <section
      className={`screen practice-scope-screen${active ? ' active' : ''}`}
      id="s-practice-scope"
      data-anim="slide"
    >
      <header className="practice-scope-nav">
        <button type="button" onClick={returnOrClose} aria-label="返回">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{view === 'targets' ? '练习范围' : view === 'sources' ? '更换范围' : '我的词义世界'}</h1>
        {view === 'targets' ? (
          <button
            type="button"
            className="practice-scope-nav-change"
            onClick={() => setView('sources')}
          >
            更换
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </header>

      {view === 'targets' ? (
        <div className="practice-scope-body is-current">
          <div className="practice-scope-current-meta">
            <span className="practice-scope-current-copy">
              <span>{catalog.currentScope.sourceLabel}</span>
              {catalog.currentScope.title !== catalog.currentScope.sourceLabel && (
                <strong>{catalog.currentScope.title}</strong>
              )}
            </span>
            <small>{catalog.currentScope.targets.length} 个目标</small>
          </div>

          {catalog.currentScope.targets.length > 0 ? (
            <div className="practice-scope-target-list is-preview">
              {catalog.currentScope.targets.map((target) => (
                <div key={target.targetId} className="practice-scope-target is-preview">
                  <PracticeTargetCopy target={target} />
                </div>
              ))}
            </div>
          ) : (
            <div className="practice-scope-empty">当前范围没有可练目标</div>
          )}
        </div>
      ) : view === 'sources' ? (
        <div className="practice-scope-body">
          <div className="practice-scope-source-list">
            {catalog.sources.map((source) => {
              const isPersonal = source.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID;
              const disabled = source.targets.length === 0;
              return (
                <button
                  key={source.sourceId}
                  type="button"
                  className={`practice-scope-source${source.selected ? ' is-selected' : ''}`}
                  disabled={disabled}
                  onClick={isPersonal ? openPersonalTargets : selectCurrentStudy}
                  aria-label={`${source.title}，${source.targets.length} 个目标${source.selected ? '，当前选择' : ''}`}
                >
                  <span className={`practice-scope-source-icon is-${isPersonal ? 'personal' : 'study'}`}>
                    <svg className="icon"><use href={isPersonal ? '#i-bulb' : '#i-bookopen'} /></svg>
                  </span>
                  <span className="practice-scope-source-copy">
                    <strong>{source.title}</strong>
                    <span>{disabled ? '还没有可练目标' : source.subtitle}</span>
                  </span>
                  <span className="practice-scope-source-count">
                    {source.selected && isPersonal
                      ? `${source.selectedTargetCount}/${source.targets.length}`
                      : source.targets.length}
                  </span>
                  {source.selected ? (
                    <span className="practice-scope-source-check" aria-hidden="true">
                      <svg className="icon"><use href="#i-chk-simple" /></svg>
                    </span>
                  ) : (
                    <svg className="icon practice-scope-source-chevron" aria-hidden="true">
                      <use href="#i-chev-r" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="practice-scope-body is-targets">
            <div className="practice-scope-target-list">
              {personalSource?.targets.map((target) => {
                const selected = draftTargetIds.includes(target.targetId);
                return (
                  <button
                    key={target.targetId}
                    type="button"
                    className={`practice-scope-target${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => togglePersonalTarget(target.targetId)}
                  >
                    <PracticeTargetCopy target={target} />
                    <span className="practice-scope-target-check" aria-hidden="true">
                      {selected && <svg className="icon"><use href="#i-chk-simple" /></svg>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="practice-scope-footer">
            <button
              type="button"
              disabled={draftTargetIds.length === 0}
              onClick={commitPersonalScope}
            >
              使用 {draftTargetIds.length} 个目标
            </button>
          </footer>
        </>
      )}
    </section>
  );
};
