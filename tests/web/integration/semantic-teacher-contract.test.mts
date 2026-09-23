import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseLearnerReply,
  parseOrganizedAnswer,
  workingSetForAnswer,
} from '../../../apps/web/src/experience/personalMeaningJourney/semanticTeacherContract.ts';
import type { SemanticAgentTurnInput } from '../../../apps/web/src/experience/personalMeaningJourney/semanticAgent.ts';

const input = (): SemanticAgentTurnInput => ({
  material: { blocks: [], familiarExpression: 'water', startingPoint: 'from_expression' },
  messages: [],
  workingSet: { context: null, focus: null, sense: null, expression: null, expressions: [] },
  readyToConfirm: false,
  learnerEditedTracks: [],
  focusLocked: false,
  languages: { targetLanguageTag: 'en', supportLanguageTag: 'zh-CN' },
});

const candidate = {
  context: '上班前给植物浇水。', sense: '给植物供水的动作。', senseKey: 'give_plant_water',
  scene: '上班前，学习者给家里的植物浇水。', expression: 'water', expressionType: 'word',
  relation: 'realizes', coverage: 'exact', reason: '这个词可作动词表达给植物浇水。',
};

test('organize_answer stages a source-grounded candidate without changing learner edits', () => {
  const turn = input();
  const answer = parseOrganizedAnswer(candidate, turn);
  const workingSet = workingSetForAnswer(answer, turn);
  assert.equal(workingSet.context?.summary, candidate.context);
  assert.equal(workingSet.sense?.coreMeaningFocus, candidate.sense);
  assert.equal(workingSet.sense?.prototypeScenes[0]?.summary, candidate.scene);
  assert.equal(workingSet.expression?.surfaceForm, candidate.expression);
  assert.equal(workingSet.expression?.languageTag, 'en');
  turn.workingSet.context = { ...workingSet.context!, summary: '学习者尚未给植物浇水。' };
  turn.learnerEditedTracks = ['context'];
  assert.throws(() => parseOrganizedAnswer(candidate, turn), /teacher_learner_edit_changed/u);
});

test('reply_to_learner announces a staged expression and explains changes', () => {
  const turn = input();
  const changed = { ...candidate, expression: 'irrigate', changeReason: '这里需要更正式的动词。' };
  assert.throws(() => parseOrganizedAnswer({ ...candidate, expression: 'irrigate' }, turn), /teacher_expression_changed_silently/u);
  const answer = parseOrganizedAnswer(changed, turn);
  assert.throws(() => parseLearnerReply({ text: '可以这样说。' }, answer, 'water'), /teacher_reply_omits_expression/u);
  assert.throws(() => parseLearnerReply({ text: '可以说 irrigate。' }, answer, 'water'), /teacher_reply_omits_familiar_expression/u);
  assert.equal(parseLearnerReply({ text: 'water 比较日常；这里需要更正式的动词。所以可以说 irrigate。' }, answer, 'water'),
    'water 比较日常；这里需要更正式的动词。所以可以说 irrigate。');
  assert.equal(parseLearnerReply({ text: '你想说的是给植物浇水吗？' }, null, 'water'), '你想说的是给植物浇水吗？');
});
