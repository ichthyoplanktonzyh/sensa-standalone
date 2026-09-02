import { useCallback, useEffect, useRef, useState } from 'react';
import { audioService } from '../services/audioService';
import { personalContentService } from '../services/personalContentService';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import { SensaPortableListeningScreen } from './SensaPortableListeningScreen';

export type PortableListeningPresentation = 'sensa' | 'baseline';

export interface PortableListeningScreenProps {
  active: boolean;
  bookTitle?: string;
  items?: readonly PracticeSenseItem[];
  onBack: () => void;
  toast: (msg: string) => void;
  presentation?: PortableListeningPresentation;
}

const BaselinePortableListeningScreen = ({
  active,
  bookTitle = 'COCA 20000 (上)',
  items = PRACTICE_SENSES,
  onBack,
  toast,
}: PortableListeningScreenProps) => {
  const [itemIndex, setItemIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const [savedSenseIds, setSavedSenseIds] = useState<Set<string>>(
    () => personalContentService.getSavedSenseIds()
  );
  const playbackToken = useRef(0);
  const itemIndexRef = useRef(0);
  const activeRef = useRef(active);
  const stopAfterCurrentRef = useRef(stopAfterCurrent);

  const itemCount = items.length;
  const safeIndex = itemCount === 0 ? 0 : Math.min(itemIndex, itemCount - 1);
  const currentItem = items[safeIndex];
  const isSaved = currentItem ? savedSenseIds.has(currentItem.senseId) : false;

  useEffect(() => {
    stopAfterCurrentRef.current = stopAfterCurrent;
  }, [stopAfterCurrent]);

  useEffect(() => personalContentService.subscribe(() => {
    setSavedSenseIds(personalContentService.getSavedSenseIds());
  }), []);

  const invalidatePlayback = useCallback(() => {
    playbackToken.current += 1;
    audioService.stop();
  }, []);

  const stopPlayback = useCallback(() => {
    invalidatePlayback();
    if (activeRef.current) {
      setIsPlaying(false);
    }
  }, [invalidatePlayback]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      // Inactive screens must invalidate pending async continuations without
      // setting state after the route has hidden them.
      invalidatePlayback();
    } else {
      setIsPlaying(false);
    }

    return () => {
      activeRef.current = false;
      // Do not set state during unmount; invalidate every pending playback
      // continuation before the screen disappears.
      invalidatePlayback();
    };
  }, [active, invalidatePlayback]);

  const playbackIsValid = useCallback(
    (token: number): boolean => activeRef.current && playbackToken.current === token,
    []
  );

  const playCurrentQueue = useCallback(async () => {
    if (!currentItem || itemCount === 0) {
      toast('当前练习范围暂无可播放意思');
      return;
    }
    if (!activeRef.current) return;

    const token = playbackToken.current + 1;
    playbackToken.current = token;
    audioService.stop();
    if (!activeRef.current) return;
    setIsPlaying(true);

    let index = itemIndexRef.current;
    if (index < 0 || index >= itemCount) {
      index = safeIndex;
      itemIndexRef.current = index;
    }

    try {
      while (playbackIsValid(token)) {
        const item = items[index];
        if (!item) {
          if (playbackIsValid(token)) {
            setIsPlaying(false);
          }
          return;
        }

        await audioService.playWord(item.word, 'us');
        if (!playbackIsValid(token)) return;

        await audioService.playSentence(item.example.text, 'us');
        if (!playbackIsValid(token)) return;

        if (stopAfterCurrentRef.current) {
          if (playbackIsValid(token)) {
            setIsPlaying(false);
          }
          return;
        }

        index = (index + 1) % itemCount;
        if (!playbackIsValid(token)) return;
        itemIndexRef.current = index;
        setItemIndex(index);

        // Let the UI paint the new Sense and give manual controls a chance to
        // invalidate the token before an unsupported/instant audio fallback
        // can spin through the prototype range.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!playbackIsValid(token)) return;
      }
    } catch {
      if (playbackIsValid(token)) {
        setIsPlaying(false);
      }
    }
  }, [currentItem, itemCount, items, playbackIsValid, safeIndex, toast]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    void playCurrentQueue();
  }, [isPlaying, playCurrentQueue, stopPlayback]);

  const handlePlayExample = useCallback(() => {
    if (!currentItem || !activeRef.current) return;
    stopPlayback();
    void audioService.playSentence(currentItem.example.text, 'us');
  }, [currentItem, stopPlayback]);

  const handleMove = useCallback(
    (direction: -1 | 1) => {
      if (itemCount === 0 || !activeRef.current) return;
      stopPlayback();
      const nextIndex = (itemIndexRef.current + direction + itemCount) % itemCount;
      itemIndexRef.current = nextIndex;
      setItemIndex(nextIndex);
    },
    [itemCount, stopPlayback]
  );

  const handleToggleSaved = useCallback(() => {
    if (!currentItem || !activeRef.current) return;
    const saved = personalContentService.toggleSense(currentItem.senseId);
    toast(saved ? '已收藏这个意思' : '已取消收藏这个意思');
  }, [currentItem, toast]);

  const handleToggleStopPolicy = useCallback(() => {
    if (!activeRef.current) return;
    setStopAfterCurrent((current) => {
      const next = !current;
      toast(next ? '已设置为播完当前项后停止' : '已开启连续播放：播放后前往下一项');
      return next;
    });
  }, [toast]);

  return (
    <section className={`screen${active ? ' active' : ''}`} id="s-listening" data-anim="slide">
      <header className="wl-header">
        <button className="wl-back-btn" onClick={onBack} aria-label="返回">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1 className="wl-title">随身听</h1>
        <div className="wl-actions">
          <button
            className={`wl-btn${stopAfterCurrent ? ' on' : ''}`}
            onClick={handleToggleStopPolicy}
            aria-label={stopAfterCurrent ? '播完当前项后停止' : '连续播放，播放后前往下一项'}
            aria-pressed={stopAfterCurrent}
            title={stopAfterCurrent ? '播完当前项后停止' : '连续播放'}
          >
            <svg className="icon"><use href="#i-timer" /></svg>
          </button>
          <button
            className={`wl-btn${isSaved ? ' on' : ''}`}
            onClick={handleToggleSaved}
            aria-label={isSaved ? '取消收藏当前意思' : '收藏当前意思'}
            aria-pressed={isSaved}
          >
            <svg className="icon"><use href="#i-star" /></svg>
          </button>
        </div>
      </header>

      {currentItem ? (
        <div className="lbody">
          <div className="hint">
            {safeIndex + 1}/{itemCount} · {bookTitle} · 当前练习范围
          </div>

          <div className="word">
            <span>{currentItem.word}</span>
            <span className="word-badge">{currentItem.pos}</span>
          </div>

          <div className="phon">
            <button className="ph-b" onClick={handlePlayPause} aria-label="播放当前意思">
              美音
              <svg className="icon"><use href="#i-vol" /></svg>
            </button>
            <span className="p">{currentItem.phonetic}</span>
          </div>

          <div className="senses">
            <div className="sense">
              <span className="pos">{currentItem.pos}</span>
              <span className="m">{currentItem.meaning}</span>
            </div>
          </div>

          <div className="dcard ex-card-only">
            <div className="def-text-content">{currentItem.example.sourceLabel}</div>
            <div className="en">{currentItem.example.text}</div>
            {showTranslation && currentItem.example.translation && (
              <div className="zh">{currentItem.example.translation}</div>
            )}
            <button className="expand" onClick={handlePlayExample} aria-label="播放学习例句">
              <svg className="icon"><use href="#i-vol" /></svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="pad">
          <div className="card group">
            <div className="row">
              <span className="t">当前练习范围暂无可播放意思</span>
            </div>
          </div>
        </div>
      )}

      <div className="wl-bottom-spacer" />
      <div className="wl-floating-bar-island">
        <button
          className="wl-float-btn"
          onClick={() => toast(`当前范围：${bookTitle}，共 ${itemCount} 个意思`)}
          aria-label="查看范围与队列"
        >
          <span className="wl-float-icon"><svg className="icon"><use href="#i-list" /></svg></span>
          <span className="wl-float-label">范围</span>
        </button>

        <button className="wl-float-btn" onClick={() => handleMove(-1)} aria-label="上一个意思">
          <span className="wl-float-icon"><svg className="icon"><use href="#i-chev-l" /></svg></span>
          <span className="wl-float-label">上一项</span>
        </button>

        <button className="wl-float-btn" onClick={handlePlayPause} aria-label={isPlaying ? '暂停播放' : '播放当前意思'}>
          <span className="wl-float-icon">
            {isPlaying ? <span aria-hidden="true">Ⅱ</span> : <svg className="icon"><use href="#i-play" /></svg>}
          </span>
          <span className="wl-float-label">{isPlaying ? '暂停' : '播放'}</span>
        </button>

        <button className="wl-float-btn" onClick={() => handleMove(1)} aria-label="下一个意思">
          <span className="wl-float-icon"><svg className="icon"><use href="#i-chev-r" /></svg></span>
          <span className="wl-float-label">下一项</span>
        </button>

        <button
          className="wl-float-btn"
          onClick={() => setShowTranslation((visible) => !visible)}
          aria-label={showTranslation ? '隐藏译文' : '显示译文'}
          aria-pressed={showTranslation}
        >
          <span className="wl-float-icon"><svg className="icon"><use href="#i-trans" /></svg></span>
          <span className="wl-float-label">{showTranslation ? '隐藏译文' : '显示译文'}</span>
        </button>
      </div>
    </section>
  );
};

export const PortableListeningScreen = (props: PortableListeningScreenProps) => (
  props.presentation === 'baseline'
    ? <BaselinePortableListeningScreen {...props} />
    : <SensaPortableListeningScreen {...props} />
);
