import {cardText} from '../../../../i18n/originalCards';
import { iconClass } from '../../../ui/primitives';
import { useMemo, useState } from 'react';
import type {
  AssessmentResource,
  MeaningToFormRecallAssessmentResource,
  NovelTransferAssessmentResource,
  RecognitionAssessmentResource,
} from '../../../../learning/content/assessmentResources';
import type { RuntimeLearningContent } from '../../../../learning/content/learningCatalog';
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
  ReviewChoiceOption,
  ReviewExampleExcerpt,
} from '../../../../learning/review/types';
import type {
  DictionaryLookup,
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
  SentenceToken,
} from '../../../types';
import { ClickableSentence } from '../../ClickableSentence';
import { PersonalConnectionActions } from '../../PersonalConnectionActions';
import { QuickDictPopup } from '../../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../../useImmediateDictionaryLookup';
import {
  IntroductionCard,
  type IntroductionPhase,
} from '../IntroductionCard';

interface SensaReviewFeedbackCardProps {
  purpose?: 'acquisition'|'retention';
  content: RuntimeLearningContent;
  spec: ReviewAssessmentSpec;
  assessmentResource: AssessmentResource;
  result: ReviewAssessmentResult;
  onContinue: () => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  lookupDictionary: DictionaryLookup;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (contextId?: string) => void;
  onViewChange: () => void;
  toast: (message: string) => void;
}

function emphasizeTarget(
  example: Pick<ReviewExampleExcerpt, 'textL2' | 'targetSurface' | 'targetStart' | 'targetEnd'>,
): string {
  return `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
}

function responseOptions(spec: ReviewAssessmentSpec): ReviewChoiceOption[] {
  if (spec.kind === 'context_recognition' || spec.kind === 'boundary_contrast') {
    return spec.options;
  }
  if (spec.kind === 'novel_context_transfer') return spec.scenario.options;
  return [];
}

function outcomeLabel(result: ReviewAssessmentResult): string {
  if (result.memoryOutcome?.basis === 'transfer_confirmed') return cardText('recognizedInANewContext');
  if (result.memoryOutcome?.basis === 'independent_retrieval') return cardText('recalledIndependently');
  if (result.memoryOutcome?.basis === 'retrieval_failed') return cardText('independentRecallFailed');
  if (result.memoryOutcome?.grade === 'hard') return cardText('recalledWithEffort');
  if (result.memoryOutcome?.grade === 'easy') return cardText('recalledVeryEasily');
  if (result.memoryOutcome?.grade === 'good') return cardText('recallCompleted');
  if (result.memoryOutcome?.grade === 'again') return cardText('couldNotRecallThisTime');
  return cardText('feedbackOnlyTheLongTermScheduleStaysUnchanged');
}

export function SensaReviewFeedbackCard({
  purpose = 'retention',
  content,
  spec,
  assessmentResource,
  result,
  onContinue,
  onOpenDictionary,
  lookupDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  onViewChange,
  toast,
}: SensaReviewFeedbackCardProps) {
  if (
    assessmentResource.packageKey !== content.packageKey
    || assessmentResource.senseKey !== content.senseKey
    || assessmentResource.kind !== spec.kind
    || assessmentResource.taskKey !== spec.taskKey
  ) {
    throw new Error('Review feedback resource does not match the selected Assessment Task.');
  }
  const [replayPhase, setReplayPhase] = useState<IntroductionPhase | null>(null);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const options = useMemo(() => responseOptions(spec), [spec]);
  const selectedOption = options.find((option) => option.id === result.responseId) ?? null;
  const correctOption = options.find((option) => option.isCorrect) ?? null;

  const feedback = (() => {
    if (spec.kind === 'meaning_to_form_recall') {
      const recall = assessmentResource as MeaningToFormRecallAssessmentResource;
      return result.correct
        ? {
            title: recall.independentSuccessTitleL1,
            body: recall.independentSuccessBodyL1,
          }
        : {
            title: recall.repairTitleL1,
            body: recall.repairBodyL1,
          };
    }
    if (spec.kind === 'novel_context_transfer') {
      const transfer = assessmentResource as NovelTransferAssessmentResource;
      const option = selectedOption ?? correctOption;
      if (!option) {
        throw new Error('Transfer review feedback has no Package-owned option feedback.');
      }
      return result.correct
        ? {
            title: transfer.scenario.successTitleL1,
            body: transfer.scenario.successBodyL1,
          }
        : {
            title: option.feedbackTitleL1,
            body: option.feedbackBodyL1,
          };
    }
    if (spec.kind === 'context_recognition') {
      const recognition = assessmentResource as RecognitionAssessmentResource;
      if (result.correct) {
        return {
          title: recognition.successTitleL1,
          body: recognition.successBodyL1,
        };
      }
      if (!selectedOption) {
        throw new Error('Recognition review feedback has no Package-owned option feedback.');
      }
      return {
        title: selectedOption.feedbackTitleL1,
        body: selectedOption.feedbackBodyL1,
      };
    }
    const option = selectedOption ?? correctOption;
    if (!option) {
      throw new Error('Boundary review feedback has no Package-owned option feedback.');
    }
    return {
      title: option.feedbackTitleL1,
      body: option.feedbackBodyL1,
    };
  })();

  const revealedExample = spec.kind === 'context_recognition' || spec.kind === 'boundary_contrast'
    ? spec.example
    : spec.kind === 'novel_context_transfer'
    ? spec.scenario.revealExample
    : content.studyExample;

  const lookupToken = async (
    token: SentenceToken,
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const request: DictionaryLookupRequest = {
      rawClickedForm: token.text,
      exampleId: revealedExample.exampleKey,
      textL2: revealedExample.textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: token.text,
    };
    const entry = await lookupDictionary(request, options);
    if (!entry) toast(cardText('thisWordIsNotInTheCurrentReference'));
    return entry;
  };

  if (replayPhase) {
    return (
      <IntroductionCard
        content={content}
        phase={replayPhase}
        mode="repair_replay"
        repairPurpose="retention"
        onPhaseChange={(phase) => {
          clearLookup();
          onViewChange();
          setReplayPhase(phase);
        }}
        onComplete={() => {
          onViewChange();
          setReplayPhase(null);
        }}
        onOpenExample={onOpenExample}
        onOpenDictionary={(word) => onOpenDictionary(word ?? content.lemma)}
        onOpenNote={onOpenNote}
        onOpenScene={onOpenScene}
        lookupDictionary={lookupDictionary}
        toast={toast}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10">
      <header>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText(purpose==='acquisition'?'checkRecorded':'reviewResultRecorded')}</span>
        <div className={`mt-5 grid size-14 place-items-center rounded-card text-2xl font-bold ${result.correct ? 'bg-accent-soft text-feedback-success' : 'bg-surface-subtle text-feedback-warning'}`} aria-hidden="true">
          {result.correct ? '✓' : '↗'}
        </div>
        <h1 className="mt-5 text-page-title font-semibold">{feedback.title}</h1>
        <p className="mt-3 text-body-support leading-7 text-fg-secondary">{feedback.body}</p>
      </header>

      <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5" aria-label={cardText('reviewResult')}>
        <div className="flex items-center justify-between gap-4">
          <small className="text-metadata text-fg-tertiary">{cardText('thisCheckCovered')}</small>
          <strong className="text-body-support">{result.focusDimension}</strong>
        </div>
        <span className="mt-3 inline-flex rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">{outcomeLabel(result)}</span>
        <p className="mt-3 text-body-support leading-6 text-fg-secondary">
          {purpose==='acquisition'?cardText('initialCheckHint'):result.evidenceEligible
            ? result.correct
              ? cardText('thisReviewHasBeenScheduled')
              : cardText('laterExplanationsOrRepairWillNotOverwriteThis')
            : cardText('thisBoundaryCheckDoesNotChangeTheLong')}
        </p>
      </section>

      {!result.correct && spec.kind === 'meaning_to_form_recall' && (
        <section className="mt-6 rounded-card border border-border-subtle bg-accent-soft p-5">
          <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('reconnectToThisMeaning')}</span>
          <strong className="mt-3 block font-language text-2xl text-action-primary">{spec.primaryForm}</strong>
          <p className="mt-2 text-body-support text-fg-secondary">{content.l1Bridge}</p>
        </section>
      )}

      {!result.correct && spec.kind === 'boundary_contrast' && (
        <section className="mt-6 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3 rounded-card border border-border-subtle bg-surface-panel p-4">
          <div className="flex flex-col gap-2 rounded-control bg-accent-soft p-3"><small className="text-metadata text-fg-tertiary">{cardText('currentMeaning')}</small><strong className="text-body-support">{spec.currentSenseL1}</strong></div>
          <span className="grid place-items-center text-fg-tertiary" aria-hidden="true">≠</span>
          <div className="flex flex-col gap-2 rounded-control bg-surface-subtle p-3"><small className="text-metadata text-fg-tertiary">{cardText('relatedMeaning')}</small><strong className="text-body-support">{spec.contrastSenseL1}</strong></div>
        </section>
      )}

      {spec.kind === 'novel_context_transfer' && (
        <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5">
          <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('theSituationChangedWhatStayedTheSame')}</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {spec.scenario.invariantLabelsL1.map((label) => <i className="rounded-pill bg-accent-soft px-3 py-1 text-metadata not-italic text-fg-secondary" key={label}>{label}</i>)}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-control-label font-semibold">{spec.kind === 'novel_context_transfer' ? cardText('returnToTheEnglishExpression') : cardText('revisitTheContext')}</span>
          <small className="text-metadata text-fg-tertiary">{cardText('youCanNowTapWordsForDefinitions2')}</small>
        </div>
        <div className="mt-5 font-language text-xl leading-9">
          <ClickableSentence
            sentenceHtml={emphasizeTarget(revealedExample)}
            activeTokenIdx={activeLookup?.tokenIdx ?? null}
            onWordClick={(token, tokenIdx) => {
              openLookup({
                tokenIdx,
                displayWord: token.cleanWord,
                load: (signal) => lookupToken(
                  token,
                  { signal },
                ),
              });
            }}
          />
        </div>
        <p className="mt-4 text-body-support leading-6 text-fg-secondary">{revealedExample.textL1}</p>
      </section>

      <div className="mt-6 grid gap-3">
        <button
          type="button"
          className={`grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border px-4 text-left text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${!result.correct ? 'border-border-strong bg-accent-soft text-action-primary' : 'border-border-subtle bg-surface-panel text-fg-primary hover:bg-surface-subtle'}`}
          onClick={() => {
            clearLookup();
            onViewChange();
            setReplayPhase('experience');
          }}
        >
          <svg className={iconClass} aria-hidden="true"><use href="#i-eye" /></svg>
          <span>{result.correct ? cardText('replayTheMeaningConnection2') : cardText('rebuildThisMeaning')}</span>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button className="grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4 text-left text-control-label font-semibold text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onOpenExample}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-bookopen" /></svg>
          <span>{cardText('viewLearningExamples')}</span>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button className="grid min-h-12 grid-cols-[1.5rem_1fr_1.5rem] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-4 text-left text-control-label font-semibold text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={() => onOpenDictionary(content.lemma)}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-search" /></svg>
          <span>{cardText('openTheFullDictionary')}</span>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      <PersonalConnectionActions
        senseId={content.senseKey}
        onOpenNote={onOpenNote}
        onOpenScene={onOpenScene}
        variant="compact"
      />

      <footer className="mt-auto pt-8">
        <button className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onContinue}>
          {purpose==='acquisition'?cardText('continueLearning'):cardText('continueReview')}
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
