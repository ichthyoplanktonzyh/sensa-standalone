/**
 * 学习旅程：每条 Target 走到哪一步了。
 *
 * 原先是 App 里九个各自为政的 useState，其中八个是用同一个 key 索引的平行 map：
 *
 *     learningPolicyByTarget / addedLearningTargetIds / preparationByTarget
 *     committedPolicyByTarget / initialLearningCompletionByTarget
 *     lightweightRetentionByTarget / structuredRetentionByTarget
 *
 * 平行 map 有两个代价，这份代码两个都付了：
 *
 *  1. 读一条 Target 的完整状态要查八次。屏幕上"选中的这条目标"那一段，
 *     就是连着八行 `xxxByTarget[selectedLearningTargetId]`。而
 *     `effectivePolicyForTarget` 的签名要吞下其中四个 map 才能算出一个方式——
 *     参数列表本身就是这件事的症状。
 *  2. 一个事件常要同时改好几个 map。"加入学习"改三个、"选学习方式"改两个、
 *     "结构化毕业"改两个、"轻量首学完成"改两个。每处都是几个 setState 排在一起，
 *     漏一个就是一条状态对不上，而且不会有任何报错。
 *
 * 归一成"每条 Target 一条记录"之后，读是一次查找，写是一个具名事件。
 * 毕业、交接、复习结算这些规则本身也搬进了 reducer：它们是纯的（时间与 FSRS
 * 到期时间由调用点传入），因而可以被 smoke 逐条断言，而不必把应用跑起来。
 *
 * 这份状态目前完全不落盘，刷新即丢——原型阶段的已知限制。将来接数据层时，
 * 这里就是落点：reducer 是纯的，加持久化不需要改任何调用点。
 */
import {
  PROTOTYPE_LEARNING_TARGETS,
  PROTOTYPE_LEARNING_TARGET_ORDER,
  readinessForPolicy,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from './prototypeLearning';
import {
  learningPolicyProfileRegistry,
  type LearningProtocolPurpose,
} from '../learningRuntime/policyProfiles';
import { learningRuntimeCoordinator } from '../learningRuntime/runtimeCoordinator';
import type { RelearningCycleStage } from '../engine/types';
import type { ReviewMemoryOutcome } from '../review/types';

/* ============================================================
   每条 Target 的记录
   ============================================================ */

/** 首次学习的完成交接：完成方式、完成时间、以及交给谁安排下一次。 */
export interface InitialLearningCompletion {
  readonly completionKind: 'lightweight' | 'structured';
  readonly completedAt: string;
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
  readonly schedulingHandoffBasis: 'study_completion' | 'acquisition_graduation';
  readonly initialRating?: Exclude<PrototypeLightweightRating, 'again'>;
}

/** 轻量保持：不进 FSRS，按固定档期重排。 */
export interface LightweightRetention {
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
  readonly reviewCount: number;
  readonly lapseCount: number;
  readonly relearning: boolean;
  readonly lastReviewRating?: PrototypeLightweightRating;
  readonly lastReviewedAt?: string;
}

/** 结构化保持：由 FSRS 调度，这里只是它在界面上的投影。 */
export interface StructuredRetention {
  readonly lastReviewedAt: string | null;
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
  readonly reviewCount: number;
  readonly lapseCount: number;
  readonly lastOutcome: ReviewMemoryOutcome | null;
  readonly relearning: boolean;
  readonly relearningStage: RelearningCycleStage | null;
  readonly relearningCompletedAt: string | null;
}

export interface TargetJourney {
  /** 是否已加入"我的学习"。 */
  readonly added: boolean;
  /** 学习者单独为这条 Target 选的方式；null 表示还没选过，走默认。 */
  readonly policy: PrototypeLearningPolicy | null;
  /** 内容准备状态；null 表示还没算过，读取时按当前方式现算。 */
  readonly preparation: PrototypeLearningReadiness | null;
  /** 首次正式学习开始时锁定的方式。一旦有值，方式不再可改。 */
  readonly committedPolicy: PrototypeLearningPolicy | null;
  readonly initialCompletion: InitialLearningCompletion | null;
  readonly lightweightRetention: LightweightRetention | null;
  readonly structuredRetention: StructuredRetention | null;
}

const EMPTY_JOURNEY: TargetJourney = {
  added: false,
  policy: null,
  preparation: null,
  committedPolicy: null,
  initialCompletion: null,
  lightweightRetention: null,
  structuredRetention: null,
};

export interface JourneyState {
  readonly defaultPolicy: PrototypeLearningPolicy;
  /** 每条 Target 都有记录，字段可以为 null——不存在"这条 Target 不在表里"。 */
  readonly byTarget: Readonly<Record<PrototypeLearningTargetId, TargetJourney>>;
  /**
   * 被声明为熟词的 Sense。按 senseId 而非 targetId 索引：熟词声明发生在
   * 具体义项上，一条 Target 未必有 runtime Sense。
   */
  readonly declaredMasterySenseIds: ReadonlySet<string>;
}

/* ============================================================
   选择器
   ============================================================ */

export const journeyFor = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
): TargetJourney => state.byTarget[targetId];

/**
 * 这条 Target 当前生效的学习方式。
 *
 * 优先级：已锁定 > 单独选过 > 已加入则用 Target 自带的建议 > 全局默认。
 * 原先这个函数要吞下四个 map 才能回答，现在只要状态本身。
 */
export const effectivePolicyFor = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
): PrototypeLearningPolicy => {
  const journey = state.byTarget[targetId];
  return journey.committedPolicy
    ?? journey.policy
    ?? (journey.added ? PROTOTYPE_LEARNING_TARGETS[targetId].policy : state.defaultPolicy);
};

/** 内容准备状态。没记录过就按当前方式现算。 */
export const preparationFor = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
  policy: PrototypeLearningPolicy = effectivePolicyFor(state, targetId),
): PrototypeLearningReadiness =>
  state.byTarget[targetId].preparation
  ?? readinessForPolicy(PROTOTYPE_LEARNING_TARGETS[targetId], policy).status;

/** 已加入学习的 Target，按目录顺序。 */
export const addedTargetIds = (
  state: JourneyState,
): readonly PrototypeLearningTargetId[] =>
  PROTOTYPE_LEARNING_TARGET_ORDER.filter((targetId) => state.byTarget[targetId].added);

/**
 * 每条 Target 的生效方式 / 准备状态，整表取出。
 *
 * 给只负责展示的屏幕用：它们不该自己再实现一遍优先级规则——列表屏原先就实现了
 * 一个略有出入的版本（未加入时回落到 Target 自带方式而非全局默认）。
 */
export const effectivePolicies = (
  state: JourneyState,
): Readonly<Record<PrototypeLearningTargetId, PrototypeLearningPolicy>> =>
  Object.fromEntries(
    PROTOTYPE_LEARNING_TARGET_ORDER.map((targetId) => [targetId, effectivePolicyFor(state, targetId)]),
  ) as Record<PrototypeLearningTargetId, PrototypeLearningPolicy>;

export const preparations = (
  state: JourneyState,
): Readonly<Record<PrototypeLearningTargetId, PrototypeLearningReadiness>> =>
  Object.fromEntries(
    PROTOTYPE_LEARNING_TARGET_ORDER.map((targetId) => [targetId, preparationFor(state, targetId)]),
  ) as Record<PrototypeLearningTargetId, PrototypeLearningReadiness>;

/** 已锁定方式的 Target。 */
export const committedTargetIds = (
  state: JourneyState,
): ReadonlySet<PrototypeLearningTargetId> =>
  new Set(PROTOTYPE_LEARNING_TARGET_ORDER.filter(
    (targetId) => state.byTarget[targetId].committedPolicy !== null,
  ));

/** 已完成首次学习交接的 Target。 */
export const completedTargetIds = (
  state: JourneyState,
): ReadonlySet<PrototypeLearningTargetId> =>
  new Set(PROTOTYPE_LEARNING_TARGET_ORDER.filter(
    (targetId) => state.byTarget[targetId].initialCompletion !== null,
  ));

/** 这条 Target 的 runtime Sense 是否已被声明为熟词。 */
export const isDeclaredMastery = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
): boolean => {
  const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
  return senseId !== null && state.declaredMasterySenseIds.has(senseId);
};

/* ============================================================
   初始状态
   ============================================================ */

const buildInitialByTarget = (): Record<PrototypeLearningTargetId, TargetJourney> => {
  const byTarget = {} as Record<PrototypeLearningTargetId, TargetJourney>;
  for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
    byTarget[targetId] = EMPTY_JOURNEY;
  }
  // 原型的出厂状态：两条已在"我的学习"里，其中一条内容还在准备。
  byTarget['tactful-expression'] = {
    ...EMPTY_JOURNEY,
    added: true,
    preparation: 'preparing',
  };
  byTarget['lend-give'] = { ...EMPTY_JOURNEY, added: true };
  return byTarget;
};

/** 出厂默认方式：注册表里的第一条，与 App 一直以来的取法一致。 */
export const DEFAULT_LEARNING_POLICY: PrototypeLearningPolicy =
  learningPolicyProfileRegistry.list()[0]!.profileId;

export const INITIAL_JOURNEY: JourneyState = {
  defaultPolicy: DEFAULT_LEARNING_POLICY,
  byTarget: buildInitialByTarget(),
  declaredMasterySenseIds: new Set<string>(),
};

/* ============================================================
   事件
   ============================================================ */

export type JourneyAction =
  | { readonly type: 'selectDefaultPolicy'; readonly policy: PrototypeLearningPolicy }
  /** 为一条 Target 单独选方式：准备状态随之按新方式重算。 */
  | {
      readonly type: 'selectTargetPolicy';
      readonly targetId: PrototypeLearningTargetId;
      readonly policy: PrototypeLearningPolicy;
    }
  /** 加入"我的学习"：落一份方式、按该方式算准备状态、置为已加入。 */
  | { readonly type: 'addTarget'; readonly targetId: PrototypeLearningTargetId }
  | {
      readonly type: 'setPreparation';
      readonly targetId: PrototypeLearningTargetId;
      readonly preparation: PrototypeLearningReadiness;
    }
  /** 首次正式学习开始，锁定方式。 */
  | {
      readonly type: 'commitPolicies';
      readonly entries: ReadonlyArray<{
        readonly targetId: PrototypeLearningTargetId;
        readonly policy: PrototypeLearningPolicy;
      }>;
    }
  /**
   * 结构化首学毕业。规则在 reducer 里：只有"锁定为结构化首学、且这次确实毕业"
   * 的 Target 才写交接；写进哪一份取决于它的保持方式是结构化还是轻量。
   * 已有交接的不覆盖——毕业只发生一次。
   */
  | {
      readonly type: 'recordStructuredGraduation';
      readonly graduatedSenseIds: readonly string[];
      /** senseId → FSRS 到期时间戳。只有结构化保持才用得到。 */
      readonly dueBySenseId: Readonly<Record<string, number>>;
      readonly completedAt: string;
      readonly now: number;
    }
  /** 轻量首学完成。 */
  | {
      readonly type: 'completeLightweightInitial';
      readonly targetId: PrototypeLearningTargetId;
      readonly rating: Exclude<PrototypeLightweightRating, 'again'>;
      readonly completedAt: string;
      readonly nextReviewAt: string;
      readonly nextReviewLabel: string;
      /** 保持方式为轻量时，同时开一条轻量保持记录。 */
      readonly startLightweightRetention: boolean;
    }
  /** 轻量保持的一次复习。 */
  | {
      readonly type: 'recordLightweightReview';
      readonly targetId: PrototypeLearningTargetId;
      readonly rating: PrototypeLightweightRating;
      readonly reviewedAt: string;
      readonly nextReviewAt: string;
      readonly nextReviewLabel: string;
    }
  /** 轻量保持的定向修复完成，退出 relearning。 */
  | { readonly type: 'clearLightweightRelearning'; readonly targetId: PrototypeLearningTargetId }
  /**
   * 结构化保持的一次结算，投影 FSRS 的结果。
   *
   * 传入的是这次事件本身，累加（reviewCount）与延续（上次结果、上次重学完成时间）
   * 由 reducer 基于它自己持有的上一份算——调用点不必先读旧值再拼一份新的。
   */
  | {
      readonly type: 'recordStructuredRetention';
      readonly targetId: PrototypeLearningTargetId;
      readonly occurredAt: string;
      /** 这次是否算作一次复习结算（relearning 过程事件不算）。 */
      readonly counted: boolean;
      readonly outcome: ReviewMemoryOutcome | null;
      /** FSRS 给出的下次到期时间与累计遗忘次数。 */
      readonly dueAt: number;
      readonly lapses: number;
      /** 当前 relearning 周期；null 表示不在重学中。 */
      readonly relearningStage: RelearningCycleStage | null;
      /** 这次事件是否是重学复测通过。 */
      readonly retestPassed: boolean;
      readonly now: number;
    }
  /**
   * 把还没到期的结构化交接提前到现在。原型里用来让刚毕业的意思立刻可复习，
   * 已经结算过一次的（reviewCount > 0）不动——那时下次到期归调度器管。
   */
  | {
      readonly type: 'advanceStructuredHandoffs';
      readonly targetIds: readonly PrototypeLearningTargetId[];
      readonly dueAt: number;
    }
  | { readonly type: 'declareMastery'; readonly senseId: string }
  | { readonly type: 'revokeMastery'; readonly senseId: string };

const surfaceFor = (
  policy: PrototypeLearningPolicy,
  purpose: LearningProtocolPurpose,
) => learningRuntimeCoordinator.surfaceFor(policy, purpose);

/** 相对日期标签，与界面上其它"今天/明天/N 天后"保持一致。 */
export const relativeReviewLabel = (dueAt: number, now: number = Date.now()): string => {
  const days = Math.max(0, Math.ceil((dueAt - now) / (24 * 60 * 60 * 1000)));
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
};

const patch = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
  changes: Partial<TargetJourney>,
): JourneyState => ({
  ...state,
  byTarget: {
    ...state.byTarget,
    [targetId]: { ...state.byTarget[targetId], ...changes },
  },
});

export function journeyReducer(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'selectDefaultPolicy':
      return state.defaultPolicy === action.policy
        ? state
        : { ...state, defaultPolicy: action.policy };

    case 'selectTargetPolicy':
      return patch(state, action.targetId, {
        policy: action.policy,
        preparation: readinessForPolicy(
          PROTOTYPE_LEARNING_TARGETS[action.targetId],
          action.policy,
        ).status,
      });

    case 'addTarget': {
      const journey = state.byTarget[action.targetId];
      // 加入时若还没单独选过方式，就把当时的默认方式落成这条 Target 自己的。
      const policy = journey.policy ?? state.defaultPolicy;
      return patch(state, action.targetId, {
        added: true,
        policy,
        preparation: readinessForPolicy(
          PROTOTYPE_LEARNING_TARGETS[action.targetId],
          policy,
        ).status,
      });
    }

    case 'setPreparation':
      return patch(state, action.targetId, { preparation: action.preparation });

    case 'commitPolicies': {
      if (action.entries.length === 0) return state;
      const byTarget = { ...state.byTarget };
      for (const { targetId, policy } of action.entries) {
        byTarget[targetId] = { ...byTarget[targetId], committedPolicy: policy };
      }
      return { ...state, byTarget };
    }

    case 'recordStructuredGraduation': {
      const graduated = new Set(action.graduatedSenseIds);
      const byTarget = { ...state.byTarget };
      let changed = false;
      for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
        const journey = byTarget[targetId];
        const policy = journey.committedPolicy;
        const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
        if (
          !policy
          || !senseId
          || !graduated.has(senseId)
          || surfaceFor(policy, 'initial_learning') !== 'structured_session'
        ) continue;

        const retentionSurface = surfaceFor(policy, 'retention_review');
        const changes: { -readonly [K in keyof TargetJourney]?: TargetJourney[K] } = {};

        // 毕业只发生一次：已有交接的不覆盖。
        if (!journey.initialCompletion) {
          const due = retentionSurface === 'structured_session'
            ? action.dueBySenseId[senseId]
            : undefined;
          changes.initialCompletion = {
            completionKind: 'structured',
            completedAt: action.completedAt,
            nextReviewAt: due === undefined
              ? action.completedAt
              : new Date(due).toISOString(),
            nextReviewLabel: due === undefined
              ? '现在可复习（原型）'
              : relativeReviewLabel(due, action.now),
            schedulingHandoffBasis: 'acquisition_graduation',
          };
        }
        if (retentionSurface === 'lightweight_retention' && !journey.lightweightRetention) {
          changes.lightweightRetention = {
            nextReviewAt: action.completedAt,
            nextReviewLabel: '现在可复习（原型）',
            reviewCount: 0,
            lapseCount: 0,
            relearning: false,
          };
        }
        if (Object.keys(changes).length === 0) continue;
        byTarget[targetId] = { ...journey, ...changes };
        changed = true;
      }
      return changed ? { ...state, byTarget } : state;
    }

    case 'completeLightweightInitial': {
      const changes: { -readonly [K in keyof TargetJourney]?: TargetJourney[K] } = {
        initialCompletion: {
          completionKind: 'lightweight',
          completedAt: action.completedAt,
          nextReviewAt: action.nextReviewAt,
          nextReviewLabel: action.nextReviewLabel,
          schedulingHandoffBasis: 'study_completion',
          initialRating: action.rating,
        },
      };
      if (action.startLightweightRetention) {
        changes.lightweightRetention = {
          nextReviewAt: action.completedAt,
          nextReviewLabel: '现在可复习（原型）',
          reviewCount: 0,
          lapseCount: 0,
          relearning: false,
        };
      }
      return patch(state, action.targetId, changes);
    }

    case 'recordLightweightReview': {
      const current = state.byTarget[action.targetId].lightweightRetention;
      if (!current) return state;
      return patch(state, action.targetId, {
        lightweightRetention: {
          ...current,
          lastReviewRating: action.rating,
          lastReviewedAt: action.reviewedAt,
          nextReviewAt: action.nextReviewAt,
          nextReviewLabel: action.nextReviewLabel,
          reviewCount: current.reviewCount + 1,
          lapseCount: current.lapseCount + (action.rating === 'again' ? 1 : 0),
          relearning: action.rating === 'again',
        },
      });
    }

    case 'clearLightweightRelearning': {
      const current = state.byTarget[action.targetId].lightweightRetention;
      if (!current || !current.relearning) return state;
      return patch(state, action.targetId, {
        lightweightRetention: { ...current, relearning: false },
      });
    }

    case 'recordStructuredRetention': {
      const previous = state.byTarget[action.targetId].structuredRetention;
      return patch(state, action.targetId, {
        structuredRetention: {
          lastReviewedAt: action.counted ? action.occurredAt : previous?.lastReviewedAt ?? null,
          nextReviewAt: new Date(action.dueAt).toISOString(),
          nextReviewLabel: relativeReviewLabel(action.dueAt, action.now),
          reviewCount: (previous?.reviewCount ?? 0) + (action.counted ? 1 : 0),
          lapseCount: action.lapses,
          lastOutcome: action.counted ? action.outcome : previous?.lastOutcome ?? null,
          relearning: action.relearningStage !== null,
          relearningStage: action.relearningStage,
          relearningCompletedAt: action.retestPassed
            ? action.occurredAt
            : previous?.relearningCompletedAt ?? null,
        },
      });
    }

    case 'advanceStructuredHandoffs': {
      if (action.targetIds.length === 0) return state;
      const byTarget = { ...state.byTarget };
      for (const targetId of action.targetIds) {
        const completion = byTarget[targetId].initialCompletion;
        if (!completion) continue;
        byTarget[targetId] = {
          ...byTarget[targetId],
          initialCompletion: {
            ...completion,
            nextReviewAt: new Date(action.dueAt).toISOString(),
            nextReviewLabel: '现在可复习（原型）',
          },
        };
      }
      return { ...state, byTarget };
    }

    case 'declareMastery': {
      if (state.declaredMasterySenseIds.has(action.senseId)) return state;
      const next = new Set(state.declaredMasterySenseIds);
      next.add(action.senseId);
      return { ...state, declaredMasterySenseIds: next };
    }

    case 'revokeMastery': {
      if (!state.declaredMasterySenseIds.has(action.senseId)) return state;
      const next = new Set(state.declaredMasterySenseIds);
      next.delete(action.senseId);
      return { ...state, declaredMasterySenseIds: next };
    }
  }
}
