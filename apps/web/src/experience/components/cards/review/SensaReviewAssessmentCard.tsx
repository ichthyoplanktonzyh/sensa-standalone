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
  ReviewBoundaryContrastSpec,
} from '../../../../learning/review/types';
import { resolveReviewMemoryOutcome } from '../../../../learning/review/types';
import type {
  DictionaryLookup,
  DictionaryLookupRequest,
  QuickDictEntry,
  SentenceToken,
} from '../../../types';
import { ClickableSentence } from '../../ClickableSentence';
import { QuickDictPopup } from '../../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../../useImmediateDictionaryLookup';
import { RecognitionCard } from '../RecognitionCard';
import { RecallCard } from '../RecallCard';
import { NovelTransferCard } from '../NovelTransferCard';

export interface SensaReviewAssessmentCardProps {
  content: RuntimeLearningContent;
  spec: ReviewAssessmentSpec;
  /** The same taskKey-resolved resource used to build spec. */
  assessmentResource: AssessmentResource;
  purpose?: 'acquisition' | 'retention';
  onSubmit: (result: ReviewAssessmentResult) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

function reviewResult(
  spec: ReviewAssessmentSpec,
  correct: boolean,
  responseId: string | null = null,
): ReviewAssessmentResult {
  return {
    assessmentId: spec.id,
    kind: spec.kind,
    focusDimension: spec.focusDimension,
    correct,
    responseId,
    memoryOutcome: resolveReviewMemoryOutcome(spec.kind, correct),
    evidenceEligible: spec.evidenceEligible,
  };
}

function emphasizeTarget(spec: ReviewBoundaryContrastSpec): string {
  const { example } = spec;
  return `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
}

function SensaBoundaryAssessment({
  content,
  spec,
  purpose,
  onSubmit,
  onOpenDictionary,
  lookupDictionary,
  onViewChange,
  toast,
}: Omit<SensaReviewAssessmentCardProps, 'spec' | 'onOpenExample' | 'onOpenNote' | 'onOpenScene'> & {
  spec: ReviewBoundaryContrastSpec;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();
  const selectedOption = useMemo(
    () => spec.options.find((option) => option.id === selectedId) ?? null,
    [selectedId, spec.options],
  );

  const lookupToken = (token: SentenceToken, tokenIdx: number) => {
    if (token.cleanWord.toLocaleLowerCase() === content.lemma.toLocaleLowerCase()) {
      toast(cardText('submitYourAnswerBeforeOpeningThisWordS'));
      return;
    }
    const request: DictionaryLookupRequest = {
      rawClickedForm: token.text,
      exampleId: spec.example.exampleKey,
      textL2: spec.example.textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: token.text,
    };
    openLookup({
      tokenIdx,
      displayWord: token.cleanWord,
      load: async (signal) => {
        const entry = await lookupDictionary(request, { signal });
        if (!entry) toast(cardText('thisWordIsNotInTheDictionary'));
        return entry;
      },
    });
  };

  return (
    <div className={uiClass("sensa-review-boundary-page")}>
      <header className={uiClass("sensa-review-boundary-heading")}>
        <span>{purpose === 'acquisition' ? cardText('meaningBoundaryIndependentJudgement') : cardText('reviewMeaningBoundary')}</span>
        <h1>{cardText('similarWithADifferentPerspective')}</h1>
        <p>{cardText('checkThisBoundaryWhenThePackageIdentifiesA')}</p>
      </header>

      <section className={uiClass("sensa-review-boundary-pair")} aria-label={cardText('twoMeaningsToDistinguish')}>
        <div>
          <small>{cardText('currentMeaning')}</small>
          <strong>{spec.currentSenseL1}</strong>
        </div>
        <span aria-hidden="true"><i />≠<i /></span>
        <div>
          <small>{cardText('relatedMeaning')}</small>
          <strong>{spec.contrastSenseL1}</strong>
        </div>
        <p>{spec.relationLabelL1}</p>
      </section>

      <section className={uiClass("sensa-review-boundary-context")}>
        <div>
          <span>{cardText('boundaryContext')}</span>
          <small>{cardText('tapOtherWordsForDefinitions')}</small>
        </div>
        <div className={uiClass("sensa-review-boundary-sentence")}>
          <ClickableSentence
            sentenceHtml={emphasizeTarget(spec)}
            activeTokenIdx={activeLookup?.tokenIdx ?? null}
            onWordClick={lookupToken}
          />
        </div>
        <div className={uiClass("sensa-review-boundary-mask")}>
          <i aria-hidden="true" />
          <span>{cardText('translationAppearsAfterYourAnswer')}</span>
        </div>
      </section>

      <section className={uiClass("sensa-review-boundary-question")}>
        <span>{cardText('yourJudgement')}</span>
        <h2>{spec.questionL1}</h2>
        <div role="radiogroup" aria-label={spec.questionL1}>
          {spec.options.map((option, index) => {
            const selected = option.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className={uiClass(selected ? 'is-selected' : '')}
                key={option.id}
                onClick={() => setSelectedId(option.id)}
              >
                <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                <strong>{option.labelL1}</strong>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <footer className={uiClass("sensa-review-boundary-footer")}>
        <button
          type="button"
          disabled={!selectedOption}
          onClick={() => {
            if (!selectedOption) return;
            clearLookup();
            onViewChange();
            onSubmit(reviewResult(spec, selectedOption.isCorrect, selectedOption.id));
          }}
        >{cardText('submitThisCheck')}</button>
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

export function SensaReviewAssessmentCard(props: SensaReviewAssessmentCardProps) {
  const {
    content,
    spec,
    assessmentResource,
    purpose = 'retention',
    onSubmit,
  } = props;

  if (
    assessmentResource.packageKey !== content.packageKey
    || assessmentResource.senseKey !== content.senseKey
    || assessmentResource.kind !== spec.kind
    || assessmentResource.taskKey !== spec.taskKey
  ) {
    throw new Error('Review card resource does not match the selected Assessment Task.');
  }

  if (spec.kind === 'context_recognition') {
    return (
      <RecognitionCard
        content={content}
        assessment={assessmentResource as RecognitionAssessmentResource}
        purpose={purpose}
        onComplete={(correct, responseId) => {
          onSubmit(reviewResult(spec, correct, responseId ?? null));
        }}
        onOpenDictionary={props.onOpenDictionary}
        onOpenNote={props.onOpenNote}
        onOpenScene={props.onOpenScene}
        lookupDictionary={props.lookupDictionary}
        onViewChange={props.onViewChange}
        toast={props.toast}
      />
    );
  }

  if (spec.kind === 'meaning_to_form_recall') {
    return (
      <RecallCard
        content={content}
        assessment={assessmentResource as MeaningToFormRecallAssessmentResource}
        purpose={purpose}
        onComplete={(outcome, responseId) => {
          onSubmit(reviewResult(spec, outcome === 'independent', responseId ?? null));
        }}
        onOpenDictionary={props.onOpenDictionary}
        onOpenExample={props.onOpenExample}
        onOpenNote={props.onOpenNote}
        onOpenScene={props.onOpenScene}
        onViewChange={props.onViewChange}
        toast={props.toast}
      />
    );
  }

  if (spec.kind === 'novel_context_transfer') {
    return (
      <NovelTransferCard
        content={content}
        assessment={assessmentResource as NovelTransferAssessmentResource}
        purpose={purpose}
        onComplete={(outcome, responseId) => {
          onSubmit(reviewResult(spec, outcome === 'success', responseId ?? null));
        }}
        onOpenDictionary={props.onOpenDictionary}
        onOpenExample={props.onOpenExample}
        onOpenNote={props.onOpenNote}
        onOpenScene={props.onOpenScene}
        lookupDictionary={props.lookupDictionary}
        onViewChange={props.onViewChange}
        toast={props.toast}
      />
    );
  }

  return <SensaBoundaryAssessment {...props} spec={spec} purpose={purpose} />;
}
