import { useEffect, useMemo, useState } from 'react';
import type { NovelTransferAssessmentResource } from '../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type { NovelTransferOutcome } from '../../engine/types';
import type {
  DictionaryLookup,
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
  SentenceToken,
} from '../../types';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import { ExperienceRenderer } from './ExperienceRenderer';

export interface NovelTransferCardProps {
  content: PrototypeIntroductionPackage;
  /** Exact Transfer Assessment Resource selected by the current Action. */
  assessment: NovelTransferAssessmentResource;
  presentation: NovelTransferPresentation;
  purpose?: 'acquisition' | 'retention';
  onComplete: (outcome: NovelTransferOutcome, responseId?: string | null) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

export type NovelTransferPresentation = 'sensa' | 'baseline';

function visualFamilyForKind(visualKind: string): string {
  if (visualKind === 'living-material') return 'coral-growth';
  if (visualKind === 'thin-component' || visualKind === 'precision-equipment') return 'precision-sensor';
  if (visualKind === 'careful-handling' || visualKind === 'aged-material') return 'archaeology-bones';
  if (
    visualKind.includes('continuity')
    || visualKind === 'attention-continuity'
    || visualKind === 'interest-continuity'
    || visualKind === 'service-load'
  ) return 'continuity-flow';
  if (visualKind.includes('receiver') || visualKind.includes('provider')) return 'exchange';
  return 'generic';
}

function splitTransferSetup(text: string): string[] {
  const marker = '\u0000';
  const clauses = text
    .trim()
    .replace(/([,;:])\s+/g, `$1${marker}`)
    .replace(/\s+(because|so|while|when|but)\s+/gi, `${marker}$1 `)
    .split(marker)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.length > 0 ? clauses : [text];
}

function TransferSceneVisual({
  visualKind,
  alt,
}: {
  visualKind: PrototypeIntroductionPackage['novelTransfer']['scenarios'][number]['visualKind'];
  alt: string;
}) {
  const normalizedKind = visualKind.replace(/_/g, '-');
  const visualFamily = visualFamilyForKind(normalizedKind);
  return (
    <div
      className={`transfer-scene-visual visual-${normalizedKind} visual-${visualFamily}`}
      role="img"
      aria-label={alt}
    >
      <span className="transfer-scene-glow" aria-hidden="true" />
      <span className="transfer-scene-ground" aria-hidden="true" />
      <span className="transfer-scene-subject subject-a" aria-hidden="true" />
      <span className="transfer-scene-subject subject-b" aria-hidden="true" />
      <span className="transfer-scene-tool" aria-hidden="true" />
      <i className="transfer-scene-mark mark-a" aria-hidden="true" />
      <i className="transfer-scene-mark mark-b" aria-hidden="true" />
      <i className="transfer-scene-mark mark-c" aria-hidden="true" />
    </div>
  );
}

export function NovelTransferCard({
  content,
  assessment,
  presentation,
  purpose = 'acquisition',
  onComplete,
  onOpenDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  onViewChange,
  toast,
}: NovelTransferCardProps) {
  if (
    assessment.packageKey !== content.packageKey
    || assessment.senseKey !== content.senseKey
  ) {
    throw new Error('Transfer card resource does not match the selected Package.');
  }
  const isRetention = purpose === 'retention';
  const scenario = assessment.scenario;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    setSelectedId(null);
    setSubmitted(false);
    setUncertain(false);
    setReplayingExperience(false);
    clearLookup();
  }, [assessment.taskKey, clearLookup]);

  const selectedOption = useMemo(
    () => scenario.options.find((option) => option.id === selectedId) ?? null,
    [scenario.options, selectedId],
  );
  const correctOption = useMemo(
    () => scenario.options.find((option) => option.isCorrect) ?? null,
    [scenario.options],
  );
  const succeeded = selectedOption?.isCorrect === true && !uncertain;
  const outcome: NovelTransferOutcome = succeeded ? 'success' : 'repair';
  const feedbackTitle = succeeded
    ? scenario.successTitleL1
    : uncertain
    ? '先看看这个新场景需要什么'
    : selectedOption?.feedbackTitleL1;
  const feedbackBody = succeeded
    ? scenario.successBodyL1
    : uncertain
    ? correctOption?.feedbackBodyL1
    : selectedOption?.feedbackBodyL1;

  if (!scenario || !correctOption) return null;

  const reveal = scenario.revealExample;
  const revealHtml = `${reveal.textL2.slice(0, reveal.targetStart)}<b>${reveal.targetSurface}</b>${reveal.textL2.slice(reveal.targetEnd)}`;
  const setupClauses = splitTransferSetup(scenario.setupL2);

  const lookupToken = async (
    token: SentenceToken,
    contextualExample?: { exampleKey: string; textL2: string },
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const input: string | DictionaryLookupRequest = contextualExample
      ? {
          rawClickedForm: token.text,
          exampleId: contextualExample.exampleKey,
          textL2: contextualExample.textL2,
          clickedStart: token.charStart,
          clickedEnd: token.charEnd,
          clickedSurface: token.text,
        }
      : token.cleanWord;
    const entry = await lookupDictionary(input, options);
    if (!entry) toast('当前词典没有这个词');
    return entry;
  };

  const supportActions = (
    <div className="transfer-support-actions">
      <button
        type="button"
        className={succeeded ? '' : 'emphasized'}
        onClick={() => {
          clearLookup();
          onViewChange();
          setReplayingExperience(true);
        }}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
        对照最初的体验
        <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        type="button"
        onClick={() => {
          clearLookup();
          onOpenExample();
        }}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-bookopen" /></svg>
        查看学习例句
        <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        type="button"
        onClick={() => {
          clearLookup();
          onOpenDictionary(content.lemma);
        }}
      >
        <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
        查看完整词典
        <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
    </div>
  );

  if (replayingExperience) {
    return (
      <ExperienceRenderer
        experience={content.experience}
        mode="replay"
        onPrimaryAction={() => {
          onViewChange();
          setReplayingExperience(false);
        }}
      />
    );
  }

  return (
    <div
      className={`transfer-page is-${presentation}`}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className="transfer-heading">
        <span>
          {presentation === 'sensa'
            ? isRetention
              ? '长期复习 · 新语境迁移'
              : submitted ? succeeded ? '迁移检验 · 已成立' : '迁移检验 · 需要修复' : '迁移检验 · 未见语境'
            : '新语境迁移'}
        </span>
        <h1>
          {presentation === 'sensa'
            ? isRetention
              ? '换个场景，还能认出它吗？'
              : submitted ? feedbackTitle : '把这个意思带到陌生处'
            : '换个场景试试看'}
        </h1>
        <p>
          {presentation === 'sensa'
            ? isRetention
              ? '目标词保持隐藏；先用场景证明这层意思仍能迁移。'
              : submitted ? feedbackBody : '先判断场景中的关系，目标词会在提交后出现。'
            : assessment.instructionL1}
        </p>
      </header>

      {(!submitted || presentation === 'baseline') && (
        <>
          <section className="transfer-scene-card" aria-label={scenario.sceneLabelL1}>
            <div className="transfer-scene-label">
              <span>{scenario.sceneLabelL1}</span>
              <i aria-hidden="true" />
              {presentation === 'sensa' && <small>目标词暂隐</small>}
            </div>
            {presentation === 'sensa' && (
              <TransferSceneVisual visualKind={scenario.visualKind} alt={scenario.visualAltL1} />
            )}
            {presentation === 'sensa' ? (
              <div className="transfer-scene-copy">
                <div className="transfer-scene-l1">
                  <span>中文场景</span>
                  <p>{scenario.setupL1}</p>
                </div>
                <div className="transfer-scene-l2">
                  <span>英文场景 <small>点词可查义</small></span>
                  <div>
                    {setupClauses.map((clause, clauseIndex) => (
                      <span key={`${scenario.id}:clause:${clauseIndex}`}>
                        <ClickableSentence
                          sentenceHtml={clause}
                          activeTokenIdx={null}
                          onWordClick={(token, tokenIdx) => {
                            openLookup({
                              tokenIdx,
                              displayWord: token.cleanWord,
                              load: (signal) => lookupToken(
                                token,
                                {
                                  exampleKey: `${scenario.id}:setup:${clauseIndex}`,
                                  textL2: clause,
                                },
                                { signal },
                              ),
                            });
                          }}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="transfer-setup-l2">{scenario.setupL2}</p>
                <p className="transfer-setup-l1">{scenario.setupL1}</p>
              </>
            )}
            {presentation === 'baseline' && (
              <TransferSceneVisual visualKind={scenario.visualKind} alt={scenario.visualAltL1} />
            )}
          </section>

          {presentation === 'sensa' ? (
            <div className="transfer-question-block">
              <span>你的判断</span>
              <h2 className="transfer-question">{scenario.questionL1}</h2>
            </div>
          ) : (
            <h2 className="transfer-question">{scenario.questionL1}</h2>
          )}

          <div className="transfer-actions" role="radiogroup" aria-label={scenario.questionL1}>
            {scenario.options.map((option, index) => {
              const selected = option.id === selectedId;
              const classes = ['transfer-action'];
              if (!submitted && selected) classes.push('selected');
              if (submitted && option.isCorrect) classes.push('right');
              if (submitted && selected && !option.isCorrect) classes.push('wrong');
              if (submitted && !option.isCorrect && !selected) classes.push('mute');

              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={submitted}
                  className={classes.join(' ')}
                  key={option.id}
                  onClick={() => setSelectedId(option.id)}
                >
                  <span className="transfer-action-index" aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="transfer-action-copy">
                    <strong>{option.labelL1}</strong>
                    {(presentation === 'baseline' || (submitted && (selected || option.isCorrect))) && (
                      <small>{option.detailL1}</small>
                    )}
                  </span>
                  {submitted && option.isCorrect && (
                    <span className="transfer-action-status" aria-label="符合">✓</span>
                  )}
                  {submitted && selected && !option.isCorrect && (
                    <span className="transfer-action-status" aria-label="不符合">×</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {submitted && (
        <section className={`transfer-feedback ${succeeded ? 'success' : 'repair'}`} aria-live="polite">
          {presentation === 'baseline' && (
            <>
              <div className="transfer-feedback-status">
                <span aria-hidden="true">{succeeded ? '✓' : '↗'}</span>
                <strong>{succeeded ? '迁移成立' : '迁移修复'}</strong>
              </div>
              <h3>{feedbackTitle}</h3>
              <p>{feedbackBody}</p>
            </>
          )}

          {presentation === 'sensa' && (
            <div className="transfer-sensa-connection" aria-label="意思迁移连接">
              <div>
                <small>熟悉对象</small>
                <strong>{scenario.sourceObjectL1}</strong>
              </div>
              <span aria-hidden="true"><i />→<i /></span>
              <div>
                <small>陌生对象</small>
                <strong>{scenario.targetObjectL1}</strong>
              </div>
              <p>对象变了，意思结构没有变</p>
              <ol>
                {scenario.invariantLabelsL1.map((label) => <li key={label}>{label}</li>)}
              </ol>
            </div>
          )}

          <div className="transfer-reveal-example">
            <span>{presentation === 'sensa' ? '目标表达出现' : '放回英文表达'}</span>
            <div className="transfer-reveal-sentence">
              <ClickableSentence
                sentenceHtml={revealHtml}
                activeTokenIdx={activeLookup?.tokenIdx ?? null}
                onWordClick={(token, tokenIdx) => {
                  openLookup({
                    tokenIdx,
                    displayWord: token.cleanWord,
                    load: (signal) => lookupToken(
                      token,
                      reveal,
                      { signal },
                    ),
                  });
                }}
              />
            </div>
            <p>{reveal.textL1}</p>
            <small>{presentation === 'sensa' ? '点词可查看具体意思' : '点击句中单词可查义'}</small>
          </div>

          {presentation === 'baseline' && (
            <div className="transfer-connection" aria-label="意思迁移连接">
              <div className="transfer-object-pair">
                <span>{scenario.sourceObjectL1}</span>
                <i aria-hidden="true">→</i>
                <span>{scenario.targetObjectL1}</span>
              </div>
              <div className="transfer-invariant-label">没有改变的意思结构</div>
              <div className="transfer-invariants">
                {scenario.invariantLabelsL1.map((label, index) => (
                  <span key={label}>
                    {label}
                    {index < scenario.invariantLabelsL1.length - 1 && <i aria-hidden="true">→</i>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {presentation === 'baseline' ? supportActions : (
            <details className="transfer-support-disclosure" open={!succeeded}>
              <summary>{succeeded ? '需要回看或查词？' : '先修复这条连接'}</summary>
              {supportActions}
            </details>
          )}
        </section>
      )}

      {submitted && (
        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="compact"
        />
      )}

      <div className="lfoot transfer-footer" id="lFoot">
        {!submitted ? (
          <div className="transfer-submit-stack">
            <button
              type="button"
              className="transfer-submit-button"
              disabled={!selectedOption}
              onClick={() => {
                clearLookup();
                onViewChange();
                if (isRetention) {
                  onComplete(outcome, selectedOption?.id ?? null);
                } else {
                  setSubmitted(true);
                }
              }}
            >
              {presentation === 'sensa'
                ? isRetention ? '提交这次检验' : '提交判断'
                : '确认处理方式'}
            </button>
            <button
              type="button"
              className="transfer-uncertain-button"
              onClick={() => {
                clearLookup();
                onViewChange();
                if (isRetention) {
                  onComplete('repair', null);
                } else {
                  setUncertain(true);
                  setSelectedId(null);
                  setSubmitted(true);
                }
              }}
            >
              {presentation === 'sensa'
                ? isRetention ? '还判断不了，进入修复' : '还判断不了'
                : '不确定，看看应该怎么处理'}
            </button>
          </div>
        ) : (
          <button type="button" className="fbtn green" onClick={() => onComplete(outcome, selectedOption?.id ?? null)}>
            {presentation === 'sensa'
              ? succeeded ? '完成本次检验' : '先修复，稍后再试'
              : succeeded ? '完成这次学习' : '我知道了，稍后换个场景再试'}<i />
          </button>
        )}
      </div>

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
