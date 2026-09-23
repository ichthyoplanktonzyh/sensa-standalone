import { iconClass } from '../ui/primitives';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { QuickDictEntry } from '../types';
import { audioService } from '../services/audioService';
import { SensaOverlayLayout } from '../ui/SensaComponents';
import {useTranslation} from 'react-i18next';

interface QuickDictPopupProps {
  entry: QuickDictEntry;
  onClose: () => void;
  /** The second argument preserves the exact contextual result for detail. */
  onViewDetail?: (word: string, entry?: QuickDictEntry) => void;
  toast: (msg: string) => void;
}

export function QuickDictPopup({ entry, onClose, onViewDetail, toast }: QuickDictPopupProps) {
  const {t}=useTranslation('learning');
  const [isPlaying, setIsPlaying] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isLoading = entry.lookupState === 'loading';
  const hasError = entry.lookupState === 'error';
  const targetLanguage = entry.referenceLookup?.release.targetLanguage;
  const learnerLanguage = entry.referenceLookup?.release.learnerLocale;
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
    toast(t('quickDict.detailUnavailable',{word:entry.word}));
  };

  return (
    <SensaOverlayLayout variant="dialog" measure="compact" className="z-[100]" labelledBy="sensa-reference-quick-title" onDismiss={onClose} dismissOnBackdrop aria-busy={isLoading} regions={{
      header: <div className="flex min-h-12 items-center justify-between gap-4">
          <h2 className="font-language text-2xl font-semibold" id="sensa-reference-quick-title" lang={targetLanguage} dir="auto">{entry.word}</h2>
          <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('quickDict.close')}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-close" /></svg>
          </button>
        </div>,
      primary: <div>
        <div className="px-6 pt-5">
          <button
            type="button"
            className={`inline-flex min-h-11 items-center gap-2 rounded-control border-0 px-4 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${isPlaying ? 'bg-action-primary text-action-on-primary' : 'bg-accent-soft text-action-primary hover:bg-surface-selected'}`}
            onClick={handlePlayAudio}
            disabled={isLoading || hasError}
            aria-label={t('quickDict.playUs',{word:entry.word})}
          >
            <svg className={iconClass} aria-hidden="true"><use href="#i-vol-fill" /></svg>
            <span>{t('quickDict.us')} {entry.phonetic}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" aria-label={t('quickDict.briefMeanings')}>
          {(isLoading || hasError) && (
            <div className={`mb-4 flex items-center gap-3 rounded-control p-3 text-body-support ${hasError ? 'bg-surface-subtle text-feedback-danger' : 'bg-accent-soft text-fg-secondary'}`} role="status">
              {isLoading && <i className="size-3 animate-pulse rounded-full bg-progress motion-reduce:animate-none" aria-hidden="true" />}
              <p>{t(isLoading?'quickDict.loading':'quickDict.error')}</p>
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
              <p
                className="text-body-support leading-6"
                lang={entry.referenceLookup?.entry.senses.find((source) => source.referenceSenseId === sense.referenceSenseId)?.glossL1 ? learnerLanguage : targetLanguage}
                dir="auto"
              >
                {sense.text}
              </p>
            </div>
            );
          })}
          {entry.senses.length === 0 && !isLoading && !hasError && (
            <p className="rounded-control border border-dashed border-border-strong p-5 text-body-support leading-6 text-fg-secondary">
              {t('quickDict.noBriefMeanings')}
            </p>
          )}
        </div>
      </div>,
      controls:
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" type="button" onClick={handleDetailClick} disabled={isLoading || hasError}>
            {t(isLoading?'quickDict.querying':hasError?'quickDict.unavailable':'quickDict.viewDetails')}
            <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
    }} />
  );
}
