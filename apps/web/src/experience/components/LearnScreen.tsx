import {audioService} from '../services/audioService';
import { useTranslation } from "react-i18next";
import type { CardExecution } from "./cards/CardExecution";
import { RuntimeTools, type RuntimeToolsProps } from "./learning/RuntimeTools";
import { RuntimeFrame } from "./learning/RuntimeFrame";
import { fadeScreenClass, iconClass } from "../ui/primitives";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Word } from "../types";
import type { IntroductionPhase } from "./cards/IntroductionCard";
import type { RuntimeLearningContent } from "../../learning/content/learningCatalog";
import type { AssessmentResource } from "../../learning/content/assessmentResources";
import type { LearningStepKind, RepairResourceReference } from "../../learning/engine/types";
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
} from "../../learning/review/types";
import {
  stepRendererRegistry,
  type StepRendererHost,
} from "../learningRuntime/stepRenderers";
import { toReviewSpec } from "../../learning/content/reviewCards";

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
  preparedAssessmentResource: AssessmentResource | null;
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
  introductionContent: RuntimeLearningContent | null;
  /** Runtime 已从固定 Release 物化的修复内容。 */
  repairContent: RuntimeLearningContent | null;
  introductionPosition: number;
  introductionTotal: number;
  reviewAssessmentPurpose: "acquisition" | "retention";
  onExit: () => void;
  onUndo: () => void;
  onMarkKnown: () => void;
  onOpenMenuMore: RuntimeToolsProps['onOpenMenuMore'];
  reviewAssessmentKind: ReviewAssessmentKind | null;
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
  const repairContent = stage === "review_repair" ? preparedRepairContent : null;
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
  const assessmentResource: AssessmentResource | null = preparedAssessmentResource;
  const reviewSpec = useMemo(() => (
    assessmentResource && introductionContent
      ? toReviewSpec(assessmentResource, introductionContent)
      : null
  ), [assessmentResource, introductionContent]);

  const scrollToTop = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  if(!hasTask) return <RuntimeFrame id={screenId} active={active&&!isBehind} title={t('assurance.title')} stepLabel="" progress={0} onExit={onExit}>
    <h1 className="text-2xl font-medium">{t('assurance.noTask')}</h1>
    <button className="mt-8 min-h-12 rounded-control bg-action-primary px-6 text-sm text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus" onClick={onExit}>{t('assurance.back')}</button>
  </RuntimeFrame>;
  return (
    <section id={screenId} data-anim="fade" aria-hidden={!active || isBehind} className={`${fadeScreenClass(active && !isBehind, 'z-30')} flex flex-col overflow-hidden ${isIntroductionReveal ? 'is-intro-reveal' : ''}`}>
      <div className="h-4" />
      <div className="flex min-h-16 items-center gap-2 border-b border-border-subtle bg-surface-canvas/95 px-5 py-3 sm:px-8">
        <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={onExit} aria-label={t('runtime.pause')}><svg className={iconClass} width="26" height="26" aria-hidden="true"><use href="#i-chev-l"/></svg></button>
        <span className={`text-control-label font-semibold text-fg-primary ${isIntroduction ? 'rounded-pill bg-accent-soft px-3 py-1 text-fg-secondary' : ''}`} id="lhProg">{stepLabel ?? progressLabel}</span>
        <div className="ml-auto flex items-center gap-2"><RuntimeTools content={introductionContent} personalContent={personalMenuContent} showSave={!isExperienceHidden}
          onUndo={!isIntroduction && !isReviewStage ? onUndo : undefined} canUndo={step > 1} onMarkKnown={onMarkKnown}
          onOpenMenuMore={onOpenMenuMore} toast={host.toast} busy={busy}/></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:thin]" id={screenId === 's-learn' ? 'lScroll' : undefined} ref={scrollRef}>
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
