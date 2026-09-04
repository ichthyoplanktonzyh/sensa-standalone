import {
  DEFAULT_RETENTION_SCOPE,
  RetentionScopeRegistry,
  retentionTargetIdFor,
  type RetentionScopeDefinition,
} from './retentionScopes';
import { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';
import { LearnQueue } from '../engine/LearnQueue';
import { ReviewQueue } from '../engine/ReviewQueue';
import { bindPackageToRetentionTarget, reviewOutcomeKey } from '../engine/types';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const SPELLING_SCOPE: RetentionScopeDefinition = {
  scopeId: 'spelling_production',
  scopeVersion: 'v1',
  kind: 'independent',
  label: '拼写产出',
  targetCapability: 'orthographic_production',
  promptChannel: 'meaning_and_audio',
  responseChannel: 'typed_expression',
  contentRequirement: ['compact_learning_material', 'pronunciation_audio'],
  prerequisite: 'semantic_connection',
  admission: {
    learnerSelectable: true,
    stableInteractionContract: true,
    separablePerformance: true,
    independentSchedulingValue: true,
  },
};

const registry = new RetentionScopeRegistry([
  DEFAULT_RETENTION_SCOPE,
  SPELLING_SCOPE,
]);

const defaultOnly = registry.resolveTargets('borrow-receive');
check('每条 Learning Target 自动且只自动创建 default Retention Target',
  defaultOnly.length === 1
  && defaultOnly[0]?.retentionScopeId === 'semantic_connection');

const withSpelling = registry.resolveTargets('borrow-receive', ['spelling_production']);
check('learner 显式选择后，同一 Learning Target 可以解析出第二个独立 Retention Target',
  withSpelling.length === 2
  && new Set(withSpelling.map((target) => target.retentionTargetId)).size === 2);
check('独立 scope 的 prerequisite 指向同一 Learning Target 的 default Retention Target',
  withSpelling[1]?.prerequisiteRetentionTargetId === withSpelling[0]?.retentionTargetId);
check('重复选择 scope 不会重复创建 Retention Target',
  registry.resolveTargets('borrow-receive', ['spelling_production', 'spelling_production']).length
    === 2);

const upgraded = new RetentionScopeRegistry([
  DEFAULT_RETENTION_SCOPE,
  { ...SPELLING_SCOPE, scopeVersion: 'v2' },
]).resolveTargets('borrow-receive', ['spelling_production'])[1]!;
check('scope definition 升级保留 Retention Target identity，只更新 provenance version',
  upgraded.retentionTargetId === withSpelling[1]?.retentionTargetId
  && upgraded.retentionScopeVersion === 'v2');
check('不同 Learning Target 的同一 scope 不共享长期记忆身份',
  retentionTargetIdFor('borrow-receive', 'spelling_production')
    !== retentionTargetIdFor('lend-give', 'spelling_production'));

const packageTemplate = PROTOTYPE_LEARNING_PACKAGES[0]!;
check('可复用 Catalog Package 不携带 learner-specific Retention Target identity',
  !('retentionTargetId' in packageTemplate));
const semanticPackage = bindPackageToRetentionTarget(
  packageTemplate,
  withSpelling[0]!.retentionTargetId,
);
const spellingPackage = bindPackageToRetentionTarget(
  packageTemplate,
  withSpelling[1]!.retentionTargetId,
);
const acquisitionQueue = new LearnQueue(
  [semanticPackage, spellingPackage],
  { minGap: 0 },
);
check('首学队列不再按 senseId 去重：同一 Sense 的两个 Retention Targets 可并存',
  acquisitionQueue.getProjection().targets.length === 2);

const retentionQueue = new ReviewQueue([
  { package: semanticPackage, dueAt: 0, reps: 1, lapses: 0, phase: 'retaining' },
  { package: spellingPackage, dueAt: 0, reps: 1, lapses: 0, phase: 'retaining' },
], {}, { minGap: 0 });
check('复习队列也按 Retention Target 去重，不会吞掉第二个独立 scope',
  retentionQueue.getProjection().targets.length === 2);

const firstReviewAction = packageTemplate.reviewActions[0]!;
check('同一 Sense/到期时间的两个 scope 产生不同的幂等 Outcome identity',
  reviewOutcomeKey({ package: semanticPackage, dueAt: 0 }, firstReviewAction)
  !== reviewOutcomeKey({ package: spellingPackage, dueAt: 0 }, firstReviewAction));

check('Package 进入 Runtime 前必须显式绑定非空 Retention Target identity', (() => {
  try {
    bindPackageToRetentionTarget(packageTemplate, '');
    return false;
  } catch { return true; }
})());

check('独立 scope 缺少四项准入证明时注册失败', (() => {
  try {
    new RetentionScopeRegistry([
      DEFAULT_RETENTION_SCOPE,
      { ...SPELLING_SCOPE, scopeId: 'invalid', admission: undefined },
    ]);
    return false;
  } catch { return true; }
})());

check('未知 prerequisite 在 composition 时失败', (() => {
  try {
    new RetentionScopeRegistry([
      DEFAULT_RETENTION_SCOPE,
      { ...SPELLING_SCOPE, prerequisite: 'missing_scope' },
    ]);
    return false;
  } catch { return true; }
})());

check('prerequisite 链最多一层', (() => {
  try {
    new RetentionScopeRegistry([
      DEFAULT_RETENTION_SCOPE,
      SPELLING_SCOPE,
      { ...SPELLING_SCOPE, scopeId: 'dictation', prerequisite: 'spelling_production' },
    ]);
    return false;
  } catch { return true; }
})());

check('resolve 不会为未选择的独立 prerequisite 偷偷创建 learner intent', (() => {
  const listening: RetentionScopeDefinition = {
    ...SPELLING_SCOPE,
    scopeId: 'listening_recognition',
    prerequisite: undefined,
  };
  const dictation: RetentionScopeDefinition = {
    ...SPELLING_SCOPE,
    scopeId: 'dictation',
    prerequisite: 'listening_recognition',
  };
  const prerequisiteRegistry = new RetentionScopeRegistry([
    DEFAULT_RETENTION_SCOPE,
    listening,
    dictation,
  ]);
  try {
    prerequisiteRegistry.resolveTargets('borrow-receive', ['dictation']);
    return false;
  } catch {
    const resolved = prerequisiteRegistry.resolveTargets(
      'borrow-receive',
      ['dictation', 'listening_recognition'],
    );
    return resolved[1]?.retentionScopeId === 'listening_recognition'
      && resolved[2]?.retentionScopeId === 'dictation';
  }
})());

check('Registry 必须且只能有一个 default scope', (() => {
  try {
    new RetentionScopeRegistry([
      DEFAULT_RETENTION_SCOPE,
      { ...DEFAULT_RETENTION_SCOPE, scopeId: 'another_default' },
    ]);
    return false;
  } catch { return true; }
})());

check('Scope 不能声明空的内容能力集合', (() => {
  try {
    new RetentionScopeRegistry([
      { ...DEFAULT_RETENTION_SCOPE, contentRequirement: [] as never },
    ]);
    return false;
  } catch { return true; }
})());

check('复习队列拒绝同一个 Retention Target 的重复候选，不静默吞数据', (() => {
  try {
    new ReviewQueue([
      { package: semanticPackage, dueAt: 0, reps: 1, lapses: 0, phase: 'retaining' },
      { package: semanticPackage, dueAt: 1, reps: 1, lapses: 0, phase: 'retaining' },
    ], {}, { minGap: 0 });
    return false;
  } catch { return true; }
})());

if (failures.length > 0) {
  console.error(`retention-scopes smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`retention-scopes smoke OK (${checks} checks)`);
