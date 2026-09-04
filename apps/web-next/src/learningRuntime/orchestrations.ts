/**
 * 编排登记表 —— 每套编排产出哪些 intent 的 Step，以及它的首学出口交出什么依据。
 *
 * 落地前，"首学完成时交出的是哪种依据"是靠 surface 名字回答的：
 *
 *     surfaceFor(policy, 'initial_learning') !== 'structured_session'
 *
 * 这句判断问的是**用哪块屏跑**，要的却是**这套编排取不取证**。两者今天一一
 * 对应，只因为恰好只有结构化首学会出 assessment 步。加一条跑在轻量界面上、
 * 但确实取证的编排（或者反过来），它立刻说谎——而说谎的后果是一次
 * Scheduling Handoff 记错依据，且 Handoff 一生只发生一次，改不回来。
 *
 * 领域上 Completion、Scheduling Handoff basis 与 Evidence level 是三条独立轴。
 * `assessment` 只是编排可能取证的必要条件，不能反向推出本次运行已经满足哪一种
 * completion。每套首学编排因此必须显式声明完整出口合同；Registry 只校验明显矛盾，
 * 不替协议猜语义。
 *
 * 声明不是注释：`smoke:orchestration` 拿真实内容跑一遍队列驱动的两套编排，
 * 收集实际产出的 intent，逐条核对它等于这里写的。
 */
import type { LearningStepIntent } from '../engine/types';
import type { LearningStepKind } from '../engine/types';
import type { OrchestrationId } from '../engine/stepOrchestration';

export type { OrchestrationId } from '../engine/stepOrchestration';

export type InitialLearningCompletionKind =
  | 'study_completion'
  | 'acquisition_graduation'
  | 'imported_completion';

/** 首批允许初始化长期调度的依据闭集。 */
export type SchedulingHandoffBasis =
  | 'protocol_completion'
  | 'acquisition_graduation'
  | 'learner_rating'
  | 'imported';

export type LearningEvidenceLevel =
  | 'non_evidentiary'
  | 'self_report'
  | 'behavioral'
  | 'externally_attested';

export interface InitialCompletionContract {
  readonly completionKind: InitialLearningCompletionKind;
  readonly protocolOutcome: string;
  readonly handoffBasis: SchedulingHandoffBasis;
  readonly evidenceLevel: LearningEvidenceLevel;
  readonly learnerVisibleClaim: string;
}

export interface OrchestrationDefinition {
  readonly orchestrationId: OrchestrationId;
  /** 这套编排会产出哪些 intent 的 Step。领域闭集，见 `LearningStepIntent`。 */
  readonly stepIntents: readonly LearningStepIntent[];
  /** 本编排运行时可能要求宿主渲染的 Step 形式（含结算后 feedback 相位）。 */
  readonly requiredStepKinds: readonly LearningStepKind[];
  /** 仅首学编排非空；完成、交接和证据不能从 step/surface 名字推断。 */
  readonly initialCompletion: InitialCompletionContract | null;
}

export const initialCompletionContractOf = (
  definition: OrchestrationDefinition,
): InitialCompletionContract => {
  if (!definition.initialCompletion) {
    throw new Error(`Orchestration ${definition.orchestrationId} is not an initial-learning protocol.`);
  }
  return definition.initialCompletion;
};

const lightweightStudy: OrchestrationDefinition = {
  orchestrationId: 'lightweight_study',
  // 场景 → 回想 → 揭晓。回想那一步是 practice：学习者自评，评语只作为
  // 完成记录留档，既不进 Gate 也不改排期——练，但不取证。
  stepIntents: ['instruction', 'practice'],
  requiredStepKinds: [],
  initialCompletion: {
    completionKind: 'study_completion',
    protocolOutcome: 'study_completed',
    handoffBasis: 'protocol_completion',
    evidenceLevel: 'non_evidentiary',
    learnerVisibleClaim: '已完成首次学习并进入长期复习；不表示已经独立回忆或掌握。',
  },
};

const lightweightRetention: OrchestrationDefinition = {
  orchestrationId: 'lightweight_retention',
  // 自评一次到期复习（落在固定档期上），失败时再出一次不取证的定向修复。
  stepIntents: ['assessment', 'repair'],
  requiredStepKinds: [],
  initialCompletion: null,
};

const structuredAcquisition: OrchestrationDefinition = {
  orchestrationId: 'structured_acquisition',
  stepIntents: ['instruction', 'assessment', 'repair'],
  requiredStepKinds: [
    'introduction',
    'recognition',
    'recall',
    'transfer',
    'review_assessment',
    'review_repair',
  ],
  initialCompletion: {
    completionKind: 'acquisition_graduation',
    protocolOutcome: 'independently_verified',
    handoffBasis: 'acquisition_graduation',
    evidenceLevel: 'behavioral',
    learnerVisibleClaim: '已满足当前首次学习协议的独立行为要求；不表示永久掌握。',
  },
};

const structuredRetention: OrchestrationDefinition = {
  orchestrationId: 'structured_retention',
  stepIntents: ['assessment', 'repair'],
  requiredStepKinds: ['review_assessment', 'review_feedback', 'review_repair'],
  initialCompletion: null,
};

const interleavedFourStageAcquisition: OrchestrationDefinition = {
  orchestrationId: 'interleaved_four_stage_acquisition',
  // Detail is the feedback phase of the settled assessment; a failed detail
  // completes repair instruction but never grants Checkpoint credit.
  stepIntents: ['assessment', 'repair'],
  requiredStepKinds: [],
  initialCompletion: {
    completionKind: 'study_completion',
    protocolOutcome: 'four_stage_run_completed',
    handoffBasis: 'protocol_completion',
    // Two stages are learner self-report, so this Profile must not borrow the
    // behavioral assurance claim of Structured Acquisition.
    evidenceLevel: 'self_report',
    learnerVisibleClaim: '已连续完成四阶段学习并进入长期复习；不等同于高保证能力验证。',
  },
};

const interleavedFourStageRetention: OrchestrationDefinition = {
  orchestrationId: 'interleaved_four_stage_retention',
  stepIntents: ['assessment', 'repair'],
  requiredStepKinds: [],
  initialCompletion: null,
};

export const ORCHESTRATION_DEFINITIONS = [
  lightweightStudy,
  lightweightRetention,
  structuredAcquisition,
  structuredRetention,
  interleavedFourStageAcquisition,
  interleavedFourStageRetention,
] as const satisfies readonly OrchestrationDefinition[];

export class OrchestrationRegistry {
  readonly #definitions: ReadonlyMap<OrchestrationId, OrchestrationDefinition>;

  public constructor(
    definitions: readonly OrchestrationDefinition[] = ORCHESTRATION_DEFINITIONS,
  ) {
    const orchestrationIds = new Set<OrchestrationId>();
    for (const definition of definitions) {
      if (orchestrationIds.has(definition.orchestrationId)) {
        throw new Error(`Duplicate Orchestration identity: ${definition.orchestrationId}`);
      }
      orchestrationIds.add(definition.orchestrationId);
      const completion = definition.initialCompletion;
      if (
        completion?.evidenceLevel === 'behavioral'
        && !definition.stepIntents.includes('assessment')
      ) {
        throw new Error(
          `Orchestration ${definition.orchestrationId} claims behavioral evidence without assessment.`,
        );
      }
      if (
        completion?.completionKind === 'acquisition_graduation'
        && completion.handoffBasis !== 'acquisition_graduation'
      ) {
        throw new Error(
          `Orchestration ${definition.orchestrationId} has an invalid Acquisition Graduation handoff.`,
        );
      }
    }
    this.#definitions = new Map(definitions.map((definition) => [
      definition.orchestrationId,
      definition,
    ]));
  }

  public get(orchestrationId: OrchestrationId): OrchestrationDefinition {
    const definition = this.#definitions.get(orchestrationId);
    if (!definition) throw new Error(`Unknown Orchestration: ${orchestrationId}`);
    return definition;
  }

  public list(): readonly OrchestrationDefinition[] {
    return [...this.#definitions.values()];
  }
}

export const orchestrationRegistry = new OrchestrationRegistry();
