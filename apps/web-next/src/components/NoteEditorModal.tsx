import { useState, useEffect, useRef } from 'react';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { lookupWord } from '../services/quickDict';
import { noteService } from '../services/noteService';

interface NoteEditorModalProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string | null;
  senseId?: string;
  senseMeaning?: string;
  onClose: () => void;
  onSave?: (savedContent: string) => void;
  toast: (msg: string) => void;
}

export const NoteEditorModal = ({
  active,
  wordData,
  senseId,
  senseMeaning,
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
  if (senseMeaning) {
    briefDef = senseMeaning;
  } else if (fullWord) {
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
      const existing = senseId ? noteService.getSenseNote(senseId) : noteService.getNote(wordStr);
      setNoteText(existing);
      const focusTimer = window.setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const len = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(len, len);
        }
      }, 180);
      return () => window.clearTimeout(focusTimer);
    }
  }, [active, senseId, wordStr]);

  if (!active || !wordData) return null;

  const handleSave = () => {
    if (senseId) noteService.setSenseNote(senseId, noteText);
    else noteService.setNote(wordStr, noteText);
    toast('已保存笔记');
    if (onSave) {
      onSave(noteText);
    }
    onClose();
  };

  return (
    <div className={`personal-note-backdrop${active ? ' active' : ''}`}>
      <div
        className="personal-note-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${wordStr} 的个人笔记`}
      >
        <header className="personal-note-header">
          <button type="button" onClick={onClose} aria-label="关闭笔记编辑">
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
          <div>
            <span>PERSONAL SENSE NOTE</span>
            <h2>我的笔记</h2>
          </div>
          <button type="button" onClick={handleSave} aria-label="保存笔记">
            <svg className="icon"><use href="#i-chk-simple" /></svg>
          </button>
        </header>

        <div className="personal-note-sense">
          <strong>{wordStr}</strong>
          {briefDef && <span>{briefDef}</span>}
        </div>

        <main className="personal-note-canvas">
          <label htmlFor="personal-sense-note">此刻，你想为这个意思留下什么？</label>
          <textarea
            id="personal-sense-note"
            ref={textareaRef}
            placeholder="写下自己的理解、提醒，或一句以后想再看到的话……"
            value={noteText}
            maxLength={1000}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <footer>
            <span>只绑定当前具体意思</span>
            <b>{noteText.length}/1000</b>
          </footer>
        </main>

        <p className="personal-note-privacy">
          这条笔记只属于你；它不会被解析成标准释义、正确答案或学习证据。
        </p>
      </div>
    </div>
  );
};
