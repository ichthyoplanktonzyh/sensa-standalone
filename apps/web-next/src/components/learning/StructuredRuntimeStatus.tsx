export type StructuredGateStatus = 'unresolved' | 'passed' | 'failed';

export interface StructuredRuntimeGateView {
  id: string;
  label: string;
  status: StructuredGateStatus;
  repairing: boolean;
}

export interface StructuredRuntimeStatusView {
  targetLabel: string;
  targetMeaning: string;
  targetPosition: number;
  targetCount: number;
  graduatedCount: number;
  actionLabel: string;
  actionMode: 'teaching' | 'assessment' | 'repair';
  gates: readonly StructuredRuntimeGateView[];
}

interface StructuredRuntimeStatusProps {
  value: StructuredRuntimeStatusView;
}

const actionModeLabel: Record<StructuredRuntimeStatusView['actionMode'], string> = {
  teaching: '建立连接',
  assessment: '独立检验',
  repair: '定向修复',
};

const gateStateLabel = (gate: StructuredRuntimeGateView): string => {
  if (gate.repairing) return '修复中';
  if (gate.status === 'passed') return '已通过';
  if (gate.status === 'failed') return '待修复';
  return '待完成';
};

export const StructuredRuntimeStatus = ({ value }: StructuredRuntimeStatusProps) => (
  <aside className="structured-runtime-status" aria-label="高保证学习进度">
    <div className="structured-runtime-status-heading">
      <span>
        <small>高保证学习 · {actionModeLabel[value.actionMode]}</small>
        <strong>{value.targetLabel}</strong>
      </span>
      <em>{value.targetPosition}/{value.targetCount}</em>
    </div>
    <p>{value.actionLabel} · {value.targetMeaning}</p>
    <div className="structured-runtime-gates">
      {value.gates.map((gate) => (
        <span
          key={gate.id}
          className={`is-${gate.repairing ? 'repairing' : gate.status}`}
          title={gateStateLabel(gate)}
        >
          <i aria-hidden="true" />
          {gate.label}
        </span>
      ))}
    </div>
    {value.targetCount > 1 && (
      <small className="structured-runtime-session-progress">
        本次 Session 已有 {value.graduatedCount}/{value.targetCount} 个 Target 完成 Graduation
      </small>
    )}
  </aside>
);
