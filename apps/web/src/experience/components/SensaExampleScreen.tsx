import { uiClass } from '../ui/classes';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DictionaryLookupRequest,
  SyncedExampleMediaRender,
} from '../types';
import { audioService } from '../services/audioService';
import { personalContentService } from '../services/personalContentService';
import { lookupDictionaryEntry } from '../services/quickDict';
import { ClickableSentence } from './ClickableSentence';
import type { ExampleScreenProps } from './ExampleScreen';
import { LearningExampleLookup } from './examples/LearningExampleLookup';
import { useImmediateDictionaryLookup } from './useImmediateDictionaryLookup';
import { ExampleCardCarousel } from './examples/ExampleCardCarousel';

const stripMarkup = (value: string): string => value.replace(/<[^>]*>/g, '').trim();

function SyncedMediaSurface({ render }: { render: SyncedExampleMediaRender }) {
  return (
    <section className="sensa-example-media" aria-label={`${render.providerLabel} 原声片段`}>
      {render.kind === 'video' ? (
        <video
          controls
          preload="metadata"
          poster={render.posterUrl}
          src={render.playbackUrl}
          onPlay={() => audioService.stop()}
        >
          当前浏览器无法播放这段已审核媒体。
        </video>
      ) : (
        <iframe
          src={render.embedUrl}
          title={`${render.providerLabel} 原声片段`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      <footer>
        <span>{render.providerLabel}</span>
        {render.rightsLabel && <small>{render.rightsLabel}</small>}
        {render.sourceUrl && (
          <a href={render.sourceUrl} target="_blank" rel="noreferrer">查看来源</a>
        )}
      </footer>
    </section>
  );
}

export function SensaExampleScreen({
  active,
  curWord,
  initialSenseIdx = 0,
  initialSentenceIdx = 0,
  sentenceSequence,
  onClose,
  onOpenDict,
  toast,
}: ExampleScreenProps) {
  const senseDetails = useMemo(() => (
    curWord.senseDetails && curWord.senseDetails.length > 0
      ? curWord.senseDetails
      : [{
          id: curWord.id,
          pos: curWord.senses[0]?.pos || '',
          text: curWord.senses[0]?.items[0] || '当前意思',
          def: curWord.def,
          sentences: curWord.sentences,
        }]
  ), [curWord]);
  const [senseIndex, setSenseIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const [, setPersonalContentRevision] = useState(0);
  const playbackToken = useRef(0);
  const wordIdentity = curWord.id ?? curWord.w;
  const sequenceIdentity = sentenceSequence?.join(',') ?? '';

  const sense = senseDetails[senseIndex] ?? senseDetails[0];
  const availableSentences = sense?.sentences?.length ? sense.sentences : curWord.sentences;
  const sentences = useMemo(() => {
    const requestedIndices = sentenceSequence?.length
      ? Array.from(new Set(sentenceSequence))
      : [initialSentenceIdx];
    const authorized = requestedIndices.flatMap((index) => {
      const item = availableSentences[index];
      return item ? [item] : [];
    });
    return authorized;
  }, [availableSentences, initialSentenceIdx, sentenceSequence]);
  const sentence = sentences[sentenceIndex] ?? sentences[0] ?? null;
  const exampleId = sentence?.exampleId
    ?? `${curWord.id ?? curWord.w}:example:${senseIndex}:${sentence ? availableSentences.indexOf(sentence) : initialSentenceIdx}`;
  const isSaved = personalContentService.isExampleSaved(exampleId);
  const hasPrevious = sentenceIndex > 0;
  const hasNext = sentenceIndex < sentences.length - 1;

  const stopPlayback = useCallback(() => {
    playbackToken.current += 1;
    audioService.stop();
    setIsPlaying(false);
  }, []);

  const switchSentence = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= sentences.length || nextIndex === sentenceIndex) return;
    stopPlayback();
    setSentenceIndex(nextIndex);
    clearLookup();
    setShowContext(false);
  }, [clearLookup, sentenceIndex, sentences.length, stopPlayback]);

  useEffect(() => {
    const nextSenseIndex = Math.min(
      Math.max(0, initialSenseIdx),
      Math.max(0, senseDetails.length - 1),
    );
    setSenseIndex(nextSenseIndex);
    setSentenceIndex(0);
    setShowTranslation(true);
    setShowContext(false);
    clearLookup();
    if (active) stopPlayback();
    // Sense Versions are immutable in one installed release, so identity—not
    // the presentation object's allocation—controls viewer reset.
  }, [active, clearLookup, initialSenseIdx, initialSentenceIdx, senseDetails.length, sequenceIdentity, stopPlayback, wordIdentity]);

  useEffect(
    () => personalContentService.subscribe(() => {
      setPersonalContentRevision((revision) => revision + 1);
    }),
    [],
  );

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeLookup) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, button, a')) return;
      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault();
        switchSentence(sentenceIndex - 1);
      }
      if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        switchSentence(sentenceIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopPlayback();
    };
  }, [activeLookup, active, hasNext, hasPrevious, sentenceIndex, stopPlayback, switchSentence]);

  const playSentence = () => {
    if (!sentence) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const text = stripMarkup(sentence.en);
    if (!sentence.audioUrl && curWord.id && !curWord.id.startsWith('w_')) {
      toast('这条例句暂未提供可播放的已审核音频');
      return;
    }

    const token = playbackToken.current + 1;
    playbackToken.current = token;
    setIsPlaying(true);
    const playback = sentence.audioUrl
      ? sentence.audioUrl.startsWith('/golden-audio/')
        ? audioService.playPackagedAudioUrl(sentence.audioUrl, text, 'us')
        : audioService.playAudioUrl(sentence.audioUrl, text, 'us')
      : audioService.playSentence(text, 'us');
    void playback.catch(() => {
      if (playbackToken.current === token) toast('音频播放失败，请重试');
    }).finally(() => {
      if (playbackToken.current === token) setIsPlaying(false);
    });
  };

  const close = () => {
    stopPlayback();
    clearLookup();
    onClose();
  };

  return (
    <section
      className={`screen sensa-example-screen${active ? ' active' : ''}`}
      id="s-example"
      data-learning-example="true"
      data-anim="slide"
    >
      <header className="sensa-example-topbar">
        <button type="button" onClick={close} aria-label="返回学习">
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <div>
          <strong>{curWord.w}</strong>
          <span>{sense?.pos} {sense?.text}</span>
        </div>
        <button
          type="button"
          className={isSaved ? 'is-saved' : ''}
          disabled={!sentence}
          aria-pressed={isSaved}
          onClick={() => {
            try {
              const saved = personalContentService.toggleExample(exampleId);
              toast(saved ? '已收藏这条例句' : '已取消收藏');
            } catch {
              toast('收藏未能保存，请重试');
            }
          }}
          aria-label={isSaved ? '取消收藏这条例句' : '收藏这条例句'}
        >
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-star" /></svg>
        </button>
      </header>

      <div className="sensa-example-scroll">
        <ExampleCardCarousel
          itemCount={sentences.length}
          currentIndex={sentenceIndex}
          onIndexChange={switchSentence}
          itemKeys={sentences.map((entry, index) => entry.exampleId ?? String(index))}
        >
          {sentence ? (
            <article className="sensa-example-viewer">
            <div className="sensa-example-source">
              <div>
                <span>{sentence.sourceKind === 'attested_usage' ? '已审核原声' : '已审核学习例句'}</span>
                <strong>{sentence.src}</strong>
              </div>
              <small>
                {sentence.syncedMedia?.providerLabel
                  ?? (sentence.audioUrl ? '文本 · 静态音频' : '文本')}
              </small>
            </div>

            {active && sentence.syncedMedia && <SyncedMediaSurface render={sentence.syncedMedia} />}

            <section className="sensa-example-sentence" aria-label="当前例句">
              <p className="example-lookup-hint">点击句中单词，查看释义</p>
              <button
                type="button"
                className={`sensa-example-play${isPlaying ? ' is-playing' : ''}`}
                onClick={playSentence}
                aria-label={isPlaying ? '停止播放例句' : '播放例句'}
              >
                {isPlaying ? (
                  <span aria-hidden="true">Ⅱ</span>
                ) : (
                  <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-vol" /></svg>
                )}
              </button>
              <div className="sensa-example-l2">
                <ClickableSentence
                  sentenceHtml={sentence.en}
                  activeTokenIdx={activeLookup?.tokenIdx ?? null}
                  onWordClick={(token, tokenIdx) => {
                    const request: DictionaryLookupRequest = {
                      rawClickedForm: token.text,
                      exampleId,
                      textL2: stripMarkup(sentence.en),
                      clickedStart: token.charStart,
                      clickedEnd: token.charEnd,
                      clickedSurface: token.text,
                    };
                    openLookup({
                      tokenIdx,
                      displayWord: token.cleanWord,
                      load: async (signal) => {
                        const entry = await lookupDictionaryEntry(request, { signal });
                        if (!entry) toast('当前词典没有这个词');
                        return entry;
                      },
                    });
                  }}
                />
              </div>
              {showTranslation && <p className="sensa-example-l1">{sentence.zh}</p>}
              <button
                type="button"
                className="sensa-example-translation"
                aria-expanded={showTranslation}
                onClick={() => setShowTranslation((visible) => !visible)}
              >
                {showTranslation ? '隐藏译文' : '显示译文'}
              </button>
            </section>

            <section className="sensa-example-sense-anchor">
              <span>这句话里的 {curWord.w}</span>
              <strong>{sense?.pos} {sense?.text}</strong>
              {sense?.def && (
                <details>
                  <summary>查看义项边界</summary>
                  <p>{stripMarkup(sense.def)}</p>
                </details>
              )}
            </section>

            {(sentence.contextL2 || sentence.contextL1) && (
              <section className={`sensa-example-context${showContext ? ' is-open' : ''}`}>
                <button type="button" aria-expanded={showContext} onClick={() => setShowContext((visible) => !visible)}>
                  <span>完整上下文</span>
                  <b aria-hidden="true">{showContext ? '−' : '+'}</b>
                </button>
                {showContext && (
                  <div>
                    {sentence.contextL2 && <p>{sentence.contextL2}</p>}
                    {sentence.contextL1 && <small>{sentence.contextL1}</small>}
                  </div>
                )}
              </section>
            )}
            </article>
          ) : (
            <div className="sensa-example-unavailable" role="status">
              <strong>这条学习资源暂时不可用</strong>
              <p>当前义项没有可显示的已审核例句。</p>
            </div>
          )}
        </ExampleCardCarousel>
      </div>

      <footer className="sensa-example-footer">
        <button type="button" onClick={close}>返回学习</button>
        <p>查看、播放和收藏不会改变本次学习进度</p>
      </footer>

      {active && activeLookup && (
        <LearningExampleLookup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={onOpenDict ? (entry) => {
            clearLookup();
            onOpenDict(entry);
          } : undefined}
        />
      )}
    </section>
  );
}
