import {cardText} from '../../../../i18n/originalCards';
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
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10">
      <header>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{purpose === 'acquisition' ? cardText('meaningBoundaryIndependentJudgement') : cardText('reviewMeaningBoundary')}</span>
        <h1 className="mt-3 text-page-title font-semibold">{cardText('similarWithADifferentPerspective')}</h1>
        <p className="mt-3 text-body-support leading-6 text-fg-secondary">{cardText('checkThisBoundaryWhenThePackageIdentifiesA')}</p>
      </header>

      <section className="mt-6 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3 rounded-card border border-border-subtle bg-surface-panel p-4" aria-label={cardText('twoMeaningsToDistinguish')}>
        <div className="flex flex-col gap-2 rounded-control bg-accent-soft p-3">
          <small className="text-metadata text-fg-tertiary">{cardText('currentMeaning')}</small>
          <strong className="text-body-support">{spec.currentSenseL1}</strong>
        </div>
        <span className="grid place-items-center text-fg-tertiary" aria-hidden="true">≠</span>
        <div className="flex flex-col gap-2 rounded-control bg-surface-subtle p-3">
          <small className="text-metadata text-fg-tertiary">{cardText('relatedMeaning')}</small>
          <strong className="text-body-support">{spec.contrastSenseL1}</strong>
        </div>
        <p className="col-span-3 text-center text-metadata text-fg-secondary">{spec.relationLabelL1}</p>
      </section>

      <section className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-control-label font-semibold">{cardText('boundaryContext')}</span>
          <small className="text-metadata text-fg-tertiary">{cardText('tapOtherWordsForDefinitions')}</small>
        </div>
        <div className="mt-5 font-language text-xl leading-9">
          <ClickableSentence
            sentenceHtml={emphasizeTarget(spec)}
            activeTokenIdx={activeLookup?.tokenIdx ?? null}
            onWordClick={lookupToken}
          />
        </div>
        <div className="mt-5 flex min-h-11 items-center gap-2 rounded-control bg-surface-subtle px-4 text-metadata text-fg-secondary">
          <i className="size-2 rounded-full bg-progress" aria-hidden="true" />
          <span>{cardText('translationAppearsAfterYourAnswer')}</span>
        </div>
      </section>

      <section className="mt-7">
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('yourJudgement')}</span>
        <h2 className="mt-2 text-section-title font-semibold">{spec.questionL1}</h2>
        <div className="mt-4 grid gap-3" role="radiogroup" aria-label={spec.questionL1}>
          {spec.options.map((option, index) => {
            const selected = option.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className={`grid min-h-14 grid-cols-[2rem_1fr_1rem] items-center gap-3 rounded-control border p-3 text-left focus-visible:outline-2 focus-visible:outline-focus ${selected ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel hover:bg-surface-subtle'}`}
                key={option.id}
                onClick={() => setSelectedId(option.id)}
              >
                <span className="grid size-8 place-items-center rounded-control bg-accent-soft text-metadata font-bold text-action-primary" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                <strong className="text-body-support">{option.labelL1}</strong>
                <i className={`size-3 rounded-full border ${selected ? 'border-action-primary bg-action-primary' : 'border-border-strong'}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <footer className="mt-auto pt-8">
        <button
          className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45"
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
