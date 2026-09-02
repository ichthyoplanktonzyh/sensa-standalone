import { useEffect, useRef, useState } from 'react';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type {
  DictionaryLookup,
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
} from '../../types';
import { audioService } from '../../services/audioService';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import { ExperienceRenderer } from './ExperienceRenderer';

export type IntroductionPhase = 'experience' | 'reveal';
export type RevealPresentation = 'compact' | 'baseline';

interface IntroductionCardProps {
  content: PrototypeIntroductionPackage;
  phase: IntroductionPhase;
  mode?: 'introduction' | 'repair_replay';
  repairPurpose?: 'acquisition' | 'retention';
  presentation?: RevealPresentation;
  onPhaseChange: (phase: IntroductionPhase) => void;
  onComplete: () => void;
  onOpenExample: (sentenceIndex?: number) => void;
  onOpenDictionary: (word?: string | QuickDictEntry) => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  toast: (message: string) => void;
}

const SoundIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 10v4h3l4 3V7L8 10H5Z" />
    <path d="M15 9.2c1.4 1.5 1.4 4.1 0 5.6M17.8 6.8c2.8 2.9 2.8 7.5 0 10.4" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

const OpenIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5H5v14h14v-3M12 5h7v7M19 5l-8 8" />
  </svg>
);

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 8H3V4" />
    <path d="M4 8a8 8 0 1 1-1 7" />
  </svg>
);

export function IntroductionCard({
  content,
  phase,
  mode = 'introduction',
  repairPurpose = 'retention',
  presentation = 'compact',
  onPhaseChange,
  onComplete,
  onOpenExample,
  onOpenDictionary,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  toast,
}: IntroductionCardProps) {
  const isRepairReplay = mode === 'repair_replay';
  const repairContext = repairPurpose === 'acquisition'
    ? {
        title: '学习中的定向修复',
        body: '这里只重建当前能力连接，稍后仍需再次独立检验。',
      }
    : {
        title: '复习中的 Reveal 回看',
        body: '这里只重建意思连接，不会再次结算本次复习。',
      };
  const continuationLabel = !isRepairReplay
    ? '继续，让它稍后再出现'
    : repairPurpose === 'acquisition'
    ? '完成修复，稍后再检验'
    : '返回复习结果';
  const continuationBody = !isRepairReplay
    ? '这次只建立连接；稍后会在新的语境中检验。'
    : repairPurpose === 'acquisition'
    ? '修复只恢复当前能力连接，不能代替下一次独立检验。'
    : '回看只恢复连接，不会再次产生复习结果。';
  const lookupExampleToken = async (
    token: {
      text: string;
      cleanWord: string;
      charStart: number;
      charEnd: number;
    },
    exampleId: string,
    textL2: string,
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const request: DictionaryLookupRequest = {
      rawClickedForm: token.text,
      exampleId,
      textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: token.text,
    };
    const entry = await lookupDictionary(request, options);
    if (!entry) {
      toast('当前 Reference 样本没有这个词');
    }
    return entry;
  };
  const revealHeadingRef = useRef<HTMLHeadingElement>(null);
  const [pronunciationIndex, setPronunciationIndex] = useState(0);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    clearLookup();
    setPronunciationIndex(0);
    if (phase !== 'reveal') return;
    const frame = requestAnimationFrame(() => revealHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [clearLookup, content.senseKey, phase]);

  if (phase === 'reveal') {
    const example = content.studyExample;
    const exampleHtml = `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
    const primaryPattern = content.supportTabs.flatMap((support) => support.patterns)[0] ?? null;
    const visibleCollocations = primaryPattern?.commonCollocations.slice(0, 2) ?? [];
    const activePronunciation = content.pronunciations[pronunciationIndex]
      ?? content.pronunciations[0]
      ?? null;

    const playPronunciation = (index: number, announceNext = false) => {
      const pronunciation = content.pronunciations[index];
      if (!pronunciation) return;
      const isUk = pronunciation.accentLocale === 'en-GB';
      const accent = isUk ? 'uk' : 'us';
      if (pronunciation.audioUrl) {
        void audioService.playPackagedAudioUrl(
          pronunciation.audioUrl,
          content.lemma,
          accent,
        );
      }

      if (!announceNext || content.pronunciations.length < 2) {
        toast(`正在播放${isUk ? '英式' : '美式'}发音`);
        return;
      }

      const nextIndex = (index + 1) % content.pronunciations.length;
      const nextIsUk = content.pronunciations[nextIndex]?.accentLocale === 'en-GB';
      setPronunciationIndex(nextIndex);
      toast(`正在播放${isUk ? '英式' : '美式'}发音；下次为${nextIsUk ? '英式' : '美式'}`);
    };

    if (presentation === 'compact') {
      const activeIsUk = activePronunciation?.accentLocale === 'en-GB';
      const nextPronunciation = content.pronunciations.length > 1
        ? content.pronunciations[(pronunciationIndex + 1) % content.pronunciations.length]
        : activePronunciation;
      const nextIsUk = nextPronunciation?.accentLocale === 'en-GB';

      return (
        <div className={`intro-reveal-page is-compact${isRepairReplay ? ' is-review-replay' : ''}`}>
          <div className="intro-reveal-field" aria-hidden="true">
            <i /><i /><i />
          </div>

          {isRepairReplay && (
            <div className="intro-review-replay-context" role="status">
              <span aria-hidden="true">↺</span>
              <p><strong>{repairContext.title}</strong>{repairContext.body}</p>
            </div>
          )}

          <header className="intro-reveal-identity intro-reveal-identity-compact">
            <div className="intro-reveal-form-row">
              <h1 ref={revealHeadingRef} tabIndex={-1}>{content.lemma}</h1>
              {activePronunciation && (
                <div className="intro-reveal-pronunciations is-combined">
                  <button
                    type="button"
                    onClick={() => playPronunciation(pronunciationIndex, true)}
                    aria-label={`播放${activeIsUk ? '英式' : '美式'}发音 ${activePronunciation.ipa}${content.pronunciations.length > 1 ? `；播放后切换为${nextIsUk ? '英式' : '美式'}` : ''}`}
                    title="点击播放；再次点击切换发音"
                  >
                    <span>{activeIsUk ? '英' : '美'}</span>
                    <b>{activePronunciation.ipa}</b>
                    <SoundIcon />
                  </button>
                </div>
              )}
            </div>

            <div className="intro-reveal-sense intro-reveal-sense-compact">
              <div>
                <span>{content.partOfSpeech}</span>
                <h2>{content.guideLabelL1}</h2>
              </div>
              <button
                type="button"
                className="intro-compact-recap"
                onClick={() => onPhaseChange('experience')}
              >
                <ReplayIcon />回看体验
              </button>
            </div>
          </header>

          <section className="intro-reveal-bridge intro-reveal-bridge-compact" aria-labelledby="intro-reveal-bridge-title">
            <span className="intro-reveal-section-label" id="intro-reveal-bridge-title">核心意思</span>
            <p>{content.l1Bridge}</p>
          </section>

          {primaryPattern?.usageRestriction && (
            <section className="intro-compact-boundary" aria-label="这个义项的使用边界">
              <span>边界</span>
              <p>{primaryPattern.usageRestriction}</p>
            </section>
          )}

          <section className="intro-reveal-example intro-reveal-example-compact" aria-labelledby="intro-reveal-example-title">
            <div className="intro-reveal-example-head">
              <span className="intro-reveal-section-label" id="intro-reveal-example-title">放进一句话</span>
              <div>
                {example.audioUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      void audioService.playPackagedAudioUrl(example.audioUrl!, example.textL2, 'us');
                      toast('正在播放学习例句');
                    }}
                    aria-label="播放学习例句"
                  >
                    <SoundIcon />
                  </button>
                )}
                <button type="button" onClick={() => onOpenExample(0)} aria-label="查看完整例句">
                  <OpenIcon />
                </button>
              </div>
            </div>
            <div className="intro-reveal-example-l2">
              <ClickableSentence
                sentenceHtml={exampleHtml}
                activeTokenIdx={activeLookup?.tokenIdx ?? null}
                onWordClick={(token, tokenIdx) => {
                  openLookup({
                    tokenIdx,
                    displayWord: token.cleanWord,
                    load: (signal) => lookupExampleToken(
                      token,
                      example.exampleKey,
                      example.textL2,
                      { signal },
                    ),
                  });
                }}
              />
            </div>
            <p>{example.textL1}</p>
          </section>

          {primaryPattern && (
            <details className="intro-compact-more">
              <summary>更多用法</summary>
              <div>
                <p className="intro-compact-full-bridge">{content.l1Bridge}</p>
                <strong>{primaryPattern.canonicalPattern}</strong>
                {(primaryPattern.registerLabel || primaryPattern.domainLabel) && (
                  <small>{primaryPattern.registerLabel ?? primaryPattern.domainLabel}</small>
                )}
                {visibleCollocations.length > 0 && (
                  <div className="intro-reveal-collocations" aria-label="相关例句">
                    {visibleCollocations.map((collocation) => collocation.exampleIndex >= 0 ? (
                      <button
                        type="button"
                        key={collocation.text}
                        onClick={() => onOpenExample(collocation.exampleIndex)}
                      >
                        {collocation.text}<ArrowIcon />
                      </button>
                    ) : (
                      <span key={collocation.text}>{collocation.text}</span>
                    ))}
                  </div>
                )}
                {primaryPattern.usageRestriction && (
                  <p className="intro-compact-more-boundary">{primaryPattern.usageRestriction}</p>
                )}
              </div>
            </details>
          )}

          <PersonalConnectionActions
            senseId={content.senseKey}
            onOpenNote={onOpenNote}
            onOpenScene={onOpenScene}
            variant="compact"
          />

          <footer className="intro-reveal-footer intro-reveal-footer-compact">
            <button type="button" className="intro-reveal-continue" onClick={onComplete}>
              <span>{continuationLabel}</span>
              <ArrowIcon />
            </button>
          </footer>

          {activeLookup && (
            <QuickDictPopup
              entry={activeLookup.entry}
              onClose={clearLookup}
              toast={toast}
              onViewDetail={(word, contextualEntry) => {
                clearLookup();
                onOpenDictionary(contextualEntry ?? word);
              }}
            />
          )}
        </div>
      );
    }

    return (
      <div className={`intro-reveal-page is-baseline${isRepairReplay ? ' is-review-replay' : ''}`}>
        <div className="intro-reveal-field" aria-hidden="true">
          <i /><i /><i />
        </div>

        {isRepairReplay && (
          <div className="intro-review-replay-context" role="status">
            <span aria-hidden="true">↺</span>
            <p><strong>{repairContext.title}</strong>{repairContext.body}</p>
          </div>
        )}

        <header className="intro-reveal-identity">
          <span className="intro-reveal-kicker">这个经验，在英文里是</span>
          <div className="intro-reveal-form-row">
            <h1 ref={revealHeadingRef} tabIndex={-1}>{content.lemma}</h1>
            <i aria-hidden="true" />
          </div>

          <div className="intro-reveal-pronunciations" aria-label={`${content.lemma} 的发音`}>
            {content.pronunciations.map((pronunciation) => {
              const isUk = pronunciation.accentLocale === 'en-GB';
              return (
                <button
                  type="button"
                  key={pronunciation.pronunciationKey}
                  onClick={() => playPronunciation(content.pronunciations.indexOf(pronunciation))}
                  aria-label={`播放${isUk ? '英式' : '美式'}发音 ${pronunciation.ipa}`}
                >
                  <span>{isUk ? '英' : '美'}</span>
                  <b>{pronunciation.ipa}</b>
                  <SoundIcon />
                </button>
              );
            })}
          </div>

          <div className="intro-reveal-sense">
            <span>{content.partOfSpeech}</span>
            <h2>{content.guideLabelL1}</h2>
          </div>
        </header>

        <button
          type="button"
          className="intro-reveal-recap"
          onClick={() => onPhaseChange('experience')}
        >
          <span className="intro-reveal-section-label">刚刚的经验</span>
          <p>{content.experienceSketch.bodyL1}</p>
          <span className="intro-reveal-recap-path" aria-hidden="true">
            {content.experienceSketch.labelsL1.map((label, index) => (
              <span key={label}>
                {index > 0 && <i />}
                <b>{label}</b>
              </span>
            ))}
          </span>
          <span className="intro-reveal-replay-label"><ReplayIcon />回看</span>
        </button>

        <section className="intro-reveal-bridge" aria-labelledby="intro-reveal-bridge-title">
          <span className="intro-reveal-section-label" id="intro-reveal-bridge-title">意思连接</span>
          <p>{content.l1Bridge}</p>
        </section>

        {primaryPattern && (
          <section className="intro-reveal-usage" aria-labelledby="intro-reveal-usage-title">
            <div className="intro-reveal-usage-head">
              <span className="intro-reveal-section-label" id="intro-reveal-usage-title">
                {primaryPattern.usageRestriction ? '这个意思的使用边界' : '这个意思常这样出现'}
              </span>
              {(primaryPattern.registerLabel || primaryPattern.domainLabel) && (
                <small>{primaryPattern.registerLabel ?? primaryPattern.domainLabel}</small>
              )}
            </div>
            <strong>{primaryPattern.canonicalPattern}</strong>
            {visibleCollocations.length > 0 && (
              <div className="intro-reveal-collocations" aria-label="相关例句">
                {visibleCollocations.map((collocation) => collocation.exampleIndex >= 0 ? (
                  <button
                    type="button"
                    key={collocation.text}
                    onClick={() => onOpenExample(collocation.exampleIndex)}
                  >
                    {collocation.text}<ArrowIcon />
                  </button>
                ) : (
                  <span key={collocation.text}>{collocation.text}</span>
                ))}
              </div>
            )}
            {primaryPattern.usageRestriction && <p>{primaryPattern.usageRestriction}</p>}
          </section>
        )}

        <section className="intro-reveal-example" aria-labelledby="intro-reveal-example-title">
          <div className="intro-reveal-example-head">
            <span className="intro-reveal-section-label" id="intro-reveal-example-title">放进一句话</span>
            <div>
              {example.audioUrl && (
                <button
                  type="button"
                  onClick={() => {
                    void audioService.playPackagedAudioUrl(example.audioUrl!, example.textL2, 'us');
                    toast('正在播放学习例句');
                  }}
                  aria-label="播放学习例句"
                >
                  <SoundIcon />
                </button>
              )}
              <button type="button" onClick={() => onOpenExample(0)} aria-label="查看完整例句">
                <OpenIcon />
              </button>
            </div>
          </div>
          <div className="intro-reveal-example-l2">
            <ClickableSentence
              sentenceHtml={exampleHtml}
                activeTokenIdx={activeLookup?.tokenIdx ?? null}
                onWordClick={(token, tokenIdx) => {
                  openLookup({
                    tokenIdx,
                    displayWord: token.cleanWord,
                    load: (signal) => lookupExampleToken(
                      token,
                      example.exampleKey,
                      example.textL2,
                      { signal },
                    ),
                  });
                }}
            />
          </div>
          <p>{example.textL1}</p>
        </section>

        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="reveal"
        />

        <footer className="intro-reveal-footer">
          <p>
            {continuationBody}
          </p>
          <button type="button" className="intro-reveal-continue" onClick={onComplete}>
            <span>{continuationLabel}</span>
            <ArrowIcon />
          </button>
        </footer>

        {activeLookup && (
          <QuickDictPopup
            entry={activeLookup.entry}
            onClose={clearLookup}
            toast={toast}
              onViewDetail={(word, contextualEntry) => {
                clearLookup();
                onOpenDictionary(contextualEntry ?? word);
              }}
          />
        )}
      </div>
    );
  }

  return (
    <ExperienceRenderer
      experience={content.experience}
      mode={isRepairReplay ? 'replay' : 'introduction'}
      replayAction={isRepairReplay ? 'reveal' : undefined}
      onPrimaryAction={() => onPhaseChange('reveal')}
    />
  );
}
