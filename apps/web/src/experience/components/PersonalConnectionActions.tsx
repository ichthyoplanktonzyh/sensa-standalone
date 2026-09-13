import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
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
        className={uiClass(`personal-connection-compact${hasPersonalConnection ? ' has-content' : ''}`)}
        aria-label={uiText('personalContentForThisMeaning')}
      >
        <button
          type="button"
          onClick={onOpenNote}
          aria-label={hasNote ? uiText('editNoteForThisMeaning') : uiText('addANoteForThisMeaning')}
        >
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-pen" /></svg>
          <span>{uiText('note')}</span>
          {hasNote && <i aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
          aria-label={anchorCount > 0 ? uiText('viewContextCount', { count: anchorCount }) : uiText('addAPersonalContextForThisMeaning')}
        >
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-bulb" /></svg>
          <span>{uiText('myContext')}</span>
          {anchorCount > 0 && <b aria-hidden="true">{anchorCount}</b>}
        </button>
      </div>
    );
  }

  return (
    <section
      className={uiClass(`personal-connection-actions is-${variant}${hasPersonalConnection ? ' has-content' : ''}`)}
      aria-label={uiText('myConnectionsForThisMeaning')}
    >
      <header>
        <div>
          <h3>{hasPersonalConnection ? uiText('myConnections') : uiText('addYourConnection')}</h3>
        </div>
        {hasPersonalConnection && (
          <small>
            {hasNote ? uiText('hasNotes') : uiText('noNotesYet2')} · {anchorCount > 0 ? uiText('contextCount', { count: anchorCount }) : uiText('noContextsYet')}
          </small>
        )}
      </header>

      {!hasPersonalConnection && (
        <p>{uiText('saveYourUnderstandingOrARealExperience')}</p>
      )}

      <div className={uiClass("personal-connection-grid")}>
        <button type="button" onClick={onOpenNote}>
          <span className={uiClass("personal-connection-icon")} aria-hidden="true">
            <svg className={uiClass("icon")}><use href="#i-pen" /></svg>
          </span>
          <span>
            <b>{hasNote ? uiText('editNote') : uiText('addANote')}</b>
            <small>{hasNote ? uiText('refineYourUnderstanding') : uiText('saveAnInsightOrReminder')}</small>
          </span>
          <svg className={uiClass("icon personal-connection-chevron")} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>

        <button
          type="button"
          onClick={() => onOpenScene(latestAnchorId)}
        >
          <span className={uiClass("personal-connection-icon")} aria-hidden="true">
            <svg className={uiClass("icon")}><use href="#i-bulb" /></svg>
          </span>
          <span>
            <b>{anchorCount > 0 ? uiText('viewMyContexts') : uiText('addMyContext')}</b>
            <small>{anchorCount > 0 ? uiText('editTheLatestConnection') : uiText('connectToARealExperience')}</small>
          </span>
          <svg className={uiClass("icon personal-connection-chevron")} aria-hidden="true"><use href="#i-chev-r" /></svg>
        </button>
      </div>

      {anchorCount > 0 && (
        <button
          type="button"
          className={uiClass("personal-connection-new-scene")}
          onClick={() => onOpenScene()}
        >
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-penplus" /></svg>
          {uiText('addAnotherContext')}</button>
      )}
    </section>
  );
}
