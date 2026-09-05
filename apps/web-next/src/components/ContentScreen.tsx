import { useMemo, useState } from 'react';
import {
  type ContentSectionId,
  type PersonalMeaningItem,
  type SemanticSenseItem,
} from '../contentProjection';
import { useContentProjection } from '../useContentProjection';

interface ContentScreenProps {
  active: boolean;
  onBack: () => void;
  onCreatePersonalMeaning: () => void;
  onOpenPersonalMeaning: (personalMeaningId: string) => void;
  onOpenSense: (senseId: string) => void;
  onOpenSection: (section: ContentSectionId) => void;
}

type WorldLayer = 'all' | 'personal' | 'learning' | 'markers';

const phaseCopy: Record<PersonalMeaningItem['phase'], { label: string; action: string }> = {
  unclarified: { label: '待澄清', action: '开始澄清' },
  focus_pending_acceptance: { label: '待确认关注点', action: '继续确认' },
  focus_accepted: { label: '正在理解', action: '继续形成' },
  constructing: { label: '正在澄清', action: '继续澄清' },
  proposal_ready: { label: '待确认意思', action: '确认这个意思' },
  sense_confirmed_expression_pending: { label: '待连接表达', action: '连接表达' },
  aligned: { label: '已形成连接', action: '查看个人意义' },
};

const personalMeaningLabel = (item: PersonalMeaningItem): string =>
  item.semanticAnchors[0]?.bodyText
  || item.familiarExpressions[0]?.surfaceForm
  || item.primaryLabel;

const personalMeaningSearchText = (item: PersonalMeaningItem): string => [
  item.primaryLabel,
  ...item.semanticAnchors.map((anchor) => anchor.bodyText),
  ...item.familiarExpressions.map((expression) => expression.surfaceForm),
].join(' ').toLocaleLowerCase();

const learningSenseSearchText = (item: SemanticSenseItem): string => [
  item.expression.formL2,
  item.expression.partOfSpeech,
  item.ground.labelL1,
  item.ground.bridgeL1,
  item.ground.experienceL1,
  ...item.ground.featureLabelsL1,
].join(' ').toLocaleLowerCase();

const PersonalMeaningRow = ({
  item,
  onOpen,
}: {
  item: PersonalMeaningItem;
  onOpen: () => void;
}) => {
  const familiar = item.familiarExpressions[0]?.surfaceForm ?? null;
  const label = personalMeaningLabel(item);
  return (
    <button type="button" className="content-world-entry is-personal" onClick={onOpen}>
      <span className="content-world-entry-mark" aria-hidden="true"><i /></span>
      <span className="content-world-entry-copy">
        <small>由我建立 · {phaseCopy[item.phase].label}</small>
        <b>{label}</b>
        {familiar && familiar !== label && <span>{familiar}</span>}
      </span>
      <span className="content-world-entry-meta">
        {item.confirmedExpressionCount > 0 && <em>{item.confirmedExpressionCount} 个表达</em>}
        <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
      </span>
    </button>
  );
};

const LearningSenseRow = ({
  item,
  saved,
  noted,
  onOpen,
}: {
  item: SemanticSenseItem;
  saved: boolean;
  noted: boolean;
  onOpen: () => void;
}) => (
  <button type="button" className="content-world-entry is-learning" onClick={onOpen}>
    <span className="content-world-entry-mark" aria-hidden="true"><i /></span>
    <span className="content-world-entry-copy">
      <small>学习中浮现</small>
      <b className="is-expression">{item.expression.formL2}<em>{item.expression.partOfSpeech}</em></b>
      <span>{item.ground.labelL1}</span>
    </span>
    <span className="content-world-entry-meta">
      {(saved || noted) && (
        <span className="content-world-entry-flags" aria-label={[saved ? '已收藏' : '', noted ? '有笔记' : ''].filter(Boolean).join('，')}>
          {saved && <svg className="icon" aria-hidden="true"><use href="#i-star" /></svg>}
          {noted && <svg className="icon" aria-hidden="true"><use href="#i-pen" /></svg>}
        </span>
      )}
      <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
    </span>
  </button>
);

const EmptyWorld = ({
  mode,
  onCreate,
}: {
  mode: 'world' | 'search' | 'layer';
  onCreate: () => void;
}) => {
  const copy = mode === 'search'
    ? { title: '没有匹配的内容', body: '换一个关键词，或切换到其他图层继续查看。' }
    : mode === 'layer'
      ? { title: '这个图层还没有内容', body: '切换到全部，看看已经出现在语义世界里的其他内容。' }
      : { title: '从一个真正想表达的意思开始', body: '记录一段真实经验或熟悉表达，再慢慢澄清它对应的意思。' };
  return (
    <div className="content-world-empty" role="status">
      <span className="content-world-empty-orbit" aria-hidden="true"><i /><i /><i /></span>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      {mode === 'world' && <button type="button" onClick={onCreate}>记录第一个意思</button>}
    </div>
  );
};

export const ContentScreen = ({
  active,
  onBack,
  onCreatePersonalMeaning,
  onOpenPersonalMeaning,
  onOpenSense,
  onOpenSection,
}: ContentScreenProps) => {
  const projection = useContentProjection();
  const [layer, setLayer] = useState<WorldLayer>('all');
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const personalMeanings = useMemo(
    () => projection.personalMeanings
      .filter((item) => !normalizedQuery || personalMeaningSearchText(item).includes(normalizedQuery))
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [normalizedQuery, projection.personalMeanings],
  );
  const learningSenses = useMemo(
    () => projection.semanticSenses.filter(
      (item) => !normalizedQuery || learningSenseSearchText(item).includes(normalizedQuery),
    ),
    [normalizedQuery, projection.semanticSenses],
  );

  const pendingMeanings = projection.personalMeanings
    .filter((item) => item.phase !== 'aligned')
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const nextMeaning = pendingMeanings[0] ?? null;
  const confirmedMeanings = projection.personalMeanings.filter(
    (item) => item.confirmedSenseCount > 0,
  ).length;
  const savedSenseIds = new Set(projection.savedSenses.map((item) => item.senseId));
  const notedSenseIds = new Set(
    projection.notes.flatMap((item) => item.sense && !item.isLegacy ? [item.sense.senseId] : []),
  );
  const markerCount = projection.savedSenses.length
    + projection.savedExamples.length
    + projection.notes.length;
  const hasProjectedItems = personalMeanings.length > 0 || learningSenses.length > 0;

  const layers: Array<{ id: WorldLayer; label: string; count?: number }> = [
    { id: 'all', label: '全部' },
    { id: 'personal', label: '我建立的', count: projection.personalMeanings.length },
    { id: 'learning', label: '学习连接', count: projection.semanticSenses.length },
    { id: 'markers', label: '我的标记', count: markerCount },
  ];

  return (
    <section className={`screen content-hub-screen content-world-screen${active ? ' active' : ''}`} id="s-content" data-anim="sheet">
      <header className="content-world-header">
        <button type="button" onClick={onBack} aria-label="返回首页">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <div>
          <small>我的内容</small>
          <h1>我的语义世界</h1>
        </div>
        <span className="content-world-mark" aria-hidden="true"><i /><i /><i /></span>
      </header>

      <main className="content-world-body">
        <section className="content-world-intro">
          <span className="content-world-intro-contour" aria-hidden="true" />
          <small>从我的经验出发</small>
          <h2>
            {projection.personalMeanings.length > 0
              ? '让每一个意思，慢慢长出清晰的表达'
              : '把真正想表达的意思，留在这里'}
          </h2>
          <p>这里呈现你建立的个人意义，以及学习中逐渐浮现的词义连接。</p>
          <div className="content-world-facts" aria-label="语义世界事实概况">
            <span><b>{projection.personalMeanings.length}</b><small>个人意义</small></span>
            <span><b>{confirmedMeanings}</b><small>已确认意思</small></span>
            <span><b>{projection.semanticSenses.length}</b><small>学习连接</small></span>
          </div>
        </section>

        {nextMeaning && (
          <button
            type="button"
            className="content-world-continue"
            onClick={() => onOpenPersonalMeaning(nextMeaning.personalMeaningId)}
          >
            <span className="content-world-continue-pulse" aria-hidden="true" />
            <span>
              <small>待继续 · {phaseCopy[nextMeaning.phase].label}</small>
              <b>{personalMeaningLabel(nextMeaning)}</b>
            </span>
            <em>{phaseCopy[nextMeaning.phase].action}</em>
            <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        )}

        {layer !== 'markers' && (
          <label className="content-world-search">
            <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索我的经验、意思或表达"
              aria-label="搜索我的语义世界"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">×</button>
            )}
          </label>
        )}

        <div className="content-world-layers" role="group" aria-label="语义世界图层">
          {layers.map((item) => (
            <button
              type="button"
              aria-pressed={layer === item.id}
              className={layer === item.id ? 'is-active' : ''}
              key={item.id}
              onClick={() => setLayer(item.id)}
            >
              <span>{item.label}</span>
              {item.count !== undefined && <small>{item.count}</small>}
            </button>
          ))}
        </div>

        <section className="content-world-surface">
          {layer === 'markers' ? (
            <>
              <header className="content-world-section-heading">
                <span><small>个人内容</small><b>我的标记</b></span>
                <em>不改变学习状态</em>
              </header>
              <div className="content-world-marker-list">
                <button type="button" onClick={() => onOpenSection('saved-senses')}>
                  <span className="is-saved"><svg className="icon" aria-hidden="true"><use href="#i-star" /></svg></span>
                  <b>收藏的意思</b><small>{projection.savedSenses.length}</small>
                  <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
                </button>
                <button type="button" onClick={() => onOpenSection('saved-examples')}>
                  <span className="is-example"><svg className="icon" aria-hidden="true"><use href="#i-quote" /></svg></span>
                  <b>收藏的例句</b><small>{projection.savedExamples.length}</small>
                  <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
                </button>
                <button type="button" onClick={() => onOpenSection('notes')}>
                  <span className="is-note"><svg className="icon" aria-hidden="true"><use href="#i-pen" /></svg></span>
                  <b>我的笔记</b><small>{projection.notes.length}</small>
                  <svg className="chev" aria-hidden="true"><use href="#i-chev-r" /></svg>
                </button>
              </div>
              {markerCount === 0 && (
                <p className="content-world-marker-note">收藏和笔记会叠加在对应意思上，不会自动加入学习。</p>
              )}
            </>
          ) : !hasProjectedItems || (
            layer === 'personal' && personalMeanings.length === 0
          ) || (
            layer === 'learning' && learningSenses.length === 0
          ) ? (
            <EmptyWorld
              mode={normalizedQuery ? 'search' : layer === 'all' ? 'world' : 'layer'}
              onCreate={onCreatePersonalMeaning}
            />
          ) : (
            <>
              {(layer === 'all' || layer === 'personal') && personalMeanings.length > 0 && (
                <section className="content-world-source-layer is-personal">
                  <header className="content-world-section-heading">
                    <span><small>个人意义</small><b>由我建立</b></span>
                    <em>{personalMeanings.length} 个个人意义</em>
                  </header>
                  <div className="content-world-entry-list">
                    {personalMeanings.map((item) => (
                      <PersonalMeaningRow
                        key={item.personalMeaningId}
                        item={item}
                        onOpen={() => onOpenPersonalMeaning(item.personalMeaningId)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {(layer === 'all' || layer === 'learning') && learningSenses.length > 0 && (
                <section className="content-world-source-layer is-learning">
                  <header className="content-world-section-heading">
                    <span><small>学习事实</small><b>学习中浮现</b></span>
                    <em>{learningSenses.length} 个意思</em>
                  </header>
                  <div className="content-world-entry-list">
                    {learningSenses.map((item) => (
                      <LearningSenseRow
                        key={item.senseId}
                        item={item}
                        saved={savedSenseIds.has(item.senseId)}
                        noted={notedSenseIds.has(item.senseId)}
                        onOpen={() => onOpenSense(item.senseId)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </section>

        <p className="content-world-boundary">
          不同来源在这里共同呈现，但个人意义、学习事实、收藏与笔记仍保持各自身份。
        </p>
      </main>

      <footer className="content-world-create-bar">
        <button type="button" onClick={onCreatePersonalMeaning}>
          <span aria-hidden="true">＋</span>
          记录一个想表达的意思
        </button>
      </footer>
    </section>
  );
};
