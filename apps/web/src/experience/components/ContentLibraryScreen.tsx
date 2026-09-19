import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { useMemo } from 'react';
import {
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from '../contentProjection';
import type { PracticeSenseItem } from '../practiceData';
import { useContentProjection } from '../useContentProjection';
import { SensaCollectionBrowserLayout } from '../ui/SensaPageLayouts';
import { useScreenState } from '../ui/ScreenHost';

interface ContentLibraryScreenProps {
  active: boolean;
  section: ContentSectionId;
  onBack: () => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  onOpenExample: (item: SavedExampleItem) => void;
  onEditNote: (item: ContentNoteItem) => void;
}

const rowClass =
  "flex min-h-20 w-full items-center gap-3 border-0 bg-transparent p-5 text-left text-fg-primary transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus motion-reduce:transition-none [&+button]:border-t [&+button]:border-border-subtle";
const markClass =
  "grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-lg font-bold text-action-primary";
const copyClass = "flex min-w-0 flex-1 flex-col gap-1";
const titleClass =
  "flex items-center gap-2 text-body font-semibold [&_em]:rounded-control [&_em]:border [&_em]:border-border-subtle [&_em]:px-1.5 [&_em]:py-0.5 [&_em]:text-metadata [&_em]:font-medium [&_em]:not-italic [&_em]:text-fg-secondary";
const subtitleClass = "overflow-hidden text-ellipsis whitespace-nowrap text-body-support text-fg-secondary";

const SenseRow = ({ item, onOpen }: { item: PracticeSenseItem; onOpen: () => void }) => (
  <button className={rowClass} onClick={onOpen}>
    <span className={markClass}>{item.word.slice(0, 1).toUpperCase()}</span>
    <span className={copyClass}>
      <span className={titleClass}>
        {item.word}<em>{item.pos}</em>
      </span>
      <span className={subtitleClass}>{item.meaning}</span>
    </span>
    <svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
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
    <div className="flex min-h-72 flex-col items-center justify-center p-9 text-center text-fg-secondary">
      <span className="mb-4 grid size-15 place-items-center rounded-card bg-accent-soft text-2xl text-action-primary" aria-hidden="true">{item.icon}</span>
      <h3 className="mb-2 text-section-title font-medium text-fg-primary">{item.title}</h3>
      <p className="max-w-60 text-body-support">{item.body}</p>
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
  const [query, setQuery] = useScreenState(`content-library:${section}:query`, '');
  const meta = { title: uiText(section), description: '' };

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
    <SensaCollectionBrowserLayout
      className={`sensa-motion-screen sensa-motion-screen-slide z-[27] ${active ? 'visible pointer-events-auto translate-x-0' : 'invisible pointer-events-none translate-x-full'}`}
      id="s-content-library"
      data-anim="slide"
      aria-hidden={!active}
      headerStyle="bar"
      measure="narrow"
      regions={{
        header: <div className="grid min-h-20 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3 py-4">
        <button className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={onBack} aria-label={uiText('backToMyContent4')}>
          <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1 className="text-center text-section-title font-medium">{meta.title}</h1>
        <span className="grid min-w-9 place-items-center justify-self-end rounded-pill bg-accent-soft px-2 py-1 text-metadata font-semibold text-fg-secondary">{total}</span>
      </div>,
        controls: <label className="flex min-h-12 items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-3 focus-within:border-border-strong">
          <svg className="size-5 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-search" /></svg>
          <input
            className="min-w-0 flex-1 bg-transparent text-body-support text-fg-primary outline-none placeholder:text-fg-tertiary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText('searchMyContent')}
            aria-label={uiText('searchSection', { section: meta.title })}
          />
          {query && <button type="button" className="grid size-9 place-items-center rounded-control text-fg-secondary hover:bg-surface-subtle" onClick={() => setQuery('')} aria-label={uiText('clearSearch')}>×</button>}
        </label>,
        collection: filteredTotal === 0 ? (
          query ? (
            <div className="flex min-h-60 flex-col items-center justify-center p-9 text-center text-fg-secondary">
              <span className="mb-4 grid size-15 place-items-center rounded-card bg-accent-soft text-2xl text-action-primary" aria-hidden="true">⌕</span>
              <h3 className="mb-2 text-section-title font-medium text-fg-primary">{uiText('noMatchingContent')}</h3>
              <p className="max-w-60 text-body-support">{uiText('searchCoversYourContentOnly')}</p>
            </div>
          ) : <EmptyState section={section} />
        ) : (
          <div className="overflow-hidden border-y border-border-subtle">
            {filteredSenses.map((item) => (
              <SenseRow key={item.senseId} item={item} onOpen={() => onOpenSense(item)} />
            ))}

            {filteredExamples.map((item) => (
              <button
                className={rowClass}
                key={item.exampleId}
                onClick={() => onOpenExample(item)}
              >
                <span className={`${markClass} font-language text-3xl`}>“</span>
                <span className={copyClass}>
                  <span className={titleClass}>
                    {item.sense.word}<em>{item.sense.pos}</em>
                  </span>
                  <span className="line-clamp-2 text-body-support font-semibold text-fg-primary">{item.sense.example.text}</span>
                  <span className={subtitleClass}>{item.sense.example.translation}</span>
                </span>
                <svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
              </button>
            ))}

            {filteredNotes.map((item) => (
              <button
                className={rowClass}
                key={item.noteId}
                onClick={() => onEditNote(item)}
              >
                <span className={markClass}>
                  <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-pen" /></svg>
                </span>
                <span className={copyClass}>
                  <span className={titleClass}>
                    {item.word}{item.sense && !item.isLegacy && <em>{item.sense.pos}</em>}
                  </span>
                  <span className="line-clamp-2 text-body-support text-fg-secondary">{item.body}</span>
                  {item.isLegacy && (
                    <span className="w-max max-w-full rounded-control bg-accent-soft px-2 py-1 text-metadata text-feedback-warning">
                      {item.candidateCount > 1
                        ? uiText('legacyChoices', { count: item.candidateCount })
                        : item.candidateCount === 1
                          ? uiText('legacyNoteReadyToLinkToThis')
                          : uiText('legacyNoteChooseASpecificMeaning')}
                    </span>
                  )}
                </span>
                <svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
              </button>
            ))}
          </div>
        ),
      }}
    />
  );
};
