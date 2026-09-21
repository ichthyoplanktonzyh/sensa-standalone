import '../../i18n/referenceResources';
import {useTranslation} from 'react-i18next';
import {cardText} from '../../i18n/originalCards';
import i18n from '../../i18n';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import { iconClass, slideScreenClass } from '../ui/primitives';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { QuickDictEntry, Word } from '../types';
import { audioService } from '../services/audioService';
import {
  referenceSensesForDisplay,
  type ReferenceLookupResult,
  type ReferencePronunciation,
  type ReferenceSense,
} from '../reference/referenceDictionary';
import { lookupReference } from '../reference/referenceLookup';
import type { ReferenceExampleDeck } from './ReferenceExampleViewer';

interface ReferenceDictionaryScreenProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string | null;
  onClose: () => void;
  onOpenExamples: (deck: ReferenceExampleDeck) => void;
}

function contextualResultFromWordData(
  wordData: ReferenceDictionaryScreenProps['wordData'],
): ReferenceLookupResult | null {
  if (!wordData || typeof wordData === 'string' || !('referenceLookup' in wordData)) return null;
  return wordData.referenceLookup ?? null;
}

function queryFromWordData(wordData: ReferenceDictionaryScreenProps['wordData']): string {
  const contextualResult = contextualResultFromWordData(wordData);
  if (contextualResult?.request?.clickedSurface) return contextualResult.request.clickedSurface;
  if (!wordData) return '';
  if (typeof wordData === 'string') return wordData;
  return 'w' in wordData ? wordData.w : wordData.word;
}

function selectedSenseId(result: ReferenceLookupResult | null): string | undefined {
  const resolution = result?.contextualResolution;
  if (!resolution) return undefined;
  if (
    resolution.status !== 'authored_target'
    && resolution.status !== 'reviewed'
    && resolution.status !== 'model_confident'
  ) return undefined;
  return result?.entry.senses.some(
    (sense) => sense.referenceSenseId === resolution.referenceSenseId,
  )
    ? resolution.referenceSenseId
    : undefined;
}

/** English keeps its two named variants. Every other accent id is the language
 * the provider's evidence actually belongs to, so it is shown as that language's
 * name instead of being relabelled as an English variant. */
function accentLabel(accent: ReferencePronunciation['accent']): string {
  if (accent === 'en-GB') return cardText('british');
  if (accent === 'en-US') return cardText('american');
  return interfaceLanguageDisplayName(accent, resolveInterfaceLocale(i18n.language));
}

function partOfSpeechGroups(senses: readonly ReferenceSense[]): Array<{
  partOfSpeech: string;
  senses: ReferenceSense[];
}> {
  const groups = new Map<string, ReferenceSense[]>();
  for (const sense of senses) {
    const group = groups.get(sense.partOfSpeech) ?? [];
    group.push(sense);
    groups.set(sense.partOfSpeech, group);
  }
  return [...groups].map(([partOfSpeech, group]) => ({ partOfSpeech, senses: group }));
}

function SenseRow({
  sense,
  isContextual,
  targetLanguage,
  learnerLanguage,
  onOpenExamples,
}: {
  sense: ReferenceSense;
  isContextual: boolean;
  targetLanguage: string;
  learnerLanguage: string;
  onOpenExamples: (sense: ReferenceSense) => void;
}) {
  const examples = sense.examples ?? [];
  return (
    <article className={`grid gap-4 rounded-card border p-5 sm:grid-cols-[1fr_auto] ${isContextual ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel'}`}>
      <div className="min-w-0">
        {isContextual && <span className="mb-3 inline-flex rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-action-primary">{cardText('dictCurrent')}</span>}
        <p className="text-body leading-7" lang={sense.glossL1 ? learnerLanguage : targetLanguage}>
          {sense.glossL1 ?? sense.definitionL2 ?? cardText('dictDefinitionMissing')}
        </p>
        {sense.glossL1 && sense.definitionL2 && <small className="mt-2 block text-body-support leading-6 text-fg-secondary" lang={targetLanguage}>{sense.definitionL2}</small>}
        {sense.labels && sense.labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sense.labels.map((label) => <span className="rounded-pill bg-surface-subtle px-2 py-1 text-metadata text-fg-secondary" key={label}>{label}</span>)}
          </div>
        )}
      </div>
      {examples.length > 0 && (
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 self-center rounded-control border border-border-subtle bg-transparent px-3 text-control-label font-semibold text-action-primary hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus"
          onClick={() => onOpenExamples(sense)}
        >
          <span>{cardText('dictExamples',{count:examples.length})}</span>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      )}
    </article>
  );
}

export function ReferenceDictionaryScreen({
  active,
  wordData,
  onClose,
  onOpenExamples,
}: ReferenceDictionaryScreenProps) {
  useTranslation();
  const initialQuery = queryFromWordData(wordData);
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<ReferenceLookupResult | null>(
    () => contextualResultFromWordData(wordData),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [lookupError, setLookupError] = useState<'dictInput'|'dictMissing'|'dictUnavailable'|null>(null);
  const [playingPronunciationId, setPlayingPronunciationId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lookupSequenceRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);

  const performLookup = useCallback(async (rawQuery: string) => {
    const normalizedQuery = rawQuery.trim();
    lookupAbortRef.current?.abort();
    const sequence = lookupSequenceRef.current + 1;
    lookupSequenceRef.current = sequence;
    if (!normalizedQuery) {
      setResult(null);
      setLookupError('dictInput');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setResult(null);
    setIsLoading(true);
    setLookupError(null);
    try {
      // Manual searches have no sentence occurrence, so they do not run WSD.
      const nextResult = await lookupReference(normalizedQuery, { signal: controller.signal });
      if (lookupSequenceRef.current !== sequence || controller.signal.aborted) return;
      setResult(nextResult);
      setLookupError(nextResult ? null : 'dictMissing');
    } catch {
      if (lookupSequenceRef.current !== sequence || controller.signal.aborted) return;
      setResult(null);
      setLookupError('dictUnavailable');
    } finally {
      if (lookupSequenceRef.current === sequence && !controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      lookupAbortRef.current?.abort();
      audioService.stop();
      return;
    }
    const nextQuery = queryFromWordData(wordData);
    const contextualResult = contextualResultFromWordData(wordData);
    setQuery(nextQuery);
    setPlayingPronunciationId(null);
    if (contextualResult) {
      lookupAbortRef.current?.abort();
      lookupSequenceRef.current += 1;
      setResult(contextualResult);
      setLookupError(null);
      setIsLoading(false);
      return;
    }
    void performLookup(nextQuery);
  }, [active, performLookup, wordData]);

  useEffect(() => () => {
    lookupAbortRef.current?.abort();
    audioService.stop();
  }, []);

  const entry = result?.entry ?? null;
  const contextualSenseId = selectedSenseId(result);
  const displaySenses = result ? referenceSensesForDisplay(result) : [];
  const contextualSense = contextualSenseId
    ? displaySenses.find((sense) => sense.referenceSenseId === contextualSenseId) ?? null
    : null;
  const remainingSenses = contextualSense
    ? displaySenses.filter((sense) => sense.referenceSenseId !== contextualSense.referenceSenseId)
    : displaySenses;
  const senseGroups = useMemo(() => partOfSpeechGroups(remainingSenses), [remainingSenses]);
  const clickedSurface = result?.request?.clickedSurface;
  const targetLanguage = result?.release.targetLanguage ?? 'und';
  const learnerLanguage = result?.release.learnerLocale ?? 'und';
  const caseLocale = result?.release.targetLanguage ?? 'und';
  const showLemmaRelation = Boolean(
    clickedSurface
    && entry
    && clickedSurface.toLocaleLowerCase(caseLocale) !== entry.headword.toLocaleLowerCase(caseLocale),
  );

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    setQuery(normalizedQuery);
    searchInputRef.current?.blur();
    void performLookup(normalizedQuery);
  };

  const handleSpeak = (pronunciation: ReferencePronunciation) => {
    if (!pronunciation.audioUrl) return;
    setPlayingPronunciationId(pronunciation.pronunciationId);
    const accent = pronunciation.accent === 'en-GB' ? 'uk' : 'us';
    const playback = audioService.playAudioUrl(
      pronunciation.audioUrl,
      entry?.headword ?? query,
      accent,
    );
    void playback.finally(() => setPlayingPronunciationId(null));
  };

  const openExamples = (sense: ReferenceSense) => {
    if (!entry || !result || !(sense.examples?.length)) return;
    onOpenExamples({
      headword: entry.headword,
      forms: entry.forms ?? [entry.headword],
      sense,
      release: result.release,
    });
  };

  return (
    <section
      className={`${slideScreenClass(active, 'z-[90]')} flex flex-col overflow-hidden`}
      id="s-reference-dictionary"
      data-screen-layer="1"
      data-anim="slide"
      aria-hidden={!active}
      inert={!active}
    >
      <header className="grid min-h-20 shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3 border-b border-border-subtle bg-surface-canvas/95 px-6 py-4">
        <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onClose} aria-label={cardText('dictBack')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1 className="text-center text-section-title font-semibold">{cardText('dictionary')}</h1>
        <i aria-hidden="true" />
      </header>

      <form className="mx-auto mt-5 flex min-h-12 w-[calc(100%-3rem)] max-w-4xl shrink-0 items-center gap-3 rounded-control border border-border-strong bg-surface-panel px-4 focus-within:outline-2 focus-within:outline-focus sm:w-[calc(100%-5rem)]" onSubmit={handleSearchSubmit} role="search">
        <svg className={`${iconClass} text-fg-tertiary`} aria-hidden="true"><use href="#i-search" /></svg>
        <input
          className="min-w-0 flex-1 bg-transparent text-body text-fg-primary outline-none placeholder:text-fg-tertiary"
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={cardText('dictSearch')}
          aria-label={cardText('dictSearch')}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="min-h-10 rounded-control border-0 bg-action-primary px-4 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover" type="submit">{cardText('dictSubmit')}</button>
      </form>

      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-y-auto px-6 py-7 [scrollbar-width:thin] sm:px-10">
        {isLoading ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
            <i className="mb-4 size-4 animate-pulse rounded-full bg-progress motion-reduce:animate-none" aria-hidden="true" />
            <strong className="text-body text-fg-secondary">{cardText('dictLoading')}</strong>
          </div>
        ) : !entry ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
            <strong className="text-body text-feedback-danger">{cardText(lookupError ?? 'dictMissing')}</strong>
            <p className="mt-2 text-body-support text-fg-secondary">{cardText('dictRetry')}</p>
          </div>
        ) : (
          <>
            <section className="border-b border-border-subtle pb-7" aria-label={cardText('dictIdentity')}>
              <h2 className="font-language text-5xl font-semibold" lang={targetLanguage}>{entry.headword}</h2>
              {showLemmaRelation && (
                <p className="mt-4 flex items-center gap-2 text-body-support text-fg-secondary">
                  <span lang={targetLanguage}>{clickedSurface}</span>
                  <svg className={iconClass} aria-hidden="true"><use href="#i-chev-r" /></svg>
                  <strong lang={targetLanguage}>{entry.headword}</strong>
                </p>
              )}
              {entry.pronunciations.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {entry.pronunciations.map((pronunciation) => (
                    pronunciation.audioUrl ? (
                      <button
                        type="button"
                        key={pronunciation.pronunciationId}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-control border-0 px-4 text-control-label font-semibold focus-visible:outline-2 focus-visible:outline-focus ${playingPronunciationId === pronunciation.pronunciationId ? 'bg-action-primary text-action-on-primary' : 'bg-accent-soft text-action-primary hover:bg-surface-selected'}`}
                        onClick={() => handleSpeak(pronunciation)}
                      >
                        <span>{accentLabel(pronunciation.accent)}</span>
                        <svg className={iconClass} aria-hidden="true"><use href="#i-vol-fill" /></svg>
                        {pronunciation.ipa && <i className="font-language not-italic" lang={targetLanguage}>{pronunciation.ipa}</i>}
                      </button>
                    ) : (
                      <div className="inline-flex min-h-11 items-center gap-2 rounded-control bg-surface-subtle px-4 text-body-support text-fg-secondary" key={pronunciation.pronunciationId}>
                        <span>{accentLabel(pronunciation.accent)}</span>
                        {pronunciation.ipa && <i className="font-language not-italic" lang={targetLanguage}>{pronunciation.ipa}</i>}
                      </div>
                    )
                  ))}
                </div>
              )}
            </section>

            {contextualSense && (
              <section className="mt-8">
                <h2 className="text-section-title font-semibold">{cardText('dictCurrent')}</h2>
                <div className="mb-3 mt-5 flex items-center justify-between text-metadata font-bold uppercase tracking-wide text-fg-tertiary">
                  <span>{contextualSense.partOfSpeech}</span>
                </div>
                <SenseRow sense={contextualSense} isContextual targetLanguage={targetLanguage} learnerLanguage={learnerLanguage} onOpenExamples={openExamples} />
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-section-title font-semibold">{contextualSense ? cardText('dictOther') : cardText('dictAll')}</h2>
              <div className="mt-5 space-y-7">
                {senseGroups.map((group) => (
                  <section key={group.partOfSpeech} className="space-y-3">
                    <div className="flex items-center justify-between text-metadata font-bold uppercase tracking-wide text-fg-tertiary">
                      <span>{group.partOfSpeech}</span>
                      <small>{cardText('dictSenses',{count:group.senses.length})}</small>
                    </div>
                    {group.senses.map((sense) => (
                      <SenseRow
                        key={sense.referenceSenseId}
                        sense={sense}
                        isContextual={false}
                        targetLanguage={targetLanguage}
                        learnerLanguage={learnerLanguage}
                        onOpenExamples={openExamples}
                      />
                    ))}
                  </section>
                ))}
              </div>
            </section>

            {entry.forms && entry.forms.length > 1 && (
              <section className="mt-8 border-t border-border-subtle pt-7">
                <h2 className="text-section-title font-semibold">{cardText('dictForms')}</h2>
                <div className="mt-4 flex flex-wrap gap-2">{entry.forms.map((form) => <span className="rounded-pill bg-accent-soft px-3 py-1 text-body-support text-fg-secondary" lang={targetLanguage} key={form}>{form}</span>)}</div>
              </section>
            )}

            {((entry.usageNotes?.length ?? 0) > 0
              || (entry.morphology?.length ?? 0) > 0
              || (entry.etymology?.length ?? 0) > 0) && (
              <section className="mt-8 border-t border-border-subtle pt-7">
                <h2 className="text-section-title font-semibold">{cardText('dictAdditional')}</h2>
                {[...(entry.usageNotes ?? []), ...(entry.morphology ?? []), ...(entry.etymology ?? [])]
                  .map((note) => (
                    <details className="mt-3 rounded-control border border-border-subtle bg-surface-panel px-4" key={note.noteId}>
                      <summary className="flex min-h-12 cursor-pointer items-center font-semibold">{note.title}</summary>
                      <p className="pb-3 text-body-support leading-6 text-fg-secondary" lang={learnerLanguage}>{note.bodyL1}</p>
                      <small className="block pb-4 text-metadata text-fg-tertiary">{note.sourceLabel}</small>
                    </details>
                  ))}
              </section>
            )}

            <footer className="mt-10 border-t border-border-subtle pt-6 text-metadata leading-5 text-fg-tertiary">
              <strong className="text-fg-secondary">{result?.release.provider}</strong>
              <p className="mt-2">{entry.attribution}</p>
              <small className="mt-1 block">{result?.release.rightsLabel}</small>
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
