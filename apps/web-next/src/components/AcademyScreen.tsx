interface AcademyScreenProps {
  active: boolean;
  onBack: () => void;
  toast: (msg: string) => void;
}

export const AcademyScreen = ({ active, onBack, toast }: AcademyScreenProps) => {
  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-academy" data-anim="sheet">
      <div className="sheet-head">
        <button className="down" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <h2>不背学堂</h2>
      </div>
      <div className="pad">
        <div className="banner" onClick={() => toast('打开课程：CET-6 六级听力 阶梯训练')}>
          <svg className="wv" viewBox="0 0 360 126" preserveAspectRatio="none">
            <path d="M-10 92 C 60 40, 120 118, 190 62 S 320 22, 380 66 L380 126 L-10 126Z" fill="rgba(255,255,255,.28)" />
            <path d="M-10 74 C 70 26, 140 96, 210 46 S 330 8, 380 44" fill="none" stroke="rgba(255,168,120,.55)" strokeWidth="13" strokeLinecap="round" />
            <path d="M-10 82 C 70 34, 140 104, 210 54 S 330 16, 380 52" fill="none" stroke="rgba(140,160,240,.45)" strokeWidth="9" strokeLinecap="round" />
          </svg>
          <span className="badge">全新上线</span>
          <span className="cet">⼁ CET-6 ⼁</span>
          <span className="bt">六级听力 阶梯训练</span>
          <span className="sub">轻 松 练 真 题 👌</span>
        </div>

        <div className="two" style={{ marginBottom: 26 }}>
          <div className="ccard" onClick={() => toast('进入「备考速刷」')}>
            <b>备考速刷</b>
            <p>考前快速 n 刷必备</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#cfeaf7,#a9d8ef)' }}>🚀</span>
          </div>
          <div className="ccard" onClick={() => toast('进入「班级打卡」')}>
            <b>班级打卡</b>
            <p>全班一起学，刷词不掉队</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#fadfe9,#f6c7dd)' }}>📒</span>
          </div>
        </div>

        <div className="sec-title" style={{ marginBottom: 12 }}>精品课程</div>
        <div className="two">
          <div className="ccard" onClick={() => toast('课程详情：六级听力 阶梯训练')}>
            <b>六级听力 阶梯训练</b>
            <p>轻松练真题</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#e3d9f7,#cfc0ee)' }}>🎧</span>
          </div>
          <div className="ccard" onClick={() => toast('课程详情：四级听力 阶梯训练')}>
            <b>四级听力 阶梯训练</b>
            <p>轻松练真题</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#d8f2c8,#b6e8a4)' }}>🎧</span>
          </div>
          <div className="ccard" onClick={() => toast('课程详情：考研写作炼句')}>
            <b>考研写作炼句</b>
            <p>快速炼制高分金句</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#fde5cc,#fbd0ae)' }}>🖋️</span>
          </div>
          <div className="ccard" onClick={() => toast('课程详情：小野解词')}>
            <b>小野解词</b>
            <p>词根词缀，图记单词</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#d5f4e6,#b5ead2)' }}>🧑‍🏫</span>
          </div>
          <div className="ccard" onClick={() => toast('课程详情：口语达人')}>
            <b>口语达人</b>
            <p>地道口语特训课</p>
            <span className="th" style={{ background: 'linear-gradient(150deg,#ffe6c4,#ffd39a)' }}>🦜</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 26 }}>
          <div className="sec-title">快速上手</div>
          <button className="pill" style={{ background: 'none', color: '#9a9aa2', padding: 0 }} onClick={() => toast('查看更多上手教程')}>
            查看更多 ›
          </button>
        </div>
      </div>
    </section>
  );
};
