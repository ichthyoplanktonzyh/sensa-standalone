import { useEffect, useMemo, useState } from 'react';
import { ExperienceRenderer } from '../cards/ExperienceRenderer';
import {
  experienceGroundingForTarget,
  policyLabel,
  type PrototypeLearningPolicy,
  type PrototypeLearningTargetView,
  type PrototypeLightweightRating,
} from '../../learningJourney/prototypeLearning';

type LightweightRuntimePhase = 'grounding' | 'recall' | 'answer' | 'complete';

interface LightweightRuntimeStartScreenProps {
  active: boolean;
  target: PrototypeLearningTargetView | null;
  committedPolicy: PrototypeLearningPolicy;
  hasNextTarget: boolean;
  onExit: () => void;
  onComplete: (rating: Exclude<PrototypeLightweightRating, 'again'>) => void;
  onFinish: () => void;
}

const phaseLabel: Record<LightweightRuntimePhase, string> = {
  grounding: '经验落地',
  recall: '主动回想',
  answer: '核对答案',
  complete: '首次学习完成',
};

const sourceShortLabel = {
  personal_semantic_world: '我的词义世界',
  learning_package: 'Learning Package',
  generated: '生成的经验',
} as const;

export const LightweightRuntimeStartScreen = ({
  active,
  target,
  committedPolicy,
  hasNextTarget,
  onExit,
  onComplete,
  onFinish,
}: LightweightRuntimeStartScreenProps) => {
  const [phase, setPhase] = useState<LightweightRuntimePhase>('grounding');
  const [againCount, setAgainCount] = useState(0);
  const grounding = useMemo(
    () => target ? experienceGroundingForTarget(target) : null,
    [target],
  );

  useEffect(() => {
    setPhase('grounding');
    setAgainCount(0);
  }, [target?.targetId]);

  if (!target || !grounding) return null;

  const rate = (rating: PrototypeLightweightRating) => {
    if (rating === 'again') {
      setAgainCount((count) => count + 1);
      setPhase('recall');
      return;
    }
    onComplete(rating);
    setPhase('complete');
  };

  const progressStep = phase === 'grounding' ? 0 : phase === 'recall' ? 1 : phase === 'answer' ? 2 : 3;

  return (
    <section
      className={`screen lightweight-runtime phase-${phase}${active ? ' active' : ''}`}
      id="s-lightweight-runtime"
      data-anim="fade"
    >
      <header className="lightweight-runtime-nav">
        <button type="button" onClick={onExit} aria-label="暂时退出学习">×</button>
        <span>{phaseLabel[phase]}</span>
        <em><i aria-hidden="true" />{policyLabel(committedPolicy)} · 已锁定</em>
      </header>

      <main className="lightweight-runtime-body">
        <div className="lightweight-runtime-progress" aria-label={`首次学习：${phaseLabel[phase]}`}>
          {[0, 1, 2].map((step) => (
            <span
              key={step}
              className={step < progressStep ? 'is-done' : step === progressStep ? 'is-current' : ''}
            />
          ))}
        </div>

        {phase === 'grounding' && (
          <div className="lightweight-runtime-stage" key="grounding">
            {grounding.packageExperience ? (
              <ExperienceRenderer
                experience={grounding.packageExperience}
                mode="introduction"
                primaryActionLabel="继续，开始回想"
                onPrimaryAction={() => setPhase('recall')}
              />
            ) : (
              <section className="lightweight-grounding" aria-labelledby="lightweight-grounding-title">
                <div className="lightweight-grounding-source">
                  <span>{sourceShortLabel[grounding.source]}</span>
                  <small>{grounding.sourceLabel}</small>
                </div>
                <h1 id="lightweight-grounding-title">先回到这个时刻</h1>
                <blockquote>{grounding.scene}</blockquote>
                <p>{grounding.focus}</p>
                <div className="lightweight-grounding-features" aria-label="经验中的意义特征">
                  {grounding.featureLabels.map((label) => <span key={label}>{label}</span>)}
                </div>
                <button type="button" onClick={() => setPhase('recall')}>继续，开始回想</button>
              </section>
            )}
          </div>
        )}

        {phase === 'recall' && (
          <section className="lightweight-runtime-stage lightweight-recall" key={`recall-${againCount}`}>
            <small>{againCount > 0 ? `再试一次 · 第 ${againCount + 1} 次` : '从经验回到表达'}</small>
            <div className="lightweight-recall-context">
              <span>{sourceShortLabel[grounding.source]}</span>
              <p>{grounding.scene}</p>
            </div>
            <h1>{target.meaning}</h1>
            <p>你会用哪个英语表达说出这个意思？</p>
            <button type="button" onClick={() => setPhase('answer')}>显示答案</button>
          </section>
        )}

        {phase === 'answer' && (
          <section className="lightweight-runtime-stage lightweight-answer" key="answer" aria-live="polite">
            <small>目标表达</small>
            <h1>{target.expression}</h1>
            <span>{target.expressionTypeLabel} · {target.partOfSpeech}</span>
            <p>{target.meaning}</p>
            <blockquote>{target.example}</blockquote>

            <div className="lightweight-rating" role="group" aria-label="评价刚才的回想">
              <button type="button" className="is-again" onClick={() => rate('again')}>
                <strong>没想起</strong><small>本轮再试</small>
              </button>
              <button type="button" className="is-hard" onClick={() => rate('hard')}>
                <strong>想起但费力</strong><small>交给调度</small>
              </button>
              <button type="button" className="is-good" onClick={() => rate('good')}>
                <strong>顺利想起</strong><small>交给调度</small>
              </button>
            </div>
          </section>
        )}

        {phase === 'complete' && (
          <section className="lightweight-runtime-stage lightweight-complete" key="complete" aria-live="polite">
            <span className="lightweight-complete-mark" aria-hidden="true">✓</span>
            <small>首次轻量学习完成</small>
            <h1>{target.expression}</h1>
            <p>这条连接已经交给长期复习安排。</p>
            <div>
              <span>经验已落地</span>
              <span>学习方式已锁定</span>
              <span>等待首次复习</span>
            </div>
            <button type="button" onClick={onFinish}>
              {hasNextTarget ? '继续下一条' : '完成并回到首页'}
            </button>
          </section>
        )}
      </main>
    </section>
  );
};
