import {
  policyLabel,
  type PrototypeLearningPolicy,
} from '../learningJourney/prototypeLearning';

interface StudyScreenProps {
  active: boolean;
  tab: 'a' | 'b';
  onTabChange: (tab: 'a' | 'b') => void;
  onBack: () => void;
  onAddLearning: () => void;
  onOpenTargetLibrary: () => void;
  onOpenDefaultPolicy: () => void;
  defaultPolicy: PrototypeLearningPolicy;
  learningTargetCount: number;
  readyInitialCount: number;
  reviewCount: number;
  dailyNewCount: number;
  onDailyNewCountChange: (count: number) => void;
}

const PACE_OPTIONS = [5, 10, 15, 20, 30] as const;

export const StudyScreen = ({
  active,
  tab,
  onTabChange,
  onBack,
  onAddLearning,
  onOpenTargetLibrary,
  onOpenDefaultPolicy,
  defaultPolicy,
  learningTargetCount,
  readyInitialCount,
  reviewCount,
  dailyNewCount,
  onDailyNewCountChange,
}: StudyScreenProps) => {
  const cycleDailyNewCount = () => {
    const currentIndex = PACE_OPTIONS.indexOf(dailyNewCount as (typeof PACE_OPTIONS)[number]);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % PACE_OPTIONS.length;
    onDailyNewCountChange(PACE_OPTIONS[nextIndex]);
  };

  return (
    <section
      className={`screen learning-surface my-learning-screen${active ? ' active' : ''}`}
      id="s-study"
      data-anim="sheet"
    >
      <header className="learning-page-nav has-tabs">
        <button type="button" onClick={onBack} aria-label="返回首页">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div className="learning-page-tabs" role="tablist" aria-label="我的学习页面">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'a'}
            className={tab === 'a' ? 'is-active' : ''}
            onClick={() => onTabChange('a')}
          >
            我的学习
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'b'}
            className={tab === 'b' ? 'is-active' : ''}
            onClick={() => onTabChange('b')}
          >
            学习设置
          </button>
        </div>
      </header>

      {tab === 'a' ? (
        <main className="learning-page-body my-learning-body" role="tabpanel">
          <section className="my-learning-overview">
            <div>
              <small>今日计划</small>
              <h1>新学与复习</h1>
            </div>
            <div className="my-learning-today" aria-label="今日学习摘要">
              <span><small>新学</small><strong>{readyInitialCount}</strong></span>
              <i aria-hidden="true" />
              <span><small>复习</small><strong>{reviewCount}</strong></span>
            </div>
          </section>

          <button
            type="button"
            className="my-learning-library-entry"
            onClick={onOpenTargetLibrary}
          >
            <span className="my-learning-library-mark" aria-hidden="true">
              <i /><i /><i />
            </span>
            <span>
              <small>学习内容</small>
              <strong>{learningTargetCount} 个学习目标</strong>
            </span>
            <span aria-hidden="true">›</span>
          </button>

          <section className="learning-section my-learning-source-section" aria-labelledby="learning-sources-title">
            <div className="learning-section-heading">
              <div>
                <h2 id="learning-sources-title">学习来源</h2>
              </div>
              <button type="button" onClick={onAddLearning}>添加</button>
            </div>

            <div className="my-learning-source-card">
              <span className="my-learning-book-mark" aria-hidden="true">S</span>
              <span>
                <small>当前词书</small>
                <strong>日常英语核心意思</strong>
                <em>86 个意思</em>
              </span>
              <span className="my-learning-source-state">进行中</span>
            </div>
          </section>
        </main>
      ) : (
        <main className="learning-page-body my-learning-settings" role="tabpanel">
          <section className="learning-section my-learning-settings-list" aria-label="学习设置">
            <button type="button" className="my-learning-setting-row" onClick={onOpenDefaultPolicy}>
              <strong>默认学习方式</strong>
              <em>{policyLabel(defaultPolicy)}</em>
            </button>
            <button type="button" className="my-learning-setting-row" onClick={cycleDailyNewCount}>
              <strong>每日新学</strong>
              <em>{dailyNewCount} 个意思</em>
            </button>
            <div className="my-learning-setting-row is-static">
              <strong>复习安排</strong>
              <em>自动</em>
            </div>
          </section>
        </main>
      )}
    </section>
  );
};
