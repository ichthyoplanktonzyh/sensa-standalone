import { uiClass } from '../ui/classes';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PracticeScopeTarget } from '../practiceScope';
import { useYouglishWidget } from '../useYouglishWidget';

/**
 * Real-world Speech Variation through YouGlish.
 *
 * YouGlish searches the Expression form rather than a contextual Sense. The UI
 * keeps that boundary visible without turning it into an explanatory screen.
 */

export interface YouGlishListeningScreenProps {
  active: boolean;
  targets: readonly PracticeScopeTarget[];
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
  targets,
  onBack,
  toast,
}: YouGlishListeningScreenProps) => {
  const listenable = useMemo(() => {
    const seen = new Set<string>();
    return targets.filter((target) => {
      const expression = target.expression.surfaceForm.trim().toLocaleLowerCase('en');
      if (!expression || seen.has(expression)) return false;
      seen.add(expression);
      return true;
    });
  }, [targets]);

  const [senseIndex, setSenseIndex] = useState(0);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [rate, setRate] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);

  const safeSenseIndex = listenable.length === 0 ? 0 : Math.min(senseIndex, listenable.length - 1);
  const currentSense = listenable[safeSenseIndex];

  const widget = useYouglishWidget({
    mountRef,
    query: currentSense?.expression.surfaceForm,
    accent,
    active,
  });

  const pickSense = useCallback((index: number) => {
    setPickerOpen(false);
    setSenseIndex(index);
  }, []);

  const openPicker = useCallback(() => {
    if (listenable.length === 0) {
      toast('当前范围没有可听的表达');
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
      className={uiClass(`screen rwl ygl${active ? ' active' : ''}`, "#s-real-world-listening")}
      id="s-real-world-listening"
      data-anim="slide"
    >
      <header className={uiClass("rwl-nav")}>
        <button type="button" className={uiClass("rwl-back")} onClick={onBack} aria-label="返回自由练习">
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>

        <button
          type="button"
          className={uiClass("rwl-nav-title")}
          onClick={openPicker}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={
            currentSense
              ? `当前在听 ${currentSense.expression.surfaceForm}，点击更换表达`
              : '选择要听的表达'
          }
        >
          {currentSense ? (
            <>
              <span className={uiClass("rwl-nav-word")}>
                <b>{currentSense.expression.surfaceForm}</b>
                <svg className={uiClass("icon")}><use href="#i-chev-d" /></svg>
              </span>
              <span className={uiClass("rwl-nav-meaning")}>
                {currentSense.expression.pronunciationVariant?.ipa || 'Expression'}
              </span>
            </>
          ) : (
            <span className={uiClass("rwl-nav-word")}><b>真实语流泛化</b></span>
          )}
        </button>

        <span className={uiClass("rwl-nav-count")} aria-label="YouGlish 找到的真实语流数量">
          {count}
        </span>
      </header>

      {!currentSense ? (
        <div className={uiClass("rwl-body")}>
          <div className={uiClass("rwl-empty")}>
            <h3>当前范围没有可听的表达</h3>
          </div>
        </div>
      ) : (
        <div className={uiClass("rwl-body")}>
          <p className={uiClass("ygl-note")}>按表达形式检索 · 片段可能包含其他词义</p>

          <div className={uiClass("ygl-accents")} role="group" aria-label="口音筛选">
            {ACCENTS.map(({ code, label }) => (
              <button
                key={label}
                type="button"
                className={uiClass(accent === code ? 'is-on' : '')}
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
          <div className={uiClass("ygl-stage")}>
            <div className={uiClass("ygl-frame")} ref={mountRef} />
            {widget.status !== 'ready' && (
              <div className={uiClass("ygl-state")} role="status">
                {widget.status === 'loading' || widget.status === 'idle' ? (
                  <p>正在加载「{currentSense.expression.surfaceForm}」…</p>
                ) : widget.status === 'empty' ? (
                  <p>没有找到片段，换个口音试试。</p>
                ) : (
                  <p>加载失败，请稍后再试。</p>
                )}
              </div>
            )}
          </div>

          <div className={uiClass("ygl-subs")} aria-live="polite">
            <span className={uiClass("ygl-subs-tag")}>字幕</span>
            {widget.status === 'ready' && widget.caption ? (
              <p className={uiClass("ygl-subs-text")}>{renderCaption(widget.caption)}</p>
            ) : (
              <p className={uiClass("ygl-subs-text is-empty")}>
                {widget.status === 'ready' ? '字幕随播放逐句显示…' : '播放后这里逐句显示英文字幕'}
              </p>
            )}
          </div>

          <div className={uiClass("ygl-controls")}>
            <div className={uiClass("ygl-ctl-row")} role="group" aria-label="播放控制">
              <button
                type="button"
                className={uiClass("ygl-ctl ygl-nudge")}
                onClick={() => widget.move(-NUDGE_SECONDS)}
                aria-label={`后退 ${NUDGE_SECONDS} 秒`}
              >
                −{NUDGE_SECONDS}<small>s</small>
              </button>
              <button
                type="button"
                className={uiClass("ygl-ctl ygl-play")}
                onClick={widget.toggle}
                aria-label={widget.isPlaying ? '暂停' : '播放'}
              >
                {widget.isPlaying ? (
                  <span className={uiClass("ygl-pause")} aria-hidden="true" />
                ) : (
                  <svg className={uiClass("icon")}><use href="#i-play" /></svg>
                )}
              </button>
              <button
                type="button"
                className={uiClass("ygl-ctl ygl-nudge")}
                onClick={() => widget.move(NUDGE_SECONDS)}
                aria-label={`前进 ${NUDGE_SECONDS} 秒`}
              >
                +{NUDGE_SECONDS}<small>s</small>
              </button>
            </div>
            <div className={uiClass("ygl-ctl-row ygl-ctl-row-sub")} role="group" aria-label="切换语流">
              <button type="button" className={uiClass("ygl-ctl")} onClick={widget.previous} aria-label="上一段">
                <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
              </button>
              <button type="button" className={uiClass("ygl-ctl")} onClick={widget.replay} aria-label="重播这一段">
                <svg className={uiClass("icon")}><use href="#i-refresh" /></svg>
              </button>
              <button type="button" className={uiClass("ygl-ctl")} onClick={widget.next} aria-label="下一段">
                <svg className={uiClass("icon")}><use href="#i-chev-r" /></svg>
              </button>
            </div>
          </div>

          <div className={uiClass("ygl-rates")} role="group" aria-label="播放速度">
            {RATES.map((value) => (
              <button
                key={value}
                type="button"
                className={uiClass(rate === value ? 'is-on' : '')}
                aria-pressed={rate === value}
                aria-label={`${formatRate(value)} 速度`}
                onClick={() => applyRate(value)}
              >
                {formatRate(value)}
              </button>
            ))}
          </div>

          <a
            className={uiClass("ygl-attrib")}
            href="https://youglish.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            Powered by YouGlish.com
          </a>
        </div>
      )}

      {pickerOpen && (
        <div className={uiClass("rwl-picker-layer")}>
          <button
            type="button"
            className={uiClass("rwl-picker-backdrop")}
            onClick={() => setPickerOpen(false)}
            aria-label="关闭选择"
          />
          <div className={uiClass("rwl-picker")} role="dialog" aria-modal="true" aria-label="选择要听的表达">
            <header>
              <div>
                <span>当前练习范围</span>
                <h2>听哪个表达</h2>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)}>关闭</button>
            </header>

            <ul>
              {listenable.map((item, index) => (
                <li key={item.targetId}>
                  <button
                    type="button"
                    className={uiClass(index === safeSenseIndex ? 'is-on' : '')}
                    aria-current={index === safeSenseIndex}
                    onClick={() => pickSense(index)}
                  >
                    <span className={uiClass("rwl-picker-word")}>{item.expression.surfaceForm}</span>
                    <span className={uiClass("rwl-picker-meaning")}>
                      {item.expression.pronunciationVariant?.ipa || item.sense.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
};
