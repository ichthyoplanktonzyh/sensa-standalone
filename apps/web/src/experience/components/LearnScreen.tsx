import {audioService} from '../services/audioService';
import { useTranslation } from "react-i18next";
import type { CardExecution } from "./cards/CardExecution";
import { RuntimeTools, type RuntimeToolsProps } from "./learning/RuntimeTools";
import { RuntimeFrame } from "./learning/RuntimeFrame";
import { uiClass } from "../ui/classes";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
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
import { toReviewSpec } from "../content/prototypeReviewCards";

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
  stepLabel?: string;
  screenId?: string;
  busy?: boolean;
  notice?: ReactNode;
  execution?: CardExecution;
  preparedAssessmentResource?: AssessmentResource | null;
  controlledPhase?: IntroductionPhase;
  onControlledPhaseChange?: (phase: IntroductionPhase) => void;
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
  onOpenMenuMore: RuntimeToolsProps['onOpenMenuMore'];
  reviewAssessmentKind: ReviewAssessmentKind | null;
  reviewAssessmentTaskKey: string | null;
  assessmentPackageIdentity: AssessmentPackageIdentity | null;
  reviewAssessmentResult: ReviewAssessmentResult | null;
  repairResourceRef: RepairResourceReference | null;
  /** 卡片要的宿主能力与完成回调，合同见 learningRuntime/stepRenderers.tsx。 */
  host: StepRendererHost;
}

export const LearnScreen = ({
  stepLabel, screenId="s-learn", busy, notice, execution, preparedAssessmentResource, controlledPhase, onControlledPhaseChange,
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
  useEffect(() => { if(active && !isBehind) return () => audioService.stop(); }, [active, isBehind, stage]);
  const [localPhase, setLocalPhase] =
    useState<IntroductionPhase>("experience");
  const introductionPhase = controlledPhase ?? localPhase;
  const setIntroductionPhase = onControlledPhaseChange ?? setLocalPhase;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 词或阶段切换时，将滚动容器置顶
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [curWord, stage, step, introductionPhase]);

  useEffect(() => {
    setLocalPhase("experience");
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
      : isReviewFeedback || !!execution?.feedback
        ? introductionContent
        : null;
  const progressLabel = t("assurance.progress", {
    current: Math.min(step, groupSize),
    total: groupSize,
  });
  const assessmentResource = useMemo<AssessmentResource | null>(() => {
    if (preparedAssessmentResource !== undefined) return preparedAssessmentResource;
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
    preparedAssessmentResource,
    assessmentPackageIdentity,
    introductionContent,
    isReviewAssessment,
    isReviewFeedback,
    learningAssessmentKind,
    reviewAssessmentKind,
    reviewAssessmentTaskKey,
  ]);
  const reviewSpec = useMemo(() => {
    if (preparedAssessmentResource !== undefined) return preparedAssessmentResource && introductionContent ? toReviewSpec(preparedAssessmentResource, introductionContent) : null;
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
  }, [preparedAssessmentResource, introductionContent, reviewAssessmentKind, reviewAssessmentTaskKey]);

  const scrollToTop = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  if(!hasTask) return <RuntimeFrame id={screenId} active={active&&!isBehind} title={t('assurance.title')} stepLabel="" progress={0} onExit={onExit}>
    <h1 className="text-2xl font-medium">{t('assurance.noTask')}</h1>
    <button className="mt-8 min-h-12 rounded-xl bg-[#303f76] px-6 text-sm text-white" onClick={onExit}>{t('assurance.back')}</button>
  </RuntimeFrame>;
  return (
    <section id={screenId} data-anim="fade" className={uiClass(`screen${active && !isBehind ? ' active' : ''}${isBehind ? ' behind' : ''}${isIntroductionReveal ? ' is-intro-reveal' : ''}`, '#s-learn')}>
      <div className={uiClass('h-sp')}/>
      <div className={uiClass('lh')}>
        <button onClick={onExit} aria-label={t('runtime.pause')}><svg className={uiClass('icon')} width="26" height="26"><use href="#i-chev-l"/></svg></button>
        <span className={uiClass(`prog-n${isIntroduction ? ' sense-progress' : ''}`, '#lhProg')}>{stepLabel ?? progressLabel}</span>
        <div className={uiClass('tools')}><RuntimeTools content={introductionContent} personalContent={personalMenuContent} showSave={!isExperienceHidden}
          onUndo={!isIntroduction && !isReviewStage ? onUndo : undefined} canUndo={step > 1} onMarkKnown={onMarkKnown}
          onOpenMenuMore={onOpenMenuMore} toast={host.toast} busy={busy}/></div>
      </div>
      <div className={uiClass('lscroll', '#lScroll')} id={screenId === 's-learn' ? 'lScroll' : undefined} ref={scrollRef}>
        {notice}
        <fieldset disabled={busy} className="min-w-0 border-0 p-0 disabled:opacity-60" data-assurance-original-cards>
        {active && !isBehind && stepRendererRegistry.get(stage)({
          execution,
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
        </fieldset>
      </div>
    </section>
  );
};
