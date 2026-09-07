import { useEffect, useId, useRef, useState } from 'react';
import { Volume2, X, ArrowUpRight } from 'lucide-react';
import type { QuickDictEntry } from '../../types';
import { audioService } from '../../services/audioService';
import { setupButton, setupPrimary } from '../learning/LearningSetupFrame';

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
  const loading = entry.lookupState === 'loading';
  const failed = entry.lookupState === 'error';
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
    if (playing) { playback.current += 1; audioService.stop(); setPlaying(false); return; }
    const token = ++playback.current;
    setPlaying(true);
    try {
      if (entry.audioUrl) await audioService.playAudioUrl(entry.audioUrl, entry.word, 'us');
      else await audioService.playWord(entry.word, 'us');
    } catch {
      if (token === playback.current) toast('发音暂时无法播放，请重试');
    } finally {
      if (token === playback.current) setPlaying(false);
    }
  };

  return <div className="absolute inset-0 z-[120] flex items-end justify-center bg-[#242a38]/30 sm:items-center sm:p-6" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading}
      className="max-h-[85%] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 text-[#242a38] shadow-xl sm:rounded-3xl sm:p-8"
      onClick={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs text-[#68748d]">例句查词</p><h2 id={titleId} className="mt-2 break-words text-2xl font-medium">{entry.word}</h2></div>
        <button type="button" className={setupButton + ' size-11 px-0 hover:bg-[#edf0f7]'} aria-label="关闭快速查词" onClick={onClose}><X size={20}/></button>
      </header>
      {!loading && !failed && <button type="button" onClick={() => void play()} className={setupButton + ' mt-4 bg-[#edf0f7] text-[#303f76]'} aria-label={playing ? '停止发音' : `播放 ${entry.word} 的美式发音`}><Volume2 size={18}/>{playing ? '停止发音' : `美 ${entry.phonetic}`}</button>}
      <div className="my-6 space-y-3" aria-label="简明义项">
        {(loading || failed) && <p role="status" className="rounded-2xl bg-[#f5f6fa] p-4 text-sm leading-7 text-[#68748d]">{entry.lookupMessage}{failed && ' 关闭后可再次点击单词查询。'}</p>}
        {!loading && !failed && entry.senses.map((sense, index) => <div key={sense.referenceSenseId ?? index} className={'rounded-2xl p-4 text-sm leading-7 ' + (selected && sense.referenceSenseId === selected ? 'bg-[#edf0f7] text-[#303f76]' : 'border border-[#e1e5ed]')}>
          {selected && sense.referenceSenseId === selected && <p className="mb-1 text-xs">{resolution?.status === 'model_confident' ? '根据语境推测' : '这句话中的意思'}</p>}
          <span className="mr-2 text-[#68748d]">{sense.pos}</span>{sense.text}
        </div>)}
        {!loading && !failed && entry.senses.length === 0 && <p role="status" className="text-sm text-[#68748d]">暂无简明释义，可查看完整词条。</p>}
      </div>
      <button type="button" className={setupPrimary + ' w-full'} disabled={loading || failed || !onViewDetail} onClick={() => onViewDetail?.(entry)}>查看详细释义<ArrowUpRight size={18}/></button>
      <p className="mt-3 text-center text-xs text-[#68748d]">查词不会改变学习进度</p>
    </section>
  </div>;
}
