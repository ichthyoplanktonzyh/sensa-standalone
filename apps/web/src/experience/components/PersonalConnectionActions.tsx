import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { iconClass } from '../ui/primitives';
import { useEffect, useState } from 'react';
import {
  contentAnnotations,
  type PersonalSemanticAnchor,
} from '../../data/library/contentAnnotations';

interface PersonalConnectionActionsProps {
  senseId: string;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  variant?: 'reveal' | 'feedback' | 'compact';
}

interface PersonalConnectionState {
  note: string;
  anchors: PersonalSemanticAnchor[];
}

export function PersonalConnectionActions({
  senseId,
  onOpenNote,
  onOpenScene,
  variant = 'feedback',
}: PersonalConnectionActionsProps) {
  useTranslation();
  const [state, setState] = useState<PersonalConnectionState>({ note: '', anchors: [] });

  useEffect(() => {
    const refresh = () => {
      setState({
        note: contentAnnotations.getSenseNote(senseId),
        anchors: contentAnnotations.getSemanticAnchors(senseId),
      });
    };
    refresh();
    return contentAnnotations.subscribe(refresh);
  }, [senseId]);

  const hasNote = state.note.trim().length > 0;
  const anchorCount = state.anchors.length;
  const latestAnchorId = state.anchors[0]?.anchorId;
  const hasPersonalConnection = hasNote || anchorCount > 0;

  if (variant === 'compact') {
    return (
      <div
        className="relative z-[1] mt-3 grid grid-cols-2 border-y border-border-subtle"
        aria-label={uiText('personalContentForThisMeaning')}
      >
        <button
          className="relative flex min-h-12 items-center justify-center gap-2 border-0 bg-transparent px-3 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
          type="button"
          onClick={onOpenNote}
          aria-label={hasNote ? uiText('editNoteForThisMeaning') : uiText('addANoteForThisMeaning')}
        >
          <svg className={iconClass} aria-hidden="true"><use href="#i-pen" /></svg>
          <span>{uiText('note')}</span>
          {hasNote && <i className="size-1.5 rounded-full bg-decorative" aria-hidden="true" />}
        </button>
        <button
          className="relative flex min-h-12 items-center justify-center gap-2 border-0 border-l border-border-subtle bg-transparent px-3 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
          aria-label={anchorCount > 0 ? uiText('viewContextCount', { count: anchorCount }) : uiText('addAPersonalContextForThisMeaning')}
        >
          <svg className={iconClass} aria-hidden="true"><use href="#i-bulb" /></svg>
          <span>{uiText('myContext')}</span>
          {anchorCount > 0 && <b className="grid min-w-5 place-items-center rounded-pill bg-accent-soft px-1 text-metadata text-action-primary" aria-hidden="true">{anchorCount}</b>}
        </button>
      </div>
    );
  }

  return (
    <section
      className={`relative z-[1] mt-5 border-t border-border-subtle pt-5 text-fg-primary ${variant === 'reveal' ? 'mt-6' : ''}`}
      aria-label={uiText('myConnectionsForThisMeaning')}
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-body font-semibold">{hasPersonalConnection ? uiText('myConnections') : uiText('addYourConnection')}</h3>
        </div>
        {hasPersonalConnection && (
          <small className="text-right text-metadata leading-5 text-fg-tertiary">
            {hasNote ? uiText('hasNotes') : uiText('noNotesYet2')} · {anchorCount > 0 ? uiText('contextCount', { count: anchorCount }) : uiText('noContextsYet')}
          </small>
        )}
      </header>

      {!hasPersonalConnection && (
        <p className="mt-2 max-w-md text-body-support leading-6 text-fg-secondary">{uiText('saveYourUnderstandingOrARealExperience')}</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button className="grid min-h-16 min-w-0 grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel p-3 text-left text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onOpenNote}>
          <span className="grid size-10 place-items-center rounded-control bg-accent-soft text-action-primary" aria-hidden="true">
            <svg className={iconClass}><use href="#i-pen" /></svg>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <b className="text-control-label">{hasNote ? uiText('editNote') : uiText('addANote')}</b>
            <small className="text-metadata text-fg-secondary">{hasNote ? uiText('refineYourUnderstanding') : uiText('saveAnInsightOrReminder')}</small>
          </span>
          <svg className="size-4 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>

        <button
          className="grid min-h-16 min-w-0 grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-control border border-border-subtle bg-surface-panel p-3 text-left text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
        >
          <span className="grid size-10 place-items-center rounded-control bg-accent-soft text-action-primary" aria-hidden="true">
            <svg className={iconClass}><use href="#i-bulb" /></svg>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <b className="text-control-label">{anchorCount > 0 ? uiText('viewMyContexts') : uiText('addMyContext')}</b>
            <small className="text-metadata text-fg-secondary">{anchorCount > 0 ? uiText('editTheLatestConnection') : uiText('connectToARealExperience')}</small>
          </span>
          <svg className="size-4 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      {anchorCount > 0 && (
        <button
          type="button"
          className="ml-auto mt-3 flex min-h-11 items-center gap-2 rounded-control px-3 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
          onClick={() => onOpenScene()}
        >
          <svg className={iconClass} aria-hidden="true"><use href="#i-penplus" /></svg>
          {uiText('addAnotherContext')}</button>
      )}
    </section>
  );
}
