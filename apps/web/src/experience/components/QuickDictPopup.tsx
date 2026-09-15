import { iconClass } from '../ui/primitives';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { QuickDictEntry } from '../types';
import { audioService } from '../services/audioService';
import { useDictionaryPresentation } from './DictionaryPresentationContext';

interface QuickDictPopupProps {
  entry: QuickDictEntry;
  onClose: () => void;
  /** The second argument preserves the exact contextual result for detail. */
  onViewDetail?: (word: string, entry?: QuickDictEntry) => void;
  toast: (msg: string) => void;
}

function BaselineQuickDictPopup({ entry, onClose, onViewDetail, toast }: QuickDictPopupProps) {
  const [isStarred, setIsStarred] = useState(entry.isStarred || false);
  const [isPlaying, setIsPlaying] = useState(false);
  const isLoading = entry.lookupState === 'loading';
  const hasError = entry.lookupState === 'error';

  const handlePlayAudio = (event: MouseEvent) => {
    event.stopPropagation();
    if (isLoading || hasError) return;
    setIsPlaying(true);
    audioService.playWord(entry.word, 'us').finally(() => setIsPlaying(false));
  };

  const handleToggleStar = (event: MouseEvent) => {
    event.stopPropagation();
    if (isLoading || hasError) return;
    const next = !isStarred;
    setIsStarred(next);
    toast(next ? `已将 "${entry.word}" 加入生词本` : `已取消收藏 "${entry.word}"`);
  };

  const handleDetailClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (isLoading || hasError) return;
    if (onViewDetail) {
      onViewDetail(entry.word);
    } else {
      toast(`查看 "${entry.word}" 的完整词典详释`);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-t-overlay border border-border-subtle bg-surface-raised text-fg-primary shadow-overlay sm:rounded-overlay"
        aria-busy={isLoading}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-6 py-5">
          <span className="font-language text-2xl font-semibold">{entry.word}</span>
          <button
            className={`grid size-11 place-items-center rounded-control border-0 focus-visible:outline-2 focus-visible:outline-focus ${isStarred ? 'bg-accent-soft text-decorative' : 'bg-transparent text-fg-secondary hover:bg-surface-subtle'}`}
            onClick={handleToggleStar}
            disabled={isLoading || hasError}
            aria-label="收藏生词"
          >
            <svg
              className={`${iconClass} size-[22px] ${isStarred ? 'fill-current' : ''}`}
              aria-hidden="true"
            >
              <use href="#i-star" />
            </svg>
          </button>
        </div>

        <button className="flex min-h-12 w-full items-center gap-3 border-0 bg-transparent px-6 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={handlePlayAudio} title="点击朗读单词">
          <span className={`inline-flex items-center rounded-pill px-3 py-1 text-metadata font-semibold ${isPlaying ? 'bg-action-primary text-action-on-primary' : 'bg-accent-soft text-action-primary'}`}>
            美
            <svg className={`${iconClass} ml-1 size-3.5`} aria-hidden="true">
              <use href="#i-vol-fill" />
            </svg>
          </span>
          <span className="font-language text-body-support text-fg-secondary">{entry.phonetic}</span>
        </button>

        <div className="max-h-[45vh] overflow-y-auto px-6 py-4">
          {(isLoading || hasError) && (
            <p className={`rounded-control p-3 text-body-support ${hasError ? 'bg-surface-subtle text-feedback-danger' : 'bg-accent-soft text-fg-secondary'}`} role="status">
              {entry.lookupMessage}
            </p>
          )}
          {entry.senses.map((sense, index) => (
            <div key={index} className="grid grid-cols-[3rem_1fr] gap-3 border-border-subtle py-3 [&+div]:border-t">
              {sense.pos && <span className="text-metadata font-semibold text-fg-tertiary">{sense.pos}</span>}
              <span className="text-body-support leading-6 text-fg-primary">{sense.text}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border-subtle p-4">
          <button
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus"
            onClick={handleDetailClick}
            disabled={isLoading || hasError}
          >
            {isLoading ? '正在查询…' : hasError ? '暂不可用' : '查看详细释义'}
            <svg className="size-4 shrink-0" aria-hidden="true">
              <use href="#i-chev-r" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function SensaQuickDictPopup({ entry, onClose, onViewDetail, toast }: QuickDictPopupProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isLoading = entry.lookupState === 'loading';
  const hasError = entry.lookupState === 'error';
  const resolution = entry.referenceLookup?.contextualResolution;
  const selectedSenseId = resolution && (
    resolution.status === 'authored_target'
    || resolution.status === 'reviewed'
    || resolution.status === 'model_confident'
  )
    ? resolution.referenceSenseId
    : undefined;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const handlePlayAudio = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isLoading || hasError) return;
    setIsPlaying(true);
    audioService.playWord(entry.word, 'us').finally(() => setIsPlaying(false));
  };

  const handleDetailClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isLoading || hasError) return;
    if (onViewDetail) {
      onViewDetail(entry.word, entry);
      return;
    }
    toast(`"${entry.word}" 的完整 Reference 条目暂不可用`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-6" onClick={onClose}>
      <section
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-t-overlay border border-border-subtle bg-surface-raised text-fg-primary shadow-overlay sm:max-h-[min(44rem,calc(100vh-3rem))] sm:rounded-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensa-reference-quick-title"
        aria-busy={isLoading}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border-subtle px-6 py-4">
          <h2 className="font-language text-2xl font-semibold" id="sensa-reference-quick-title">{entry.word}</h2>
          <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭快速查词">
            <svg className={iconClass} aria-hidden="true"><use href="#i-close" /></svg>
          </button>
        </header>

        <div className="px-6 pt-5">
          <button
            type="button"
            className={`inline-flex min-h-11 items-center gap-2 rounded-control border-0 px-4 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${isPlaying ? 'bg-action-primary text-action-on-primary' : 'bg-accent-soft text-action-primary hover:bg-surface-selected'}`}
            onClick={handlePlayAudio}
            disabled={isLoading || hasError}
            aria-label={`播放 ${entry.word} 的美式发音`}
          >
            <svg className={iconClass} aria-hidden="true"><use href="#i-vol-fill" /></svg>
            <span>美 {entry.phonetic}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" aria-label="简明义项">
          {(isLoading || hasError) && (
            <div className={`mb-4 flex items-center gap-3 rounded-control p-3 text-body-support ${hasError ? 'bg-surface-subtle text-feedback-danger' : 'bg-accent-soft text-fg-secondary'}`} role="status">
              {isLoading && <i className="size-3 animate-pulse rounded-full bg-progress motion-reduce:animate-none" aria-hidden="true" />}
              <p>{entry.lookupMessage}</p>
            </div>
          )}
          {entry.senses.map((sense, index) => {
            const isSelected = sense.referenceSenseId === selectedSenseId;
            return (
            <div
              key={`${sense.referenceSenseId ?? sense.pos}:${sense.text}:${index}`}
              className={`grid grid-cols-[3rem_1fr] gap-3 border-border-subtle px-3 py-4 [&+div]:border-t ${isSelected ? 'rounded-control border-transparent bg-surface-selected' : ''}`}
            >
              <span className="text-metadata font-semibold text-fg-tertiary">{sense.pos || '—'}</span>
              <p className="text-body-support leading-6">
                {sense.text}
              </p>
            </div>
            );
          })}
          {entry.senses.length === 0 && !isLoading && !hasError && (
            <p className="rounded-control border border-dashed border-border-strong p-5 text-body-support leading-6 text-fg-secondary">
              当前没有可展示的 Reference 简明义项，请查看完整词条。
            </p>
          )}
        </div>

        <footer className="border-t border-border-subtle p-4">
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" type="button" onClick={handleDetailClick} disabled={isLoading || hasError}>
            {isLoading ? '正在查询…' : hasError ? '暂不可用' : '查看详细释义'}
            <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </footer>
      </section>
    </div>
  );
}

export const QuickDictPopup = (props: QuickDictPopupProps) => {
  const presentation = useDictionaryPresentation();
  return presentation === 'baseline'
    ? <BaselineQuickDictPopup {...props} />
    : <SensaQuickDictPopup {...props} />;
};
