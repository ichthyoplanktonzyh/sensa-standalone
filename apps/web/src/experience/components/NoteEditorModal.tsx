import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
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
  useTranslation();
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
    toast(uiText('noteSaved'));
    if (onSave) {
      onSave(noteText);
    }
    onClose();
  };

  return (
    <div className={uiClass(`personal-note-backdrop${active ? ' active' : ''}`)}>
      <div
        className={uiClass("personal-note-sheet")}
        role="dialog"
        aria-modal="true"
        aria-label={uiText('noteFor', { word: wordStr })}
      >
        <header className={uiClass("personal-note-header")}>
          <button type="button" onClick={onClose} aria-label={uiText('close')}>
            <svg className={uiClass("icon")}><use href="#i-close" /></svg>
          </button>
          <div>

            <h2>{uiText('myNotes')}</h2>
          </div>
          <button type="button" onClick={handleSave} aria-label={uiText('saveNote')}>
            <svg className={uiClass("icon")}><use href="#i-chk-simple" /></svg>
          </button>
        </header>

        <div className={uiClass("personal-note-sense")}>
          <strong>{wordStr}</strong>
          {briefDef && <span>{briefDef}</span>}
        </div>

        <main className={uiClass("personal-note-canvas")}>
          <label htmlFor="personal-sense-note">{uiText('notePrompt')}</label>
          <textarea
            id="personal-sense-note"
            ref={textareaRef}
            placeholder={uiText('notePlaceholder')}
            value={noteText}
            maxLength={1000}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <footer>
            <span>{uiText('noteScope')}</span>
            <b>{noteText.length}/1000</b>
          </footer>
        </main>


      </div>
    </div>
  );
};
