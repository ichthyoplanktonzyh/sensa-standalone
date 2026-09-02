import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { Word, FormalLearningStage, QuickDictEntry, DictionaryLookup } from '../types';
import { RecallCard, type RecallPresentation } from './cards/RecallCard';
import {
  IntroductionCard,
  type IntroductionPhase,
  type RevealPresentation,
} from './cards/IntroductionCard';
import { RecognitionCard, type RecognitionPresentation } from './cards/RecognitionCard';
import {
  NovelTransferCard,
  type NovelTransferPresentation,
} from './cards/NovelTransferCard';
import { ReviewAssessmentCard } from './cards/review/ReviewAssessmentCard';
import { AdaptiveReviewFeedbackCard } from './cards/review/AdaptiveReviewFeedbackCard';
import {
  SensaReviewAssessmentCard,
  type ReviewPresentation,
} from './cards/review/SensaReviewAssessmentCard';
import { SensaReviewFeedbackCard } from './cards/review/SensaReviewFeedbackCard';
import {
  materializeReviewRepairContent,
  type PrototypeIntroductionPackage,
} from '../content/learningCatalog';
import {
  materializeAssessmentResource,
  type AssessmentPackageIdentity,
  type AssessmentResource,
} from '../content/assessmentResources';
import { buildPrototypeReviewAssessment } from '../content/prototypeReviewCards';
import type {
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  RepairResourceReference,
} from '../engine/types';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
} from '../review/types';
import { personalContentService } from '../services/personalContentService';
import {
  StructuredRuntimeStatus,
  type StructuredRuntimeStatusView,
} from './learning/StructuredRuntimeStatus';
import {
  RetentionRuntimeStatus,
  type RetentionRuntimeStatusView,
} from './learning/RetentionRuntimeStatus';

interface LearnScreenProps {
  active: boolean;
  isBehind: boolean;
  curWord: Word;
  stage: FormalLearningStage | 'review_repair';
  step: number;
  groupSize: number;
  introductionContent: PrototypeIntroductionPackage | null;
  /** Optional catalog-materialized repair content prepared by the runtime. */
  repairContent: PrototypeIntroductionPackage | null;
  introductionPosition: number;
  introductionTotal: number;
  revealPresentation: RevealPresentation;
  recognitionPresentation: RecognitionPresentation;
  recallPresentation: RecallPresentation;
  novelTransferPresentation: NovelTransferPresentation;
  reviewPresentation: ReviewPresentation;
  reviewAssessmentPurpose: 'acquisition' | 'retention';
  structuredRuntimeStatus: StructuredRuntimeStatusView | null;
  retentionRuntimeStatus: RetentionRuntimeStatusView | null;
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: (
    e: MouseEvent,
    personalContent: PrototypeIntroductionPackage | null,
  ) => void;
  onOpenExample: (idx: number, sentenceIdx?: number) => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onOpenNoteEditor?: (word: Word | QuickDictEntry | string, senseId?: string, meaning?: string) => void;
  onOpenSceneEditor: (
    content: PrototypeIntroductionPackage,
    anchorId?: string,
  ) => void;
  onOpenSpelling?: (word: Word) => void;
  onCompleteMeaningToFormRecall: (outcome: MeaningToFormRecallOutcome) => void;
  onCompleteNovelTransfer: (outcome: NovelTransferOutcome) => void;
  reviewAssessmentKind: ReviewAssessmentKind | null;
  reviewAssessmentTaskKey: string | null;
  assessmentPackageIdentity: AssessmentPackageIdentity | null;
  lookupDictionary: DictionaryLookup;
  reviewAssessmentResult: ReviewAssessmentResult | null;
  repairResourceRef: RepairResourceReference | null;
  onCompleteReviewAssessment: (result: ReviewAssessmentResult) => void;
  onContinueReviewFeedback: () => void;
  onCompleteIntroduction: () => void;
  onCompleteRecognition: (correct: boolean) => void;
  toast: (msg: string) => void;
}

export const LearnScreen = ({
  active,
  isBehind,
  curWord,
  stage,
  step,
  groupSize,
  introductionContent,
  repairContent: preparedRepairContent,
  introductionPosition,
  introductionTotal,
  revealPresentation,
  recognitionPresentation,
  recallPresentation,
  novelTransferPresentation,
  reviewPresentation,
  reviewAssessmentPurpose,
  structuredRuntimeStatus,
  retentionRuntimeStatus,
  onExit,
  onUndo,
  onMarkKnown,
  onOpenMenuMore,
  onOpenExample,
  onOpenDict,
  onOpenNoteEditor,
  onOpenSceneEditor,
  onOpenSpelling,
  onCompleteMeaningToFormRecall,
  onCompleteNovelTransfer,
  reviewAssessmentKind,
  reviewAssessmentTaskKey,
  assessmentPackageIdentity,
  lookupDictionary,
  reviewAssessmentResult,
  repairResourceRef,
  onCompleteReviewAssessment,
  onContinueReviewFeedback,
  onCompleteIntroduction,
  onCompleteRecognition,
  toast,
}: LearnScreenProps) => {
  const [starred, setStarred] = useState(false);
  const [introductionPhase, setIntroductionPhase] = useState<IntroductionPhase>('experience');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 词或阶段切换时，将滚动容器置顶
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [curWord, stage, step, introductionPhase]);

  useEffect(() => {
    setStarred(false);
    setIntroductionPhase('experience');
  }, [curWord.id, introductionContent?.senseKey]);

  const isIntroduction = stage === 'introduction' && !!introductionContent;
  const repairContent = useMemo(
    () => stage === 'review_repair' && introductionContent
      ? preparedRepairContent
        ?? materializeReviewRepairContent(introductionContent, repairResourceRef)
      : null,
    [introductionContent, preparedRepairContent, repairResourceRef, stage],
  );
  const isRepair = stage === 'review_repair' && !!repairContent;
  const isRecognition = stage === 'recognition' && !!introductionContent;
  const isMeaningToFormRecall = stage === 'recall' && !!introductionContent;
  const isNovelTransfer = stage === 'transfer' && !!introductionContent;
  const isReviewAssessment = stage === 'review_assessment'
    && !!introductionContent
    && !!reviewAssessmentKind;
  const isReviewFeedback = stage === 'review_feedback'
    && !!introductionContent
    && !!reviewAssessmentKind
    && !!reviewAssessmentResult;
  const isReviewStage = (isRepair && reviewAssessmentPurpose === 'retention')
    || isReviewAssessment
    || isReviewFeedback;
  const isIntroductionReveal = (isIntroduction || isRepair)
    && introductionPhase === 'reveal';
  const isProtectedLearningStage = isIntroduction
    || isRepair
    || isRecognition
    || isMeaningToFormRecall
    || isNovelTransfer;
  const isExperienceHidden = isIntroduction && introductionPhase === 'experience';
  const learningAssessmentKind = stage === 'recognition'
    ? 'context_recognition' as const
    : stage === 'recall'
    ? 'meaning_to_form_recall' as const
    : stage === 'transfer'
    ? 'novel_context_transfer' as const
    : null;
  const personalMenuContent = isIntroductionReveal
    ? introductionContent
    : isRepair
    ? repairContent
    : isReviewFeedback
    ? introductionContent
    : null;
  const savedSenseId = introductionContent?.senseKey ?? curWord.id ?? `word:${curWord.w}`;
  const progressLabel = isIntroduction
    ? `新义项 ${introductionPosition}/${introductionTotal}`
    : isRepair && reviewAssessmentPurpose === 'acquisition'
    ? `学习 ${Math.min(step, groupSize)}/${groupSize}`
    : isReviewStage
    ? `复习 ${Math.min(step, groupSize)}/${groupSize}`
    : `${Math.min(step, groupSize)}/${groupSize}`;
  const assessmentResource = useMemo<AssessmentResource | null>(() => {
    const kind = isReviewAssessment || isReviewFeedback
      ? reviewAssessmentKind
      : learningAssessmentKind;
    const needsAssessment = isReviewAssessment || isReviewFeedback || learningAssessmentKind !== null;
    if (!needsAssessment) return null;
    if (!kind || !introductionContent || !reviewAssessmentTaskKey || !assessmentPackageIdentity) {
      throw new Error('Formal assessment stage is missing its selected Action resource.');
    }
    return materializeAssessmentResource({
      packageIdentity: assessmentPackageIdentity,
      content: introductionContent,
      taskKey: reviewAssessmentTaskKey,
      kind,
    });
  }, [
    assessmentPackageIdentity,
    introductionContent,
    isReviewAssessment,
    isReviewFeedback,
    learningAssessmentKind,
    reviewAssessmentKind,
    reviewAssessmentTaskKey,
  ]);
  const reviewSpec = useMemo(() => {
    if (!introductionContent || !reviewAssessmentKind || !reviewAssessmentTaskKey) return null;
    return buildPrototypeReviewAssessment(
      introductionContent,
      reviewAssessmentKind,
      reviewAssessmentTaskKey,
    );
  }, [introductionContent, reviewAssessmentKind, reviewAssessmentTaskKey]);

  useEffect(() => {
    const updateSavedState = () => {
      setStarred(personalContentService.isSenseSaved(savedSenseId));
    };
    updateSavedState();
    return personalContentService.subscribe(updateSavedState);
  }, [savedSenseId]);

  return (
    <section
      className={`screen${active ? ' active' : ''}${isBehind ? ' behind' : ''}${isIntroductionReveal ? ' is-intro-reveal' : ''}`}
      id="s-learn"
      data-anim="fade"
    >
      <div className="h-sp" />

      {/* 顶部工具栏 */}
      <div className="lh">
        <button onClick={onExit} aria-label="返回">
          <svg className="icon" style={{ width: 26, height: 26 }}><use href="#i-chev-l" /></svg>
        </button>
        <span className={`prog-n${isIntroduction ? ' sense-progress' : ''}`} id="lhProg">
          {progressLabel}
        </span>
        <div className="tools">
          {!isExperienceHidden && (
            <>
              {!isIntroduction && !isReviewStage && (
                <button
                  id="btnUndo"
                  disabled={step <= 1}
                  onClick={onUndo}
                  aria-label="撤回"
                >
                  <svg className="icon"><use href="#i-undo" /></svg>
                </button>
              )}
              <button
                id="btnStar"
                className={starred ? 'on' : ''}
                onClick={() => {
                  const next = personalContentService.toggleSense(savedSenseId);
                  toast(next ? '已收藏这个义项' : '已取消收藏');
                }}
                aria-label="收藏这个义项"
              >
                <svg
                  className="icon"
                  style={{
                    fill: starred ? '#d9642d' : 'none',
                    stroke: starred ? '#d9642d' : 'currentColor',
                  }}
                >
                  <use href="#i-star" />
                </svg>
              </button>
              {!isProtectedLearningStage && !isReviewStage && (
                <>
                <button
                  onClick={() => {
                    if (onOpenSpelling) {
                      onOpenSpelling(curWord);
                    } else {
                      toast(`开始拼写练习：${curWord.w}`);
                    }
                  }}
                  aria-label="拼写练习"
                  title="拼写练习"
                >
                  <span className="txt" style={{ fontSize: 17, letterSpacing: '-.5px', borderBottom: '1.6px solid currentColor', paddingBottom: 1 }}>
                    abc
                  </span>
                </button>
                </>
              )}
            </>
          )}
          <button onClick={onMarkKnown} aria-label="声明这个义项已会">
            <span className="txt">熟</span>
          </button>
          <button
            onClick={(event) => onOpenMenuMore(event, personalMenuContent)}
            aria-label="更多"
          >
            <svg className="icon"><use href="#i-dots" /></svg>
          </button>
        </div>
      </div>

      {structuredRuntimeStatus && (
        <StructuredRuntimeStatus value={structuredRuntimeStatus} />
      )}
      {retentionRuntimeStatus && (
        <RetentionRuntimeStatus value={retentionRuntimeStatus} />
      )}

      {/* 核心卡片渲染视口 */}
      <div className="lscroll" id="lScroll" ref={scrollRef}>
        {isIntroduction && (
          <IntroductionCard
            content={introductionContent}
            phase={introductionPhase}
            presentation={revealPresentation}
            onPhaseChange={setIntroductionPhase}
            onComplete={onCompleteIntroduction}
            onOpenExample={(sentenceIndex = 0) => onOpenExample(0, sentenceIndex)}
            onOpenDictionary={(word) => onOpenDict?.(word ?? curWord, '柯林斯')}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            lookupDictionary={lookupDictionary}
            toast={toast}
          />
        )}

        {isRepair && (
          <IntroductionCard
            key={`${repairContent!.senseKey}:${repairResourceRef?.role}:${repairResourceRef?.key}`}
            content={repairContent!}
            phase={introductionPhase}
            mode="repair_replay"
            repairPurpose={reviewAssessmentPurpose}
            presentation={revealPresentation}
            onPhaseChange={setIntroductionPhase}
            onComplete={onCompleteIntroduction}
            onOpenExample={(sentenceIndex = 0) => onOpenExample(0, sentenceIndex)}
            onOpenDictionary={(word) => onOpenDict?.(word ?? curWord, '柯林斯')}
            onOpenNote={() => onOpenNoteEditor?.(
              repairContent!.lemma,
              repairContent!.senseKey,
              repairContent!.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(repairContent!, anchorId)}
            lookupDictionary={lookupDictionary}
            toast={toast}
          />
        )}

        {isRecognition && assessmentResource?.kind === 'context_recognition' && (
          <RecognitionCard
            key={`${introductionContent.senseKey}:${assessmentResource.taskKey}:${step}`}
            content={introductionContent}
            assessment={assessmentResource}
            presentation={recognitionPresentation}
            onComplete={onCompleteRecognition}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            lookupDictionary={lookupDictionary}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isMeaningToFormRecall && assessmentResource?.kind === 'meaning_to_form_recall' && (
          <RecallCard
            key={`${introductionContent.senseKey}:${assessmentResource.taskKey}:${step}`}
            content={introductionContent}
            assessment={assessmentResource}
            presentation={recallPresentation}
            onComplete={onCompleteMeaningToFormRecall}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            onOpenExample={() => onOpenExample(0, 0)}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isNovelTransfer && assessmentResource?.kind === 'novel_context_transfer' && (
          <NovelTransferCard
            key={`${introductionContent.senseKey}:${assessmentResource.taskKey}:${step}`}
            content={introductionContent}
            assessment={assessmentResource}
            presentation={novelTransferPresentation}
            onComplete={onCompleteNovelTransfer}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            onOpenExample={() => onOpenExample(0, 0)}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            lookupDictionary={lookupDictionary}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isReviewAssessment && reviewSpec && reviewPresentation === 'baseline' && (
          <ReviewAssessmentCard
            key={`${introductionContent.senseKey}:${reviewSpec.id}:${step}`}
            content={introductionContent}
            spec={reviewSpec}
            assessmentResource={assessmentResource!}
            onSubmit={onCompleteReviewAssessment}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            lookupDictionary={lookupDictionary}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isReviewAssessment && reviewSpec && reviewPresentation === 'sensa' && (
          <SensaReviewAssessmentCard
            key={`${introductionContent.senseKey}:${reviewSpec.id}:${step}:sensa`}
            content={introductionContent}
            spec={reviewSpec}
            assessmentResource={assessmentResource!}
            purpose={reviewAssessmentPurpose}
            onSubmit={onCompleteReviewAssessment}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            onOpenExample={() => onOpenExample(0, 0)}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            lookupDictionary={lookupDictionary}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isReviewFeedback && reviewSpec && reviewAssessmentResult && reviewPresentation === 'baseline' && (
          <AdaptiveReviewFeedbackCard
            key={`${introductionContent.senseKey}:${reviewSpec.id}:feedback:${step}`}
            content={introductionContent}
            spec={reviewSpec}
            assessmentResource={assessmentResource!}
            result={reviewAssessmentResult}
            revealPresentation={revealPresentation}
            onContinue={onContinueReviewFeedback}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            lookupDictionary={lookupDictionary}
            onOpenExample={() => onOpenExample(0, 0)}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

        {isReviewFeedback && reviewSpec && reviewAssessmentResult && reviewPresentation === 'sensa' && (
          <SensaReviewFeedbackCard
            key={`${introductionContent.senseKey}:${reviewSpec.id}:feedback:${step}:sensa`}
            content={introductionContent}
            spec={reviewSpec}
            assessmentResource={assessmentResource!}
            result={reviewAssessmentResult}
            revealPresentation={revealPresentation}
            onContinue={onContinueReviewFeedback}
            onOpenDictionary={(word) => onOpenDict?.(word, '柯林斯')}
            lookupDictionary={lookupDictionary}
            onOpenExample={() => onOpenExample(0, 0)}
            onOpenNote={() => onOpenNoteEditor?.(
              introductionContent.lemma,
              introductionContent.senseKey,
              introductionContent.guideLabelL1,
            )}
            onOpenScene={(anchorId) => onOpenSceneEditor(introductionContent, anchorId)}
            onViewChange={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            toast={toast}
          />
        )}

      </div>
    </section>
  );
};
