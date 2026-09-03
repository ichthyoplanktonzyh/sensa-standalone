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
 * surface 插件的合同面：它需要什么，接口上一目了然。目前它还偏大，因为
 * App 仍持有队列与 journey 的写入口；随着 runtimeSession 泛化与 engine
 * seam 化推进，这个面会收缩。
 *
 * 不在本表内的是"这条 Target 的 retention 事实存在哪"——structured 走
 * storageService 的 FSRS items，lightweight 走 journey reducer 的
 * lightweightRetention 记录。那是持久化后端的选择，散在 App/journeyState
 * 的另外十处 surface 判断里，属于下一刀（retention store 抽象）。
 */
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import type { ShellFlow } from '../router/shellLocation';
import type { PrototypeRuntimeSurface, RuntimeLaunch } from './runtimeCoordinator';

export type RuntimeLaunchForTargets = RuntimeLaunch<PrototypeLearningTargetId>;

/**
 * 宿主提供给 surface handler 的能力面。
 *
 * 每个方法都是一次完整的领域操作，handler 负责组合顺序、失败处理与文案。
 * 返回值刻意区分"没做成"和"做成了但是空的"：`beginStructuredInitial`
 * 返回 false 表示内容不完整、未产生任何写入；`beginStructuredReview`
 * 返回 0 表示队列建立了但没有到期项。
 */
export interface RuntimeSurfaceContext {
  readonly toast: (message: string) => void;
  /** 切换全屏 flow（App 的 viewMode）。 */
  readonly showFlow: (flow: ShellFlow) => void;
  /** 把流程模式切到 review（App 的 flowMode）；structured 的复习呈现依赖它。 */
  readonly enterReviewMode: () => void;
  /** 提交并锁定这批 Target 的 Learning Policy。 */
  readonly commitPolicies: (targetIds: readonly PrototypeLearningTargetId[]) => void;
  readonly beginLightweightInitial: (targetId: PrototypeLearningTargetId) => void;
  /** 内容不完整时返回 false，且不产生任何状态写入。 */
  readonly beginStructuredInitial: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => boolean;
  readonly beginLightweightReview: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => void;
  /** 只数不写：handler 要先知道数量才能决定空队列该不该进入。 */
  readonly countDueReviews: (
    targetIds: readonly PrototypeLearningTargetId[],
  ) => number;
  readonly beginStructuredReview: (
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
  readonly flow: ShellFlow;
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
    const targetId = launch.targetIds[0];
    if (!targetId) return false;
    ctx.commitPolicies([targetId]);
    ctx.beginLightweightInitial(targetId);
    ctx.showFlow('lightweight');
    return true;
  },
  continueInitial: (ctx, targetId, state) => {
    if (state.initialCompletion) {
      ctx.toast('首次学习已经完成，等待进入长期复习');
      return;
    }
    ctx.beginLightweightInitial(targetId);
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
    ctx.beginLightweightReview(launch.targetIds);
    ctx.showFlow('lightweightReview');
    ctx.toast(options.announce(launch.targetIds.length));
    return true;
  },
};

const structuredSessionSurface: RuntimeSurfaceDefinition = {
  surface: 'structured_session',
  flow: 'study',
  startInitial: (ctx, launch) => {
    if (!ctx.beginStructuredInitial(launch.targetIds)) return false;
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
    ctx.beginStructuredReview(launch.targetIds);
    ctx.showFlow('study');
    ctx.toast(options.announce(dueCount));
    return true;
  },
};

export const RUNTIME_SURFACE_DEFINITIONS = [
  lightweightInitialSurface,
  lightweightRetentionSurface,
  structuredSessionSurface,
] as const satisfies readonly RuntimeSurfaceDefinition[];

export class RuntimeSurfaceRegistry {
  readonly #definitions: ReadonlyMap<PrototypeRuntimeSurface, RuntimeSurfaceDefinition>;

  public constructor(
    definitions: readonly RuntimeSurfaceDefinition[] = RUNTIME_SURFACE_DEFINITIONS,
  ) {
    this.#definitions = new Map(definitions.map((definition) => [definition.surface, definition]));
  }

  public get(surface: PrototypeRuntimeSurface): RuntimeSurfaceDefinition {
    const definition = this.#definitions.get(surface);
    if (!definition) throw new Error(`Unknown Runtime Surface: ${surface}`);
    return definition;
  }

  /** 该 surface 运行时占据的全屏 flow。 */
  public flowFor(surface: PrototypeRuntimeSurface): ShellFlow {
    return this.get(surface).flow;
  }
}

export const runtimeSurfaceRegistry = new RuntimeSurfaceRegistry();
