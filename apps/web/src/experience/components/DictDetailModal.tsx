import { uiClass } from '../ui/classes';
import { useState, useEffect, type MouseEvent } from 'react';
import { contentAnnotations } from '../../data/library/contentAnnotations';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { lookupWord } from '../services/quickDict';
import { audioService } from '../services/audioService';

interface DictDetailModalProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string | null;
  initialTab?: string;
  onClose: () => void;
  toast: (msg: string) => void;
}

const TABS = ['柯林斯', '例句', '派生', '词根', '近义', '真题', '笔记'];

export const DictDetailModal = ({
  active,
  wordData,
  initialTab = '柯林斯',
  onClose,
  toast,
}: DictDetailModalProps) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isStarred, setIsStarred] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [userNote, setUserNote] = useState('');

  // 统一提取单词信息
  let wordStr = '';
  if (wordData) {
    if (typeof wordData === 'string') {
      wordStr = wordData;
    } else if ('w' in wordData) {
      wordStr = wordData.w;
    } else {
      wordStr = wordData.word;
    }
  }

  // 同步外部 initialTab
  useEffect(() => {
    if (initialTab && TABS.includes(initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // 监听该词的笔记变化
  useEffect(() => {
    if (wordStr) {
      setUserNote(contentAnnotations.getNote(wordStr));
      const unsub = contentAnnotations.subscribe(() => {
        setUserNote(contentAnnotations.getNote(wordStr));
      });
      return unsub;
    }
  }, [wordStr]);

  if (!active || !wordData) return null;

  // 优先从 WORDS 主库匹配完整对象，若无则通过 quickDict 组装
  const fullWord: Word | undefined = WORDS.find(
    (w) => w.w.toLowerCase() === wordStr.toLowerCase()
  );
  const quickEntry = lookupWord(wordStr);

  const phonetic = fullWord?.ph || quickEntry.phonetic || `/${wordStr}/`;
  const briefDef = fullWord
    ? fullWord.senses.map((s) => `${s.pos} ${s.items.join('；')}`).join('  ')
    : quickEntry.senses.map((s) => `${s.pos} ${s.text}`).join('  ');

  // 发音朗读
  const handleSpeak = (e?: MouseEvent) => {
    e?.stopPropagation();
    setIsPlayingAudio(true);
    audioService
      .playWord(wordStr, 'us')
      .finally(() => setIsPlayingAudio(false));
  };

  const handleToggleStar = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !isStarred;
    setIsStarred(next);
    toast(next ? `已收藏 "${wordStr}"` : `已取消收藏 "${wordStr}"`);
  };

  const handleAddNote = async () => {
    if (!userNote.trim()) {
      toast('请输入笔记内容');
      return;
    }
    try {
      await contentAnnotations.setNote(wordStr, userNote.trim());
      toast('已保存笔记');
    } catch {
      toast('保存笔记失败，请重试');
    }
  };

  return (
    <div className={uiClass(`dict-modal-backdrop${active ? ' active' : ''}`)} onClick={onClose}>
      <div
        className={uiClass("dict-modal-sheet")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部中央拖拽条与右上角序号 */}
        <div className={uiClass("dict-sheet-handle-bar")}>
          <div className={uiClass("dict-drag-pill")} />
          <span className={uiClass("dict-pg-label")}>1.</span>
        </div>

        {/* 单词主体 Header */}
        <div className={uiClass("dict-sheet-head")}>
          <div className={uiClass("dict-head-top")}>
            <h1 className={uiClass("dict-head-word")}>{wordStr}</h1>
            <button
              className={uiClass(`dict-star-btn${isStarred ? ' on' : ''}`)}
              onClick={handleToggleStar}
              aria-label="收藏单词"
            >
              <svg
                className={uiClass("icon")}
                style={{
                  width: 24,
                  height: 24,
                  fill: isStarred ? '#f2701c' : 'none',
                  stroke: isStarred ? '#f2701c' : '#71717a',
                }}
              >
                <use href="#i-star" />
              </svg>
            </button>
          </div>

          {/* 音标发音行 */}
          <div className={uiClass("dict-ph-row")} onClick={handleSpeak} title="点击朗读">
            <span className={uiClass(`dict-accent-pill${isPlayingAudio ? ' playing' : ''}`)}>
              美
              <svg className={uiClass("icon")} style={{ width: 13, height: 13, marginLeft: 2 }}>
                <use href="#i-vol-fill" />
              </svg>
            </span>
            <span className={uiClass("dict-ph-text")}>{phonetic}</span>
          </div>

          {/* 简明释义行 */}
          <div className={uiClass("dict-brief-def")}>{briefDef}</div>
        </div>

        {/* 多维横向 Tab 栏：柯林斯 | 例句 | 派生 | 词根 | 近义 | 真题 | 笔记 */}
        <div className={uiClass("dict-tab-bar-wrap")}>
          <div className={uiClass("dict-tab-bar")}>
            {TABS.map((tab) => (
              <button
                key={tab}
                className={uiClass(`dict-tab-item${tab === activeTab ? ' on' : ''}`)}
                onClick={() => setActiveTab(tab)}
              >
                <span>{tab}</span>
                {tab === activeTab && <i className={uiClass("dict-tab-line")} />}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 滚动内容区域 */}
        <div className={uiClass("dict-tab-content-body")}>
          {/* ================= 1. 柯林斯 Tab (1:1 截图还原) ================= */}
          {activeTab === '柯林斯' && (
            <div className={uiClass("dict-pane dict-pane-collins")}>
              {/* 红色柯林斯图书封面与授权介绍 */}
              <div className={uiClass("collins-auth-card")}>
                <div className={uiClass("collins-book-cover")}>
                  <div className={uiClass("collins-book-spine")} />
                  <div className={uiClass("collins-book-sub")}>Collins</div>
                  <div className={uiClass("collins-book-mid")}>ENGLISH-CHINESE</div>
                  <div className={uiClass("collins-book-title")}>柯林斯<br />英汉双解<br />大词典</div>
                </div>
                <div className={uiClass("collins-auth-info")}>
                  <h3 className={uiClass("collins-auth-title")}>《柯林斯英汉双解大词典》</h3>
                  <p className={uiClass("collins-auth-desc")}>
                    由哈珀·柯林斯出版社授权，不背单词团队倾力制作。
                  </p>
                </div>
              </div>

              {/* 四大核心特色列表 */}
              <div className={uiClass("collins-features-list")}>
                <div className={uiClass("collins-feature-item")}>
                  <span className={uiClass("feature-dot")}>◎</span>
                  <span>20万词条，包含大量的派生词、短语和习语</span>
                </div>
                <div className={uiClass("collins-feature-item")}>
                  <span className={uiClass("feature-dot")}>◎</span>
                  <span>3000词汇就看得懂的英文释义和精准的中文释义</span>
                </div>
                <div className={uiClass("collins-feature-item")}>
                  <span className={uiClass("feature-dot")}>◎</span>
                  <span>6万来源于 Bank of English 的真实例句</span>
                </div>
                <div className={uiClass("collins-feature-item")}>
                  <span className={uiClass("feature-dot")}>◎</span>
                  <span>特别标注词频和四六级、专业四八级词汇</span>
                </div>
              </div>

              {/* 核心知识点全新呈现 标语 */}
              <div className={uiClass("collins-promo-hero")}>
                <h2 className={uiClass("promo-title-orange")}>核心知识点全新呈现</h2>
                <h2 className={uiClass("promo-title-black")}>海量词汇全方位透析</h2>
              </div>

              {/* 词典条目深度透析卡片 */}
              <div className={uiClass("collins-entry-preview")}>
                <div className={uiClass("collins-preview-hd")}>
                  <span className={uiClass("c-entry-word")}>{wordStr}</span>
                  <div className={uiClass("c-entry-meta")}>
                    <span className={uiClass("c-stars")}>★★★★★</span>
                    <span className={uiClass("c-tag")}>CET4</span>
                    <span className={uiClass("c-tag")}>TEM4</span>
                  </div>
                </div>
                <div className={uiClass("collins-preview-def-box")}>
                  <p className={uiClass("c-en-def")}>
                    {fullWord?.def || `Used to connect words of the same part of speech, clauses, or sentences.`}
                  </p>
                  <p className={uiClass("c-zh-def")}>
                    {briefDef}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ================= 2. 例句 Tab ================= */}
          {activeTab === '例句' && (
            <div className={uiClass("dict-pane dict-pane-sentences")}>
              {(fullWord?.sentences || [
                {
                  src: '原声语境',
                  theme: 'bbt',
                  en: `We need to understand how <b>${wordStr}</b> functions in real scenarios.`,
                  zh: `我们需要理解这个词在实际场景中的用法。`,
                },
              ]).map((sent, idx) => (
                <div key={idx} className={uiClass("dict-sent-card")}>
                  <div className={uiClass("dict-sent-src")}>
                    <span>{sent.src}</span>
                    <button
                      className={uiClass("dict-sent-audio-btn")}
                      onClick={() => {
                        audioService.playSentence(sent.en.replace(/<[^>]*>/g, ''), 'us');
                      }}
                      aria-label="朗读例句"
                    >
                      <svg className={uiClass("icon")} style={{ width: 14, height: 14 }}><use href="#i-vol-fill" /></svg>
                    </button>
                  </div>
                  <div className={uiClass("dict-sent-en")} dangerouslySetInnerHTML={{ __html: sent.en }} />
                  <div className={uiClass("dict-sent-zh")}>{sent.zh}</div>
                </div>
              ))}
            </div>
          )}

          {/* ================= 3. 派生 Tab ================= */}
          {activeTab === '派生' && (
            <div className={uiClass("dict-pane dict-pane-mnemo")}>
              {(fullWord?.mnemo?.['派生'] || [
                [`${wordStr}ly`, 'adv. 派生形式'],
                [`${wordStr}ness`, 'n. 状态，性质'],
              ]).map(([k, d], idx) => (
                <div key={idx} className={uiClass("dict-mnemo-row")}>
                  <span className={uiClass("m-key")}>{k}</span>
                  <span className={uiClass("m-desc")}>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* ================= 4. 词根 Tab ================= */}
          {activeTab === '词根' && (
            <div className={uiClass("dict-pane dict-pane-mnemo")}>
              {(fullWord?.mnemo?.['词根'] || [
                [`${wordStr.slice(0, 3)}-`, '词根说明：源自古印欧语，表基础关联'],
              ]).map(([k, d], idx) => (
                <div key={idx} className={uiClass("dict-mnemo-row")}>
                  <span className={uiClass("m-key")}>{k}</span>
                  <span className={uiClass("m-desc")}>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* ================= 5. 近义 Tab ================= */}
          {activeTab === '近义' && (
            <div className={uiClass("dict-pane dict-pane-mnemo")}>
              {(fullWord?.mnemo?.['近义'] || [
                ['plus', 'prep./n. 加上，此外'],
                ['together with', '短语 与……一起'],
              ]).map(([k, d], idx) => (
                <div key={idx} className={uiClass("dict-mnemo-row")}>
                  <span className={uiClass("m-key")}>{k}</span>
                  <span className={uiClass("m-desc")}>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* ================= 6. 真题 Tab ================= */}
          {activeTab === '真题' && (
            <div className={uiClass("dict-pane dict-pane-exam")}>
              <div className={uiClass("dict-exam-tag-hd")}>
                <span className={uiClass("exam-freq-pill")}>历年真题出现 48 次</span>
                <span className={uiClass("exam-type-pill")}>CET-4 / CET-6 / 考研英语</span>
              </div>
              <div className={uiClass("dict-sent-card")}>
                <div className={uiClass("dict-sent-src")}>
                  <span>2022年12月 大学英语四级真题</span>
                </div>
                <div className={uiClass("dict-sent-en")}>
                  The study shows a strong correlation between healthy lifestyle <b>and</b> academic performance.
                </div>
                <div className={uiClass("dict-sent-zh")}>研究表明，健康的生活方式与学业表现之间存在密切联系。</div>
              </div>
              <div className={uiClass("dict-sent-card")}>
                <div className={uiClass("dict-sent-src")}>
                  <span>2021年 全国硕士研究生入学统一考试</span>
                </div>
                <div className={uiClass("dict-sent-en")}>
                  Technological innovations <b>and</b> environmental policies must go hand in hand.
                </div>
                <div className={uiClass("dict-sent-zh")}>技术创新与环境政策必须齐头并进。</div>
              </div>
            </div>
          )}

          {/* ================= 7. 笔记 Tab ================= */}
          {activeTab === '笔记' && (
            <div className={uiClass("dict-pane dict-pane-notes")}>
              <div className={uiClass("dict-note-input-box")}>
                <textarea
                  className={uiClass("dict-note-textarea")}
                  placeholder="写下你对该词的专属助记、考点笔记或联想…"
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value)}
                  rows={3}
                />
                <div className={uiClass("dict-note-act")}>
                  <button className={uiClass("dict-note-submit-btn")} onClick={handleAddNote}>
                    保存笔记
                  </button>
                </div>
              </div>

              <div className={uiClass("dict-notes-list")}>
                {userNote ? (
                  <div className={uiClass("dict-note-item user-note")}>
                    <div className={uiClass("note-hd")}>
                      <span className={uiClass("note-author")}>我的专属笔记</span>
                      <span className={uiClass("note-time")}>已保存</span>
                    </div>
                    <p className={uiClass("note-content")}>{userNote}</p>
                  </div>
                ) : null}

                <div className={uiClass("dict-note-item community-note")}>
                  <div className={uiClass("note-hd")}>
                    <span className={uiClass("note-author")}>精选助记 · 考霸笔记</span>
                    <span className={uiClass("note-badge")}>精选</span>
                  </div>
                  <p className={uiClass("note-content")}>
                    💡 记忆技巧：结合经典影视句型进行高频情境记忆，重点关注该词与介词的固定句型搭配。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部右下角悬浮关闭按钮 (Floating Close Action Button) */}
        <button
          className={uiClass("dict-fab-close-btn")}
          onClick={onClose}
          aria-label="关闭词典详情"
          title="关闭"
        >
          <svg className={uiClass("icon")} style={{ width: 22, height: 22 }}>
            <use href="#i-close" />
          </svg>
        </button>
      </div>
    </div>
  );
};
