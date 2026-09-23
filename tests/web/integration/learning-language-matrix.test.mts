import {test} from 'vitest';
import assert from 'node:assert/strict';
import {
  captureSnapshotSchema,
  semanticLookupInputSchema,
  sensaLanguageForRole,
  sensaLanguageForDeclaredTag,
  sensaLanguageLearningRouteSchema,
  sensaLanguagePromptName,
} from '@sensa/contracts/sensa';
import {semanticResolutionPrompt} from '../../../apps/api/src/sensa/personal/semanticResolver.ts';
import {defaultClientSpeechConfiguredFor} from '../../../apps/web/src/data/library/speech/edgeVoiceCatalog.ts';
import {createFirstCharacterMask} from '../../../apps/web/src/experience/components/cards/SensaRecallCard.tsx';
import {findTokenIndexByCharOffset, tokenizeSentence} from '../../../apps/web/src/experience/utils/sentenceTokenizer.ts';

const matrix = [
  {targetLanguageTag: 'en', supportLanguageTag: 'zh-CN'},
  {targetLanguageTag: 'en', supportLanguageTag: 'ja'},
  {targetLanguageTag: 'ja', supportLanguageTag: 'zh-CN'},
  {targetLanguageTag: 'ja', supportLanguageTag: 'en'},
  {targetLanguageTag: 'es', supportLanguageTag: 'zh-CN'},
  {targetLanguageTag: 'es', supportLanguageTag: 'en'},
] as const;

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('learning-language-matrix', async () => {
  for (const [index, pair] of matrix.entries()) {
    const route = sensaLanguageLearningRouteSchema.parse({
      id: uuid(index + 1),
      revision: 1,
      targetLanguageTag: pair.targetLanguageTag,
      defaultSupportLanguageTag: pair.supportLanguageTag,
      status: 'active',
    });
    assert.equal(route.targetLanguageTag, pair.targetLanguageTag, 'route retains the selected target tag');
    assert.equal(route.defaultSupportLanguageTag, pair.supportLanguageTag, 'route retains the selected support tag');

    const expression = pair.targetLanguageTag === 'en' ? 'borrow'
      : pair.targetLanguageTag === 'ja' ? '借りる' : 'prestar';
    const sentence = `A sentence containing ${expression}.`;
    const start = Array.from(sentence.slice(0, sentence.indexOf(expression))).length;
    const snapshot = captureSnapshotSchema.parse({
      sentence,
      language: pair.targetLanguageTag,
      languageSource: 'learner',
      languageConfidence: 1,
      source: {url: null, title: 'Fixture', capturedAt: '2026-09-23T00:00:00.000Z'},
      expression: {text: expression, start, end: start + Array.from(expression).length},
    });
    const languages = {
      targetLanguageTag: pair.targetLanguageTag,
      supportLanguageTag: pair.supportLanguageTag,
      languageRouteId: route.id,
      languageRouteRevision: route.revision,
    };
    const lookup = semanticLookupInputSchema.parse({id: uuid(index + 101), snapshot, languages});
    assert.equal(lookup.languages.targetLanguageTag, pair.targetLanguageTag);
    assert.equal(lookup.languages.supportLanguageTag, pair.supportLanguageTag);
    assert.equal(semanticLookupInputSchema.safeParse({id: uuid(index + 201), snapshot}).success, false,
      'semantic lookup must require an explicit pinned language pair');

    const prompt = semanticResolutionPrompt(snapshot, languages);
    const targetName = sensaLanguagePromptName(pair.targetLanguageTag);
    const supportName = sensaLanguagePromptName(pair.supportLanguageTag);
    assert.ok(prompt.includes(`selected ${targetName} (${pair.targetLanguageTag}) occurrence in ${supportName} (${pair.supportLanguageTag})`),
      `semantic prompt names the requested pair ${pair.targetLanguageTag}←${pair.supportLanguageTag}`);
    assert.ok(prompt.includes(`The explanation and semantic spec must be in ${supportName} (${pair.supportLanguageTag})`),
      'the explanation and semantic specification use the route support language');

    if (pair.targetLanguageTag !== 'en' && pair.supportLanguageTag !== 'en') {
      assert.ok(!prompt.includes('English (en)'), 'unrequested English must not be injected into the prompt');
    }
    if (pair.targetLanguageTag !== 'zh-CN' && pair.supportLanguageTag !== 'zh-CN') {
      assert.ok(!prompt.includes('Chinese (Simplified) (zh-CN)'), 'unrequested Chinese must not be injected into the prompt');
    }
  }

  // The observed capture language is independent evidence: a learner may
  // select Spanish text while the active route is English with Japanese
  // support. Keep the route pair intact and describe the occurrence as Spanish.
  const crossLanguageSnapshot = captureSnapshotSchema.parse({
    sentence: 'La puerta está abierta.',
    language: 'es',
    languageSource: 'declared',
    languageConfidence: 1,
    source: {url: null, title: 'Fixture', capturedAt: '2026-09-23T00:00:00.000Z'},
    expression: {text: 'puerta', start: 3, end: 9},
  });
  const englishJapaneseRoute = sensaLanguageLearningRouteSchema.parse({
    id: uuid(500), revision: 1, targetLanguageTag: 'en',
    defaultSupportLanguageTag: 'ja', status: 'active',
  });
  const englishJapanesePair = {
    targetLanguageTag: englishJapaneseRoute.targetLanguageTag,
    supportLanguageTag: englishJapaneseRoute.defaultSupportLanguageTag,
    languageRouteId: englishJapaneseRoute.id,
    languageRouteRevision: englishJapaneseRoute.revision,
  };
  const crossLanguageLookup = semanticLookupInputSchema.parse({
    id: uuid(501), snapshot: crossLanguageSnapshot, languages: englishJapanesePair,
  });
  assert.equal(crossLanguageLookup.languages.targetLanguageTag, 'en');
  assert.equal(crossLanguageLookup.languages.supportLanguageTag, 'ja');
  const crossLanguagePrompt = semanticResolutionPrompt(crossLanguageLookup.snapshot, crossLanguageLookup.languages);
  assert.ok(crossLanguagePrompt.includes('selected Spanish (es) occurrence in Japanese (ja)'),
    'the prompt follows the actual captured language while retaining Japanese support');
  assert.ok(crossLanguagePrompt.includes('The explanation and semantic spec must be in Japanese (ja)'),
    'the explanation follows the route support language');
  assert.ok(!crossLanguagePrompt.includes('selected English (en)'),
    'the route target does not relabel the Spanish capture as English');

  const targets = sensaLanguageForRole('target');
  const supportLanguages = sensaLanguageForRole('support');
  assert.equal(targets.length, 17, 'route targets come from the full target-language catalog');
  assert.equal(supportLanguages.length, 18, 'route support languages come from the full language catalog');
  assert.equal(targets.length * supportLanguages.length, 306, 'the route model retains the 17 × 18 pair space');
  for (const [index, target] of targets.entries()) {
    for (const support of supportLanguages) {
      const route = sensaLanguageLearningRouteSchema.parse({
        id: uuid(1000 + index * supportLanguages.length + supportLanguages.indexOf(support)),
        revision: 1,
        targetLanguageTag: target.tag,
        defaultSupportLanguageTag: support.tag,
        status: 'active',
      });
      assert.equal(route.targetLanguageTag, target.tag);
      assert.equal(route.defaultSupportLanguageTag, support.tag);
    }
  }

  assert.equal(defaultClientSpeechConfiguredFor('en'), true, 'Edge TTS has an English voice configured');
  assert.equal(defaultClientSpeechConfiguredFor('ja'), true, 'Edge TTS has a Japanese voice configured');
  assert.equal(defaultClientSpeechConfiguredFor('es'), false, 'Spanish remains explicitly unavailable in Edge TTS');
  assert.equal(sensaLanguageForDeclaredTag('zh-TW'), undefined, 'Traditional Chinese cannot be relabelled as Simplified Chinese');
  assert.equal(sensaLanguageForDeclaredTag('zh-Hant'), undefined, 'Traditional Chinese script cannot be relabelled as Simplified Chinese');
  assert.equal(sensaLanguageForDeclaredTag('zh-Hans')?.tag, 'zh-CN', 'Simplified Chinese script maps to the curated target');
  assert.equal(createFirstCharacterMask('こんにちは', 'ja'), 'こ _ _ _ _', 'Japanese recall hints hide the answer after its first character');
  assert.equal(createFirstCharacterMask('mañana', 'es'), 'm _ _ _ _ _', 'Latin letters with marks are also hidden');
  const japaneseSentence=tokenizeSentence('私は<b>猫</b>が好きです。');
  assert.equal(japaneseSentence.plainText, '私は猫が好きです。');
  const japaneseTarget=japaneseSentence.tokens.find(token=>token.isTarget);
  assert.equal(japaneseTarget?.text, '猫', 'non-Latin target text remains an interactive word');
  assert.equal(japaneseTarget?.charStart, 2, 'click and speech offsets retain the source text position');
  assert.equal(findTokenIndexByCharOffset(japaneseSentence.tokens, 2), japaneseSentence.tokens.indexOf(japaneseTarget!),
    'speech highlighting locates the Japanese target');
});
