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
 * useJourneyState 将这份状态提交到隔离的本机检查点；reducer 保持纯函数。
 */
import {
  PROTOTYPE_LEARNING_TARGETS,
  PROTOTYPE_LEARNING_TARGET_ORDER,
  readinessForPolicy,
  defaultRetentionTargetIdFor,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from './prototypeLearning';
import { learningPolicyProfileRegistry } from '../learningRuntime/policyProfiles';
import {
  initialCompletionContractOf,
  orchestrationRegistry,
  type InitialLearningCompletionKind,
  type LearningEvidenceLevel,
  type SchedulingHandoffBasis,
} from '../learningRuntime/orchestrations';
import { learningRuntimeCoordinator } from '../learningRuntime/runtimeCoordinator';
import {
  retentionStoreRegistry,
  IMMEDIATE_REVIEW_LABEL,
} from '../learningRuntime/retentionStores';
import type { RelearningCycleStage } from '../engine/types';
import type {
  LearnerRatedMemoryOutcome,
} from '../review/types';
import type { MemoryOutcomeBasis } from '@sensa/learning-kernel';

/* ============================================================
   每条 Target 的记录
   ============================================================ */

/** 首次学习的完成交接：完成方式、完成时间、以及交给谁安排下一次。 */
export interface InitialLearningCompletion {
  readonly completionKind: InitialLearningCompletionKind;
  readonly protocolOutcome: string;
  readonly completedAt: string;
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
  readonly schedulingHandoffBasis: SchedulingHandoffBasis;
  readonly evidenceLevel: LearningEvidenceLevel;
  readonly learnerVisibleClaim: string;
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
  readonly lastMemoryOutcome?: LearnerRatedMemoryOutcome<PrototypeLightweightRating>;
  readonly lastReviewedAt?: string;
}

/** 结构化保持：由 FSRS 调度，这里只是它在界面上的投影。 */
export interface StructuredRetention {
  readonly lastReviewedAt: string | null;
  readonly nextReviewAt: string;
  readonly nextReviewLabel: string;
  readonly reviewCount: number;
  readonly lapseCount: number;
  readonly lastOutcome: MemoryOutcomeBasis | null;
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
  /**
   * Unified Planner 首次把这条 Target 纳入某个本地学习日的时间。
   *
   * 它是 Study Plan 配额已经被占用的事实，不是 Protocol 窗口或 preset
   * 批量大小。即使 Target 随后开始、完成或暂时变得不可运行，这个事实也不
   * 回退，因而完成一条 Target 不会让当天的配额自动补进下一条。
   */
  readonly initialPlannedAt: string | null;
  readonly initialCompletion: InitialLearningCompletion | null;
  readonly lightweightRetention: LightweightRetention | null;
  readonly structuredRetention: StructuredRetention | null;
}

const EMPTY_JOURNEY: TargetJourney = {
  added: false,
  policy: null,
  preparation: null,
  committedPolicy: null,
  initialPlannedAt: null,
  initialCompletion: null,
  lightweightRetention: null,
  structuredRetention: null,
};

export interface JourneyState {
  readonly defaultPolicy: PrototypeLearningPolicy;
  /** 每条 Target 都有记录，字段可以为 null——不存在"这条 Target 不在表里"。 */
  readonly byTarget: Readonly<Record<PrototypeLearningTargetId, TargetJourney>>;
  /**
   * Declared Mastery 事实落在 Retention Target。Target 级操作批量写入当时已有的
   * scopes，因此以后新增的 scope 不会继承旧声明。
   */
  readonly declaredMasteryRetentionTargetIds: ReadonlySet<string>;
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

/** 当前只有 default scope；Target 级投影读取它对应的 Retention Target 事实。 */
export const isDeclaredMastery = (
  state: JourneyState,
  targetId: PrototypeLearningTargetId,
): boolean => state.declaredMasteryRetentionTargetIds.has(
  defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]),
);

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
  declaredMasteryRetentionTargetIds: new Set<string>(),
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
      readonly type: 'planInitialTargets';
      readonly targetIds: readonly PrototypeLearningTargetId[];
      readonly plannedAt: string;
    }
  | {
      readonly type: 'commitPolicies';
      readonly entries: ReadonlyArray<{
        readonly targetId: PrototypeLearningTargetId;
        readonly policy: PrototypeLearningPolicy;
      }>;
    }
  /**
   * Queue 型 Protocol 的首学完成。只有已锁定方式、且这次确实完成的
   * Target 才写交接；完成声称和保持落点由该 Profile 的 Orchestration /
   * Retention Store 决定。已有交接的不覆盖。
   */
  | {
      readonly type: 'recordQueueInitialCompletions';
      readonly completedRetentionTargetIds: readonly string[];
      /** retentionTargetId → FSRS 到期时间戳。只有 scheduler store 才用得到。 */
      readonly dueByRetentionTargetId: Readonly<Record<string, number>>;
      readonly completedAt: string;
      readonly now: number;
    }
  /** 非命令式 Queue 的 Protocol 首学完成；出口语义仍由 Orchestration 声明。 */
  | {
      readonly type: 'completeProtocolInitial';
      readonly targetId: PrototypeLearningTargetId;
      readonly rating?: Exclude<PrototypeLightweightRating, 'again'>;
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
      readonly outcome: LearnerRatedMemoryOutcome<PrototypeLightweightRating>;
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
      readonly outcome: MemoryOutcomeBasis | null;
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
  | { readonly type: 'declareMastery'; readonly retentionTargetIds: readonly string[] }
  | { readonly type: 'revokeMastery'; readonly retentionTargetIds: readonly string[] };

/**
 * 这条 Policy 的首学出口交出什么依据。见 learningRuntime/orchestrations.ts。
 *
 * 问的是编排取不取证，不是问用哪块屏跑：只有产出 assessment 的编排才有
 * Evidence，才谈得上 Acquisition Graduation。
 */
const initialCompletionContractFor = (
  policy: PrototypeLearningPolicy,
 ) => initialCompletionContractOf(orchestrationRegistry.get(
  learningRuntimeCoordinator.orchestrationFor(policy, 'initial_learning'),
));

/** 这条 Policy 的长期保持事实存在哪。见 learningRuntime/retentionStores.ts。 */
const retentionStoreFor = (policy: PrototypeLearningPolicy) =>
  retentionStoreRegistry.get(
    learningRuntimeCoordinator.retentionStoreFor(policy, 'retention_review'),
  );

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

    case 'planInitialTargets': {
      if (action.targetIds.length === 0) return state;
      const byTarget = { ...state.byTarget };
      let changed = false;
      for (const targetId of new Set(action.targetIds)) {
        const journey = byTarget[targetId];
        if (!journey.added || journey.initialPlannedAt !== null) continue;
        byTarget[targetId] = { ...journey, initialPlannedAt: action.plannedAt };
        changed = true;
      }
      return changed ? { ...state, byTarget } : state;
    }

    case 'commitPolicies': {
      if (action.entries.length === 0) return state;
      const byTarget = { ...state.byTarget };
      for (const { targetId, policy } of action.entries) {
        byTarget[targetId] = { ...byTarget[targetId], committedPolicy: policy };
      }
      return { ...state, byTarget };
    }

    case 'recordQueueInitialCompletions': {
      const completed = new Set(action.completedRetentionTargetIds);
      const byTarget = { ...state.byTarget };
      let changed = false;
      for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
        const journey = byTarget[targetId];
        const policy = journey.committedPolicy;
        const retentionTargetId = defaultRetentionTargetIdFor(
          PROTOTYPE_LEARNING_TARGETS[targetId],
        );
        if (
          !policy
          || !completed.has(retentionTargetId)
        ) continue;

        const retentionStore = retentionStoreFor(policy);
        const changes: { -readonly [K in keyof TargetJourney]?: TargetJourney[K] } = {};

        // reducer 是纯的，所以这里注入的"调度记忆"就是调用点带来的那份到期表。
        // 同一份 store 定义在 App 那边接的是 storageService。
        const handoff = retentionStore.openHandoff({
          completedAt: action.completedAt,
          openSchedulerDue: () =>
            action.dueByRetentionTargetId[retentionTargetId] ?? null,
          reviewLabel: (dueAt) => relativeReviewLabel(dueAt, action.now),
        });
        // 毕业只发生一次：已有交接的不覆盖。
        if (!journey.initialCompletion) {
          const completion = initialCompletionContractFor(policy);
          changes.initialCompletion = {
            completionKind: completion.completionKind,
            protocolOutcome: completion.protocolOutcome,
            completedAt: action.completedAt,
            nextReviewAt: handoff.nextReviewAt,
            nextReviewLabel: handoff.nextReviewLabel,
            schedulingHandoffBasis: completion.handoffBasis,
            evidenceLevel: completion.evidenceLevel,
            learnerVisibleClaim: completion.learnerVisibleClaim,
          };
        }
        if (retentionStore.opensJourneyLadder && !journey.lightweightRetention) {
          changes.lightweightRetention = {
            // 档期读 store 的交接投影（第一档 = 学习步 2），不在这里另写一份。
            nextReviewAt: handoff.nextReviewAt,
            nextReviewLabel: handoff.nextReviewLabel,
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

    case 'completeProtocolInitial': {
      const currentJourney = journeyFor(state, action.targetId);
      // Initial Completion is a one-time fact about a concrete, version-pinned
      // Protocol Run. An uncommitted policy has no such Run, and replay must
      // not rewrite the original Scheduling Handoff.
      if (!currentJourney.committedPolicy || currentJourney.initialCompletion) return state;
      const policy = currentJourney.committedPolicy;
      const completion = initialCompletionContractFor(policy);
      const changes: { -readonly [K in keyof TargetJourney]?: TargetJourney[K] } = {
        initialCompletion: {
          completionKind: completion.completionKind,
          protocolOutcome: completion.protocolOutcome,
          completedAt: action.completedAt,
          nextReviewAt: action.nextReviewAt,
          nextReviewLabel: action.nextReviewLabel,
          // 同一处推导：轻量首学不出 assessment，所以它交出的是 Study
          // Completion。写死常量会让这条依据脱离编排的声明。
          schedulingHandoffBasis: completion.handoffBasis,
          evidenceLevel: completion.evidenceLevel,
          learnerVisibleClaim: completion.learnerVisibleClaim,
          ...(action.rating ? { initialRating: action.rating } : {}),
        },
      };
      if (action.startLightweightRetention) {
        changes.lightweightRetention = {
          // 档期读 App 算好的交接投影（第一档 = 学习步 2），与
          // initialCompletion 那份同源，不在这里另写一份。
          nextReviewAt: action.nextReviewAt,
          nextReviewLabel: action.nextReviewLabel,
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
      const rating = action.outcome.grade;
      return patch(state, action.targetId, {
        lightweightRetention: {
          ...current,
          lastReviewRating: rating,
          lastMemoryOutcome: action.outcome,
          lastReviewedAt: action.reviewedAt,
          nextReviewAt: action.nextReviewAt,
          nextReviewLabel: action.nextReviewLabel,
          reviewCount: current.reviewCount + 1,
          lapseCount: current.lapseCount + (rating === 'again' ? 1 : 0),
          relearning: rating === 'again',
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
            nextReviewLabel: IMMEDIATE_REVIEW_LABEL,
          },
        };
      }
      return { ...state, byTarget };
    }

    case 'declareMastery': {
      const next = new Set(state.declaredMasteryRetentionTargetIds);
      action.retentionTargetIds.forEach((retentionTargetId) => {
        if (retentionTargetId.trim().length > 0) next.add(retentionTargetId);
      });
      if (next.size === state.declaredMasteryRetentionTargetIds.size) return state;
      return { ...state, declaredMasteryRetentionTargetIds: next };
    }

    case 'revokeMastery': {
      const next = new Set(state.declaredMasteryRetentionTargetIds);
      action.retentionTargetIds.forEach((retentionTargetId) => next.delete(retentionTargetId));
      if (next.size === state.declaredMasteryRetentionTargetIds.size) return state;
      return { ...state, declaredMasteryRetentionTargetIds: next };
    }
  }
}
