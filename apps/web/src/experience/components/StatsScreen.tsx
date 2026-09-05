import { uiClass } from '../ui/classes';
import { useState, useMemo } from 'react';

interface StatsScreenProps {
  active: boolean;
  onBack: () => void;
  todayLearnWords?: number;
  todayReviewWords?: number;
  todayMinutes?: number;
  totalMinutes?: number;
  toast: (msg: string) => void;
}

interface DayStat {
  date: string;
  isToday?: boolean;
  learn: number;
  review: number;
  minutes: number;
}

export const StatsScreen = ({
  active,
  onBack,
  todayLearnWords = 3,
  todayReviewWords = 0,
  todayMinutes = 14,
  totalMinutes = 15348,
  toast,
}: StatsScreenProps) => {
  // Tab 状态：'week' (最近一周) vs 'month' (按月查看)
  const [tabInput, setTabInput] = useState<'week' | 'month'>('week');
  const [tabDuration, setTabDuration] = useState<'week' | 'month'>('week');

  // 刷新动效
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 选中某天交互状态 (默认选中最后一天即「今日」)
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(6);
  const [selectedDurIdx, setSelectedDurIdx] = useState<number>(6);

  // 7 天数据配置 (与原图 1/2 严格对齐)
  const weekData: DayStat[] = useMemo(() => [
    { date: '08-20', learn: 0, review: 0, minutes: 0 },
    { date: '08-21', learn: 0, review: 0, minutes: 0 },
    { date: '08-22', learn: 0, review: 0, minutes: 0 },
    { date: '08-23', learn: 0, review: 0, minutes: 0 },
    { date: '08-24', learn: 0, review: 0, minutes: 0 },
    { date: '08-25', learn: 2, review: 0, minutes: 2 },
    { date: '今日', isToday: true, learn: todayLearnWords, review: todayReviewWords, minutes: todayMinutes },
  ], [todayLearnWords, todayReviewWords, todayMinutes]);

  // 月度数据配置
  const monthData = useMemo(() => {
    return {
      monthName: '8月',
      monthLearn: 186 + todayLearnWords,
      monthReview: 342 + todayReviewWords,
      monthMinutes: 420 + todayMinutes,
      daysInMonth: 31,
    };
  }, [todayLearnWords, todayReviewWords, todayMinutes]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      toast('已同步最新学习统计数据');
    }, 500);
  };

  const curSelectedDay = weekData[selectedDayIdx] || weekData[6];
  const curSelectedDur = weekData[selectedDurIdx] || weekData[6];

  return (
    <section
      className={uiClass(`screen stats-screen${active ? ' active' : ''}`, "#s-stats")}
      id="s-stats"
      data-anim="slide"
    >
      {/* ================= 1. 顶部 Header ================= */}
      <header className={uiClass("stats-header")}>
        <button
          className={uiClass("stats-circle-btn")}
          onClick={onBack}
          aria-label="返回"
        >
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>

        <h1 className={uiClass("stats-header-title")}>概览</h1>

        <button
          className={uiClass(`stats-circle-btn stats-refresh-btn${isRefreshing ? ' spinning' : ''}`)}
          onClick={handleRefresh}
          aria-label="刷新统计"
        >
          <svg className={uiClass("icon")}><use href="#i-refresh" /></svg>
        </button>
      </header>

      {/* ================= 2. 统计卡片滚动容器 ================= */}
      <div className={uiClass("stats-scroll-body")}>
        {/* ----- 模块一：单词输入量 ----- */}
        <section className={uiClass("stats-section")}>
          <div className={uiClass("stats-sec-title-row")}>
            <svg className={uiClass("stats-sec-icon stat-input-icon")}>
              <use href="#i-stat-input" />
            </svg>
            <span className={uiClass("stats-sec-title")}>单词输入量</span>
          </div>

          <div className={uiClass("stats-card")}>
            {/* 卡片顶部 Tab 切换 */}
            <div className={uiClass("stats-tab-bar")}>
              <button
                className={uiClass(`stats-tab-btn${tabInput === 'week' ? ' active' : ''}`)}
                onClick={() => setTabInput('week')}
              >
                <span>最近一周</span>
                {tabInput === 'week' && <i className={uiClass("stats-tab-line")} />}
              </button>

              <button
                className={uiClass(`stats-tab-btn${tabInput === 'month' ? ' active' : ''}`)}
                onClick={() => setTabInput('month')}
              >
                <span>按月查看</span>
                {tabInput === 'month' && <i className={uiClass("stats-tab-line")} />}
              </button>
            </div>

            {/* 图表展示区 */}
            {tabInput === 'week' ? (
              <div className={uiClass("stats-chart-wrap")}>
                {/* 右上角图例 */}
                <div className={uiClass("stats-legend-bar")}>
                  <span className={uiClass("stats-legend-item")}>
                    <i className={uiClass("legend-dot learn-dot")} />
                    学习
                  </span>
                  <span className={uiClass("stats-legend-item")}>
                    <i className={uiClass("legend-dot review-dot")} />
                    复习
                  </span>
                </div>

                {/* 周视图柱状图表 */}
                <div className={uiClass("stats-bar-chart")}>
                  {/* 7 列竖向对齐虚线网格 */}
                  <div className={uiClass("stats-grid-lines")}>
                    {weekData.map((_, i) => (
                      <div key={i} className={uiClass("stats-grid-col")} />
                    ))}
                  </div>

                  {/* 7 列柱条与数值标注 */}
                  <div className={uiClass("stats-bars-row")}>
                    {weekData.map((day, idx) => {
                      const isSelected = idx === selectedDayIdx;
                      const hasWords = day.learn > 0 || day.review > 0;
                      const totalWords = day.learn + day.review;

                      return (
                        <div
                          key={day.date}
                          className={uiClass(`stats-bar-col${isSelected ? ' selected' : ''}`)}
                          onClick={() => setSelectedDayIdx(idx)}
                        >
                          {/* 柱条主体 */}
                          <div className={uiClass("stats-bar-slot")}>
                            {hasWords && (
                              <div className={uiClass("stats-bar-group")}>
                                {/* 顶部数值 */}
                                <span className={uiClass(`stats-bar-val${day.isToday ? ' today' : ''}`)}>
                                  {totalWords}
                                </span>
                                {/* 柱子：橙色学习 + 紫色复习 */}
                                <div className={uiClass("stats-stacked-bar")}>
                                  {day.review > 0 && (
                                    <div
                                      className={uiClass("bar-segment review-seg")}
                                      style={{ height: Math.max(6, (day.review / 20) * 80) }}
                                    />
                                  )}
                                  {day.learn > 0 && (
                                    <div
                                      className={uiClass("bar-segment learn-seg")}
                                      style={{ height: Math.max(7, (day.learn / 20) * 80) }}
                                    />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* X 轴日期 */}
                          <div className={uiClass(`stats-x-label${day.isToday ? ' today' : ''}`)}>
                            {day.date}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* 按月查看视图 */
              <div className={uiClass("stats-month-wrap")}>
                <div className={uiClass("stats-month-head")}>
                  <span className={uiClass("stats-month-badge")}>2026年 8月</span>
                  <span className={uiClass("stats-month-sub")}>每日学习复习频次分布</span>
                </div>
                <div className={uiClass("stats-month-calendar")}>
                  {Array.from({ length: monthData.daysInMonth }).map((_, i) => {
                    const d = i + 1;
                    const isToday = d === 27;
                    const hasActivity = d >= 20 && d <= 27;
                    return (
                      <div
                        key={d}
                        className={uiClass(`month-cell${isToday ? ' today' : ''}${hasActivity ? ' active' : ''}`)}
                      >
                        <span className={uiClass("month-day-num")}>{d}</span>
                        {hasActivity && <i className={uiClass("month-activity-dot")} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 底部指标展示 */}
            <div className={uiClass("stats-card-bottom")}>
              <div className={uiClass("stats-metric-col")}>
                <span className={uiClass("metric-label")}>
                  {tabInput === 'week' ? '当日学习' : '本月学习'}
                </span>
                <div className={uiClass("metric-num")}>
                  <b>{tabInput === 'week' ? curSelectedDay.learn : monthData.monthLearn}</b>
                  <small>词</small>
                </div>
              </div>

              <div className={uiClass("stats-metric-col")}>
                <span className={uiClass("metric-label")}>
                  {tabInput === 'week' ? '当日复习' : '本月复习'}
                </span>
                <div className={uiClass("metric-num")}>
                  <b>{tabInput === 'week' ? curSelectedDay.review : monthData.monthReview}</b>
                  <small>词</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ----- 模块二：学习时长 ----- */}
        <section className={uiClass("stats-section")}>
          <div className={uiClass("stats-sec-title-row")}>
            <svg className={uiClass("stats-sec-icon stat-timer-icon")}>
              <use href="#i-stat-timer" />
            </svg>
            <span className={uiClass("stats-sec-title")}>学习时长</span>
          </div>

          <div className={uiClass("stats-card")}>
            {/* 卡片顶部 Tab 切换 */}
            <div className={uiClass("stats-tab-bar")}>
              <button
                className={uiClass(`stats-tab-btn${tabDuration === 'week' ? ' active' : ''}`)}
                onClick={() => setTabDuration('week')}
              >
                <span>最近一周</span>
                {tabDuration === 'week' && <i className={uiClass("stats-tab-line")} />}
              </button>

              <button
                className={uiClass(`stats-tab-btn${tabDuration === 'month' ? ' active' : ''}`)}
                onClick={() => setTabDuration('month')}
              >
                <span>按月查看</span>
                {tabDuration === 'month' && <i className={uiClass("stats-tab-line")} />}
              </button>
            </div>

            {/* 图表展示区 */}
            {tabDuration === 'week' ? (
              <div className={uiClass("stats-chart-wrap")}>
                {/* 折线图容器 */}
                <div className={uiClass("stats-line-chart")}>
                  {/* 7 列竖向对齐虚线网格 */}
                  <div className={uiClass("stats-grid-lines")}>
                    {weekData.map((_, i) => (
                      <div key={i} className={uiClass("stats-grid-col")} />
                    ))}
                  </div>

                  {/* SVG 平滑曲线与数据点 (1:1 还原截图 2) */}
                  <div className={uiClass("stats-line-svg-layer")}>
                    <svg
                      viewBox="0 0 350 140"
                      className={uiClass("stats-svg-canvas")}
                      preserveAspectRatio="none"
                    >
                      {/* 平滑贝塞尔曲线路径 (基线 0-0-0-0-0 -> 08-25: 2 -> 今日: 14) */}
                      <path
                        d="M 25 120 L 75 120 L 125 120 L 175 120 L 225 120 C 250 120 260 114 275 110 C 295 104 308 42 325 36"
                        fill="none"
                        stroke="#d4d4d8"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>

                    {/* 各天节点覆盖层 */}
                    <div className={uiClass("stats-line-nodes-row")}>
                      {weekData.map((day, idx) => {
                        const isSelected = idx === selectedDurIdx;
                        // 计算节点垂直高度
                        let topPct = 85;
                        if (day.minutes === 0) topPct = 85;
                        else if (day.minutes <= 2) topPct = 78;
                        else topPct = 26;

                        return (
                          <div
                            key={day.date}
                            className={uiClass(`stats-node-col${isSelected ? ' selected' : ''}`)}
                            onClick={() => setSelectedDurIdx(idx)}
                          >
                            <div
                              className={uiClass(`stats-node-dot-wrap${day.isToday ? ' is-today' : ''}`)}
                              style={{ top: `${topPct}%` }}
                            >
                              {/* 数值标签 */}
                              <span className={uiClass(`stats-node-val${day.isToday ? ' today' : ''}`)}>
                                {day.minutes}
                              </span>
                              {/* 点 */}
                              <i className={uiClass(`stats-node-point${day.isToday ? ' today' : ''}`)} />
                            </div>

                            {/* X 轴日期 */}
                            <div className={uiClass(`stats-x-label${day.isToday ? ' today' : ''}`)}>
                              {day.date}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* 按月查看学习时长 */
              <div className={uiClass("stats-month-wrap")}>
                <div className={uiClass("stats-month-head")}>
                  <span className={uiClass("stats-month-badge")}>2026年 8月</span>
                  <span className={uiClass("stats-month-sub")}>全月每日专注时长走势</span>
                </div>
                <div className={uiClass("stats-month-bars")}>
                  {Array.from({ length: 31 }).map((_, i) => {
                    const d = i + 1;
                    const isToday = d === 27;
                    const h = d === 27 ? 46 : d === 26 ? 20 : d === 25 ? 12 : d > 18 ? (d * 7) % 24 : 0;
                    return (
                      <div key={d} className={uiClass("month-dur-bar-col")}>
                        <div
                          className={uiClass(`month-dur-bar${isToday ? ' today' : ''}`)}
                          style={{ height: `${Math.max(4, h)}px` }}
                        />
                        <span className={uiClass("month-dur-day")}>{d % 5 === 0 ? d : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 底部指标展示 */}
            <div className={uiClass("stats-card-bottom")}>
              <div className={uiClass("stats-metric-col")}>
                <span className={uiClass("metric-label")}>
                  {tabDuration === 'week' ? '当日学习' : '本月学习'}
                </span>
                <div className={uiClass("metric-num")}>
                  <b>{tabDuration === 'week' ? curSelectedDur.minutes : monthData.monthMinutes}</b>
                  <small>分钟</small>
                </div>
              </div>

              <div className={uiClass("stats-metric-col")}>
                <span className={uiClass("metric-label")}>总时长</span>
                <div className={uiClass("metric-num")}>
                  <b>{totalMinutes}</b>
                  <small>分钟</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 底部留白 */}
        <div className={uiClass("stats-bottom-spacer")} />
      </div>
    </section>
  );
};
