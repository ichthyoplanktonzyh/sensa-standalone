import { useMemo } from 'react';

interface HomeScreenProps {
  active: boolean;
  onGo: (id: string) => void;
  onStartLearn: () => void;
  onStartReview?: () => void;
  signed: boolean;
  onSign: () => void;
  learnN: number;
  reviewN?: number;
  toast: (msg: string) => void;
}

interface Spark {
  left: number;
  top: number;
  size: number;
  opacity: number;
  delay: number;
}

export const HomeScreen = ({
  active,
  onGo,
  onStartLearn,
  onStartReview,
  signed,
  onSign,
  learnN,
  reviewN,
  toast,
}: HomeScreenProps) => {
  const sparks = useMemo<Spark[]>(() => {
    const list: Spark[] = [];
    const put = (x: number, y: number, s: number, o: number, d: number) => {
      list.push({ left: x, top: y, size: s, opacity: o, delay: d });
    };
    for (let i = 0; i < 170; i++) {
      const p = Math.random();
      const sp = p * 44;
      put(
        88 - p * 72 + (Math.random() - 0.5) * sp,
        88 - p * 60 + (Math.random() - 0.5) * sp * 0.62,
        Math.random() * 2.2 + 0.9,
        (1 - p * 0.55) * (0.35 + Math.random() * 0.6),
        Math.random() * 2.6
      );
    }
    const clusters: [number, number, number][] = [
      [83, 17, 15],
      [30, 57, 9],
      [62, 24, 7],
    ];
    clusters.forEach(([cx, cy, n]) => {
      for (let i = 0; i < n * 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 7;
        put(
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r * 0.9,
          Math.random() * 1.8 + 0.9,
          0.5 + Math.random() * 0.5,
          Math.random() * 2.6
        );
      }
    });
    return list;
  }, []);

  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-home" data-anim="fade">
      <div className="wall">
        <div className="band" />
        <div className="hill" />
        <div id="sparks">
          {sparks.map((sp, idx) => (
            <i
              key={idx}
              className="spark"
              style={{
                left: `${sp.left}%`,
                top: `${sp.top}%`,
                width: `${sp.size}px`,
                height: `${sp.size}px`,
                opacity: sp.opacity,
                boxShadow: `0 0 ${sp.size * 2.4}px ${sp.size * 0.7}px rgba(255,214,150,${sp.opacity * 0.75})`,
                animationDelay: `${sp.delay}s`,
              }}
            />
          ))}
        </div>
      </div>

      <button className="avatar-btn" onClick={() => onGo('s-profile')}>
        <span className="avatar" />
      </button>

      <div className={`sign-card${signed ? ' done' : ''}`} id="signCard" onClick={onSign}>
        <svg className="icon"><use href="#i-cal" /></svg>
        <div className="st" id="signT">{signed ? '已签到' : '签到'}</div>
        <div className="sd">08/12 Wed.</div>
      </div>

      <div className="home-actions">
        <button className="act" onClick={onStartLearn}>
          <b>Learn</b>
          <span id="learnN">{learnN}</span>
        </button>
        <button
          className={`act${reviewN === 0 ? ' dim' : ''}`}
          onClick={
            reviewN === 0
              ? () => toast('今日暂无待复习单词，先去学新词吧')
              : onStartReview || onStartLearn
          }
        >
          <b>Review</b>
          <span>{reviewN ?? 15}</span>
        </button>
      </div>

      <nav className="tabbar">
        <button onClick={() => onGo('s-academy')} aria-label="不背学堂">
          <svg className="icon"><use href="#i-cap" /></svg>
        </button>
        <button onClick={() => onGo('s-content')} aria-label="我的内容">
          <svg className="icon"><use href="#i-desk" /></svg>
        </button>
        <button onClick={() => onGo('s-study')} aria-label="我的学习">
          <svg className="icon"><use href="#i-gearpic" /></svg>
        </button>
      </nav>
    </section>
  );
};
