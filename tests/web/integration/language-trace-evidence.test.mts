import assert from 'node:assert/strict';
import {test} from 'vitest';
import {extractBusinessLanguageEvidence} from '../live/languageTraceEvidence';
import {languageMatrixCases, languageSupportFixtures} from '../live/languageMatrixFixtures';

test('the 306 routes have learner context and clarification in each support language', () => {
  assert.equal(languageMatrixCases.length, 306);
  assert.equal(new Set(languageMatrixCases.map(item => `${item.targetLanguageTag}--${item.supportLanguageTag}`)).size, 306);
  assert.equal(Object.keys(languageSupportFixtures).length, 18);
  for (const item of languageMatrixCases) {
    assert(item.supportFixture.context.trim());
    assert(item.supportFixture.clarification.trim());
    assert.equal(item.supportFixture, languageSupportFixtures[item.supportLanguageTag]);
    if (item.supportLanguageTag !== 'en') {
      assert.notEqual(item.supportFixture.context, languageSupportFixtures.en.context);
      assert.notEqual(item.supportFixture.clarification, languageSupportFixtures.en.clarification);
    }
  }
});

test('private language packet retains original Agent and dictionary text without inventing a verdict', () => {
  const events = [
    {agent: 'clarification', kind: 'tool_response', payload: {name: 'organize_answer', arguments: JSON.stringify({sense: {coreMeaningFocus: '树根吸收的液体'}, expression: {surfaceForm: 'water'}}), output: {ok: true}}},
    {agent: 'clarification', kind: 'tool_response', payload: {name: 'reply_to_learner', arguments: JSON.stringify({text: '你想说的是 water 吗？'}), output: {ok: true}}},
    {agent: 'clarification', kind: 'agent_result', payload: {assistantMessage: '你想说的是 water 吗？', readyToConfirm: true, workingSet: {context: {summary: '给罗勒浇水'}, sense: {coreMeaningFocus: '树根吸收的液体'}, expression: {surfaceForm: 'water', languageTag: 'en'}}}},
    {agent: 'content_generation', kind: 'tool_response', payload: {name: 'submit_resources', arguments: JSON.stringify({resources: [{role: 'recall', payload: {text: '想起水'}}]})}},
    {agent: 'content_generation', kind: 'agent_result', payload: {resources: [{role: 'example', payload: {text: 'The basil needs water.'}}]}},
    {kind: 'business_result', stage: 'dictionary_lookup', payload: {entry: {headword: 'water'}, referenceResult: {contextualResolution: {glossL1: '水'}}}},
    {kind: 'speech_request', payload: {surface: 'water', languageTag: 'en', locale: 'en-US', voice: 'en-US-AvaNeural'}},
  ];
  const packet = extractBusinessLanguageEvidence('business-en--zh-CN', 'en', 'zh-CN', events);
  assert.deepEqual(packet.clarification.replies, ['你想说的是 water 吗？']);
  assert.equal(packet.clarification.finalCandidate.expression, 'water');
  assert.equal(packet.contentGeneration.submittedResources[0].payload.text, '想起水');
  assert.equal(packet.contentGeneration.finalResources[0].payload.text, 'The basil needs water.');
  assert.equal(packet.dictionary.referenceResult.contextualResolution.glossL1, '水');
  assert.equal(packet.speechRequests[0].surface, 'water');
  assert.equal('review' in packet, false);
});
