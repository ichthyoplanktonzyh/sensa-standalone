import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
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
    <section className={slideScreenClass(active)} id="s-content-coming" data-anim="slide" aria-hidden={!active}>
      <header className={contentNavigationClass}>
        <button className={contentNavigationBackClass} onClick={onBack} aria-label="返回我的语义世界">
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{page.title}</h1>
        <span />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-8 py-12 text-center sm:px-12">
        <div className="relative mb-8 grid size-36 place-items-center overflow-hidden rounded-overlay border border-border-subtle bg-accent-soft text-action-primary" aria-hidden="true">
          <span>{page.glyph}</span>
          <i className="absolute left-7 top-8 size-3 rounded-full bg-progress" />
          <i className="absolute right-6 top-14 size-3 rounded-full bg-decorative" />
          <i className="absolute bottom-6 left-14 size-3 rounded-full bg-action-primary" />
        </div>
        <span className="text-metadata font-bold tracking-[0.16em] text-fg-tertiary">{page.eyebrow}</span>
        <h2 className="mt-2 text-page-title font-semibold">{page.title}</h2>
        <p className="mt-3 max-w-lg text-body-support leading-7 text-fg-secondary">{page.description}</p>
        <div className="mt-7 w-full rounded-card border border-border-subtle bg-surface-panel px-4 text-left">
          {page.points.map((point) => (
            <div className="flex min-h-12 items-center gap-3 border-border-subtle text-body-support text-fg-secondary [&+div]:border-t" key={point}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-metadata font-bold text-feedback-success">✓</span>
              {point}
            </div>
          ))}
        </div>
        <div className="mt-7 rounded-pill bg-surface-subtle px-4 py-2 text-control-label font-semibold text-fg-secondary">暂未开放</div>
        <small className="mt-3 max-w-md text-metadata leading-5 text-fg-tertiary">当前页面只确认信息架构，不会创建任何个人内容或学习记录。</small>
      </div>
    </section>
  );
};
