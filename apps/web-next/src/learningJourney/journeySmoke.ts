/**
 * Deterministic smoke for the learning-journey reducer.
 *
 * 这些规则原先散在 App 的四个 useCallback 里，混着 storageService 读写和 toast，
 * 没法单独验：想知道"高保证毕业后交接写进了哪一份"，只能把应用跑完一遍。
 * 归一成纯 reducer 之后逐条断言。
 *
 * Run with `npm run smoke:journey`.
 */
import {
  INITIAL_JOURNEY,
  addedTargetIds,
  committedTargetIds,
  completedTargetIds,
  effectivePolicies,
  effectivePolicyFor,
  isDeclaredMastery,
  journeyFor,
  journeyReducer,
  preparationFor,
  preparations,
  relativeReviewLabel,
  type JourneyAction,
  type JourneyState,
} from './journeyState';
import {
  PROTOTYPE_LEARNING_TARGETS,
  PROTOTYPE_LEARNING_TARGET_ORDER,
  defaultRetentionTargetIdFor,
  type PrototypeLearningPolicy,
} from './prototypeLearning';
import { learningRuntimeCoordinator } from '../learningRuntime/runtimeCoordinator';
import { learningPolicyProfileRegistry } from '../learningRuntime/policyProfiles';
import { FIXED_LADDER_FIRST_RUNG } from '../learningRuntime/retentionStores';
import { retentionTargetIdFor } from '../learningRuntime/retentionScopes';
import { resolveLearnerRatedMemoryOutcome } from '../review/types';

const failures: string[] = [];
let checks = 0;
const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const apply = (state: JourneyState, ...actions: readonly JourneyAction[]): JourneyState =>
  actions.reduce(journeyReducer, state);

const POLICIES = learningPolicyProfileRegistry.list().map((profile) => profile.profileId);
/** 首学与保持都走结构化的方式；毕业规则只对这一类生效。 */
const STRUCTURED_POLICY = POLICIES.find((policy) =>
  learningRuntimeCoordinator.surfaceFor(policy, 'initial_learning') === 'structured_session');
const LIGHTWEIGHT_POLICY = POLICIES.find((policy) =>
  learningRuntimeCoordinator.surfaceFor(policy, 'initial_learning') === 'lightweight_initial');
/** 保持事实归谁持有。毕业时开什么、到期时间从哪来，都由它决定。 */
const retentionStoreOf = (policy: PrototypeLearningPolicy) =>
  learningRuntimeCoordinator.retentionStoreFor(policy, 'retention_review');
/** 首学结构化、保持走固定档期的方式；毕业时应开一条轻量保持。 */
const STRUCTURED_TO_LADDER = POLICIES.find((policy) =>
  learningRuntimeCoordinator.surfaceFor(policy, 'initial_learning') === 'structured_session'
  && retentionStoreOf(policy) === 'fixed_ladder');

/* ---------- 初始状态 ---------- */

check('每条 Target 都有记录', PROTOTYPE_LEARNING_TARGET_ORDER.every(
  (targetId) => journeyFor(INITIAL_JOURNEY, targetId) !== undefined));
check('出厂已加入两条', addedTargetIds(INITIAL_JOURNEY).length === 2);
check('borrow-receive 未加入', !journeyFor(INITIAL_JOURNEY, 'borrow-receive').added);
check('tactful-expression 内容准备中',
  preparationFor(INITIAL_JOURNEY, 'tactful-expression') === 'preparing');
check('出厂无锁定', committedTargetIds(INITIAL_JOURNEY).size === 0);
check('出厂无完成', completedTargetIds(INITIAL_JOURNEY).size === 0);

/* ---------- 生效方式的优先级：锁定 > 单独选 > 已加入的建议 > 默认 ---------- */

check('未加入时用全局默认',
  effectivePolicyFor(INITIAL_JOURNEY, 'borrow-receive') === INITIAL_JOURNEY.defaultPolicy);
check('已加入时用 Target 自带建议',
  effectivePolicyFor(INITIAL_JOURNEY, 'lend-give')
    === PROTOTYPE_LEARNING_TARGETS['lend-give'].policy);

for (const policy of POLICIES) {
  const picked = apply(INITIAL_JOURNEY, {
    type: 'selectTargetPolicy', targetId: 'lend-give', policy,
  });
  check(`单独选过 ${policy} 后优先于建议`,
    effectivePolicyFor(picked, 'lend-give') === policy);
  const other = POLICIES.find((candidate) => candidate !== policy) ?? policy;
  const locked = apply(picked, { type: 'commitPolicies', entries: [{ targetId: 'lend-give', policy: other }] });
  check(`锁定 ${other} 后优先于单独选的 ${policy}`,
    effectivePolicyFor(locked, 'lend-give') === other);
  check('选方式时同步重算准备状态',
    journeyFor(picked, 'lend-give').preparation !== null);
}

/* ---------- 加入学习：一次事件改三件事 ---------- */

const added = apply(INITIAL_JOURNEY, { type: 'addTarget', targetId: 'borrow-receive' });
const addedJourney = journeyFor(added, 'borrow-receive');
check('加入后 added 为真', addedJourney.added);
check('加入时把当时的默认方式落下来', addedJourney.policy === INITIAL_JOURNEY.defaultPolicy);
check('加入时算出准备状态', addedJourney.preparation !== null);
check('加入不影响别的 Target',
  journeyFor(added, 'lend-give') === journeyFor(INITIAL_JOURNEY, 'lend-give'));
check('已单独选过方式则加入时不覆盖', (() => {
  const other = POLICIES.find((p) => p !== INITIAL_JOURNEY.defaultPolicy)!;
  const picked = apply(INITIAL_JOURNEY,
    { type: 'selectTargetPolicy', targetId: 'borrow-receive', policy: other },
    { type: 'addTarget', targetId: 'borrow-receive' });
  return journeyFor(picked, 'borrow-receive').policy === other;
})());

/* ---------- Unified Planner：每日配额只占用一次 ---------- */

const plannedAt = '2026-09-04T09:00:00+08:00';
const planned = apply(added, {
  type: 'planInitialTargets',
  targetIds: ['lend-give', 'borrow-receive', 'borrow-receive'],
  plannedAt,
});
check('Planner 为已加入 Target 记录首次计划时间',
  journeyFor(planned, 'lend-give').initialPlannedAt === plannedAt
  && journeyFor(planned, 'borrow-receive').initialPlannedAt === plannedAt);
check('Planner 不为未加入 Target 占用配额', (() => {
  const attempted = apply(INITIAL_JOURNEY, {
    type: 'planInitialTargets',
    targetIds: ['borrow-receive'],
    plannedAt,
  });
  return journeyFor(attempted, 'borrow-receive').initialPlannedAt === null;
})());
check('重复计划不改写原始学习日', (() => {
  const replayed = apply(planned, {
    type: 'planInitialTargets',
    targetIds: ['lend-give'],
    plannedAt: '2026-09-05T09:00:00+08:00',
  });
  return journeyFor(replayed, 'lend-give').initialPlannedAt === plannedAt;
})());

/* ---------- 结构化毕业 ---------- */

if (!STRUCTURED_POLICY) {
  failures.push('注册表里没有结构化首学的方式，毕业规则无法验证');
  checks += 1;
} else {
  const committed = apply(added, {
    type: 'commitPolicies', entries: [{ targetId: 'borrow-receive', policy: STRUCTURED_POLICY }],
  });
  const now = Date.UTC(2026, 0, 1);
  const due = now + 3 * 24 * 3600 * 1000;
  const graduate = (state: JourneyState) => apply(state, {
    type: 'recordQueueInitialCompletions',
    completedRetentionTargetIds: [
      defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS['borrow-receive']),
    ],
    dueByRetentionTargetId: {
      [defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS['borrow-receive'])]: due,
    },
    completedAt: new Date(now).toISOString(),
    now,
  });

  const graduated = graduate(committed);
  const completion = journeyFor(graduated, 'borrow-receive').initialCompletion;
  check('毕业写下交接', completion !== null);
  check('交接标记为结构化毕业',
    completion?.completionKind === 'acquisition_graduation'
    && completion.schedulingHandoffBasis === 'acquisition_graduation'
    && completion.evidenceLevel === 'behavioral');

  if (retentionStoreOf(STRUCTURED_POLICY) === 'scheduler_memory') {
    check('保持归调度器时用它给的到期时间',
      completion?.nextReviewAt === new Date(due).toISOString()
      && completion.nextReviewLabel === relativeReviewLabel(due, now));
  }

  check('未锁定方式的 Target 不写交接',
    journeyFor(graduate(added), 'borrow-receive').initialCompletion === null);
  check('没毕业的 Sense 不写交接', journeyFor(apply(committed, {
    type: 'recordQueueInitialCompletions',
    completedRetentionTargetIds: [],
    dueByRetentionTargetId: {},
    completedAt: new Date(now).toISOString(),
    now,
  }), 'borrow-receive').initialCompletion === null);
  check('重复毕业不覆盖已有交接',
    graduate(graduated).byTarget === graduated.byTarget
    || journeyFor(graduate(graduated), 'borrow-receive').initialCompletion === completion);
  check('毕业后进入已完成集合', completedTargetIds(graduated).has('borrow-receive'));

  const targetWithoutRuntimeSense = 'tactful-expression';
  const targetWithoutRuntimeSenseRetentionId = defaultRetentionTargetIdFor(
    PROTOTYPE_LEARNING_TARGETS[targetWithoutRuntimeSense],
  );
  const completedWithoutRuntimeSense = apply(apply(INITIAL_JOURNEY, {
    type: 'commitPolicies',
    entries: [{ targetId: targetWithoutRuntimeSense, policy: STRUCTURED_POLICY }],
  }), {
    type: 'recordQueueInitialCompletions',
    completedRetentionTargetIds: [targetWithoutRuntimeSenseRetentionId],
    dueByRetentionTargetId: { [targetWithoutRuntimeSenseRetentionId]: due },
    completedAt: new Date(now).toISOString(),
    now,
  });
  check('Initial Completion 只依赖 Retention Target，不依赖内容层 sense identity',
    journeyFor(completedWithoutRuntimeSense, targetWithoutRuntimeSense).initialCompletion !== null);

  if (STRUCTURED_TO_LADDER) {
    const lw = graduate(apply(added, {
      type: 'commitPolicies',
      entries: [{ targetId: 'borrow-receive', policy: STRUCTURED_TO_LADDER }],
    }));
    check('保持走固定档期时同时开一条轻量保持',
      journeyFor(lw, 'borrow-receive').lightweightRetention !== null);
    check('轻量保持的第一档读 store 的交接投影（学习步 2：+10 分钟）',
      journeyFor(lw, 'borrow-receive').lightweightRetention?.nextReviewAt
        === new Date(now + FIXED_LADDER_FIRST_RUNG.delayMs).toISOString()
      && journeyFor(lw, 'borrow-receive').lightweightRetention?.nextReviewLabel
        === FIXED_LADDER_FIRST_RUNG.label);
  }
}

/* ---------- 轻量首学与轻量复习 ---------- */

if (!LIGHTWEIGHT_POLICY) throw new Error('注册表里没有轻量首学方式。');
const lightweightCommitted = apply(added, {
  type: 'commitPolicies',
  entries: [{ targetId: 'borrow-receive', policy: LIGHTWEIGHT_POLICY }],
});
const lwDone = apply(lightweightCommitted, {
  type: 'completeProtocolInitial',
  targetId: 'borrow-receive',
  rating: 'good',
  completedAt: '2026-01-01T00:00:00.000Z',
  nextReviewAt: '2026-01-04T00:00:00.000Z',
  nextReviewLabel: '3 天后',
  startLightweightRetention: true,
});
check('轻量首学写下交接',
  journeyFor(lwDone, 'borrow-receive').initialCompletion?.completionKind === 'study_completion'
  && journeyFor(lwDone, 'borrow-receive').initialCompletion?.schedulingHandoffBasis
    === 'protocol_completion'
  && journeyFor(lwDone, 'borrow-receive').initialCompletion?.evidenceLevel
    === 'non_evidentiary');
check('轻量首学带上评分',
  journeyFor(lwDone, 'borrow-receive').initialCompletion?.initialRating === 'good');
check('轻量首学开出轻量保持',
  journeyFor(lwDone, 'borrow-receive').lightweightRetention?.reviewCount === 0);
check('轻量保持的档期读交接投影，不另写一份',
  journeyFor(lwDone, 'borrow-receive').lightweightRetention?.nextReviewAt
    === '2026-01-04T00:00:00.000Z'
  && journeyFor(lwDone, 'borrow-receive').lightweightRetention?.nextReviewLabel === '3 天后');
check('不需要轻量保持时不开', journeyFor(apply(lightweightCommitted, {
  type: 'completeProtocolInitial',
  targetId: 'borrow-receive',
  rating: 'good',
  completedAt: '2026-01-01T00:00:00.000Z',
  nextReviewAt: '2026-01-04T00:00:00.000Z',
  nextReviewLabel: '3 天后',
  startLightweightRetention: false,
}), 'borrow-receive').lightweightRetention === null);
check('未锁定 Protocol 不能伪造 Initial Completion', journeyFor(apply(added, {
  type: 'completeProtocolInitial',
  targetId: 'borrow-receive',
  rating: 'good',
  completedAt: '2026-01-01T00:00:00.000Z',
  nextReviewAt: '2026-01-04T00:00:00.000Z',
  nextReviewLabel: '3 天后',
  startLightweightRetention: true,
}), 'borrow-receive').initialCompletion === null);
check('Initial Completion 重放不改写原始 Scheduling Handoff', apply(lwDone, {
  type: 'completeProtocolInitial',
  targetId: 'borrow-receive',
  rating: 'hard',
  completedAt: '2026-01-02T00:00:00.000Z',
  nextReviewAt: '2026-01-05T00:00:00.000Z',
  nextReviewLabel: '4 天后',
  startLightweightRetention: true,
}) === lwDone);

const reviewed = apply(lwDone, {
  type: 'recordLightweightReview',
  targetId: 'borrow-receive',
  outcome: resolveLearnerRatedMemoryOutcome('again'),
  reviewedAt: '2026-01-04T00:00:00.000Z',
  nextReviewAt: '2026-01-04T00:10:00.000Z',
  nextReviewLabel: '10 分钟后',
});
const lwRetention = journeyFor(reviewed, 'borrow-receive').lightweightRetention;
check('轻量复习累加次数', lwRetention?.reviewCount === 1);
check('again 计一次 learner-rated 遗忘并进入重学',
  lwRetention?.lapseCount === 1
  && lwRetention.relearning === true
  && lwRetention.lastMemoryOutcome?.basis === 'learner_rated'
  && lwRetention.lastMemoryOutcome.grade === 'again'
  && lwRetention.lastMemoryOutcome.evidenceLevel === 'self_report');
check('修复完成后退出重学',
  journeyFor(apply(reviewed, {
    type: 'clearLightweightRelearning', targetId: 'borrow-receive',
  }), 'borrow-receive').lightweightRetention?.relearning === false);
check('没有轻量保持时复习是空操作',
  apply(INITIAL_JOURNEY, {
    type: 'recordLightweightReview',
    targetId: 'lend-give',
    outcome: resolveLearnerRatedMemoryOutcome('good'),
    reviewedAt: '2026-01-04T00:00:00.000Z',
    nextReviewAt: '2026-01-07T00:00:00.000Z',
    nextReviewLabel: '3 天后',
  }) === INITIAL_JOURNEY);

/* ---------- 结构化保持：累加与延续由 reducer 负责 ---------- */

const base = { targetId: 'lend-give', dueAt: Date.UTC(2026, 0, 5), lapses: 1, now: Date.UTC(2026, 0, 1) } as const;
const settled = apply(INITIAL_JOURNEY, {
  type: 'recordStructuredRetention',
  ...base,
  occurredAt: '2026-01-01T00:00:00.000Z',
  counted: true,
  outcome: 'retrieval_failed',
  relearningStage: 'repair_pending',
  retestPassed: false,
});
check('结算记一次复习',
  journeyFor(settled, 'lend-give').structuredRetention?.reviewCount === 1);
check('结算记下结果与重学阶段', (() => {
  const retention = journeyFor(settled, 'lend-give').structuredRetention;
  return retention?.lastOutcome === 'retrieval_failed'
    && retention.relearning === true
    && retention.relearningStage === 'repair_pending';
})());

// 过程事件（不计一次结算）应延续上一次的结果，而不是把它抹成 null。
const progressed = apply(settled, {
  type: 'recordStructuredRetention',
  ...base,
  occurredAt: '2026-01-02T00:00:00.000Z',
  counted: false,
  outcome: null,
  relearningStage: null,
  retestPassed: true,
});
const progressedRetention = journeyFor(progressed, 'lend-give').structuredRetention;
check('过程事件不累加次数', progressedRetention?.reviewCount === 1);
check('过程事件延续上次结果', progressedRetention?.lastOutcome === 'retrieval_failed');
check('过程事件延续上次结算时间',
  progressedRetention?.lastReviewedAt === '2026-01-01T00:00:00.000Z');
check('复测通过写下重学完成时间',
  progressedRetention?.relearningCompletedAt === '2026-01-02T00:00:00.000Z');
check('重学阶段清空后退出重学', progressedRetention?.relearning === false);

/* ---------- 交接提前 ---------- */

const advanced = apply(lwDone, {
  type: 'advanceStructuredHandoffs',
  targetIds: ['borrow-receive'],
  dueAt: Date.UTC(2026, 0, 2),
});
check('交接被提前',
  journeyFor(advanced, 'borrow-receive').initialCompletion?.nextReviewAt
    === new Date(Date.UTC(2026, 0, 2)).toISOString());
check('没有交接的 Target 不被凭空造出',
  journeyFor(apply(INITIAL_JOURNEY, {
    type: 'advanceStructuredHandoffs', targetIds: ['lend-give'], dueAt: Date.now(),
  }), 'lend-give').initialCompletion === null);

/* ---------- 熟词声明 ---------- */

const masteryTargetId = 'lend-give';
const masteryRetentionTargetId = defaultRetentionTargetIdFor(
  PROTOTYPE_LEARNING_TARGETS[masteryTargetId],
);
const declared = apply(INITIAL_JOURNEY, {
  type: 'declareMastery',
  retentionTargetIds: [masteryRetentionTargetId],
});
check('声明熟词只作用于指定 Learning Target',
  isDeclaredMastery(declared, masteryTargetId)
  && !isDeclaredMastery(declared, 'borrow-receive'));
check('以后追加的独立 scope 不继承旧的 Target 级熟词声明',
  !declared.declaredMasteryRetentionTargetIds.has(
    retentionTargetIdFor(masteryTargetId, 'spelling_production'),
  ));
check('重复声明返回同一对象',
  journeyReducer(declared, {
    type: 'declareMastery',
    retentionTargetIds: [masteryRetentionTargetId],
  }) === declared);
check('撤销熟词',
  !isDeclaredMastery(
    apply(declared, {
      type: 'revokeMastery',
      retentionTargetIds: [masteryRetentionTargetId],
    }),
    masteryTargetId,
  ));
check('撤销未声明的返回同一对象',
  journeyReducer(INITIAL_JOURNEY, {
    type: 'revokeMastery',
    retentionTargetIds: [masteryRetentionTargetId],
  }) === INITIAL_JOURNEY);

/* ---------- 整表选择器与逐条选择器一致 ---------- */

for (const state of [INITIAL_JOURNEY, added, lwDone, reviewed, settled]) {
  for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
    check(`整表方式与逐条一致 (${targetId})`,
      effectivePolicies(state)[targetId] === effectivePolicyFor(state, targetId));
    check(`整表准备状态与逐条一致 (${targetId})`,
      preparations(state)[targetId] === preparationFor(state, targetId));
  }
}

/* ---------- 无变化的动作返回同一对象 ---------- */

check('重复选同一个默认方式返回同一对象',
  journeyReducer(INITIAL_JOURNEY, {
    type: 'selectDefaultPolicy', policy: INITIAL_JOURNEY.defaultPolicy,
  }) === INITIAL_JOURNEY);
check('空的锁定列表返回同一对象',
  journeyReducer(INITIAL_JOURNEY, { type: 'commitPolicies', entries: [] }) === INITIAL_JOURNEY);
check('空的计划列表返回同一对象',
  journeyReducer(INITIAL_JOURNEY, {
    type: 'planInitialTargets', targetIds: [], plannedAt: new Date().toISOString(),
  }) === INITIAL_JOURNEY);
check('空的交接提前返回同一对象',
  journeyReducer(INITIAL_JOURNEY, {
    type: 'advanceStructuredHandoffs', targetIds: [], dueAt: Date.now(),
  }) === INITIAL_JOURNEY);

console.log(`learning journey smoke: ${checks} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
