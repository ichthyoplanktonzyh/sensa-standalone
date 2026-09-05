import type { LearningRecordKind, LearningRecordView } from '../learningJourney/learningHistory';
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
  onOpenStats: () => void;
  onSign: () => void;
  signed: boolean;
  streak: number;
  defaultPolicy: PrototypeLearningPolicy;
  learningTargetCount: number;
  readyInitialCount: number;
  reviewCount: number;
  dailyNewCount: number;
  learningRecords: readonly LearningRecordView[];
  onDailyNewCountChange: (count: number) => void;
}

interface WeekDayView {
  key: string;
  weekday: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
  isRecorded: boolean;
}

const PACE_OPTIONS = [5, 10, 15, 20, 30] as const;
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const localDateKey = (date: Date): string => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const addLocalDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
};

const weekFor = (today: Date, signed: boolean, streak: number): readonly WeekDayView[] => {
  const todayKey = localDateKey(today);
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = addLocalDays(today, -mondayOffset);
  const recordedKeys = new Set<string>();

  if (signed) {
    for (let offset = 0; offset < streak; offset += 1) {
      recordedKeys.add(localDateKey(addLocalDays(today, -offset)));
    }
  }

  return WEEKDAY_LABELS.map((weekday, index) => {
    const date = addLocalDays(monday, index);
    const key = localDateKey(date);
    return {
      key,
      weekday,
      day: date.getDate(),
      isToday: key === todayKey,
      isFuture: date.getTime() > addLocalDays(today, 0).getTime(),
      isRecorded: recordedKeys.has(key),
    };
  });
};

const recordDateLabel = (occurredAt: string, today: Date): string => {
  const date = new Date(occurredAt);
  const dateKey = localDateKey(date);
  const yesterdayKey = localDateKey(addLocalDays(today, -1));
  const dayLabel = dateKey === localDateKey(today)
    ? '今天'
    : dateKey === yesterdayKey
      ? '昨天'
      : `${date.getMonth() + 1}月${date.getDate()}日`;
  const timeLabel = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${dayLabel} ${timeLabel}`;
};

const RecordIcon = ({ kind }: { kind: LearningRecordKind }) => {
  if (kind === 'initial_learning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 5.5h5.2c.7 0 1.3.6 1.3 1.3v11.7c0-1.2-1-2.2-2.2-2.2H6z" />
        <path d="M18 5.5h-4.2c-.7 0-1.3.6-1.3 1.3v11.7c0-1.2 1-2.2 2.2-2.2H18z" />
      </svg>
    );
  }
  if (kind === 'relearning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 8.2H4.5V5.5" /><path d="M5 8a8 8 0 1 1-.7 6.8" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5a7 7 0 1 1-6.3 4" /><path d="M4 5v4h4" />
      <path d="M12 8v4l2.6 1.7" />
    </svg>
  );
};

export const StudyScreen = ({
  active,
  tab,
  onTabChange,
  onBack,
  onAddLearning,
  onOpenTargetLibrary,
  onOpenDefaultPolicy,
  onOpenStats,
  onSign,
  signed,
  streak,
  defaultPolicy,
  learningTargetCount,
  readyInitialCount,
  reviewCount,
  dailyNewCount,
  learningRecords,
  onDailyNewCountChange,
}: StudyScreenProps) => {
  const today = new Date();
  const todayKey = localDateKey(today);
  const currentWeek = weekFor(today, signed, streak);
  const todayRecords = learningRecords.filter(
    (record) => localDateKey(new Date(record.occurredAt)) === todayKey,
  );
  const todayInitialCount = todayRecords.filter(
    (record) => record.kind === 'initial_learning',
  ).length;
  const todayRetentionCount = todayRecords.length - todayInitialCount;
  const remainingCount = readyInitialCount + reviewCount;

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
          <section className="my-learning-overview" aria-labelledby="my-learning-today-title">
            <div>
              <small>今日学习</small>
              <h1 id="my-learning-today-title">
                {remainingCount > 0 ? `还有 ${remainingCount} 个意思待处理` : '今天的计划已处理完'}
              </h1>
              <p>
                {todayRecords.length > 0
                  ? `已完成 ${todayInitialCount} 个首次学习、${todayRetentionCount} 个复习或巩固。`
                  : '完成的首次学习与复习会自动记在这里。'}
              </p>
            </div>
            <div className="my-learning-today" aria-label="今日待处理学习摘要">
              <span><small>待新学</small><strong>{readyInitialCount}</strong></span>
              <i aria-hidden="true" />
              <span><small>待复习</small><strong>{reviewCount}</strong></span>
            </div>
          </section>

          <section className="my-learning-plan" aria-labelledby="my-learning-plan-title">
            <div className="my-learning-section-heading">
              <div>
                <small>范围与额度</small>
                <h2 id="my-learning-plan-title">学习计划</h2>
              </div>
              <button type="button" onClick={onAddLearning}>添加内容</button>
            </div>

            <button
              type="button"
              className="my-learning-plan-card"
              onClick={onOpenTargetLibrary}
              aria-label="打开日常英语核心意思的学习内容"
            >
              <span className="my-learning-book-mark" aria-hidden="true">S</span>
              <span className="my-learning-plan-copy">
                <small>当前词书</small>
                <strong>日常英语核心意思</strong>
                <em>当前范围 · 86 个意思</em>
              </span>
              <span className="my-learning-plan-arrow" aria-hidden="true">›</span>
              <span className="my-learning-plan-meta">
                <span><small>已加入</small><strong>{learningTargetCount} 个目标</strong></span>
                <i aria-hidden="true" />
                <span><small>每日新学</small><strong>{dailyNewCount} 个意思</strong></span>
              </span>
            </button>
          </section>

          <section className="my-learning-checkin" aria-labelledby="my-learning-checkin-title">
            <div className="my-learning-section-heading">
              <div>
                <small>本周</small>
                <h2 id="my-learning-checkin-title">每日签到</h2>
              </div>
              <button
                type="button"
                className={signed ? 'is-complete' : ''}
                onClick={onSign}
                aria-pressed={signed}
              >
                {signed ? '今天已记录' : '记录今天'}
              </button>
            </div>

            <div className="my-learning-streak">
              <span aria-hidden="true"><i /></span>
              <p><strong>连续 {streak} 天</strong><small>签到只记录到访，不改变学习进度</small></p>
            </div>

            <ol className="my-learning-week" aria-label="本周签到日历">
              {currentWeek.map((day) => (
                <li
                  key={day.key}
                  className={`${day.isToday ? 'is-today' : ''}${day.isFuture ? ' is-future' : ''}${day.isRecorded ? ' is-recorded' : ''}`}
                  aria-label={`星期${day.weekday}，${day.day}日${day.isRecorded ? '，已签到' : ''}`}
                >
                  <small>周{day.weekday}</small>
                  <span>{day.isRecorded ? '✓' : day.day}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="my-learning-history" aria-labelledby="my-learning-history-title">
            <div className="my-learning-section-heading">
              <div>
                <small>最近发生</small>
                <h2 id="my-learning-history-title">学习记录</h2>
              </div>
              <button type="button" onClick={onOpenStats}>完整概览</button>
            </div>

            {learningRecords.length === 0 ? (
              <div className="my-learning-history-empty">
                <span aria-hidden="true"><i /><i /><i /></span>
                <div>
                  <strong>还没有完成记录</strong>
                  <p>完成一个意思的首次学习、复习或巩固后，会按时间出现在这里。</p>
                </div>
              </div>
            ) : (
              <ol className="my-learning-history-list">
                {learningRecords.slice(0, 4).map((record) => (
                  <li key={record.recordId}>
                    <span className={`my-learning-record-icon is-${record.kind}`}>
                      <RecordIcon kind={record.kind} />
                    </span>
                    <span className="my-learning-record-copy">
                      <span><strong>{record.expression}</strong><em>{record.label}</em></span>
                      <small>{record.detail}</small>
                    </span>
                    <time dateTime={record.occurredAt}>{recordDateLabel(record.occurredAt, today)}</time>
                  </li>
                ))}
              </ol>
            )}
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
