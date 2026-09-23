/** Read-only preflight for the public dictionary entries used by the live matrix. */
import { sensaLanguage } from '@sensa/contracts/sensa';
import { languageTargetFixtures } from '../../tests/web/live/languageMatrixFixtures.ts';

const results: Array<{tag: string; expression: string; status: number | string; senses: number}> = [];

for (const fixture of languageTargetFixtures) {
  const language = sensaLanguage(fixture.targetLanguageTag);
  if (!language) throw new Error(`Unknown target language: ${fixture.targetLanguageTag}`);
  const url = new URL(`https://api.wiktapi.dev/v1/en/word/${encodeURIComponent(fixture.expression)}/definitions`);
  url.searchParams.set('lang', language.wiktionaryCode);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const payload = response.ok ? await response.json() as {
      definitions?: Array<{lang_code?: string; senses?: unknown[]}>;
    } : null;
    const senses = payload?.definitions
      ?.filter(group => group.lang_code === language.wiktionaryCode)
      .reduce((count, group) => count + (group.senses?.length ?? 0), 0) ?? 0;
    results.push({tag: language.tag, expression: fixture.expression, status: response.status, senses});
  } catch (error) {
    results.push({
      tag: language.tag,
      expression: fixture.expression,
      status: error instanceof Error ? error.name : 'request_error',
      senses: 0,
    });
  }
}

for (const result of results) {
  console.log(`${result.tag}\t${result.expression}\t${result.status}\t${result.senses}`);
}
if (results.some(result => result.senses === 0)) process.exitCode = 1;
