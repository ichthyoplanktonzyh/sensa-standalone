import type { RuntimePersonalContent } from '../stores/overlayStore';
import type { LearningSceneEditorTarget } from '../stores/overlayStore';
import type { CardExecution } from '../components/cards/CardExecution';
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
import type { ReactNode } from 'react';
import type {
  LearningStepKind,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  RepairResourceReference,
} from '../../learning/engine/types';
import type { Word, QuickDictEntry, DictionaryLookup } from '../types';
import type { RuntimeLearningContent } from '../../learning/content/learningCatalog';
import type { AssessmentResource } from '../../learning/content/assessmentResources';
import { IntroductionCard, type IntroductionPhase } from '../components/cards/IntroductionCard';
import { RecognitionCard } from '../components/cards/RecognitionCard';
import { RecallCard } from '../components/cards/RecallCard';
import { NovelTransferCard } from '../components/cards/NovelTransferCard';
import { SensaReviewAssessmentCard } from '../components/cards/review/SensaReviewAssessmentCard';
import { SensaReviewFeedbackCard } from '../components/cards/review/SensaReviewFeedbackCard';
import { ExperienceRecallCard } from '../components/cards/lightweight/ExperienceRecallCard';
import { ExpressionRevealCard } from '../components/cards/lightweight/ExpressionRevealCard';
import type {
  LightweightInitialCardPresentation,
} from './lightweightInitialPresentation';
import type { PersonalLearningSceneRevision } from '../../data/library/contentAnnotations';
import type {
  LightweightInitialRating,
  LightweightProtocolStepInstance,
} from '../../learning/runtime/lightweightInitialProtocol';
import type {
  ReviewAssessmentResult,
  ReviewAssessmentSpec,
} from '../../learning/review/types';

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
  readonly openDict: (word: Word | QuickDictEntry | string, tab?: string) => void;
  readonly openNoteEditor: (
    word: Word | QuickDictEntry | string,
    senseId?: string,
    meaning?: string,
  ) => void;
  readonly openSceneEditor: (
    content: RuntimePersonalContent,
    anchorId?: string,
    learningTarget?: LearningSceneEditorTarget,
  ) => void;
  readonly lookupDictionary: DictionaryLookup;
  readonly completeIntroduction: () => void;
  readonly completeRecognition: (correct: boolean) => void;
  readonly completeMeaningToFormRecall: (outcome: MeaningToFormRecallOutcome) => void;
  readonly completeNovelTransfer: (outcome: NovelTransferOutcome) => void;
  readonly completeReviewAssessment: (result: ReviewAssessmentResult) => void;
  readonly continueReviewFeedback: () => void;
}

/** 评测属于首学取证还是到期复习；讲解卡的修复回放也用它选文案。 */
export type StepAssessmentPurpose = 'acquisition' | 'retention';

/** 渲染一步要的全部输入。数据由宿主屏物化好，适配函数不再推导。 */
export interface StepRendererProps {
  readonly execution?: CardExecution;
  /** 编排盖的章（`OrchestratedStepDefinition.stepKind`）。 */
  readonly stepKind: LearningStepKind;
  /** 这一步在会话里的序号，进各卡的 remount key。 */
  readonly ordinal: number;
  readonly curWord: Word;
  /** 讲解包投影：讲解/识别/回想/迁移/评测共用它作为内容面。 */
  readonly content: RuntimeLearningContent | null;
  /** 宿主屏物化好的修复内容（含 resourceRef 现场物化的回退）。 */
  readonly repairContent: RuntimeLearningContent | null;
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
  readonly personalScene?: PersonalLearningSceneRevision | null;
  readonly onOpenPersonalScene?: () => void;
  readonly semanticWorldState?: 'available' | 'update' | 'saved' | 'saving' | null;
  readonly onSaveToSemanticWorld?: () => void;
}

export type StepRenderer<TProps = StepRendererProps> = (props: TProps) => ReactNode;

export interface StepRendererDefinition {
  readonly stepKind: LearningStepKind;
  /** Concrete props are recovered by the registered caller through get<TProps>. */
  readonly render: StepRenderer<never>;
}

/* ============================================================
   内置七种：落地前 LearnScreen 的七个分支，逐字搬来当适配函数
   ============================================================ */

/** 守卫对应落地前的 `isIntroduction = stage === 'introduction' && !!introductionContent`。 */
const renderIntroduction = (props: StepRendererProps): ReactNode => {
  const { content, curWord, host } = props;
  if (!content) return null;
  return (
    <IntroductionCard
      content={content}
      phase={props.phase}
      onPhaseChange={props.onPhaseChange}
      onComplete={props.execution?.continue ?? host.completeIntroduction}
      onOpenExample={(sentenceIndex = 0) => host.openExample(0, sentenceIndex)}
      onOpenDictionary={(word) => host.openDict(word ?? curWord)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      lookupDictionary={host.lookupDictionary}
      toast={host.toast}
    />
  );
};

/** 守卫对应落地前的 `isRepair = stage === 'review_repair' && !!repairContent`。 */
const renderReviewRepair = (props: StepRendererProps): ReactNode => {
  const { repairContent, repairResourceRef, host } = props;
  if (!repairContent) return null;
  return (
    <IntroductionCard
      key={`${repairContent.senseKey}:${repairResourceRef?.role}:${repairResourceRef?.key}`}
      content={repairContent}
      phase={props.phase}
      mode="repair_replay"
      repairPurpose={props.purpose}
      onPhaseChange={props.onPhaseChange}
      onComplete={props.execution?.continue ?? host.completeIntroduction}
      onOpenExample={(sentenceIndex = 0) => host.openExample(0, sentenceIndex)}
      onOpenDictionary={(word) => host.openDict(word ?? props.curWord)}
      onOpenNote={() => host.openNoteEditor(
        repairContent.lemma,
        repairContent.senseKey,
        repairContent.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(repairContent, anchorId)}
      lookupDictionary={host.lookupDictionary}
      toast={host.toast}
    />
  );
};

/** 守卫对应落地前的 `isRecognition && assessmentResource?.kind === 'context_recognition'`。 */
const renderRecognition = (props: StepRendererProps): ReactNode => {
  const { content, ordinal, assessmentResource, host } = props;
  if (!content || !assessmentResource || assessmentResource.kind !== 'context_recognition') {
    return null;
  }
  return (
    <RecognitionCard
      execution={props.execution}
      purpose={props.purpose}
      key={`${content.senseKey}:${assessmentResource.taskKey}:${ordinal}`}
      content={content}
      assessment={assessmentResource}
      onComplete={host.completeRecognition}
      onOpenDictionary={(word) => host.openDict(word)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      lookupDictionary={host.lookupDictionary}
      onViewChange={props.onCardViewChange}
      toast={host.toast}
    />
  );
};

/** 守卫对应落地前的 `isMeaningToFormRecall && assessmentResource?.kind === 'meaning_to_form_recall'`。 */
const renderRecall = (props: StepRendererProps): ReactNode => {
  const { content, ordinal, assessmentResource, host } = props;
  if (!content || !assessmentResource || assessmentResource.kind !== 'meaning_to_form_recall') {
    return null;
  }
  return (
    <RecallCard
      execution={props.execution}
      purpose={props.purpose}
      key={`${content.senseKey}:${assessmentResource.taskKey}:${ordinal}`}
      content={content}
      assessment={assessmentResource}
      onComplete={host.completeMeaningToFormRecall}
      onOpenDictionary={(word) => host.openDict(word)}
      onOpenExample={() => host.openExample(0, 0)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      onViewChange={props.onCardViewChange}
      toast={host.toast}
    />
  );
};

/** 守卫对应落地前的 `isNovelTransfer && assessmentResource?.kind === 'novel_context_transfer'`。 */
const renderTransfer = (props: StepRendererProps): ReactNode => {
  const { content, ordinal, assessmentResource, host } = props;
  if (!content || !assessmentResource || assessmentResource.kind !== 'novel_context_transfer') {
    return null;
  }
  return (
    <NovelTransferCard
      execution={props.execution}
      purpose={props.purpose}
      key={`${content.senseKey}:${assessmentResource.taskKey}:${ordinal}`}
      content={content}
      assessment={assessmentResource}
      onComplete={host.completeNovelTransfer}
      onOpenDictionary={(word) => host.openDict(word)}
      onOpenExample={() => host.openExample(0, 0)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      lookupDictionary={host.lookupDictionary}
      onViewChange={props.onCardViewChange}
      toast={host.toast}
    />
  );
};

/**
 * 守卫对应落地前的 `isReviewAssessment && reviewSpec`。`reviewSpec` 的 memo
 * 已经要求 content/kind/taskKey 齐备，`assessmentResource` 在同一条件下由
 * memo 保证非空（缺身份时会先抛错），这里三查只是把落地前 `!` 断言写成守卫。
 */
const renderReviewAssessment = (props: StepRendererProps): ReactNode => {
  const { content, ordinal, assessmentResource, reviewSpec, host } = props;
  if (!content || !reviewSpec || !assessmentResource) return null;
  return (
    <SensaReviewAssessmentCard
      key={`${content.senseKey}:${reviewSpec.id}:${ordinal}:sensa`}
      content={content}
      spec={reviewSpec}
      assessmentResource={assessmentResource}
      purpose={props.purpose}
      onSubmit={props.execution ? result => props.execution!.submit(result.responseId) : host.completeReviewAssessment}
      onOpenDictionary={(word) => host.openDict(word)}
      onOpenExample={() => host.openExample(0, 0)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      lookupDictionary={host.lookupDictionary}
      onViewChange={props.onCardViewChange}
      toast={host.toast}
    />
  );
};

/** 守卫对应落地前的 `isReviewFeedback && reviewSpec && reviewAssessmentResult`。 */
const renderReviewFeedback = (props: StepRendererProps): ReactNode => {
  const { content, ordinal, assessmentResource, reviewSpec, reviewAssessmentResult, host } = props;
  if (!content || !reviewSpec || !assessmentResource || !reviewAssessmentResult) return null;
  return (
    <SensaReviewFeedbackCard
      key={`${content.senseKey}:${reviewSpec.id}:feedback:${ordinal}:sensa`}
      content={content}
      spec={reviewSpec}
      assessmentResource={assessmentResource}
      result={reviewAssessmentResult}
      onContinue={props.execution?.continue ?? host.continueReviewFeedback}
      purpose={props.purpose}
      onOpenDictionary={(word) => host.openDict(word)}
      lookupDictionary={host.lookupDictionary}
      onOpenExample={() => host.openExample(0, 0)}
      onOpenNote={() => host.openNoteEditor(
        content.lemma,
        content.senseKey,
        content.guideLabelL1,
      )}
      onOpenScene={(anchorId) => host.openSceneEditor(content, anchorId)}
      onViewChange={props.onCardViewChange}
      toast={host.toast}
    />
  );
};

const renderLightweightExperienceRecall = (
  props: LightweightInitialStepRendererProps,
): ReactNode => {
  if (props.presentation.kind !== 'experience_recall') {
    throw new Error(`Experience Recall renderer received ${props.presentation.kind}.`);
  }
  return (
    <ExperienceRecallCard
      key={props.step.protocolStepInstanceId}
      presentation={props.presentation}
      personalScene={props.personalScene}
      onOpenPersonalScene={props.onOpenPersonalScene}
      onReveal={props.onReveal}
    />
  );
};

const renderLightweightExpressionReveal = (
  props: LightweightInitialStepRendererProps,
): ReactNode => {
  if (props.presentation.kind !== 'expression_reveal') {
    throw new Error(`Expression Reveal renderer received ${props.presentation.kind}.`);
  }
  return (
    <ExpressionRevealCard
      key={props.step.protocolStepInstanceId}
      presentation={props.presentation}
      personalScene={props.personalScene}
      onOpenPersonalScene={props.onOpenPersonalScene}
      semanticWorldState={props.semanticWorldState}
      onSaveToSemanticWorld={props.onSaveToSemanticWorld}
      onRate={props.onRate}
    />
  );
};

export const BUILTIN_STEP_RENDERERS: readonly StepRendererDefinition[] = [
  { stepKind: 'introduction', render: renderIntroduction },
  { stepKind: 'recognition', render: renderRecognition },
  { stepKind: 'recall', render: renderRecall },
  { stepKind: 'transfer', render: renderTransfer },
  { stepKind: 'review_assessment', render: renderReviewAssessment },
  { stepKind: 'review_feedback', render: renderReviewFeedback },
  { stepKind: 'review_repair', render: renderReviewRepair },
  { stepKind: 'lightweight_experience_recall', render: renderLightweightExperienceRecall },
  { stepKind: 'lightweight_expression_reveal', render: renderLightweightExpressionReveal },
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
        throw new Error(`Duplicate step renderer registration: ${definition.stepKind}`);
      }
      seen.add(definition.stepKind);
    }
    this.#renderers = new Map(definitions.map((definition) => [definition.stepKind, definition.render]));
  }

  public get<TProps = StepRendererProps>(stepKind: LearningStepKind): StepRenderer<TProps> {
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

export const stepRendererRegistry = new StepRendererRegistry(BUILTIN_STEP_RENDERERS);
