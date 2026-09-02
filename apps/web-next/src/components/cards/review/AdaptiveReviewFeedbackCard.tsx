import { useMemo, useState } from 'react';
import type { AssessmentResource, MeaningToFormRecallAssessmentResource } from '../../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../../content/learningCatalog';
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
  ReviewChoiceOption,
  ReviewExampleExcerpt,
} from '../../../review/types';
import type { DictionaryLookup, QuickDictEntry, SentenceToken } from '../../../types';
import { ClickableSentence } from '../../ClickableSentence';
import { PersonalConnectionActions } from '../../PersonalConnectionActions';
import { QuickDictPopup } from '../../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../../useImmediateDictionaryLookup';
import {
  IntroductionCard,
  type IntroductionPhase,
  type RevealPresentation,
} from '../IntroductionCard';

interface AdaptiveReviewFeedbackCardProps {
  content: PrototypeIntroductionPackage;
  spec: ReviewAssessmentSpec;
  assessmentResource: AssessmentResource;
  result: ReviewAssessmentResult;
  revealPresentation: RevealPresentation;
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

function outcomeLabel(result: ReviewAssessmentResult): string {
  if (result.memoryOutcome === 'transfer_confirmed') return '迁移确认';
  if (result.memoryOutcome === 'independent_retrieval') return '独立提取';
  return '提取失败';
}

function responseOptions(spec: ReviewAssessmentSpec): ReviewChoiceOption[] {
  if (spec.kind === 'context_recognition' || spec.kind === 'boundary_contrast') {
    return spec.options;
  }
  if (spec.kind === 'novel_context_transfer') return spec.scenario.options;
  return [];
}

export function AdaptiveReviewFeedbackCard({
  content,
  spec,
  assessmentResource,
  result,
  revealPresentation,
  onContinue,
  onOpenDictionary,
  lookupDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  onViewChange,
  toast,
}: AdaptiveReviewFeedbackCardProps) {
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
    if (spec.kind === 'novel_context_transfer' && result.correct) {
      return { title: spec.scenario.successTitleL1, body: spec.scenario.successBodyL1 };
    }
    if (selectedOption) {
      return {
        title: selectedOption.feedbackTitleL1,
        body: selectedOption.feedbackBodyL1,
      };
    }
    if (!correctOption) {
      throw new Error('Review feedback has no Package-owned option feedback.');
    }
    return {
      title: correctOption.feedbackTitleL1,
      body: correctOption.feedbackBodyL1,
    };
  })();

  const revealedExample = spec.kind === 'context_recognition' || spec.kind === 'boundary_contrast'
    ? spec.example
    : spec.kind === 'novel_context_transfer'
    ? spec.scenario.revealExample
    : content.studyExample;

  const lookupToken = async (token: SentenceToken): Promise<QuickDictEntry | null> => {
    const entry = await lookupDictionary(token.cleanWord);
    if (token.cleanWord.toLocaleLowerCase() !== content.lemma.toLocaleLowerCase()) {
      if (!entry) toast('当前词典没有这个词');
      return entry;
    }
    const baseEntry = entry ?? {
      word: content.lemma,
      phonetic: content.ipa,
      senses: [],
      hasFullDetail: false,
    };
    const otherSenses = baseEntry.hasFullDetail
      ? baseEntry.senses.filter((sense) => sense.text !== content.guideLabelL1)
      : [];
    return {
      ...baseEntry,
      id: content.senseKey,
      word: content.lemma,
      phonetic: content.ipa,
      senses: [
        { pos: '本句中', text: `${content.partOfSpeech} ${content.guideLabelL1}` },
        ...otherSenses,
      ],
      hasFullDetail: true,
    };
  };

  if (replayPhase) {
    return (
      <IntroductionCard
        content={content}
        phase={replayPhase}
        mode="repair_replay"
        repairPurpose="retention"
        presentation={revealPresentation}
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
    <div className={`review-feedback-page${result.correct ? ' success' : ' repair'}`}>
      <header className="review-feedback-heading">
        <div className="review-outcome-mark" aria-hidden="true">
          {result.correct ? '✓' : '↗'}
        </div>
        <span>{result.correct ? '检验完成' : '进入定向修复'}</span>
        <h1>{feedback.title}</h1>
        <p>{feedback.body}</p>
      </header>

      <section className="review-outcome-card" aria-label="本次 Memory Outcome">
        <div>
          <small>Memory Outcome</small>
          <strong>{outcomeLabel(result)}</strong>
        </div>
        <div>
          <small>本次观察维度</small>
          <strong>{result.focusDimension}</strong>
        </div>
        <p>
          {result.evidenceEligible
            ? '本次复习只结算一次；下面的解释与修复不会再次更新 FSRS。'
            : '这是条件组件预览，不写入 Evidence，也不会更新 FSRS。'}
        </p>
      </section>

      {spec.kind === 'meaning_to_form_recall' && (
        <section className="review-form-repair">
          <span>正确英文表达</span>
          <strong>{spec.primaryForm}</strong>
          <p>{content.l1Bridge}</p>
        </section>
      )}

      {spec.kind === 'boundary_contrast' && (
        <section className="review-boundary-repair">
          <div><small>当前义项</small><strong>{spec.currentSenseL1}</strong></div>
          <span aria-hidden="true">≠</span>
          <div><small>本句义项</small><strong>{spec.contrastSenseL1}</strong></div>
        </section>
      )}

      {spec.kind === 'novel_context_transfer' && (
        <section className="review-transfer-connection">
          <span>没有改变的意思结构</span>
          <div>
            {spec.scenario.invariantLabelsL1.map((label, index) => (
              <span key={label}>
                {label}
                {index < spec.scenario.invariantLabelsL1.length - 1 && <i aria-hidden="true">→</i>}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="review-reveal-example">
        <div>
          <span>{spec.kind === 'novel_context_transfer' ? '放回英文表达' : '语境回看'}</span>
          <small>点击单词可查义</small>
        </div>
        <div className="review-feedback-sentence">
          <ClickableSentence
            sentenceHtml={emphasizeTarget(revealedExample)}
            activeTokenIdx={activeLookup?.tokenIdx ?? null}
            onWordClick={(token, tokenIdx) => {
              openLookup({
                tokenIdx,
                displayWord: token.cleanWord,
                load: () => lookupToken(token),
              });
            }}
          />
        </div>
        <p>{revealedExample.textL1}</p>
      </section>

      <div className="review-feedback-actions">
        <button
          type="button"
          className={result.correct ? '' : 'emphasized'}
          onClick={() => {
            clearLookup();
            onViewChange();
            setReplayPhase('experience');
          }}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
          回到经验建立
          <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button type="button" onClick={() => {
          clearLookup();
          onOpenExample();
        }}>
          <svg className="icon" aria-hidden="true"><use href="#i-bookopen" /></svg>
          查看学习例句
          <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
        <button type="button" onClick={() => {
          clearLookup();
          onOpenDictionary(content.lemma);
        }}>
          <svg className="icon" aria-hidden="true"><use href="#i-search" /></svg>
          查看完整词典
          <svg className="icon chevron" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      <PersonalConnectionActions
        senseId={content.senseKey}
        onOpenNote={onOpenNote}
        onOpenScene={onOpenScene}
        variant="compact"
      />

      <div className="lfoot review-feedback-footer" id="lFoot">
        <button type="button" className="fbtn green" onClick={onContinue}>
          {result.evidenceEligible ? '继续下一次复习' : '返回评测卡目录'}<i />
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
