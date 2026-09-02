import assert from 'node:assert/strict';
import type { DictionaryLookupRequest } from '../apps/web-next/src/types';
import { resolveLookupLemma } from '../apps/web-next/src/reference/resolveClickedLemma';
import { referenceSensesForDisplay } from '../apps/web-next/src/reference/referenceDictionary';

function requestFor(
  textL2: string,
  clickedSurface: string,
  occurrence = 0,
): DictionaryLookupRequest {
  let clickedStart = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    clickedStart = textL2.indexOf(clickedSurface, searchFrom);
    assert.notEqual(clickedStart, -1, `Missing occurrence ${occurrence} of ${clickedSurface}`);
    searchFrom = clickedStart + clickedSurface.length;
  }
  return {
    rawClickedForm: clickedSurface,
    exampleId: `reference-lemma-smoke:${textL2}`,
    textL2,
    clickedStart,
    clickedEnd: clickedStart + clickedSurface.length,
    clickedSurface,
  };
}

const cases = [
  [requestFor('She borrowed my charger.', 'borrowed'), 'borrow', 'verb'],
  [requestFor('These principles matter.', 'principles'), 'principle', 'noun'],
  [requestFor('They are meeting tomorrow.', 'meeting'), 'meet', 'verb'],
  [requestFor('The meeting starts tomorrow.', 'meeting'), 'meeting', 'noun'],
  [requestFor('I saw him use a saw.', 'saw', 0), 'see', 'verb'],
  [requestFor('I saw him use a saw.', 'saw', 1), 'saw', 'noun'],
] as const;

async function main(): Promise<void> {
  for (const [request, expectedLemma, expectedPartOfSpeech] of cases) {
    const resolution = resolveLookupLemma(request);
    assert.equal(resolution.lemma, expectedLemma, request.textL2);
    assert.equal(resolution.partOfSpeech, expectedPartOfSpeech, request.textL2);
    assert.equal(resolution.strategy, 'contextual_nlp', request.textL2);
  }

  console.log(`Reference lemma smoke passed (${cases.length} contextual occurrences).`);

  if (process.env.SENSA_REFERENCE_ONLINE_SMOKE === '1') {
    const { lookupReference } = await import('../apps/web-next/src/reference/referenceLookup');
    const { lookupDictionaryEntry } = await import('../apps/web-next/src/services/quickDict');
    const result = await lookupReference('borrowed');
    assert.ok(result, 'Online dictionary did not return borrow');
    assert.equal(result.entry.headword, 'borrow');
    assert.ok(result.entry.forms?.includes('borrowed'));
    assert.notEqual(result.release.provider, 'Sensa Reference MVP');
    console.log(`Online Reference smoke passed (${result.release.provider}: borrowed → borrow).`);

    const contextualRequest = requestFor('She borrowed my charger.', 'borrowed');
    const contextualEntry = await lookupDictionaryEntry(contextualRequest);
    assert.ok(contextualEntry?.referenceLookup, 'Contextual online dictionary did not return borrow');
    assert.equal(contextualEntry.word, 'borrow');
    const contextualResult = contextualEntry.referenceLookup;
    assert.notEqual(contextualResult.release.provider, 'Sensa Reference MVP');
    assert.ok(contextualResult.contextualResolution);
    assert.ok(
      contextualResult.contextualResolution.status === 'ambiguous'
      || contextualResult.contextualResolution.status === 'unresolved',
      'No-key smoke must not claim a selected WSD sense',
    );
    console.log('Combined contextual Reference smoke passed without invoking a WSD model.');

    const selected = result.entry.senses[result.entry.senses.length - 1];
    const projected = referenceSensesForDisplay({
      ...result,
      contextualResolution: {
        status: 'model_confident',
        referenceSenseId: selected.referenceSenseId,
        resolverVersion: 'smoke',
        confidence: 0.6,
      },
    });
    assert.equal(projected[0]?.referenceSenseId, selected.referenceSenseId);
    assert.deepEqual(
      projected.slice(1).map((sense) => sense.referenceSenseId),
      result.entry.senses
        .filter((sense) => sense.referenceSenseId !== selected.referenceSenseId)
        .map((sense) => sense.referenceSenseId),
    );
    console.log('Contextual sense projection smoke passed (selected first, remaining order stable).');
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
