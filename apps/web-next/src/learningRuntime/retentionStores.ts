/**
 * 长期保持事实存在哪 —— Retention Store。
 *
 * 落地前，"这条 Target 的长期状态怎么读写"是靠 surface 名字回答的：
 *
 *     runtimeSurfaceForPolicy(policy, 'retention_review') === 'structured_session'
 *
 * 这个判断在 `App.tsx` 与 `journeyState.ts` 里出现过九次，每次都在问同一件事，
 * 但问错了对象。surface 是"用哪块界面跑"，这些调用点要知道的却是
 * **Memory State 归谁持有**。两者今天一一对应，只因为现在恰好只有两个 Runtime
 * Adapter；再加一个复用 FSRS 的界面（比如拼写产出），九处判断会同时说谎。
 *
 * 所以把问题换成：这条 Target 的长期保持事实存在哪个 store。store 由 retention
 * 的 Runtime Adapter 声明，与界面无关；新增 surface 若复用既有 store，这九处
 * 一处都不用改。
 *
 * 两个实现的**写入路径不对称**，这里不掩盖它：
 *
 *  - `scheduler_memory` 的事实由 `storageService` 的 FSRS items 持有，可命令式写；
 *  - `fixed_ladder` 的事实是 journey 记录里的 `lightweightRetention` 字段，
 *    只能由 reducer 自己落。
 *
 * 因此 store 只声明**接收 Scheduling Handoff 时给出什么首次到期投影**，
 * 落库动作留在各自宿主里。宿主能力由 `RetentionStoreContext` 注入：App 传
 * storageService，reducer 传 action 里那份 `dueBySenseId`——同一份 store 定义
 * 因此在命令式与纯函数两边都能用，这也是它能被 smoke 逐条断言的原因。
 */

/** 长期保持事实的持有者。由 retention 的 Runtime Adapter 声明。 */
export type RetentionStoreId =
  /** 调度器（FSRS）持有 Memory State，到期时间由它算。 */
  | 'scheduler_memory'
  /** journey 记录持有一条固定档期，不进调度器。 */
  | 'fixed_ladder';

/** 还没有真实到期时间时的占位文案。原型阶段"立即可复习"就是这个意思。 */
export const IMMEDIATE_REVIEW_LABEL = '现在可复习（原型）';

/** 首次到期在界面上的投影。Handoff 的产物，不是 store 的内部状态。 */
export interface RetentionHandoffProjection {
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
}

/**
 * store 接收交接时需要的宿主能力。
 *
 * `openSchedulerDue` 返回 null 有两种情形，对 store 而言等价：这条 Target 没有
 * runtime Sense，或调用点这次没带来到期时间。两种都退回"现在可复习"。
 */
export interface RetentionStoreContext {
  /** 交接发生的时刻（ISO）。拿不到到期时间时以它为准。 */
  readonly completedAt: string;
  /** 打开（或读取已有的）调度记忆，返回到期毫秒；null 表示没有。 */
  readonly openSchedulerDue: () => number | null;
  /** 把到期毫秒变成界面文案。 */
  readonly reviewLabel: (dueAt: number) => string;
}

export interface RetentionStoreDefinition {
  readonly storeId: RetentionStoreId;
  /**
   * 交接时是否需要 journey 记录自己开一条固定档期。
   *
   * 这不是 `storeId === 'fixed_ladder'` 的同义反复：它声明的是"本 store 的状态
   * 由 reducer 持有"这一事实，reducer 据此决定要不要落一条初始记录。
   */
  readonly opensJourneyLadder: boolean;
  /** 接收 Scheduling Handoff，给出首次到期投影。 */
  readonly openHandoff: (ctx: RetentionStoreContext) => RetentionHandoffProjection;
}

const immediateHandoff = (ctx: RetentionStoreContext): RetentionHandoffProjection => ({
  nextReviewAt: ctx.completedAt,
  nextReviewLabel: IMMEDIATE_REVIEW_LABEL,
});

const fixedLadderStore: RetentionStoreDefinition = {
  storeId: 'fixed_ladder',
  opensJourneyLadder: true,
  // 固定档期从"现在"起算，不问调度器。
  openHandoff: immediateHandoff,
};

const schedulerMemoryStore: RetentionStoreDefinition = {
  storeId: 'scheduler_memory',
  opensJourneyLadder: false,
  openHandoff: (ctx) => {
    const dueAt = ctx.openSchedulerDue();
    if (dueAt === null) return immediateHandoff(ctx);
    return {
      nextReviewAt: new Date(dueAt).toISOString(),
      nextReviewLabel: ctx.reviewLabel(dueAt),
    };
  },
};

export const RETENTION_STORE_DEFINITIONS = [
  fixedLadderStore,
  schedulerMemoryStore,
] as const satisfies readonly RetentionStoreDefinition[];

export class RetentionStoreRegistry {
  readonly #definitions: ReadonlyMap<RetentionStoreId, RetentionStoreDefinition>;

  public constructor(
    definitions: readonly RetentionStoreDefinition[] = RETENTION_STORE_DEFINITIONS,
  ) {
    this.#definitions = new Map(definitions.map((definition) => [definition.storeId, definition]));
  }

  public get(storeId: RetentionStoreId): RetentionStoreDefinition {
    const definition = this.#definitions.get(storeId);
    if (!definition) throw new Error(`Unknown Retention Store: ${storeId}`);
    return definition;
  }
}

export const retentionStoreRegistry = new RetentionStoreRegistry();
