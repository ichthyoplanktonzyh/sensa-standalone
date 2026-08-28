import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { storageService } from '../services/storageService';
import { audioService } from '../services/audioService';

interface WordListScreenProps {
  active: boolean;
  bookTitle?: string;
  totalBookWords?: number;
  onBack: () => void;
  onOpenDict: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onOpenSpelling: (word?: Word | QuickDictEntry | string) => void;
  toast: (msg: string) => void;
}

type FilterTab = 'all' | 'unlearned' | 'reviewing' | 'completed' | 'mastered';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unlearned', label: '未学习' },
  { key: 'reviewing', label: '复习中' },
  { key: 'completed', label: '复习完成' },
  { key: 'mastered', label: '已标熟' },
];

export const WordListScreen = ({
  active,
  bookTitle = 'COCA 20000 (上)',
  totalBookWords = 5585,
  onBack,
  onOpenDict,
  onOpenSpelling,
  toast,
}: WordListScreenProps) => {
  // 1. 分类 Tab 状态
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // 2. 右上角眼睛图标展开模式 (false: 仅看英文默认态, true: 带睫毛闭眼/全部展开详情态)
  const [showAllDetails, setShowAllDetails] = useState<boolean>(false);

  // 3. 当前选中的高亮单词 ID (默认选中第一个词)
  const [activeWordId, setActiveWordId] = useState<string>(() => WORDS[0]?.id || 'w_the');

  // 4. 搜索框状态
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 5. 更多菜单浮层状态
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  // 6. 排序模式
  const [sortOrder, setSortOrder] = useState<'default' | 'alpha' | 'shuffle'>('default');

  // 7. 同步 storage 状态 (生词本收藏、标熟、FSRS)
  const [starredWords, setStarredWords] = useState<Set<string>>(() => storageService.getStarredWords());
  const [knownWords, setKnownWords] = useState<Set<string>>(() => storageService.getKnownWords());

  useEffect(() => {
    const unsub = storageService.subscribe(() => {
      setStarredWords(new Set(storageService.getStarredWords()));
      setKnownWords(new Set(storageService.getKnownWords()));
    });
    return unsub;
  }, []);

  // 单词过滤与排序计算
  const filteredWords = useMemo(() => {
    let list = [...WORDS];

    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((w) => {
        const matchWord = w.w.toLowerCase().includes(q);
        const matchSense = w.senses.some((s) => s.items.some((it) => it.includes(q)) || s.pos.includes(q));
        const matchDef = w.def && w.def.toLowerCase().includes(q);
        return matchWord || matchSense || matchDef;
      });
    }

    // 状态分类过滤
    if (activeTab !== 'all') {
      list = list.filter((w) => {
        const status = storageService.getWordLearningStatus(w);
        return status === activeTab;
      });
    }

    // 排序
    if (sortOrder === 'alpha') {
      list.sort((a, b) => a.w.localeCompare(b.w));
    }

    return list;
  }, [searchQuery, activeTab, sortOrder, starredWords, knownWords]);

  // 切换眼睛模式
  const handleToggleEye = () => {
    const next = !showAllDetails;
    setShowAllDetails(next);
    toast(next ? '已开启全部单词释义详情' : '已收起全部释义，进入纯享刷词态');
  };

  // 点击单行单词
  const handleWordClick = (word: Word) => {
    setActiveWordId(word.id || `w_${word.w}`);
    // 自动轻发音
    audioService.playWord(word.w, 'us');
  };

  // 点击发音
  const handlePlayAudio = (e: MouseEvent, wordStr: string) => {
    e.stopPropagation();
    audioService.playWord(wordStr, 'us');
  };

  // 点击收藏
  const handleToggleStar = (e: MouseEvent, word: Word) => {
    e.stopPropagation();
    const next = storageService.toggleStar(word.w);
    toast(next ? `已添加 "${word.w}" 到生词本` : `已从生词本移除 "${word.w}"`);
  };

  // 点击词典详情
  const handleOpenDictModal = (e: MouseEvent, word: Word) => {
    e.stopPropagation();
    onOpenDict(word, '柯林斯');
  };

  // 查找当前激活的单词对象
  const currentActiveWord = useMemo(() => {
    return filteredWords.find((w) => (w.id || `w_${w.w}`) === activeWordId) || filteredWords[0] || WORDS[0];
  }, [filteredWords, activeWordId]);

  return (
    <section
      className={`screen wordlist-screen${active ? ' active' : ''}`}
      id="s-wordlist"
      data-anim="sheet"
    >
      {/* ================= 1. 顶部 Header ================= */}
      <header className="wl-header">
        <button className="wl-back-btn" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>

        <h1 className="wl-title" title={bookTitle}>
          {bookTitle.length > 12 ? `${bookTitle.slice(0, 11)}…` : bookTitle}
        </h1>

        <div className="wl-actions">
          {/* 搜索按钮 */}
          <button
            className={`wl-btn${isSearchOpen ? ' on' : ''}`}
            onClick={() => {
              setIsSearchOpen(!isSearchOpen);
              if (isSearchOpen) setSearchQuery('');
            }}
            aria-label="搜索单词"
          >
            <svg className="icon"><use href="#i-search" /></svg>
          </button>

          {/* 眼睛展开/收起切换按钮 (图1 vs 图2) */}
          <button
            className={`wl-btn wl-eye-btn${showAllDetails ? ' active-eye' : ''}`}
            onClick={handleToggleEye}
            aria-label={showAllDetails ? '收起全部释义' : '展开全部释义'}
            title={showAllDetails ? '收起释义' : '展开释义'}
          >
            <svg className="icon">
              <use href={showAllDetails ? '#i-eye-lashes' : '#i-eye'} />
            </svg>
          </button>

          {/* 更多菜单按钮 */}
          <button
            className="wl-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            aria-label="更多操作"
          >
            <svg className="icon"><use href="#i-more-h" /></svg>
          </button>
        </div>
      </header>

      {/* 搜索输入条 (可展开) */}
      {isSearchOpen && (
        <div className="wl-search-bar">
          <div className="wl-search-inner">
            <svg className="icon wl-search-icon"><use href="#i-search" /></svg>
            <input
              type="text"
              className="wl-search-input"
              placeholder="搜索单词拼写或中文释义…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                className="wl-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="清空输入"
              >
                <svg className="icon"><use href="#i-close" /></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ================= 2. 分类 Tabs 胶囊栏 (Filter Tabs) ================= */}
      <div className="wl-tabs-wrap">
        <div className="wl-tabs-capsule">
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                className={`wl-tab-item${isSelected ? ' on' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= 3. 词数统计栏 ================= */}
      <div className="wl-count-bar">
        <span className="wl-count-accent" />
        <span className="wl-count-text">
          {activeTab === 'all' && !searchQuery
            ? `${totalBookWords}词`
            : `${filteredWords.length}词`}
        </span>
      </div>

      {/* ================= 4. 核心单词列表 (Word List) ================= */}
      <div className="wl-list-container">
        {filteredWords.length === 0 ? (
          <div className="wl-empty-tip">
            <p>该分类下暂无单词</p>
            {searchQuery && (
              <button className="wl-empty-btn" onClick={() => setSearchQuery('')}>
                清除搜索
              </button>
            )}
          </div>
        ) : (
          filteredWords.map((w) => {
            const id = w.id || `w_${w.w}`;
            const isCurrentActive = id === activeWordId;
            // 判断此行是否展开详情（全展模式 或 当前单点展开）
            const isExpanded = showAllDetails || isCurrentActive;
            const isStarred = starredWords.has(w.w.toLowerCase());

            return (
              <div
                key={id}
                className={`wl-word-row${isCurrentActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}`}
                onClick={() => handleWordClick(w)}
              >
                <div className="wl-row-content">
                  {/* 第一行：单词 + (展开时显示音标) */}
                  <div className="wl-row-head">
                    <span className="wl-word-title">{w.w}</span>
                    {isExpanded && w.ph && (
                      <span
                        className="wl-word-ph"
                        onClick={(e) => handlePlayAudio(e, w.w)}
                        title="点击发音"
                      >
                        {w.ph}
                      </span>
                    )}
                  </div>

                  {/* 展开态：显示词性与中文释义多行列表 */}
                  {isExpanded && (
                    <div className="wl-row-defs">
                      {w.senses && w.senses.length > 0 ? (
                        w.senses.map((s, sIdx) => (
                          <div key={sIdx} className="wl-def-line">
                            <span className="wl-def-pos">{s.pos}</span>
                            <span className="wl-def-text">{s.items.join('；')}</span>
                          </div>
                        ))
                      ) : (
                        <div className="wl-def-line">
                          <span className="wl-def-text" dangerouslySetInnerHTML={{ __html: w.def || '暂无释义' }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 展开态右侧快捷操作：收藏星标 + 词典详情 */}
                {isExpanded && (
                  <div className="wl-row-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`wl-tool-btn star-btn${isStarred ? ' on' : ''}`}
                      onClick={(e) => handleToggleStar(e, w)}
                      aria-label="收藏至生词本"
                    >
                      <svg
                        className="icon"
                        style={{
                          width: 21,
                          height: 21,
                          fill: isStarred ? '#f2701c' : 'none',
                          stroke: isStarred ? '#f2701c' : '#888892',
                        }}
                      >
                        <use href="#i-star" />
                      </svg>
                    </button>

                    <button
                      className="wl-tool-btn dict-btn"
                      onClick={(e) => handleOpenDictModal(e, w)}
                      aria-label="查看柯林斯双解词典详情"
                    >
                      <svg className="icon" style={{ width: 21, height: 21, color: '#888892' }}>
                        <use href="#i-list-menu" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 底部垫高空间，防止被悬浮操作栏遮挡 */}
        <div className="wl-bottom-spacer" />
      </div>

      {/* ================= 5. 底部悬浮功能卡 (Floating Bottom Island) ================= */}
      <div className="wl-floating-bar-island">
        <button
          className="wl-float-btn"
          onClick={() => toast('沉浸刷词：全屏无干扰快速刷词模式')}
        >
          <span className="wl-float-icon">
            <svg className="icon"><use href="#i-bolt-card" /></svg>
          </span>
          <span className="wl-float-label">沉浸刷词</span>
        </button>

        <button
          className="wl-float-btn"
          onClick={() => {
            toast(`随身听已启动：正在按顺序连续播放本词书单词语音`);
            if (currentActiveWord) {
              audioService.playWord(currentActiveWord.w, 'us');
            }
          }}
        >
          <span className="wl-float-icon">
            <svg className="icon"><use href="#i-head" /></svg>
          </span>
          <span className="wl-float-label">随身听</span>
        </button>

        <button
          className="wl-float-btn"
          onClick={() => toast(`听写练习：开始 ${filteredWords.length || 20} 词听写测验`)}
        >
          <span className="wl-float-icon">
            <svg className="icon"><use href="#i-write" /></svg>
          </span>
          <span className="wl-float-label">听写</span>
        </button>

        <button
          className="wl-float-btn"
          onClick={() => {
            onOpenSpelling(currentActiveWord);
          }}
        >
          <span className="wl-float-icon">
            <svg className="icon"><use href="#i-abc" /></svg>
          </span>
          <span className="wl-float-label">随手拼</span>
        </button>

        <button
          className="wl-float-btn"
          onClick={() => toast(`正在生成 ${bookTitle} 高清 PDF 词表并导出…`)}
        >
          <span className="wl-float-icon">
            <span className="wl-pdf-badge">PDF</span>
            <svg className="icon"><use href="#i-doc-pdf" /></svg>
          </span>
          <span className="wl-float-label">导出</span>
        </button>
      </div>

      {/* 顶部更多菜单 Popover */}
      {menuOpen && (
        <>
          <div className="wl-menu-mask" onClick={() => setMenuOpen(false)} />
          <div className="wl-more-popover">
            <div className="wl-menu-title">词书设置与操作</div>
            <button
              className="wl-menu-item"
              onClick={() => {
                setSortOrder(sortOrder === 'alpha' ? 'default' : 'alpha');
                setMenuOpen(false);
                toast(sortOrder === 'alpha' ? '已恢复词频顺序' : '已切换为 A-Z 字母排序');
              }}
            >
              <svg className="icon"><use href="#i-filter" /></svg>
              <span>{sortOrder === 'alpha' ? '恢复词频排序' : '按 A-Z 字母排序'}</span>
            </button>
            <button
              className="wl-menu-item"
              onClick={() => {
                setMenuOpen(false);
                toast('已将当前筛选范围标记为熟词');
              }}
            >
              <svg className="icon"><use href="#i-chk" /></svg>
              <span>批量标记为熟词</span>
            </button>
            <button
              className="wl-menu-item"
              onClick={() => {
                setMenuOpen(false);
                toast('开始下载离线高清原声例句包 (48.2MB)…');
              }}
            >
              <svg className="icon"><use href="#i-dl" /></svg>
              <span>下载离线语音例句包</span>
            </button>
            <button
              className="wl-menu-item"
              onClick={() => {
                setMenuOpen(false);
                toast('已重置词书学习进度');
              }}
            >
              <svg className="icon"><use href="#i-relearn" /></svg>
              <span>重学当前词书</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
};
