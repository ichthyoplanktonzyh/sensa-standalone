import { previewStorage } from '../services/previewStorage';
import { uiClass } from '../ui/classes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRACTICE_SENSES } from '../practiceData';
import { audioService } from '../services/audioService';
import { personalContentService } from '../services/personalContentService';
import type { PortableListeningScreenProps } from './PortableListeningScreen';

type PlaybackStatus = 'idle' | 'playing' | 'paused';
type PlaybackSegment = 'idle' | 'word' | 'example';
type ListeningPreset = 'standard' | 'clear' | 'speed' | 'custom';
type WordRepeatCount = 1 | 2 | 3;
type PlaybackRate = 0.8 | 1 | 1.25 | 1.5;
type TimerMinutes = 0 | 5 | 10 | 20 | 30;

interface ListeningPreferences {
  wordRepeats: WordRepeatCount;
  slowExampleReplay: boolean;
  playbackRate: PlaybackRate;
  stopAfterCurrent: boolean;
  showTranslation: boolean;
  timerMinutes: TimerMinutes;
}

const PREFERENCES_KEY = 'sensa.portable-listening.preferences.v1';
const PROGRESS_KEY = 'sensa.portable-listening.progress.v1';

const DEFAULT_PREFERENCES: ListeningPreferences = {
  wordRepeats: 1,
  slowExampleReplay: false,
  playbackRate: 1,
  stopAfterCurrent: false,
  showTranslation: true,
  timerMinutes: 0,
};

const PRESET_VALUES: Record<Exclude<ListeningPreset, 'custom'>, Pick<
  ListeningPreferences,
  'wordRepeats' | 'slowExampleReplay' | 'playbackRate'
>> = {
  standard: { wordRepeats: 1, slowExampleReplay: false, playbackRate: 1 },
  clear: { wordRepeats: 2, slowExampleReplay: true, playbackRate: 1 },
  speed: { wordRepeats: 1, slowExampleReplay: false, playbackRate: 1.25 },
};

const isWordRepeatCount = (value: unknown): value is WordRepeatCount =>
  value === 1 || value === 2 || value === 3;

const isPlaybackRate = (value: unknown): value is PlaybackRate =>
  value === 0.8 || value === 1 || value === 1.25 || value === 1.5;

const isTimerMinutes = (value: unknown): value is TimerMinutes =>
  value === 0 || value === 5 || value === 10 || value === 20 || value === 30;

const loadPreferences = (): ListeningPreferences => {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const stored = JSON.parse(previewStorage.getItem(PREFERENCES_KEY) || '{}') as Partial<ListeningPreferences>;
    return {
      wordRepeats: isWordRepeatCount(stored.wordRepeats) ? stored.wordRepeats : DEFAULT_PREFERENCES.wordRepeats,
      slowExampleReplay: typeof stored.slowExampleReplay === 'boolean'
        ? stored.slowExampleReplay
        : DEFAULT_PREFERENCES.slowExampleReplay,
      playbackRate: isPlaybackRate(stored.playbackRate) ? stored.playbackRate : DEFAULT_PREFERENCES.playbackRate,
      stopAfterCurrent: typeof stored.stopAfterCurrent === 'boolean'
        ? stored.stopAfterCurrent
        : DEFAULT_PREFERENCES.stopAfterCurrent,
      showTranslation: typeof stored.showTranslation === 'boolean'
        ? stored.showTranslation
        : DEFAULT_PREFERENCES.showTranslation,
      timerMinutes: isTimerMinutes(stored.timerMinutes) ? stored.timerMinutes : DEFAULT_PREFERENCES.timerMinutes,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

const loadProgressSenseId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(previewStorage.getItem(PROGRESS_KEY) || '{}') as { senseId?: unknown };
    return typeof stored.senseId === 'string' ? stored.senseId : null;
  } catch {
    return null;
  }
};

const presetFor = (preferences: ListeningPreferences): ListeningPreset => {
  const match = (Object.entries(PRESET_VALUES) as Array<[
    Exclude<ListeningPreset, 'custom'>,
    (typeof PRESET_VALUES)[Exclude<ListeningPreset, 'custom'>],
  ]>).find(([, values]) =>
    values.wordRepeats === preferences.wordRepeats
    && values.slowExampleReplay === preferences.slowExampleReplay
    && values.playbackRate === preferences.playbackRate);
  return match?.[0] ?? 'custom';
};

const timerText = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

export const SensaPortableListeningScreen = ({
  active,
  bookTitle = 'COCA 20000 (上)',
  items = PRACTICE_SENSES,
  onBack,
  toast,
}: PortableListeningScreenProps) => {
  const restoredSenseId = useMemo(loadProgressSenseId, []);
  const initialIndex = restoredSenseId
    ? Math.max(0, items.findIndex((item) => item.senseId === restoredSenseId))
    : 0;
  const [itemIndex, setItemIndex] = useState(initialIndex);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle');
  const [playbackSegment, setPlaybackSegment] = useState<PlaybackSegment>('idle');
  const [preferences, setPreferences] = useState<ListeningPreferences>(loadPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [savedSenseIds, setSavedSenseIds] = useState<Set<string>>(
    () => personalContentService.getSavedSenseIds(),
  );

  const playbackToken = useRef(0);
  const itemIndexRef = useRef(initialIndex);
  const activeRef = useRef(active);
  const statusRef = useRef<PlaybackStatus>('idle');
  const preferencesRef = useRef(preferences);

  const itemCount = items.length;
  const safeIndex = itemCount === 0 ? 0 : Math.min(itemIndex, itemCount - 1);
  const currentItem = items[safeIndex];
  const isSaved = currentItem ? savedSenseIds.has(currentItem.senseId) : false;
  const activePreset = presetFor(preferences);

  const commitStatus = useCallback((status: PlaybackStatus) => {
    statusRef.current = status;
    if (activeRef.current) setPlaybackStatus(status);
  }, []);

  const commitIndex = useCallback((index: number) => {
    itemIndexRef.current = index;
    if (activeRef.current) setItemIndex(index);
  }, []);

  const invalidatePlayback = useCallback(() => {
    playbackToken.current += 1;
    audioService.stop();
  }, []);

  const stopPlayback = useCallback((clearTimer = true) => {
    invalidatePlayback();
    commitStatus('idle');
    if (activeRef.current) setPlaybackSegment('idle');
    if (clearTimer) setSleepDeadline(null);
  }, [commitStatus, invalidatePlayback]);

  const playbackIsValid = useCallback(
    (token: number): boolean => activeRef.current && playbackToken.current === token,
    [],
  );

  const armSleepTimer = useCallback(() => {
    const minutes = preferencesRef.current.timerMinutes;
    if (minutes > 0 && sleepDeadline === null) {
      setSleepDeadline(Date.now() + minutes * 60_000);
    }
  }, [sleepDeadline]);

  const startQueue = useCallback(async (requestedIndex?: number) => {
    if (itemCount === 0 || !activeRef.current) {
      toast('当前练习范围暂无可播放意思');
      return;
    }

    const token = playbackToken.current + 1;
    playbackToken.current = token;
    audioService.stop();
    commitStatus('playing');
    armSleepTimer();

    let index = requestedIndex ?? itemIndexRef.current;
    if (index < 0 || index >= itemCount) index = 0;
    commitIndex(index);

    try {
      while (playbackIsValid(token)) {
        const item = items[index];
        if (!item) break;
        const recipe = preferencesRef.current;
        if (!item.pronunciationAudioUrl || !item.example.audioUrl) {
          commitStatus('idle');
          setPlaybackSegment('idle');
          setSleepDeadline(null);
          toast('当前意思缺少已审核的词音或例句音频，已停止播放');
          return;
        }

        setPlaybackSegment('word');
        for (let repeat = 0; repeat < recipe.wordRepeats; repeat += 1) {
          await audioService.playPackagedAudioUrl(
            item.pronunciationAudioUrl,
            item.word,
            'us',
            { playbackRate: recipe.playbackRate },
          );
          if (!playbackIsValid(token)) return;
        }

        setPlaybackSegment('example');
        await audioService.playPackagedAudioUrl(
          item.example.audioUrl,
          item.example.text,
          'us',
          { playbackRate: recipe.playbackRate },
        );
        if (!playbackIsValid(token)) return;

        if (recipe.slowExampleReplay) {
          const slowRate = Math.min(0.8, recipe.playbackRate);
          await audioService.playPackagedAudioUrl(
            item.example.audioUrl,
            item.example.text,
            'us',
            { playbackRate: slowRate },
          );
          if (!playbackIsValid(token)) return;
        }

        if (recipe.stopAfterCurrent) {
          commitStatus('idle');
          setPlaybackSegment('idle');
          setSleepDeadline(null);
          return;
        }

        index = (index + 1) % itemCount;
        commitIndex(index);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      if (playbackIsValid(token)) {
        commitStatus('idle');
        setPlaybackSegment('idle');
        setSleepDeadline(null);
      }
    } catch {
      if (playbackIsValid(token)) {
        commitStatus('idle');
        setPlaybackSegment('idle');
        setSleepDeadline(null);
      }
    }
  }, [armSleepTimer, commitIndex, commitStatus, itemCount, items, playbackIsValid, toast]);

  const handlePlayPause = useCallback(async () => {
    if (statusRef.current === 'playing') {
      if (audioService.pause()) commitStatus('paused');
      else stopPlayback(false);
      return;
    }
    if (statusRef.current === 'paused') {
      const resumed = await audioService.resume();
      if (resumed) {
        commitStatus('playing');
        return;
      }
    }
    void startQueue();
  }, [commitStatus, startQueue, stopPlayback]);

  const handleMove = useCallback((direction: -1 | 1) => {
    if (itemCount === 0 || !activeRef.current) return;
    const continuePlaying = statusRef.current !== 'idle';
    const nextIndex = (itemIndexRef.current + direction + itemCount) % itemCount;
    stopPlayback(false);
    commitIndex(nextIndex);
    if (continuePlaying) void startQueue(nextIndex);
  }, [commitIndex, itemCount, startQueue, stopPlayback]);

  const handleReplayCurrent = useCallback(() => {
    if (!currentItem || !activeRef.current) return;
    stopPlayback(false);
    void startQueue(itemIndexRef.current);
  }, [currentItem, startQueue, stopPlayback]);

  const handlePlayExample = useCallback(async () => {
    if (!currentItem || !activeRef.current) return;
    if (!currentItem.example.audioUrl) {
      toast('当前学习例句暂无已审核音频');
      return;
    }
    stopPlayback();
    const token = playbackToken.current + 1;
    playbackToken.current = token;
    commitStatus('playing');
    setPlaybackSegment('example');
    await audioService.playPackagedAudioUrl(
      currentItem.example.audioUrl,
      currentItem.example.text,
      'us',
      { playbackRate: preferencesRef.current.playbackRate },
    );
    if (playbackIsValid(token)) {
      commitStatus('idle');
      setPlaybackSegment('idle');
    }
  }, [commitStatus, currentItem, playbackIsValid, stopPlayback, toast]);

  const handleToggleSaved = useCallback(() => {
    if (!currentItem || !activeRef.current) return;
    const saved = personalContentService.toggleSense(currentItem.senseId);
    toast(saved ? '已收藏这个意思' : '已取消收藏这个意思');
  }, [currentItem, toast]);

  const updatePreferences = useCallback((change: Partial<ListeningPreferences>) => {
    setPreferences((current) => ({ ...current, ...change }));
  }, []);

  const selectPreset = useCallback((preset: Exclude<ListeningPreset, 'custom'>) => {
    updatePreferences(PRESET_VALUES[preset]);
  }, [updatePreferences]);

  const handleTimerChange = useCallback((minutes: TimerMinutes) => {
    updatePreferences({ timerMinutes: minutes });
    setSleepDeadline(
      minutes > 0 && statusRef.current !== 'idle'
        ? Date.now() + minutes * 60_000
        : null,
    );
  }, [updatePreferences]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      setSettingsOpen(false);
      stopPlayback();
    } else {
      setPlaybackStatus(statusRef.current);
      if (statusRef.current === 'idle') setPlaybackSegment('idle');
    }
    return () => {
      activeRef.current = false;
      invalidatePlayback();
    };
  }, [active, invalidatePlayback, stopPlayback]);

  useEffect(() => {
    preferencesRef.current = preferences;
    if (typeof window !== 'undefined') {
      try {
        previewStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      } catch {
        // Playback still works when storage is unavailable or full.
      }
    }
  }, [preferences]);

  useEffect(() => {
    if (!currentItem || typeof window === 'undefined') return;
    try {
      previewStorage.setItem(PROGRESS_KEY, JSON.stringify({
        senseId: currentItem.senseId,
        bookTitle,
      }));
    } catch {
      // Progress persistence is optional; never block listening on it.
    }
  }, [bookTitle, currentItem]);

  useEffect(() => personalContentService.subscribe(() => {
    setSavedSenseIds(personalContentService.getSavedSenseIds());
  }), []);

  useEffect(() => {
    if (sleepDeadline === null) {
      setRemainingSeconds(0);
      return undefined;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        stopPlayback();
        toast('定时结束，已停止播放');
      }
    };
    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [sleepDeadline, stopPlayback, toast]);

  useEffect(() => {
    if (!active || !currentItem || typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return undefined;
    }
    const mediaSession = navigator.mediaSession;
    try {
      mediaSession.metadata = new MediaMetadata({
        title: currentItem.word,
        artist: `${currentItem.pos} ${currentItem.meaning}`,
        album: `Sensa 随身听 · ${bookTitle}`,
      });
      mediaSession.setActionHandler('play', () => { void handlePlayPause(); });
      mediaSession.setActionHandler('pause', () => { void handlePlayPause(); });
      mediaSession.setActionHandler('previoustrack', () => handleMove(-1));
      mediaSession.setActionHandler('nexttrack', () => handleMove(1));
      mediaSession.setActionHandler('stop', () => stopPlayback());
    } catch {
      return undefined;
    }
    return () => {
      try {
        mediaSession.setActionHandler('play', null);
        mediaSession.setActionHandler('pause', null);
        mediaSession.setActionHandler('previoustrack', null);
        mediaSession.setActionHandler('nexttrack', null);
        mediaSession.setActionHandler('stop', null);
      } catch {
        // Some browsers expose Media Session but reject selected handlers.
      }
    };
  }, [active, bookTitle, currentItem, handleMove, handlePlayPause, stopPlayback]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playbackStatus === 'idle' ? 'none' : playbackStatus;
    } catch {
      // Playback continues even when the host does not expose Media Session state.
    }
  }, [playbackStatus]);

  const statusLabel = playbackStatus === 'paused'
    ? '已暂停'
    : playbackSegment === 'word'
      ? '正在播放词音'
      : playbackSegment === 'example'
        ? '正在播放学习例句'
        : '准备聆听';

  return (
    <section
      className={uiClass(`screen sensa-listening${active ? ' active' : ''}`, "#s-listening")}
      id="s-listening"
      data-anim="slide"
    >
      <header className={uiClass("sensa-listening-nav")}>
        <button type="button" onClick={onBack} aria-label="返回自由练习">
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <div>
          <h1>随身听</h1>
          <span>{playbackStatus === 'playing' ? '连续播放中' : '听觉自由练习'}</span>
        </div>
        <div className={uiClass("sensa-listening-nav-actions")}>
          <button
            type="button"
            className={uiClass(isSaved ? 'is-on' : '')}
            onClick={handleToggleSaved}
            aria-label={isSaved ? '取消收藏当前意思' : '收藏当前意思'}
            aria-pressed={isSaved}
          >
            <svg className={uiClass("icon")}><use href="#i-star" /></svg>
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="打开播放设置">
            <svg className={uiClass("icon")}><use href="#i-sliders" /></svg>
          </button>
        </div>
      </header>

      <main className={uiClass("sensa-listening-body")}>
        <section className={uiClass("sensa-listening-scope")} aria-label="当前队列进度">
          <div>
            <span>当前范围</span>
            <b>{bookTitle}</b>
          </div>
          <strong>{itemCount > 0 ? safeIndex + 1 : 0}<small> / {itemCount}</small></strong>
          <i aria-hidden="true"><span style={{ width: `${itemCount > 0 ? ((safeIndex + 1) / itemCount) * 100 : 0}%` }} /></i>
        </section>

        {currentItem ? (
          <section className={uiClass(`sensa-listening-now is-${playbackSegment}`)} aria-live="polite">
            <div className={uiClass("sensa-listening-now-state")}>
              <i aria-hidden="true"><span /><span /><span /></i>
              <span>{statusLabel}</span>
              {remainingSeconds > 0 && <em>{timerText(remainingSeconds)} 后停止</em>}
            </div>

            <div className={uiClass("sensa-listening-word")}>
              <span className={uiClass("sensa-listening-pos")}>{currentItem.pos}</span>
              <h2>{currentItem.word}</h2>
              <p>{currentItem.phonetic}</p>
              <strong>{currentItem.meaning}</strong>
            </div>

            <button
              type="button"
              className={uiClass("sensa-listening-example")}
              onClick={() => { void handlePlayExample(); }}
              aria-label="单独播放当前学习例句"
            >
              <span>{currentItem.example.sourceLabel}</span>
              <blockquote>{currentItem.example.text}</blockquote>
              {preferences.showTranslation && currentItem.example.translation && (
                <p>{currentItem.example.translation}</p>
              )}
              <i aria-hidden="true"><svg className={uiClass("icon")}><use href="#i-vol" /></svg></i>
            </button>

            <div className={uiClass("sensa-listening-recipe")} aria-label="当前播放配方">
              <span className={uiClass(playbackSegment === 'word' ? 'is-current' : '')}>
                词音 × {preferences.wordRepeats}
              </span>
              <i aria-hidden="true" />
              <span className={uiClass(playbackSegment === 'example' ? 'is-current' : '')}>
                例句{preferences.slowExampleReplay ? ' + 慢速重播' : ''}
              </span>
              <i aria-hidden="true" />
              <span>{preferences.stopAfterCurrent ? '停止' : '下一项'}</span>
            </div>
          </section>
        ) : (
          <section className={uiClass("sensa-listening-empty")}>
            <h2>当前范围没有可播放内容</h2>
            <p>只有具有已审核发音与例句音频的意思才会进入随身听。</p>
          </section>
        )}
      </main>

      <footer className={uiClass("sensa-listening-player")}>
        <div className={uiClass("sensa-listening-primary-controls")}>
          <button type="button" onClick={() => handleMove(-1)} aria-label="上一个意思">
            <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
          </button>
          <button type="button" onClick={handleReplayCurrent} aria-label="重新播放当前意思">
            <svg className={uiClass("icon")}><use href="#i-refresh" /></svg>
          </button>
          <button
            type="button"
            className={uiClass("sensa-listening-play")}
            onClick={() => { void handlePlayPause(); }}
            aria-label={playbackStatus === 'playing'
              ? '暂停播放'
              : playbackStatus === 'paused'
                ? '继续播放'
                : '开始播放'}
          >
            {playbackStatus === 'playing'
              ? <span aria-hidden="true">Ⅱ</span>
              : <svg className={uiClass("icon")}><use href="#i-play" /></svg>}
          </button>
          <button type="button" onClick={() => handleMove(1)} aria-label="下一个意思">
            <svg className={uiClass("icon")}><use href="#i-chev-r" /></svg>
          </button>
          <button
            type="button"
            className={uiClass(preferences.showTranslation ? 'is-on' : '')}
            onClick={() => updatePreferences({ showTranslation: !preferences.showTranslation })}
            aria-label={preferences.showTranslation ? '隐藏译文' : '显示译文'}
            aria-pressed={preferences.showTranslation}
          >
            <svg className={uiClass("icon")}><use href="#i-trans" /></svg>
          </button>
        </div>
        <button
          type="button"
          className={uiClass("sensa-listening-player-summary")}
          onClick={() => setSettingsOpen(true)}
        >
          <span>{activePreset === 'standard' ? '标准听' : activePreset === 'clear' ? '听清楚' : activePreset === 'speed' ? '速刷' : '自定义'}</span>
          <b>{preferences.playbackRate}×</b>
          <i />
          <span>{preferences.timerMinutes > 0 ? `${preferences.timerMinutes} 分钟定时` : '持续播放'}</span>
        </button>
      </footer>

      {settingsOpen && (
        <div className={uiClass("sensa-listening-settings-layer")} role="presentation">
          <button
            type="button"
            className={uiClass("sensa-listening-settings-backdrop")}
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭播放设置"
          />
          <section className={uiClass("sensa-listening-settings")} role="dialog" aria-modal="true" aria-label="随身听播放设置">
            <header>
              <div>
                <span>PLAYBACK</span>
                <h2>播放设置</h2>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)}>完成</button>
            </header>

            <div className={uiClass("sensa-listening-setting-section")}>
              <h3>快捷配方</h3>
              <div className={uiClass("sensa-listening-presets")}>
                <button className={uiClass(activePreset === 'standard' ? 'is-on' : '')} onClick={() => selectPreset('standard')}>
                  <b>标准听</b><span>词音一次 · 例句一次</span>
                </button>
                <button className={uiClass(activePreset === 'clear' ? 'is-on' : '')} onClick={() => selectPreset('clear')}>
                  <b>听清楚</b><span>词音两次 · 例句慢速重播</span>
                </button>
                <button className={uiClass(activePreset === 'speed' ? 'is-on' : '')} onClick={() => selectPreset('speed')}>
                  <b>速刷</b><span>内容完整 · 1.25 倍速</span>
                </button>
              </div>
            </div>

            <div className={uiClass("sensa-listening-setting-section")}>
              <h3>每个意思</h3>
              <div className={uiClass("sensa-listening-setting-row")}>
                <span>词音次数</span>
                <div className={uiClass("sensa-listening-segments")}>
                  {([1, 2, 3] as const).map((count) => (
                    <button
                      key={count}
                      className={uiClass(preferences.wordRepeats === count ? 'is-on' : '')}
                      onClick={() => updatePreferences({ wordRepeats: count })}
                    >
                      {count} 次
                    </button>
                  ))}
                </div>
              </div>
              <label className={uiClass("sensa-listening-toggle-row")}>
                <span><b>慢速重播例句</b><small>原速例句之后再以 0.8 倍播放一次</small></span>
                <input
                  type="checkbox"
                  checked={preferences.slowExampleReplay}
                  onChange={(event) => updatePreferences({ slowExampleReplay: event.target.checked })}
                />
                <i aria-hidden="true" />
              </label>
              <label className={uiClass("sensa-listening-toggle-row")}>
                <span><b>播完当前项后停止</b><small>适合只听当前这个意思</small></span>
                <input
                  type="checkbox"
                  checked={preferences.stopAfterCurrent}
                  onChange={(event) => updatePreferences({ stopAfterCurrent: event.target.checked })}
                />
                <i aria-hidden="true" />
              </label>
            </div>

            <div className={uiClass("sensa-listening-setting-section")}>
              <h3>播放速度</h3>
              <div className={uiClass("sensa-listening-wide-segments")}>
                {([0.8, 1, 1.25, 1.5] as const).map((rate) => (
                  <button
                    key={rate}
                    className={uiClass(preferences.playbackRate === rate ? 'is-on' : '')}
                    onClick={() => updatePreferences({ playbackRate: rate })}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>

            <div className={uiClass("sensa-listening-setting-section")}>
              <h3>定时停止</h3>
              <div className={uiClass("sensa-listening-wide-segments is-timer")}>
                {([0, 5, 10, 20, 30] as const).map((minutes) => (
                  <button
                    key={minutes}
                    className={uiClass(preferences.timerMinutes === minutes ? 'is-on' : '')}
                    onClick={() => handleTimerChange(minutes)}
                  >
                    {minutes === 0 ? '关闭' : `${minutes} 分`}
                  </button>
                ))}
              </div>
            </div>

            <p className={uiClass("sensa-listening-resource-note")}>
              当前只播放学习包中已审核的词语发音和学习例句。中文意思与例句译文暂时作为屏幕支架，待学习包提供对应音频后再开放朗读。
            </p>
          </section>
        </div>
      )}
    </section>
  );
};
