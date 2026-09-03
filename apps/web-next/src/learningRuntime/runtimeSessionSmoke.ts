/**
 * Deterministic smoke for the runtime-session reducer.
 *
 * 断言的重点是那些原来靠调用点手写的清场规则，以及两条刻意保留的不对称：
 * 两个 summary 会共存，而 `structuredInitialTargetIds` 在运行结束后不清。
 * 后者不是遗漏——"继续这条 Target 的运行"依赖它，写在这里免得日后被"顺手清干净"。
 *
 * Run with `npm run smoke:runtime`.
 */
import {
  INITIAL_RUNTIME_SESSION,
  runtimeSessionReducer,
  type RuntimeSessionAction,
  type RuntimeSessionState,
} from './runtimeSession';

const failures: string[] = [];
let checks = 0;
const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const apply = (
  state: RuntimeSessionState,
  ...actions: readonly RuntimeSessionAction[]
): RuntimeSessionState => actions.reduce(runtimeSessionReducer, state);

const initialSummary = { graduatedTargetIds: ['borrow-receive'], declaredMasteryTargetIds: [] } as const;
const retentionSummary = {
  retainingTargetIds: ['lend-give'],
  relearningCompletedTargetIds: [],
  declaredMasteryTargetIds: [],
} as const;

/* ---------- 初始 ---------- */

check('初始无运行', INITIAL_RUNTIME_SESSION.structuredInitialTargetIds.length === 0
  && INITIAL_RUNTIME_SESSION.lightweightInitialTargetId === null
  && INITIAL_RUNTIME_SESSION.lightweightReviewTargetIds.length === 0);
check('初始无结算',
  INITIAL_RUNTIME_SESSION.initialSummary === null
  && INITIAL_RUNTIME_SESSION.retentionSummary === null);

/* ---------- 开结构化首学 = 作废上一次的结算与挂着的轻量运行 ---------- */

const dirty = apply(INITIAL_RUNTIME_SESSION,
  { type: 'startLightweightInitial', targetId: 'tactful-expression' },
  { type: 'showInitialSummary', summary: initialSummary },
);
check('轻量首学挂上了', dirty.lightweightInitialTargetId === 'tactful-expression');
check('结算写上了', dirty.initialSummary !== null);

const restarted = apply(dirty, {
  type: 'startStructuredInitial',
  targetIds: ['borrow-receive', 'lend-give'],
});
check('开结构化首学后 targetIds 生效', restarted.structuredInitialTargetIds.length === 2);
check('开结构化首学清掉上一次结算', restarted.initialSummary === null);
check('开结构化首学清掉挂着的轻量首学', restarted.lightweightInitialTargetId === null);

/* ---------- 结构化首学的 targetIds 在结算后仍然保留 ---------- */

const settled = apply(restarted, { type: 'showInitialSummary', summary: initialSummary });
check('结算后 targetIds 仍在（"继续这条运行"要靠它）',
  settled.structuredInitialTargetIds.length === 2);

/* ---------- 两个 summary 共存 ---------- */

const both = apply(settled, { type: 'showRetentionSummary', summary: retentionSummary });
check('两个 summary 可以同时存在',
  both.initialSummary !== null && both.retentionSummary !== null);
check('clearRetentionSummary 只清复习那一份', (() => {
  const cleared = apply(both, { type: 'clearRetentionSummary' });
  return cleared.retentionSummary === null && cleared.initialSummary !== null;
})());
check('startStructuredInitial 只清首学那一份', (() => {
  const restart = apply(both, { type: 'startStructuredInitial', targetIds: [] });
  return restart.initialSummary === null && restart.retentionSummary !== null;
})());

/* ---------- 轻量复习自成一路，不被首学的开关影响 ---------- */

const reviewing = apply(INITIAL_RUNTIME_SESSION, {
  type: 'startLightweightReview',
  targetIds: ['lend-give'],
});
check('轻量复习挂上了', reviewing.lightweightReviewTargetIds.length === 1);
check('开结构化首学不动轻量复习', apply(reviewing, {
  type: 'startStructuredInitial', targetIds: ['borrow-receive'],
}).lightweightReviewTargetIds.length === 1);
check('finishLightweightReview 清空',
  apply(reviewing, { type: 'finishLightweightReview' }).lightweightReviewTargetIds.length === 0);
check('finishLightweightInitial 清空', apply(
  INITIAL_RUNTIME_SESSION,
  { type: 'startLightweightInitial', targetId: 'lend-give' },
  { type: 'finishLightweightInitial' },
).lightweightInitialTargetId === null);

/* ---------- 无变化的动作返回同一对象，避免无谓重渲染 ---------- */

for (const type of ['finishLightweightInitial', 'finishLightweightReview', 'clearRetentionSummary'] as const) {
  check(`空状态下 ${type} 返回同一对象`,
    runtimeSessionReducer(INITIAL_RUNTIME_SESSION, { type }) === INITIAL_RUNTIME_SESSION);
}

console.log(`runtime session smoke: ${checks} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
