import { useTranslation } from "react-i18next";
import { Star, Undo2, MoreHorizontal } from "lucide-react";
import { RuntimeFrame } from "./learning/RuntimeFrame";
import { uiClass } from "../ui/classes";
import { useState, useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { Word } from "../types";
import type { IntroductionPhase } from "./cards/IntroductionCard";
import {
  materializeReviewRepairContent,
  type PrototypeIntroductionPackage,
} from "../content/learningCatalog";
import {
  materializeAssessmentResource,
  type AssessmentPackageIdentity,
  type AssessmentResource,
} from "../content/assessmentResources";
import { buildPrototypeReviewAssessment } from "../content/prototypeReviewCards";
import type {
  LearningStepKind,
  RepairResourceReference,
} from "../engine/types";
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
} from "../review/types";
import {
  stepRendererRegistry,
  type StepRendererHost,
} from "../learningRuntime/stepRenderers";
import { personalContentService } from "../services/personalContentService";

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
  hasTask: boolean;
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
  reviewAssessmentPurpose: "acquisition" | "retention";
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: (
    e: MouseEvent,
    personalContent: PrototypeIntroductionPackage | null,
  ) => void;
  reviewAssessmentKind: ReviewAssessmentKind | null;
  reviewAssessmentTaskKey: string | null;
  assessmentPackageIdentity: AssessmentPackageIdentity | null;
  reviewAssessmentResult: ReviewAssessmentResult | null;
  repairResourceRef: RepairResourceReference | null;
  /** 卡片要的宿主能力与完成回调，合同见 learningRuntime/stepRenderers.tsx。 */
  host: StepRendererHost;
}

export const LearnScreen = ({
  hasTask,
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
  reviewAssessmentKind,
  reviewAssessmentTaskKey,
  assessmentPackageIdentity,
  reviewAssessmentResult,
  repairResourceRef,
  host,
}: LearnScreenProps) => {
  const { t } = useTranslation();
  const [starred, setStarred] = useState(false);
  const [introductionPhase, setIntroductionPhase] =
    useState<IntroductionPhase>("experience");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 词或阶段切换时，将滚动容器置顶
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [curWord, stage, step, introductionPhase]);

  useEffect(() => {
    setStarred(false);
    setIntroductionPhase("experience");
  }, [curWord.id, introductionContent?.senseKey]);

  const isIntroduction = stage === "introduction" && !!introductionContent;
  const repairContent = useMemo(
    () =>
      stage === "review_repair" && introductionContent
        ? (preparedRepairContent ??
          materializeReviewRepairContent(
            introductionContent,
            repairResourceRef,
          ))
        : null,
    [introductionContent, preparedRepairContent, repairResourceRef, stage],
  );
  const isRepair = stage === "review_repair" && !!repairContent;
  const isRecognition = stage === "recognition" && !!introductionContent;
  const isMeaningToFormRecall = stage === "recall" && !!introductionContent;
  const isNovelTransfer = stage === "transfer" && !!introductionContent;
  const isReviewAssessment =
    stage === "review_assessment" &&
    !!introductionContent &&
    !!reviewAssessmentKind;
  const isReviewFeedback =
    stage === "review_feedback" &&
    !!introductionContent &&
    !!reviewAssessmentKind &&
    !!reviewAssessmentResult;
  const isReviewStage =
    (isRepair && reviewAssessmentPurpose === "retention") ||
    isReviewAssessment ||
    isReviewFeedback;
  const isIntroductionReveal =
    (isIntroduction || isRepair) && introductionPhase === "reveal";
  const isProtectedLearningStage =
    isIntroduction ||
    isRepair ||
    isRecognition ||
    isMeaningToFormRecall ||
    isNovelTransfer;
  const isExperienceHidden =
    isIntroduction && introductionPhase === "experience";
  const learningAssessmentKind =
    stage === "recognition"
      ? ("context_recognition" as const)
      : stage === "recall"
        ? ("meaning_to_form_recall" as const)
        : stage === "transfer"
          ? ("novel_context_transfer" as const)
          : null;
  const personalMenuContent = isIntroductionReveal
    ? introductionContent
    : isRepair
      ? repairContent
      : isReviewFeedback
        ? introductionContent
        : null;
  const savedSenseId =
    introductionContent?.senseKey ?? curWord.id ?? `word:${curWord.w}`;
  const progressLabel = t("assurance.progress", {
    current: Math.min(step, groupSize),
    total: groupSize,
  });
  const assessmentResource = useMemo<AssessmentResource | null>(() => {
    const kind =
      isReviewAssessment || isReviewFeedback
        ? reviewAssessmentKind
        : learningAssessmentKind;
    const needsAssessment =
      isReviewAssessment || isReviewFeedback || learningAssessmentKind !== null;
    if (!needsAssessment) return null;
    if (
      !kind ||
      !introductionContent ||
      !reviewAssessmentTaskKey ||
      !assessmentPackageIdentity
    ) {
      throw new Error(
        "Formal assessment stage is missing its selected Action resource.",
      );
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
    if (
      !introductionContent ||
      !reviewAssessmentKind ||
      !reviewAssessmentTaskKey
    )
      return null;
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

  if(!hasTask) return <RuntimeFrame id="s-learn" active={active&&!isBehind} title={t('assurance.title')} stepLabel="" progress={0} onExit={onExit}>
    <h1 className="text-2xl font-medium">{t('assurance.noTask')}</h1>
    <button className="mt-8 min-h-12 rounded-xl bg-[#303f76] px-6 text-sm text-white" onClick={onExit}>{t('assurance.back')}</button>
  </RuntimeFrame>;
  return (
    <RuntimeFrame
      id="s-learn"
      active={active && !isBehind}
      title={t(
        reviewAssessmentPurpose === "retention"
          ? "assurance.review"
          : "assurance.title",
      )}
      stepLabel={progressLabel}
      progress={groupSize ? Math.min((step / groupSize) * 100, 100) : 0}
      onExit={onExit}
      tools={
        <>
          {!isExperienceHidden && (
            <>
              {!isIntroduction && !isReviewStage && (
                <button
                  className="min-h-11 px-2 text-[#68748d] disabled:opacity-30"
                  disabled={step <= 1}
                  onClick={onUndo}
                  aria-label={t("assurance.undo")}
                >
                  <Undo2 size={18} />
                </button>
              )}
              <button
                className="min-h-11 px-2 text-[#68748d]"
                aria-label={t("assurance.save")}
                aria-pressed={starred}
                onClick={() => {
                  const next = personalContentService.toggleSense(savedSenseId);
                  host.toast(t(next ? "assurance.saved" : "assurance.unsaved"));
                }}
              >
                <Star size={18} fill={starred ? "currentColor" : "none"} />
              </button>
            </>
          )}
          <button
            className="min-h-11 px-2 text-xs text-[#68748d]"
            onClick={onMarkKnown}
          >
            {t("assurance.known")}
          </button>
          <button
            className="min-h-11 px-2 text-[#68748d]"
            onClick={(event) => onOpenMenuMore(event, personalMenuContent)}
            id="learning-more-button"
              aria-label={t("assurance.more")}
          >
            <MoreHorizontal size={20} />
          </button>
        </>
      }
    >
      <div id="lScroll" ref={scrollRef}>
        {active && !isBehind && stepRendererRegistry.get(stage)({
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
    </RuntimeFrame>
  );
};
