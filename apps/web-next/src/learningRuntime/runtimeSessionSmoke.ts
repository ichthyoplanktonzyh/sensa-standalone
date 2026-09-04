/**
 * Deterministic smoke for the runtime-session reducer.
 *
 * 断言的重点是那些原来靠调用点手写的清场规则，以及三条刻意保留的不对称：
 *
 *  - 两个 summary 会共存；
 *  - 首学运行在结束后不清——"继续这条 Target 的运行"与结算都依赖它，
 *    写在这里免得日后被"顺手清干净"；
 *  - 首学是**多条并存**（离开一段结构化首学去开一段轻量首学，结构化那段
 *    仍然活着），复习只有**一条**（一组跑完直接顶掉）。
 *
 * Run with `npm run smoke:runtime`.
 */
import {
  INITIAL_RUNTIME_SESSION,
  initialRunOn,
  retentionRunOn,
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

check('初始无运行',
  Object.keys(INITIAL_RUNTIME_SESSION.initialRuns).length === 0
  && INITIAL_RUNTIME_SESSION.retentionRun === null);
check('初始无结算',
  INITIAL_RUNTIME_SESSION.initialSummary === null
  && INITIAL_RUNTIME_SESSION.retentionSummary === null);
check('没有运行时选择器返回稳定的空数组',
  initialRunOn(INITIAL_RUNTIME_SESSION, 'structured_session')
    === initialRunOn(INITIAL_RUNTIME_SESSION, 'lightweight_initial')
  && retentionRunOn(INITIAL_RUNTIME_SESSION, 'lightweight_retention').length === 0);

/* ---------- 开一次首学 = 作废上一次的首学结算 ---------- */

const dirty = apply(INITIAL_RUNTIME_SESSION,
  { type: 'startInitialRun', surface: 'lightweight_initial', targetIds: ['tactful-expression'] },
  { type: 'showInitialSummary', summary: initialSummary },
);
check('轻量首学挂上了',
  initialRunOn(dirty, 'lightweight_initial').join() === 'tactful-expression');
check('结算写上了', dirty.initialSummary !== null);

const restarted = apply(dirty, {
  type: 'startInitialRun',
  surface: 'structured_session',
  targetIds: ['borrow-receive', 'lend-give'],
});
check('开结构化首学后 targetIds 生效',
  initialRunOn(restarted, 'structured_session').length === 2);
check('开结构化首学清掉上一次结算', restarted.initialSummary === null);

/* ---------- 首学运行按 surface 并存，互不顶替 ---------- */

check('开一条首学不动另一块 surface 上的首学',
  initialRunOn(restarted, 'lightweight_initial').join() === 'tactful-expression');
check('串行呈现完成一条 Target 只移出这一条，不结束整次运行', (() => {
  const serial = apply(INITIAL_RUNTIME_SESSION, {
    type: 'startInitialRun',
    surface: 'lightweight_initial',
    targetIds: ['borrow-receive', 'tactful-expression'],
  });
  const advanced = apply(serial, {
    type: 'finishInitialTarget',
    surface: 'lightweight_initial',
    targetId: 'borrow-receive',
  });
  return initialRunOn(advanced, 'lightweight_initial').join() === 'tactful-expression';
})());
check('串行呈现完成最后一条 Target 后结束该 surface 的运行', (() => {
  const serial = apply(INITIAL_RUNTIME_SESSION, {
    type: 'startInitialRun',
    surface: 'lightweight_initial',
    targetIds: ['borrow-receive'],
  });
  const done = apply(serial, {
    type: 'finishInitialTarget',
    surface: 'lightweight_initial',
    targetId: 'borrow-receive',
  });
  return initialRunOn(done, 'lightweight_initial').length === 0;
})());
check('收尾只清自己那条', (() => {
  const done = apply(restarted, { type: 'finishInitialRun', surface: 'lightweight_initial' });
  return initialRunOn(done, 'lightweight_initial').length === 0
    && initialRunOn(done, 'structured_session').length === 2;
})());

/* ---------- 结构化首学的 targetIds 在结算后仍然保留 ---------- */

const settled = apply(restarted, { type: 'showInitialSummary', summary: initialSummary });
check('结算后 targetIds 仍在（"继续这条运行"要靠它）',
  initialRunOn(settled, 'structured_session').length === 2);

/* ---------- 两个 summary 共存 ---------- */

const both = apply(settled, { type: 'showRetentionSummary', summary: retentionSummary });
check('两个 summary 可以同时存在',
  both.initialSummary !== null && both.retentionSummary !== null);
check('开复习运行只清复习那一份', (() => {
  const reviewing = apply(both, {
    type: 'startRetentionRun', surface: 'lightweight_retention', targetIds: [],
  });
  return reviewing.retentionSummary === null && reviewing.initialSummary !== null;
})());
check('开首学运行只清首学那一份', (() => {
  const restart = apply(both, {
    type: 'startInitialRun', surface: 'structured_session', targetIds: [],
  });
  return restart.initialSummary === null && restart.retentionSummary !== null;
})());

/* ---------- 复习只有一条：下一组直接顶掉上一组 ---------- */

const reviewing = apply(INITIAL_RUNTIME_SESSION, {
  type: 'startRetentionRun', surface: 'lightweight_retention', targetIds: ['lend-give'],
});
check('轻量复习挂上了',
  retentionRunOn(reviewing, 'lightweight_retention').join() === 'lend-give');
check('开首学不动正在跑的复习', retentionRunOn(apply(reviewing, {
  type: 'startInitialRun', surface: 'structured_session', targetIds: ['borrow-receive'],
}), 'lightweight_retention').length === 1);
check('下一组复习顶掉上一组', (() => {
  const handed = apply(reviewing, {
    type: 'startRetentionRun', surface: 'structured_session', targetIds: ['borrow-receive'],
  });
  return retentionRunOn(handed, 'lightweight_retention').length === 0
    && retentionRunOn(handed, 'structured_session').join() === 'borrow-receive';
})());
check('finishRetentionRun 清空',
  apply(reviewing, { type: 'finishRetentionRun' }).retentionRun === null);

/* ---------- 无变化的动作返回同一对象，避免无谓重渲染 ---------- */

check('空状态下 finishRetentionRun 返回同一对象',
  runtimeSessionReducer(INITIAL_RUNTIME_SESSION, { type: 'finishRetentionRun' })
    === INITIAL_RUNTIME_SESSION);
check('没有这块 surface 的运行时 finishInitialRun 返回同一对象',
  runtimeSessionReducer(INITIAL_RUNTIME_SESSION, {
    type: 'finishInitialRun', surface: 'structured_session',
  }) === INITIAL_RUNTIME_SESSION);

console.log(`runtime session smoke: ${checks} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
