import { useState, type MouseEvent } from 'react';
import type { QuickDictEntry } from '../types';
import { audioService } from '../services/audioService';

interface QuickDictPopupProps {
  entry: QuickDictEntry;
  onClose: () => void;
  onViewDetail?: (word: string) => void;
  toast: (msg: string) => void;
}

export const QuickDictPopup = ({
  entry,
  onClose,
  onViewDetail,
  toast,
}: QuickDictPopupProps) => {
  const [isStarred, setIsStarred] = useState(entry.isStarred || false);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayAudio = (e: MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(true);
    audioService
      .playWord(entry.word, 'us')
      .finally(() => setIsPlaying(false));
  };

  const handleToggleStar = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !isStarred;
    setIsStarred(next);
    toast(next ? `已将 "${entry.word}" 加入生词本` : `已取消收藏 "${entry.word}"`);
  };

  const handleDetailClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (onViewDetail) {
      onViewDetail(entry.word);
    } else {
      toast(`查看 "${entry.word}" 的完整词典详释`);
    }
  };

  return (
    <div className="quick-dict-overlay" onClick={onClose}>
      <div className="quick-dict-popup" onClick={(e) => e.stopPropagation()}>
        {/* 顶部：橙色大号单词原型 + 收藏五角星 */}
        <div className="dict-pop-hd">
          <span className="dict-pop-word">{entry.word}</span>
          <button
            className={`dict-pop-star${isStarred ? ' on' : ''}`}
            onClick={handleToggleStar}
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

        {/* 音标与发音行：美音胶囊 + 国际音标 */}
        <div className="dict-pop-ph" onClick={handlePlayAudio} title="点击朗读单词">
          <span className={`dict-pop-accent-tag${isPlaying ? ' playing' : ''}`}>
            美
            <svg className="icon" style={{ width: 13, height: 13, marginLeft: 2 }}>
              <use href="#i-vol-fill" />
            </svg>
          </span>
          <span className="dict-pop-phonetic">{entry.phonetic}</span>
        </div>

        {/* 简明释义列表 */}
        <div className="dict-pop-senses">
          {entry.senses.map((sense, idx) => (
            <div key={idx} className="dict-pop-sense-row">
              {sense.pos && <span className="dict-pop-pos">{sense.pos}</span>}
              <span className="dict-pop-def-text">{sense.text}</span>
            </div>
          ))}
        </div>

        {/* 底部：查看详细释义 > */}
        <div className="dict-pop-footer">
          <button className="dict-pop-more-btn" onClick={handleDetailClick}>
            查看详细释义
            <svg className="chev" style={{ width: 15, height: 15, marginLeft: 3 }}>
              <use href="#i-chev-r" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
