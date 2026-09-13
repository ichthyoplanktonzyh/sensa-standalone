import type {
  ContextualSenseResolution,
  DictionaryLookupInput,
  DictionaryLookupRequest,
} from '../types';
import {
  type ReferenceEntry,
  type ReferenceExample,
  type ReferenceLookupResult,
  type ReferencePronunciation,
  type ReferenceRelease,
  type ReferenceSense,
} from './referenceDictionary';
import { resolveLookupLemma } from './resolveClickedLemma';
import { complete } from '../../data/library/transport';
import { selectedProvider } from '../../data/library/providers';
import { languageRoutesSnapshot } from '../../data/library/language';
import {
  sensaLanguageForDeclaredTag,
  sensaLexiconEdition,
  type SensaPinnedLanguageContext,
  type SensaLanguage,
} from '@sensa/contracts/sensa';

const WIKT_API_ORIGIN = 'https://api.wiktapi.dev';
const FREE_DICTIONARY_API_ORIGIN = 'https://api.dictionaryapi.dev';
/** The official Wikimedia REST endpoint. One edition carries every language, so
 * this provider is the one that stays reachable for a non-English target
 * language when the aggregators do not.
 *
 * Verified live: `GET /api/rest_v1/page/definition/hola` answers
 * `Access-Control-Allow-Origin: *` and groups its payload by Wiktionary
 * language code, which is what `sensaLanguage(tag).wiktionaryCode` selects. It
 * returns no pronunciation evidence at all, so an entry built from it carries
 * no IPA rather than a guessed one. */
const WIKTIONARY_REST_ORIGIN = 'https://en.wiktionary.org';

/** Protocol version of the closed-set word-sense decision. It deliberately does not
 * name a model: whichever provider answers is reported separately as `modelId`. */
const RESOLVER_VERSION = 'sensa.reference-wsd.v2';
/** The WSD prompt and the closed candidate set, as one system instruction.
 *
 * The languages are named because the same prompt now serves every target
 * language: without them a model asked about a Spanish occurrence would still
 * be told it is disambiguating English and would read the candidates as English
 * words. The Support-Language rendering is a display layer requested in the
 * same round — the closed candidate set and the ban on revising a definition
 * are unchanged. */
function resolverSystem(language: SensaLanguage, supportLanguageTag: string): string {
  const target = language.names.en;
  const support = sensaLanguageForDeclaredTag(supportLanguageTag)?.names.en ?? supportLanguageTag;
  return [
    `You are a strict ${target} (${language.tag}) word-sense disambiguator.`,
    'Select only from the supplied referenceSenseId values. Never write or revise a definition.',
    'Use the exact clicked occurrence and the whole sentence. If one candidate is not clearly better, return ambiguous.',
    `When you select one sense, also render that sense in ${support} (${supportLanguageTag}) as a short gloss the learner reads instead of the ${target} wording. Translate; do not add, narrow or contradict anything the definition did not say.`,
    'Return JSON only, in exactly one of these shapes:',
    '{"status":"selected","referenceSenseId":"one supplied id","confidence":0.0,"glossL1":"one short sentence in the learner language"}',
    '{"status":"ambiguous","candidateReferenceSenseIds":["supplied id"],"confidence":0.0}',
    '{"status":"unresolved","confidence":0.0}',
  ].join('\n');
}
const CONTEXTUAL_CONFIDENCE_THRESHOLD = 0.6;

interface LookupOptions {
  signal?: AbortSignal;
  /** The language pair this lookup is about. Absent means the learner's stored
   * profile, read once before any provider call so a language switch in another
   * tab cannot split one lookup across two languages. */
  languages?: SensaPinnedLanguageContext;
}

/** Everything a provider needs to answer in the right language, resolved once
 * per lookup and never re-read from storage mid-flight. */
interface ReferenceLookupContext {
  readonly language: SensaLanguage;
  readonly supportLanguageTag: string;
}

interface ReferenceDictionaryProvider {
  readonly providerId: string;
  /** Whether this provider can answer for the target language at all. A provider
   * restricted to one language is skipped rather than queried and then
   * discarded, so the answer never silently comes from the wrong language. */
  serves(language: SensaLanguage): boolean;
  lookup(
    rawWord: string,
    context: ReferenceLookupContext,
    signal?: AbortSignal,
  ): Promise<ReferenceLookupResult | null>;
}

export class ReferenceLookupUnavailableError extends Error {
  constructor(readonly providerIds: readonly string[]) {
    super(`Online dictionary providers unavailable: ${providerIds.join(', ')}`);
    this.name = 'ReferenceLookupUnavailableError';
  }
}

interface WiktExamplePayload {
  text?: string;
  ref?: string;
}

interface WiktSensePayload {
  glosses?: string[];
  examples?: WiktExamplePayload[];
  tags?: string[];
}

interface WiktDefinitionGroupPayload {
  pos?: string;
  lang_code?: string;
  senses?: WiktSensePayload[];
}

interface WiktDefinitionsPayload {
  word?: string;
  edition?: string;
  definitions?: WiktDefinitionGroupPayload[];
}

interface WiktSoundPayload {
  ipa?: string | null;
  audio?: string | null;
  tags?: string[];
}

interface WiktPronunciationGroupPayload {
  lang_code?: string;
  sounds?: WiktSoundPayload[];
}

interface WiktPronunciationsPayload {
  pronunciations?: WiktPronunciationGroupPayload[];
}

interface FreeDictionaryDefinitionPayload {
  definition?: string;
  example?: string;
}

interface FreeDictionaryMeaningPayload {
  partOfSpeech?: string;
  definitions?: FreeDictionaryDefinitionPayload[];
}

interface FreeDictionaryPhoneticPayload {
  text?: string;
  audio?: string;
}

interface FreeDictionaryEntryPayload {
  word?: string;
  phonetic?: string;
  phonetics?: FreeDictionaryPhoneticPayload[];
  meanings?: FreeDictionaryMeaningPayload[];
  sourceUrls?: string[];
}

interface ModelDecisionPayload {
  status?: unknown;
  referenceSenseId?: unknown;
  candidateReferenceSenseIds?: unknown;
  confidence?: unknown;
  glossL1?: unknown;
}

/** The official Wiktionary REST payload is keyed by Wiktionary language code.
 * Its `definition` values are rendered HTML, not plain text. */
interface WiktRestDefinitionPayload {
  definition?: string;
  parsedExamples?: Array<{ example?: string }>;
}

interface WiktRestPartOfSpeechPayload {
  partOfSpeech?: string;
  language?: string;
  definitions?: WiktRestDefinitionPayload[];
}

type WiktRestPayload = Record<string, WiktRestPartOfSpeechPayload[] | undefined>;

/** Keeps every letter of every script, so a Spanish `niño` or a Japanese
 * `ありがとう` reaches the provider as itself instead of losing the characters
 * an English-only range would have stripped. */
function normalizeLookupWord(rawWord: string, language: SensaLanguage): string {
  return rawWord
    .trim()
    .replace(/[’]/g, "'")
    .replace(/^[^\p{L}\p{M}'-]+|[^\p{L}\p{M}'-]+$/gu, '')
    .toLocaleLowerCase(language.speechLocale);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function isValidContextualRequest(request: DictionaryLookupRequest): boolean {
  if (!request.exampleId.trim() || !request.textL2) return false;
  if (!request.rawClickedForm.trim() || !request.clickedSurface) return false;
  if (!Number.isInteger(request.clickedStart) || !Number.isInteger(request.clickedEnd)) return false;
  if (request.clickedStart < 0 || request.clickedEnd <= request.clickedStart) return false;
  if (request.clickedEnd > request.textL2.length) return false;
  return request.textL2.slice(request.clickedStart, request.clickedEnd) === request.clickedSurface;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  parentSignal?: AbortSignal,
  timeoutMs = 6500,
): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener('abort', relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 404) return { status: response.status, data: null };
    if (!response.ok) throw new Error(`Reference provider returned ${response.status}`);
    return { status: response.status, data: await response.json() as T };
  } finally {
    globalThis.clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', relayAbort);
  }
}

function makeWiktRelease(language: SensaLanguage, supportLanguageTag: string): ReferenceRelease {
  return Object.freeze({
    releaseId: `wiktapi.${sensaLexiconEdition}-wiktionary.${language.wiktionaryCode}-${supportLanguageTag}.current.prototype`,
    provider: `WiktAPI · ${sensaLexiconEdition} Wiktionary · ${language.names.en}`,
    edition: '公开实时快照',
    targetLanguage: language.tag,
    learnerLocale: supportLanguageTag,
    rightsLabel: 'Wiktionary 内容遵循 CC BY-SA；当前实时源仅用于 MVP，生产版需固定快照',
    status: 'prototype',
  });
}

function wiktAudioUrl(filename: string | null): string | undefined {
  if (!filename) return undefined;
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`;
}

/** An accent id for evidence the source did not place by region. English keeps
 * the two variants the product already labels; every other language reports its
 * own tag, because calling a Spanish recording `en-US` would be a claim the
 * provider never made. */
function pronunciationAccent(
  rawAccent: string,
  language: SensaLanguage,
): string {
  if (language.wiktionaryCode !== 'en') return language.tag;
  return rawAccent.includes('uk') || rawAccent.includes('british') ? 'en-GB' : 'en-US';
}

function normalizeWiktPronunciations(
  payload: WiktPronunciationsPayload | null,
  language: SensaLanguage,
): ReferencePronunciation[] {
  const pronunciations: ReferencePronunciation[] = [];
  const seen = new Set<string>();
  for (const group of payload?.pronunciations ?? []) {
    if (group.lang_code !== language.wiktionaryCode) continue;
    for (const sound of group.sounds ?? []) {
      const ipa = cleanText(sound.ipa) ?? '';
      const audioUrl = wiktAudioUrl(cleanText(sound.audio));
      if (!ipa && !audioUrl) continue;
      const rawAccent = `${sound.audio ?? ''} ${(sound.tags ?? []).join(' ')}`.toLocaleLowerCase(language.speechLocale);
      const accent = pronunciationAccent(rawAccent, language);
      const identity = `${accent}:${ipa}:${audioUrl ?? ''}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      pronunciations.push({
        pronunciationId: `ref.wikt.pronunciation.${stableHash(identity)}`,
        accent,
        ipa,
        audioUrl,
      });
    }
  }
  return pronunciations.slice(0, 6);
}

function normalizeWiktExamples(
  headword: string,
  senseIdentity: string,
  examples: WiktExamplePayload[] | undefined,
  language: SensaLanguage,
): ReferenceExample[] {
  const normalized: ReferenceExample[] = [];
  for (const example of examples ?? []) {
    const textL2 = cleanText(example.text);
    if (!textL2) continue;
    normalized.push({
      exampleId: `ref.wikt.example.${language.wiktionaryCode}.${headword}.${stableHash(`${senseIdentity}:${textL2}`)}`,
      textL2,
      sourceLabel: cleanText(example.ref) ?? `${language.names.en} Wiktionary`,
    });
  }
  return normalized;
}

function normalizeWiktEntry(
  rawWord: string,
  definitions: WiktDefinitionsPayload,
  pronunciations: WiktPronunciationsPayload | null,
  language: SensaLanguage,
  supportLanguageTag: string,
): ReferenceLookupResult | null {
  const headword = normalizeLookupWord(definitions.word ?? rawWord, language);
  if (!headword) return null;
  const senses: ReferenceSense[] = [];

  for (const group of definitions.definitions ?? []) {
    if (group.lang_code !== language.wiktionaryCode) continue;
    const partOfSpeech = cleanText(group.pos) ?? 'word';
    for (const sourceSense of group.senses ?? []) {
      const glosses = (sourceSense.glosses ?? []).map(cleanText).filter((value): value is string => Boolean(value));
      const definitionL2 = glosses[glosses.length - 1];
      if (!definitionL2) continue;
      const identity = `${language.wiktionaryCode}:${headword}:${partOfSpeech}:${definitionL2}`;
      senses.push({
        referenceSenseId: `ref.wikt.sense.${headword}.${stableHash(identity)}`,
        order: senses.length + 1,
        partOfSpeech,
        definitionL2,
        labels: (sourceSense.tags ?? []).map(cleanText).filter((value): value is string => Boolean(value)),
        examples: normalizeWiktExamples(headword, identity, sourceSense.examples, language),
      });
    }
  }

  if (senses.length === 0) return null;
  const release = makeWiktRelease(language, supportLanguageTag);
  return {
    release,
    entry: {
      referenceLexicalUnitId: `ref.wikt.lexical-unit.${language.wiktionaryCode}.${headword}.${stableHash(`${language.wiktionaryCode}:${headword}`)}`,
      releaseId: release.releaseId,
      headword,
      visibility: 'reference_visible',
      pronunciations: normalizeWiktPronunciations(pronunciations, language),
      forms: rawWord.trim() && rawWord.trim().toLocaleLowerCase(language.speechLocale) !== headword
        ? [headword, rawWord.trim()]
        : [headword],
      senses,
      attribution: `${language.names.en} Wiktionary via WiktAPI (CC BY-SA)`,
    },
  };
}

const wiktApiProvider: ReferenceDictionaryProvider = {
  providerId: 'wiktapi',
  serves: () => true,
  async lookup(rawWord, context, signal) {
    const { language, supportLanguageTag } = context;
    const word = normalizeLookupWord(rawWord, language);
    if (!word) return null;
    const encodedWord = encodeURIComponent(word);
    // The edition stays the shared English Wiktionary; `lang` selects the
    // language whose group defines this word.
    const base = `${WIKT_API_ORIGIN}/v1/${sensaLexiconEdition}/word/${encodedWord}`;
    const group = encodeURIComponent(language.wiktionaryCode);
    const [definitionsResult, pronunciationsResult] = await Promise.allSettled([
      fetchJson<WiktDefinitionsPayload>(`${base}/definitions?lang=${group}`, {}, signal),
      fetchJson<WiktPronunciationsPayload>(`${base}/pronunciations?lang=${group}`, {}, signal),
    ]);
    if (definitionsResult.status === 'rejected') throw definitionsResult.reason;
    if (!definitionsResult.value.data) return null;
    const pronunciations = pronunciationsResult.status === 'fulfilled'
      ? pronunciationsResult.value.data
      : null;
    return normalizeWiktEntry(rawWord, definitionsResult.value.data, pronunciations, language, supportLanguageTag);
  },
};

function makeFreeDictionaryRelease(language: SensaLanguage, supportLanguageTag: string): ReferenceRelease {
  return Object.freeze({
    releaseId: `free-dictionary-api.${language.wiktionaryCode}-${supportLanguageTag}.current.prototype`,
    provider: `Free Dictionary API · ${language.names.en}`,
    edition: '公开实时结果',
    targetLanguage: language.tag,
    learnerLocale: supportLanguageTag,
    rightsLabel: '聚合词典结果；具体授权与来源以条目返回的 sourceUrls 为准',
    status: 'prototype',
  });
}

function normalizeFreeDictionaryEntry(
  rawWord: string,
  payload: FreeDictionaryEntryPayload[],
  language: SensaLanguage,
  supportLanguageTag: string,
): ReferenceLookupResult | null {
  const sourceEntry = payload[0];
  const headword = normalizeLookupWord(sourceEntry?.word ?? rawWord, language);
  if (!sourceEntry || !headword) return null;
  const senses: ReferenceSense[] = [];
  for (const meaning of sourceEntry.meanings ?? []) {
    const partOfSpeech = cleanText(meaning.partOfSpeech) ?? 'word';
    for (const sourceDefinition of meaning.definitions ?? []) {
      const definitionL2 = cleanText(sourceDefinition.definition);
      if (!definitionL2) continue;
      const identity = `${headword}:${partOfSpeech}:${definitionL2}`;
      const example = cleanText(sourceDefinition.example);
      senses.push({
        referenceSenseId: `ref.free-dictionary.sense.${headword}.${stableHash(identity)}`,
        order: senses.length + 1,
        partOfSpeech,
        definitionL2,
        examples: example ? [{
          exampleId: `ref.free-dictionary.example.${headword}.${stableHash(`${identity}:${example}`)}`,
          textL2: example,
          sourceLabel: 'Free Dictionary API',
        }] : [],
      });
    }
  }
  if (senses.length === 0) return null;

  const pronunciations: ReferencePronunciation[] = [];
  const seenPronunciations = new Set<string>();
  for (const sourcePronunciation of sourceEntry.phonetics ?? []) {
    const ipa = cleanText(sourcePronunciation.text) ?? '';
    const audioUrl = cleanText(sourcePronunciation.audio) ?? undefined;
    if (!ipa && !audioUrl) continue;
    const identity = `${ipa}:${audioUrl ?? ''}`;
    if (seenPronunciations.has(identity)) continue;
    seenPronunciations.add(identity);
    pronunciations.push({
      pronunciationId: `ref.free-dictionary.pronunciation.${stableHash(identity)}`,
      accent: audioUrl?.toLocaleLowerCase().includes('-uk') ? 'en-GB' : 'en-US',
      ipa,
      audioUrl,
    });
  }
  if (pronunciations.length === 0 && sourceEntry.phonetic) {
    pronunciations.push({
      pronunciationId: `ref.free-dictionary.pronunciation.${stableHash(sourceEntry.phonetic)}`,
      accent: 'en-US',
      ipa: sourceEntry.phonetic,
    });
  }

  const release = makeFreeDictionaryRelease(language, supportLanguageTag);
  return {
    release,
    entry: {
      referenceLexicalUnitId: `ref.free-dictionary.lexical-unit.${headword}.${stableHash(headword)}`,
      releaseId: release.releaseId,
      headword,
      visibility: 'reference_visible',
      pronunciations,
      forms: [headword],
      senses,
      attribution: sourceEntry.sourceUrls?.join(' · ') || 'Free Dictionary API',
    },
  };
}

const freeDictionaryProvider: ReferenceDictionaryProvider = {
  providerId: 'free-dictionary-api',
  /** The aggregator indexes English entries only, so it is skipped for every
   * other target language instead of being asked and returning English. */
  serves: (language) => language.wiktionaryCode === 'en',
  async lookup(rawWord, context, signal) {
    const word = normalizeLookupWord(rawWord, context.language);
    if (!word) return null;
    const url = `${FREE_DICTIONARY_API_ORIGIN}/api/v2/entries/en/${encodeURIComponent(word)}`;
    const response = await fetchJson<FreeDictionaryEntryPayload[]>(url, {}, signal, 4500);
    return response.data
      ? normalizeFreeDictionaryEntry(rawWord, response.data, context.language, context.supportLanguageTag)
      : null;
  },
};

/** Strips the rendered HTML the official endpoint returns, so a gloss reaches
 * the candidate set as the sentence a learner reads. Tags are removed rather
 * than replaced by a space, because a link is inline text and `hello</a>, world`
 * must not become `hello , world`. */
function wiktRestText(value: string | undefined): string | null {
  if (!value) return null;
  return cleanText(
    value
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+([,.;:!?])/g, '$1'),
  );
}

function makeWiktRestRelease(language: SensaLanguage, supportLanguageTag: string): ReferenceRelease {
  return Object.freeze({
    releaseId: `wiktionary-rest.${sensaLexiconEdition}-wiktionary.${language.wiktionaryCode}-${supportLanguageTag}.current.prototype`,
    provider: `Wiktionary REST · ${sensaLexiconEdition} Wiktionary · ${language.names.en}`,
    edition: '公开实时结果',
    targetLanguage: language.tag,
    learnerLocale: supportLanguageTag,
    rightsLabel: 'Wiktionary 内容遵循 CC BY-SA 4.0；当前实时源仅用于 MVP，生产版需固定快照',
    status: 'prototype',
  });
}

function normalizeWiktRestEntry(
  rawWord: string,
  payload: WiktRestPayload,
  language: SensaLanguage,
  supportLanguageTag: string,
): ReferenceLookupResult | null {
  const headword = normalizeLookupWord(rawWord, language);
  if (!headword) return null;
  const senses: ReferenceSense[] = [];

  for (const group of payload[language.wiktionaryCode] ?? []) {
    const partOfSpeech = cleanText(group.partOfSpeech) ?? 'word';
    for (const sourceDefinition of group.definitions ?? []) {
      const definitionL2 = wiktRestText(sourceDefinition.definition);
      if (!definitionL2) continue;
      const identity = `${language.wiktionaryCode}:${headword}:${partOfSpeech}:${definitionL2}`;
      const examples: ReferenceExample[] = [];
      for (const parsed of sourceDefinition.parsedExamples ?? []) {
        const textL2 = wiktRestText(parsed.example);
        if (!textL2) continue;
        examples.push({
          exampleId: `ref.wiktionary-rest.example.${language.wiktionaryCode}.${headword}.${stableHash(`${identity}:${textL2}`)}`,
          textL2,
          sourceLabel: `${language.names.en} Wiktionary`,
        });
      }
      senses.push({
        referenceSenseId: `ref.wiktionary-rest.sense.${headword}.${stableHash(identity)}`,
        order: senses.length + 1,
        partOfSpeech,
        definitionL2,
        examples,
      });
    }
  }

  if (senses.length === 0) return null;
  const release = makeWiktRestRelease(language, supportLanguageTag);
  return {
    release,
    entry: {
      referenceLexicalUnitId: `ref.wiktionary-rest.lexical-unit.${language.wiktionaryCode}.${headword}.${stableHash(`${language.wiktionaryCode}:${headword}`)}`,
      releaseId: release.releaseId,
      headword,
      visibility: 'reference_visible',
      // This endpoint returns no pronunciation evidence for any language, so
      // the entry carries none instead of a rendering guessed from spelling.
      pronunciations: [],
      forms: [headword],
      senses,
      attribution: `${language.names.en} Wiktionary (CC BY-SA 4.0)`,
    },
  };
}

const wiktRestProvider: ReferenceDictionaryProvider = {
  providerId: 'wiktionary-rest',
  serves: () => true,
  async lookup(rawWord, context, signal) {
    const word = normalizeLookupWord(rawWord, context.language);
    if (!word) return null;
    const url = `${WIKTIONARY_REST_ORIGIN}/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
    const response = await fetchJson<WiktRestPayload>(url, {}, signal);
    return response.data
      ? normalizeWiktRestEntry(rawWord, response.data, context.language, context.supportLanguageTag)
      : null;
  },
};

/** Providers are tried in order and the first answer wins; a provider that
 * cannot serve the target language is not in the list at all. */
const providers: readonly ReferenceDictionaryProvider[] = [
  wiktApiProvider,
  freeDictionaryProvider,
  wiktRestProvider,
];

const entryCache = new Map<string, ReferenceLookupResult>();

/** Cache identity is the language plus the word. A Spanish `actual` and an
 * English `actual` are different entries, and one must never answer the other. */
function entryCacheKey(word: string, language: SensaLanguage): string {
  return `${language.wiktionaryCode}:${word}`;
}

async function lookupBaseEntry(
  rawWord: string,
  context: ReferenceLookupContext,
  signal?: AbortSignal,
): Promise<ReferenceLookupResult | null> {
  const normalized = normalizeLookupWord(rawWord, context.language);
  if (!normalized) return null;
  const cacheKey = entryCacheKey(normalized, context.language);
  const cached = entryCache.get(cacheKey);
  if (cached) return cached;

  const serving = providers.filter((provider) => provider.serves(context.language));
  const unavailableProviders: string[] = [];
  for (const provider of serving) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      const result = await provider.lookup(rawWord, context, signal);
      if (result) {
        entryCache.set(cacheKey, result);
        return result;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      unavailableProviders.push(provider.providerId);
    }
  }

  if (serving.length > 0 && unavailableProviders.length === serving.length) {
    throw new ReferenceLookupUnavailableError(unavailableProviders);
  }
  return null;
}

function attachSurfaceForm(
  result: ReferenceLookupResult,
  surface: string,
  language: SensaLanguage,
): ReferenceLookupResult {
  const normalizedSurface = normalizeLookupWord(surface, language);
  if (!normalizedSurface || normalizedSurface === result.entry.headword) return result;
  return {
    ...result,
    entry: {
      ...result.entry,
      forms: [...new Set([...(result.entry.forms ?? [result.entry.headword]), normalizedSurface])],
    },
  };
}

function fallbackResolution(entry: ReferenceEntry): ContextualSenseResolution {
  return entry.senses.length > 1
    ? {
        status: 'ambiguous',
        resolverVersion: `${RESOLVER_VERSION}.unavailable`,
      }
    : {
        status: 'unresolved',
        resolverVersion: `${RESOLVER_VERSION}.unavailable`,
      };
}

function parseModelDecision(rawText: string): ModelDecisionPayload | null {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as ModelDecisionPayload : null;
  } catch {
    return null;
  }
}

function confidenceFromDecision(decision: ModelDecisionPayload): number {
  if (typeof decision.confidence !== 'number' || !Number.isFinite(decision.confidence)) return 0;
  return Math.max(0, Math.min(1, decision.confidence));
}

/** A rendering is usable only when it is one short, single-line piece of prose.
 * A refusal, a list or a paragraph of model commentary is dropped rather than
 * shown to a learner as if the dictionary had said it. */
function learnerGlossFromDecision(decision: ModelDecisionPayload): string | undefined {
  if (typeof decision.glossL1 !== 'string') return undefined;
  const gloss = decision.glossL1.replace(/\s+/g, ' ').trim();
  if (!gloss || gloss.length > 240) return undefined;
  return gloss;
}

/** A decision is only usable when it names one of the closed candidate ids, and it
 * keeps the answering model so a stored resolution can be traced to what produced it. */
function validateModelDecision(
  decision: ModelDecisionPayload,
  closedSenseIds: ReadonlySet<string>,
  modelId: string,
): ContextualSenseResolution {
  const confidence = confidenceFromDecision(decision);
  if (
    decision.status === 'selected'
    && typeof decision.referenceSenseId === 'string'
    && closedSenseIds.has(decision.referenceSenseId)
  ) {
    if (confidence >= CONTEXTUAL_CONFIDENCE_THRESHOLD) {
      return {
        status: 'model_confident',
        referenceSenseId: decision.referenceSenseId,
        resolverVersion: RESOLVER_VERSION,
        confidence,
        modelId,
        glossL1: learnerGlossFromDecision(decision),
      };
    }
    return {
      status: 'ambiguous',
      candidateReferenceSenseIds: [decision.referenceSenseId],
      resolverVersion: RESOLVER_VERSION,
      confidence,
      modelId,
    };
  }

  if (decision.status === 'ambiguous' && Array.isArray(decision.candidateReferenceSenseIds)) {
    const candidates = [...new Set(decision.candidateReferenceSenseIds)]
      .filter((value): value is string => typeof value === 'string' && closedSenseIds.has(value))
      .slice(0, 4);
    return {
      status: candidates.length > 0 ? 'ambiguous' : 'unresolved',
      candidateReferenceSenseIds: candidates.length > 0 ? candidates : undefined,
      resolverVersion: RESOLVER_VERSION,
      confidence,
      modelId,
    };
  }

  return {
    status: 'unresolved',
    resolverVersion: RESOLVER_VERSION,
    confidence,
    modelId,
  };
}

/** Closed-set word-sense decision through the model management boundary.
 *
 * The `reference` purpose decides the provider: an assigned local connection runs in
 * this page, otherwise the Sensa service resolves it with the account's own connection
 * or the managed default. Either way this function owns only the decision protocol —
 * never a provider endpoint, a credential or a model id. */
async function resolveWithModel(
  request: DictionaryLookupRequest,
  entry: ReferenceEntry,
  context: ReferenceLookupContext,
  signal?: AbortSignal,
): Promise<ContextualSenseResolution> {
  if (!isValidContextualRequest(request)) {
    return {
      status: 'unresolved',
      resolverVersion: `${RESOLVER_VERSION}.invalid-request`,
    };
  }

  const closedSenseIds = new Set(entry.senses.map((sense) => sense.referenceSenseId));
  const candidates = entry.senses.map((sense) => ({
    referenceSenseId: sense.referenceSenseId,
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definitionL2 ?? sense.glossL1 ?? '',
    labels: sense.labels ?? [],
    examples: (sense.examples ?? []).slice(0, 2).map((example) => example.textL2),
  }));

  try {
    const provider = await selectedProvider('reference');
    const completion = await complete(
      provider,
      'reference',
      crypto.randomUUID(),
      [
        { role: 'system', content: resolverSystem(context.language, context.supportLanguageTag) },
        {
          role: 'user',
          content: JSON.stringify({
            targetLanguage: context.language.tag,
            supportLanguage: context.supportLanguageTag,
            sentence: request.textL2,
            clickedOccurrence: request.clickedSurface,
            headword: entry.headword,
            span: [request.clickedStart, request.clickedEnd],
            candidates,
          }),
        },
      ],
      [],
      signal ?? AbortSignal.timeout(12000),
    );
    const decision = parseModelDecision(completion.choices[0]?.message.content ?? '');
    return decision
      ? validateModelDecision(decision, closedSenseIds, completion.model)
      : fallbackResolution(entry);
  } catch (error) {
    // A stopped lookup stays stopped; every other failure leaves the entry as it was.
    if (signal?.aborted) throw error;
    return fallbackResolution(entry);
  }
}

async function resolveContextualReference(
  request: DictionaryLookupRequest,
  result: ReferenceLookupResult,
  context: ReferenceLookupContext,
  signal?: AbortSignal,
): Promise<ContextualSenseResolution> {
  return resolveWithModel(request, result.entry, context, signal);
}

/** Projects the recorded Support-Language rendering onto the selected sense for
 * display. The provider's entry is not rewritten: the selected sense is returned
 * as a copy carrying `glossL1` — the field the screens already prefer — while
 * `definitionL2` keeps the provider's own wording underneath it. A rendering the
 * provider itself supplied is never overwritten. */
function projectLearnerGloss(
  result: ReferenceLookupResult,
  resolution: ContextualSenseResolution,
): ReferenceLookupResult {
  const glossL1 = resolution.glossL1;
  const selectedId = resolution.referenceSenseId;
  if (!glossL1 || !selectedId || resolution.status !== 'model_confident') return result;
  let applied = false;
  const senses = result.entry.senses.map((sense) => {
    if (sense.referenceSenseId !== selectedId || sense.glossL1) return sense;
    applied = true;
    return { ...sense, glossL1 };
  });
  return applied ? { ...result, entry: { ...result.entry, senses } } : result;
}

/**
 * The app's sole live Reference boundary. Contextual calls return the online
 * dictionary entry and the closed-set WSD decision as one result.
 *
 * The operation's language context is resolved once, before the first provider call,
 * and every part of the answer belongs to it: the provider group, the release
 * metadata, the cache entry and the prompt the decision is made under. A tag
 * this release cannot place has no provider group, and a language the catalog
 * does not support as a Target Language is never queried, so both answer nothing
 * — answering in another language would look exactly like a successful lookup.
 */
export async function lookupReference(
  input: DictionaryLookupInput,
  options: LookupOptions = {},
): Promise<ReferenceLookupResult | null> {
  const languages = options.languages
    ?? (await languageRoutesSnapshot()).context;
  const language = sensaLanguageForDeclaredTag(languages.targetLanguageTag);
  if (!language?.asTarget) return null;  const context: ReferenceLookupContext = {
    language,
    supportLanguageTag: languages.supportLanguageTag,
  };

  const lemmaResolution = resolveLookupLemma(input, language);
  if (!lemmaResolution.lemma) return null;
  const baseResult = await lookupBaseEntry(lemmaResolution.lemma, context, options.signal);
  if (!baseResult) return null;
  const result = attachSurfaceForm(baseResult, lemmaResolution.surface, language);
  if (typeof input === 'string') return result;

  const request = Object.freeze({ ...input });
  const contextualResolution = await resolveContextualReference(
    request,
    result,
    context,
    options.signal,
  );
  return {
    ...projectLearnerGloss(result, contextualResolution),
    request,
    contextualResolution,
  };
}
