import {
  policyLabel,
  readinessForPolicy,
  readinessTone,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningTargetView,
} from '../../learningJourney/prototypeLearning';
import type { RetentionRuntimeTargetStatus } from '../../engine/ReviewQueue';
import type { InitialLearningCompletionKind } from '../../learningRuntime/orchestrations';

interface LearningTargetDetailScreenProps {
  active: boolean;
  target: PrototypeLearningTargetView;
  selectedPolicy: PrototypeLearningPolicy;
  preparation: PrototypeLearningReadiness;
  committedPolicy: PrototypeLearningPolicy | null;
  initialCompletionKind: InitialLearningCompletionKind | null;
  reviewDue: boolean;
  relearning: boolean;
  retentionRuntimeState: RetentionRuntimeTargetStatus | null;
  nextReviewLabel: string | null;
  declaredMastery: boolean;
  isAdded: boolean;
  onBack: () => void;
  onAdd: () => void;
  onOpenPolicy: () => void;
  onOpenSource: () => void;
  onRefreshPreparation: () => void;
  onGoHome: () => void;
  onStartReview: () => void;
  onContinueRetentionRuntime: () => void;
  onContinueRuntime: () => void;
  onRevokeDeclaredMastery: () => void;
}

const sourceKindLabel: Record<PrototypeLearningTargetView['sourceKind'], string> = {
  book: '词书',
  direct: '直接加入',
  personal_semantic_world: '我的词义世界',
};

export const LearningTargetDetailScreen = ({
  active,
  target,
  selectedPolicy,
  preparation,
  committedPolicy,
  initialCompletionKind,
  reviewDue,
  relearning,
  retentionRuntimeState,
  nextReviewLabel,
  declaredMastery,
  isAdded,
  onBack,
  onAdd,
  onOpenPolicy,
  onOpenSource,
  onRefreshPreparation,
  onGoHome,
  onStartReview,
  onContinueRetentionRuntime,
  onContinueRuntime,
  onRevokeDeclaredMastery,
}: LearningTargetDetailScreenProps) => {
  const configuredReadiness = readinessForPolicy(target, selectedPolicy);
  const readiness = preparation === configuredReadiness.status
    ? configuredReadiness
    : preparation === 'ready'
      ? {
          status: preparation,
          label: '内容已准备好',
          detail: '当前学习方式需要的内容已经生成并完成校验。',
        }
      : configuredReadiness;
  const tone = readinessTone(preparation);
  const effectiveReady = tone === 'ready';
  const isCommitted = committedPolicy !== null;
  const initialLearningCompleted = initialCompletionKind !== null;
  const isStructuredGraduation = initialCompletionKind === 'acquisition_graduation';
  const isActiveRetentionRuntime = retentionRuntimeState === 'reviewing'
    || retentionRuntimeState === 'relearning_repair'
    || retentionRuntimeState === 'relearning_retest';
  const retentionRuntimeHeading = retentionRuntimeState === 'reviewing'
    ? '复习中 · 本次到期检验'
    : retentionRuntimeState === 'relearning_repair'
      ? '重学中 · 定向修复'
      : retentionRuntimeState === 'relearning_retest'
        ? '重学中 · 等待独立重测'
        : null;

  return (
    <section
      className={`screen learning-surface${active ? ' active' : ''}`}
      id="s-learning-target"
      data-anim="slide"
    >
      <header className="learning-page-nav">
        <button type="button" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div>
          <small>学习目标</small>
          <h1>{declaredMastery
            ? '已声明掌握'
            : retentionRuntimeHeading
              ? retentionRuntimeHeading
              : initialLearningCompleted
                ? isStructuredGraduation ? '高保证首次学习已完成' : '首次学习已完成'
                : isCommitted ? '学习方式已锁定' : isAdded ? '已加入学习' : '加入前确认'}</h1>
        </div>
      </header>

      <main className="learning-page-body learning-target-body">
        <section className="learning-target-hero">
          <span>{target.expressionTypeLabel} · {target.partOfSpeech}</span>
          <h2>{target.expression}</h2>
          <p>{target.meaning}</p>
          <blockquote>{target.example}</blockquote>
        </section>

        <section className="learning-target-facts" aria-label="学习目标信息">
          <button type="button" onClick={onOpenSource}>
            <span>
              <small>学习来源 · {sourceKindLabel[target.sourceKind]}</small>
              <strong>{target.sourceLabel}</strong>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          {isCommitted ? (
            <div className="learning-target-fact is-locked">
              <span>
                <small>学习方式 · 首次运行时锁定</small>
                <strong>{policyLabel(committedPolicy)}</strong>
              </span>
              <em>已锁定</em>
            </div>
          ) : (
            <button type="button" onClick={onOpenPolicy}>
              <span>
                <small>学习方式</small>
                <strong>{policyLabel(selectedPolicy)}</strong>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          )}
        </section>

        <section className={`learning-readiness-card is-${isCommitted ? 'committed' : tone}`}>
          <div className="learning-readiness-heading">
            <span className="learning-readiness-mark" aria-hidden="true">
              {isCommitted || tone === 'ready' ? '✓' : tone === 'preparing' ? '…' : '!'}
            </span>
            <div>
              <small>{declaredMastery ? '计划资格' : initialLearningCompleted ? '学习阶段' : isCommitted ? 'Runtime 状态' : '内容准备状态'}</small>
              <h2>{declaredMastery
                ? '已从正式学习计划排除'
                : initialLearningCompleted
                ? retentionRuntimeHeading ?? (relearning
                  ? '重学中 · 连接待恢复'
                  : reviewDue ? '保持中 · 今天需要复习' : `保持中 · ${nextReviewLabel ?? '等待下次复习'}`)
                : isCommitted ? '已进入学习 Runtime' : readiness.label}</h2>
            </div>
          </div>
          <p>{declaredMastery
            ? 'Declared Mastery 是可撤销的学习者声明，不会伪造 Gate 通过、Graduation 或长期记忆结果。'
            : isActiveRetentionRuntime
              ? retentionRuntimeState === 'reviewing'
                ? '当前正在完成一次到期检验；本轮只会产生一个 Memory Outcome。'
                : retentionRuntimeState === 'relearning_repair'
                  ? '遗忘事实已经结算，当前只恢复失败的经验—意思—表达连接。'
                  : '修复已经结束，当前等待独立验证连接是否恢复。'
              : initialLearningCompleted
                ? isStructuredGraduation
                  ? 'Required Gates 已全部通过，并已通过 Graduation 交给长期复习保持。'
                  : '经验落地和首次主动回想已经完成，之后由长期复习继续保持这条连接。'
                : isCommitted
                  ? '首次正式运行已经创建，学习方式不会再从这里改写。'
                  : readiness.detail}</p>
          <ol>
            <li className="is-done"><span>1</span>稳定意思与目标表达</li>
            <li className={tone === 'ready' || isCommitted ? 'is-done' : ''}><span>2</span>完成内容准备与校验</li>
            <li className={isCommitted ? 'is-done' : ''}><span>3</span>创建首次正式运行并锁定方式</li>
          </ol>
        </section>

        <div className="learning-target-actions">
          {!isAdded ? (
            <button type="button" className="is-primary" onClick={onAdd}>加入学习</button>
          ) : declaredMastery ? (
            <button type="button" className="is-primary" onClick={onRevokeDeclaredMastery}>恢复学习</button>
          ) : isActiveRetentionRuntime ? (
            <button type="button" className="is-primary" onClick={onContinueRetentionRuntime}>
              {retentionRuntimeState === 'reviewing' ? '继续复习' : '继续重学'}
            </button>
          ) : initialLearningCompleted ? (
            reviewDue
              ? <button type="button" className="is-primary" onClick={onStartReview}>{relearning ? '继续修复' : '开始复习'}</button>
              : <button type="button" className="is-primary" onClick={onGoHome}>回到首页</button>
          ) : isCommitted ? (
            <button type="button" className="is-primary" onClick={onContinueRuntime}>继续学习</button>
          ) : effectiveReady ? (
            <button type="button" className="is-primary" onClick={onGoHome}>回到首页开始学习</button>
          ) : tone === 'preparing' ? (
            <button type="button" className="is-primary" onClick={onRefreshPreparation}>更新准备状态</button>
          ) : (
            <button type="button" className="is-primary" onClick={onOpenPolicy}>更换学习方式</button>
          )}
          <small>
            {!isAdded
              ? '加入后才会按所选方式准备内容。'
              : declaredMastery
                ? '撤销后会依据未被改写的学习阶段、Gate 和长期记忆状态恢复计划资格。'
              : initialLearningCompleted
                ? isActiveRetentionRuntime
                  ? retentionRuntimeState === 'reviewing'
                    ? '本次到期检验已经开始，继续完成后只结算一个 Memory Outcome。'
                    : retentionRuntimeState === 'relearning_repair'
                      ? '本次遗忘已经结算，现在只修复失败的经验—意思—表达连接。'
                      : '修复已经完成，下一次独立重测不会再次更新 FSRS。'
                  : reviewDue
                  ? relearning
                    ? '本次遗忘已经记录，继续完成经验—意思—表达的重新连接。'
                    : '这条目标已经到期，将从意思和经验线索独立取回表达。'
                  : `首次学习已经结束，下次复习安排在${nextReviewLabel ?? '稍后'}。`
              : isCommitted
                ? `${policyLabel(committedPolicy)} 已成为这条目标的正式学习方式。`
              : effectiveReady
                ? '它已经可以进入今日新学计划。'
                : tone === 'preparing'
                  ? '准备完成前不会进入今日新学。'
                  : '当前方式缺少必要内容，系统不会自动降级。'}
          </small>
        </div>
      </main>
    </section>
  );
};
