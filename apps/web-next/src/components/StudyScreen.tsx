import { useState } from 'react';

interface StudyScreenProps {
  active: boolean;
  tab: 'a' | 'b';
  onTabChange: (tab: 'a' | 'b') => void;
  onBack: () => void;
  onOpenBookMenu: (e: React.MouseEvent) => void;
  onOpenStats?: () => void;
  toast: (msg: string) => void;
  streak: number;
  totalLearned: number;
  dailyNewCount?: number;
  onDailyNewCountChange?: (count: number) => void;
}

const PACE_OPTIONS = [5, 10, 15, 20, 30];

export const StudyScreen = ({
  active,
  tab,
  onTabChange,
  onBack,
  onOpenBookMenu,
  onOpenStats,
  toast,
  streak,
  totalLearned,
  dailyNewCount = 5,
  onDailyNewCountChange,
}: StudyScreenProps) => {
  const [newbookChecked, setNewbookChecked] = useState(false);

  // 偏好项状态
  const [pronType, setPronType] = useState('美式');
  const [autoPron, setAutoPron] = useState('单词、例句卡片');
  const [spellMode, setSpellMode] = useState('全部开启');
  const [reviewPace, setReviewPace] = useState('20 词/组');
  const [swAudioChoice, setSwAudioChoice] = useState(true);
  const [swSplitMnemo, setSwSplitMnemo] = useState(true);
  const [swConfuse, setSwConfuse] = useState(false);

  const handleCycleDailyNewCount = () => {
    const nextIdx = (PACE_OPTIONS.indexOf(dailyNewCount) + 1) % PACE_OPTIONS.length;
    const nextVal = PACE_OPTIONS[nextIdx];
    if (onDailyNewCountChange) {
      onDailyNewCountChange(nextVal);
    }
    toast(`每日新学词数已设置为：${nextVal} 词/组`);
  };

  const cycle = (current: string, list: string[], setter: (v: string) => void, label: string) => {
    const nextIdx = (list.indexOf(current) + 1) % list.length;
    const nextVal = list[nextIdx];
    setter(nextVal);
    toast(`${label} → ${nextVal}`);
  };

  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-study" data-anim="sheet">
      <div className="sheet-head">
        <button className="down" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <div className="segwrap">
          <div className="seg">
            <button
              id="segA"
              className={tab === 'a' ? 'on' : ''}
              onClick={() => onTabChange('a')}
            >
              我的学习
            </button>
            <button
              id="segB"
              className={tab === 'b' ? 'on' : ''}
              onClick={() => onTabChange('b')}
            >
              学习偏好
            </button>
          </div>
        </div>
      </div>

      {/* 子 Tab A */}
      <div className="pad" id="studyA" style={{ display: tab === 'a' ? 'block' : 'none' }}>
        <div className="plan-top">
          <div className="sec-title">计划</div>
          <button className="pill" onClick={() => toast('打开词书商店，换一本词书')}>换本词书</button>
        </div>
        <div className="card" style={{ padding: '16px 16px 6px', marginBottom: 26 }}>
          <div className="book">
            <div className="bookcover">
              <span className="t">COCA 20000</span>
              <span className="s">上册</span>
              <i className="c" />
              <i className="tri1" />
              <i className="tri2" />
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <div className="name">COCA 20000 (上)</div>
              <button className="kebab" onClick={onOpenBookMenu}>
                <svg className="icon"><use href="#i-kebab" /></svg>
              </button>
              <div
                className="newbook"
                onClick={() => setNewbookChecked(!newbookChecked)}
              >
                <span className={`cbx${newbookChecked ? ' on' : ''}`}>
                  <svg className="icon"><use href="#i-chk" /></svg>
                </span>
                生词本 218
              </div>
            </div>
          </div>
          <div className="prog"><i /></div>
          <div className="prog-txt">
            <span>已学习 <b style={{ color: '#6d6d76', fontWeight: 600 }}>1212</b></span>
            <span>总词数 <b style={{ color: '#6d6d76', fontWeight: 600 }}>5585</b></span>
          </div>
          <div className="daily">
            <b>每日新学词数</b>
            <span
              onClick={handleCycleDailyNewCount}
              style={{ cursor: 'pointer', color: '#f2701c', fontWeight: 600 }}
            >
              {dailyNewCount} 词/组 ▾
            </span>
          </div>
        </div>

        <div className="plan-top">
          <div className="sec-title">统计</div>
          <button className="pill" onClick={() => toast('生成学习成绩长图，分享给好友')}>晒成绩</button>
        </div>
        <div
          className="card stats-overview-entry-card"
          style={{ padding: 16, marginBottom: 26, cursor: 'pointer' }}
          onClick={() => {
            if (onOpenStats) onOpenStats();
            else toast('查看完整学习统计报表');
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <b style={{ fontSize: 18 }}>概览</b>
            <svg
              className="chev"
              style={{ marginLeft: 'auto', width: 20, height: 20 }}
            >
              <use href="#i-chev-r" />
            </svg>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="lb">
                <svg className="icon" style={{ color: '#f5c23a' }}><use href="#i-bars" /></svg>
                今日学习&复习
              </div>
              <div className="nm" id="statToday">
                {totalLearned}<small>词</small>
              </div>
            </div>
            <div className="stat">
              <div className="lb">
                <svg className="icon" style={{ color: '#ef4e63' }}><use href="#i-trend" /></svg>
                累计学习
              </div>
              <div className="nm" id="statAll">
                {7234 + totalLearned}<small>词</small>
              </div>
            </div>
            <div className="stat">
              <div className="lb">
                <svg className="icon" style={{ color: '#f5c23a' }}><use href="#i-timer" /></svg>
                今日总时长
              </div>
              <div className="nm" id="statMin">
                {Math.max(1, Math.round(totalLearned / 6))}<small>分钟</small>
              </div>
            </div>
            <div className="stat">
              <div className="lb">
                <svg className="icon" style={{ color: '#ef4e63' }}><use href="#i-clock" /></svg>
                累计时长
              </div>
              <div className="nm">
                15330<small>分钟</small>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <b style={{ fontSize: 18 }}>签到日历</b>
            <span style={{ marginLeft: 'auto', color: '#a2a2aa', fontSize: 15 }}>
              连续签到 <span id="streak">{streak}</span> 天
            </span>
            <svg className="chev" style={{ width: 18, height: 18, marginLeft: 4 }}><use href="#i-chev-r" /></svg>
          </div>
          <div className="week">
            <div><div className="wd">MON</div><div className="dn">10</div></div>
            <div><div className="wd">TUE</div><div className="dn">11</div></div>
            <div><div className="wd now">WED</div><div className="dn" style={{ color: '#f2701c' }}>今</div></div>
            <div><div className="wd">THU</div><div className="dn" style={{ color: '#c8c8d0' }}>13</div></div>
            <div><div className="wd">FRI</div><div className="dn" style={{ color: '#c8c8d0' }}>14</div></div>
            <div><div className="wd">SAT</div><div className="dn" style={{ color: '#c8c8d0' }}>15</div></div>
            <div><div className="wd">SUN</div><div className="dn" style={{ color: '#c8c8d0' }}>16</div></div>
          </div>
        </div>
      </div>

      {/* 子 Tab B */}
      <div className="pad" id="studyB" style={{ display: tab === 'b' ? 'block' : 'none' }}>
        <div className="card group">
          <div className="pref-row" onClick={() => toast('学习提醒：智能提醒 / 固定时间 / 关闭')}>
            <span className="t">学习提醒</span>
            <span className="v">智能提醒</span>
          </div>
        </div>

        <div className="card group">
          <div
            className="pref-row"
            onClick={() => cycle(pronType, ['美式', '英式'], setPronType, '单词发音类型')}
          >
            <span className="t">单词发音类型</span>
            <span className="v">{pronType}</span>
          </div>
          <div
            className="pref-row"
            onClick={() => cycle(autoPron, ['单词、例句卡片', '仅单词', '关闭'], setAutoPron, '自动发音')}
          >
            <span className="t">自动发音</span>
            <span className="v">{autoPron}</span>
          </div>
        </div>

        <div className="card group">
          <div
            className="pref-row"
            onClick={() => cycle(spellMode, ['全部开启', '仅新词', '全部关闭'], setSpellMode, '拼写')}
          >
            <span className="t">拼写</span>
            <span className="v">{spellMode}</span>
          </div>
        </div>

        <div className="card group">
          <div
            className="pref-row"
            onClick={handleCycleDailyNewCount}
          >
            <span className="t">学习节奏 (每组新词)</span>
            <span className="v">{dailyNewCount} 词/组</span>
          </div>
          <div
            className="pref-row"
            onClick={() => cycle(reviewPace, ['20 词/组', '10 词/组', '30 词/组', '50 词/组'], setReviewPace, '复习节奏')}
          >
            <span className="t">复习节奏</span>
            <span className="v">{reviewPace}</span>
          </div>
        </div>

        <div className="card group">
          <div
            className="pref-row"
            onClick={() => {
              const next = !swAudioChoice;
              setSwAudioChoice(next);
              toast(`听音选义题型：${next ? '已开启' : '已关闭'}`);
            }}
          >
            <span className="t">听音选义题型</span>
            <span className={`sw${swAudioChoice ? ' on' : ''}`} />
          </div>
          <div className="pref-row" onClick={() => toast('助记顺序：词组搭配 - 派生词 - 词根词缀 - 近义辨析')}>
            <span className="t">助记顺序</span>
            <span className="v">词组搭配 - 派生词 - 词根词缀 - …</span>
          </div>
          <div
            className="pref-row"
            onClick={() => {
              const next = !swSplitMnemo;
              setSwSplitMnemo(next);
              toast(`拆分助记：${next ? '已开启' : '已关闭'}`);
            }}
          >
            <span className="t">
              拆分助记
              <small>学习时自动拆分单词</small>
            </span>
            <span className={`sw${swSplitMnemo ? ' on' : ''}`} />
          </div>
          <div
            className="pref-row"
            onClick={() => {
              const next = !swConfuse;
              setSwConfuse(next);
              toast(`混淆项辨析：${next ? '已开启' : '已关闭'}`);
            }}
          >
            <span className="t">
              混淆项辨析
              <small>显示选择题错误选项词义</small>
            </span>
            <span className={`sw${swConfuse ? ' on' : ''}`} />
          </div>
        </div>

        <div className="card group">
          <div className="pref-row" onClick={() => toast('更多学习偏好设置')}>
            <span className="t">更多学习偏好</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>
      </div>
    </section>
  );
};
