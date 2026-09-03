/**
 * Deterministic smoke for 编排 seam。
 *
 * 这一层要同时钉住两件事：
 *
 *  1. **声明不是注释。** 每套编排在登记表里声明自己产出哪些 intent，首学出口
 *     的交接依据由此推出。如果声明与实际产出脱节，`initialHandoffBasisOf`
 *     就会给出错误的依据——而 Scheduling Handoff 一生只发生一次，写错改不回来。
 *     所以这里拿真实内容把两套队列驱动的编排完整跑一遍，收集实际产出的 intent
 *     集合，与声明逐条核对。
 *  2. **抽出来的产出逻辑与落地前等价。** 新旧表达式的等价直接钉：
 *     `initialHandoffBasisFor(policy) === 'acquisition_graduation'` 必须与旧的
 *     `surfaceFor(policy, 'initial_learning') === 'structured_session'` 同真同假。
 *     整段队列行为的等价由既有的 `smoke:intent` / `smoke:flow` /
 *     `sensa:runtime-learning-smoke` 覆盖——它们跑的就是这两个队列。
 *
 * 另外钉住三条 seam 的设计前提：`fresh` 收候选集（带修复依据的 Target 不退出
 * 竞争）、`fresh` 委派 `repair` 与直接调用 `repair` 结果相同、以及产出与 content
 * 无关。
 *
 * Run with `npm run smoke:orchestration`.
 */
import { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';
import {
  LEARNING_PROTOCOL_PURPOSES,
  PROTOTYPE_LEARNING_POLICY_PROFILES,
  type PrototypeLearningPolicy,
} from '../learningRuntime/policyProfiles';
import {
  ORCHESTRATION_DEFINITIONS,
  OrchestrationRegistry,
  initialHandoffBasisOf,
  orchestrationRegistry,
  type OrchestrationDefinition,
} from '../learningRuntime/orchestrations';
import { learningRuntimeCoordinator } from '../learningRuntime/runtimeCoordinator';
import { LearnQueue } from './LearnQueue';
import { ReviewQueue } from './ReviewQueue';
import {
  acquisitionOrchestration,
  retentionOrchestration,
  type AcquisitionCandidate,
  type AcquisitionRepairBasis,
  type StepPlan,
} from './stepOrchestration';
import type {
  AcquisitionGateStatus,
  LearningCapability,
  LearningStepIntent,
  SchedulablePackage,
} from './types';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const sameSet = (
  left: readonly LearningStepIntent[],
  right: readonly LearningStepIntent[],
): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((item) => rightSet.has(item));
};

const POLICIES: readonly PrototypeLearningPolicy[] = ['lightweight', 'high_assurance'];

/* ============================================================
   A. 登记表与出口依据
   ============================================================ */

check('每条 Protocol Binding 声明的编排都在登记表里',
  PROTOTYPE_LEARNING_POLICY_PROFILES.every((profile) =>
    LEARNING_PROTOCOL_PURPOSES.every((purpose) => {
      const binding = profile.protocols[purpose];
      return orchestrationRegistry.get(binding.orchestrationId).orchestrationId
        === binding.orchestrationId;
    })));

check('未登记的编排直接抛，不静默退化', (() => {
  const empty = new OrchestrationRegistry([]);
  try {
    empty.get('structured_acquisition');
    return false;
  } catch { return true; }
})());

check('登记表里没有重复的编排身份',
  new Set(ORCHESTRATION_DEFINITIONS.map((definition) => definition.orchestrationId)).size
    === ORCHESTRATION_DEFINITIONS.length);

// 出口依据只有一条规则，且直接从 intent 轴推出。
check('产出 assessment 的编排才交出 Acquisition Graduation',
  initialHandoffBasisOf({
    orchestrationId: 'structured_acquisition',
    stepIntents: ['instruction', 'assessment'],
  } satisfies OrchestrationDefinition) === 'acquisition_graduation');

check('不产出 assessment 的编排只交出 Study Completion',
  initialHandoffBasisOf({
    orchestrationId: 'lightweight_study',
    stepIntents: ['instruction', 'practice', 'repair'],
  } satisfies OrchestrationDefinition) === 'study_completion');

check('practice 不取证——练但不产生 Evidence',
  initialHandoffBasisOf({
    orchestrationId: 'lightweight_study',
    stepIntents: ['practice'],
  } satisfies OrchestrationDefinition) === 'study_completion');

const basisFor = (policy: PrototypeLearningPolicy) => initialHandoffBasisOf(
  orchestrationRegistry.get(
    learningRuntimeCoordinator.orchestrationFor(policy, 'initial_learning'),
  ),
);

check('轻量首学交出 Study Completion', basisFor('lightweight') === 'study_completion');
check('高保证首学交出 Acquisition Graduation',
  basisFor('high_assurance') === 'acquisition_graduation');

// 落地前这条依据是靠 surface 名字回答的；两个表达式必须同真同假。
check('新旧表达式等价：取证毕业 ⟺ 旧的 structured_session 判断',
  POLICIES.every((policy) =>
    (basisFor(policy) === 'acquisition_graduation')
      === (learningRuntimeCoordinator.surfaceFor(policy, 'initial_learning')
        === 'structured_session')));

// §4：relearning 复用既有编排机制，插件作者只实现两个入口。
check('relearning 与 retention_review 声明同一套编排',
  PROTOTYPE_LEARNING_POLICY_PROFILES.every((profile) =>
    profile.protocols.relearning.orchestrationId
      === profile.protocols.retention_review.orchestrationId));

/* ============================================================
   B. 声明与实际产出一致
   ============================================================ */

const firstPackage = PROTOTYPE_LEARNING_PACKAGES[0]!;

const acquisitionIntents = (() => {
  const produced = new Set<LearningStepIntent>();
  const queue = new LearnQueue([firstPackage], { activeWindow: 1, minGap: 0 });
  let session = queue.getCurrentSession();
  let failedOnce = false;
  // 30 步足够跑完一个 Package 外加一次失败/修复/重测；死循环时会因为
  // 收集不到 assessment 而在下面的断言里露出来。
  for (let step = 0; session !== null && step < 30; step += 1) {
    produced.add(session.action.intent);
    if (session.action.intent === 'instruction') {
      queue.completeIntroduction();
    } else if (session.action.intent === 'repair') {
      queue.settle(true);
    } else if (!failedOnce) {
      failedOnce = true;
      queue.settle(false);
    } else {
      queue.settle(true);
    }
    session = queue.next();
  }
  return { produced: [...produced], done: queue.isDone() };
})();

check('结构化首学能跑完', acquisitionIntents.done);
check('结构化首学实际产出的 intent 集合等于登记表的声明',
  sameSet(
    acquisitionIntents.produced,
    orchestrationRegistry.get('structured_acquisition').stepIntents,
  ));

const retentionIntents = (() => {
  const produced = new Set<LearningStepIntent>();
  const queue = new ReviewQueue([{
    package: firstPackage,
    dueAt: 0,
    reps: 1,
    lapses: 0,
    phase: 'retaining' as const,
  }]);
  let session = queue.getCurrentSession();
  let failedOnce = false;
  for (let step = 0; session !== null && step < 30; step += 1) {
    produced.add(session.action.intent);
    if (session.action.intent === 'repair') {
      queue.completeRepair();
    } else {
      const correct = failedOnce;
      failedOnce = true;
      queue.settle({
        assessmentId: `${session.action.actionKey}.orchestration-smoke`,
        kind: session.assessmentKind,
        focusDimension: '义项边界',
        correct,
        responseId: 'smoke',
        memoryOutcome: 'retrieval_failed',
        evidenceEligible: false,
      });
    }
    session = queue.next();
  }
  return { produced: [...produced], done: queue.isDone() };
})();

check('结构化复习能跑完（失败 → 修复 → 独立重测）', retentionIntents.done);
check('结构化复习实际产出的 intent 集合等于登记表的声明',
  sameSet(
    retentionIntents.produced,
    orchestrationRegistry.get('structured_retention').stepIntents,
  ));

check('队列驱动的两套编排都不产出 practice——它是留给插件的第四种意图',
  [...acquisitionIntents.produced, ...retentionIntents.produced]
    .every((intent) => intent !== 'practice'));

check('轻量首学声明里没有 assessment，所以它取不了证',
  !orchestrationRegistry.get('lightweight_study').stepIntents.includes('assessment'));

/* ============================================================
   C. fresh / repair 两入口
   ============================================================ */

const emptyGates = (): Record<LearningCapability, AcquisitionGateStatus> => ({
  contextual_recognition: 'unresolved',
  meaning_to_form_recall: 'unresolved',
  novel_context_transfer: 'unresolved',
  boundary_discrimination: 'unresolved',
});

const gateCapability = firstPackage.requiredCapabilities[0]!;
const gateActionKey = firstPackage.actions.find((action) =>
  action.capability === gateCapability && action.kind === 'acquisition_gate')!.actionKey;

const basis: AcquisitionRepairBasis = {
  capability: gateCapability,
  failedActionKey: gateActionKey,
  repairCount: 0,
};

const candidate = (
  overrides: Partial<AcquisitionCandidate> & { targetKey: string },
): AcquisitionCandidate => ({
  lastStepOrdinal: -1,
  repairBasis: null,
  inventory: firstPackage,
  introduced: true,
  gateStatus: emptyGates(),
  lastAssessmentActionKey: {},
  transferScenarioIndex: 0,
  ...overrides,
});

const plan = (overrides: Partial<StepPlan> = {}): StepPlan => ({
  ordinal: 7,
  activeWindow: 3,
  minGap: 0,
  ...overrides,
});

// 关键前提：带修复依据的 Target 与其他 Target 参与同一次选择。把它挪到
// `fresh` 之外单独处理，就会让它插队或者被饿死——两者都是可观察行为变化。
const repairWins = acquisitionOrchestration.fresh([
  candidate({ targetKey: 'a', lastStepOrdinal: 0, repairBasis: basis }),
  candidate({ targetKey: 'b', lastStepOrdinal: 5 }),
], plan());
check('带修复依据的候选按同一条"最久没出的先出"规则胜出',
  repairWins?.target.targetKey === 'a' && repairWins.definition.intent === 'repair');

const freshWins = acquisitionOrchestration.fresh([
  candidate({ targetKey: 'a', lastStepOrdinal: 9, repairBasis: basis }),
  candidate({ targetKey: 'b', lastStepOrdinal: 0 }),
], plan());
check('带修复依据也不插队：更久没出的那条仍然先出',
  freshWins?.target.targetKey === 'b' && freshWins.definition.intent !== 'repair');

const delegated = acquisitionOrchestration.fresh(
  [candidate({ targetKey: 'a', repairBasis: basis })],
  plan(),
);
const direct = acquisitionOrchestration.repair(
  candidate({ targetKey: 'a', repairBasis: basis }),
  basis,
  plan(),
);
check('fresh 委派得到的修复步与直接调 repair 完全一致',
  JSON.stringify(delegated?.definition) === JSON.stringify(direct));

check('修复步的意图是 repair，且挂回失败的那一步',
  direct?.intent === 'repair'
  && direct.capability === gateCapability
  && direct.repairForActionKey === gateActionKey);

check('修复次数决定 actionKey 后缀，不复用被修复那一步的身份', (() => {
  const second = acquisitionOrchestration.repair(
    candidate({ targetKey: 'a', repairBasis: { ...basis, repairCount: 1 } }),
    { ...basis, repairCount: 1 },
    plan(),
  );
  return second !== null
    && second.actionKey !== direct!.actionKey
    && second.actionKey !== gateActionKey;
})());

check('没有依据时 fresh 出的是首学的下一步，不是修复', (() => {
  const step = acquisitionOrchestration.fresh(
    [candidate({ targetKey: 'a' })],
    plan(),
  );
  return step !== null && step.definition.intent !== 'repair';
})());

check('还没讲解过的候选，第一步是讲解', (() => {
  const step = acquisitionOrchestration.fresh(
    [candidate({ targetKey: 'a', introduced: false })],
    plan(),
  );
  return step?.definition.kind === 'introduction'
    && step.definition.intent === 'instruction';
})());

/* ---------- 选择规则 ---------- */

check('窗口已满时轮到活跃的那条，新 Target 不再进入', (() => {
  const step = acquisitionOrchestration.fresh([
    candidate({ targetKey: 'a', introduced: false }),
    candidate({ targetKey: 'b', introduced: true }),
  ], plan({ activeWindow: 1 }));
  return step?.target.targetKey === 'b';
})());

check('窗口没满时新 Target 先填窗口', (() => {
  const step = acquisitionOrchestration.fresh([
    candidate({ targetKey: 'a', introduced: false }),
    candidate({ targetKey: 'b', introduced: true }),
  ], plan({ activeWindow: 2 }));
  return step?.target.targetKey === 'a';
})());

check('没有候选时出不了步', acquisitionOrchestration.fresh([], plan()) === null);

check('首学编排里没出过步的候选永远合格，不受 minGap 影响', (() => {
  const step = acquisitionOrchestration.fresh(
    [candidate({ targetKey: 'a', lastStepOrdinal: -1 })],
    plan({ ordinal: 1, minGap: 5 }),
  );
  return step !== null;
})());

check('复习编排不短路，但第一轮走显式回退而不是停摆', (() => {
  const step = retentionOrchestration.fresh([{
    targetKey: 'a',
    lastStepOrdinal: -1,
    repairBasis: null,
    inventory: firstPackage,
    retaining: true,
    retest: null,
  }], plan({ ordinal: 1, minGap: 5 }));
  return step !== null && step.definition.kind === 'retention_review';
})());

check('复习候选既不在保持中、也没有重测依据时，出不了步',
  retentionOrchestration.fresh([{
    targetKey: 'a',
    lastStepOrdinal: -1,
    repairBasis: null,
    inventory: firstPackage,
    retaining: false,
    retest: null,
  }], plan()) === null);

/* ---------- 产出与 content 无关 ---------- */

check('换掉 content 不改变产出的 Step——出哪一步不取决于卡面', (() => {
  const swapped: SchedulablePackage<unknown> = {
    ...firstPackage,
    content: { orchestrationSmoke: 'a different card' },
  };
  const left = acquisitionOrchestration.fresh(
    [candidate({ targetKey: 'a' })],
    plan(),
  );
  const right = acquisitionOrchestration.fresh(
    [candidate({ targetKey: 'a', inventory: swapped })],
    plan(),
  );
  return JSON.stringify(left?.definition) === JSON.stringify(right?.definition);
})());

if (failures.length > 0) {
  console.error(`orchestration smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`orchestration smoke OK (${checks} checks)`);
