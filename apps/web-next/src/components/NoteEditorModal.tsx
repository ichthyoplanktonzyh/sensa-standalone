import { useState, useEffect, useRef } from 'react';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { lookupWord } from '../services/quickDict';
import { noteService } from '../services/noteService';

interface NoteEditorModalProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string | null;
  onClose: () => void;
  onSave?: (savedContent: string) => void;
  toast: (msg: string) => void;
}

export const NoteEditorModal = ({
  active,
  wordData,
  onClose,
  onSave,
  toast,
}: NoteEditorModalProps) => {
  const [noteText, setNoteText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 提取单词拼写与简明释义
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

  // 获取完整释义摘要
  const fullWord: Word | undefined = WORDS.find(
    (w) => w.w.toLowerCase() === wordStr.toLowerCase()
  );
  const quickEntry = wordStr ? lookupWord(wordStr) : null;

  let briefDef = '';
  if (fullWord) {
    briefDef = fullWord.senses
      .map((s) => `${s.pos} ${s.items.join('；')}`)
      .join('  ');
  } else if (quickEntry) {
    briefDef = quickEntry.senses
      .map((s) => `${s.pos} ${s.text}`)
      .join('  ');
  }

  // 每次打开或单词变化时加载当前笔记内容
  useEffect(() => {
    if (active && wordStr) {
      const existing = noteService.getNote(wordStr);
      setNoteText(existing);
      // 延时微任务聚焦
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const len = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }, 100);
    }
  }, [active, wordStr]);

  if (!active || !wordData) return null;

  const handleSave = () => {
    noteService.setNote(wordStr, noteText);
    toast('已保存笔记');
    if (onSave) {
      onSave(noteText);
    }
    onClose();
  };

  const handleUpgradeClick = () => {
    toast('会员享受无限量云端笔记与跨端同步');
  };

  return (
    <div
      className={`note-modal-backdrop${active ? ' active' : ''}`}
      onClick={onClose}
    >
      <div
        className="note-modal-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部居中标题：如 "path 的笔记" */}
        <div className="note-modal-header">
          <h2 className="note-modal-title">{wordStr} 的笔记</h2>
        </div>

        {/* 核心输入卡片 */}
        <div className="note-card-box">
          <textarea
            ref={textareaRef}
            className="note-card-textarea"
            placeholder="写下你的笔记..."
            value={noteText}
            maxLength={1000}
            onChange={(e) => setNoteText(e.target.value)}
          />

          {/* 卡片底部信息条：左侧药丸标签+释义，右侧字数 */}
          <div className="note-card-bottom-bar">
            <div className="note-word-info-left">
              <span className="note-word-pill">{wordStr}</span>
              {briefDef && <span className="note-def-text">{briefDef}</span>}
            </div>
            <div className="note-char-counter">{noteText.length}/1000</div>
          </div>
        </div>

        {/* 卡片下方升级提示语 */}
        <div className="note-quota-hint" onClick={handleUpgradeClick}>
          <span>还可记 4 条笔记，点我升级 &gt;</span>
        </div>

        {/* 底部左右两个圆形悬浮操作按钮 */}
        <div className="note-bottom-actions">
          <button
            className="note-circle-btn btn-cancel"
            onClick={onClose}
            aria-label="取消"
            title="取消"
          >
            <svg className="icon">
              <use href="#i-close" />
            </svg>
          </button>

          <button
            className="note-circle-btn btn-save"
            onClick={handleSave}
            aria-label="保存"
            title="保存笔记"
          >
            <svg className="icon">
              <use href="#i-chk-simple" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
