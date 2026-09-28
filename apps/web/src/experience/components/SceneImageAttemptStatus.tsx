import '../../i18n/contentResources';
import {useTranslation} from 'react-i18next';
import type {SceneImageAttemptStatus as AttemptStatus} from './useSceneImageInput';

interface SceneImageAttemptStatusProps {
  statuses: readonly AttemptStatus[];
  className?: string;
}

export function SceneImageAttemptStatus({
  statuses,
  className = '',
}: SceneImageAttemptStatusProps) {
  const {t}=useTranslation();
  if (!statuses.some((status) => status.state === 'failed')) return null;
  return (
    <ul role="alert" className={className}>
      {statuses.map((status) => (
        <li
          key={status.fileKey}
          className={status.state === 'failed' ? 'text-feedback-danger' : 'text-feedback-success'}
        >
          {t(`sceneImageAttempt.${status.state === 'added' ? 'added' : 'retry'}`,{
            ns:'content',name:status.fileName,
          })}
        </li>
      ))}
    </ul>
  );
}
