import { AssuranceCard } from "../components/learning/AssuranceCard";
import { runtimeCheckpoint } from "./runtimeCheckpoint";
/**
 * Step renderer 注册表：`stepKind → 组件`。
 *
 * `stepKind` 轴落地之后，"这一步渲染哪张卡"只剩查表——但落地前这段查表
 * 长在 `LearnScreen` 里，是七个 `stage === '…'` 分支：每个分支内联一张卡、
 * 再各配一遍字典/笔记/场景/例句的接线。注册表把它搬过来之后：
 *
 *  - 新增一种卡 = 注册一条 definition，`LearnScreen` 与 `App.tsx` 都不动；
 *  - 闭合发生在注册表而不是类型：`LearningStepKind` 对插件开放
 *    （`string & {}`），查不到 renderer 直接抛错，不静默渲染空白——
 *    `engine/types.ts` 的注释说的就是这个落点；
 *  - 卡片组件零改动：每条 definition 是一个**纯适配函数**，把统一的
 *    `StepRendererProps` 接线成某张卡自己的 props。`onOpenExample` 的签名
 *    差异（讲解卡带 `sentenceIndex`、评测卡固定 `(0, 0)`）这类事实，落地前
 *    散在七个分支里，现在由每个适配函数自己声明。
 *
 * `StepRendererHost` 是结构化卡片的宿主能力面，与 `RuntimeSurfaceContext` 同一角色：
 * App 提供一份、所有卡共用。`LearnScreen` 落地前的三十余个 prop 里凡是
 * 卡片要的，都收进这份合同；屏幕自己的工具栏回调（退出/撤回/声明已会/
 * 更多/拼写）不进合同——那是屏的接口，不是卡的。
 *
 * Lightweight Initial 也从同一注册表查两个 renderer，但使用自己更小的 props
 * interface；注册表擦除不同 renderer 的具体 props，而每个调用方在 get 时恢复
 * 自己的类型。Lightweight Retention 仍是待迁移的固定相位屏。
 */
import type { ReactNode } from "react";
import type {
  LearningStepKind,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  RepairResourceReference,
} from "../engine/types";
import type { Word, QuickDictEntry, DictionaryLookup } from "../types";
import type { PrototypeIntroductionPackage } from "../content/learningCatalog";
import type { AssessmentResource } from "../content/assessmentResources";
import type { IntroductionPhase } from "../components/cards/IntroductionCard";
import { ExperienceRecallCard } from "../components/cards/lightweight/ExperienceRecallCard";
import { ExpressionRevealCard } from "../components/cards/lightweight/ExpressionRevealCard";
import type { LightweightInitialCardPresentation } from "./lightweightInitialPresentation";
import type {
  LightweightInitialRating,
  LightweightProtocolStepInstance,
} from "./lightweightInitialProtocol";
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
} from "../review/types";

/**
 * 宿主提供给卡片的能力面。
 *
 * 每个字段都是一次完整的领域操作或一次环境打开动作；卡片只管调用，
 * 不管它背后是 overlay store 还是回调链。签名按卡片侧的最宽需要声明，
 * 适配函数负责把窄签名接线成它。
 */
export interface StepRendererHost {
  readonly toast: (message: string) => void;
  readonly openExample: (senseIdx: number, sentenceIdx?: number) => void;
  readonly openDict: (
    word: Word | QuickDictEntry | string,
    tab?: string,
  ) => void;
  readonly openNoteEditor: (
    word: Word | QuickDictEntry | string,
    senseId?: string,
    meaning?: string,
  ) => void;
  readonly openSceneEditor: (
    content: PrototypeIntroductionPackage,
    anchorId?: string,
  ) => void;
  readonly lookupDictionary: DictionaryLookup;
  readonly completeIntroduction: () => void;
  readonly completeRecognition: (correct: boolean) => void;
  readonly completeMeaningToFormRecall: (
    outcome: MeaningToFormRecallOutcome,
  ) => void;
  readonly completeNovelTransfer: (outcome: NovelTransferOutcome) => void;
  readonly completeReviewAssessment: (result: ReviewAssessmentResult) => void;
  readonly continueReviewFeedback: () => void;
}

/** 评测属于首学取证还是到期复习；讲解卡的修复回放也用它选文案。 */
export type StepAssessmentPurpose = "acquisition" | "retention";

/** 渲染一步要的全部输入。数据由宿主屏物化好，适配函数不再推导。 */
export interface StepRendererProps {
  /** 编排盖的章（`OrchestratedStepDefinition.stepKind`）。 */
  readonly stepKind: LearningStepKind;
  /** 这一步在会话里的序号，进各卡的 remount key。 */
  readonly ordinal: number;
  readonly curWord: Word;
  /** 讲解包投影：讲解/识别/回想/迁移/评测共用它作为内容面。 */
  readonly content: PrototypeIntroductionPackage | null;
  /** 宿主屏物化好的修复内容（含 resourceRef 现场物化的回退）。 */
  readonly repairContent: PrototypeIntroductionPackage | null;
  readonly repairResourceRef: RepairResourceReference | null;
  /** 讲解与修复回放共用的相位，由宿主屏持有。 */
  readonly phase: IntroductionPhase;
  readonly onPhaseChange: (phase: IntroductionPhase) => void;
  /** 评测材料：宿主屏 memo 好的 Assessment Resource。 */
  readonly assessmentResource: AssessmentResource | null;
  /** 到期复习的题目（含 boundary），宿主屏 memo 好的 spec。 */
  readonly reviewSpec: ReviewAssessmentSpec | null;
  /** 结算结果；只在反馈相位非空。 */
  readonly reviewAssessmentResult: ReviewAssessmentResult | null;
  readonly purpose: StepAssessmentPurpose;
  /** 卡片切内部视图时把滚动容器归零；宿主屏的滚动行为。 */
  readonly onCardViewChange: () => void;
  readonly host: StepRendererHost;
}

export interface LightweightInitialStepRendererProps {
  readonly step: LightweightProtocolStepInstance;
  readonly presentation: LightweightInitialCardPresentation;
  readonly onReveal: () => void;
  readonly onRate: (rating: LightweightInitialRating) => void;
}

export type StepRenderer<TProps = StepRendererProps> = (
  props: TProps,
) => ReactNode;

export interface StepRendererDefinition {
  readonly stepKind: LearningStepKind;
  /** Concrete props are recovered by the registered caller through get<TProps>. */
  readonly render: StepRenderer<never>;
}

const renderLightweightExperienceRecall = (
  props: LightweightInitialStepRendererProps,
): ReactNode => {
  if (props.presentation.kind !== "experience_recall") {
    throw new Error(
      `Experience Recall renderer received ${props.presentation.kind}.`,
    );
  }
  return (
    <ExperienceRecallCard
      key={props.step.protocolStepInstanceId}
      presentation={props.presentation}
      onReveal={props.onReveal}
    />
  );
};

const renderLightweightExpressionReveal = (
  props: LightweightInitialStepRendererProps,
): ReactNode => {
  if (props.presentation.kind !== "expression_reveal") {
    throw new Error(
      `Expression Reveal renderer received ${props.presentation.kind}.`,
    );
  }
  return (
    <ExpressionRevealCard
      key={props.step.protocolStepInstanceId}
      presentation={props.presentation}
      onRate={props.onRate}
    />
  );
};

const renderAssurance = (props: StepRendererProps): ReactNode => {
  const key = [
    runtimeCheckpoint.read().structuredGeneration ?? 0,
    props.purpose,
    props.stepKind,
    props.content?.packageKey,
    props.assessmentResource?.taskKey,
    props.ordinal,
  ].join(":");
  return <AssuranceCard key={key} draftKey={key} {...props} />;
};

export const BUILTIN_STEP_RENDERERS: readonly StepRendererDefinition[] = [
  { stepKind: "introduction", render: renderAssurance },
  { stepKind: "recognition", render: renderAssurance },
  { stepKind: "recall", render: renderAssurance },
  { stepKind: "transfer", render: renderAssurance },
  { stepKind: "review_assessment", render: renderAssurance },
  { stepKind: "review_feedback", render: renderAssurance },
  { stepKind: "review_repair", render: renderAssurance },
  {
    stepKind: "lightweight_experience_recall",
    render: renderLightweightExperienceRecall,
  },
  {
    stepKind: "lightweight_expression_reveal",
    render: renderLightweightExpressionReveal,
  },
];

/**
 * 注册表本体。闭合在这里完成：`get` 查不到就抛错——一个编排盖出了没有
 * renderer 的章，是建模错误，渲染成空白只会把问题藏到测试之外。
 */
export class StepRendererRegistry {
  readonly #renderers: ReadonlyMap<string, StepRenderer<never>>;

  public constructor(definitions: readonly StepRendererDefinition[]) {
    const seen = new Set<string>();
    for (const definition of definitions) {
      if (seen.has(definition.stepKind)) {
        throw new Error(
          `Duplicate step renderer registration: ${definition.stepKind}`,
        );
      }
      seen.add(definition.stepKind);
    }
    this.#renderers = new Map(
      definitions.map((definition) => [definition.stepKind, definition.render]),
    );
  }

  public get<TProps = StepRendererProps>(
    stepKind: LearningStepKind,
  ): StepRenderer<TProps> {
    const render = this.#renderers.get(stepKind);
    if (!render) {
      throw new Error(`Unknown step kind, no renderer registered: ${stepKind}`);
    }
    return render as unknown as StepRenderer<TProps>;
  }

  public has(stepKind: LearningStepKind): boolean {
    return this.#renderers.has(stepKind);
  }

  public listStepKinds(): readonly string[] {
    return [...this.#renderers.keys()];
  }
}

export const stepRendererRegistry = new StepRendererRegistry(
  BUILTIN_STEP_RENDERERS,
);
