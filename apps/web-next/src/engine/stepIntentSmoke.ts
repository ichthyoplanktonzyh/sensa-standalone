/**
 * Deterministic smoke for the Step intent axis.
 *
 * `introduction` 从 `LearningCapability` 移出之后，两句话必须同时成立：
 *
 *  1. **讲解不是一条能力。** 目录里那一步的 `capability` 是 null——它不进 Gate、
 *     没有 Assessment Resource、也不在 `requiredCapabilities` 里。原先它是能力
 *     枚举的一个取值，代价是三处 `Exclude<..., 'introduction'>` 别名。
 *  2. **只有 assessment 取证。** 讲解与修复都不产生 Evidence：它们既不计入
 *     attempts，也不把 Gate 判成 passed。这条是插件自由度的边界——没有它，
 *     多个编排插件会各自解释"什么叫学会了"。
 *
 * 第 2 条只能从行为上钉：类型能保证 intent 的取值域，保证不了"谁能取证"。
 *
 * Run with `npm run smoke:intent`.
 */
import { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';
import { LearnQueue } from './LearnQueue';
import type { LearningCapability, LearningStepIntent, ScheduledActionDefinition } from './types';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const CAPABILITIES: readonly LearningCapability[] = [
  'contextual_recognition',
  'meaning_to_form_recall',
  'novel_context_transfer',
  'boundary_discrimination',
];

const intentOf = (action: ScheduledActionDefinition): LearningStepIntent =>
  action.intent ?? 'assessment';

/* ---------- 目录事实：讲解不是一条能力 ---------- */

check('每个 Package 恰好一步讲解',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    pkg.actions.filter((action) => action.kind === 'introduction').length === 1));

check('讲解步没有 capability，意图是 instruction',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    pkg.actions
      .filter((action) => action.kind === 'introduction')
      .every((action) => action.capability === null && intentOf(action) === 'instruction')));

check('讲解步不是 assessment——它不取证',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    pkg.actions
      .filter((action) => action.kind === 'introduction')
      .every((action) => intentOf(action) !== 'assessment')));

check('除讲解外的每一步都练一条真实能力',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    [...pkg.actions, ...(pkg.repairActions ?? []), ...pkg.reviewActions]
      .filter((action) => action.kind !== 'introduction')
      .every((action) =>
        action.capability !== null && CAPABILITIES.includes(action.capability))));

check('requiredCapabilities 里没有讲解',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    pkg.requiredCapabilities.every((capability) => CAPABILITIES.includes(capability))));

check('修复步的意图是 repair，而且带得上能力',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    (pkg.repairActions ?? []).every((action) =>
      intentOf(action) === 'repair' && action.capability !== null)));

check('Gate 与 Review 步的意图默认是 assessment',
  PROTOTYPE_LEARNING_PACKAGES.every((pkg) =>
    [...pkg.actions.filter((action) => action.kind === 'acquisition_gate'), ...pkg.reviewActions]
      .every((action) => intentOf(action) === 'assessment')));

/* ---------- 行为：只有 assessment 取证 ---------- */

const firstPackage = PROTOTYPE_LEARNING_PACKAGES[0]!;
const queue = new LearnQueue([firstPackage], { activeWindow: 1, minGap: 0 });

const opening = queue.getCurrentSession();
check('新 Package 的第一步是讲解',
  opening !== null
  && opening.action.intent === 'instruction'
  && opening.action.capability === null
  && opening.action.reason === 'new');

check('讲解期间 markMistake 是空操作——没有 Gate 可重开', (() => {
  queue.markMistake();
  const state = queue.getState(firstPackage.packageId)!;
  return state.pendingRepairCapability === null
    && CAPABILITIES.every((capability) => state.repairCounts[capability] === 0);
})());

// 兼容路径：settle(true) 在讲解步上要落到 completeIntroduction。原先这条判断
// 问的是 `capability === 'introduction'`，现在问的是这一步的 kind 与 intent。
check('settle 在讲解步上走完成讲解，而不是判分', (() => {
  const settled = queue.settle(true);
  const state = queue.getState(firstPackage.packageId)!;
  return settled?.action.intent === 'instruction'
    && state.introduced
    && settled.result === null;
})());

check('讲解不计入 attempts', queue.getStats().totalAttempts === 0);

const firstGate = queue.next();
check('讲解之后是一步 assessment，并且练的是一条真实能力',
  firstGate !== null
  && firstGate.action.intent === 'assessment'
  && firstGate.action.capability !== null
  && CAPABILITIES.includes(firstGate.action.capability));

const gateCapability = firstGate!.action.capability!;
check('assessment 取证：判错让 Gate 落到 failed 并计入 attempts', (() => {
  queue.settle(false);
  const state = queue.getState(firstPackage.packageId)!;
  return state.gateStatus[gateCapability] === 'failed'
    && queue.getStats().totalAttempts === 1;
})());

const repair = queue.next();
check('失败之后排到的是一步 repair，针对同一条能力',
  repair !== null
  && repair.action.intent === 'repair'
  && repair.action.capability === gateCapability);

check('修复不取证：Gate 回到 unresolved 而不是 passed，attempts 不变', (() => {
  const before = queue.getStats().totalAttempts;
  queue.settle(true);
  const state = queue.getState(firstPackage.packageId)!;
  return state.gateStatus[gateCapability] === 'unresolved'
    && state.repairCounts[gateCapability] === 1
    && queue.getStats().totalAttempts === before;
})());

const retest = queue.next();
check('修复之后是独立重测，意图回到 assessment',
  retest !== null
  && retest.action.intent === 'assessment'
  && retest.action.capability === gateCapability
  && retest.action.actionKey !== repair!.action.actionKey);

check('重测判对才算取证：Gate passed 且 attempts 增加', (() => {
  const before = queue.getStats().totalAttempts;
  queue.settle(true);
  const state = queue.getState(firstPackage.packageId)!;
  return state.gateStatus[gateCapability] === 'passed'
    && queue.getStats().totalAttempts === before + 1;
})());

/* ---------- 缺了讲解的 Package 要拒收 ---------- */

check('没有讲解步的 Package 直接抛，不静默跑起来', (() => {
  const withoutIntroduction = {
    ...firstPackage,
    actions: firstPackage.actions.filter((action) => action.kind !== 'introduction'),
  };
  try {
    new LearnQueue([withoutIntroduction], { activeWindow: 1, minGap: 0 });
    return false;
  } catch { return true; }
})());

check('讲解步被标成 repair 就不再算讲解', (() => {
  const introductionAsRepair = {
    ...firstPackage,
    actions: firstPackage.actions.map((action) => action.kind === 'introduction'
      ? { ...action, intent: 'repair' as const }
      : action),
  };
  try {
    new LearnQueue([introductionAsRepair], { activeWindow: 1, minGap: 0 });
    return false;
  } catch { return true; }
})());

if (failures.length > 0) {
  console.error(`step-intent smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`step-intent smoke OK (${checks} checks)`);
