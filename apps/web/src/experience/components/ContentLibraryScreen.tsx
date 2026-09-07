import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
import { useEffect, useMemo, useState } from 'react';
import {
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from '../contentProjection';
import type { PracticeSenseItem } from '../practiceData';
import { useContentProjection } from '../useContentProjection';

interface ContentLibraryScreenProps {
  active: boolean;
  section: ContentSectionId;
  onBack: () => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  onOpenExample: (item: SavedExampleItem) => void;
  onEditNote: (item: ContentNoteItem) => void;
}

const SenseRow = ({ item, onOpen }: { item: PracticeSenseItem; onOpen: () => void }) => (
  <button className={uiClass("content-list-item")} onClick={onOpen}>
    <span className={uiClass("content-word-mark")}>{item.word.slice(0, 1).toUpperCase()}</span>
    <span className={uiClass("content-list-copy")}>
      <span className={uiClass("content-list-title")}>
        {item.word}<em>{item.pos}</em>
      </span>
      <span className={uiClass("content-list-subtitle")}>{item.meaning}</span>
    </span>
    <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
  </button>
);

const EmptyState = ({ section }: { section: ContentSectionId }) => {
  const copy: Record<ContentSectionId, { icon: string; title: string; body: string }> = {
    recent: { icon: '◷', get title() { return uiText('noLearningHistoryYet'); }, get body() { return uiText('meaningsAppearHereAfterYouStudyThem'); } },
    learned: { icon: '✓', get title() { return uiText('noStudiedMeaningsYet'); }, get body() { return uiText('theMeaningsYouStudyWillAppearHere'); } },
    known: { icon: '◎', get title() { return uiText('noMeaningsMarkedAsKnown'); }, get body() { return uiText('onlyMeaningsYouExplicitlyMarkAsKnown'); } },
    'saved-senses': { icon: '☆', get title() { return uiText('noSavedMeaningsYet'); }, get body() { return uiText('saveAMeaningFromItsDetailsOr'); } },
    'saved-examples': { icon: '“', get title() { return uiText('noSavedExamplesYet'); }, get body() { return uiText('saveAnExampleYouWantToRevisit'); } },
    notes: { icon: '✎', get title() { return uiText('noNotesYet'); }, get body() { return uiText('writeANoteOnASpecificMeaning'); } },
  };
  const item = copy[section];
  return (
    <div className={uiClass("content-empty")}>
      <span className={uiClass("content-empty-icon")} aria-hidden="true">{item.icon}</span>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
    </div>
  );
};

export const ContentLibraryScreen = ({
  active,
  section,
  onBack,
  onOpenSense,
  onOpenExample,
  onEditNote,
}: ContentLibraryScreenProps) => {
  useTranslation();
  const projection = useContentProjection();
  const [query, setQuery] = useState('');
  const meta = { title: uiText(section), description: '' };

  useEffect(() => setQuery(''), [section]);

  const senseItems = section === 'recent'
    ? projection.recent
    : section === 'learned'
      ? projection.learned
      : section === 'known'
        ? projection.known
        : section === 'saved-senses'
          ? projection.savedSenses
          : [];
  const exampleItems = section === 'saved-examples' ? projection.savedExamples : [];
  const noteItems = section === 'notes' ? projection.notes : [];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSenses = useMemo(() => senseItems.filter((item) =>
    !normalizedQuery || `${item.word} ${item.pos} ${item.meaning}`.toLowerCase().includes(normalizedQuery)
  ), [senseItems, normalizedQuery]);
  const filteredExamples = useMemo(() => exampleItems.filter(({ sense }) =>
    !normalizedQuery || `${sense.word} ${sense.meaning} ${sense.example.text} ${sense.example.translation}`
      .toLowerCase().includes(normalizedQuery)
  ), [exampleItems, normalizedQuery]);
  const filteredNotes = useMemo(() => noteItems.filter((item) =>
    !normalizedQuery || `${item.word} ${item.body}`.toLowerCase().includes(normalizedQuery)
  ), [noteItems, normalizedQuery]);

  const total = senseItems.length + exampleItems.length + noteItems.length;
  const filteredTotal = filteredSenses.length + filteredExamples.length + filteredNotes.length;

  return (
    <section className={uiClass(`screen content-subscreen${active ? ' active' : ''}`, "#s-content-library")} id="s-content-library" data-anim="slide">
      <header className={uiClass("content-nav")}>
        <button className={uiClass("content-nav-back")} onClick={onBack} aria-label={uiText('backToMyContent4')}>
          <svg className={uiClass("icon")}><use href="#i-chev-l" /></svg>
        </button>
        <h1>{meta.title}</h1>
        <span className={uiClass("content-nav-count")}>{total}</span>
      </header>

      <div className={uiClass("content-page-body")}>
        <label className={uiClass("content-search")}>
          <svg className={uiClass("icon")}><use href="#i-search" /></svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText('searchMyContent')}
            aria-label={uiText('searchSection', { section: meta.title })}
          />
          {query && <button onClick={() => setQuery('')} aria-label={uiText('clearSearch')}>×</button>}
        </label>

        {filteredTotal === 0 ? (
          query ? (
            <div className={uiClass("content-empty content-empty-compact")}>
              <span className={uiClass("content-empty-icon")} aria-hidden="true">⌕</span>
              <h3>{uiText('noMatchingContent')}</h3>
              <p>{uiText('searchCoversYourContentOnly')}</p>
            </div>
          ) : <EmptyState section={section} />
        ) : (
          <div className={uiClass("content-list-card")}>
            {filteredSenses.map((item) => (
              <SenseRow key={item.senseId} item={item} onOpen={() => onOpenSense(item)} />
            ))}

            {filteredExamples.map((item) => (
              <button
                className={uiClass("content-list-item content-example-row")}
                key={item.exampleId}
                onClick={() => onOpenExample(item)}
              >
                <span className={uiClass("content-word-mark content-word-mark-example")}>“</span>
                <span className={uiClass("content-list-copy")}>
                  <span className={uiClass("content-list-title")}>
                    {item.sense.word}<em>{item.sense.pos}</em>
                  </span>
                  <span className={uiClass("content-example-copy")}>{item.sense.example.text}</span>
                  <span className={uiClass("content-list-subtitle")}>{item.sense.example.translation}</span>
                </span>
                <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
              </button>
            ))}

            {filteredNotes.map((item) => (
              <button
                className={uiClass("content-list-item content-note-row")}
                key={item.noteId}
                onClick={() => onEditNote(item)}
              >
                <span className={uiClass("content-word-mark content-word-mark-note")}>
                  <svg className={uiClass("icon")}><use href="#i-pen" /></svg>
                </span>
                <span className={uiClass("content-list-copy")}>
                  <span className={uiClass("content-list-title")}>
                    {item.word}{item.sense && !item.isLegacy && <em>{item.sense.pos}</em>}
                  </span>
                  <span className={uiClass("content-note-preview")}>{item.body}</span>
                  {item.isLegacy && (
                    <span className={uiClass("content-migration-label")}>
                      {item.candidateCount > 1
                        ? uiText('legacyChoices', { count: item.candidateCount })
                        : item.candidateCount === 1
                          ? uiText('legacyNoteReadyToLinkToThis')
                          : uiText('legacyNoteChooseASpecificMeaning')}
                    </span>
                  )}
                </span>
                <svg className={uiClass("chev")}><use href="#i-chev-r" /></svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
