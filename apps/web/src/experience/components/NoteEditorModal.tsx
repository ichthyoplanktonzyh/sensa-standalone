import '../../i18n/contentResources';
import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { useState, useEffect, useRef } from 'react';
import { personalContentSystem, SenseNoteConflictError, type SenseNoteSnapshot, type PersonalContentCommand } from '../../personalContent/system';
import type { Word, QuickDictEntry } from '../types';
import { SensaOverlayLayout } from '../ui/SensaComponents';
import { Check, X } from 'lucide-react';

interface NoteEditorModalProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string;
  senseId: string;
  senseMeaning: string;
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
  const {t} = useTranslation();
  const [noteText, setNoteText] = useState('');
  const [base, setBase] = useState<SenseNoteSnapshot | null>(null);
  const [conflict, setConflict] = useState<SenseNoteSnapshot | null>(null);
  const [notice, setNotice] = useState<'readFailed' | 'unconfirmed' | 'savedReadFailed' | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingSave = useRef<Extract<PersonalContentCommand, {kind:'set_sense_note'}> | null>(null);
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

  // An editor must start from durable truth, not the list's presentation cache.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setBase(null);setConflict(null);setNotice(null);setNoteText('');pendingSave.current=null;
    void personalContentSystem.readSenseNote(senseId).then(current => {
      if (cancelled) return;
      setBase(current);setNoteText(current.body);
    }).catch(() => {if (!cancelled) setNotice('readFailed');});
    return () => {cancelled=true;};
  }, [active, senseId, readAttempt]);

  useEffect(() => {
    if (!active || !base) return;
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(noteText.length, noteText.length);
  }, [active, base]);

  useEffect(() => {
    if (!active) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || savingRef.current) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [active, onClose]);

  if (!active) return null;

  const handleSave = async (replace?: SenseNoteSnapshot) => {
    if (savingRef.current || !base || (conflict && !replace)) return;
    const request = pendingSave.current ?? {
      kind: 'set_sense_note' as const,
      operationId: crypto.randomUUID(),
      senseId,
      body: noteText,
      expected: replace ?? base,
    };
    pendingSave.current=request;
    if (replace) {setBase(replace);setConflict(null);}
    savingRef.current = true;
    setSaving(true);
    try {
      const result=await personalContentSystem.execute(request);
      if (!result.projectionUpdated) {setNotice('savedReadFailed');return;}
      pendingSave.current=null;
      toast(uiText('noteSaved'));
      if (onSave) onSave(result.note.body);
      onClose();
    } catch (error) {
      if (error instanceof SenseNoteConflictError) {
        pendingSave.current=null;setConflict(error.current);setNotice(null);
      } else {
        // Preserve this exact intent for a lost-response retry; do not create a
        // new operation which might overwrite an intervening device edit.
        setNotice('unconfirmed');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <SensaOverlayLayout variant="sheet" measure="standard" className="sensa-note-editor z-[120]" label={uiText('noteFor', { word: wordStr })} regions={{
      header: <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center text-center [&>button]:grid [&>button]:size-11 [&>button]:place-items-center [&>button]:rounded-control [&>button]:bg-accent-soft [&>button]:text-fg-secondary [&>button]:transition-colors [&>button:hover]:bg-surface-selected [&>button:focus-visible]:outline-2 [&>button:focus-visible]:outline-offset-3 [&>button:focus-visible]:outline-focus motion-reduce:[&>button]:transition-none">
          <button type="button" disabled={saving} onClick={onClose} aria-label={uiText('close')}>
            <X className="size-5 shrink-0" aria-hidden="true" />
          </button>
          <div>
            <h2 className="text-section-title font-medium">{uiText('myNotes')}</h2>
          </div>
          <button type="button" disabled={saving || !base || !!conflict} onClick={() => void handleSave()} aria-label={notice==='savedReadFailed'?t('meaningGovernance.retryRead'):uiText('saveNote')}>
            <Check className="size-5 shrink-0" aria-hidden="true" />
          </button>
        </div>,
      primary: <div className="flex min-h-full flex-col">
        <div className="mb-5 flex max-w-full items-baseline self-center gap-2 border-y border-border-subtle py-6">
          <strong className="font-language text-page-title font-semibold text-fg-primary">{wordStr}</strong>
          {senseMeaning && <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-body-support text-fg-tertiary">{senseMeaning}</span>}
        </div>

        <main className="flex min-h-[385px] flex-1 flex-col rounded-card border border-border-subtle bg-surface-panel p-5">
          <label className="text-control-label font-semibold text-fg-secondary" htmlFor="personal-sense-note">{uiText('notePrompt')}</label>
          {!base && <div role="status" className="py-4 text-body-support">{t(`noteEditor.${notice==='readFailed'?'readFailed':'loading'}`)}{notice==='readFailed'&&<button type="button" className="ml-3 underline" onClick={()=>setReadAttempt(value=>value+1)}>{t('meaningGovernance.retryRead')}</button>}</div>}
          {base && <textarea
            id="personal-sense-note"
            ref={textareaRef}
            className="mt-3 min-h-56 flex-1 resize-none bg-transparent text-body text-fg-primary outline-none placeholder:text-fg-tertiary focus-visible:rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            placeholder={uiText('notePlaceholder')}
            value={noteText}
            disabled={saving || !!pendingSave.current}
            maxLength={1000}
            onChange={(e) => setNoteText(e.target.value)}
          />}
          {notice && notice!=='readFailed' && <p role="alert" className="mt-3 text-body-support text-fg-secondary">{t(`noteEditor.${notice}`)}</p>}
          {conflict && <section role="alert" className="my-3 rounded-card border border-border-subtle p-3 text-body-support">
            <p>{t('noteEditor.changed')}</p>
            <h3 className="mt-3 font-semibold">{t('noteEditor.latest')}</h3>
            <p className="mt-1 whitespace-pre-wrap break-words">{conflict.body || t('noteEditor.empty')}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={saving} className="underline" onClick={()=>{setBase(conflict);setNoteText(conflict.body);setConflict(null);}}>{t('noteEditor.useLatest')}</button>
              <button type="button" disabled={saving} className="underline" onClick={()=>void handleSave(conflict)}>{t('noteEditor.saveMine')}</button>
            </div>
          </section>}
          <footer className="flex items-center justify-between border-t border-border-subtle pt-3 text-metadata text-fg-tertiary">
            <span>{uiText('noteScope')}</span>
            <b className="font-semibold text-fg-secondary">{noteText.length}/1000</b>
          </footer>
        </main>
      </div>,
    }} />
  );
};
