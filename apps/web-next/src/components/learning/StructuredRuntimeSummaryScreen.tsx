import {
  PROTOTYPE_LEARNING_TARGETS,
  type PrototypeLearningTargetId,
} from '../../learningJourney/prototypeLearning';

interface StructuredRuntimeSummaryScreenProps {
  active: boolean;
  graduatedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
}

export const StructuredRuntimeSummaryScreen = ({
  active,
  graduatedTargetIds,
  declaredMasteryTargetIds,
  onExit,
}: StructuredRuntimeSummaryScreenProps) => {
  const hasGraduation = graduatedTargetIds.length > 0;

  return (
    <section
      className={`screen learning-surface structured-runtime-summary${active ? ' active' : ''}`}
      id="s-structured-runtime-summary"
      data-anim="fade"
    >
      <main>
        <span className="structured-runtime-summary-mark" aria-hidden="true">
          {hasGraduation ? '✓' : '—'}
        </span>
        <small>高保证首次学习</small>
        <h1>{hasGraduation ? '已交给长期保持' : '本次学习已结束'}</h1>
        <p>
          {hasGraduation
            ? '完成 Graduation 的 Target 已进入 retaining，之后只会按长期复习安排再次出现。'
            : '本次没有产生 Acquisition Graduation。'}
        </p>

        {graduatedTargetIds.length > 0 && (
          <section className="structured-runtime-summary-group">
            <h2>进入保持</h2>
            {graduatedTargetIds.map((targetId) => {
              const target = PROTOTYPE_LEARNING_TARGETS[targetId];
              return (
                <div key={targetId}>
                  <strong>{target.expression}</strong>
                  <span>Required Gates 已通过</span>
                </div>
              );
            })}
          </section>
        )}

        {declaredMasteryTargetIds.length > 0 && (
          <section className="structured-runtime-summary-group is-declared">
            <h2>Declared Mastery</h2>
            {declaredMasteryTargetIds.map((targetId) => {
              const target = PROTOTYPE_LEARNING_TARGETS[targetId];
              return (
                <div key={targetId}>
                  <strong>{target.expression}</strong>
                  <span>已从正式学习计划排除</span>
                </div>
              );
            })}
            <small>这是一项可撤销的学习者声明，不代表 Gate 通过或 Graduation。</small>
          </section>
        )}

        <button type="button" onClick={onExit}>回到首页</button>
      </main>
    </section>
  );
};
