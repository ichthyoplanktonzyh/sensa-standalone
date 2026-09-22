/** Free Practice source resolution: real Learning Targets, complete Personal
 * Meanings, capability-aware Activities, and detached Session snapshots. */
import assert from 'node:assert/strict';
import type { PersonalMeaningLearningSource } from '../apps/web/src/contentSupply/provisioning/contracts.ts';
import {
  createPracticeScopeSnapshot,
  CURRENT_STUDY_SCOPE_ID,
  PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  resolvePracticeScopeCatalog,
  type PracticeStudyTarget,
} from '../apps/web/src/experience/practiceScope.ts';
import { resolvePracticeActivities } from '../apps/web/src/experience/practiceInventory.ts';

const studyTarget: PracticeStudyTarget = {
  target: {
    id: 'learning-target-1',
    identity: {
      senseId: 'sense-1',
      senseVersionId: 'sense-version-1',
      senseExpressionBindingId: 'binding-1',
      bindingVersionId: 'binding-version-1',
    },
    expression: 'borrow',
    targetLanguageTag: 'en',
  },
  membership: {
    id: 'membership-1',
    material: {
      snapshot: {
        learningMaterializationId: 'materialization-1',
        validationStatus: 'validated',
      },
      content: {
        resources: [
          { materialRoleKey: 'target_expression', contentPayload: { surface: 'borrow' } },
          { materialRoleKey: 'sense_confirmation', contentPayload: { meaning: '暂时取得并预期归还' } },
          { materialRoleKey: 'language_structure', contentPayload: { expressionKind: 'word' } },
          { materialRoleKey: 'experience_recall_cue', contentPayload: { scene: '向同事借伞，第二天归还。' } },
          { materialRoleKey: 'pronunciation', contentPayload: { phoneticNotation: '/ˈbɒrəʊ/', accentLabel: 'UK', audioUrl: null } },
        ],
      },
    },
  },
};

const personalSource: PersonalMeaningLearningSource = {
  sourceKind: 'personal_meaning_alignment',
  reference: {
    personalMeaningId: 'personal-meaning-1',
    personalMeaningRevisionId: 'personal-meaning-revision-1',
    personalMeaningAlignmentId: 'alignment-1',
    alignmentRevision: 2,
    alignmentBasisReferenceId: 'basis-1',
    meaningFocusId: null,
    senseId: 'sense-2',
    senseVersionId: 'sense-version-2',
    bindingId: 'binding-2',
    bindingVersionId: 'binding-version-2',
  },
  targetLanguageTag: 'en',
  context: {
    text: '会议快结束时，我想提出最后一个问题。',
    images: [],
    personalSemanticAnchorRevisionIds: ['anchor-revision-1'],
  },
  expression: {
    surfaceForm: 'one last thing',
    expressionType: 'phrase',
    languageTag: 'en',
  },
  semanticSpec: {
    schemaVersion: 'sensa-sense-semantic-spec-v1',
    coreMeaningFocus: '在结束前补充最后一件事',
    prototypeScenes: [{
      summary: '对话结束前补充事项',
      participantRoles: [],
      states: [],
      directionOrCausality: null,
    }],
    includedCases: [],
    excludedCases: [],
    neighborContrasts: [],
    openQuestions: [],
  },
};

const resolve = (
  selection: Parameters<typeof resolvePracticeScopeCatalog>[0]['selection'],
  studyTargets: readonly PracticeStudyTarget[] = [studyTarget],
) => resolvePracticeScopeCatalog({
  selection,
  studyTargets,
  personalMeaningSources: [personalSource],
  studyTitle: '当前语言中已加入学习的全部内容',
  activeLanguageTag: 'en',
});

const current = resolve({ sourceId: CURRENT_STUDY_SCOPE_ID });
assert.equal(current.currentScope.targets.length, 1, 'current learning comes only from supplied Learning Targets');
const learned = current.currentScope.targets[0]!;
assert.equal(learned.identity.kind, 'learning_target');
assert.equal(learned.expression.surfaceForm, 'borrow');
assert.equal(learned.sense.label, '暂时取得并预期归还');
assert.equal(learned.context?.preview, '向同事借伞，第二天归还。');
assert.equal(learned.capabilities.validatedLearningMaterial, true);
assert.equal(learned.capabilities.pronunciation, true);

const empty = resolve({ sourceId: CURRENT_STUDY_SCOPE_ID }, []);
assert.equal(empty.currentScope.targets.length, 0, 'an empty library never falls back to bundled prototype data');

const personalTargetId = 'personal:alignment-1:binding-version-2';
const personal = resolve({
  sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  targetIds: [personalTargetId],
});
assert.equal(personal.currentScope.sourceId, PERSONAL_SEMANTIC_WORLD_SCOPE_ID);
assert.equal(personal.currentScope.targets[0]?.identity.kind, 'personal_meaning_binding');
assert.deepEqual(
  personal.currentScope.targets[0]?.context?.personalSemanticAnchorRevisionIds,
  ['anchor-revision-1'],
  'Personal Meaning context pins canonical anchor revisions',
);

const invalidPersonal = resolve({
  sourceId: PERSONAL_SEMANTIC_WORLD_SCOPE_ID,
  targetIds: ['stale-target'],
});
assert.equal(invalidPersonal.currentScope.sourceId, CURRENT_STUDY_SCOPE_ID);

const activities = resolvePracticeActivities(personal.currentScope);
assert.equal(activities.find((activity) => activity.id === 'real_world_speech_variation')?.status, 'available');
assert.equal(activities.find((activity) => activity.id === 'oral_scenario_rehearsal')?.targetCount, 1);

const snapshot = createPracticeScopeSnapshot(
  current.currentScope,
  'practice-snapshot-1',
  '2026-09-16T04:00:00.000Z',
);
(current.currentScope.targets[0]!.sense as { label: string }).label = 'changed later';
assert.equal(snapshot.targets[0]?.sense.label, '暂时取得并预期归还', 'a Session snapshot is detached from later source changes');
assert.equal(snapshot.snapshotId, 'practice-snapshot-1');

console.log('PASS: Free Practice resolves real learning and semantic-world targets, checks capabilities, and pins detached Session scope snapshots.');
