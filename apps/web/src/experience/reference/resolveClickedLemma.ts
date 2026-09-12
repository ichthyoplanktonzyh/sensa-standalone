import nlp from 'compromise';
import type { SensaLanguage } from '@sensa/contracts/sensa';
import type { DictionaryLookupInput, DictionaryLookupRequest } from '../types';

export type EnglishPartOfSpeech =
  | 'verb'
  | 'noun'
  | 'adjective'
  | 'adverb'
  | 'other';

export interface ClickedLemmaResolution {
  surface: string;
  lemma: string;
  partOfSpeech: EnglishPartOfSpeech;
  tags: readonly string[];
  strategy: 'contextual_nlp' | 'standalone_nlp' | 'surface';
}

interface CompromiseTerm {
  text?: string;
  normal?: string;
  pre?: string;
  post?: string;
  tags?: string[];
}

interface CompromiseTermGroup {
  terms?: CompromiseTerm[];
}

/** Keeps every letter of every script instead of the Latin-only range, so a
 * clicked Spanish `niño` or Japanese `ありがとう` reaches the dictionary as
 * itself. Case folding follows the headword's own language, because Turkish
 * dotted `İ` and German `ß` do not fold the way English does. */
function normalizeLookupForm(rawWord: string, language?: SensaLanguage): string {
  return rawWord
    .trim()
    .replace(/[’]/g, "'")
    .replace(/^[^\p{L}\p{M}'-]+|[^\p{L}\p{M}'-]+$/gu, '')
    .toLocaleLowerCase(language?.speechLocale ?? 'en-US');
}

function partOfSpeech(tags: readonly string[]): EnglishPartOfSpeech {
  if (tags.includes('Verb')) return 'verb';
  if (tags.includes('Noun')) return 'noun';
  if (tags.includes('Adjective')) return 'adjective';
  if (tags.includes('Adverb')) return 'adverb';
  return 'other';
}

function termIndexAtSpan(
  text: string,
  terms: readonly CompromiseTerm[],
  clickedStart: number,
  clickedEnd: number,
): number {
  let cursor = 0;
  for (let index = 0; index < terms.length; index += 1) {
    const termText = terms[index].text ?? '';
    if (!termText) continue;
    const termStart = text.indexOf(termText, cursor);
    if (termStart < 0) continue;
    const termEnd = termStart + termText.length;
    cursor = termEnd;
    if (clickedStart >= termStart && clickedEnd <= termEnd) return index;
  }
  return -1;
}

function resolveFromDocument(
  text: string,
  clickedStart: number,
  clickedEnd: number,
  surface: string,
  strategy: ClickedLemmaResolution['strategy'],
  language?: SensaLanguage,
): ClickedLemmaResolution {
  const normalizedSurface = normalizeLookupForm(surface, language);
  if (!normalizedSurface) {
    return { surface, lemma: '', partOfSpeech: 'other', tags: [], strategy: 'surface' };
  }

  /** The lemma engine is English-only. Running it over another language would
   * tag and inflect by English rules and answer a word the learner did not
   * click, so a non-English occurrence keeps its surface form and says so. */
  if (language && language.wiktionaryCode !== 'en') {
    return {
      surface: normalizedSurface,
      lemma: normalizedSurface,
      partOfSpeech: 'other',
      tags: [],
      strategy: 'surface',
    };
  }

  const document = nlp(text);
  const termViews = document.terms();
  const termGroups = termViews.json() as CompromiseTermGroup[];
  const terms = termGroups.flatMap((item) => (
    Array.isArray(item.terms) ? item.terms : []
  ));
  const index = termIndexAtSpan(text, terms, clickedStart, clickedEnd);
  if (index < 0) {
    return {
      surface: normalizedSurface,
      lemma: normalizedSurface,
      partOfSpeech: 'other',
      tags: [],
      strategy: 'surface',
    };
  }

  const sourceTerm = terms[index];
  const tags = sourceTerm.tags ?? [];
  const pos = partOfSpeech(tags);
  const target = nlp(sourceTerm.text ?? normalizedSurface);
  let lemma = normalizeLookupForm(sourceTerm.normal ?? sourceTerm.text ?? normalizedSurface);

  if (tags.includes('Possessive')) {
    target.possessives().strip();
  }
  if (pos === 'verb') {
    lemma = normalizeLookupForm(target.verbs().toInfinitive().text()) || lemma;
  } else if (pos === 'noun') {
    lemma = normalizeLookupForm(target.nouns().toSingular().text()) || lemma;
  }

  return {
    surface: normalizedSurface,
    lemma: lemma || normalizedSurface,
    partOfSpeech: pos,
    tags,
    strategy,
  };
}

function isValidContextualInput(request: DictionaryLookupRequest): boolean {
  if (!request.textL2 || !request.clickedSurface) return false;
  if (!Number.isInteger(request.clickedStart) || !Number.isInteger(request.clickedEnd)) return false;
  if (request.clickedStart < 0 || request.clickedEnd <= request.clickedStart) return false;
  if (request.clickedEnd > request.textL2.length) return false;
  return request.textL2.slice(request.clickedStart, request.clickedEnd) === request.clickedSurface;
}

/** Resolve one clicked occurrence before any dictionary provider is called.
 *
 * `language` is the target language the occurrence belongs to. An unplaced
 * language keeps the historical English behavior, because every release the
 * product has already shipped is an English one. */
export function resolveLookupLemma(
  input: DictionaryLookupInput,
  language?: SensaLanguage,
): ClickedLemmaResolution {
  if (typeof input === 'string') {
    const surface = normalizeLookupForm(input, language);
    return resolveFromDocument(surface, 0, surface.length, surface, 'standalone_nlp', language);
  }

  if (!isValidContextualInput(input)) {
    const surface = normalizeLookupForm(input.rawClickedForm, language);
    return {
      surface,
      lemma: surface,
      partOfSpeech: 'other',
      tags: [],
      strategy: 'surface',
    };
  }

  return resolveFromDocument(
    input.textL2,
    input.clickedStart,
    input.clickedEnd,
    input.clickedSurface,
    'contextual_nlp',
    language,
  );
}
