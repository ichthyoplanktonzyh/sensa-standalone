/**
 * Runtime Surface 的启动登记表。
 *
 * 此前 `App.tsx` 里散着六处 `launch.surface === 'lightweight_initial' | …` 的
 * if/else：每个入口（首学、继续首学、复习、混合流、复习组交接）各写一套，
 * 每套都要记得配一次 `setViewMode('lightweight' | 'study' | …)`。加第三种
 * Runtime 行为时，这六处和 viewMode 的取值要一起改——`journeys/02` §10 说
 * "不得向页面加入 Profile-name 分支"，surface 分支是它的等价物。
 *
 * 登记表把这件事倒过来：一个 surface 自己声明占用哪个全屏 flow、以及三个
 * 入口各自怎么启动。`App.tsx` 只查表、调用，不认识任何 surface 名字。
 *
 * Handler 通过 `RuntimeSurfaceContext` 拿到宿主能力，这份 context 就是
 * surface 插件的合同面：它需要什么，接口上一目了然。runtimeSession 按运行
 * 泛化之后，"记下这次运行"已经是一对通用能力（`beginInitialRun` /
 * `beginRetentionRun`），不再按学习方式各给一个入口；剩下的
 * `openStructuredQueue` / `openStructuredReviewQueue` 是编排引擎的入口，
 * 要等编排插件 seam 化（`fresh` / `repair`）才会退场。
 *
 * 不在本表内的是"这条 Target 的 retention 事实存在哪"——那是 store 的选择，
 * 见 retentionStores.ts。
 */
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import type { PrototypeRuntimeSurface, RuntimeLaunch } from './runtimeCoordinator';

type LegacyRuntimeFlow =
  | 'study'
  | 'lightweight'
  | 'lightweightReview'
  | 'fourStage'
  | 'fourStageReview';

export type RuntimeLaunchForTargets = RuntimeLaunch<PrototypeLearningTargetId>;

/**
 * 宿主提供给 surface handler 的能力面。
 *
 * 每个方法都是一次完整的领域操作，handler 负责组合顺序、失败处理与文案。
 * 返回值刻意区分"没做成"和"做成了但是空的"：`openStructuredQueue` 返回 false
 * 表示内容不完整、未产生任何写入；`countDueReviews` 返回 0 表示队列可以建立
 * 但没有到期项。
 */
export interface RuntimeSurfaceContext {
  readonly toast: (message: string) => void;
  /** 切换全屏 flow（App 的 viewMode）。 */
  readonly showFlow: (flow: LegacyRuntimeFlow) => void;
  /** 把流程模式切到 review（App 的 flowMode）；structured 的复习呈现依赖它。 */
  readonly enterReviewMode: () => void;
  /** 提交并锁定这批 Target 的 Learning Policy。 */
  readonly commitPolicies: (targetIds: readonly PrototypeLearningTargetId[]) => void;
  /** 记下"这块 surface 上正在跑一次首学运行"。 */
  readonly beginInitialRun: (
    surface: PrototypeRuntimeSurface,
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  /** 记下"这块 surface 上正在跑一段长期复习"，并作废上一次的复习结算。 */
  readonly beginRetentionRun: (
    surface: PrototypeRuntimeSurface,
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  /** 建立结构化首学队列；内容不完整时返回 false，且不产生任何状态写入。 */
  readonly openStructuredQueue: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => boolean;
  /** 只数不写：handler 要先知道数量才能决定空队列该不该进入。 */
  readonly countDueReviews: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => number;
  readonly openStructuredReviewQueue: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
}

/** 继续一条已提交 Target 时，宿主已经解析好的事实。 */
export interface ContinueInitialState {
  readonly initialCompletion: boolean;
  readonly declaredMastery: boolean;
  /** 这条 Target 属于当前仍在跑的那次运行。 */
  readonly inActiveRun: boolean;
}

/** 复习入口之间的差异，由调用点提供。 */
export interface RetentionStartOptions {
  readonly announce: (count: number) => string;
  /**
   * 到期数为 0 时是否仍然进入该 flow。
   *
   * 三个入口的既有行为并不一致，这里如实保留：单独进复习（`startReview`）
   * 在没有到期项时不进入、由调用点提示；混合流与复习组交接则照旧进入。
   */
  readonly enterOnEmpty: boolean;
}

export interface RuntimeSurfaceDefinition {
  readonly surface: PrototypeRuntimeSurface;
  /** 该 surface 运行时占据的全屏 flow。App 由此派生 viewMode。 */
  readonly flow: LegacyRuntimeFlow;
  /** 启动一次首次学习运行；false 表示未创建。 */
  readonly startInitial: (
    ctx: RuntimeSurfaceContext,
    launch: RuntimeLaunchForTargets,
  ) => boolean;
  /** 继续一条已提交 Policy 的 Target。 */
  readonly continueInitial: (
    ctx: RuntimeSurfaceContext,
    targetId: PrototypeLearningTargetId,
    state: ContinueInitialState,
  ) => void;
  /** 启动一段长期复习；false 表示没有可运行的到期项。 */
  readonly startRetention: (
    ctx: RuntimeSurfaceContext,
    launch: RuntimeLaunchForTargets,
    options: RetentionStartOptions,
  ) => boolean;
}

const lightweightInitialSurface: RuntimeSurfaceDefinition = {
  surface: 'lightweight_initial',
  flow: 'lightweight',
  startInitial: (ctx, launch) => {
    if (launch.targetIds.length === 0) return false;
    ctx.commitPolicies(launch.targetIds);
    ctx.beginInitialRun('lightweight_initial', launch.targetIds);
    ctx.showFlow('lightweight');
    return true;
  },
  continueInitial: (ctx, targetId, state) => {
    if (state.initialCompletion) {
      ctx.toast('首次学习已经完成，等待进入长期复习');
      return;
    }
    if (state.inActiveRun) {
      ctx.showFlow('lightweight');
      return;
    }
    ctx.beginInitialRun('lightweight_initial', [targetId]);
    ctx.showFlow('lightweight');
  },
  // 轻量首学的 surface 不承担长期复习；它的 retention 由 lightweight_retention 运行。
  startRetention: () => false,
};

const lightweightRetentionSurface: RuntimeSurfaceDefinition = {
  surface: 'lightweight_retention',
  flow: 'lightweightReview',
  startInitial: () => false,
  continueInitial: () => {},
  startRetention: (ctx, launch, options) => {
    ctx.beginRetentionRun('lightweight_retention', launch.targetIds);
    ctx.showFlow('lightweightReview');
    ctx.toast(options.announce(launch.targetIds.length));
    return true;
  },
};

const structuredSessionSurface: RuntimeSurfaceDefinition = {
  surface: 'structured_session',
  flow: 'study',
  startInitial: (ctx, launch) => {
    // 队列先建：建不起来就一处都不写，Policy 不锁、运行不记。
    if (!ctx.openStructuredQueue(launch.targetIds)) return false;
    ctx.beginInitialRun('structured_session', launch.targetIds);
    ctx.commitPolicies(launch.targetIds);
    ctx.showFlow('study');
    return true;
  },
  continueInitial: (ctx, _targetId, state) => {
    if (state.declaredMastery) {
      ctx.toast('这条目标已声明为熟词，不再进入正式学习计划');
      return;
    }
    if (state.initialCompletion) {
      ctx.toast('高保证首次学习已经完成，当前处于长期保持阶段');
      return;
    }
    if (state.inActiveRun) {
      ctx.showFlow('study');
      return;
    }
    ctx.toast('首次学习已结束，之后会按计划进入复习');
  },
  startRetention: (ctx, launch, options) => {
    const dueCount = ctx.countDueReviews(launch.targetIds);
    if (dueCount === 0 && !options.enterOnEmpty) return false;
    ctx.enterReviewMode();
    ctx.beginRetentionRun('structured_session', launch.targetIds);
    ctx.openStructuredReviewQueue(launch.targetIds);
    ctx.showFlow('study');
    ctx.toast(options.announce(dueCount));
    return true;
  },
};

const interleavedFourStageSurface: RuntimeSurfaceDefinition = {
  surface: 'interleaved_four_stage',
  flow: 'fourStage',
  startInitial: (ctx, launch) => {
    if (launch.targetIds.length === 0) return false;
    ctx.beginInitialRun('interleaved_four_stage', launch.targetIds);
    ctx.commitPolicies(launch.targetIds);
    ctx.showFlow('fourStage');
    return true;
  },
  continueInitial: (ctx, _targetId, state) => {
    if (state.declaredMastery) {
      ctx.toast('这条目标已声明为熟词，不再进入正式学习计划');
      return;
    }
    if (state.initialCompletion) {
      ctx.toast('四阶段首次学习已经完成，当前处于长期保持阶段');
      return;
    }
    if (state.inActiveRun) {
      ctx.showFlow('fourStage');
      return;
    }
    ctx.toast('这次四阶段运行已结束');
  },
  startRetention: () => false,
};

const interleavedFourStageReviewSurface: RuntimeSurfaceDefinition = {
  surface: 'interleaved_four_stage_review',
  flow: 'fourStageReview',
  startInitial: () => false,
  continueInitial: () => {},
  startRetention: (ctx, launch, options) => {
    if (launch.targetIds.length === 0 && !options.enterOnEmpty) return false;
    ctx.beginRetentionRun('interleaved_four_stage_review', launch.targetIds);
    ctx.showFlow('fourStageReview');
    ctx.toast(options.announce(launch.targetIds.length));
    return true;
  },
};

export const RUNTIME_SURFACE_DEFINITIONS = [
  lightweightInitialSurface,
  lightweightRetentionSurface,
  structuredSessionSurface,
  interleavedFourStageSurface,
  interleavedFourStageReviewSurface,
] as const satisfies readonly RuntimeSurfaceDefinition[];

export class RuntimeSurfaceRegistry {
  readonly #definitions: ReadonlyMap<PrototypeRuntimeSurface, RuntimeSurfaceDefinition>;

  public constructor(
    definitions: readonly RuntimeSurfaceDefinition[] = RUNTIME_SURFACE_DEFINITIONS,
  ) {
    const surfaces = new Set<PrototypeRuntimeSurface>();
    for (const definition of definitions) {
      if (surfaces.has(definition.surface)) {
        throw new Error(`Duplicate Runtime Surface identity: ${definition.surface}`);
      }
      surfaces.add(definition.surface);
    }
    this.#definitions = new Map(definitions.map((definition) => [definition.surface, definition]));
  }

  public list(): readonly RuntimeSurfaceDefinition[] {
    return [...this.#definitions.values()];
  }

  public get(surface: PrototypeRuntimeSurface): RuntimeSurfaceDefinition {
    const definition = this.#definitions.get(surface);
    if (!definition) throw new Error(`Unknown Runtime Surface: ${surface}`);
    return definition;
  }

  /** 该 surface 运行时占据的全屏 flow。 */
  public flowFor(surface: PrototypeRuntimeSurface): LegacyRuntimeFlow {
    return this.get(surface).flow;
  }
}

export const runtimeSurfaceRegistry = new RuntimeSurfaceRegistry();
