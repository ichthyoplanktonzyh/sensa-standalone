import type {
  DictionaryLookupInput,
  DictionaryLookupOptions,
  QuickDictEntry,
} from '../types';
import {
  projectReferenceEntryToQuick,
  type ReferenceLookupResult,
} from '../reference/referenceDictionary';
import { lookupReference } from '../reference/referenceLookup';

/**
 * One provider-neutral lookup result. Reference provenance stays attached to
 * the exact quick entry projected from it.
 */
export interface DictionaryLookupResponse {
  input: DictionaryLookupInput;
  referenceResult: ReferenceLookupResult | null;
  entry: QuickDictEntry | null;
}

/**
 * Authoritative lookup boundary used by formal learning and practice. It does
 * not manufacture a dictionary entry from UI fixtures or package content.
 */
export async function lookupDictionary(
  input: DictionaryLookupInput,
  options: DictionaryLookupOptions = {},
): Promise<DictionaryLookupResponse> {
  const referenceResult = await lookupReference(input, { signal: options.signal });

  return {
    input,
    referenceResult,
    entry: referenceResult ? projectReferenceEntryToQuick(referenceResult) : null,
  };
}

export async function lookupDictionaryEntry(
  input: DictionaryLookupInput,
  options: DictionaryLookupOptions = {},
): Promise<QuickDictEntry | null> {
  return (await lookupDictionary(input, options)).entry;
}
