import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { useEffect, useMemo, useState } from 'react';
import { contentAnnotations } from '../../data/library/contentAnnotations';
import { semanticStatusLabel, type SemanticStatus } from '../contentProjection';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../practiceData';
import { audioService } from '../services/audioService';
import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
import { useContentProjection } from '../useContentProjection';

interface ContentSenseDetailScreenProps {
  active: boolean;
  item: PracticeSenseItem | null;
  onBack: () => void;
  onOpenExample: (item: PracticeSenseItem) => void;
  onOpenSense: (item: PracticeSenseItem) => void;
  onOpenDictionary: (item: PracticeSenseItem) => void;
  onEditNote: (item: PracticeSenseItem) => void;
  toast: (message: string) => void;
}

export const ContentSenseDetailScreen = ({
  active,
  item,
  onBack,
  onOpenExample,
  onOpenSense,
  onOpenDictionary,
  onEditNote,
  toast,
}: ContentSenseDetailScreenProps) => {
  useTranslation();
  const projection = useContentProjection();
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!item) return;
    const refresh = () => {
      setSaved(contentAnnotations.isSenseSaved(item.senseId));
      setNote(contentAnnotations.getSenseNote(item.senseId));
    };
    refresh();
    return contentAnnotations.subscribe(refresh);
  }, [item]);

  const siblings = useMemo(() => item
    ? PRACTICE_SENSES.filter((candidate) => candidate.wordId === item.wordId && candidate.senseId !== item.senseId)
    : [], [item]);
  const semanticState = item
    ? projection.semanticSenses.find((entry) => entry.senseId === item.senseId)?.status
    : undefined;

  if (!item) return null;

  const toggleSaved = async () => {
    try {
      const next = await contentAnnotations.toggleSense(item.senseId);
      setSaved(next);
      toast(next ? uiText('meaningSaved') : uiText('meaningRemovedFromSaved'));
    } catch {
      toast(uiText('saveFailed'));
    }
  };

  return (
    <section className={slideScreenClass(active)} id="s-content-sense" data-anim="slide" aria-hidden={!active}>
      <header className={contentNavigationClass}>
        <button className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <span className="text-center text-section-title font-medium">{uiText('meaning3')}</span>
        <button className={`grid size-11 place-items-center justify-self-end rounded-control border-0 focus-visible:outline-2 focus-visible:outline-focus ${saved ? 'bg-accent-soft text-action-primary' : 'bg-transparent text-fg-secondary hover:bg-surface-subtle'}`} onClick={() => void toggleSaved()} aria-pressed={saved} aria-label={saved ? uiText('unsaveThisMeaning') : uiText('saveThisMeaning')}>
          <svg className={`${iconClass} ${saved ? 'fill-current' : ''}`} aria-hidden="true"><use href="#i-star" /></svg>
        </button>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 py-8 pb-12 sm:px-10">
        <section className="border-b border-border-subtle pb-8 pt-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-language text-5xl font-medium">{item.word}</h1>
            <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">{item.pos}</span>
          </div>
          <div className="mt-4 flex items-center gap-3 text-body-support text-fg-secondary">
            <button className="inline-flex min-h-11 items-center gap-2 rounded-control bg-accent-soft px-3 text-control-label font-semibold text-action-primary focus-visible:outline-2 focus-visible:outline-focus" onClick={() => void audioService.playWord(item.word, 'us')} aria-label={uiText('playUsPronunciation')}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-vol" /></svg>{uiText('us')}</button>
            <span className="font-language">{item.phonetic}</span>
          </div>
          <p className="mt-5 text-xl leading-8 text-fg-secondary">{item.meaning}</p>
          {semanticState && (
            <span className="mt-4 inline-flex rounded-pill bg-surface-selected px-3 py-1 text-metadata font-semibold text-fg-secondary">
              {semanticStatusLabel[semanticState as SemanticStatus]}
            </span>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-4">
            <span className="text-section-title font-semibold">{uiText('learningExample')}</span>
            <button className="min-h-11 rounded-control px-3 text-control-label font-semibold text-action-primary hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onOpenExample(item)}>{uiText('viewDetails')}</button>
          </div>
          <div className="grid grid-cols-[1fr_3.5rem] overflow-hidden rounded-card border border-border-subtle bg-surface-panel">
            <button className="min-w-0 border-0 bg-transparent p-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onOpenExample(item)}>
              <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{item.example.sourceLabel}</span>
              <strong className="mt-3 block font-language text-lg leading-7">{item.example.text}</strong>
              {item.example.translation && <small className="mt-2 block text-body-support leading-6 text-fg-secondary">{item.example.translation}</small>}
            </button>
            <button className="grid min-h-14 place-items-center border-0 border-l border-border-subtle bg-transparent text-action-primary hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus" onClick={() => {
              void audioService.playSentence(item.example.text, 'us');
            }} aria-label={uiText('playLearningExample')}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-vol" /></svg>
            </button>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 text-section-title font-semibold"><span>{uiText('myAnnotations')}</span></div>
          <button className="grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-card border border-border-subtle bg-surface-panel p-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onEditNote(item)}>
            <span className="grid size-11 place-items-center rounded-control bg-accent-soft text-action-primary"><svg className={iconClass} aria-hidden="true"><use href="#i-pen" /></svg></span>
            <span className="flex min-w-0 flex-col gap-1">
              <b className="text-body">{note ? uiText('myNotes') : uiText('writeANoteOnThisMeaning')}</b>
              <small className="line-clamp-2 text-body-support text-fg-secondary">{note || uiText('addYourUnderstandingAssociationsOrReminders')}</small>
            </span>
            <svg className="size-4 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </section>

        {siblings.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between text-section-title font-semibold"><span>{uiText('otherMeaningsOfThisWord')}</span><em className="rounded-pill bg-accent-soft px-3 py-1 text-metadata not-italic text-fg-secondary">{siblings.length}</em></div>
            <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel">
              {siblings.map((sibling) => (
                <button className="flex min-h-14 w-full items-center justify-between gap-4 border-0 bg-transparent p-4 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus [&+button]:border-t [&+button]:border-border-subtle" key={sibling.senseId} onClick={() => onOpenSense(sibling)}>
                  <span className="text-body-support"><em className="mr-2 text-metadata not-italic text-fg-tertiary">{sibling.pos}</em>{sibling.meaning}</span>
                  <svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button className="grid min-h-16 grid-cols-[2rem_1fr] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel p-4 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onOpenDictionary(item)}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-bookopen" /></svg>
            <span className="flex flex-col gap-1"><b className="text-control-label">{uiText('openDictionary')}</b><small className="text-metadata text-fg-secondary">{uiText('fullEntryAndRelatedContent')}</small></span>
          </button>
          <button className="grid min-h-16 grid-cols-[2rem_1fr] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel p-4 text-left text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => toast(uiText('addingToLearningIsNotAvailableYet'))}>
            <svg className={iconClass} aria-hidden="true"><use href="#i-relearn" /></svg>
            <span className="flex flex-col gap-1"><b className="text-control-label">{uiText('addToLearning')}</b><small className="text-metadata text-fg-tertiary">{uiText('notAvailableYet')}</small></span>
          </button>
        </div>
      </div>
    </section>
  );
};
