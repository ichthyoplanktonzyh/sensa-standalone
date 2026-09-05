import { uiClass } from '../../../ui/classes';
import type { MouseEvent } from 'react';

interface WordHeaderProps {
  text: string;
  level?: number;
  badge?: string;
  isMastered?: boolean;
  isAudioMode?: boolean;
  onPlayAudio?: (e: MouseEvent) => void;
}

export const WordHeader = ({
  text,
  level,
  badge = '',
  isMastered = false,
  isAudioMode = false,
  onPlayAudio,
}: WordHeaderProps) => {
  const effectiveMastered = isMastered || (level !== undefined && level >= 4);

  if (isAudioMode) {
    return (
      <h1 className={uiClass("word", "#wWord")} id="wWord">
        <button
          className={uiClass("word-audio-btn")}
          onClick={onPlayAudio}
          aria-label="播放发音"
        >
          <svg className={uiClass("icon")}><use href="#i-vol-fill" /></svg>
        </button>
        <span className={uiClass("word-dots")}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={uiClass(`wdot${i < (level ?? 0) ? ' on' : ''}`)} />
          ))}
        </span>
        {badge ? (
          <span className={uiClass("word-badge")}>
            <svg className={uiClass("icon")} style={{ width: 12, height: 12, strokeWidth: 2.2 }}>
              <use href="#i-thumb" />
            </svg>{' '}
            {badge}
          </span>
        ) : null}
      </h1>
    );
  }

  return (
    <h1 className={uiClass("word", "#wWord")} id="wWord">
      {text}
      {effectiveMastered ? (
        <span className={uiClass("master-badge")} title="已掌握">
          <svg className={uiClass("icon")}><use href="#i-chk-simple" /></svg>
        </span>
      ) : level !== undefined ? (
        <>
          <span className={uiClass("word-dots")}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={uiClass(`wdot${i < level ? ' on' : ''}`)} />
            ))}
          </span>
          {badge ? (
            <span className={uiClass("word-badge")}>
              <svg className={uiClass("icon")} style={{ width: 12, height: 12, strokeWidth: 2.2 }}>
                <use href="#i-thumb" />
              </svg>{' '}
              {badge}
            </span>
          ) : null}
        </>
      ) : null}
    </h1>
  );
};
