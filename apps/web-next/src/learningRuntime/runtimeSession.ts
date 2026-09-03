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
 * 这里**不**做成判别联合，因为这五个的生命周期确实不一样，硬拧成一个 kind 会说谎：
 *
 *  - 两个 summary 会同时存在。混合流里先复习后新学，结算页靠 flowMode 决定
 *    显示哪一个，两份数据都得留着。
 *  - `structuredInitialTargetIds` 在运行结束后仍然有效——"继续这条 Target 的运行"
 *    要靠它判断本次运行是否覆盖了那条 Target；而两个轻量字段是"正在跑"，跑完即清。
 *
 * 把这层不对称写出来，比塞进一个假的联合类型更接近事实。将来接入数据层时，
 * 这里就是持久化落点：目前整份状态刷新即丢，是原型阶段的已知限制。
 */
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';

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

export interface RuntimeSessionState {
  /** 本次结构化首学覆盖的 Target。运行结束后仍保留。 */
  readonly structuredInitialTargetIds: readonly PrototypeLearningTargetId[];
  /** 正在进行的轻量首学，结束即清空。 */
  readonly lightweightInitialTargetId: PrototypeLearningTargetId | null;
  /** 正在进行的轻量复习，结束即清空。 */
  readonly lightweightReviewTargetIds: readonly PrototypeLearningTargetId[];
  /** 首次学习结算数据；null 表示本次运行没有可展示的统一结算。 */
  readonly initialSummary: StructuredRuntimeSummary | null;
  /** 长期复习结算数据。 */
  readonly retentionSummary: StructuredRetentionSummary | null;
}

export const INITIAL_RUNTIME_SESSION: RuntimeSessionState = {
  structuredInitialTargetIds: [],
  lightweightInitialTargetId: null,
  lightweightReviewTargetIds: [],
  initialSummary: null,
  retentionSummary: null,
};

export type RuntimeSessionAction =
  /** 开一次结构化首学：上一次的结算与还挂着的轻量首学一并作废。 */
  | {
      readonly type: 'startStructuredInitial';
      readonly targetIds: readonly PrototypeLearningTargetId[];
    }
  | { readonly type: 'startLightweightInitial'; readonly targetId: PrototypeLearningTargetId }
  | { readonly type: 'finishLightweightInitial' }
  | {
      readonly type: 'startLightweightReview';
      readonly targetIds: readonly PrototypeLearningTargetId[];
    }
  | { readonly type: 'finishLightweightReview' }
  | { readonly type: 'showInitialSummary'; readonly summary: StructuredRuntimeSummary }
  | { readonly type: 'showRetentionSummary'; readonly summary: StructuredRetentionSummary }
  /** 开一段结构化复习：上一次的复习结算作废，本次跑完再写新的。 */
  | { readonly type: 'clearRetentionSummary' };

export function runtimeSessionReducer(
  state: RuntimeSessionState,
  action: RuntimeSessionAction,
): RuntimeSessionState {
  switch (action.type) {
    case 'startStructuredInitial':
      return {
        ...state,
        structuredInitialTargetIds: action.targetIds,
        lightweightInitialTargetId: null,
        initialSummary: null,
      };
    case 'startLightweightInitial':
      return { ...state, lightweightInitialTargetId: action.targetId };
    case 'finishLightweightInitial':
      return state.lightweightInitialTargetId === null
        ? state
        : { ...state, lightweightInitialTargetId: null };
    case 'startLightweightReview':
      return { ...state, lightweightReviewTargetIds: action.targetIds };
    case 'finishLightweightReview':
      return state.lightweightReviewTargetIds.length === 0
        ? state
        : { ...state, lightweightReviewTargetIds: [] };
    case 'showInitialSummary':
      return { ...state, initialSummary: action.summary };
    case 'showRetentionSummary':
      return { ...state, retentionSummary: action.summary };
    case 'clearRetentionSummary':
      return state.retentionSummary === null ? state : { ...state, retentionSummary: null };
  }
}
