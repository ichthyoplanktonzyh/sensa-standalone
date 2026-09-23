import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuickDictEntry } from '../types';
import i18n from '../../i18n';
import '../../i18n/learningResources';

export interface ActiveQuickDictionaryLookup {
  tokenIdx: number;
  entry: QuickDictEntry;
}

interface ImmediateDictionaryLookupRequest {
  tokenIdx: number;
  displayWord: string;
  load: (signal: AbortSignal) => Promise<QuickDictEntry | null>;
}

function pendingEntry(displayWord: string): QuickDictEntry {
  const word = displayWord.trim() || '—';
  return {
    id: `reference-loading:${word.toLocaleLowerCase()}`,
    word,
    phonetic: '',
    senses: [],
    hasFullDetail: false,
    isStarred: false,
    lookupState: 'loading',
    lookupMessage: i18n.t('quickDict.loading',{ns:'learning'}),
  };
}

function failedEntry(displayWord: string): QuickDictEntry {
  const word = displayWord.trim() || '—';
  return {
    id: `reference-error:${word.toLocaleLowerCase()}`,
    word,
    phonetic: '',
    senses: [],
    hasFullDetail: false,
    isStarred: false,
    lookupState: 'error',
    lookupMessage: i18n.t('quickDict.error',{ns:'learning'}),
  };
}

/**
 * Opens the dictionary surface synchronously, then replaces its content when
 * the asynchronous provider pipeline settles. Sequence ownership prevents an
 * older response from overwriting a newer click.
 */
export function useImmediateDictionaryLookup() {
  const [activeLookup, setActiveLookup] = useState<ActiveQuickDictionaryLookup | null>(null);
  const requestSequenceRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const clearLookup = useCallback(() => {
    requestSequenceRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setActiveLookup(null);
  }, []);

  const openLookup = useCallback((request: ImmediateDictionaryLookupRequest) => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setActiveLookup({
      tokenIdx: request.tokenIdx,
      entry: pendingEntry(request.displayWord),
    });

    void request.load(controller.signal)
      .then((entry) => {
        if (requestSequenceRef.current !== sequence || controller.signal.aborted) return;
        setActiveLookup({
          tokenIdx: request.tokenIdx,
          entry: entry ? { ...entry, lookupState: 'ready' } : failedEntry(request.displayWord),
        });
      })
      .catch(() => {
        if (requestSequenceRef.current !== sequence || controller.signal.aborted) return;
        setActiveLookup({
          tokenIdx: request.tokenIdx,
          entry: failedEntry(request.displayWord),
        });
      });
  }, []);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    requestAbortRef.current?.abort();
  }, []);

  return { activeLookup, openLookup, clearLookup };
}
