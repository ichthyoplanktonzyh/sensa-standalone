import { uiClass } from '../ui/classes';
interface ContentComingSoonScreenProps {
  active: boolean;
  kind: 'scenes' | 'collections';
  onBack: () => void;
}

const content = {
  scenes: {
    eyebrow: 'PERSONAL SEMANTIC ANCHORS',
    title: '我的场景',
    description: '把一个具体意思连接到你真实经历过的场景，让这份连接只属于你。',
    points: ['绑定到一个具体意思', '记录文字、图片或其他个人线索', '不作为标准例句或正确答案'],
    glyph: '◌',
  },
  collections: {
    eyebrow: 'PERSONAL COLLECTIONS',
    title: '自定义集合',
    description: '按自己的目的整理具体意思和例句，而不改变词书与正式学习计划。',
    points: ['同一集合可包含意思与例句', '删除集合不会删除收藏与正文', '以后可显式选择为自由练习范围'],
    glyph: '⌘',
  },
} as const;

export const ContentComingSoonScreen = ({ active, kind, onBack }: ContentComingSoonScreenProps) => {
  const page = content[kind];
  return (
    <section className={uiClass(`screen content-coming-screen${active ? ' active' : ''}`, "#s-content-coming")} id="s-content-coming" data-anim="slide">
      <header className={uiClass("content-nav")}>
        <button className={uiClass("content-nav-back")} onClick={onBack} aria-label="返回我的内容">
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <h1>{page.title}</h1>
        <span />
      </header>

      <div className={uiClass("content-coming-body")}>
        <div className={uiClass("content-coming-visual")} aria-hidden="true">
          <span>{page.glyph}</span>
          <i /><i /><i />
        </div>
        <span className={uiClass("content-coming-eyebrow")}>{page.eyebrow}</span>
        <h2>{page.title}</h2>
        <p>{page.description}</p>
        <div className={uiClass("content-coming-points")}>
          {page.points.map((point) => (
            <div key={point}><span>✓</span>{point}</div>
          ))}
        </div>
        <div className={uiClass("content-coming-label")}>暂未开放</div>
        <small>当前页面只确认信息架构，不会创建任何个人内容或学习记录。</small>
      </div>
    </section>
  );
};
