/**
 * Deterministic smoke for the Retention Store registry.
 *
 * 这里钉的是 store 抽象的两条要害：
 *
 *  1. **同一份定义在两种宿主下结果一致。** App 的 ctx 接 storageService，
 *     journey reducer 的 ctx 接 action 里那份到期表。它们只是 ctx 不同，
 *     `openHandoff` 的判断必须完全相同——这正是抽象成立的前提。
 *  2. **拿不到到期时间时的退路。** 没有 runtime Sense 的 Target 走调度器保持时，
 *     不能落出 `Invalid Date`，要退回"现在可复习"，与交接前一致。
 *
 * 另外钉住 Adapter → store 的映射：它是这次改动里唯一的"谁归谁管"事实，
 * 改错了不会有类型错误，只会让长期状态写进另一份存储。
 *
 * 另外，固定档期的第一档是学习步 2：交接后 10 分钟，不是"现在"——
 * 轻量首学只是第一个学习步（grounding + 一次回想），第二个学习步由
 * 首次到期复习承担，立刻可点的"复习"是回声测试，不是提取。
 *
 * Run with `npm run smoke:retention`.
 */
import {
  FIXED_LADDER_FIRST_RUNG,
  IMMEDIATE_REVIEW_LABEL,
  RetentionStoreRegistry,
  retentionStoreRegistry,
  type RetentionStoreContext,
  type RetentionStoreId,
} from './retentionStores';
import { learningRuntimeCoordinator } from './runtimeCoordinator';
import { learningPolicyProfileRegistry } from './policyProfiles';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const COMPLETED_AT = '2026-01-01T00:00:00.000Z';
const DUE_AT = Date.UTC(2026, 0, 4);

/** 调用点带来了到期时间。 */
const withDue = (dueAt: number | null): RetentionStoreContext => ({
  completedAt: COMPLETED_AT,
  openSchedulerDue: () => dueAt,
  reviewLabel: () => '3 天后',
});

/* ---------- Adapter → store 的映射 ---------- */

check('lightweight 的保持事实归固定档期',
  learningRuntimeCoordinator.retentionStoreOfAdapter('lightweight') === 'fixed_ladder');
check('structured 的保持事实归调度器',
  learningRuntimeCoordinator.retentionStoreOfAdapter('structured') === 'scheduler_memory');
check('未知 Adapter 直接抛，不静默退化', (() => {
  try {
    learningRuntimeCoordinator.retentionStoreOfAdapter('nope' as never);
    return false;
  } catch { return true; }
})());
check('未知 store 直接抛', (() => {
  try {
    retentionStoreRegistry.get('nope' as RetentionStoreId);
    return false;
  } catch { return true; }
})());
check('每个 Policy Profile 的保持都能解析出 store',
  learningPolicyProfileRegistry.list().every((profile) => {
    const storeId = learningRuntimeCoordinator.retentionStoreFor(
      profile.profileId,
      'retention_review',
    );
    return retentionStoreRegistry.get(storeId).storeId === storeId;
  }));

/* ---------- 固定档期 ---------- */

const ladder = retentionStoreRegistry.get('fixed_ladder');
check('固定档期需要 reducer 自己开一条记录', ladder.opensJourneyLadder);
check('固定档期第一档是学习步 2：交接后 10 分钟，不是"现在"', (() => {
  const handoff = ladder.openHandoff(withDue(DUE_AT));
  return handoff.nextReviewAt
    === new Date(Date.parse(COMPLETED_AT) + FIXED_LADDER_FIRST_RUNG.delayMs).toISOString()
    && handoff.nextReviewLabel === FIXED_LADDER_FIRST_RUNG.label;
})());
check('固定档期不看调度器给的到期时间', (() => {
  let asked = false;
  ladder.openHandoff({
    completedAt: COMPLETED_AT,
    openSchedulerDue: () => { asked = true; return DUE_AT; },
    reviewLabel: () => '3 天后',
  });
  return !asked;
})());

/* ---------- 调度器记忆 ---------- */

const scheduler = retentionStoreRegistry.get('scheduler_memory');
check('调度器保持不需要 reducer 开记录', !scheduler.opensJourneyLadder);
check('调度器保持用它给的到期时间', (() => {
  const handoff = scheduler.openHandoff(withDue(DUE_AT));
  return handoff.nextReviewAt === new Date(DUE_AT).toISOString()
    && handoff.nextReviewLabel === '3 天后';
})());
check('拿不到到期时间时退回"现在可复习"，不落 Invalid Date', (() => {
  const handoff = scheduler.openHandoff(withDue(null));
  return handoff.nextReviewAt === COMPLETED_AT
    && handoff.nextReviewLabel === IMMEDIATE_REVIEW_LABEL
    && !handoff.nextReviewAt.includes('Invalid');
})());

/* ---------- 两种宿主下结果一致 ---------- */

// App 侧：ctx 背后是 storageService 的 FSRS item。
const imperativeCtx: RetentionStoreContext = {
  completedAt: COMPLETED_AT,
  openSchedulerDue: () => ({ due: DUE_AT }).due,
  reviewLabel: (dueAt) => `到期 ${dueAt}`,
};
// reducer 侧：ctx 背后是 action 里那份 dueBySenseId。
const dueBySenseId: Record<string, number> = { 'sense-1': DUE_AT };
const pureCtx: RetentionStoreContext = {
  completedAt: COMPLETED_AT,
  openSchedulerDue: () => dueBySenseId['sense-1'] ?? null,
  reviewLabel: (dueAt) => `到期 ${dueAt}`,
};
check('命令式与纯函数两侧的交接投影一致', (() => {
  const left = scheduler.openHandoff(imperativeCtx);
  const right = scheduler.openHandoff(pureCtx);
  return left.nextReviewAt === right.nextReviewAt
    && left.nextReviewLabel === right.nextReviewLabel;
})());
check('reducer 侧缺 senseId 时与 App 侧缺 Sense 时同样退回', (() => {
  const missing: RetentionStoreContext = { ...pureCtx, openSchedulerDue: () => null };
  return scheduler.openHandoff(missing).nextReviewLabel === IMMEDIATE_REVIEW_LABEL;
})());

/* ---------- 注册表可替换 ---------- */

check('可以只装一个 store，未注册的取用即抛', (() => {
  const partial = new RetentionStoreRegistry([ladder]);
  if (partial.get('fixed_ladder') !== ladder) return false;
  try {
    partial.get('scheduler_memory');
    return false;
  } catch { return true; }
})());

if (failures.length > 0) {
  console.error(`retention-stores smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`retention-stores smoke OK (${checks} checks)`);
