import { useCallback, useMemo, useRef, useState } from 'react';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import { useYouglishWidget } from '../useYouglishWidget';

/**
 * Real-world listening — YouGlish baseline.
 *
 * This is the YouGlish half of the sensa|youglish toggle. It hands the current
 * Sense's *word* to an embedded YouGlish widget and lets it stream real spoken
 * occurrences from across YouTube. The point is raw volume of the word's sound
 * with almost no pipeline of our own.
 *
 * One honesty boundary defines the screen: YouGlish searches by surface string,
 * so it cannot filter to a Sense. What plays here is the word in *any* meaning.
 * The screen therefore says so plainly and never dresses a clip up as belonging
 * to the current Sense — that separation is the job of the Sensa variant. Like
 * all free practice it grades nothing and touches no formal progress.
 */

export interface YouGlishListeningScreenProps {
  active: boolean;
  items?: readonly PracticeSenseItem[];
  onBack: () => void;
  toast: (message: string) => void;
}

/** English accents YouGlish exposes, as (code, label) for the filter chips. */
const ACCENTS = [
  { code: undefined, label: '全部' },
  { code: 'us', label: '美' },
  { code: 'uk', label: '英' },
  { code: 'aus', label: '澳' },
  { code: 'ca', label: '加' },
  { code: 'ie', label: '爱' },
] as const;

const RATES = [0.5, 0.75, 1, 1.25] as const;
const formatRate = (rate: number): string => (rate === 1 ? '1×' : `${rate}×`);

/** Move step for the ±Ns nudge controls, matching YouGlish's own. */
const NUDGE_SECONDS = 5;

/** YouGlish wraps the searched term in `[[[ ]]]`; render those as a highlight. */
const renderCaption = (raw: string) =>
  raw.split(/\[\[\[|\]\]\]/).map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
  );

export const YouGlishListeningScreen = ({
  active,
  items = PRACTICE_SENSES,
  onBack,
  toast,
}: YouGlishListeningScreenProps) => {
  // Every English word has spoken occurrences on YouGlish, so the whole scope is
  // listenable here — unlike the Sensa variant there is no indexed subset.
  const listenable = items;

  const [senseIndex, setSenseIndex] = useState(0);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [rate, setRate] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);

  const safeSenseIndex = listenable.length === 0 ? 0 : Math.min(senseIndex, listenable.length - 1);
  const currentSense = listenable[safeSenseIndex];

  const widget = useYouglishWidget({
    mountRef,
    query: currentSense?.word,
    accent,
    active,
  });

  const pickSense = useCallback((index: number) => {
    setPickerOpen(false);
    setSenseIndex(index);
  }, []);

  const openPicker = useCallback(() => {
    if (listenable.length === 0) {
      toast('当前练习范围没有可听的词');
      return;
    }
    setPickerOpen(true);
  }, [listenable.length, toast]);

  const applyRate = useCallback((next: number) => {
    setRate(next);
    widget.setSpeed(next);
  }, [widget]);

  const count = useMemo(() => {
    switch (widget.status) {
      case 'ready':
        return `${widget.totalResults}`;
      case 'empty':
        return '0';
      case 'error':
        return '—';
      default:
        return '…';
    }
  }, [widget.status, widget.totalResults]);

  return (
    <section
      className={`screen rwl ygl${active ? ' active' : ''}`}
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
              ? `当前在听 ${currentSense.word}，点击更换要听的词`
              : '选择要听的词'
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

        <span className="rwl-nav-count" aria-label="YouGlish 找到的真实语流数量">
          {count}
        </span>
      </header>

      {!currentSense ? (
        <div className="rwl-body">
          <div className="rwl-empty">
            <h3>当前范围没有可听的词</h3>
            <p>换一个练习范围，或稍后再来。</p>
          </div>
        </div>
      ) : (
        <div className="rwl-body">
          <p className="ygl-note">
            YouGlish 按词搜索真实语流，<b>不区分义项</b>——这里播放的是「{currentSense.word}」在各种意思下的读音，用于建立对这个词声音的泛化。义项过滤由 Sensa 版负责。
          </p>

          <div className="ygl-accents" role="group" aria-label="口音筛选">
            {ACCENTS.map(({ code, label }) => (
              <button
                key={label}
                type="button"
                className={accent === code ? 'is-on' : ''}
                aria-pressed={accent === code}
                onClick={() => setAccent(code)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* The frame is clipped to the 16:9 player. YouGlish's free widget
              appends a search box and an app promo we cannot switch off through
              components, so we crop to the video; its own caption overlay rides
              on the player and stays perfectly in sync with the audio. */}
          <div className="ygl-stage">
            <div className="ygl-frame" ref={mountRef} />
            {widget.status !== 'ready' && (
              <div className="ygl-state" role="status">
                {widget.status === 'loading' || widget.status === 'idle' ? (
                  <p>正在从 YouGlish 拉取「{currentSense.word}」的真实语流…</p>
                ) : widget.status === 'empty' ? (
                  <p>YouGlish 没有找到「{currentSense.word}」的语流，换个词或口音试试。</p>
                ) : (
                  <p>加载失败。可能是网络受限或该视频不可用，稍后再试。</p>
                )}
              </div>
            )}
          </div>

          <div className="ygl-subs" aria-live="polite">
            <span className="ygl-subs-tag">字幕</span>
            {widget.status === 'ready' && widget.caption ? (
              <p className="ygl-subs-text">{renderCaption(widget.caption)}</p>
            ) : (
              <p className="ygl-subs-text is-empty">
                {widget.status === 'ready' ? '字幕随播放逐句显示…' : '播放后这里逐句显示英文字幕'}
              </p>
            )}
          </div>

          <div className="ygl-controls">
            <div className="ygl-ctl-row" role="group" aria-label="播放控制">
              <button
                type="button"
                className="ygl-ctl ygl-nudge"
                onClick={() => widget.move(-NUDGE_SECONDS)}
                aria-label={`后退 ${NUDGE_SECONDS} 秒`}
              >
                −{NUDGE_SECONDS}<small>s</small>
              </button>
              <button
                type="button"
                className="ygl-ctl ygl-play"
                onClick={widget.toggle}
                aria-label={widget.isPlaying ? '暂停' : '播放'}
              >
                {widget.isPlaying ? (
                  <span className="ygl-pause" aria-hidden="true" />
                ) : (
                  <svg className="icon"><use href="#i-play" /></svg>
                )}
              </button>
              <button
                type="button"
                className="ygl-ctl ygl-nudge"
                onClick={() => widget.move(NUDGE_SECONDS)}
                aria-label={`前进 ${NUDGE_SECONDS} 秒`}
              >
                +{NUDGE_SECONDS}<small>s</small>
              </button>
            </div>
            <div className="ygl-ctl-row ygl-ctl-row-sub" role="group" aria-label="切换语流">
              <button type="button" className="ygl-ctl" onClick={widget.previous} aria-label="上一段">
                <svg className="icon"><use href="#i-chev-l" /></svg>
              </button>
              <button type="button" className="ygl-ctl" onClick={widget.replay} aria-label="重播这一段">
                <svg className="icon"><use href="#i-refresh" /></svg>
              </button>
              <button type="button" className="ygl-ctl" onClick={widget.next} aria-label="下一段">
                <svg className="icon"><use href="#i-chev-r" /></svg>
              </button>
            </div>
          </div>

          <div className="ygl-rates" role="group" aria-label="播放速度">
            {RATES.map((value) => (
              <button
                key={value}
                type="button"
                className={rate === value ? 'is-on' : ''}
                aria-pressed={rate === value}
                aria-label={`${formatRate(value)} 速度`}
                onClick={() => applyRate(value)}
              >
                {formatRate(value)}
              </button>
            ))}
          </div>

          <p className="ygl-boundary">
            自由练习不改变学习与复习进度、每日额度或到期时间。
          </p>

          <a
            className="ygl-attrib"
            href="https://youglish.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            Powered by YouGlish.com
          </a>
        </div>
      )}

      {pickerOpen && (
        <div className="rwl-picker-layer">
          <button
            type="button"
            className="rwl-picker-backdrop"
            onClick={() => setPickerOpen(false)}
            aria-label="关闭选择"
          />
          <div className="rwl-picker" role="dialog" aria-modal="true" aria-label="选择要听的词">
            <header>
              <div>
                <span>当前练习范围</span>
                <h2>听哪个词</h2>
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
                  </button>
                </li>
              ))}
            </ul>

            <p className="rwl-picker-note">
              YouGlish 按词搜索，切换词会重新拉取该词的真实语流。
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
