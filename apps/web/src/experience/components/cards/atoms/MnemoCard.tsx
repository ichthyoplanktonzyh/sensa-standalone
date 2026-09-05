import { uiClass } from '../../../ui/classes';
import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import type { MnemoData, Word } from '../../../types';
import { noteService } from '../../../services/noteService';

interface MnemoCardProps {
  word: Word;
  mnemo: MnemoData;
  onPlayKey?: (key: string) => void;
  onOpenDict?: () => void;
  onOpenNoteEditor?: () => void;
  toast: (msg: string) => void;
}

const ORDERED_TABS = ['词组搭配', '派生', '词根', '笔记', '近义'];

export const MnemoCard = ({
  word,
  mnemo,
  onPlayKey,
  onOpenDict,
  onOpenNoteEditor,
  toast,
}: MnemoCardProps) => {
  const wordStr = word.w;
  const [userNote, setUserNote] = useState(() => noteService.getNote(wordStr));

  // 监听全局笔记变更
  useEffect(() => {
    setUserNote(noteService.getNote(wordStr));
    const unsubscribe = noteService.subscribe(() => {
      setUserNote(noteService.getNote(wordStr));
    });
    return unsubscribe;
  }, [wordStr]);

  // 根据当前单词的数据模型动态构建可用的 Tab 列表（有数据才展示对应 Tab，笔记 Tab 始终常驻）
  const availableTabs = useMemo(() => {
    const mnemoKeys = Object.keys(mnemo || {}).filter(
      (k) => mnemo[k] && mnemo[k].length > 0
    );

    const tabs: string[] = [];
    ORDERED_TABS.forEach((tab) => {
      if (tab === '笔记') {
        tabs.push('笔记');
      } else if (mnemoKeys.includes(tab)) {
        tabs.push(tab);
      }
    });

    // 补充可能存在的其他非标准 key
    mnemoKeys.forEach((k) => {
      if (!tabs.includes(k)) {
        tabs.push(k);
      }
    });

    return tabs;
  }, [mnemo]);

  const [activeKey, setActiveKey] = useState<string>(
    availableTabs[0] || '词组搭配'
  );

  // 保证切换单词或 Tab 变化时，activeKey 仍有效
  useEffect(() => {
    if (!availableTabs.includes(activeKey) && availableTabs.length > 0) {
      setActiveKey(availableTabs[0]);
    }
  }, [availableTabs, activeKey]);

  const currentItems = mnemo[activeKey] || [];

  return (
    <div className={uiClass("dcard mn-card")}>
      {/* Tab 内容展示区域 */}
      <div className={uiClass("mn-content-body")}>
        {activeKey === '笔记' ? (
          <div className={uiClass("mn-note-body")}>
            {userNote ? (
              <>
                <div className={uiClass("mn-note-text")}>{userNote}</div>
                <button
                  className={uiClass("mn-note-edit-btn")}
                  onClick={() => {
                    if (onOpenNoteEditor) onOpenNoteEditor();
                    else toast('打开笔记编辑');
                  }}
                >
                  <span>编辑笔记</span>
                  <svg className={uiClass("icon")}>
                    <use href="#i-pen" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <div className={uiClass("mn-note-empty-text")}>
                  暂无笔记，记录你的专属助记与考点~
                </div>
                <button
                  className={uiClass("mn-note-edit-btn")}
                  onClick={() => {
                    if (onOpenNoteEditor) onOpenNoteEditor();
                    else toast('打开笔记编辑');
                  }}
                >
                  <span>写笔记</span>
                  <svg className={uiClass("icon")}>
                    <use href="#i-pen" />
                  </svg>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className={uiClass("mn-list", "#mnList")} id="mnList">
            {currentItems.map(([k, d], idx) => (
              <div key={idx} className={uiClass("mn-item")}>
                <span
                  className={uiClass("k")}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    if (onPlayKey) onPlayKey(k);
                    else toast(`🔊 播放发音：${k}`);
                  }}
                >
                  {k}
                </span>
                <span className={uiClass("d")}>{d}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部多维 Tab 导航栏 */}
      <div className={uiClass("mn-tabs", "#mnTabs")} id="mnTabs">
        {availableTabs.map((k) => (
          <button
            key={k}
            className={uiClass(k === activeKey ? 'on' : '')}
            onClick={() => setActiveKey(k)}
          >
            {k}
          </button>
        ))}

        {/* 右侧快捷工具按钮 */}
        <div className={uiClass("sp")}>
          <button
            onClick={() => {
              if (onOpenNoteEditor) onOpenNoteEditor();
              else toast('添加自定义笔记');
            }}
            title="写笔记"
            aria-label="写笔记"
          >
            <svg className={uiClass("icon")}>
              <use href="#i-pen" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (onOpenDict) onOpenDict();
              else toast('查看柯林斯词典释义');
            }}
            title="查看完整词典"
            aria-label="查看完整词典"
          >
            <svg className={uiClass("icon")}>
              <use href="#i-lookup" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
