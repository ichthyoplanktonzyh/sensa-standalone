import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, type MouseEvent } from 'react';
import type { Word, QuickDictEntry } from '../types';
import { ClickableSentence } from './ClickableSentence';
import { QuickDictPopup } from './QuickDictPopup';
import { lookupWord } from '../services/quickDict';
import { tokenizeSentence, findTokenIndexByCharOffset } from '../utils/sentenceTokenizer';

interface ExampleScreenProps {
  active: boolean;
  curWord: Word;
  initialSenseIdx?: number;
  onClose: () => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onNextWord: () => void;
  toast: (msg: string) => void;
}

export const ExampleScreen = ({
  active,
  curWord,
  initialSenseIdx = 0,
  onClose,
  onOpenDict,
  onNextWord,
  toast,
}: ExampleScreenProps) => {
  // 1. 获取当前单词所有义项
  const senseDetails = curWord.senseDetails && curWord.senseDetails.length > 0
    ? curWord.senseDetails
    : [
        {
          pos: curWord.senses[0]?.pos || 'n.',
          text: curWord.senses[0]?.items[0] || '释义',
          def: curWord.def,
          sentences: curWord.sentences,
        },
      ];

  const totalSenses = senseDetails.length;

  // 2. 义项大卡片轨道索引 (Sense Grand Track)
  const [senseIdx, setSenseIdx] = useState(initialSenseIdx);

  // 3. 每个义项内部的例句索引映射 (Sentence Carousel per Sense)
  const [sentMap, setSentMap] = useState<number[]>(() => new Array(totalSenses).fill(0));

  // 4. 每个义项的释义展开状态
  const [defRevealedMap, setDefRevealedMap] = useState<boolean[]>(() => new Array(totalSenses).fill(false));

  // 5. 手势拖拽状态：整卡义项大轨道 (Sense Track Drag)
  const [senseDragOffset, setSenseDragOffset] = useState(0);
  const [isSenseDragging, setIsSenseDragging] = useState(false);
  const senseStartX = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // 6. 手势拖拽状态：当前义项内的上方例句轨道 (Sentence Track Drag)
  const [upperDragOffset, setUpperDragOffset] = useState(0);
  const [isUpperDragging, setIsUpperDragging] = useState(false);
  const upperStartX = useRef(0);

  // 7. 触控板防抖锁
  const wheelLock = useRef(false);
  const wheelDelta = useRef(0);

  // 8. 菜单、译文与发音状态
  const [hideZh, setHideZh] = useState(false);
  const [starredMap, setStarredMap] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // 9. 点击查词与逐词播放高亮状态
  const [activeLookup, setActiveLookup] = useState<{
    senseIdx: number;
    sentIdx: number;
    tokenIdx: number;
    entry: QuickDictEntry;
  } | null>(null);
  const [playingTokenIdx, setPlayingTokenIdx] = useState<number | null>(null);

  // 同步外部 initialSenseIdx 或单词变更
  useEffect(() => {
    setSenseIdx(Math.min(initialSenseIdx, totalSenses - 1));
    setSentMap(new Array(totalSenses).fill(0));
    setDefRevealedMap(new Array(totalSenses).fill(false));
    setMenuOpen(false);
    setSenseDragOffset(0);
    setUpperDragOffset(0);
    setActiveLookup(null);
    setPlayingTokenIdx(null);
  }, [initialSenseIdx, curWord, totalSenses]);

  // 发音播放：结合 Web Speech onboundary 实现词级时间轴逐词点亮
  const handleSpeakSentence = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast('当前环境不支持语音播放');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/<[^>]*>/g, '').trim();
      const { tokens } = tokenizeSentence(text);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'en-US';
      utterance.rate = 0.92;

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const preferredVoice =
          voices.find(
            (v) =>
              (v.lang === 'en-US' || v.lang.replace('_', '-').startsWith('en-US')) &&
              (v.name.includes('Natural') ||
                v.name.includes('Google') ||
                v.name.includes('Samantha') ||
                v.name.includes('Ava') ||
                v.name.includes('Daniel') ||
                v.name.includes('Alex'))
          ) ||
          voices.find((v) => v.lang.startsWith('en-US')) ||
          voices.find((v) => v.lang.startsWith('en'));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }

      setIsPlayingAudio(true);
      setPlayingTokenIdx(null);

      utterance.onboundary = (e) => {
        if (e.name === 'word') {
          const tokIdx = findTokenIndexByCharOffset(tokens, e.charIndex);
          if (tokIdx !== -1) {
            setPlayingTokenIdx(tokIdx);
          }
        }
      };

      utterance.onend = () => {
        setIsPlayingAudio(false);
        setPlayingTokenIdx(null);
      };
      utterance.onerror = () => {
        setIsPlayingAudio(false);
        setPlayingTokenIdx(null);
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsPlayingAudio(false);
      setPlayingTokenIdx(null);
    }
  };

  // 切换义项（受边界保护）
  const handleSwitchSense = (targetIdx: number) => {
    if (targetIdx < 0 || targetIdx >= totalSenses) return;
    setSenseIdx(targetIdx);
    setMenuOpen(false);
    setActiveLookup(null);
    setPlayingTokenIdx(null);
  };

  // 切换当前义项内的例句
  const handleSwitchSentenceInSense = (sI: number, sentTarget: number) => {
    const sents = senseDetails[sI]?.sentences || curWord.sentences;
    const maxSent = sents.length - 1;
    if (sentTarget >= 0 && sentTarget <= maxSent) {
      setSentMap((prev) => {
        const next = [...prev];
        next[sI] = sentTarget;
        return next;
      });
      setActiveLookup(null);
      setPlayingTokenIdx(null);
    }
  };

  /* ---------- 上方例句滑动：支持当前义项切句 + 越界无缝换义 ---------- */
  const handleUpperPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest('button') ||
      (e.target as HTMLElement).closest('.tok-word') ||
      (e.target as HTMLElement).closest('.quick-dict-popup') ||
      (e.target as HTMLElement).closest('.quick-dict-overlay')
    ) {
      return;
    }
    upperStartX.current = e.clientX;
    setIsUpperDragging(true);
    setUpperDragOffset(0);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleUpperPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isUpperDragging) return;
    let deltaX = e.clientX - upperStartX.current;

    const currentSentences = senseDetails[senseIdx]?.sentences || curWord.sentences;
    const currentSentIdx = sentMap[senseIdx] || 0;

    // 全词最前端（第 1 义项第 1 句）向右拉阻尼
    if (senseIdx === 0 && currentSentIdx === 0 && deltaX > 0) {
      deltaX *= 0.28;
    }
    // 全词最后端（最后义项最后一句）向左拉阻尼
    if (senseIdx === totalSenses - 1 && currentSentIdx === currentSentences.length - 1 && deltaX < 0) {
      deltaX *= 0.28;
    }
    setUpperDragOffset(deltaX);
  };

  const handleUpperPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isUpperDragging) return;
    setIsUpperDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const currentSentences = senseDetails[senseIdx]?.sentences || curWord.sentences;
    const currentSentIdx = sentMap[senseIdx] || 0;

    if (upperDragOffset < -40) {
      // 向左划
      if (currentSentIdx < currentSentences.length - 1) {
        // 在当前义项内切到下一句
        handleSwitchSentenceInSense(senseIdx, currentSentIdx + 1);
      } else {
        // 超过当前义项例句个数 -> 越界滑入下一个义项！
        if (senseIdx < totalSenses - 1) {
          handleSwitchSense(senseIdx + 1);
          handleSwitchSentenceInSense(senseIdx + 1, 0);
          toast(`已滑入下一义项：${senseDetails[senseIdx + 1]?.text || ''}`);
        } else {
          toast('已经是最后一个例句了');
        }
      }
    } else if (upperDragOffset > 40) {
      // 向右划
      if (currentSentIdx > 0) {
        // 在当前义项内切到上一句
        handleSwitchSentenceInSense(senseIdx, currentSentIdx - 1);
      } else {
        // 在第一句向右划 -> 越界滑回上一个义项！
        if (senseIdx > 0) {
          const prevSentCount = senseDetails[senseIdx - 1]?.sentences?.length || 1;
          handleSwitchSense(senseIdx - 1);
          handleSwitchSentenceInSense(senseIdx - 1, prevSentCount - 1);
          toast(`已滑回上一义项：${senseDetails[senseIdx - 1]?.text || ''}`);
        } else {
          toast('已经是第一个例句了');
        }
      }
    }
    setUpperDragOffset(0);
  };

  const handleUpperPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isUpperDragging) return;
    setIsUpperDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setUpperDragOffset(0);
  };

  /* ---------- 上方例句区域：Mac 触控板双指左右轻扫 ---------- */
  const handleUpperWheel = (e: ReactWheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) {
      if (wheelLock.current) return;
      wheelDelta.current += e.deltaX;

      const currentSentences = senseDetails[senseIdx]?.sentences || curWord.sentences;
      const currentSentIdx = sentMap[senseIdx] || 0;

      if (wheelDelta.current > 35) {
        // 双指往左划
        wheelLock.current = true;
        wheelDelta.current = 0;
        if (currentSentIdx < currentSentences.length - 1) {
          handleSwitchSentenceInSense(senseIdx, currentSentIdx + 1);
        } else if (senseIdx < totalSenses - 1) {
          handleSwitchSense(senseIdx + 1);
          handleSwitchSentenceInSense(senseIdx + 1, 0);
          toast(`已滑入下一义项：${senseDetails[senseIdx + 1]?.text || ''}`);
        } else {
          toast('已经是最后一个例句了');
        }
        setTimeout(() => { wheelLock.current = false; }, 320);
      } else if (wheelDelta.current < -35) {
        // 双指往右划
        wheelLock.current = true;
        wheelDelta.current = 0;
        if (currentSentIdx > 0) {
          handleSwitchSentenceInSense(senseIdx, currentSentIdx - 1);
        } else if (senseIdx > 0) {
          const prevSentCount = senseDetails[senseIdx - 1]?.sentences?.length || 1;
          handleSwitchSense(senseIdx - 1);
          handleSwitchSentenceInSense(senseIdx - 1, prevSentCount - 1);
          toast(`已滑回上一义项：${senseDetails[senseIdx - 1]?.text || ''}`);
        } else {
          toast('已经是第一个例句了');
        }
        setTimeout(() => { wheelLock.current = false; }, 320);
      }
    }
  };

  /* ---------- 下方释义区滑动：整卡义项大轨道滑动（有边界） ---------- */
  const handleSensePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest('button') ||
      (e.target as HTMLElement).closest('.tok-word') ||
      (e.target as HTMLElement).closest('.quick-dict-popup') ||
      (e.target as HTMLElement).closest('.quick-dict-overlay')
    ) {
      return;
    }
    senseStartX.current = e.clientX;
    setIsSenseDragging(true);
    setSenseDragOffset(0);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleSensePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSenseDragging) return;
    let deltaX = e.clientX - senseStartX.current;
    // 边界阻尼
    if (senseIdx === 0 && deltaX > 0) deltaX *= 0.28;
    if (senseIdx === totalSenses - 1 && deltaX < 0) deltaX *= 0.28;
    setSenseDragOffset(deltaX);
  };

  const handleSensePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSenseDragging) return;
    setIsSenseDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (senseDragOffset < -40) {
      if (senseIdx < totalSenses - 1) {
        handleSwitchSense(senseIdx + 1);
      }
    } else if (senseDragOffset > 40) {
      if (senseIdx > 0) {
        handleSwitchSense(senseIdx - 1);
      }
    }
    setSenseDragOffset(0);
  };

  const handleSensePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSenseDragging) return;
    setIsSenseDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setSenseDragOffset(0);
  };

  /* ---------- 下方释义区：Mac 触控板双指滑动切义项（有边界） ---------- */
  const handleLowerWheel = (e: ReactWheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 10) {
      if (wheelLock.current) return;
      wheelDelta.current += e.deltaX;
      if (wheelDelta.current > 35) {
        wheelLock.current = true;
        wheelDelta.current = 0;
        if (senseIdx < totalSenses - 1) {
          handleSwitchSense(senseIdx + 1);
        }
        setTimeout(() => { wheelLock.current = false; }, 360);
      } else if (wheelDelta.current < -35) {
        wheelLock.current = true;
        wheelDelta.current = 0;
        if (senseIdx > 0) {
          handleSwitchSense(senseIdx - 1);
        }
        setTimeout(() => { wheelLock.current = false; }, 360);
      }
    }
  };

  // ================= 3. 计算弹性指示点 (Elastic / Scaling Worm Indicator) 核心算法 =================
  const cardWidth = viewportRef.current?.clientWidth || 360;
  const dragFraction = -senseDragOffset / cardWidth;
  const continuousIndex = Math.max(0, Math.min(totalSenses - 1, senseIdx + dragFraction));
  const slotStep = 24; // 每个圆点槽位间距 24px
  const basePillWidth = 38; // 胶囊基准宽度

  // 弹性变形计算 (Elastic stretch & back-edge delay)
  const fromIdx = Math.floor(continuousIndex);
  const frac = continuousIndex - fromIdx; // [0, 1)
  
  // 前端先行，尾部滞后
  const frontProgress = Math.min(1, frac * 1.5);
  const backProgress = Math.max(0, (frac - 0.3) / 0.7);
  
  const currentPillLeft = (fromIdx + backProgress) * slotStep;
  const currentPillWidth = basePillWidth + (frontProgress - backProgress) * slotStep;

  return (
    <section
      className={`screen${active ? ' active' : ''}`}
      id="s-example"
      data-anim="slide"
    >
      <div className="exscroll">
        {/* ================= 外层：整卡义项大轨道视口 (Grand Sense Viewport) ================= */}
        <div className="ex-sense-viewport" ref={viewportRef}>
          <div
            className="ex-sense-track"
            style={{
              transform: `translateX(calc(-${senseIdx * 100}% + ${senseDragOffset}px))`,
              transition: isSenseDragging ? 'none' : 'transform 0.36s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {senseDetails.map((sense, sI) => {
              const currentSenseSentIdx = sentMap[sI] || 0;
              const sents = senseDetails[sI]?.sentences || curWord.sentences;
              const isRevealed = defRevealedMap[sI] || false;

              return (
                <div key={sI} className="excard ex-sense-card">
                  {/* ----- 1. 该义项内部的上半部分：影视例句轮播轨道 ----- */}
                  <div
                    className="ex-img-viewport"
                    onWheel={handleUpperWheel}
                    onPointerDown={handleUpperPointerDown}
                    onPointerMove={handleUpperPointerMove}
                    onPointerUp={handleUpperPointerUp}
                    onPointerCancel={handleUpperPointerCancel}
                    style={{
                      cursor: isUpperDragging ? 'grabbing' : 'grab',
                      userSelect: 'none',
                      touchAction: 'none',
                    }}
                  >
                    <div
                      className="ex-img-track"
                      style={{
                        transform: `translateX(calc(-${currentSenseSentIdx * 100}% + ${sI === senseIdx ? upperDragOffset : 0}px))`,
                        transition: (isUpperDragging && sI === senseIdx) ? 'none' : 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
                      }}
                    >
                      {sents.map((sent, sentI) => {
                        const starKey = `${curWord.id || curWord.w}_${sI}_${sentI}`;
                        const isStarred = starredMap[starKey] || false;

                        return (
                          <div
                            key={sentI}
                            className={`ex-slide ex-img ${sent.theme || 'bbt'}`}
                          >
                            {/* 顶部标题与右上角菜单按钮（= 与 ✕ 切换） */}
                            <div className="ex-hd">
                              <div
                                className="src-wrap"
                                onClick={() => handleSpeakSentence(sent.en)}
                                title="点击朗读例句"
                              >
                                <span className="src">{sent.src}</span>
                                <span className={`src-audio-icon${isPlayingAudio ? ' playing' : ''}`}>
                                  <svg className="icon" style={{ width: 14, height: 14 }}>
                                    <use href="#i-vol-fill" />
                                  </svg>
                                </span>
                              </div>
                              <button
                                className={`ex-menu-trigger${menuOpen ? ' open' : ''}`}
                                onClick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  setMenuOpen(!menuOpen);
                                }}
                                aria-label="菜单"
                              >
                                <svg className="icon" style={{ width: 20, height: 20 }}>
                                  <use href={menuOpen ? '#i-close' : '#i-bars-2'} />
                                </svg>
                              </button>
                            </div>

                            {/* 例句主体 */}
                            <div
                              className="ex-body"
                              onClick={() => handleSpeakSentence(sent.en)}
                              title="点击朗读例句"
                            >
                              <div className="ex-en">
                                <ClickableSentence
                                  sentenceHtml={sent.en}
                                  activeTokenIdx={
                                    activeLookup &&
                                    activeLookup.senseIdx === sI &&
                                    activeLookup.sentIdx === sentI
                                      ? activeLookup.tokenIdx
                                      : null
                                  }
                                  playingTokenIdx={
                                    isPlayingAudio &&
                                    senseIdx === sI &&
                                    currentSenseSentIdx === sentI
                                      ? playingTokenIdx
                                      : null
                                  }
                                  onWordClick={(tok, idx) => {
                                    const entry = lookupWord(tok.cleanWord);
                                    setActiveLookup({
                                      senseIdx: sI,
                                      sentIdx: sentI,
                                      tokenIdx: idx,
                                      entry,
                                    });
                                  }}
                                />
                              </div>
                              <div className={`ex-zh${hideZh ? ' hide' : ''}`}>
                                {sent.zh}
                              </div>
                            </div>

                            {/* 底栏：收藏星标 + 该义项例句轮播圆点 + 右侧快捷译文按钮 */}
                            <div className="ex-bot">
                              {/* 收藏星标 */}
                              <button
                                className={`star${isStarred ? ' on' : ''}`}
                                onClick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  const next = !isStarred;
                                  setStarredMap((prev) => ({ ...prev, [starKey]: next }));
                                  toast(next ? '已收藏例句至句库' : '已取消收藏');
                                }}
                                aria-label="收藏例句"
                              >
                                <svg
                                  className="icon"
                                  style={{
                                    width: 22,
                                    height: 22,
                                    fill: isStarred ? '#f2701c' : 'none',
                                    stroke: isStarred ? '#f2701c' : 'rgba(255,255,255,0.92)',
                                  }}
                                >
                                  <use href="#i-star" />
                                </svg>
                              </button>

                              {/* 例句轮播圆点 */}
                              <div className="ex-dots">
                                {sents.map((_, dotI) => (
                                  <i
                                    key={dotI}
                                    className={dotI === currentSenseSentIdx ? 'on' : ''}
                                    onClick={(e: MouseEvent) => {
                                      e.stopPropagation();
                                      handleSwitchSentenceInSense(sI, dotI);
                                    }}
                                    title={`第 ${dotI + 1} 句`}
                                  />
                                ))}
                              </div>

                              {/* 1:1 还原快捷译文切换图标 */}
                              <button
                                className={`ex-trans-btn${!hideZh ? ' on' : ''}`}
                                onClick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  const next = !hideZh;
                                  setHideZh(next);
                                  toast(next ? '已隐藏例句中文译文' : '已开启例句中文译文');
                                }}
                                aria-label="切换中文译文"
                                title={hideZh ? '显示中文译文' : '隐藏中文译文'}
                              >
                                <span className="trans-badge">
                                  <span className="trans-char">译</span>
                                  <span className="trans-sub">文</span>
                                </span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 右上角菜单：毛玻璃半透明圆角胶囊列表 */}
                    {menuOpen && sI === senseIdx && (
                      <div className="ex-acts-popup" onClick={(e: MouseEvent) => e.stopPropagation()}>
                        <button
                          className="ex-act-pill"
                          onClick={() => {
                            const next = !hideZh;
                            setHideZh(next);
                            setMenuOpen(false);
                            toast(next ? '已隐藏例句中文译文' : '已开启例句中文译文');
                          }}
                        >
                          {hideZh ? '显示译文' : '关闭译文'}
                        </button>
                        <button
                          className="ex-act-pill"
                          onClick={() => {
                            setMenuOpen(false);
                            toast('查看上下文：还原至完整原声音频与剧本');
                          }}
                        >
                          查看上下文
                        </button>
                        <button
                          className="ex-act-pill"
                          onClick={() => {
                            setMenuOpen(false);
                            toast('例句攻略：剖析地道表达与语法考点');
                          }}
                        >
                          例句攻略
                        </button>
                        <button
                          className="ex-act-pill"
                          onClick={() => {
                            setMenuOpen(false);
                            toast('纠错｜举报：感谢您的反馈与支持');
                          }}
                        >
                          纠错｜举报
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ----- 2. 该义项下半部分：词典双语释义卡（滑动触发整卡义项切换） ----- */}
                  <div
                    className="ex-def"
                    onWheel={handleLowerWheel}
                    onPointerDown={handleSensePointerDown}
                    onPointerMove={handleSensePointerMove}
                    onPointerUp={handleSensePointerUp}
                    onPointerCancel={handleSensePointerCancel}
                    style={{
                      cursor: isSenseDragging ? 'grabbing' : 'grab',
                      userSelect: 'none',
                      touchAction: 'none',
                    }}
                  >
                    {/* 模糊/展开的双语释义文本 */}
                    <div className={`blurtext${isRevealed ? ' open' : ''}`}>
                      <div
                        className="def-text-content"
                        dangerouslySetInnerHTML={{ __html: sense.def || curWord.def }}
                      />
                      {sense.pattern && (
                        <div className="ex-pattern">
                          {sense.pattern}
                        </div>
                      )}
                    </div>

                    {/* 查看双语释义 框线角标按钮 */}
                    {!isRevealed && (
                      <button
                        className="reveal"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          setDefRevealedMap((prev) => {
                            const next = [...prev];
                            next[sI] = true;
                            return next;
                          });
                        }}
                        aria-label="查看双语释义"
                      >
                        <span className="br l" />
                        查看双语释义
                        <span className="br r" />
                      </button>
                    )}

                    {/* 右下角简洁页码 (如 1/3, 6/7) */}
                    <div className="ex-def-footer">
                      <span className="pg">
                        {sI + 1}/{totalSenses}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================= 3. 底部弹性指示点 (Elastic / Scaling Dots) ================= */}
      <div className="tagline" id="exTag">
        {totalSenses > 1 ? (
          <div className="tag-fluid-track">
            {/* 底层弹性圆点阵列 (Elastic Dots：被胶囊推开/挤压/吞没，松手后弹性回弹) */}
            <div className="tag-track-dots">
              {senseDetails.map((_, i) => {
                // 与上层胶囊完全同步的矩形几何（胶囊静态左偏移 -4px = left:12px + margin-left:-16px）
                const pillL = currentPillLeft - 4;
                const pillR = pillL + currentPillWidth;
                // 圆点 i 中心 x（track 左内边距 12px + 半径 3px，槽位间距 slotStep）
                const dotC = 15 + i * slotStep;

                const REPEL = 22; // 胶囊边缘的弹性作用半径 (px)
                const PUSH = 6;   // 最大推开位移 (px)
                const EPS = 3;    // 吞没判定的边缘容差 (px)

                const leftGap = pillL + EPS - dotC;
                const rightGap = dotC - (pillR - EPS);

                let dx = 0;
                let sx = 1;
                let sy = 1;
                let opacity = 0.85;

                if (leftGap <= 0 && rightGap <= 0) {
                  // 被胶囊吞没：完全吸收
                  sx = 0;
                  sy = 0;
                  opacity = 0;
                } else {
                  const gap = Math.max(leftGap, rightGap);
                  if (gap < REPEL) {
                    // 弹性排斥：越贴近胶囊边缘，推开越远、挤压越扁 (squash & stretch)
                    const f = 1 - gap / REPEL;
                    dx = (leftGap > rightGap ? -1 : 1) * f * PUSH;
                    sx = 1 - 0.3 * f;
                    sy = 1 + 0.22 * f;
                  }
                }

                return (
                  <button
                    key={i}
                    className="tag-track-dot"
                    onClick={() => handleSwitchSense(i)}
                    style={{
                      transform: `translateX(${dx}px) scale(${sx}, ${sy})`,
                      opacity,
                      transition: isSenseDragging
                        ? 'none'
                        : 'transform 0.45s cubic-bezier(0.3, 1.5, 0.45, 1), opacity 0.28s ease',
                    }}
                    aria-label={`切换至第 ${i + 1} 义项`}
                  />
                );
              })}
            </div>

            {/* 上层随手势弹性拉伸 (Elastic Morphing) 的橙色药丸胶囊与文字 */}
            <div
              className="tag-sliding-pill"
              style={{
                transform: `translateX(${currentPillLeft}px)`,
                width: `${currentPillWidth}px`,
                transition: isSenseDragging ? 'none' : 'transform 0.45s cubic-bezier(0.3, 1.5, 0.45, 1), width 0.45s cubic-bezier(0.3, 1.5, 0.45, 1)',
              }}
            >
              <div className="tag-pill-text-window">
                <div
                  className="tag-pill-text-track"
                  style={{
                    transform: `translateX(-${continuousIndex * 26}px)`,
                    transition: isSenseDragging ? 'none' : 'transform 0.45s cubic-bezier(0.3, 1.5, 0.45, 1)',
                  }}
                >
                  {senseDetails.map((s, idx) => (
                    <span key={idx} className="tag-pill-text-item">
                      {s.tag || curWord.tags?.[0] || '核心'}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <span className="tag-sense-capsule on">
            {curWord.tags?.[0] || '核心'}
          </span>
        )}
      </div>

      {/* ================= 4. 底部操作双按键 ================= */}
      <div className="lfoot two-up">
        <button
          className="fbtn green"
          onClick={() => {
            onClose();
            onNextWord();
          }}
        >
          下一词<i />
        </button>
        <button className="fbtn orange" onClick={onClose}>
          收起卡片<i />
        </button>
      </div>

      {/* ================= 5. 例句点词查词浮层 (Quick Dict Popup) ================= */}
      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={() => setActiveLookup(null)}
          toast={toast}
          onViewDetail={(word) => {
            setActiveLookup(null);
            if (onOpenDict) {
              onOpenDict(word, '柯林斯');
            } else {
              toast(`查看 "${word}" 的完整学习卡片`);
            }
          }}
        />
      )}
    </section>
  );
};
