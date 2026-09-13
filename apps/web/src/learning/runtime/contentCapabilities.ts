/**
 * 内容能力（Content Capability）与它的 readiness。
 *
 * 落地前 `contentRequirement` 是二选一枚举：一个 Protocol Binding 要么要"紧凑材料"，
 * 要么要"结构化学习包"。这个形状挡住了扩展——能力目标之间会**共享**内容能力
 * （听辨与听写都需要音频），二选一无法表达"我要这两样"。
 *
 * 因此需求改为一组能力，readiness 是这组能力的**合取**：任一条没就绪，整组就没就绪。
 * 报的是最坏那条自己的 view，学习者才知道缺的是什么。
 *
 * readiness 是 **Learning Target 级的事实、scope 级的投影**：内容属于 Target
 * （音频是这个词的音频），每个 scope 只对自己声明的子集求合取。因此供给方是
 * 按 Target 建的一个 provider，而不是按 scope 建的一张表。
 *
 * ## 两个字段不是一回事
 *
 * `view.status` 是**声明的准备状态**，会被 journey 记录下来、并被"刷新准备状态"推进；
 * `provisioned` 是**供给事实**：这条能力到底有没有可执行的内容。二者可以不一致，
 * 而且必须允许不一致——紧凑材料按需生成，"还在准备"也照样跑得起来；结构化学习包
 * 没有就是没有，声明成 ready 也变不出来。调度只能信 `view`，启动只能信 `provisioned`。
 */

export type LearningReadiness = 'ready' | 'preparing' | 'blocked';

export interface LearningReadinessView {
  status: LearningReadiness;
  label: string;
  detail: string;
}

/** 对扩展开放；生产 composition root 会闭合当前可用的能力 identity。 */
export type ContentCapabilityId = string & {};

/**
 * 一个 Protocol Binding 声明的内容能力集合。
 *
 * 类型上就是非空的：不声明任何内容能力的 binding 是建模错误，不是"永远就绪"。
 * 用非空元组挡在编译期，省掉一处运行时抛错。
 */
export type ContentCapabilitySet = readonly [ContentCapabilityId, ...ContentCapabilityId[]];

export interface ContentCapabilityReadiness {
  /** 声明状态。可被 journey 覆盖，用来驱动界面与"能不能排进今天"。 */
  readonly view: LearningReadinessView;
  /** 供给事实。声明状态改不了它，用来决定这次运行建不建得起来。 */
  readonly provisioned: boolean;
  /** 有供给时必须记录实际冻结的内容身份；未供给时必须为 null。 */
  readonly materializationId: string | null;
}

export interface ContentCapabilityResolution {
  readonly view: LearningReadinessView;
  readonly provisioned: boolean;
  /** 按 Binding 声明顺序排列；用于 Protocol Run 固定实际内容 provenance。 */
  readonly materializationIds: readonly string[];
}

/** 按 Learning Target 建好的供给方：问它某条能力在这条 Target 上的状况。 */
export type ContentCapabilityReadinessProvider =
  (capabilityId: ContentCapabilityId) => ContentCapabilityReadiness;

const READINESS_SEVERITY: Record<LearningReadiness, number> = {
  ready: 0,
  preparing: 1,
  blocked: 2,
};

/**
 * 两个 readiness 里更坏的那个。相同严重度时保留左边——调用方按声明顺序 reduce，
 * 于是"并列最坏"取最先声明的那条，这也是合取报错时最该先说的那条。
 */
export const worseReadinessView = (
  left: LearningReadinessView,
  right: LearningReadinessView,
): LearningReadinessView =>
  READINESS_SEVERITY[right.status] > READINESS_SEVERITY[left.status] ? right : left;

/** 一组内容能力的合取。 */
export const conjoinContentCapabilities = (
  capabilities: ContentCapabilitySet,
  provider: ContentCapabilityReadinessProvider,
): ContentCapabilityResolution => {
  const readinesses = capabilities.map(provider);
  for (const readiness of readinesses) {
    if (readiness.provisioned !== (readiness.materializationId !== null)) {
      throw new Error('Content provisioning fact and Materialization identity disagree.');
    }
  }
  return {
    view: readinesses
      .map((readiness) => readiness.view)
      .reduce(worseReadinessView),
    provisioned: readinesses.every((readiness) => readiness.provisioned),
    materializationIds: readinesses.flatMap((readiness) =>
      readiness.materializationId !== null ? [readiness.materializationId] : []),
  };
};

/** 集合相等：声明顺序不构成差异，重复声明也不构成差异。 */
export const sameContentCapabilitySet = (
  left: ContentCapabilitySet,
  right: ContentCapabilitySet,
): boolean => {
  const leftSet = new Set<ContentCapabilityId>(left);
  const rightSet = new Set<ContentCapabilityId>(right);
  return leftSet.size === rightSet.size
    && [...leftSet].every((capabilityId) => rightSet.has(capabilityId));
};
