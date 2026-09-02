import { useEffect, useMemo, useState } from 'react';
import {
  contentSectionMeta,
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from '../contentProjection';
import type { PracticeSenseItem } from '../practiceData';
import { useContentProjection } from '../useContentProjection';

interface ContentLibraryScreenProps {
  active: boolean;
  section: ContentSectionId;
  onBack: () => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  onOpenExample: (item: SavedExampleItem) => void;
  onEditNote: (item: ContentNoteItem) => void;
}

const SenseRow = ({ item, onOpen }: { item: PracticeSenseItem; onOpen: () => void }) => (
  <button className="content-list-item" onClick={onOpen}>
    <span className="content-word-mark">{item.word.slice(0, 1).toUpperCase()}</span>
    <span className="content-list-copy">
      <span className="content-list-title">
        {item.word}<em>{item.pos}</em>
      </span>
      <span className="content-list-subtitle">{item.meaning}</span>
    </span>
    <svg className="chev"><use href="#i-chev-r" /></svg>
  </button>
);

const EmptyState = ({ section }: { section: ContentSectionId }) => {
  const copy: Record<ContentSectionId, { icon: string; title: string; body: string }> = {
    recent: { icon: '◷', title: '还没有可显示的学习记录', body: '完成具体意思的学习后，它会按时间出现在这里。' },
    learned: { icon: '✓', title: '还没有已学意思', body: '开始今天的学习，你形成过连接的意思会留在这里。' },
    known: { icon: '◎', title: '还没有已会声明', body: '只有明确标记为“这个意思已会”的内容才会出现。' },
    'saved-senses': { icon: '☆', title: '还没有收藏意思', body: '在意思详情或自由练习中点收藏，稍后从这里回来。' },
    'saved-examples': { icon: '“', title: '还没有收藏例句', body: '看到值得反复体会的例句时，可以单独保存它。' },
    notes: { icon: '✎', title: '还没有笔记', body: '给某个具体意思写下自己的理解，它会出现在这里。' },
  };
  const item = copy[section];
  return (
    <div className="content-empty">
      <span className="content-empty-icon" aria-hidden="true">{item.icon}</span>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
    </div>
  );
};

export const ContentLibraryScreen = ({
  active,
  section,
  onBack,
  onOpenSense,
  onOpenExample,
  onEditNote,
}: ContentLibraryScreenProps) => {
  const projection = useContentProjection();
  const [query, setQuery] = useState('');
  const meta = contentSectionMeta[section];

  useEffect(() => setQuery(''), [section]);

  const senseItems = section === 'recent'
    ? projection.recent
    : section === 'learned'
      ? projection.learned
      : section === 'known'
        ? projection.known
        : section === 'saved-senses'
          ? projection.savedSenses
          : [];
  const exampleItems = section === 'saved-examples' ? projection.savedExamples : [];
  const noteItems = section === 'notes' ? projection.notes : [];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSenses = useMemo(() => senseItems.filter((item) =>
    !normalizedQuery || `${item.word} ${item.pos} ${item.meaning}`.toLowerCase().includes(normalizedQuery)
  ), [senseItems, normalizedQuery]);
  const filteredExamples = useMemo(() => exampleItems.filter(({ sense }) =>
    !normalizedQuery || `${sense.word} ${sense.meaning} ${sense.example.text} ${sense.example.translation}`
      .toLowerCase().includes(normalizedQuery)
  ), [exampleItems, normalizedQuery]);
  const filteredNotes = useMemo(() => noteItems.filter((item) =>
    !normalizedQuery || `${item.word} ${item.body}`.toLowerCase().includes(normalizedQuery)
  ), [noteItems, normalizedQuery]);

  const total = senseItems.length + exampleItems.length + noteItems.length;
  const filteredTotal = filteredSenses.length + filteredExamples.length + filteredNotes.length;

  return (
    <section className={`screen content-subscreen${active ? ' active' : ''}`} id="s-content-library" data-anim="slide">
      <header className="content-nav">
        <button className="content-nav-back" onClick={onBack} aria-label="返回我的内容">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{meta.title}</h1>
        <span className="content-nav-count">{total}</span>
      </header>

      <div className="content-page-body">
        <p className="content-page-intro">{meta.description}</p>
        <label className="content-search">
          <svg className="icon"><use href="#i-search" /></svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="只搜索我的内容"
            aria-label={`搜索${meta.title}`}
          />
          {query && <button onClick={() => setQuery('')} aria-label="清空搜索">×</button>}
        </label>

        {filteredTotal === 0 ? (
          query ? (
            <div className="content-empty content-empty-compact">
              <span className="content-empty-icon" aria-hidden="true">⌕</span>
              <h3>没有匹配内容</h3>
              <p>这里不会搜索全局词典，只检索你的个人内容。</p>
            </div>
          ) : <EmptyState section={section} />
        ) : (
          <div className="content-list-card">
            {filteredSenses.map((item) => (
              <SenseRow key={item.senseId} item={item} onOpen={() => onOpenSense(item)} />
            ))}

            {filteredExamples.map((item) => (
              <button
                className="content-list-item content-example-row"
                key={item.exampleId}
                onClick={() => onOpenExample(item)}
              >
                <span className="content-word-mark content-word-mark-example">“</span>
                <span className="content-list-copy">
                  <span className="content-list-title">
                    {item.sense.word}<em>{item.sense.pos}</em>
                  </span>
                  <span className="content-example-copy">{item.sense.example.text}</span>
                  <span className="content-list-subtitle">{item.sense.example.translation}</span>
                </span>
                <svg className="chev"><use href="#i-chev-r" /></svg>
              </button>
            ))}

            {filteredNotes.map((item) => (
              <button
                className="content-list-item content-note-row"
                key={item.noteId}
                onClick={() => onEditNote(item)}
              >
                <span className="content-word-mark content-word-mark-note">
                  <svg className="icon"><use href="#i-pen" /></svg>
                </span>
                <span className="content-list-copy">
                  <span className="content-list-title">
                    {item.word}{item.sense && !item.isLegacy && <em>{item.sense.pos}</em>}
                  </span>
                  <span className="content-note-preview">{item.body}</span>
                  {item.isLegacy && (
                    <span className="content-migration-label">
                      {item.candidateCount > 1
                        ? `旧笔记：待从 ${item.candidateCount} 个意思中选择`
                        : item.candidateCount === 1
                          ? '旧词头笔记：待迁移到这个意思'
                          : '旧笔记：待绑定具体意思'}
                    </span>
                  )}
                </span>
                <svg className="chev"><use href="#i-chev-r" /></svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
