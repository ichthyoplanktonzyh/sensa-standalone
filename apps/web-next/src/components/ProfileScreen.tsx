type ProfileIconKind =
  | 'plan'
  | 'preferences'
  | 'sync'
  | 'storage'
  | 'data-control'
  | 'about'
  | 'privacy'
  | 'feedback';

interface ProfileScreenProps {
  active: boolean;
  onBack: () => void;
  onGoStudyPlan: () => void;
  onGoStudySettings: () => void;
  toast: (msg: string) => void;
}

const ProfileIcon = ({ kind }: { kind: ProfileIconKind }) => {
  switch (kind) {
    case 'plan':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.5 5.5h5.2c.7 0 1.3.6 1.3 1.3v11.7c0-1.2-1-2.2-2.2-2.2H5.5z" />
          <path d="M18.5 5.5h-5.2c-.7 0-1.3.6-1.3 1.3v11.7c0-1.2 1-2.2 2.2-2.2h4.3z" />
        </svg>
      );
    case 'preferences':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h8M17 7h2M5 12h2M11 12h8M5 17h9M18 17h1" />
          <circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="17" r="2" />
        </svg>
      );
    case 'sync':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.2 8.2A7 7 0 0 1 18 7l1.5 2" /><path d="M19.5 5v4h-4" />
          <path d="M17.8 15.8A7 7 0 0 1 6 17l-1.5-2" /><path d="M4.5 19v-4h4" />
        </svg>
      );
    case 'storage':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5C5 6.1 8.1 5 12 5s7 1.1 7 2.5S15.9 10 12 10 5 8.9 5 7.5Z" />
          <path d="M5 7.5v4C5 12.9 8.1 14 12 14s7-1.1 7-2.5v-4M5 11.5v4C5 16.9 8.1 18 12 18s7-1.1 7-2.5v-4" />
        </svg>
      );
    case 'data-control':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4.5h7l3 3V19H7z" /><path d="M14 4.5V8h3M10 12h4M10 15h4" />
        </svg>
      );
    case 'about':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case 'privacy':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5 18 7v4.5c0 3.7-2.4 6.6-6 8-3.6-1.4-6-4.3-6-8V7z" />
          <path d="m9.5 12 1.7 1.7 3.5-3.7" />
        </svg>
      );
    case 'feedback':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6.5h14v9H9l-4 3z" /><path d="M9 10h6M9 13h4" />
        </svg>
      );
  }
};

const Chevron = () => (
  <svg className="profile-chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const ProfileScreen = ({
  active,
  onBack,
  onGoStudyPlan,
  onGoStudySettings,
  toast,
}: ProfileScreenProps) => {
  return (
    <section
      className={`screen profile-surface${active ? ' active' : ''}`}
      id="s-profile"
      data-anim="slide"
    >
      <header className="profile-page-nav">
        <button type="button" onClick={onBack} aria-label="返回首页">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div>
          <small>设置与数据</small>
          <h1>我的</h1>
        </div>
        <span className="profile-local-state"><i aria-hidden="true" />本机</span>
      </header>

      <main className="profile-body">
        <section className="profile-identity" aria-labelledby="profile-identity-title">
          <div className="profile-identity-field" aria-hidden="true"><i /><i /><i /></div>
          <span className="profile-identity-mark" aria-hidden="true"><i /><i /><i /></span>
          <div className="profile-identity-copy">
            <small>本地交互原型</small>
            <h2 id="profile-identity-title">你的 Sensa</h2>
            <p>当前没有正式账号身份。这个页面展示本地原型状态，账号与云端同步接入后会在这里显示。</p>
          </div>
          <span className="profile-identity-status"><i aria-hidden="true" />本机使用中</span>
        </section>

        <section className="profile-shortcuts" aria-label="学习快捷入口">
          <button type="button" onClick={onGoStudyPlan}>
            <span className="profile-shortcut-icon"><ProfileIcon kind="plan" /></span>
            <span className="profile-shortcut-copy">
              <small>范围与额度</small>
              <strong>学习计划</strong>
              <em>词书、目标与每日新学</em>
            </span>
            <Chevron />
          </button>
          <button type="button" onClick={onGoStudySettings}>
            <span className="profile-shortcut-icon is-settings"><ProfileIcon kind="preferences" /></span>
            <span className="profile-shortcut-copy">
              <small>方式与安排</small>
              <strong>学习设置</strong>
              <em>默认方式与复习安排</em>
            </span>
            <Chevron />
          </button>
        </section>

        <section className="profile-section" aria-labelledby="profile-data-title">
          <div className="profile-section-heading">
            <small>当前状态</small>
            <h2 id="profile-data-title">设备与数据</h2>
          </div>
          <div className="profile-list">
            <div className="profile-row is-static">
              <span className="profile-row-icon"><ProfileIcon kind="sync" /></span>
              <span className="profile-row-copy">
                <strong>数据与同步</strong>
                <small>云端同步尚未接入，当前状态不会跨设备。</small>
              </span>
              <em>仅本机</em>
            </div>
            <div className="profile-row is-static">
              <span className="profile-row-icon is-gold"><ProfileIcon kind="storage" /></span>
              <span className="profile-row-copy">
                <strong>本机存储</strong>
                <small>正式版会在这里显示内容与媒体占用。</small>
              </span>
              <em>筹备中</em>
            </div>
            <div className="profile-row is-static">
              <span className="profile-row-icon is-clay"><ProfileIcon kind="data-control" /></span>
              <span className="profile-row-copy">
                <strong>导出与删除</strong>
                <small>需要正式账号和在线确认后才能使用。</small>
              </span>
              <em>未接入</em>
            </div>
          </div>
        </section>

        <section className="profile-section" aria-labelledby="profile-support-title">
          <div className="profile-section-heading">
            <small>产品信息</small>
            <h2 id="profile-support-title">关于与支持</h2>
          </div>
          <div className="profile-list">
            <button
              type="button"
              className="profile-row"
              onClick={() => toast('Sensa：以一个具体意思与表达的连接为核心，安排首次学习和长期复习。')}
            >
              <span className="profile-row-icon"><ProfileIcon kind="about" /></span>
              <span className="profile-row-copy"><strong>关于 Sensa</strong><small>产品定位与当前版本</small></span>
              <Chevron />
            </button>
            <button
              type="button"
              className="profile-row"
              onClick={() => toast('正式隐私说明将在账号与云端服务接入时提供。')}
            >
              <span className="profile-row-icon is-gold"><ProfileIcon kind="privacy" /></span>
              <span className="profile-row-copy"><strong>隐私说明</strong><small>正式说明随账号服务提供</small></span>
              <Chevron />
            </button>
            <button
              type="button"
              className="profile-row"
              onClick={() => toast('反馈与内容纠错入口尚未接入。')}
            >
              <span className="profile-row-icon is-clay"><ProfileIcon kind="feedback" /></span>
              <span className="profile-row-copy"><strong>反馈与内容纠错</strong><small>正式服务接入后开放</small></span>
              <Chevron />
            </button>
          </div>
        </section>

        <footer className="profile-footer">
          <span className="profile-footer-mark" aria-hidden="true"><i /><i /><i /></span>
          <p><strong>Sensa Web 交互原型</strong><small>账号、同步与数据控制尚未作为生产能力交付</small></p>
        </footer>
      </main>
    </section>
  );
};
