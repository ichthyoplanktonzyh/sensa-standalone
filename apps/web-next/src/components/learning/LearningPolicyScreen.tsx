import {
  isPolicyAvailableForTarget,
  policyLabel,
  type PrototypeLearningPolicy,
  type PrototypeLearningTargetView,
} from '../../learningJourney/prototypeLearning';

interface LearningPolicyScreenProps {
  active: boolean;
  target: PrototypeLearningTargetView | null;
  selectedPolicy: PrototypeLearningPolicy;
  onBack: () => void;
  onSelect: (policy: PrototypeLearningPolicy) => void;
}

export const LearningPolicyScreen = ({
  active,
  target,
  selectedPolicy,
  onBack,
  onSelect,
}: LearningPolicyScreenProps) => {
  const isTargetPolicy = target !== null;
  const highAssuranceAvailable = target
    ? isPolicyAvailableForTarget(target, 'high_assurance')
    : true;

  return (
    <section
      className={`screen learning-surface${active ? ' active' : ''}`}
      id="s-learning-policy"
      data-anim="slide"
    >
      <header className="learning-page-nav">
        <button type="button" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div>
          <small>{isTargetPolicy ? '这个意思' : '学习计划默认'}</small>
          <h1>选择学习方式</h1>
        </div>
      </header>

      <main className="learning-page-body learning-policy-body">
        {target && (
          <section className="learning-policy-target" aria-label="当前学习目标">
            <small>正在设置</small>
            <strong>{target.expression}</strong>
            <p>{target.meaning}</p>
          </section>
        )}

        <section className="learning-copy-intro is-compact">
          <span>学习方式 ≠ 学习内容</span>
          <h2>选择你希望怎样建立和保持这条连接</h2>
          <p>系统随后根据目标、内容和客户端能力判断当前是否可以开始，不会静默换成另一种方式。</p>
        </section>

        <div className="learning-policy-options" role="radiogroup" aria-label="学习方式">
          <button
            type="button"
            role="radio"
            aria-checked={selectedPolicy === 'lightweight'}
            className={`learning-policy-option${selectedPolicy === 'lightweight' ? ' is-selected' : ''}`}
            onClick={() => onSelect('lightweight')}
          >
            <span className="learning-policy-radio" aria-hidden="true" />
            <span className="learning-policy-copy">
              <span className="learning-policy-title">
                <strong>轻量学习</strong>
                <em>更快开始</em>
              </span>
              <span className="learning-policy-description">
                使用紧凑场景、目标表达、例句和简单回想，完成后交给系统安排长期复习。
              </span>
              <span className="learning-policy-path">首次轻量学习 · 简单复习 · 轻量再学</span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={selectedPolicy === 'high_assurance'}
            aria-disabled={!highAssuranceAvailable}
            disabled={!highAssuranceAvailable}
            className={`learning-policy-option is-assurance${selectedPolicy === 'high_assurance' ? ' is-selected' : ''}`}
            onClick={() => onSelect('high_assurance')}
          >
            <span className="learning-policy-radio" aria-hidden="true" />
            <span className="learning-policy-copy">
              <span className="learning-policy-title">
                <strong>高保证学习</strong>
                <em>{highAssuranceAvailable ? '可选择' : '当前不可用'}</em>
              </span>
              <span className="learning-policy-description">
                通过识别、主动回想、新语境迁移和必要的边界辨析，更充分地检验连接。
              </span>
              <span className="learning-policy-path">深度首次学习 · 证据型复习 · 针对性再学</span>
              {!highAssuranceAvailable && (
                <span className="learning-policy-unavailable">
                  当前目标缺少完整检验内容或运行能力，系统不会自动降级。
                </span>
              )}
            </span>
          </button>
        </div>

        <section className="learning-policy-confirmation">
          <small>当前选择</small>
          <strong>{policyLabel(selectedPolicy)}</strong>
          <p>{isTargetPolicy ? '只影响这个目标；首次正式学习开始后锁定。' : '新加入的目标默认采用这种方式，仍可单独修改。'}</p>
          <button type="button" onClick={onBack}>确认这个选择</button>
        </section>
      </main>
    </section>
  );
};
