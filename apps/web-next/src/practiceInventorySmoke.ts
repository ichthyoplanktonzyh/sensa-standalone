import type {
  JourneyAlignmentView,
  JourneyWorldItemView,
} from './personalMeaningJourney/types';
import { PRACTICE_SENSES } from './practiceData';
import {
  CURRENT_STUDY_SCOPE_ID,
  PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  resolvePracticeScopeCatalog,
} from './practiceScope';
import {
  INITIAL_FREE_PRACTICE_PROFILE,
  PRACTICE_ACTIVITY_DEFINITIONS,
  resolvePracticeActivities,
} from './practiceInventory';

const failures: string[] = [];
let checked = 0;
const check = (label: string, condition: boolean) => {
  checked += 1;
  if (!condition) failures.push(label);
};

const activeAlignment: JourneyAlignmentView = {
  personalMeaningAlignmentId: 'alignment-direct',
  basisKind: 'contextual_resolution',
  status: 'active',
  senseId: 'sense-personal',
  senseVersionId: 'sense-version-personal',
  senseShortId: 'sense-personal',
  senseVersionShortId: 'sense-version-personal',
  senseVersionNumber: 1,
  origin: 'learner_confirmed',
  reviewStatus: 'unreviewed',
  resolution: 'create_new',
  coreMeaningFocus: '在不让同事难堪的情况下指出问题',
  semanticSpec: null,
  semanticSpecVersion: null,
  semanticPolicyVersion: 'semantic-policy-v1',
  generator: null,
  expressionCandidates: [],
  unresolvedQuestions: [],
  confirmedBindings: [{
    expressionBindingConfirmationId: 'binding-confirmation-tactful',
    senseVersionId: 'sense-version-personal',
    expressionVersionId: 'expression-version-tactful',
    bindingVersionId: 'binding-version-tactful',
    expressionType: 'word',
    surfaceForm: 'tactful',
    languageTag: 'en',
    relation: 'realizes',
    semanticCoverage: 'exact',
  }],
};

// Only fields read by the Practice Scope Module are material to this smoke.
const directPersonalMeaning = {
  personalMeaningId: 'personal-meaning-direct',
  primaryLabel: '委婉指出问题',
  detail: {
    focuses: [],
    directAlignments: [activeAlignment],
    materialBlocks: [{ bodyText: '项目会上，我需要指出同事方案中的问题。' }],
    experienceAnchors: [],
  },
} as unknown as JourneyWorldItemView;

const defaultCatalog = resolvePracticeScopeCatalog({
  selection: { sourceId: CURRENT_STUDY_SCOPE_ID },
  personalMeanings: [directPersonalMeaning],
});
const activities = resolvePracticeActivities(defaultCatalog.currentScope);

check('首期 Profile 恰好有四个 Activity', activities.length === 4);
check(
  '四个 Area 顺序固定为听说读写',
  activities.map((activity) => activity.primaryArea).join(',')
    === 'listening,speaking,reading,writing',
);
check(
  '每个 Activity 只占一个 Area',
  new Set(activities.map((activity) => activity.primaryArea)).size === 4,
);
check(
  'Profile 与 Activity Definitions 使用相同身份',
  INITIAL_FREE_PRACTICE_PROFILE.activityIds.join(',')
    === PRACTICE_ACTIVITY_DEFINITIONS.map((activity) => activity.id).join(','),
);
check('真实语流泛化可进入', activities[0]?.status === 'available');
check(
  '未实现的三个 Runtime 不冒充可进入',
  activities.slice(1).every((activity) => activity.status === 'not_yet_delivered'),
);

const emptyCatalog = resolvePracticeScopeCatalog({
  selection: { sourceId: CURRENT_STUDY_SCOPE_ID },
  personalMeanings: [],
  studyItems: [],
  studyTitle: '空范围',
});
const emptyActivities = resolvePracticeActivities(emptyCatalog.currentScope);
check(
  '空范围不能启动 provider-backed Activity',
  emptyActivities[0]?.status === 'unavailable_in_scope',
);

check('只交付两个首期 Scope 来源', defaultCatalog.sources.length === 2);
check(
  '当前学习范围只读取 Package-backed practice inventory',
  defaultCatalog.currentScope.targets.length === PRACTICE_SENSES.length
    && defaultCatalog.currentScope.targets.every(
      (target) => target.identity.kind === 'catalog_binding',
    ),
);

const personalSource = defaultCatalog.sources.find(
  (source) => source.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
);
const personalTarget = personalSource?.targets[0];
check(
  '无 Focus 快轨形成的完整 Context–Sense–Expression 可以进入 Scope',
  personalSource?.targets.length === 1
    && personalTarget?.expression.surfaceForm === 'tactful'
    && personalTarget.context?.preview.includes('项目会上') === true,
);

const personalCatalog = resolvePracticeScopeCatalog({
  selection: {
    sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
    targetIds: personalTarget ? [personalTarget.targetId, personalTarget.targetId, 'missing'] : [],
  },
  personalMeanings: [directPersonalMeaning],
});
check(
  'Personal Meaning 选择按 Binding identity 去重并移除失效引用',
  personalCatalog.selection.sourceId === PERSONAL_SEMANTIC_WORLD_SCOPE_ID
    && personalCatalog.currentScope.targets.length === 1,
);
check(
  'Personal Meaning Scope 保留实际 Sense 与 Binding identity',
  personalCatalog.currentScope.targets[0]?.identity.kind === 'personal_meaning_binding'
    && personalCatalog.currentScope.targets[0].identity.bindingVersionId === 'binding-version-tactful',
);

const invalidPersonalSelection = resolvePracticeScopeCatalog({
  selection: {
    sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
    targetIds: ['removed-target'],
  },
  personalMeanings: [directPersonalMeaning],
});
check(
  '失效或清空的 Personal Meaning 选择回落到当前学习范围',
  invalidPersonalSelection.selection.sourceId === CURRENT_STUDY_SCOPE_ID,
);

console.log(`free practice inventory smoke: ${checked - failures.length}/${checked}`);
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exit(1);
}
