import {
  isPolicyAvailableForTarget,
  policyLabel,
  type PrototypeLearningPolicy,
  type PrototypeLearningTargetView,
} from '../../learningJourney/prototypeLearning';
import { learningPolicyProfileRegistry } from '../../learningRuntime/policyProfiles';

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
  const profileOptions = learningPolicyProfileRegistry.list().map((profile) => ({
    profile,
    available: target ? isPolicyAvailableForTarget(target, profile.profileId) : true,
  }));

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
          {profileOptions.map(({ profile, available }) => (
            <button
              key={profile.profileId}
              type="button"
              role="radio"
              aria-checked={selectedPolicy === profile.profileId}
              aria-disabled={!available}
              disabled={!available}
              className={[
                'learning-policy-option',
                profile.presentation.optionClassName,
                selectedPolicy === profile.profileId ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(profile.profileId)}
            >
              <span className="learning-policy-radio" aria-hidden="true" />
              <span className="learning-policy-copy">
                <span className="learning-policy-title">
                  <strong>{profile.presentation.label}</strong>
                  <em>{available ? profile.presentation.shortBadge : '当前不可用'}</em>
                </span>
                <span className="learning-policy-description">
                  {profile.presentation.description}
                </span>
                <span className="learning-policy-path">
                  {profile.presentation.lifecycleLabel}
                </span>
                {!available && (
                  <span className="learning-policy-unavailable">
                    当前目标缺少这种方式要求的内容或运行能力，系统不会自动降级。
                  </span>
                )}
              </span>
            </button>
          ))}
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
