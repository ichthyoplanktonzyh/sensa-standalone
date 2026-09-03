import {
  PROTOTYPE_LEARNING_TARGETS,
  policyLabel,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningTargetId,
} from '../../learningJourney/prototypeLearning';

interface LearningTargetLibraryScreenProps {
  active: boolean;
  targetIds: readonly PrototypeLearningTargetId[];
  /** 生效方式与准备状态由 journeyState 算好传入——优先级规则只应有一份。 */
  policyByTarget: Readonly<Record<PrototypeLearningTargetId, PrototypeLearningPolicy>>;
  preparationByTarget: Readonly<Record<PrototypeLearningTargetId, PrototypeLearningReadiness>>;
  committedTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  completedTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  reviewDueTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  relearningTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  reviewingTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  relearningRepairTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  relearningRetestTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  declaredMasteryTargetIds: ReadonlySet<PrototypeLearningTargetId>;
  onBack: () => void;
  onAddLearning: () => void;
  onOpenTarget: (targetId: PrototypeLearningTargetId) => void;
}

const readinessLabel = {
  ready: '可以开始',
  preparing: '正在准备',
  blocked: '需要处理',
} as const;

export const LearningTargetLibraryScreen = ({
  active,
  targetIds,
  policyByTarget,
  preparationByTarget,
  committedTargetIds,
  completedTargetIds,
  reviewDueTargetIds,
  relearningTargetIds,
  reviewingTargetIds,
  relearningRepairTargetIds,
  relearningRetestTargetIds,
  declaredMasteryTargetIds,
  onBack,
  onAddLearning,
  onOpenTarget,
}: LearningTargetLibraryScreenProps) => (
  <section
    className={`screen learning-surface${active ? ' active' : ''}`}
    id="s-learning-library"
    data-anim="slide"
  >
    <header className="learning-page-nav learning-library-nav">
      <button type="button" onClick={onBack} aria-label="返回我的学习">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <div>
        <small>我的学习</small>
        <h1>学习内容</h1>
      </div>
      <button type="button" className="learning-library-add" onClick={onAddLearning} aria-label="添加学习内容">
        <span aria-hidden="true">+</span>
      </button>
    </header>

    <main className="learning-page-body learning-library-body">
      <div className="learning-library-count">
        <strong>{targetIds.length}</strong>
        <span>个学习目标</span>
      </div>

      <div className="learning-library-list" aria-label="学习目标列表">
        {targetIds.map((targetId) => {
          const target = PROTOTYPE_LEARNING_TARGETS[targetId];
          const selectedPolicy = policyByTarget[targetId];
          const readiness = preparationByTarget[targetId];
          const isCommitted = committedTargetIds.has(targetId);
          const isCompleted = completedTargetIds.has(targetId);
          const isReviewDue = reviewDueTargetIds.has(targetId);
          const isRelearning = relearningTargetIds.has(targetId);
          const isReviewing = reviewingTargetIds.has(targetId);
          const isRelearningRepair = relearningRepairTargetIds.has(targetId);
          const isRelearningRetest = relearningRetestTargetIds.has(targetId);
          const isDeclaredMastery = declaredMasteryTargetIds.has(targetId);
          const state = isDeclaredMastery
            ? 'declared'
            : isRelearningRetest
              ? 'relearning-retest'
              : isRelearningRepair
                ? 'relearning-repair'
                : isReviewing
                  ? 'reviewing'
                  : isRelearning
                    ? 'relearning'
                    : isReviewDue
                      ? 'review-due'
                      : isCompleted
                        ? 'completed'
                        : isCommitted
                          ? 'committed'
                          : readiness;
          const stateLabel = isDeclaredMastery
            ? '已声明掌握'
            : isRelearningRetest
              ? '等待独立重测 · 已锁定'
              : isRelearningRepair
                ? '重学修复中 · 已锁定'
                : isReviewing
                  ? '复习中 · 已锁定'
                  : isRelearning
                    ? '需要修复 · 已锁定'
                    : isReviewDue
                      ? '待复习 · 已锁定'
                      : isCompleted
                        ? '保持中 · 已锁定'
                        : isCommitted
                          ? '学习中 · 已锁定'
                          : readinessLabel[readiness];

          return (
            <button type="button" key={targetId} onClick={() => onOpenTarget(targetId)}>
              <span
                className={`my-learning-readiness-dot is-${state}`}
                aria-hidden="true"
              />
              <span className="learning-library-target-copy">
                <span>
                  <strong>{target.expression}</strong>
                  <em>{policyLabel(selectedPolicy)}</em>
                </span>
                <small>{target.meaning}</small>
                <span className={`my-learning-target-state is-${state}`}>
                  {stateLabel}
                </span>
              </span>
              <span className="my-learning-target-arrow" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </main>
  </section>
);
