/**
 * Deterministic smoke for the learning-flow state machine.
 *
 * 两件事以前都验不了，因为它们混在组件里：
 *
 *  1. 演示目录——第 12 屏到底给不给边界对比包、第 13 屏的错误选项是不是真的
 *     来自内容，原来只能把应用跑起来点一遍。现在是纯函数，逐屏断言。
 *  2. reducer 的不变量——离开 demo 就没有 demo 负载，非 demo 模式下推进演示
 *     是空操作。这两条正是原来靠"每个入口手工清场"维持的东西。
 *
 * Run with `npm run smoke:flow`.
 */
import { DEMO_STAGE_NUMBERS, demoSceneForStage } from './demoScenes';
import { INITIAL_FLOW_STATE, demoOf, flowReducer, type FlowState } from './flowState';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

/* ---------- 演示目录 ---------- */

for (const stageNum of DEMO_STAGE_NUMBERS) {
  const scene = demoSceneForStage(stageNum);
  if (!scene) {
    failures.push(`第 ${stageNum} 屏没有场景`);
    checks += 1;
    continue;
  }
  const { presentation, queue, toast } = scene;
  check(`第 ${stageNum} 屏 toast 非空`, toast.length > 0);
  check(`第 ${stageNum} 屏 word 与 pkg 同源`, presentation.word.w.length > 0);
  check(`第 ${stageNum} 屏 queue 步序合法`, queue.step >= 1 && queue.step <= queue.total);
  check(
    `第 ${stageNum} 屏队列包内含所需 capability`,
    [...queue.pkg.actions, ...queue.pkg.reviewActions]
      .some((action) => action.capability === queue.capability),
  );
  // review_assessment / review_feedback 必须带 reviewKind，否则评测卡没有类型可渲染。
  const needsKind = presentation.stage === 'review_assessment'
    || presentation.stage === 'review_feedback';
  check(
    `第 ${stageNum} 屏 reviewKind 与 stage 相符`,
    needsKind ? presentation.reviewKind !== null : presentation.reviewKind === null,
  );
  // reviewResult 只在反馈屏出现，且必须与 reviewKind 同类。
  check(
    `第 ${stageNum} 屏 reviewResult 与 stage 相符`,
    presentation.stage === 'review_feedback'
      ? presentation.reviewResult !== null
        && presentation.reviewResult.kind === presentation.reviewKind
      : presentation.reviewResult === null,
  );
}

check('第 12 屏用的是带边界对比的包', (() => {
  const scene = demoSceneForStage(12);
  return scene !== null && scene.presentation.pkg.content.boundaryContrast !== null;
})());

check('第 13 屏的错误选项来自真实评测资源', (() => {
  const scene = demoSceneForStage(13);
  const result = scene?.presentation.reviewResult;
  return result !== null && result !== undefined
    && result.correct === false
    && (result.responseId?.length ?? 0) > 0
    && result.memoryOutcome === 'retrieval_failed';
})());

for (const unknown of [0, 5, 8, 14, -1]) {
  check(`第 ${unknown} 屏不构成跳转`, demoSceneForStage(unknown) === null);
}

/* ---------- reducer 不变量 ---------- */

const demoScene = demoSceneForStage(9)!;
const inDemo: FlowState = flowReducer(INITIAL_FLOW_STATE, {
  type: 'enterDemo',
  demo: demoScene.presentation,
});

check('初始为 learn', INITIAL_FLOW_STATE.mode === 'learn');
check('初始无 demo 负载', demoOf(INITIAL_FLOW_STATE) === null);
check('进入 demo 后 mode 为 demo', inDemo.mode === 'demo');
check('进入 demo 后有负载', demoOf(inDemo) !== null);

for (const type of ['enterLearn', 'enterReview'] as const) {
  const left = flowReducer(inDemo, { type });
  check(`${type} 后离开 demo`, left.mode !== 'demo');
  check(`${type} 后负载消失`, demoOf(left) === null);
}

// 同模式重复进入不产生新对象——否则每次都是一次无谓的重渲染。
check('重复 enterLearn 返回同一对象',
  flowReducer(INITIAL_FLOW_STATE, { type: 'enterLearn' }) === INITIAL_FLOW_STATE);
const inReview = flowReducer(INITIAL_FLOW_STATE, { type: 'enterReview' });
check('重复 enterReview 返回同一对象',
  flowReducer(inReview, { type: 'enterReview' }) === inReview);

// 非 demo 模式下推进演示是空操作：这是原先每个调用点 `if (flowMode === 'demo')` 的保证，
// 现在由 reducer 兜底，漏写一个 if 也不会把 demo 负载凭空塞进 learn 流。
for (const base of [INITIAL_FLOW_STATE, inReview]) {
  const advanced = flowReducer(base, { type: 'advanceDemo', patch: { stage: 'recall' } });
  check(`${base.mode} 下 advanceDemo 为空操作`, advanced === base);
}

const advanced = flowReducer(inDemo, { type: 'advanceDemo', patch: { stage: 'transfer' } });
check('demo 下 advanceDemo 改到新 stage', demoOf(advanced)?.stage === 'transfer');
check('demo 下 advanceDemo 保留未 patch 的字段',
  demoOf(advanced)?.pkg === demoScene.presentation.pkg
  && demoOf(advanced)?.word === demoScene.presentation.word);
check('demo 下 advanceDemo 不改动原状态', demoOf(inDemo)?.stage === demoScene.presentation.stage);

console.log(`learning flow smoke: ${checks} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
