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
 * 领域上这条依据只有一个来源：**只有 `assessment` 能产生 Evidence 与
 * Memory Outcome**（见 `engine/types.ts` 的 `LearningStepIntent`）。所以编排
 * 自己声明会产出哪些 intent，出口依据由此推出，而不是各写一个常量：
 *
 *     产出 assessment → Acquisition Graduation（取证毕业）
 *     不产出 assessment → Study Completion（学过了，但没取证）
 *
 * 声明不是注释：`smoke:orchestration` 拿真实内容跑一遍队列驱动的两套编排，
 * 收集实际产出的 intent，逐条核对它等于这里写的。
 */
import type { LearningStepIntent } from '../engine/types';
import type { OrchestrationId } from '../engine/stepOrchestration';

export type { OrchestrationId } from '../engine/stepOrchestration';

/** 首次学习完成时交给长期调度的依据。 */
export type SchedulingHandoffBasis = 'study_completion' | 'acquisition_graduation';

export interface OrchestrationDefinition {
  readonly orchestrationId: OrchestrationId;
  /** 这套编排会产出哪些 intent 的 Step。领域闭集，见 `LearningStepIntent`。 */
  readonly stepIntents: readonly LearningStepIntent[];
}

/**
 * 这套编排的首学出口交出什么依据。
 *
 * 规则只有一条，且直接从 intent 轴推出：没有 assessment 就没有 Evidence，
 * 没有 Evidence 就没有 Acquisition Graduation。
 */
export const initialHandoffBasisOf = (
  definition: OrchestrationDefinition,
): SchedulingHandoffBasis => definition.stepIntents.includes('assessment')
  ? 'acquisition_graduation'
  : 'study_completion';

const lightweightStudy: OrchestrationDefinition = {
  orchestrationId: 'lightweight_study',
  // 场景 → 回想 → 揭晓。回想那一步是 practice：学习者自评，评语只作为
  // 完成记录留档，既不进 Gate 也不改排期——练，但不取证。
  stepIntents: ['instruction', 'practice'],
};

const lightweightRetention: OrchestrationDefinition = {
  orchestrationId: 'lightweight_retention',
  // 自评一次到期复习（落在固定档期上），失败时再出一次不取证的定向修复。
  stepIntents: ['assessment', 'repair'],
};

const structuredAcquisition: OrchestrationDefinition = {
  orchestrationId: 'structured_acquisition',
  stepIntents: ['instruction', 'assessment', 'repair'],
};

const structuredRetention: OrchestrationDefinition = {
  orchestrationId: 'structured_retention',
  stepIntents: ['assessment', 'repair'],
};

export const ORCHESTRATION_DEFINITIONS = [
  lightweightStudy,
  lightweightRetention,
  structuredAcquisition,
  structuredRetention,
] as const satisfies readonly OrchestrationDefinition[];

export class OrchestrationRegistry {
  readonly #definitions: ReadonlyMap<OrchestrationId, OrchestrationDefinition>;

  public constructor(
    definitions: readonly OrchestrationDefinition[] = ORCHESTRATION_DEFINITIONS,
  ) {
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
}

export const orchestrationRegistry = new OrchestrationRegistry();
