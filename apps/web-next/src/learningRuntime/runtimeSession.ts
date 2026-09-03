/**
 * "现在跑着什么、刚跑完什么" —— 学习运行的会话状态。
 *
 * 原先是 App 里五个各自为政的 useState。它们并不独立：开一次结构化首学，
 * 调用点要记得同时清掉上一次的结算数据和还挂着的轻量运行，
 *
 *     setActiveStructuredTargetIds(ids);
 *     setStructuredRuntimeSummary(null);
 *     setActiveLightweightRuntimeTargetId(null);
 *
 * 三行写在一处，全靠人记得。规则收进 reducer 之后，新增一个入口不会漏。
 *
 * 收进 reducer 之后仍有一处说谎：字段按**当时恰好有的那两种学习方式**起名
 * （`structuredInitialTargetIds` / `lightweightInitialTargetId` /
 * `lightweightReviewTargetIds`）。加第三种 Runtime 行为就要加第三个字段，
 * 而"跑着什么"本身与是哪种方式无关。所以这里改成按**运行**记录：一条运行就是
 * "在哪块 surface 上、覆盖哪些 Target"，surface 是运行的属性，不是字段名。
 *
 * 两个槽位的形状不同，因为事实如此，不硬拧成一个：
 *
 *  - `initialRuns` 是**多条**。离开一段结构化首学去开一段轻量首学，结构化那段
 *    仍然活着——它的队列还在，回到那条 Target 要能接着跑。而且首学运行跑完
 *    也不清：结算与"继续这条 Target"都要读它。
 *  - `retentionRun` 只有**一条**。到期复习按 `planRetention` 的顺序一组一组跑，
 *    跑完一组才交接下一组，因此新的一组直接顶掉上一组。
 *
 * 结算归产出它的那次运行所有：开一次运行就把同类结算作废，跑完再写新的。
 *
 * 两个 summary 会同时存在——混合流里先复习后新学，结算页靠 flowMode 决定显示
 * 哪一个，两份数据都得留着。
 *
 * 将来接入数据层时，这里就是持久化落点：目前整份状态刷新即丢，是原型阶段的
 * 已知限制。
 */
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import type { PrototypeRuntimeSurface } from './runtimeCoordinator';

/** 首次学习结算：本次运行里毕业的与被声明为熟词的 Target。 */
export interface StructuredRuntimeSummary {
  readonly graduatedTargetIds: readonly PrototypeLearningTargetId[];
  readonly declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
}

/** 长期复习结算：保持住的、走完重学的、被声明为熟词的 Target。 */
export interface StructuredRetentionSummary {
  readonly retainingTargetIds: readonly PrototypeLearningTargetId[];
  readonly relearningCompletedTargetIds: readonly PrototypeLearningTargetId[];
  readonly declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
}

/** 一次运行：跑在哪块 surface 上、覆盖哪些 Target。 */
export interface RuntimeRun {
  readonly surface: PrototypeRuntimeSurface;
  readonly targetIds: readonly PrototypeLearningTargetId[];
}

export type InitialRuns = Readonly<
  Partial<Record<PrototypeRuntimeSurface, readonly PrototypeLearningTargetId[]>>
>;

export interface RuntimeSessionState {
  /** 各 surface 上的首学运行。跑完不清，由各自的完成路径显式收尾。 */
  readonly initialRuns: InitialRuns;
  /** 正在进行的长期复习运行；跑完或交接给下一组时替换。 */
  readonly retentionRun: RuntimeRun | null;
  /** 首次学习结算数据；null 表示本次运行没有可展示的统一结算。 */
  readonly initialSummary: StructuredRuntimeSummary | null;
  /** 长期复习结算数据。 */
  readonly retentionSummary: StructuredRetentionSummary | null;
}

export const INITIAL_RUNTIME_SESSION: RuntimeSessionState = {
  initialRuns: {},
  retentionRun: null,
  initialSummary: null,
  retentionSummary: null,
};

/** 稳定的空数组：选择器每次返回同一个引用，免得下游 memo 白白失效。 */
const NO_TARGETS: readonly PrototypeLearningTargetId[] = [];

/** 这块 surface 上的首学运行覆盖了哪些 Target；没有运行时返回空。 */
export const initialRunOn = (
  state: RuntimeSessionState,
  surface: PrototypeRuntimeSurface,
): readonly PrototypeLearningTargetId[] => state.initialRuns[surface] ?? NO_TARGETS;

/** 当前复习运行若跑在这块 surface 上，返回它的 Target；否则返回空。 */
export const retentionRunOn = (
  state: RuntimeSessionState,
  surface: PrototypeRuntimeSurface,
): readonly PrototypeLearningTargetId[] =>
  state.retentionRun?.surface === surface ? state.retentionRun.targetIds : NO_TARGETS;

export type RuntimeSessionAction =
  /** 开一次首学运行：本 surface 上的上一次运行与上一次首学结算一并作废。 */
  | {
      readonly type: 'startInitialRun';
      readonly surface: PrototypeRuntimeSurface;
      readonly targetIds: readonly PrototypeLearningTargetId[];
    }
  | { readonly type: 'finishInitialRun'; readonly surface: PrototypeRuntimeSurface }
  /** 开一段长期复习：顶掉上一组，上一次的复习结算一并作废。 */
  | {
      readonly type: 'startRetentionRun';
      readonly surface: PrototypeRuntimeSurface;
      readonly targetIds: readonly PrototypeLearningTargetId[];
    }
  | { readonly type: 'finishRetentionRun' }
  | { readonly type: 'showInitialSummary'; readonly summary: StructuredRuntimeSummary }
  | { readonly type: 'showRetentionSummary'; readonly summary: StructuredRetentionSummary };

export function runtimeSessionReducer(
  state: RuntimeSessionState,
  action: RuntimeSessionAction,
): RuntimeSessionState {
  switch (action.type) {
    case 'startInitialRun':
      return {
        ...state,
        initialRuns: { ...state.initialRuns, [action.surface]: action.targetIds },
        initialSummary: null,
      };
    case 'finishInitialRun': {
      if (state.initialRuns[action.surface] === undefined) return state;
      const initialRuns = { ...state.initialRuns };
      delete initialRuns[action.surface];
      return { ...state, initialRuns };
    }
    case 'startRetentionRun':
      return {
        ...state,
        retentionRun: { surface: action.surface, targetIds: action.targetIds },
        retentionSummary: null,
      };
    case 'finishRetentionRun':
      return state.retentionRun === null ? state : { ...state, retentionRun: null };
    case 'showInitialSummary':
      return { ...state, initialSummary: action.summary };
    case 'showRetentionSummary':
      return { ...state, retentionSummary: action.summary };
  }
}
