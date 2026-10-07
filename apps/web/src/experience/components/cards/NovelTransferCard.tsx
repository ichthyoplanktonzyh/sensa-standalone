import {cardText} from '../../../i18n/originalCards';
import type { CardExecution } from './CardExecution';
import { iconClass } from '../../ui/primitives';
import { useEffect, useMemo, useState } from 'react';
import type { NovelTransferAssessmentResource } from '../../../learning/content/assessmentResources';
import type { RuntimeLearningContent } from '../../../learning/content/learningCatalog';
import type { NovelTransferOutcome } from '../../../learning/engine/types';
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
  execution?: CardExecution;
  content: RuntimeLearningContent;
  /** Exact Transfer Assessment Resource selected by the current Action. */
  assessment: NovelTransferAssessmentResource;
  purpose?: 'acquisition' | 'retention';
  onComplete: (outcome: NovelTransferOutcome, responseId?: string | null) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (contextId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

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
  visualKind: RuntimeLearningContent['novelTransfer']['scenarios'][number]['visualKind'];
  alt: string;
}) {
  const normalizedKind = visualKind.replace(/_/g, '-');
  const visualFamily = visualFamilyForKind(normalizedKind);
  return (
    <div
      className={`relative min-h-56 overflow-hidden rounded-card bg-surface-subtle visual-${normalizedKind} visual-${visualFamily}`}
      role="img"
      aria-label={alt}
    >
      <span className="absolute inset-x-0 bottom-10 h-px bg-border-strong" aria-hidden="true" />
      <span className="absolute bottom-10 left-1/4 size-14 rounded-full border border-border-strong bg-surface-panel" aria-hidden="true" />
      <span className="absolute bottom-10 right-1/4 size-14 rounded-full border border-border-strong bg-surface-panel" aria-hidden="true" />
      <span className="absolute bottom-16 left-1/2 h-2 w-1/3 -translate-x-1/2 rounded-pill bg-decorative" aria-hidden="true" />
      <i className="absolute left-1/3 top-12 size-2 rounded-full bg-progress" aria-hidden="true" />
      <i className="absolute right-1/3 top-16 size-2 rounded-full bg-action-primary" aria-hidden="true" />
    </div>
  );
}

export function NovelTransferCard({
  execution,
  content,
  assessment,
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
  const [selectedId, setSelectedId] = useState<string | null>(execution?.feedback?.answer || null);
  const [submitted, setSubmitted] = useState(!!execution?.feedback);
  const [uncertain, setUncertain] = useState(!!execution?.feedback && !execution.feedback.answer);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    if (execution) return;
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
    ? cardText('seeWhatThisNewSituationNeeds')
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
    if (!entry) toast(cardText('thisWordIsNotInTheDictionary'));
    return entry;
  };

  const supportActions = (
    <div className="grid gap-3 py-4">
      <button
        type="button"
        className={`grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border px-4 text-left text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${succeeded ? 'border-border-subtle bg-surface-panel text-fg-primary' : 'border-border-strong bg-accent-soft text-action-primary'}`}
        onClick={() => {
          clearLookup();
          onViewChange();
          setReplayingExperience(true);
        }}
      >
        <svg className={iconClass} aria-hidden="true"><use href="#i-eye" /></svg>{cardText('compareWithTheOriginalExperience')}<svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        className="grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4 text-left text-control-label font-semibold text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
        type="button"
        onClick={() => {
          clearLookup();
          onOpenExample();
        }}
      >
        <svg className={iconClass} aria-hidden="true"><use href="#i-bookopen" /></svg>{cardText('viewLearningExamples')}<svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        className="grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4 text-left text-control-label font-semibold text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
        type="button"
        onClick={() => {
          clearLookup();
          onOpenDictionary(content.lemma);
        }}
      >
        <svg className={iconClass} aria-hidden="true"><use href="#i-search" /></svg>{cardText('openTheFullDictionary')}<svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
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
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10"
      data-assessment-task-key={assessment.taskKey}
    >
      <header>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">
          {isRetention
              ? cardText('reviewTransferToANewContext')
              : submitted ? succeeded ? cardText('transferCheckEstablished') : cardText('transferCheckNeedsRepair') : cardText('transferCheckUnseenContext')}
        </span>
        <h1 className="mt-3 text-page-title font-semibold">
          {isRetention
              ? cardText('canYouRecognizeItInANewSituation')
              : submitted ? feedbackTitle : cardText('takeThisMeaningSomewhereNew')}
        </h1>
        <p className="mt-3 text-body-support leading-6 text-fg-secondary">
          {isRetention
              ? cardText('theExpressionStaysHiddenUseTheSituationTo')
              : submitted ? feedbackBody : cardText('judgeTheRelationshipFirstTheExpressionAppearsAfter')}
        </p>
      </header>

      {!submitted && (
        <>
          <section className="mt-6 overflow-hidden rounded-card border border-border-subtle bg-surface-panel" aria-label={scenario.sceneLabelL1}>
            <div className="flex items-center gap-2 px-5 py-4 text-metadata text-fg-tertiary">
              <span>{scenario.sceneLabelL1}</span>
              <i className="size-1.5 rounded-full bg-progress" aria-hidden="true" />
              <small>{cardText('expressionHidden')}</small>
            </div>
            <TransferSceneVisual visualKind={scenario.visualKind} alt={scenario.visualAltL1} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="rounded-control bg-accent-soft p-4">
                <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('chineseContext')}</span>
                <p className="mt-3 text-body-support leading-6">{scenario.setupL1}</p>
              </div>
              <div className="rounded-control bg-surface-subtle p-4">
                <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('englishContext')}</span>
                <div className="mt-3 space-y-2 font-language text-body leading-7">
                  {setupClauses.map((clause, clauseIndex) => (
                    <span key={`${scenario.id}:clause:${clauseIndex}`}>
                      <ClickableSentence
                        sentenceHtml={clause}
                      />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="mt-7">
            <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('yourJudgement')}</span>
            <h2 className="mt-2 text-section-title font-semibold">{scenario.questionL1}</h2>
          </div>

          <div className="mt-4 grid gap-3" role="radiogroup" aria-label={scenario.questionL1}>
            {scenario.options.map((option, index) => {
              const selected = option.id === selectedId;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={submitted}
                  className={`grid min-h-14 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-control border p-3 text-left focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-100 ${selected ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel hover:bg-surface-subtle'}`}
                  key={option.id}
                  onClick={() => setSelectedId(option.id)}
                >
                  <span className="grid size-8 place-items-center rounded-control bg-accent-soft text-metadata font-bold text-action-primary" aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="flex flex-col gap-1">
                    <strong className="text-body-support">{option.labelL1}</strong>
                    {(submitted && (selected || option.isCorrect)) && (
                      <small>{option.detailL1}</small>
                    )}
                  </span>
                  {submitted && option.isCorrect && (
                    <span className="font-bold text-feedback-success" aria-label={cardText('fits')}>✓</span>
                  )}
                  {submitted && selected && !option.isCorrect && (
                    <span className="font-bold text-feedback-danger" aria-label={cardText('doesNotFit')}>×</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {submitted && (
        <section className="mt-6" aria-live="polite">
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3 rounded-card border border-border-subtle bg-surface-panel p-4" aria-label={cardText('meaningTransfer')}>
            <div className="flex flex-col gap-2 rounded-control bg-accent-soft p-3">
              <small className="text-metadata text-fg-tertiary">{cardText('familiarObject')}</small>
              <strong>{scenario.sourceObjectL1}</strong>
            </div>
            <span className="grid place-items-center text-fg-tertiary" aria-hidden="true">→</span>
            <div className="flex flex-col gap-2 rounded-control bg-surface-subtle p-3">
              <small className="text-metadata text-fg-tertiary">{cardText('newObject')}</small>
              <strong>{scenario.targetObjectL1}</strong>
            </div>
            <p className="col-span-3 text-body-support leading-6 text-fg-secondary">{cardText('theObjectChangedTheMeaningStructureStayedThe')}</p>
            <ol className="col-span-3 flex flex-wrap gap-2">
              {scenario.invariantLabelsL1.map((label) => <li className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-fg-secondary" key={label}>{label}</li>)}
            </ol>
          </div>

          <div className="mt-5 rounded-card border border-border-subtle bg-surface-panel p-5">
            <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('expressionRevealed')}</span>
            <div className="mt-4 font-language text-xl leading-9">
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
            <p className="mt-4 text-body-support leading-6 text-fg-secondary">{reveal.textL1}</p>
            <small className="mt-2 block text-metadata text-fg-tertiary">{cardText('tapAWordForItsMeaning')}</small>
          </div>

          <details className="mt-5 rounded-card border border-border-subtle bg-surface-panel px-5" open={!succeeded}>
            <summary className="flex min-h-12 cursor-pointer items-center text-control-label font-semibold text-fg-secondary">{succeeded ? cardText('needToReplayOrLookUpAWord') : cardText('repairThisConnectionFirst')}</summary>
            {supportActions}
          </details>
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

      <div className="mt-auto pt-8" id="lFoot">
        {!submitted ? (
          <div className="grid gap-3">
            <button
              type="button"
              className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
              disabled={!selectedOption}
              onClick={() => {
                clearLookup();
                onViewChange();
                if (execution) {
                  execution.submit(selectedOption?.id ?? null);
                } else if (isRetention) {
                  onComplete(outcome, selectedOption?.id ?? null);
                } else {
                  setSubmitted(true);
                }
              }}
            >
              {isRetention ? cardText('submitThisCheck') : cardText('submitYourJudgement')}
            </button>
            <button
              type="button"
              className="min-h-11 w-full rounded-control border-0 bg-transparent px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
              onClick={() => {
                clearLookup();
                onViewChange();
                if (execution) {
                  execution.submit(null);
                } else if (isRetention) {
                  onComplete('repair', null);
                } else {
                  setUncertain(true);
                  setSelectedId(null);
                  setSubmitted(true);
                }
              }}
            >
              {isRetention ? cardText('iCannotJudgeYetBeginRepair') : cardText('iCannotJudgeYet')}
            </button>
          </div>
        ) : (
          <button type="button" className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" onClick={() => execution ? execution.continue() : onComplete(outcome, selectedOption?.id ?? null)}>
            {succeeded ? cardText('finishThisCheck') : cardText('repairFirstAndTryAgainLater')}
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
