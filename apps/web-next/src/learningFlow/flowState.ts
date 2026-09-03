/**
 * 学习流状态：一个判别联合，而不是六个互相牵制的 useState。
 *
 * 原先是：
 *
 *     const [flowMode, setFlowType] = useState<FlowType>('learn');
 *     const [demoStage, setDemoStage] = useState<FormalLearningStage>('introduction');
 *     const [demoWord, setDemoWord] = useState<Word | null>(null);
 *     const [demoPackage, setDemoPackage] = useState<RuntimePackage | null>(null);
 *     const [demoReviewKind, setDemoReviewKind] = useState<ReviewAssessmentKind | null>(null);
 *     const [demoReviewResult, setDemoReviewResult] = useState<ReviewAssessmentResult | null>(null);
 *
 * 后五个只在 `flowMode === 'demo'` 时有意义，其余时候是残留。原来的代码靠
 * 在每个流程入口手工清场来维持这一点——三处都写着同样的三行：
 *
 *     setDemoWord(null); setDemoPackage(null); setDemoReviewKind(null);
 *
 * 三行清了三个，`demoStage` 和 `demoReviewResult` 从来没被清过。这没有变成
 * 线上问题，只是因为每一处读取都恰好被 `flowMode === 'demo'` 挡住了；哪天
 * 漏挡一次，读到的就是上一次演示留下的评测结果。
 *
 * 联合类型让这件事不必再靠自觉：demo 的负载挂在 demo 分支上，切走即随之消失，
 * 没有可清可不清的东西；反过来，进入 demo 必须交出完整的一份负载，
 * 于是 `flowMode === 'demo' && demoPackage` 里那个 `&& demoPackage` 也没了。
 */
import type { FormalLearningStage, Word } from '../types';
import type { ReviewAssessmentKind, ReviewAssessmentResult } from '../review/types';
import type { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';

type RuntimePackage = (typeof PROTOTYPE_LEARNING_PACKAGES)[number];

/** demo 模式下直接驱动界面的一份手工演示，绕过真实队列。 */
export interface DemoPresentation {
  readonly stage: FormalLearningStage;
  readonly word: Word;
  readonly pkg: RuntimePackage;
  readonly reviewKind: ReviewAssessmentKind | null;
  readonly reviewResult: ReviewAssessmentResult | null;
}

export type FlowState =
  | { readonly mode: 'learn' }
  | { readonly mode: 'review' }
  | { readonly mode: 'demo'; readonly demo: DemoPresentation };

export type FlowMode = FlowState['mode'];

export const INITIAL_FLOW_STATE: FlowState = { mode: 'learn' };

export type FlowAction =
  /** 进入首次学习流。demo 负载随之消失。 */
  | { readonly type: 'enterLearn' }
  /** 进入复习流。demo 负载随之消失。 */
  | { readonly type: 'enterReview' }
  /** 进入演示，必须一次交出完整的演示负载。 */
  | { readonly type: 'enterDemo'; readonly demo: DemoPresentation }
  /**
   * 在演示内部推进。非 demo 模式下是空操作——这一点原先由每个调用点的
   * `if (flowMode === 'demo')` 保证，现在由 reducer 保证。
   */
  | { readonly type: 'advanceDemo'; readonly patch: Partial<DemoPresentation> };

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'enterLearn':
      return state.mode === 'learn' ? state : { mode: 'learn' };
    case 'enterReview':
      return state.mode === 'review' ? state : { mode: 'review' };
    case 'enterDemo':
      return { mode: 'demo', demo: action.demo };
    case 'advanceDemo':
      if (state.mode !== 'demo') return state;
      return { mode: 'demo', demo: { ...state.demo, ...action.patch } };
  }
}

/** demo 负载，非 demo 模式为 null。所有读取点都从这里取。 */
export const demoOf = (state: FlowState): DemoPresentation | null =>
  state.mode === 'demo' ? state.demo : null;
