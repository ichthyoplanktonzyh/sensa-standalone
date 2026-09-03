/**
 * Deterministic smoke for the content-capability set and its readiness provider.
 *
 * 这里钉三件事：
 *
 *  1. **合取是真的。** 集合里任一条没就绪，整组就没就绪；报的是最坏那条**自己的**
 *     view，不是新造一个笼统状态——否则学习者看不出缺的是什么。
 *  2. **声明状态与供给事实分开。** `view.status` 会被 journey 的"刷新准备状态"推进，
 *     `provisioned` 不会。这两个字段互不推导，是 `executable` 不再问 surface 的前提。
 *  3. **既有行为零变化。** 三条真实 Target × 两种方式下，`readinessForPolicy` 与
 *     `provisionedForPolicy` 必须与改动前那两个表达式逐个相等。第 3 条是验收标准，
 *     前两条是它的地基。
 *
 * Run with `npm run smoke:capabilities`.
 */
import {
  conjoinContentCapabilities,
  sameContentCapabilitySet,
  worseReadinessView,
  type ContentCapabilityId,
  type ContentCapabilityReadiness,
  type ContentCapabilityReadinessProvider,
  type PrototypeLearningReadiness,
  type PrototypeLearningReadinessView,
} from './contentCapabilities';
import {
  LearningPolicyProfileRegistry,
  PROTOTYPE_LEARNING_POLICY_PROFILES,
  type LearningPolicyProfileDefinition,
} from './policyProfiles';
import { learningRuntimeCoordinator } from './runtimeCoordinator';
import {
  PROTOTYPE_LEARNING_TARGET_ORDER,
  PROTOTYPE_LEARNING_TARGETS,
  provisionedForPolicy,
  readinessForPolicy,
  runtimePackageForTarget,
  type PrototypeLearningPolicy,
} from '../learningJourney/prototypeLearning';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const view = (
  status: PrototypeLearningReadiness,
  label: string,
): PrototypeLearningReadinessView => ({ status, label, detail: label });

const COMPACT_READY = view('ready', 'compact ready');
const COMPACT_PREPARING = view('preparing', 'compact preparing');
const PACKAGE_READY = view('ready', 'package ready');
const PACKAGE_BLOCKED = view('blocked', 'package blocked');

const providerOf = (
  table: Record<ContentCapabilityId, ContentCapabilityReadiness>,
): ContentCapabilityReadinessProvider => (capabilityId) => table[capabilityId];

const BOTH_READY = providerOf({
  compact_learning_material: { view: COMPACT_READY, provisioned: true },
  structured_learning_package: { view: PACKAGE_READY, provisioned: true },
});
const PACKAGE_MISSING = providerOf({
  compact_learning_material: { view: COMPACT_READY, provisioned: true },
  structured_learning_package: { view: PACKAGE_BLOCKED, provisioned: false },
});
const COMPACT_NOT_YET = providerOf({
  compact_learning_material: { view: COMPACT_PREPARING, provisioned: true },
  structured_learning_package: { view: PACKAGE_READY, provisioned: true },
});

/* ---------- 合取 ---------- */

check('单条能力的合取就是它自己那条 view',
  conjoinContentCapabilities(['structured_learning_package'], BOTH_READY).view === PACKAGE_READY);
check('两条都就绪才算就绪',
  conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], BOTH_READY,
  ).view.status === 'ready');
check('缺一条就不就绪',
  conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], PACKAGE_MISSING,
  ).view.status === 'blocked');
check('报的是缺的那条自己的 view，不是新造一个状态',
  conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], PACKAGE_MISSING,
  ).view === PACKAGE_BLOCKED);
check('缺的那条排在后面也照样报出来',
  conjoinContentCapabilities(
    ['structured_learning_package', 'compact_learning_material'], PACKAGE_MISSING,
  ).view === PACKAGE_BLOCKED);
check('blocked 压过 preparing',
  worseReadinessView(COMPACT_PREPARING, PACKAGE_BLOCKED) === PACKAGE_BLOCKED
  && worseReadinessView(PACKAGE_BLOCKED, COMPACT_PREPARING) === PACKAGE_BLOCKED);
check('并列最坏时保留最先声明的那条',
  worseReadinessView(COMPACT_PREPARING, view('preparing', 'other')) === COMPACT_PREPARING);
check('preparing 也让整组不就绪',
  conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], COMPACT_NOT_YET,
  ).view === COMPACT_PREPARING);

/* ---------- 声明状态与供给事实互不推导 ---------- */

check('两条都供给了才算供给',
  conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], BOTH_READY,
  ).provisioned
  && !conjoinContentCapabilities(
    ['compact_learning_material', 'structured_learning_package'], PACKAGE_MISSING,
  ).provisioned);
check('还在准备但已供给：不就绪，却跑得起来',
  conjoinContentCapabilities(['compact_learning_material'], COMPACT_NOT_YET).view.status
    === 'preparing'
  && conjoinContentCapabilities(['compact_learning_material'], COMPACT_NOT_YET).provisioned);
check('未供给的那条不因为别人就绪就被算进来',
  !conjoinContentCapabilities(['structured_learning_package'], PACKAGE_MISSING).provisioned);

/* ---------- 集合相等 ---------- */

const PAIR = ['compact_learning_material', 'structured_learning_package'] as const;
check('声明顺序不构成差异',
  sameContentCapabilitySet(PAIR, ['structured_learning_package', 'compact_learning_material']));
check('重复声明不构成差异',
  sameContentCapabilitySet(
    ['compact_learning_material', 'compact_learning_material'],
    ['compact_learning_material'],
  ));
check('少一条就是另一组',
  !sameContentCapabilitySet(PAIR, ['compact_learning_material']));
check('重复声明不会把两组不同的集合看成同一组',
  !sameContentCapabilitySet(
    ['compact_learning_material', 'compact_learning_material'],
    ['compact_learning_material', 'structured_learning_package'],
  ));

/* ---------- 需求属于用途，不属于 Profile ---------- */

const lightweightProfile = PROTOTYPE_LEARNING_POLICY_PROFILES[0];
const mixedProfile = {
  ...lightweightProfile,
  profileId: 'mixed_requirements' as const,
  protocols: {
    initial_learning: lightweightProfile.protocols.initial_learning,
    retention_review: {
      ...lightweightProfile.protocols.retention_review,
      contentRequirement: PAIR,
    },
    relearning: lightweightProfile.protocols.relearning,
  },
} satisfies LearningPolicyProfileDefinition<'mixed_requirements'>;
const mixedPlan = new LearningPolicyProfileRegistry<'mixed_requirements'>([mixedProfile])
  .resolve('mixed_requirements', PACKAGE_MISSING);

check('同一 Profile 里，每个用途只对自己声明的子集求合取',
  mixedPlan.purposes.initial_learning.readiness === COMPACT_READY
  && mixedPlan.purposes.retention_review.readiness === PACKAGE_BLOCKED);
check('供给事实也按用途各算各的',
  mixedPlan.purposes.initial_learning.provisioned
  && !mixedPlan.purposes.retention_review.provisioned);

/* ---------- 既有行为零变化 ---------- */

const POLICIES: readonly PrototypeLearningPolicy[] = ['lightweight', 'high_assurance'];

for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
  const target = PROTOTYPE_LEARNING_TARGETS[targetId];
  const hasPackage = runtimePackageForTarget(target) !== null;

  for (const policy of POLICIES) {
    // 改动前：整条方式的 readiness 就是它那个唯一需求在这条 Target 上的 view。
    const legacyStatus: PrototypeLearningReadiness = policy === 'lightweight'
      ? target.lightweightReadiness.status
      : (hasPackage ? 'ready' : 'blocked');
    check(`${targetId} / ${policy} 的准备状态未变`,
      readinessForPolicy(target, policy).status === legacyStatus);

    // 改动前 App.tsx 里那一行：非 structured 恒为 true，structured 看有没有包。
    const legacyExecutable =
      learningRuntimeCoordinator.surfaceFor(policy, 'initial_learning') !== 'structured_session'
      || hasPackage;
    check(`${targetId} / ${policy} 的可执行判断与旧表达式一致`,
      provisionedForPolicy(target, policy) === legacyExecutable);
  }

  check(`${targetId} 的轻量准备状态原样透传，没被合取吞掉`,
    readinessForPolicy(target, 'lightweight') === target.lightweightReadiness);
}

if (failures.length > 0) {
  console.error(`content-capabilities smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`content-capabilities smoke OK (${checks} checks)`);
