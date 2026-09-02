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
    <div className="quick-dict-overlay" onClick={onClose}>
      <div
        className="quick-dict-popup"
        aria-busy={isLoading}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dict-pop-hd">
          <span className="dict-pop-word">{entry.word}</span>
          <button
            className={`dict-pop-star${isStarred ? ' on' : ''}`}
            onClick={handleToggleStar}
            disabled={isLoading || hasError}
            aria-label="收藏生词"
          >
            <svg
              className="icon"
              style={{
                width: 22,
                height: 22,
                fill: isStarred ? '#f2701c' : 'none',
                stroke: isStarred ? '#f2701c' : '#71717a',
              }}
            >
              <use href="#i-star" />
            </svg>
          </button>
        </div>

        <div className="dict-pop-ph" onClick={handlePlayAudio} title="点击朗读单词">
          <span className={`dict-pop-accent-tag${isPlaying ? ' playing' : ''}`}>
            美
            <svg className="icon" style={{ width: 13, height: 13, marginLeft: 2 }}>
              <use href="#i-vol-fill" />
            </svg>
          </span>
          <span className="dict-pop-phonetic">{entry.phonetic}</span>
        </div>

        <div className="dict-pop-senses">
          {(isLoading || hasError) && (
            <p className={`quick-dict-status is-${entry.lookupState}`} role="status">
              {entry.lookupMessage}
            </p>
          )}
          {entry.senses.map((sense, index) => (
            <div key={index} className="dict-pop-sense-row">
              {sense.pos && <span className="dict-pop-pos">{sense.pos}</span>}
              <span className="dict-pop-def-text">{sense.text}</span>
            </div>
          ))}
        </div>

        <div className="dict-pop-footer">
          <button
            className="dict-pop-more-btn"
            onClick={handleDetailClick}
            disabled={isLoading || hasError}
          >
            {isLoading ? '正在查询…' : hasError ? '暂不可用' : '查看详细释义'}
            <svg className="chev" style={{ width: 15, height: 15, marginLeft: 3 }}>
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
    <div className="quick-dict-overlay sensa-reference-quick-overlay" onClick={onClose}>
      <section
        className="sensa-reference-quick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensa-reference-quick-title"
        aria-busy={isLoading}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sensa-reference-quick-header">
          <h2 id="sensa-reference-quick-title">{entry.word}</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭快速查词">
            <svg className="icon" aria-hidden="true"><use href="#i-close" /></svg>
          </button>
        </header>

        <div className="sensa-reference-quick-identity">
          <button
            type="button"
            className={isPlaying ? 'is-playing' : ''}
            onClick={handlePlayAudio}
            disabled={isLoading || hasError}
            aria-label={`播放 ${entry.word} 的美式发音`}
          >
            <svg className="icon" aria-hidden="true"><use href="#i-vol-fill" /></svg>
            <span>美 {entry.phonetic}</span>
          </button>
        </div>

        <div className="sensa-reference-quick-senses" aria-label="简明义项">
          {(isLoading || hasError) && (
            <div className={`sensa-reference-quick-status is-${entry.lookupState}`} role="status">
              {isLoading && <i aria-hidden="true" />}
              <p>{entry.lookupMessage}</p>
            </div>
          )}
          {entry.senses.map((sense, index) => {
            const isSelected = sense.referenceSenseId === selectedSenseId;
            return (
            <div
              key={`${sense.referenceSenseId ?? sense.pos}:${sense.text}:${index}`}
              className={isSelected ? 'is-contextual-selected' : ''}
            >
              <span>{sense.pos || '—'}</span>
              <p>
                {sense.text}
              </p>
            </div>
            );
          })}
          {entry.senses.length === 0 && !isLoading && !hasError && (
            <p className="sensa-reference-quick-unavailable">
              当前没有可展示的 Reference 简明义项，请查看完整词条。
            </p>
          )}
        </div>

        <footer className="sensa-reference-quick-footer">
          <button type="button" onClick={handleDetailClick} disabled={isLoading || hasError}>
            {isLoading ? '正在查询…' : hasError ? '暂不可用' : '查看详细释义'}
            <svg className="icon" aria-hidden="true"><use href="#i-chev-r" /></svg>
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
