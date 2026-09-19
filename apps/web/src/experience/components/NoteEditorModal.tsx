import '../../i18n/contentResources';
import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { useState, useEffect, useRef } from 'react';
import { contentAnnotations } from '../../data/library/contentAnnotations';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { lookupWord } from '../services/quickDict';
import { SensaOverlayLayout } from '../ui/SensaComponents';

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
      const existing = senseId ? contentAnnotations.getSenseNote(senseId) : contentAnnotations.getNote(wordStr);
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

  const handleSave = async () => {
    try {
      if (senseId) await contentAnnotations.setSenseNote(senseId, noteText);
      else await contentAnnotations.setNote(wordStr, noteText);
      toast(uiText('noteSaved'));
      if (onSave) onSave(noteText);
      onClose();
    } catch {
      toast(uiText('saveFailed'));
    }
  };

  return (
    <SensaOverlayLayout variant="sheet" measure="standard" className="sensa-note-editor z-[120]" label={uiText('noteFor', { word: wordStr })} regions={{
      header: <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center text-center [&>button]:grid [&>button]:size-11 [&>button]:place-items-center [&>button]:rounded-control [&>button]:bg-accent-soft [&>button]:text-fg-secondary [&>button]:transition-colors [&>button:hover]:bg-surface-selected [&>button:focus-visible]:outline-2 [&>button:focus-visible]:outline-offset-3 [&>button:focus-visible]:outline-focus motion-reduce:[&>button]:transition-none">
          <button type="button" onClick={onClose} aria-label={uiText('close')}>
            <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-close" /></svg>
          </button>
          <div>
            <h2 className="text-section-title font-medium">{uiText('myNotes')}</h2>
          </div>
          <button type="button" onClick={() => void handleSave()} aria-label={uiText('saveNote')}>
            <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-chk-simple" /></svg>
          </button>
        </div>,
      primary: <div className="flex min-h-full flex-col">
        <div className="mb-5 flex max-w-full items-baseline self-center gap-2 border-y border-border-subtle py-6">
          <strong className="font-language text-page-title font-semibold text-fg-primary">{wordStr}</strong>
          {briefDef && <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-body-support text-fg-tertiary">{briefDef}</span>}
        </div>

        <main className="flex min-h-[385px] flex-1 flex-col rounded-card border border-border-subtle bg-surface-panel p-5">
          <label className="text-control-label font-semibold text-fg-secondary" htmlFor="personal-sense-note">{uiText('notePrompt')}</label>
          <textarea
            id="personal-sense-note"
            ref={textareaRef}
            className="mt-3 min-h-56 flex-1 resize-none bg-transparent text-body text-fg-primary outline-none placeholder:text-fg-tertiary focus-visible:rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            placeholder={uiText('notePlaceholder')}
            value={noteText}
            maxLength={1000}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <footer className="flex items-center justify-between border-t border-border-subtle pt-3 text-metadata text-fg-tertiary">
            <span>{uiText('noteScope')}</span>
            <b className="font-semibold text-fg-secondary">{noteText.length}/1000</b>
          </footer>
        </main>
      </div>,
    }} />
  );
};
