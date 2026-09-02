import { useMemo, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SentenceToken } from '../types';
import { tokenizeSentence } from '../utils/sentenceTokenizer';

interface ClickableSentenceProps {
  sentenceHtml: string;
  activeTokenIdx?: number | null;
  playingTokenIdx?: number | null;
  onWordClick?: (token: SentenceToken, tokenIdx: number) => void;
  className?: string;
}

export const ClickableSentence = ({
  sentenceHtml,
  activeTokenIdx = null,
  playingTokenIdx = null,
  onWordClick,
  className = '',
}: ClickableSentenceProps) => {
  const { tokens } = useMemo(() => tokenizeSentence(sentenceHtml), [sentenceHtml]);

  return (
    <div className={`clickable-sentence ${className}`}>
      {tokens.map((token, idx) => {
        if (!token.isWord) {
          return (
            <span key={token.id} className="tok-sep">
              {token.text}
            </span>
          );
        }

        const isSelected = activeTokenIdx === idx;
        const isPlaying = playingTokenIdx === idx;
        const isTarget = token.isTarget;

        const classNames = [
          'tok-word',
          isTarget ? 'tok-target' : '',
          isSelected ? 'tok-selected' : '',
          isPlaying ? 'tok-playing' : '',
        ]
          .filter(Boolean)
          .join(' ');

        if (!onWordClick) {
          return <span key={token.id} className={classNames}>{token.text}</span>;
        }

        return (
          <button
            type="button"
            key={token.id}
            className={classNames}
            onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
              e.stopPropagation();
            }}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onWordClick(token, idx);
            }}
            aria-label={`查词：${token.text}`}
            title="点击查词"
          >
            {token.text}
          </button>
        );
      })}
    </div>
  );
};
