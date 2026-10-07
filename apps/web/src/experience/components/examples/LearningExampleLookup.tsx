import {cardText} from '../../../i18n/originalCards';
import { useEffect, useId, useRef, useState } from 'react';
import { Volume2, X, ArrowUpRight } from 'lucide-react';
import type { QuickDictEntry } from '../../types';
import { audioService } from '../../services/audioService';
import { setupButton, setupPrimary } from '../learning/LearningSetupFrame';
import { SensaOverlayLayout } from '../../ui/SensaComponents';
import {referencePronunciationPresentation} from '../../reference/referencePronunciation';

/** Learning-only lookup presentation. The exact contextual result passes to detail unchanged. */
export function LearningExampleLookup({ entry, onClose, onViewDetail, toast }: {
  entry: QuickDictEntry;
  onClose: () => void;
  onViewDetail?: (entry: QuickDictEntry) => void;
  toast: (message: string) => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const playback = useRef(0);
  const pronunciation=referencePronunciationPresentation(entry);
  const loading = entry.lookupState === 'loading';
  const failed = entry.lookupState === 'error' || entry.lookupState === 'missing';
  const resolution = entry.referenceLookup?.contextualResolution;
  const selected = resolution && ['authored_target', 'reviewed', 'model_confident'].includes(resolution.status)
    ? resolution.referenceSenseId : undefined;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      playback.current += 1;
      audioService.stop();
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  const play = async () => {
    if(!pronunciation)return;
    if (playing) { playback.current += 1; audioService.stop(); setPlaying(false); return; }
    const token = ++playback.current;
    setPlaying(true);
    try {
      await audioService.playReferencePronunciation(pronunciation.input);
    } catch {
      if (token === playback.current) toast(cardText('pronunciationIsUnavailableTryAgain'));
    } finally {
      if (token === playback.current) setPlaying(false);
    }
  };

  return <SensaOverlayLayout variant="dialog" mode="container" measure="compact" className="z-[120]" labelledBy={titleId} panelRef={dialog} onDismiss={onClose} dismissOnBackdrop aria-busy={loading} regions={{
    header: <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs text-fg-secondary">{cardText('lookUpAWord')}</p><h2 id={titleId} className="mt-2 break-words text-2xl font-medium">{entry.word}</h2></div>
        <button type="button" className={setupButton + ' size-11 px-0 hover:bg-surface-selected'} aria-label={cardText('closeWordLookup')} onClick={onClose}><X size={20}/></button>
      </div>,
    primary: <div>
      {!loading && !failed && pronunciation && <button type="button" onClick={() => void play()} className={setupButton + ' mt-4 bg-surface-selected text-action-primary'} aria-label={playing ? cardText('stopPronunciation') : cardText('play',{accent:pronunciation.label,ipa:pronunciation.ipa})}><Volume2 size={18}/>{playing ? cardText('stopPronunciation') : `${pronunciation.label} ${pronunciation.ipa}`}</button>}
      <div className="my-6 space-y-3" aria-label={cardText('briefDefinitions')}>
        {(loading || failed) && <p role="status" className="rounded-card bg-surface-subtle p-4 text-sm leading-7 text-fg-secondary">{entry.lookupMessage}{entry.lookupState==='error' && cardText('closeAndTapTheWordToTryAgain')}</p>}
        {!loading && !failed && entry.senses.map((sense, index) => <div key={sense.referenceSenseId ?? index} className={'rounded-card p-4 text-sm leading-7 ' + (selected && sense.referenceSenseId === selected ? 'bg-surface-selected text-action-primary' : 'border border-border-subtle')}>
          {selected && sense.referenceSenseId === selected && <p className="mb-1 text-xs">{resolution?.status === 'model_confident' ? cardText('inferredFromContext') : cardText('meaningInThisSentence')}</p>}
          <span className="mr-2 text-fg-secondary">{sense.pos}</span>{sense.text}
        </div>)}
        {!loading && !failed && entry.senses.length === 0 && <p role="status" className="text-sm text-fg-secondary">{cardText('noBriefDefinitionIsAvailableOpenTheFull')}</p>}
      </div>
    </div>,
    controls: <div>
      <button type="button" className={setupPrimary + ' w-full'} disabled={loading || failed || !onViewDetail} onClick={() => onViewDetail?.(entry)}>{cardText('viewFullDefinition')}<ArrowUpRight size={18}/></button>
      <p className="mt-3 text-center text-xs text-fg-secondary">{cardText('wordLookupDoesNotChangeLearningProgress')}</p>
    </div>,
  }} />;
}
