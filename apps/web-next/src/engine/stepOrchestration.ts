/**
 * 编排 seam —— 一次运行的下一步由谁产出。
 *
 * 落地前，"出哪一步"硬编码在两个队列类里：`LearnQueue.nextDefinition` /
 * `repairDefinition`，`ReviewQueue.nextDefinition` / `repairDefinition`。
 * 四个方法说的其实是同一个二分：
 *
 *     有没有待修复的依据？没有 → 出下一步；有 → 出这一步的定向修复。
 *
 * `learning-extensibility-architecture.md` §4 把这个二分定为插件作者要实现的
 * 全部内容：**新增一种模式时只实现 `fresh` 与 `repair` 两个入口**，不必回答
 * "我的 relearning 协议是什么"——relearning 复用 acquisition 的编排机制，
 * 正如 Anki 的 relearning steps 复用 learning steps。
 *
 * 边界（§6 不可插内核）：插件决定**练什么、怎么练、用什么卡**，不决定
 * **这次算不算数、下次什么时候来**。所以这里出的只是 Step *定义*；Gate 结算、
 * Evidence 计数、Memory Outcome 与 FSRS 全部留在队列里。修复依据也由宿主给出
 * 而不由插件推断——"这个 Gate 失败了、失败在哪一步"是学习者本地状态。
 *
 * 三件刻意为之的事：
 *
 *  1. **`fresh` 收候选集而不是单条。** 交错与间隔是编排的一部分："先出谁"和
 *     "出哪一步"是同一个决定。选中的候选若带着依据，`fresh` 委派给 `repair`：
 *     两条路参与同一次选择，带依据的 Target 不会因此退出竞争。这正是落地前的
 *     顺序——先选包，再分叉。
 *  2. **候选视图里没有 content。** 出哪一步不取决于卡面：两处产出逻辑从来只读
 *     `actions` / `reviewActions` / `repairActions` 与学习者本地状态。seam 因此
 *     不需要 `TContent` 泛型，`smoke:orchestration` 把这一点钉住。
 *  3. **两套实现的间隔规则不同，没有被抹平。** 首学编排里没出过步的 Target
 *     永远合格（`lastStepOrdinal < 0` 短路），复习编排不短路。抹平任何一条
 *     都是可观察行为变化。
 */
import type {
  AcquisitionGateStatus,
  LearningCapability,
  LearningStepIntent,
  RepairResourceRole,
  ReviewDiagnosticFacts,
  SchedulablePackage,
  ScheduledActionDefinition,
} from './types';
import type { ReviewAssessmentKind } from '../review/types';
import { canProduceReviewMemoryOutcome } from '../review/types';

/**
 * 编排的身份。今天四套：两套由队列驱动（本文件实现），两套是固定屏
 * （`LightweightRuntimeStartScreen` / `LightweightReviewRuntimeScreen`）。
 * 它们同样要在登记表里声明自己产出哪些 intent——出口依据由此推出。
 */
export type OrchestrationId =
  | 'lightweight_study'
  | 'lightweight_retention'
  | 'structured_acquisition'
  | 'structured_retention';

/** 出这一步时的排布参数。插件可以只用其中一部分。 */
export interface StepPlan {
  /** 这一步的序号，从 1 起。间隔与轮换都以它为基准。 */
  readonly ordinal: number;
  /** 同时在学的 Target 上限；只有首学编排用得到。 */
  readonly activeWindow: number;
  /** 同一条 Target 两次出现之间至少隔几步。 */
  readonly minGap: number;
}

/** 每个候选都要回答的三件事；其余字段由各编排自己定义。 */
export interface OrchestrationCandidate<TBasis> {
  /** 队列内的稳定标识。宿主按它把选中的候选找回去。 */
  readonly targetKey: string;
  /** 上一次为它出步的序号；-1 表示还没出过。 */
  readonly lastStepOrdinal: number;
  /** 待修复依据；非 null 时 `fresh` 委派给 `repair`。 */
  readonly repairBasis: TBasis | null;
}

export interface OrchestratedStep<TCandidate> {
  readonly target: TCandidate;
  readonly definition: ScheduledActionDefinition;
}

/** 插件作者要实现的全部内容。 */
export interface StepOrchestration<
  TCandidate extends OrchestrationCandidate<TBasis>,
  TBasis,
> {
  readonly orchestrationId: OrchestrationId;
  /** 推进一步：候选集进，选中的候选与它的下一步出。null = 这一轮出不了步。 */
  readonly fresh: (
    candidates: readonly TCandidate[],
    plan: StepPlan,
  ) => OrchestratedStep<TCandidate> | null;
  /** 定向修复：依据由宿主给出。 */
  readonly repair: (
    candidate: TCandidate,
    basis: TBasis,
    plan: StepPlan,
  ) => ScheduledActionDefinition | null;
}

/* ============================================================
   读 Step 定义的共用谓词
   ============================================================ */

export function actionIntent(definition: ScheduledActionDefinition): LearningStepIntent {
  return definition.intent ?? 'assessment';
}

export function isAssessment(definition: ScheduledActionDefinition): boolean {
  return actionIntent(definition) === 'assessment';
}

/**
 * 讲解步。原先写作 `kind === 'introduction' && capability === 'introduction'
 * && isAssessment(action)`——最后一项是在排除 repair，可它同时也把讲解说成了
 * 一次测评。改问 intent 之后，这句话就只说它该说的那件事。
 */
export function isIntroduction(definition: ScheduledActionDefinition): boolean {
  return definition.kind === 'introduction' && actionIntent(definition) === 'instruction';
}

/** 这条内容清单要求的 Gate。声明顺序保留，重复只算一次。 */
export function requiredGatesOf(
  inventory: SchedulablePackage<unknown>,
): LearningCapability[] {
  return inventory.requiredCapabilities.filter(
    (capability, index, all) => all.indexOf(capability) === index,
  );
}

/** 某条能力下可独立检验的首学步。修复步不在其中——它不解决 Gate。 */
export function acquisitionGateActions(
  inventory: SchedulablePackage<unknown>,
  capability: LearningCapability,
): ScheduledActionDefinition[] {
  return inventory.actions.filter((action) =>
    action.capability === capability
    && action.kind === 'acquisition_gate'
    && isAssessment(action));
}

export function reviewAssessmentKindFor(
  capability: LearningCapability | null,
): ReviewAssessmentKind | null {
  switch (capability) {
    case 'contextual_recognition': return 'context_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_discrimination': return 'boundary_contrast';
    default: return null;
  }
}

export function isRetentionAssessment(action: ScheduledActionDefinition): boolean {
  const assessmentKind = reviewAssessmentKindFor(action.capability);
  return action.kind === 'retention_review'
    && action.intent !== 'repair'
    && assessmentKind !== null
    && canProduceReviewMemoryOutcome(assessmentKind);
}

export function isRelearningAssessment(action: ScheduledActionDefinition): boolean {
  return action.kind === 'relearning_gate'
    && action.intent !== 'repair'
    && reviewAssessmentKindFor(action.capability) !== null;
}

export function isPackageRepair(
  action: ScheduledActionDefinition,
  capability: LearningCapability,
): boolean {
  return action.kind === 'acquisition_gate'
    && action.intent === 'repair'
    && action.capability === capability
    && action.repairResourceRef?.source === 'package_declared'
    && Boolean(action.repairResourceRef.key);
}

function repairRoleFor(capability: LearningCapability): RepairResourceRole {
  switch (capability) {
    case 'meaning_to_form_recall':
      return 'l1_bridge';
    case 'contextual_recognition':
    case 'novel_context_transfer':
    case 'boundary_discrimination':
      return 'experience_recap';
  }
}

/** 最久没出过的先出；同样久时按稳定标识定序，避免依赖数组顺序。 */
function chooseOldest<TCandidate extends OrchestrationCandidate<unknown>>(
  candidates: readonly TCandidate[],
): TCandidate | null {
  return [...candidates].sort((left, right) =>
    left.lastStepOrdinal - right.lastStepOrdinal
    || left.targetKey.localeCompare(right.targetKey))[0] ?? null;
}

/* ============================================================
   首学编排：structured_acquisition
   ============================================================ */

export interface AcquisitionRepairBasis {
  readonly capability: LearningCapability;
  /** 失败在哪一步；null 表示状态里没有记（兼容更早的持久化状态）。 */
  readonly failedActionKey: string | null;
  /** 这条能力已经修过几次，决定修复步的 actionKey 后缀。 */
  readonly repairCount: number;
}

export interface AcquisitionCandidate extends OrchestrationCandidate<AcquisitionRepairBasis> {
  readonly inventory: SchedulablePackage<unknown>;
  readonly introduced: boolean;
  readonly gateStatus: Readonly<Record<LearningCapability, AcquisitionGateStatus>>;
  readonly lastAssessmentActionKey: Readonly<Partial<Record<LearningCapability, string>>>;
  readonly transferScenarioIndex: number;
}

/** minGap 是两次出现之间隔了几步；还没出过的永远合格。 */
function acquisitionEligible(candidate: AcquisitionCandidate, plan: StepPlan): boolean {
  return candidate.lastStepOrdinal < 0
    || plan.ordinal - candidate.lastStepOrdinal - 1 >= plan.minGap;
}

function acquisitionNextStep(
  candidate: AcquisitionCandidate,
): ScheduledActionDefinition | null {
  if (!candidate.introduced) {
    return candidate.inventory.actions.find(isIntroduction) ?? null;
  }
  const pending = requiredGatesOf(candidate.inventory)
    .find((capability) => candidate.gateStatus[capability] !== 'passed');
  if (!pending) return null;
  const actions = acquisitionGateActions(candidate.inventory, pending);
  if (actions.length === 0) return null;
  if (pending === 'novel_context_transfer') {
    return actions[candidate.transferScenarioIndex % actions.length] ?? actions[0];
  }
  const previousActionKey = candidate.lastAssessmentActionKey[pending];
  if (previousActionKey && actions.length > 1) {
    return actions.find((action) => action.actionKey !== previousActionKey) ?? actions[0];
  }
  return actions[0];
}

function acquisitionRepairStep(
  candidate: AcquisitionCandidate,
  basis: AcquisitionRepairBasis,
): ScheduledActionDefinition | null {
  const actions = acquisitionGateActions(candidate.inventory, basis.capability);
  const base = actions.find((action) => action.actionKey === basis.failedActionKey)
    ?? actions[0];
  if (!base) return null;
  const repairNumber = basis.repairCount + 1;
  const declaredRepair = candidate.inventory.repairActions?.find((action) =>
    action.capability === basis.capability && action.intent === 'repair');
  if (declaredRepair) {
    return {
      ...declaredRepair,
      actionKey: declaredRepair.actionKey === base.actionKey
        ? `${base.actionKey}.repair.${repairNumber}`
        : declaredRepair.actionKey,
      taskKey: null,
      kind: 'acquisition_gate',
      intent: 'repair',
      repairForActionKey: declaredRepair.repairForActionKey ?? base.actionKey,
      repairResourceRef: declaredRepair.repairResourceRef ?? {
        role: repairRoleFor(basis.capability),
        key: null,
        source: 'scheduler_fallback',
        fallbackReason: 'repair_binding_not_exposed',
      },
    };
  }
  return {
    actionKey: `${base.actionKey}.repair.${repairNumber}`,
    capability: basis.capability,
    taskKey: null,
    kind: 'acquisition_gate',
    intent: 'repair',
    repairForActionKey: base.actionKey,
    repairResourceRef: {
      role: repairRoleFor(basis.capability),
      key: null,
      source: 'scheduler_fallback',
      fallbackReason: 'repair_binding_not_exposed',
    },
  };
}

/**
 * 结构化首学的编排。
 *
 * 选择规则：窗口没满时新 Target 优先填窗口；满了就轮到最久没出的活跃 Target，
 * 让没跑完的循环获得公平，而不是反复挑发布顺序里的第一个。最后两条是显式的
 * 冷却回退——没有别的 Target 能满足 minGap 时（比如只有一条的 fixture），
 * 它不假装间隔已经满足。
 */
export const acquisitionOrchestration: StepOrchestration<
  AcquisitionCandidate,
  AcquisitionRepairBasis
> = {
  orchestrationId: 'structured_acquisition',
  fresh: (candidates, plan) => {
    const active = candidates.filter((candidate) => candidate.introduced);
    const unstarted = candidates.filter((candidate) => !candidate.introduced);
    const eligibleActive = active.filter((candidate) => acquisitionEligible(candidate, plan));
    const eligibleUnstarted = unstarted.filter((candidate) => acquisitionEligible(candidate, plan));

    let pool: readonly AcquisitionCandidate[];
    if (active.length < plan.activeWindow && eligibleUnstarted.length > 0) {
      pool = eligibleUnstarted;
    } else if (eligibleActive.length > 0) {
      pool = eligibleActive;
    } else if (active.length < plan.activeWindow && unstarted.length > 0) {
      // 还没出过步的 Target 一定合格，这条分支只是把意图写明：将来若加入
      // "新 Target 也要冷却"的策略，改动落在这里。
      pool = unstarted;
    } else if (active.length > 0) {
      pool = active;
    } else {
      pool = unstarted;
    }

    const chosen = chooseOldest(pool);
    if (!chosen) return null;
    const definition = chosen.repairBasis
      ? acquisitionRepairStep(chosen, chosen.repairBasis)
      : acquisitionNextStep(chosen);
    return definition ? { target: chosen, definition } : null;
  },
  repair: (candidate, basis) => acquisitionRepairStep(candidate, basis),
};

/* ============================================================
   长期编排：structured_retention
   ============================================================ */

export interface RetentionRepairBasis {
  readonly capability: LearningCapability;
  /** 这次修复挂回哪一次失败的复习。 */
  readonly failedReviewActionKey: string;
  readonly repairCount: number;
}

/** 修复已完成、等待独立重测。 */
export interface RetentionRetest {
  readonly capability: LearningCapability;
  readonly repairCount: number;
}

export interface RetentionCandidate extends OrchestrationCandidate<RetentionRepairBasis> {
  readonly inventory: SchedulablePackage<unknown>;
  /** 到期的长期复习。false 表示这条正在重学。 */
  readonly retaining: boolean;
  readonly retest: RetentionRetest | null;
  readonly diagnosticFacts?: ReviewDiagnosticFacts;
}

/**
 * 这次到期的复习该检验哪条能力。
 *
 * FSRS 的 reps/lapses 刻意不参与：它们回答"什么时候到期"，不回答"到期了考什么"。
 * 由诊断事实或确定性的清单轮换回答。
 */
function chooseRetentionAction(
  actions: readonly ScheduledActionDefinition[],
  diagnosticFacts: ReviewDiagnosticFacts | undefined,
  position: number,
): ScheduledActionDefinition | undefined {
  const preferredCapabilities = diagnosticFacts?.preferredCapabilities ?? [];
  for (const capability of preferredCapabilities) {
    const preferred = actions.find((action) => action.capability === capability);
    if (preferred) return preferred;
  }
  const lastCapability = diagnosticFacts?.lastCapability;
  const alternatives = lastCapability
    ? actions.filter((action) => action.capability !== lastCapability)
    : actions;
  const pool = alternatives.length > 0 ? alternatives : actions;
  return pool.length > 0 ? pool[position % pool.length] : undefined;
}

function retentionNextStep(
  candidate: RetentionCandidate,
  plan: StepPlan,
): ScheduledActionDefinition | null {
  if (candidate.retaining) {
    const actions = candidate.inventory.reviewActions.filter(isRetentionAssessment);
    return chooseRetentionAction(actions, candidate.diagnosticFacts, plan.ordinal) ?? null;
  }
  const retest = candidate.retest;
  if (!retest) return null;
  const actions = candidate.inventory.reviewActions.filter((action) =>
    isRelearningAssessment(action) && action.capability === retest.capability);
  return actions.length > 0
    ? actions[retest.repairCount % actions.length]!
    : null;
}

function retentionRepairStep(
  candidate: RetentionCandidate,
  basis: RetentionRepairBasis,
): ScheduledActionDefinition | null {
  // 重学必须消费经过审核的 Package 绑定；这套编排没有调度器自造内容的回退。
  const declaredRepair = candidate.inventory.repairActions?.find((action) =>
    isPackageRepair(action, basis.capability));
  if (!declaredRepair) return null;
  return {
    ...declaredRepair,
    actionKey: `${declaredRepair.actionKey}.relearning.${basis.repairCount + 1}`,
    taskKey: null,
    kind: 'acquisition_gate',
    intent: 'repair',
    repairForActionKey: basis.failedReviewActionKey,
    repairResourceRef: { ...declaredRepair.repairResourceRef! },
  };
}

/**
 * 到期复习与重学的编排。
 *
 * 间隔规则与首学不同：这里没有"还没出过就一定合格"的短路，所以第一轮
 * （ordinal 小于 minGap 时）全体不合格，走显式回退——它不声称间隔已满足。
 */
export const retentionOrchestration: StepOrchestration<
  RetentionCandidate,
  RetentionRepairBasis
> = {
  orchestrationId: 'structured_retention',
  fresh: (candidates, plan) => {
    const eligible = candidates.filter((candidate) =>
      plan.ordinal - candidate.lastStepOrdinal - 1 >= plan.minGap);
    const pool = eligible.length > 0 ? eligible : candidates;
    const chosen = chooseOldest(pool);
    if (!chosen) return null;
    const definition = chosen.repairBasis
      ? retentionRepairStep(chosen, chosen.repairBasis)
      : retentionNextStep(chosen, plan);
    return definition ? { target: chosen, definition } : null;
  },
  repair: (candidate, basis) => retentionRepairStep(candidate, basis),
};
