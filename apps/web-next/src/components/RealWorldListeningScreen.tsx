import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import {
  accentBreakdown,
  hasRealWorldAudio,
  roundForSense,
  type RealWorldOccurrence,
} from '../realWorldData';
import { useClipPlayer } from '../useClipPlayer';

/**
 * Real-world listening.
 *
 * One round is one Sense heard across ten different speakers, ordered from
 * clearly articulated to heavily reduced. The screen exists to produce volume
 * and talker variability, which is what generalises recognition; it does not
 * grade anything and does not touch formal progress.
 *
 * Two rules shape the layout. Captions start closed, so the round is listening
 * rather than reading. Playback stops at the end of a clip and stays there, so
 * moving on is always the learner's decision.
 */

/**
 * Which real-world-listening implementation the SidePanel toggle selects.
 * `sensa` is this custom, sense-filtered prototype; `youglish` is the embedded
 * YouGlish widget baseline. App.tsx renders one of the two.
 */
export type RealWorldListeningPresentation = 'sensa' | 'youglish';

export interface RealWorldListeningScreenProps {
  active: boolean;
  items?: readonly PracticeSenseItem[];
  onBack: () => void;
  toast: (message: string) => void;
}

const ROUND_SIZE = 10;
const RATES = [0.5, 0.75, 1, 1.25] as const;
/** Segments are seconds long, so a nudge is two seconds, not the usual five. */
const NUDGE_SECONDS = 2;
/** Playback enters the window this far ahead of the target word. */
const LEAD_IN_SECONDS = 5;

const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const formatRate = (rate: number): string => (rate === 1 ? '1×' : `${rate}×`);

/**
 * The whole indexed window, with the target segment marked. Context lines are
 * seekable: a window this long is only useful if you can jump around it.
 */
const CaptionWindow = ({
  occurrence,
  onSeekToSegment,
}: {
  occurrence: RealWorldOccurrence;
  onSeekToSegment: (segmentStartSec: number) => void;
}) => {
  const [start, end] = occurrence.targetSpan;

  return (
    <div className="rwl-caption-window">
      {occurrence.captions.map((segment, index) => {
        if (index === occurrence.targetSegmentIndex) {
          return (
            <blockquote key={segment.startSec} className="rwl-caption-line">
              {segment.text.slice(0, start)}
              <mark>{segment.text.slice(start, end)}</mark>
              {segment.text.slice(end)}
            </blockquote>
          );
        }
        return (
          <button
            key={segment.startSec}
            type="button"
            className="rwl-caption-context"
            onClick={() => onSeekToSegment(segment.startSec)}
          >
            {segment.text}
          </button>
        );
      })}
    </div>
  );
};

export const RealWorldListeningScreen = ({
  active,
  items = PRACTICE_SENSES,
  onBack,
  toast,
}: RealWorldListeningScreenProps) => {
  const listenable = useMemo(
    () => items.filter((item) => hasRealWorldAudio(item.senseId)),
    [items],
  );

  const [senseIndex, setSenseIndex] = useState(0);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);
  const [phase, setPhase] = useState<'listening' | 'summary'>('listening');
  const [captionOpen, setCaptionOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [heardIds, setHeardIds] = useState<ReadonlySet<string>>(() => new Set());

  const mountRef = useRef<HTMLDivElement>(null);

  const safeSenseIndex = listenable.length === 0 ? 0 : Math.min(senseIndex, listenable.length - 1);
  const currentSense = listenable[safeSenseIndex];

  const round = useMemo(
    () => (currentSense ? roundForSense(currentSense.senseId, ROUND_SIZE) : []),
    [currentSense],
  );
  /** Round length per Sense, so the picker can show what each one offers. */
  const roundSizes = useMemo(
    () => new Map(listenable.map((item) => [
      item.senseId,
      roundForSense(item.senseId, ROUND_SIZE).length,
    ])),
    [listenable],
  );

  const safeOccurrenceIndex = round.length === 0 ? 0 : Math.min(occurrenceIndex, round.length - 1);
  const current = round[safeOccurrenceIndex];
  const isLastOccurrence = round.length > 0 && safeOccurrenceIndex === round.length - 1;

  const windowStartSec = current?.windowStartSec ?? 0;
  const player = useClipPlayer({
    mountRef,
    videoId: current?.videoId,
    startSec: windowStartSec,
    endSec: current?.windowEndSec ?? 0,
    initialOffsetSec: current
      ? current.targetAtSec - LEAD_IN_SECONDS - current.windowStartSec
      : 0,
    active: active && phase === 'listening',
  });

  /** Where the target word sits on the window's timeline, as a percentage. */
  const targetPercent = current && player.duration > 0
    ? ((current.targetAtSec - current.windowStartSec) / player.duration) * 100
    : 0;

  const seekToAbsolute = useCallback((absoluteSec: number) => {
    player.seekTo(absoluteSec - windowStartSec);
  }, [player, windowStartSec]);

  const handleSeekOnTrack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    player.seekTo(Math.min(1, Math.max(0, ratio)) * player.duration);
  }, [player]);

  // Every new clip starts unread. Reopening captions has to be a deliberate act
  // each time, or the round quietly turns back into reading.
  useEffect(() => {
    setCaptionOpen(false);
    setTranslationOpen(false);
  }, [safeOccurrenceIndex, safeSenseIndex]);

  useEffect(() => {
    if (!active) {
      setPhase('listening');
      setOccurrenceIndex(0);
      setPickerOpen(false);
      setHeardIds(new Set());
    }
  }, [active]);

  const markHeard = useCallback((id: string) => {
    setHeardIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const handleToggle = useCallback(() => {
    if (!current) return;
    markHeard(current.id);
    player.toggle();
  }, [current, markHeard, player]);

  const handleReplay = useCallback(() => {
    if (!current) return;
    markHeard(current.id);
    player.replay();
  }, [current, markHeard, player]);

  const handleNext = useCallback(() => {
    if (isLastOccurrence) {
      setPhase('summary');
      return;
    }
    setOccurrenceIndex(safeOccurrenceIndex + 1);
  }, [isLastOccurrence, safeOccurrenceIndex]);

  const handlePrevious = useCallback(() => {
    if (safeOccurrenceIndex === 0) return;
    setOccurrenceIndex(safeOccurrenceIndex - 1);
  }, [safeOccurrenceIndex]);

  const restartRound = useCallback(() => {
    setHeardIds(new Set());
    setOccurrenceIndex(0);
    setPhase('listening');
  }, []);

  const pickSense = useCallback((index: number) => {
    setPickerOpen(false);
    // Mid-round, re-picking the Sense already playing must not throw the round
    // away. On the summary the round is already over, so any pick starts a new
    // one — including the same Sense again.
    if (index === safeSenseIndex && phase === 'listening') return;
    setSenseIndex(index);
    restartRound();
  }, [phase, restartRound, safeSenseIndex]);

  const openPicker = useCallback(() => {
    if (listenable.length === 0) {
      toast('当前练习范围没有可听的意思');
      return;
    }
    setPickerOpen(true);
  }, [listenable.length, toast]);

  const progress = player.duration > 0 ? (player.elapsed / player.duration) * 100 : 0;
  const accents = useMemo(() => accentBreakdown(round), [round]);
  const channelCount = useMemo(
    () => new Set(round.map((occurrence) => occurrence.channel)).size,
    [round],
  );

  return (
    <section
      className={`screen rwl${active ? ' active' : ''}`}
      id="s-real-world-listening"
      data-anim="slide"
    >
      <header className="rwl-nav">
        <button type="button" className="rwl-back" onClick={onBack} aria-label="返回自由练习">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>

        <button
          type="button"
          className="rwl-nav-title"
          onClick={openPicker}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={
            currentSense
              ? `当前在听 ${currentSense.word} ${currentSense.meaning}，点击更换要听的意思`
              : '选择要听的意思'
          }
        >
          {currentSense ? (
            <>
              <span className="rwl-nav-word">
                <b>{currentSense.word}</b>
                <svg className="icon"><use href="#i-chev-d" /></svg>
              </span>
              <span className="rwl-nav-meaning">
                <i>{currentSense.pos}</i>
                {currentSense.meaning}
              </span>
            </>
          ) : (
            <span className="rwl-nav-word"><b>真实语流</b></span>
          )}
        </button>

        <span className="rwl-nav-count">
          {phase === 'summary' ? '完成' : `${safeOccurrenceIndex + 1}/${round.length}`}
        </span>
      </header>

      {!currentSense || round.length === 0 ? (
        <div className="rwl-body">
          <div className="rwl-empty">
            <h3>当前范围没有可听的真实语流</h3>
            <p>真实语流需要已经完成消歧的语段索引。换一个练习范围，或稍后再来。</p>
          </div>
        </div>
      ) : phase === 'summary' ? (
        <div className="rwl-body rwl-summary">
          <span className="rwl-kicker">这一轮结束</span>
          <h2>
            你在 <b>{round.length}</b> 段真实语流里
            <br />
            听到了 {currentSense.word}
          </h2>

          <div className="rwl-summary-facts">
            <div>
              <b>{channelCount}</b>
              <span>个不同来源</span>
            </div>
            <div>
              <b>{heardIds.size}</b>
              <span>段已播放</span>
            </div>
          </div>

          <div className="rwl-accents" aria-label="本轮口音分布">
            {accents.map(({ accent, count }) => (
              <span key={accent}>
                {accent}
                <b>{count}</b>
              </span>
            ))}
          </div>

          <p className="rwl-summary-note">
            自由练习不改变学习与复习进度、每日额度或到期时间。
          </p>

          <div className="rwl-summary-actions">
            <button type="button" className="is-primary" onClick={restartRound}>
              再听一轮
            </button>
            <button type="button" onClick={openPicker}>
              换一个意思
            </button>
            <button type="button" className="is-quiet" onClick={onBack}>
              返回自由练习
            </button>
          </div>
        </div>
      ) : (
        <div className="rwl-body">
          <div className="rwl-stage">
            <div className="rwl-frame">
              {current.videoId && player.status !== 'simulated' ? (
                <div className="rwl-mount" ref={mountRef} />
              ) : (
                <div className="rwl-frame-placeholder">
                  <span className="rwl-frame-badge">示例数据</span>
                  <p>语段索引尚未接入，播放与控件按真实时长模拟。</p>
                </div>
              )}
            </div>
            <div className="rwl-source">
              <span className="rwl-source-channel">{current.channel}</span>
              <i aria-hidden="true" />
              <span className="rwl-source-accent">{current.accent}</span>
            </div>
          </div>

          <div className="rwl-progress">
            <button
              type="button"
              className="rwl-progress-track"
              onClick={handleSeekOnTrack}
              aria-label="点击定位到这段语流的某个位置"
            >
              <b style={{ width: `${progress}%` }} />
              <em style={{ left: `${targetPercent}%` }} title="目标词出现的位置" />
            </button>
            <span>
              {formatClock(player.elapsed)} / {formatClock(player.duration)}
            </span>
          </div>

          <div className="rwl-controls">
            <button
              type="button"
              onClick={handleReplay}
              aria-label={`回到目标词前 ${LEAD_IN_SECONDS} 秒`}
            >
              <svg className="icon"><use href="#i-refresh" /></svg>
            </button>
            <button
              type="button"
              className="rwl-nudge"
              onClick={() => player.seekBy(-NUDGE_SECONDS)}
              aria-label={`后退 ${NUDGE_SECONDS} 秒`}
            >
              −{NUDGE_SECONDS}s
            </button>
            <button
              type="button"
              className="rwl-play"
              onClick={handleToggle}
              aria-label={player.isPlaying ? '暂停' : '播放这一段'}
            >
              {player.isPlaying ? (
                <span aria-hidden="true">Ⅱ</span>
              ) : (
                <svg className="icon"><use href="#i-play" /></svg>
              )}
            </button>
            <button
              type="button"
              className="rwl-nudge"
              onClick={() => player.seekBy(NUDGE_SECONDS)}
              aria-label={`前进 ${NUDGE_SECONDS} 秒`}
            >
              +{NUDGE_SECONDS}s
            </button>
          </div>

          <div className="rwl-rates" role="group" aria-label="播放速度">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className={player.rate === rate ? 'is-on' : ''}
                aria-pressed={player.rate === rate}
                aria-label={`${formatRate(rate)} 速度`}
                onClick={() => player.setRate(rate)}
              >
                {formatRate(rate)}
              </button>
            ))}
          </div>

          <section className="rwl-caption">
            <button
              type="button"
              className="rwl-caption-toggle"
              aria-expanded={captionOpen}
              onClick={() => setCaptionOpen((open) => !open)}
            >
              <span>{captionOpen ? '收起文字' : '显示这段的文字'}</span>
              <svg className={`icon${captionOpen ? ' is-open' : ''}`}>
                <use href="#i-chev-d" />
              </svg>
            </button>

            {captionOpen && (
              <div className="rwl-caption-body">
                <CaptionWindow occurrence={current} onSeekToSegment={seekToAbsolute} />
                {translationOpen && (
                  <p className="rwl-caption-translation">{current.translation}</p>
                )}
                <button
                  type="button"
                  className={`rwl-caption-more${translationOpen ? ' is-on' : ''}`}
                  aria-expanded={translationOpen}
                  onClick={() => setTranslationOpen((open) => !open)}
                >
                  {translationOpen ? '隐藏中文' : '显示中文'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {currentSense && round.length > 0 && phase === 'listening' && (
        <footer className="rwl-foot">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={safeOccurrenceIndex === 0}
            aria-label="上一段"
          >
            <svg className="icon"><use href="#i-chev-l" /></svg>
          </button>

          <div className="rwl-dots" aria-hidden="true">
            {round.map((occurrence, index) => {
              const state = index === safeOccurrenceIndex
                ? 'is-current'
                : heardIds.has(occurrence.id)
                  ? 'is-heard'
                  : '';
              return <span key={occurrence.id} className={state} />;
            })}
          </div>

          <button
            type="button"
            className={isLastOccurrence ? 'is-finish' : ''}
            onClick={handleNext}
            aria-label={isLastOccurrence ? '结束这一轮' : '下一段'}
          >
            {isLastOccurrence ? (
              <svg className="icon"><use href="#i-chk-simple" /></svg>
            ) : (
              <svg className="icon"><use href="#i-chev-r" /></svg>
            )}
          </button>
        </footer>
      )}

      {pickerOpen && (
        <div className="rwl-picker-layer">
          <button
            type="button"
            className="rwl-picker-backdrop"
            onClick={() => setPickerOpen(false)}
            aria-label="关闭选择"
          />
          <div className="rwl-picker" role="dialog" aria-modal="true" aria-label="选择要听的意思">
            <header>
              <div>
                <span>当前练习范围</span>
                <h2>听哪个意思</h2>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)}>关闭</button>
            </header>

            <ul>
              {listenable.map((item, index) => (
                <li key={item.senseId}>
                  <button
                    type="button"
                    className={index === safeSenseIndex ? 'is-on' : ''}
                    aria-current={index === safeSenseIndex}
                    onClick={() => pickSense(index)}
                  >
                    <span className="rwl-picker-word">{item.word}</span>
                    <span className="rwl-picker-meaning">
                      <i>{item.pos}</i>
                      {item.meaning}
                    </span>
                    <span className="rwl-picker-count">
                      {roundSizes.get(item.senseId) ?? 0} 段
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="rwl-picker-note">
              换一个意思会重新开始一轮，本轮的播放记录不会保留。
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
