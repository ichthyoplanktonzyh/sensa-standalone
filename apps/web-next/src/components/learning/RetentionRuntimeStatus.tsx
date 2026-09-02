import type { RetentionRuntimeTargetStatus } from '../../engine/ReviewQueue';

export interface RetentionRuntimeStatusView {
  targetLabel: string;
  targetMeaning: string;
  targetPosition: number;
  targetCount: number;
  completedCount: number;
  actionLabel: string;
  status: RetentionRuntimeTargetStatus;
}

interface RetentionRuntimeStatusProps {
  value: RetentionRuntimeStatusView;
}

const statusLabel: Record<RetentionRuntimeTargetStatus, string> = {
  review_pending: '等待复习',
  reviewing: '到期复习',
  relearning_repair: '重学 · 定向修复',
  relearning_retest: '重学 · 独立重测',
  retaining: '返回保持',
  declared_mastery: 'Declared Mastery',
};

export const RetentionRuntimeStatus = ({ value }: RetentionRuntimeStatusProps) => (
  <aside className="retention-runtime-status" aria-label="高保证长期学习进度">
    <div>
      <span>
        <small>高保证长期学习 · {statusLabel[value.status]}</small>
        <strong>{value.targetLabel}</strong>
      </span>
      <em>{value.targetPosition}/{value.targetCount}</em>
    </div>
    <p>{value.actionLabel} · {value.targetMeaning}</p>
    <footer>
      <span>{value.status === 'relearning_repair'
        ? '本次遗忘已经结算，只恢复失败的连接'
        : value.status === 'relearning_retest'
          ? '本步只验证连接是否恢复，不再更新 FSRS'
          : '本次 due Review 只会产生一个 Memory Outcome'}</span>
      {value.targetCount > 1 && <small>{value.completedCount}/{value.targetCount} 已返回保持</small>}
    </footer>
  </aside>
);
