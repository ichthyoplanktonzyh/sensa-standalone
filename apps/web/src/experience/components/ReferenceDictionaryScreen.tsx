import {useTranslation} from 'react-i18next';
import {cardText} from '../../i18n/originalCards';
import { uiClass } from '../ui/classes';
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

function accentLabel(accent: ReferencePronunciation['accent']): string {
  return accent === 'en-GB' ? cardText('british') : cardText('american');
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
  onOpenExamples,
}: {
  sense: ReferenceSense;
  isContextual: boolean;
  onOpenExamples: (sense: ReferenceSense) => void;
}) {
  const examples = sense.examples ?? [];
  return (
    <article className={uiClass(`reference-dictionary-sense${isContextual ? ' is-contextual' : ''}`)}>
      <div className={uiClass("reference-dictionary-sense-copy")}>
        {isContextual && <span className={uiClass("reference-dictionary-current-label")}>{cardText('dictCurrent')}</span>}
        <p lang={sense.glossL1 ? undefined : 'en'}>
          {sense.glossL1 ?? sense.definitionL2 ?? cardText('dictDefinitionMissing')}
        </p>
        {sense.glossL1 && sense.definitionL2 && <small lang="en">{sense.definitionL2}</small>}
        {sense.labels && sense.labels.length > 0 && (
          <div className={uiClass("reference-dictionary-labels")}>
            {sense.labels.map((label) => <span key={label}>{label}</span>)}
          </div>
        )}
      </div>
      {examples.length > 0 && (
        <button
          type="button"
          className={uiClass("reference-dictionary-examples-button")}
          onClick={() => onOpenExamples(sense)}
        >
          <span>{cardText('dictExamples',{count:examples.length})}</span>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
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
  const showLemmaRelation = Boolean(
    clickedSurface
    && entry
    && clickedSurface.toLocaleLowerCase('en-US') !== entry.headword.toLocaleLowerCase('en-US'),
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
    if (!entry || !(sense.examples?.length)) return;
    onOpenExamples({
      headword: entry.headword,
      forms: entry.forms ?? [entry.headword],
      sense,
    });
  };

  return (
    <section
      className={uiClass(`screen reference-dictionary-screen${active ? ' active' : ''}`, "#s-reference-dictionary")}
      id="s-reference-dictionary"
      data-screen-layer="1"
      data-anim="slide"
      aria-hidden={!active}
    >
      <header className={uiClass("reference-dictionary-header")}>
        <button type="button" onClick={onClose} aria-label={cardText('dictBack')}>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{cardText('dictionary')}</h1>
        <i aria-hidden="true" />
      </header>

      <form className={uiClass("reference-dictionary-search")} onSubmit={handleSearchSubmit} role="search">
        <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-search" /></svg>
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={cardText('dictSearch')}
          aria-label={cardText('dictSearch')}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">{cardText('dictSubmit')}</button>
      </form>

      <div className={uiClass("reference-dictionary-scroll")}>
        {isLoading ? (
          <div className={uiClass("reference-dictionary-state")} role="status">
            <i aria-hidden="true" />
            <strong>{cardText('dictLoading')}</strong>
          </div>
        ) : !entry ? (
          <div className={uiClass("reference-dictionary-state")} role="status">
            <strong>{cardText(lookupError ?? 'dictMissing')}</strong>
            <p>{cardText('dictRetry')}</p>
          </div>
        ) : (
          <>
            <section className={uiClass("reference-dictionary-identity")} aria-label={cardText('dictIdentity')}>
              <h2>{entry.headword}</h2>
              {showLemmaRelation && (
                <p className={uiClass("reference-dictionary-lemma-relation")}>
                  <span>{clickedSurface}</span>
                  <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-r" /></svg>
                  <strong>{entry.headword}</strong>
                </p>
              )}
              {entry.pronunciations.length > 0 && (
                <div className={uiClass("reference-dictionary-pronunciations")}>
                  {entry.pronunciations.map((pronunciation) => (
                    pronunciation.audioUrl ? (
                      <button
                        type="button"
                        key={pronunciation.pronunciationId}
                        className={uiClass(playingPronunciationId === pronunciation.pronunciationId ? 'is-playing' : '')}
                        onClick={() => handleSpeak(pronunciation)}
                      >
                        <span>{accentLabel(pronunciation.accent)}</span>
                        <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-vol-fill" /></svg>
                        {pronunciation.ipa && <i>{pronunciation.ipa}</i>}
                      </button>
                    ) : (
                      <div key={pronunciation.pronunciationId}>
                        <span>{accentLabel(pronunciation.accent)}</span>
                        {pronunciation.ipa && <i>{pronunciation.ipa}</i>}
                      </div>
                    )
                  ))}
                </div>
              )}
            </section>

            {contextualSense && (
              <section className={uiClass("reference-dictionary-section is-current")}>
                <h2>{cardText('dictCurrent')}</h2>
                <div className={uiClass("reference-dictionary-pos-heading")}>
                  <span>{contextualSense.partOfSpeech}</span>
                </div>
                <SenseRow sense={contextualSense} isContextual onOpenExamples={openExamples} />
              </section>
            )}

            <section className={uiClass("reference-dictionary-section")}>
              <h2>{contextualSense ? cardText('dictOther') : cardText('dictAll')}</h2>
              <div className={uiClass("reference-dictionary-groups")}>
                {senseGroups.map((group) => (
                  <section key={group.partOfSpeech} className={uiClass("reference-dictionary-group")}>
                    <div className={uiClass("reference-dictionary-pos-heading")}>
                      <span>{group.partOfSpeech}</span>
                      <small>{cardText('dictSenses',{count:group.senses.length})}</small>
                    </div>
                    {group.senses.map((sense) => (
                      <SenseRow
                        key={sense.referenceSenseId}
                        sense={sense}
                        isContextual={false}
                        onOpenExamples={openExamples}
                      />
                    ))}
                  </section>
                ))}
              </div>
            </section>

            {entry.forms && entry.forms.length > 1 && (
              <section className={uiClass("reference-dictionary-section reference-dictionary-forms")}>
                <h2>{cardText('dictForms')}</h2>
                <div>{entry.forms.map((form) => <span key={form}>{form}</span>)}</div>
              </section>
            )}

            {((entry.usageNotes?.length ?? 0) > 0
              || (entry.morphology?.length ?? 0) > 0
              || (entry.etymology?.length ?? 0) > 0) && (
              <section className={uiClass("reference-dictionary-section reference-dictionary-notes")}>
                <h2>{cardText('dictAdditional')}</h2>
                {[...(entry.usageNotes ?? []), ...(entry.morphology ?? []), ...(entry.etymology ?? [])]
                  .map((note) => (
                    <details key={note.noteId}>
                      <summary>{note.title}</summary>
                      <p>{note.bodyL1}</p>
                      <small>{note.sourceLabel}</small>
                    </details>
                  ))}
              </section>
            )}

            <footer className={uiClass("reference-dictionary-source")}>
              <strong>{result?.release.provider}</strong>
              <p>{entry.attribution}</p>
              <small>{result?.release.rightsLabel}</small>
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
