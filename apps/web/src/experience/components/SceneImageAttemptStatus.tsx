import {localFlowText} from '../../i18n/localFlowText';
import type {SceneImageAttemptStatus as AttemptStatus} from './useSceneImageInput';

interface SceneImageAttemptStatusProps {
  statuses: readonly AttemptStatus[];
  className?: string;
}

export function SceneImageAttemptStatus({
  statuses,
  className = '',
}: SceneImageAttemptStatusProps) {
  if (!statuses.some((status) => status.state === 'failed')) return null;
  return (
    <ul role="alert" className={className}>
      {statuses.map((status) => (
        <li
          key={status.fileKey}
          className={status.state === 'failed' ? 'text-feedback-danger' : 'text-feedback-success'}
        >
          {localFlowText(
            status.state === 'added' ? 'sceneImageAdded' : 'sceneImageRetry',
            {name: status.fileName},
          )}
        </li>
      ))}
    </ul>
  );
}
