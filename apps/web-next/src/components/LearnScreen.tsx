import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { Word } from '../types';
import type { IntroductionPhase } from './cards/IntroductionCard';
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
import type { LearningStepKind, RepairResourceReference } from '../engine/types';
import type { ReviewAssessmentKind, ReviewAssessmentResult } from '../review/types';
import {
  stepRendererRegistry,
  type StepRendererHost,
} from '../learningRuntime/stepRenderers';
import { personalContentService } from '../services/personalContentService';

/**
 * 队列驱动 Step 的宿主屏：工具栏、进度与卡片视口。
 *
 * 落地前它同时回答两个问题——"这一步渲染哪张卡"（七个 `stage === '…'`
 * 分支）和"渲染这张卡要什么"（三十余个 prop 里过半是给卡片的）。前者
 * `stepKind` 轴落地后已归编排盖章，查表在 `learningRuntime/stepRenderers.tsx`；
 * 后者收进 `StepRendererHost` 这一份合同。这屏自己剩下的接口只有工具栏
 * 回调与步骤数据。
 */
interface LearnScreenProps {
  active: boolean;
  isBehind: boolean;
  curWord: Word;
  /** 哪张卡：读编排盖的章（`OrchestratedStepDefinition.stepKind`）。 */
  stage: LearningStepKind;
  step: number;
  groupSize: number;
  introductionContent: PrototypeIntroductionPackage | null;
  /** App 侧已物化的修复内容；为空时由讲解包按 resourceRef 现场物化。 */
  repairContent: PrototypeIntroductionPackage | null;
  introductionPosition: number;
  introductionTotal: number;
  reviewAssessmentPurpose: 'acquisition' | 'retention';
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: (
    e: MouseEvent,
    personalContent: PrototypeIntroductionPackage | null,
  ) => void;
  onOpenSpelling?: (word: Word) => void;
  reviewAssessmentKind: ReviewAssessmentKind | null;
  reviewAssessmentTaskKey: string | null;
  assessmentPackageIdentity: AssessmentPackageIdentity | null;
  reviewAssessmentResult: ReviewAssessmentResult | null;
  repairResourceRef: RepairResourceReference | null;
  /** 卡片要的宿主能力与完成回调，合同见 learningRuntime/stepRenderers.tsx。 */
  host: StepRendererHost;
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
  reviewAssessmentPurpose,
  onExit,
  onUndo,
  onMarkKnown,
  onOpenMenuMore,
  onOpenSpelling,
  reviewAssessmentKind,
  reviewAssessmentTaskKey,
  assessmentPackageIdentity,
  reviewAssessmentResult,
  repairResourceRef,
  host,
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

  const scrollToTop = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

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
                  host.toast(next ? '已收藏这个义项' : '已取消收藏');
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
                      host.toast(`开始拼写练习：${curWord.w}`);
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

      {/* 核心卡片渲染视口：章是编排盖的，卡是注册表查的（stepRenderers.tsx）。 */}
      <div className="lscroll" id="lScroll" ref={scrollRef}>
        {stepRendererRegistry.get(stage)({
          stepKind: stage,
          ordinal: step,
          curWord,
          content: introductionContent,
          repairContent,
          repairResourceRef,
          phase: introductionPhase,
          onPhaseChange: setIntroductionPhase,
          assessmentResource,
          reviewSpec,
          reviewAssessmentResult,
          purpose: reviewAssessmentPurpose,
          onCardViewChange: scrollToTop,
          host,
        })}
      </div>
    </section>
  );
};
