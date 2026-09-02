import { useEffect, useMemo, useState } from 'react';
import type { AssessmentResource } from '../../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../../content/learningCatalog';
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
  ReviewChoiceOption,
  ReviewExampleExcerpt,
} from '../../../review/types';
import { resolveReviewMemoryOutcome } from '../../../review/types';
import type { DictionaryLookup, SentenceToken } from '../../../types';
import { ClickableSentence } from '../../ClickableSentence';
import { QuickDictPopup } from '../../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../../useImmediateDictionaryLookup';

interface ReviewAssessmentCardProps {
  content: PrototypeIntroductionPackage;
  spec: ReviewAssessmentSpec;
  /** Exact Assessment Resource selected by the current Action. */
  assessmentResource: AssessmentResource;
  onSubmit: (result: ReviewAssessmentResult) => void;
  onOpenDictionary: (word: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

function emphasizeTarget(example: ReviewExampleExcerpt): string {
  return `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
}

function ChoiceList({
  options,
  selectedId,
  onSelect,
  ariaLabel,
}: {
  options: ReviewChoiceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="review-choice-list" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => (
        <button
          type="button"
          role="radio"
          aria-checked={selectedId === option.id}
          className={`review-choice${selectedId === option.id ? ' selected' : ''}`}
          key={option.id}
          onClick={() => onSelect(option.id)}
        >
          <span className="review-choice-index" aria-hidden="true">
            {String.fromCharCode(65 + index)}
          </span>
          <span>
            <strong>{option.labelL1}</strong>
            {option.detailL1 && <small>{option.detailL1}</small>}
          </span>
          <i aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function ReviewAssessmentCard({
  content,
  spec,
  assessmentResource,
  onSubmit,
  onOpenDictionary,
  lookupDictionary,
  onViewChange,
  toast,
}: ReviewAssessmentCardProps) {
  if (
    assessmentResource.packageKey !== content.packageKey
    || assessmentResource.senseKey !== content.senseKey
    || assessmentResource.kind !== spec.kind
    || assessmentResource.taskKey !== spec.taskKey
  ) {
    throw new Error('Review card resource does not match the selected Assessment Task.');
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typedForm, setTypedForm] = useState('');
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    setSelectedId(null);
    setTypedForm('');
    clearLookup();
  }, [clearLookup, spec.id]);

  const options = useMemo(() => {
    if (spec.kind === 'context_recognition' || spec.kind === 'boundary_contrast') {
      return spec.options;
    }
    if (spec.kind === 'novel_context_transfer') return spec.scenario.options;
    return [];
  }, [spec]);

  const normalizedTypedForm = typedForm.trim().toLocaleLowerCase();
  const canSubmit = spec.kind === 'meaning_to_form_recall'
    ? normalizedTypedForm.length > 0
    : selectedId !== null;

  const submit = (responseId: string | null, correct: boolean) => {
    clearLookup();
    onViewChange();
    onSubmit({
      assessmentId: spec.id,
      kind: spec.kind,
      focusDimension: spec.focusDimension,
      correct,
      responseId,
      memoryOutcome: resolveReviewMemoryOutcome(spec.kind, correct),
      evidenceEligible: spec.evidenceEligible,
    });
  };

  const submitAnswer = () => {
    if (spec.kind === 'meaning_to_form_recall') {
      const correct = spec.acceptedForms.some(
        (form) => form.toLocaleLowerCase() === normalizedTypedForm,
      );
      submit(normalizedTypedForm, correct);
      return;
    }
    const selected = options.find((option) => option.id === selectedId);
    if (selected) submit(selected.id, selected.isCorrect);
  };

  const lookupToken = (token: SentenceToken, tokenIdx: number) => {
    if (token.cleanWord.toLocaleLowerCase() === content.lemma.toLocaleLowerCase()) {
      toast('提交判断后可查看当前词的完整解释');
      return;
    }
    openLookup({
      tokenIdx,
      displayWord: token.cleanWord,
      load: async () => {
        const entry = await lookupDictionary(token.cleanWord);
        if (!entry) toast('当前词典没有这个词');
        return entry;
      },
    });
  };

  const renderExample = (example: ReviewExampleExcerpt, contextLabelL1: string) => (
    <section className="review-context-card">
      <div className="review-context-label">
        <span>{contextLabelL1}</span>
        <small>非目标词可点按查义</small>
      </div>
      <div className="review-context-sentence">
        <ClickableSentence
          sentenceHtml={emphasizeTarget(example)}
          activeTokenIdx={activeLookup?.tokenIdx ?? null}
          onWordClick={lookupToken}
        />
      </div>
      <div className="review-translation-mask" aria-label="译文将在作答后显示">
        <span aria-hidden="true" />
        <small>译文将在作答后显示</small>
      </div>
    </section>
  );

  return (
    <div className={`review-assessment-page review-kind-${spec.kind.replace(/_/g, '-')}`}>
      <header className="review-assessment-heading">
        <span>{spec.kickerL1}</span>
        <h1>{spec.titleL1}</h1>
        <p>{spec.instructionL1}</p>
        <div className="review-dimension-pill">
          <i aria-hidden="true" />
          本次只检验：{spec.focusDimension}
        </div>
      </header>

      {spec.kind === 'context_recognition' && (
        <>
          {renderExample(spec.example, spec.contextLabelL1)}
          <h2 className="review-question">{spec.questionL1}</h2>
          <ChoiceList
            options={spec.options}
            selectedId={selectedId}
            onSelect={setSelectedId}
            ariaLabel={spec.questionL1}
          />
        </>
      )}

      {spec.kind === 'meaning_to_form_recall' && (
        <>
          <section className="review-recall-cue">
            <span>当前义项</span>
            <p>{spec.cueL1}</p>
            <div>
              {spec.cueFeatureLabelsL1.map((label) => <small key={label}>{label}</small>)}
            </div>
          </section>
          <label className="review-recall-input">
            <span>对应的英文表达</span>
            <input
              value={typedForm}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="输入英文词"
              onChange={(event) => setTypedForm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSubmit) submitAnswer();
              }}
            />
          </label>
          <button
            type="button"
            className="review-uncertain-link"
            onClick={() => submit(null, false)}
          >
            想不起来，直接进入修复
          </button>
        </>
      )}

      {spec.kind === 'novel_context_transfer' && (
        <>
          <section className="review-transfer-scene">
            <div className="review-context-label">
              <span>{spec.scenario.sceneLabelL1}</span>
              <small>目标词保持隐藏</small>
            </div>
            <p className="review-transfer-l2">{spec.scenario.setupL2}</p>
            <p className="review-transfer-l1">{spec.scenario.setupL1}</p>
            <div
              className={`review-transfer-visual visual-${spec.scenario.visualKind.replace(/_/g, '-')}`}
              role="img"
              aria-label={spec.scenario.visualAltL1}
            >
              <span className="review-transfer-orbit orbit-a" aria-hidden="true" />
              <span className="review-transfer-orbit orbit-b" aria-hidden="true" />
              <span className="review-transfer-core" aria-hidden="true" />
              <i className="review-transfer-case" aria-hidden="true" />
            </div>
          </section>
          <h2 className="review-question">{spec.scenario.questionL1}</h2>
          <ChoiceList
            options={spec.scenario.options}
            selectedId={selectedId}
            onSelect={setSelectedId}
            ariaLabel={spec.scenario.questionL1}
          />
        </>
      )}

      {spec.kind === 'boundary_contrast' && (
        <>
          <div className="review-preview-banner">
            <span aria-hidden="true">◇</span>
            <p>{spec.previewLabelL1}</p>
          </div>
          <section className="review-boundary-map" aria-label="义项边界">
            <div>
              <small>当前学习义项</small>
              <strong>{spec.currentSenseL1}</strong>
            </div>
            <span>
              <small>{spec.relationLabelL1}</small>
              <i aria-hidden="true">↔</i>
            </span>
            <div className="contrast">
              <small>相邻义项</small>
              <strong>{spec.contrastSenseL1}</strong>
            </div>
          </section>
          {renderExample(spec.example, '边界语境')}
          <h2 className="review-question">{spec.questionL1}</h2>
          <ChoiceList
            options={spec.options}
            selectedId={selectedId}
            onSelect={setSelectedId}
            ariaLabel={spec.questionL1}
          />
        </>
      )}

      <div className="lfoot review-assessment-footer" id="lFoot">
        <button
          type="button"
          className="fbtn green"
          disabled={!canSubmit}
          onClick={submitAnswer}
        >
          提交这次检验<i />
        </button>
      </div>

      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={(word) => {
            clearLookup();
            onOpenDictionary(word);
          }}
        />
      )}
    </div>
  );
}
