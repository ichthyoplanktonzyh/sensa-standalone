interface ProfileScreenProps {
  active: boolean;
  onBack: () => void;
  onGoStudyPref: () => void;
  toast: (msg: string) => void;
  coins: number;
}

export const ProfileScreen = ({
  active,
  onBack,
  onGoStudyPref,
  toast,
  coins,
}: ProfileScreenProps) => {
  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-profile" data-anim="slide">
      <div className="h-sp" />
      <div className="pf-top">
        <button onClick={onBack} aria-label="返回">
          <svg className="icon" style={{ width: 26, height: 26 }}><use href="#i-chev-l" /></svg>
        </button>
        <button onClick={() => toast('消息中心：暂无新消息')} aria-label="消息">
          <svg className="icon" style={{ width: 26, height: 26 }}><use href="#i-mail" /></svg>
        </button>
      </div>
      <div className="pf-hero">
        <span className="avatar" />
        <h3>52赫兹的Alice</h3>
        <div className="vip" onClick={() => toast('开通大会员，解锁全部词书与离线包')}>
          <span className="v">VIP</span>未开通大会员 ›
        </div>
      </div>
      <div className="pad">
        <div className="assets">
          <div className="asset" onClick={() => toast('酷币中心：签到、打卡可获得酷币')}>
            <div className="hd">
              <b>酷币</b>
              <svg className="chev" style={{ marginLeft: 'auto' }}><use href="#i-chev-r" /></svg>
            </div>
            <div className="coin" id="coinN">
              <i>¢</i>{coins.toLocaleString()}
            </div>
          </div>
          <div className="asset" onClick={() => toast('装备商城：用酷币解锁柯林斯等词典装备')}>
            <div className="hd">
              <b>装备</b>
              <span className="m">0/9</span>
              <svg className="chev"><use href="#i-chev-r" /></svg>
            </div>
            <div className="gears">
              <span className="gear"><svg className="icon"><use href="#i-list" /></svg></span>
              <span className="gear" style={{ fontSize: 9, color: '#b6b6be' }}>Collins</span>
              <span className="gear"><svg className="icon"><use href="#i-eq" /></svg></span>
              <span className="gear"><svg className="icon"><use href="#i-pen" /></svg></span>
            </div>
          </div>
        </div>

        <div className="card group">
          <div className="row" onClick={() => toast('外观 & 沉浸场景：更换壁纸与主题')}>
            <span className="sq" style={{ background: '#dff5ec', color: '#17a97f' }}>
              <svg className="icon"><use href="#i-palette" /></svg>
            </span>
            <span className="t">外观 & 沉浸场景</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
          <div className="row" onClick={onGoStudyPref}>
            <span className="sq" style={{ background: '#f6e9fb', color: '#b053d8' }}>
              <svg className="icon"><use href="#i-sliders" /></svg>
            </span>
            <span className="t">学习偏好</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
          <div className="row" onClick={() => toast('更多设置：账号、通知、缓存管理')}>
            <span className="sq" style={{ background: '#e7edfd', color: '#4a76e8' }}>
              <svg className="icon"><use href="#i-set" /></svg>
            </span>
            <span className="t">更多设置</span>
            <svg className="chev"><use href="#i-chev-r" /></svg>
          </div>
        </div>
      </div>
    </section>
  );
};
