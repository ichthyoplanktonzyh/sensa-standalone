import { useMemo } from 'react';

interface HomeScreenProps {
  active: boolean;
  onGo: (id: string) => void;
  onStartMixed: () => void;
  onStartReview?: () => void;
  signed: boolean;
  onSign: () => void;
  mixedReadyN: number;
  reviewDueN?: number;
}

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

const PracticeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 17.5V8.4L12 5l7 3.4v9.1" />
    <path d="M8 15.2c2.2-1.7 5.8-1.7 8 0M12 9.2v2.9" />
  </svg>
);

const ContentIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.5 5.5h5.2c.7 0 1.3.6 1.3 1.3v12c0-1.2-1-2.2-2.2-2.2H5.5z" />
    <path d="M18.5 5.5h-5.2c-.7 0-1.3.6-1.3 1.3v12c0-1.2 1-2.2 2.2-2.2h4.3z" />
  </svg>
);

const ProgressIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 18V9M12 18V5M19 18v-6" />
    <path d="M3.5 18.5h17" />
  </svg>
);

export const HomeScreen = ({
  active,
  onGo,
  onStartMixed,
  onStartReview,
  signed,
  onSign,
  mixedReadyN,
  reviewDueN,
}: HomeScreenProps) => {
  const todayLabel = useMemo(() => {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date()).replace('星期', ' · 星期');
  }, []);

  const reviewCount = reviewDueN ?? 0;
  const newCount = Math.max(0, mixedReadyN - reviewCount);
  const hasMixedWork = mixedReadyN > 0;

  const flowDescription = reviewCount > 0 && newCount > 0
    ? `先处理 ${reviewCount} 个到期复习，再开始 ${newCount} 个新意思。`
    : reviewCount > 0
      ? `今天有 ${reviewCount} 个意思需要复习。`
      : newCount > 0
        ? `今天可以开始 ${newCount} 个新意思。`
        : '今天的学习流暂时安静，可以去自由练习或稍后再回来。';

  return (
    <section
      className={`screen sensa-home${active ? ' active' : ''}`}
      id="s-home"
      data-anim="fade"
    >
      <div className="sensa-home-field" aria-hidden="true">
        <i className="field-ring ring-one" />
        <i className="field-ring ring-two" />
        <i className="field-ring ring-three" />
        <i className="field-seed seed-one" />
        <i className="field-seed seed-two" />
        <i className="field-seed seed-three" />
      </div>

      <header className="sensa-home-header">
        <div className="sensa-home-brand" aria-label="Sensa">
          <span className="sensa-home-mark" aria-hidden="true"><i /><i /><i /></span>
          <strong>SENSA</strong>
        </div>
        <button
          className="sensa-profile-entry"
          onClick={() => onGo('s-profile')}
          aria-label="打开个人中心"
        >
          <span aria-hidden="true">我</span>
        </button>
      </header>

      <main className="sensa-home-main">
        <div className="sensa-home-date-row">
          <span>{todayLabel}</span>
          <button className={signed ? 'is-signed' : ''} onClick={onSign}>
            <i aria-hidden="true" />
            {signed ? '今天已记录' : '记录今天'}
          </button>
        </div>

        <section className="sensa-home-focus" aria-labelledby="sensa-home-title">
          <div className="sensa-home-kicker">
            <i aria-hidden="true" />
            今日学习流
          </div>
          <h1 id="sensa-home-title">继续今天的学习</h1>
          <p>{flowDescription}</p>

          <div className="sensa-home-summary" aria-label="今日学习摘要">
            <div>
              <span>新学</span>
              <strong>{newCount}</strong>
            </div>
            <i aria-hidden="true" />
            <div>
              <span>复习</span>
              <strong>{reviewCount}</strong>
            </div>
          </div>

          <button
            className="sensa-home-primary"
            onClick={onStartMixed}
            disabled={!hasMixedWork}
          >
            <span>{hasMixedWork ? '开始今天的学习' : '今日已完成'}</span>
            <ArrowIcon />
          </button>
        </section>

        <section className="sensa-home-review" aria-labelledby="review-only-title">
          <div>
            <span>复习</span>
            <h2 id="review-only-title">只复习</h2>
            <p>不引入新义项，只处理到期与需要重学的意思。</p>
          </div>
          <button
            onClick={onStartReview}
            disabled={reviewCount === 0 || !onStartReview}
            aria-label={reviewCount > 0 ? `只复习 ${reviewCount} 个意思` : '今天无需复习'}
          >
            <strong>{reviewCount > 0 ? reviewCount : '—'}</strong>
            <span>{reviewCount > 0 ? '个待复习' : '今天无需复习'}</span>
            {reviewCount > 0 && <ArrowIcon />}
          </button>
        </section>
      </main>

      <nav className="sensa-home-nav" aria-label="主要导航">
        <button onClick={() => onGo('s-academy')}>
          <PracticeIcon />
          <span>自由练习</span>
        </button>
        <button onClick={() => onGo('s-content')}>
          <ContentIcon />
          <span>我的内容</span>
        </button>
        <button onClick={() => onGo('s-study')}>
          <ProgressIcon />
          <span>我的学习</span>
        </button>
      </nav>
    </section>
  );
};
