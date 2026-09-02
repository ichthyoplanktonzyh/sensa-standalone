import type { ContentSectionId } from '../contentProjection';
import { useContentProjection } from '../useContentProjection';

interface ContentScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenSemanticWorld: () => void;
  onOpenSection: (section: ContentSectionId) => void;
  onOpenComingSoon: (kind: 'scenes' | 'collections') => void;
}

interface ContentRowProps {
  icon: string;
  title: string;
  description: string;
  value: string;
  tone: 'amber' | 'blue' | 'violet' | 'green';
  onActivate: () => void;
  unavailable?: boolean;
}

const ContentRow = ({
  icon,
  title,
  description,
  value,
  tone,
  onActivate,
  unavailable = false,
}: ContentRowProps) => (
  <button className={`content-hub-row tone-${tone}${unavailable ? ' is-later' : ''}`} onClick={onActivate}>
    <span className="content-hub-icon">
      <svg className="icon"><use href={icon} /></svg>
    </span>
    <span className="content-hub-copy">
      <b>{title}</b>
      <small>{description}</small>
    </span>
    <span className="content-hub-value">{value}</span>
    <svg className="chev"><use href="#i-chev-r" /></svg>
  </button>
);

export const ContentScreen = ({
  active,
  onBack,
  onOpenSemanticWorld,
  onOpenSection,
  onOpenComingSoon,
}: ContentScreenProps) => {
  const projection = useContentProjection();
  const established = projection.semanticSenses.filter((item) => item.status === 'established').length;
  const reinforce = projection.semanticSenses.filter((item) => item.status === 'reinforce').length;

  return (
    <section className={`screen content-hub-screen${active ? ' active' : ''}`} id="s-content" data-anim="sheet">
      <header className="content-hub-header">
        <button onClick={onBack} aria-label="返回首页">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <div>
          <span>PERSONAL LIBRARY</span>
          <h1>我的内容</h1>
        </div>
        <span className="content-hub-avatar">S</span>
      </header>

      <div className="content-hub-body">
        <button className="semantic-entry-card" onClick={onOpenSemanticWorld}>
          <span className="semantic-entry-glow glow-a" />
          <span className="semantic-entry-glow glow-b" />
          <span className="semantic-entry-label">我的个人语义空间</span>
          <strong>我的词义世界</strong>
          <p>看看哪些意思正在形成连接，哪些已经建立，哪些需要再遇见。</p>
          <span className="semantic-entry-facts">
            <span><b>{projection.semanticSenses.length}</b> 已进入世界</span>
            <span><b>{established}</b> 已建立</span>
            <span><b>{reinforce}</b> 待巩固</span>
          </span>
          <span className="semantic-entry-action">进入词义世界 <svg className="icon"><use href="#i-chev-r" /></svg></span>
          <span className="semantic-entry-orbit" aria-hidden="true"><i /><i /><i /><i /></span>
        </button>

        <section className="content-hub-section">
          <div className="content-hub-section-title">
            <span><em>01</em><b>我学过的</b></span>
            <small>学习事实</small>
          </div>
          <div className="content-hub-card">
            <ContentRow icon="#i-calchk" title="最近学过" description="从刚刚形成的连接继续回看" value={`${projection.recent.length}`} tone="amber" onActivate={() => onOpenSection('recent')} />
            <ContentRow icon="#i-chk" title="全部已学" description="浏览所有能定位到具体意思的记录" value={`${projection.learned.length}`} tone="amber" onActivate={() => onOpenSection('learned')} />
            <ContentRow icon="#i-thumb" title="已会的意思" description="你明确声明已经会的具体意思" value={`${projection.known.length}`} tone="amber" onActivate={() => onOpenSection('known')} />
          </div>
        </section>

        <section className="content-hub-section">
          <div className="content-hub-section-title">
            <span><em>02</em><b>我保存的</b></span>
            <small>稍后回来</small>
          </div>
          <div className="content-hub-card">
            <ContentRow icon="#i-star" title="收藏的意思" description="保存具体意思，不自动加入学习" value={`${projection.savedSenses.length}`} tone="blue" onActivate={() => onOpenSection('saved-senses')} />
            <ContentRow icon="#i-quote" title="收藏的例句" description="保留值得反复体会的语境" value={`${projection.savedExamples.length}`} tone="blue" onActivate={() => onOpenSection('saved-examples')} />
          </div>
        </section>

        <section className="content-hub-section">
          <div className="content-hub-section-title">
            <span><em>03</em><b>我创建的</b></span>
            <small>属于我的连接</small>
          </div>
          <div className="content-hub-card">
            <ContentRow icon="#i-pen" title="我的笔记" description="自己的理解、联想与提醒" value={`${projection.notes.length}`} tone="violet" onActivate={() => onOpenSection('notes')} />
            <ContentRow icon="#i-bulb" title="我的场景" description="把意思连接到真实个人经验" value="暂未开放" tone="green" onActivate={() => onOpenComingSoon('scenes')} unavailable />
            <ContentRow icon="#i-note" title="自定义集合" description="按自己的目的整理意思与例句" value="暂未开放" tone="violet" onActivate={() => onOpenComingSoon('collections')} unavailable />
          </div>
        </section>

        <p className="content-hub-footnote">这里只整理你的内容。查一个新单词，请使用全局词典。</p>
      </div>
    </section>
  );
};
