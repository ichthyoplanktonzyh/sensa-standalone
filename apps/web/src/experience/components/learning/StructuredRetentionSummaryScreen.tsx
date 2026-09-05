import { uiClass } from '../../ui/classes';
import {
  PROTOTYPE_LEARNING_TARGETS,
  type PrototypeLearningTargetId,
} from '../../learningJourney/prototypeLearning';

interface StructuredRetentionSummaryScreenProps {
  active: boolean;
  retainingTargetIds: readonly PrototypeLearningTargetId[];
  relearningCompletedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
}

const TargetRows = ({
  targetIds,
  detail,
}: {
  targetIds: readonly PrototypeLearningTargetId[];
  detail: string;
}) => targetIds.map((targetId) => (
  <div key={targetId}>
    <strong>{PROTOTYPE_LEARNING_TARGETS[targetId].expression}</strong>
    <span>{detail}</span>
  </div>
));

export const StructuredRetentionSummaryScreen = ({
  active,
  retainingTargetIds,
  relearningCompletedTargetIds,
  declaredMasteryTargetIds,
  onExit,
}: StructuredRetentionSummaryScreenProps) => (
  <section
    className={uiClass(`screen learning-surface structured-retention-summary${active ? ' active' : ''}`, "#s-structured-retention-summary")}
    id="s-structured-retention-summary"
    data-anim="fade"
  >
    <main>
      <span className={uiClass("structured-retention-summary-mark")} aria-hidden="true">✓</span>
      <small>高保证长期学习</small>
      <h1>已返回长期保持</h1>
      <p>本次到期复习已经结算；需要重学的 Target 也完成了独立恢复检验。</p>

      {retainingTargetIds.length > 0 && (
        <section className={uiClass("structured-retention-summary-group")}>
          <h2>保持中</h2>
          <TargetRows targetIds={retainingTargetIds} detail="已安排下次复习" />
        </section>
      )}

      {relearningCompletedTargetIds.length > 0 && (
        <section className={uiClass("structured-retention-summary-group is-relearned")}>
          <h2>重学完成</h2>
          <TargetRows targetIds={relearningCompletedTargetIds} detail="连接已恢复" />
        </section>
      )}

      {declaredMasteryTargetIds.length > 0 && (
        <section className={uiClass("structured-retention-summary-group is-declared")}>
          <h2>Declared Mastery</h2>
          <TargetRows targetIds={declaredMasteryTargetIds} detail="已从正式计划排除" />
          <small>该声明没有产生 Review Outcome，也没有修改长期记忆状态。</small>
        </section>
      )}

      <button type="button" onClick={onExit}>回到首页</button>
    </main>
  </section>
);
