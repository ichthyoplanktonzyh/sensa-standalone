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

const WIKT_API_ORIGIN = 'https://api.wiktapi.dev';
const FREE_DICTIONARY_API_ORIGIN = 'https://api.dictionaryapi.dev';
const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';

export const GEMINI_CONTEXTUAL_MODEL_ID = 'gemini-3.5-flash-lite';
const GEMINI_RESOLVER_VERSION = 'sensa.reference-wsd.gemini-3.5-flash-lite.v1';
const CONTEXTUAL_CONFIDENCE_THRESHOLD = 0.6;

interface LookupOptions {
  signal?: AbortSignal;
}

interface ReferenceDictionaryProvider {
  readonly providerId: string;
  lookup(rawWord: string, signal?: AbortSignal): Promise<ReferenceLookupResult | null>;
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

interface GeminiResponsePayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
}

interface ModelDecisionPayload {
  status?: unknown;
  referenceSenseId?: unknown;
  candidateReferenceSenseIds?: unknown;
  confidence?: unknown;
}

function normalizeLookupWord(rawWord: string): string {
  return rawWord
    .trim()
    .replace(/[’]/g, "'")
    .replace(/^[^a-zA-Z'-]+|[^a-zA-Z'-]+$/g, '')
    .toLocaleLowerCase('en-US');
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

function makeWiktRelease(): ReferenceRelease {
  return Object.freeze({
    releaseId: 'wiktapi.en-wiktionary.current.prototype',
    provider: 'WiktAPI · English Wiktionary',
    edition: '公开实时快照',
    targetLanguage: 'en',
    learnerLocale: 'zh-CN',
    rightsLabel: 'Wiktionary 内容遵循 CC BY-SA；当前实时源仅用于 MVP，生产版需固定快照',
    status: 'prototype',
  });
}

function wiktAudioUrl(filename: string | null): string | undefined {
  if (!filename) return undefined;
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`;
}

function normalizeWiktPronunciations(payload: WiktPronunciationsPayload | null): ReferencePronunciation[] {
  const pronunciations: ReferencePronunciation[] = [];
  const seen = new Set<string>();
  for (const group of payload?.pronunciations ?? []) {
    if (group.lang_code !== 'en') continue;
    for (const sound of group.sounds ?? []) {
      const ipa = cleanText(sound.ipa) ?? '';
      const audioUrl = wiktAudioUrl(cleanText(sound.audio));
      if (!ipa && !audioUrl) continue;
      const rawAccent = `${sound.audio ?? ''} ${(sound.tags ?? []).join(' ')}`.toLocaleLowerCase();
      const accent = rawAccent.includes('uk') || rawAccent.includes('british') ? 'en-GB' : 'en-US';
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
): ReferenceExample[] {
  const normalized: ReferenceExample[] = [];
  for (const example of examples ?? []) {
    const textL2 = cleanText(example.text);
    if (!textL2) continue;
    normalized.push({
      exampleId: `ref.wikt.example.${headword}.${stableHash(`${senseIdentity}:${textL2}`)}`,
      textL2,
      sourceLabel: cleanText(example.ref) ?? 'English Wiktionary',
    });
  }
  return normalized;
}

function normalizeWiktEntry(
  rawWord: string,
  definitions: WiktDefinitionsPayload,
  pronunciations: WiktPronunciationsPayload | null,
): ReferenceLookupResult | null {
  const headword = normalizeLookupWord(definitions.word ?? rawWord);
  if (!headword) return null;
  const senses: ReferenceSense[] = [];

  for (const group of definitions.definitions ?? []) {
    if (group.lang_code !== 'en') continue;
    const partOfSpeech = cleanText(group.pos) ?? 'word';
    for (const sourceSense of group.senses ?? []) {
      const glosses = (sourceSense.glosses ?? []).map(cleanText).filter((value): value is string => Boolean(value));
      const definitionL2 = glosses[glosses.length - 1];
      if (!definitionL2) continue;
      const identity = `${headword}:${partOfSpeech}:${definitionL2}`;
      senses.push({
        referenceSenseId: `ref.wikt.sense.${headword}.${stableHash(identity)}`,
        order: senses.length + 1,
        partOfSpeech,
        definitionL2,
        labels: (sourceSense.tags ?? []).map(cleanText).filter((value): value is string => Boolean(value)),
        examples: normalizeWiktExamples(headword, identity, sourceSense.examples),
      });
    }
  }

  if (senses.length === 0) return null;
  const release = makeWiktRelease();
  return {
    release,
    entry: {
      referenceLexicalUnitId: `ref.wikt.lexical-unit.${headword}.${stableHash(headword)}`,
      releaseId: release.releaseId,
      headword,
      visibility: 'reference_visible',
      pronunciations: normalizeWiktPronunciations(pronunciations),
      forms: rawWord.trim() && rawWord.trim().toLocaleLowerCase() !== headword
        ? [headword, rawWord.trim()]
        : [headword],
      senses,
      attribution: 'English Wiktionary via WiktAPI (CC BY-SA)',
    },
  };
}

const wiktApiProvider: ReferenceDictionaryProvider = {
  providerId: 'wiktapi',
  async lookup(rawWord, signal) {
    const word = normalizeLookupWord(rawWord);
    if (!word) return null;
    const encodedWord = encodeURIComponent(word);
    const definitionsUrl = `${WIKT_API_ORIGIN}/v1/en/word/${encodedWord}/definitions?lang=en`;
    const pronunciationsUrl = `${WIKT_API_ORIGIN}/v1/en/word/${encodedWord}/pronunciations?lang=en`;
    const [definitionsResult, pronunciationsResult] = await Promise.allSettled([
      fetchJson<WiktDefinitionsPayload>(definitionsUrl, {}, signal),
      fetchJson<WiktPronunciationsPayload>(pronunciationsUrl, {}, signal),
    ]);
    if (definitionsResult.status === 'rejected') throw definitionsResult.reason;
    if (!definitionsResult.value.data) return null;
    const pronunciations = pronunciationsResult.status === 'fulfilled'
      ? pronunciationsResult.value.data
      : null;
    return normalizeWiktEntry(rawWord, definitionsResult.value.data, pronunciations);
  },
};

function makeFreeDictionaryRelease(): ReferenceRelease {
  return Object.freeze({
    releaseId: 'free-dictionary-api.en.current.prototype',
    provider: 'Free Dictionary API',
    edition: '公开实时结果',
    targetLanguage: 'en',
    learnerLocale: 'zh-CN',
    rightsLabel: '聚合词典结果；具体授权与来源以条目返回的 sourceUrls 为准',
    status: 'prototype',
  });
}

function normalizeFreeDictionaryEntry(
  rawWord: string,
  payload: FreeDictionaryEntryPayload[],
): ReferenceLookupResult | null {
  const sourceEntry = payload[0];
  const headword = normalizeLookupWord(sourceEntry?.word ?? rawWord);
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

  const release = makeFreeDictionaryRelease();
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
  async lookup(rawWord, signal) {
    const word = normalizeLookupWord(rawWord);
    if (!word) return null;
    const url = `${FREE_DICTIONARY_API_ORIGIN}/api/v2/entries/en/${encodeURIComponent(word)}`;
    const response = await fetchJson<FreeDictionaryEntryPayload[]>(url, {}, signal, 4500);
    return response.data ? normalizeFreeDictionaryEntry(rawWord, response.data) : null;
  },
};

const providers: readonly ReferenceDictionaryProvider[] = [
  wiktApiProvider,
  freeDictionaryProvider,
];

const entryCache = new Map<string, ReferenceLookupResult>();

async function lookupBaseEntry(
  rawWord: string,
  signal?: AbortSignal,
): Promise<ReferenceLookupResult | null> {
  const normalized = normalizeLookupWord(rawWord);
  if (!normalized) return null;
  const cached = entryCache.get(normalized);
  if (cached) return cached;

  const unavailableProviders: string[] = [];
  for (const provider of providers) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    try {
      const result = await provider.lookup(rawWord, signal);
      if (result) {
        entryCache.set(normalized, result);
        return result;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      unavailableProviders.push(provider.providerId);
    }
  }

  if (unavailableProviders.length === providers.length) {
    throw new ReferenceLookupUnavailableError(unavailableProviders);
  }
  return null;
}

function attachSurfaceForm(
  result: ReferenceLookupResult,
  surface: string,
): ReferenceLookupResult {
  const normalizedSurface = normalizeLookupWord(surface);
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
        resolverVersion: `${GEMINI_RESOLVER_VERSION}.unavailable`,
      }
    : {
        status: 'unresolved',
        resolverVersion: `${GEMINI_RESOLVER_VERSION}.unavailable`,
      };
}

function geminiApiKey(): string | null {
  const value = import.meta.env?.VITE_GEMINI_API_KEY;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function validateModelDecision(
  decision: ModelDecisionPayload,
  closedSenseIds: ReadonlySet<string>,
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
        resolverVersion: GEMINI_RESOLVER_VERSION,
        confidence,
        modelId: GEMINI_CONTEXTUAL_MODEL_ID,
      };
    }
    return {
      status: 'ambiguous',
      candidateReferenceSenseIds: [decision.referenceSenseId],
      resolverVersion: GEMINI_RESOLVER_VERSION,
      confidence,
      modelId: GEMINI_CONTEXTUAL_MODEL_ID,
    };
  }

  if (decision.status === 'ambiguous' && Array.isArray(decision.candidateReferenceSenseIds)) {
    const candidates = [...new Set(decision.candidateReferenceSenseIds)]
      .filter((value): value is string => typeof value === 'string' && closedSenseIds.has(value))
      .slice(0, 4);
    return {
      status: candidates.length > 0 ? 'ambiguous' : 'unresolved',
      candidateReferenceSenseIds: candidates.length > 0 ? candidates : undefined,
      resolverVersion: GEMINI_RESOLVER_VERSION,
      confidence,
      modelId: GEMINI_CONTEXTUAL_MODEL_ID,
    };
  }

  return {
    status: 'unresolved',
    resolverVersion: GEMINI_RESOLVER_VERSION,
    confidence,
    modelId: GEMINI_CONTEXTUAL_MODEL_ID,
  };
}

async function resolveWithGemini(
  request: DictionaryLookupRequest,
  entry: ReferenceEntry,
  signal?: AbortSignal,
): Promise<ContextualSenseResolution> {
  if (!isValidContextualRequest(request)) {
    return {
      status: 'unresolved',
      resolverVersion: `${GEMINI_RESOLVER_VERSION}.invalid-request`,
    };
  }

  const apiKey = geminiApiKey();
  if (!apiKey) return fallbackResolution(entry);
  const closedSenseIds = new Set(entry.senses.map((sense) => sense.referenceSenseId));
  const candidates = entry.senses.map((sense) => ({
    referenceSenseId: sense.referenceSenseId,
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definitionL2 ?? sense.glossL1 ?? '',
    labels: sense.labels ?? [],
    examples: (sense.examples ?? []).slice(0, 2).map((example) => example.textL2),
  }));
  const prompt = [
    'You are a strict English word-sense disambiguator.',
    'Select only from the supplied referenceSenseId values. Never write or revise a definition.',
    'Use the exact clicked occurrence and the whole sentence. If one candidate is not clearly better, return ambiguous.',
    'Return JSON only, in exactly one of these shapes:',
    '{"status":"selected","referenceSenseId":"one supplied id","confidence":0.0}',
    '{"status":"ambiguous","candidateReferenceSenseIds":["supplied id"],"confidence":0.0}',
    '{"status":"unresolved","confidence":0.0}',
    `Sentence: ${JSON.stringify(request.textL2)}`,
    `Clicked occurrence: ${JSON.stringify(request.clickedSurface)}`,
    `Resolved dictionary headword: ${JSON.stringify(entry.headword)}`,
    `Character span: [${request.clickedStart}, ${request.clickedEnd})`,
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join('\n');

  try {
    const url = `${GEMINI_API_ORIGIN}/v1beta/models/${GEMINI_CONTEXTUAL_MODEL_ID}:generateContent`;
    const response = await fetchJson<GeminiResponsePayload>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: 'MINIMAL',
          },
        },
      }),
    }, signal, 12000);
    const rawText = response.data?.candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought !== true)
      ?.map((part) => part.text ?? '')
      .join('') ?? '';
    const decision = parseModelDecision(rawText);
    return decision ? validateModelDecision(decision, closedSenseIds) : fallbackResolution(entry);
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallbackResolution(entry);
  }
}

async function resolveContextualReference(
  request: DictionaryLookupRequest,
  result: ReferenceLookupResult,
  signal?: AbortSignal,
): Promise<ContextualSenseResolution> {
  return resolveWithGemini(request, result.entry, signal);
}

/**
 * The app's sole live Reference boundary. Contextual calls return the online
 * dictionary entry and the closed-set WSD decision as one result.
 */
export async function lookupReference(
  input: DictionaryLookupInput,
  options: LookupOptions = {},
): Promise<ReferenceLookupResult | null> {
  const lemmaResolution = resolveLookupLemma(input);
  if (!lemmaResolution.lemma) return null;
  const baseResult = await lookupBaseEntry(lemmaResolution.lemma, options.signal);
  if (!baseResult) return null;
  const result = attachSurfaceForm(baseResult, lemmaResolution.surface);
  if (typeof input === 'string') return result;

  const request = Object.freeze({ ...input });
  return {
    ...result,
    request,
    contextualResolution: await resolveContextualReference(
      request,
      result,
      options.signal,
    ),
  };
}
