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
    <div className={`clickable-sentence inline leading-inherit ${className}`}>
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
          'tok-word inline min-h-8 rounded-control border-0 bg-transparent px-0.5 font-inherit text-inherit transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none',
          isTarget ? 'tok-target font-semibold text-action-primary' : '',
          isSelected ? 'tok-selected bg-surface-selected' : '',
          isPlaying ? 'tok-playing bg-accent-soft text-action-primary' : '',
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
            className={`${classNames} cursor-pointer hover:bg-surface-subtle`}
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
