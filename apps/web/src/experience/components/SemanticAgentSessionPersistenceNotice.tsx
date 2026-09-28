import {localFlowText} from '../../i18n/localFlowText';
import {uiText} from '../../i18n/uiText';
import type {SemanticAgentSessionPersistenceIssue} from '../personalMeaningJourney/semanticAgentSession';
import {classNames} from '../ui/primitives';

interface SemanticAgentSessionPersistenceNoticeProps {
  issue: SemanticAgentSessionPersistenceIssue | null;
  busy: boolean;
  onRetry: () => void;
  onLoadLatest: () => void;
}

/** A clarification thread may continue in this tab after durable storage
 * rejects a write, but the UI must never present that state as safely saved. */
export function SemanticAgentSessionPersistenceNotice({
  issue,
  busy,
  onRetry,
  onLoadLatest,
}: SemanticAgentSessionPersistenceNoticeProps) {
  if (!issue) return null;
  const conflict = issue === 'conflict';
  return (
    <div
      className={classNames('pmw-inline-error')}
      role="alert"
      data-session-persistence={conflict ? 'conflict' : 'tab-only'}
    >
      <span>{localFlowText(conflict ? 'draftChanged' : 'storageWrite')}</span>
      <button type="button" disabled={busy} onClick={conflict ? onLoadLatest : onRetry}>
        {conflict ? localFlowText('conversationReload') : uiText('retry')}
      </button>
    </div>
  );
}
