/**
 * Deterministic smoke for the Runtime Surface 登记表。
 *
 * 这些 handler 是从 App 的六处 if/else 里搬出来的，搬运的验收标准是"行为
 * 零变化"，所以断言写的是搬运前那几段代码的可观察行为：调用了哪些宿主能力、
 * 顺序如何、失败时有没有留下半截写入。
 *
 * 尤其钉住两处容易被"顺手统一"的不对称：
 *  - `openStructuredQueue` 失败时不能已经提交 Policy、也不能记下运行
 *    （原代码先建队再提交）；
 *  - 空队列的处理三个入口本来就不同，`enterOnEmpty` 如实保留了这个差异。
 *
 * 另外钉住 handler 记运行时报的 surface：它决定复习组交接时"跑完的是哪一组"，
 * 报错了不会有类型错误，只会让交接找错位置。
 *
 * Run with `npm run smoke:surfaces`.
 */
import type { PrototypeLearningTargetId } from '../learningJourney/prototypeLearning';
import type { RuntimeLaunch } from './runtimeCoordinator';
import {
  runtimeSurfaceRegistry,
  type RuntimeSurfaceContext,
} from './runtimeSurfaces';

const failures: string[] = [];
let checks = 0;
const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

/** 记录调用序列的替身宿主。 */
interface FakeHost {
  readonly calls: string[];
  readonly ctx: RuntimeSurfaceContext;
}

const createHost = (options: {
  structuredQueueOk?: boolean;
  dueReviewCount?: number;
} = {}): FakeHost => {
  const calls: string[] = [];
  const ctx: RuntimeSurfaceContext = {
    toast: (message) => calls.push(`toast:${message}`),
    showFlow: (flow) => calls.push(`showFlow:${flow}`),
    enterReviewMode: () => calls.push('enterReviewMode'),
    commitPolicies: (targetIds) => calls.push(`commitPolicies:${targetIds.join(',')}`),
    beginInitialRun: (surface, targetIds) =>
      calls.push(`beginInitialRun:${surface}:${targetIds.join(',')}`),
    beginRetentionRun: (surface, targetIds) =>
      calls.push(`beginRetentionRun:${surface}:${targetIds.join(',')}`),
    openStructuredQueue: (targetIds) => {
      calls.push(`openStructuredQueue:${targetIds.join(',')}`);
      return options.structuredQueueOk ?? true;
    },
    countDueReviews: () => options.dueReviewCount ?? 1,
    openStructuredReviewQueue: (targetIds) =>
      calls.push(`openStructuredReviewQueue:${targetIds.join(',')}`),
  };
  return { calls, ctx };
};

const launchFor = (
  surface:
    | 'lightweight_initial'
    | 'lightweight_retention'
    | 'structured_session'
    | 'interleaved_four_stage'
    | 'interleaved_four_stage_review',
  targetIds: readonly PrototypeLearningTargetId[],
): RuntimeLaunch<PrototypeLearningTargetId> => ({
  purpose: surface === 'lightweight_initial' || surface === 'interleaved_four_stage'
    ? 'initial_learning'
    : 'retention_review',
  protocol: {
    protocolId: 'smoke',
    protocolVersion: 'v1',
    runtimeAdapterId: surface.startsWith('interleaved_')
      ? 'interleaved_four_stage'
      : surface === 'structured_session' ? 'structured' : 'lightweight',
    orchestrationId: surface === 'interleaved_four_stage'
      ? 'interleaved_four_stage_acquisition'
      : surface === 'interleaved_four_stage_review'
        ? 'interleaved_four_stage_retention'
        : surface === 'structured_session'
          ? 'structured_acquisition'
          : 'lightweight_study',
    evaluationPolicyId: surface === 'interleaved_four_stage'
      ? 'four-stage-mixed-evaluation-v1'
      : surface === 'interleaved_four_stage_review'
        ? 'learner-rating-v1'
        : surface === 'structured_session'
          ? 'structured-behavioral-v1'
          : 'lightweight-practice-observation-v1',
    progressionPolicyId: surface === 'interleaved_four_stage'
      ? 'run-reset-v1'
      : surface === 'structured_session'
        ? 'structured-current-checkpoint-reset-v1'
        : 'completion-only-v1',
    completionPolicyId: surface === 'interleaved_four_stage'
      ? 'all-required-current-epoch-v1'
      : surface === 'interleaved_four_stage_review'
        ? 'one-review-one-outcome-v1'
        : surface === 'structured_session'
          ? 'all-required-current-epoch-v1'
          : 'study-completion-v1',
    repairPolicyId: surface === 'interleaved_four_stage'
      ? 'four-stage-detail-repair-v1'
      : surface === 'interleaved_four_stage_review'
        ? 'four-stage-rebinding-v1'
        : surface === 'structured_session'
          ? 'structured-targeted-repair-v1'
          : 'lightweight-retry-v1',
    memoryOutcomePolicyId: surface === 'interleaved_four_stage_review'
      ? 'learner-rated-graded-v1'
      : null,
    checkpointDefinitionIds: surface === 'interleaved_four_stage'
      ? ['four-stage:meaning-choice']
      : surface === 'structured_session'
        ? ['structured-acquisition:contextual_recognition']
        : [],
    contentRequirement: ['compact_learning_material'],
    contentDemands: [{ contentDemandKey: 'smoke-content', definitionVersion: 'v1' }],
  },
  adapterId: surface.startsWith('interleaved_')
    ? 'interleaved_four_stage'
    : surface === 'structured_session' ? 'structured' : 'lightweight',
  surface,
  targetIds,
});

const announce = (count: number): string => `n=${count}`;

/* ---------- 登记表本身 ---------- */

check('每个 surface 都登记了 flow',
  runtimeSurfaceRegistry.flowFor('lightweight_initial') === 'lightweight'
  && runtimeSurfaceRegistry.flowFor('lightweight_retention') === 'lightweightReview'
  && runtimeSurfaceRegistry.flowFor('structured_session') === 'study'
  && runtimeSurfaceRegistry.flowFor('interleaved_four_stage') === 'fourStage'
  && runtimeSurfaceRegistry.flowFor('interleaved_four_stage_review') === 'fourStageReview');

check('未知 surface 抛错而不是静默返回', (() => {
  try {
    runtimeSurfaceRegistry.get('nope' as 'structured_session');
    return false;
  } catch {
    return true;
  }
})());

/* ---------- 轻量首学 ---------- */

{
  const host = createHost();
  const started = runtimeSurfaceRegistry
    .get('lightweight_initial')
    .startInitial(host.ctx, launchFor('lightweight_initial', [
      'borrow-receive',
      'tactful-expression',
    ]));
  check('轻量首学：Planner 选中的全部 Target 一起提交 Policy、进入同一运行', started
    && host.calls.join('|') === [
      'commitPolicies:borrow-receive,tactful-expression',
      'beginInitialRun:lightweight_initial:borrow-receive,tactful-expression',
      'showFlow:lightweight',
    ].join('|'));
}

{
  const host = createHost();
  const started = runtimeSurfaceRegistry
    .get('lightweight_initial')
    .startInitial(host.ctx, launchFor('lightweight_initial', []));
  check('轻量首学：没有 Target 就不写入', !started && host.calls.length === 0);
}

/* ---------- 结构化首学：失败不留半截写入 ---------- */

{
  const host = createHost();
  const started = runtimeSurfaceRegistry
    .get('structured_session')
    .startInitial(host.ctx, launchFor('structured_session', ['lend-give', 'borrow-receive']));
  check('结构化首学：建队成功才记运行、提交 Policy', started
    && host.calls.join('|') === [
      'openStructuredQueue:lend-give,borrow-receive',
      'beginInitialRun:structured_session:lend-give,borrow-receive',
      'commitPolicies:lend-give,borrow-receive',
      'showFlow:study',
    ].join('|'));
}

{
  const host = createHost({ structuredQueueOk: false });
  const started = runtimeSurfaceRegistry
    .get('structured_session')
    .startInitial(host.ctx, launchFor('structured_session', ['lend-give']));
  check('结构化首学：建队失败不记运行、不提交 Policy、不进 flow', !started
    && !host.calls.some((call) => call.startsWith('beginInitialRun'))
    && !host.calls.some((call) => call.startsWith('commitPolicies'))
    && !host.calls.some((call) => call.startsWith('showFlow')));
}

/* ---------- 第三种 Profile：独立协议 surface ---------- */

{
  const host = createHost();
  const started = runtimeSurfaceRegistry
    .get('interleaved_four_stage')
    .startInitial(host.ctx, launchFor('interleaved_four_stage', [
      'borrow-receive',
      'lend-give',
    ]));
  check('四阶段首学：消费 Planner 选出的整个 cohort，不自行切批', started
    && host.calls.join('|') === [
      'beginInitialRun:interleaved_four_stage:borrow-receive,lend-give',
      'commitPolicies:borrow-receive,lend-give',
      'showFlow:fourStage',
    ].join('|'));
}

{
  const host = createHost();
  const started = runtimeSurfaceRegistry
    .get('interleaved_four_stage_review')
    .startRetention(
      host.ctx,
      launchFor('interleaved_four_stage_review', ['borrow-receive']),
      { announce, enterOnEmpty: false },
    );
  check('四阶段复习：使用自己的 surface，不调用结构化 ReviewQueue', started
    && host.calls.join('|') === [
      'beginRetentionRun:interleaved_four_stage_review:borrow-receive',
      'showFlow:fourStageReview',
      'toast:n=1',
    ].join('|'));
}

/* ---------- 继续已提交的 Target ---------- */

{
  const host = createHost();
  runtimeSurfaceRegistry.get('lightweight_initial').continueInitial(
    host.ctx,
    'borrow-receive',
    { initialCompletion: false, declaredMastery: false, inActiveRun: true },
  );
  check('轻量继续：Target 已在当天运行中时只恢复 flow，不重建或缩减运行',
    host.calls.join('|') === 'showFlow:lightweight');
}

{
  const host = createHost();
  runtimeSurfaceRegistry.get('lightweight_initial').continueInitial(
    host.ctx,
    'borrow-receive',
    { initialCompletion: true, declaredMastery: false, inActiveRun: false },
  );
  check('轻量继续：已完成首学只提示', host.calls.length === 1
    && host.calls[0] === 'toast:首次学习已经完成，等待进入长期复习');
}

{
  const host = createHost();
  runtimeSurfaceRegistry.get('lightweight_initial').continueInitial(
    host.ctx,
    'borrow-receive',
    { initialCompletion: false, declaredMastery: true, inActiveRun: false },
  );
  check('轻量继续：不看 declaredMastery（保留原分支差异）',
    host.calls.join('|')
      === 'beginInitialRun:lightweight_initial:borrow-receive|showFlow:lightweight');
}

{
  const host = createHost();
  runtimeSurfaceRegistry.get('structured_session').continueInitial(
    host.ctx,
    'lend-give',
    { initialCompletion: false, declaredMastery: true, inActiveRun: true },
  );
  check('结构化继续：熟词优先于在跑的运行', host.calls.length === 1
    && host.calls[0] === 'toast:这条目标已声明为熟词，不再进入正式学习计划');
}

{
  const host = createHost();
  runtimeSurfaceRegistry.get('structured_session').continueInitial(
    host.ctx,
    'lend-give',
    { initialCompletion: false, declaredMastery: false, inActiveRun: true },
  );
  check('结构化继续：回到在跑的运行', host.calls.join('|') === 'showFlow:study');
}

{
  const host = createHost();
  runtimeSurfaceRegistry.get('structured_session').continueInitial(
    host.ctx,
    'lend-give',
    { initialCompletion: false, declaredMastery: false, inActiveRun: false },
  );
  check('结构化继续：运行已结束只提示', host.calls.length === 1
    && host.calls[0] === 'toast:首次学习已结束，之后会按计划进入复习');
}

/* ---------- 长期复习 ---------- */

{
  const host = createHost();
  const started = runtimeSurfaceRegistry.get('lightweight_retention').startRetention(
    host.ctx,
    launchFor('lightweight_retention', ['borrow-receive', 'tactful-expression']),
    { announce, enterOnEmpty: false },
  );
  check('轻量复习：按 Target 数量提示', started
    && host.calls.join('|') === [
      'beginRetentionRun:lightweight_retention:borrow-receive,tactful-expression',
      'showFlow:lightweightReview',
      'toast:n=2',
    ].join('|'));
}

{
  const host = createHost({ dueReviewCount: 3 });
  const started = runtimeSurfaceRegistry.get('structured_session').startRetention(
    host.ctx,
    launchFor('structured_session', ['lend-give']),
    { announce, enterOnEmpty: false },
  );
  check('结构化复习：切 review 模式 → 记运行 → 建队 → 进 flow', started
    && host.calls.join('|') === [
      'enterReviewMode',
      'beginRetentionRun:structured_session:lend-give',
      'openStructuredReviewQueue:lend-give',
      'showFlow:study',
      'toast:n=3',
    ].join('|'));
}

{
  const host = createHost({ dueReviewCount: 0 });
  const started = runtimeSurfaceRegistry.get('structured_session').startRetention(
    host.ctx,
    launchFor('structured_session', ['lend-give']),
    { announce, enterOnEmpty: false },
  );
  check('结构化复习：空队列且不允许进入时零写入', !started && host.calls.length === 0);
}

{
  const host = createHost({ dueReviewCount: 0 });
  const started = runtimeSurfaceRegistry.get('structured_session').startRetention(
    host.ctx,
    launchFor('structured_session', ['lend-give']),
    { announce, enterOnEmpty: true },
  );
  check('结构化复习：混合流照旧进入空队列', started
    && host.calls.join('|') === [
      'enterReviewMode',
      'beginRetentionRun:structured_session:lend-give',
      'openStructuredReviewQueue:lend-give',
      'showFlow:study',
      'toast:n=0',
    ].join('|'));
}

/* ---------- 不承担的 purpose 返回 false，而不是假装启动 ---------- */

{
  const host = createHost();
  const started = runtimeSurfaceRegistry.get('lightweight_initial').startRetention(
    host.ctx,
    launchFor('lightweight_initial', ['borrow-receive']),
    { announce, enterOnEmpty: true },
  );
  check('轻量首学 surface 不承担复习', !started && host.calls.length === 0);
}

{
  const host = createHost();
  const started = runtimeSurfaceRegistry.get('lightweight_retention').startInitial(
    host.ctx,
    launchFor('lightweight_retention', ['borrow-receive']),
  );
  check('轻量复习 surface 不承担首学', !started && host.calls.length === 0);
}

console.log(`runtime surfaces smoke: ${checks} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');
