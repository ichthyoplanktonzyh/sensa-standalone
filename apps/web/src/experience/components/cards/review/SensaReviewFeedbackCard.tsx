import {cardText} from '../../../../i18n/originalCards';
import { uiClass } from '../../../ui/classes';
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
  onOpenScene: (anchorId?: string) => void;
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
    <div className={uiClass(`sensa-review-feedback-page ${result.correct ? 'is-success' : 'is-repair'}`)}>
      <header className={uiClass("sensa-review-feedback-heading")}>
        <span>{cardText(purpose==='acquisition'?'checkRecorded':'reviewResultRecorded')}</span>
        <div className={uiClass("sensa-review-feedback-mark")} aria-hidden="true">
          {result.correct ? '✓' : '↗'}
        </div>
        <h1>{feedback.title}</h1>
        <p>{feedback.body}</p>
      </header>

      <section className={uiClass("sensa-review-observation")} aria-label={cardText('reviewResult')}>
        <div>
          <small>{cardText('thisCheckCovered')}</small>
          <strong>{result.focusDimension}</strong>
        </div>
        <span>{outcomeLabel(result)}</span>
        <p>
          {purpose==='acquisition'?cardText('initialCheckHint'):result.evidenceEligible
            ? result.correct
              ? cardText('thisReviewHasBeenScheduled')
              : cardText('laterExplanationsOrRepairWillNotOverwriteThis')
            : cardText('thisBoundaryCheckDoesNotChangeTheLong')}
        </p>
      </section>

      {!result.correct && spec.kind === 'meaning_to_form_recall' && (
        <section className={uiClass("sensa-review-form-repair")}>
          <span>{cardText('reconnectToThisMeaning')}</span>
          <strong>{spec.primaryForm}</strong>
          <p>{content.l1Bridge}</p>
        </section>
      )}

      {!result.correct && spec.kind === 'boundary_contrast' && (
        <section className={uiClass("sensa-review-boundary-repair")}>
          <div><small>{cardText('currentMeaning')}</small><strong>{spec.currentSenseL1}</strong></div>
          <span aria-hidden="true">≠</span>
          <div><small>{cardText('relatedMeaning')}</small><strong>{spec.contrastSenseL1}</strong></div>
        </section>
      )}

      {spec.kind === 'novel_context_transfer' && (
        <section className={uiClass("sensa-review-transfer-trace")}>
          <span>{cardText('theSituationChangedWhatStayedTheSame')}</span>
          <div>
            {spec.scenario.invariantLabelsL1.map((label) => <i key={label}>{label}</i>)}
          </div>
        </section>
      )}

      <section className={uiClass("sensa-review-reveal-example")}>
        <div>
          <span>{spec.kind === 'novel_context_transfer' ? cardText('returnToTheEnglishExpression') : cardText('revisitTheContext')}</span>
          <small>{cardText('youCanNowTapWordsForDefinitions2')}</small>
        </div>
        <div className={uiClass("sensa-review-feedback-sentence")}>
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
        <p>{revealedExample.textL1}</p>
      </section>

      <div className={uiClass("sensa-review-feedback-actions")}>
        <button
          type="button"
          className={uiClass(!result.correct ? 'is-emphasized' : '')}
          onClick={() => {
            clearLookup();
            onViewChange();
            setReplayPhase('experience');
          }}
        >
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-eye" /></svg>
          <span>{result.correct ? cardText('replayTheMeaningConnection2') : cardText('rebuildThisMeaning')}</span>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button type="button" onClick={onOpenExample}>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-bookopen" /></svg>
          <span>{cardText('viewLearningExamples')}</span>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button type="button" onClick={() => onOpenDictionary(content.lemma)}>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-search" /></svg>
          <span>{cardText('openTheFullDictionary')}</span>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      <PersonalConnectionActions
        senseId={content.senseKey}
        onOpenNote={onOpenNote}
        onOpenScene={onOpenScene}
        variant="compact"
      />

      <footer className={uiClass("sensa-review-feedback-footer")}>
        <button type="button" onClick={onContinue}>
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
