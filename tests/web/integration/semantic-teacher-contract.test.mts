import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseLearnerReply,
  parseOrganizedAnswer,
  workingSetForAnswer,
  parseTeacherTurn,
  teacherReplyPrefix,
  teacherCorrectionFeedback,
} from '../../../apps/web/src/experience/personalMeaningJourney/semanticTeacherContract.ts';
import type { SemanticAgentTurnInput } from '../../../apps/web/src/experience/personalMeaningJourney/semanticAgent.ts';
import {completedContextForDraft} from '../../../apps/web/src/experience/personalMeaningJourney/clarificationContext.ts';
import type {ClarificationDraftView} from '../../../apps/web/src/experience/personalMeaningJourney/types.ts';
import {sensaIntakeContextSchema} from '@sensa/contracts/sensa';

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

test('private clarity admits a complete tuple only in a validated final teacher reply',()=>{
  const turn=input();
  const full={reply:'这里可以说 water。',clarity:{context:true,sense:true,expression:true},proposal:candidate};
  assert.equal(parseTeacherTurn(full,turn).proposal?.expression,'water');
  assert.equal(parseTeacherTurn({reply:'你想说的是哪一种浇水场景？',clarity:{context:false,sense:true,expression:false},proposal:null},turn).proposal,null);
  assert.throws(()=>parseTeacherTurn({...full,clarity:{...full.clarity,context:false}},turn),/teacher_inconsistent_clarity/u);
  assert.throws(()=>parseTeacherTurn({...full,proposal:null},turn),/teacher_inconsistent_clarity/u);
  assert.throws(()=>parseTeacherTurn({...full,reply:'可以这样说。'},turn),/teacher_reply_omits_expression/u);
  try{parseTeacherTurn({...full,changeReason:'secret learner material'},turn);assert.fail('root extras must be rejected');}
  catch(cause){const feedback=teacherCorrectionFeedback(cause);assert.match(feedback,/unrecognized_keys/u);assert.match(feedback,/changeReason/u);assert(!feedback.includes('secret learner material'));}
});

test('streamed teacher text decodes only the first top-level reply and withholds private fields',()=>{
  assert.equal(teacherReplyPrefix('{"reply":"你可'), '你可');
  assert.equal(teacherReplyPrefix('{"reply":"say \\"hi\\"\\n\\u4f60\\u597d","clarity":{"secret":"must not show"}}'),'say "hi"\n你好');
  assert.equal(teacherReplyPrefix('{"reply":"emoji \\uD83D'),'emoji ');
  assert.equal(teacherReplyPrefix('{"reply":"emoji \\uD83D\\uDE00"}'),'emoji 😀');
  assert.equal(teacherReplyPrefix('{"proposal":{"reply":"private nested content"}}'),null);
  assert.equal(teacherReplyPrefix('{"clarity":{"context":true},"reply":"later reply"}'),null);
  assert.equal(teacherReplyPrefix('model hidden reasoning {"reply":"not a JSON root"}'),null);
});

test('reuse selects the looked-up immutable contract without forcing it through new-candidate length limits',()=>{
  const turn=input(),reference={senseId:crypto.randomUUID(),senseVersionId:crypto.randomUUID()};
  const match={...reference,senseKey:'existing-key-'.repeat(40),semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1' as const,
    coreMeaningFocus:'已确认的意义'.repeat(750),prototypeScenes:[{summary:'已确认的原型'.repeat(750),participantRoles:[],states:[],directionOrCausality:null}],
    includedCases:[],excludedCases:['完整边界'],neighborContrasts:[],openQuestions:[]},expressions:[{expression:'water',languageTag:'en'}],expressionsTruncated:false};
  const {sense:_sense,senseKey:_key,scene:_scene,...fields}=candidate;
  const result=parseTeacherTurn({reply:'可以说 water。',clarity:{context:true,sense:true,expression:true},proposal:{...fields,reuseSense:reference}},turn,[match]);
  const working=workingSetForAnswer(result.proposal!,turn,result.reused);
  assert.equal(working.sense!.proposedSenseKey,match.senseKey);assert.equal(working.sense!.coreMeaningFocus,match.semanticSpec.coreMeaningFocus);
  assert.deepEqual(working.sense!.excludedCases,['完整边界']);
});

test('accepted Context language preserves observation and never attributes a learner rewrite to the model',()=>{
  const draft:ClarificationDraftView={intakeId:crypto.randomUUID(),context:{modality:'text',textSegment:'I need to check my schedule.',languageTag:'en',languageObservation:{source:'detector',confidence:.9},source:null,mediaReferenceIds:[]},materialBlocks:[{kind:'text',bodyText:'I need to check my schedule.'}],familiarExpression:null,startingPoint:null};
  const candidate={summary:draft.context!.textSegment!,salientDetails:[],unresolvedDetails:[],rationale:'Fixture'};
  const unchanged=sensaIntakeContextSchema.parse(completedContextForDraft(draft,candidate,'zh-CN'));
  assert.equal(unchanged.languageTag,'en');assert.deepEqual(unchanged.languageObservation,{source:'detector',confidence:.9});
  const generated=sensaIntakeContextSchema.parse(completedContextForDraft(draft,{...candidate,summary:'学习者需要先确认自己的日程。'},'zh-CN'));
  assert.equal(generated.languageTag,'zh-CN');assert.deepEqual(generated.languageObservation,{source:'model',confidence:null});
  const learner=sensaIntakeContextSchema.parse(completedContextForDraft(draft,{...candidate,summary:'Je dois vérifier mon agenda.'},'zh-CN',true));
  assert.equal(learner.languageTag,null);assert.equal(learner.languageObservation,null);
  assert.equal(draft.context!.languageTag,'en','the original capture observation is not overwritten');
});
