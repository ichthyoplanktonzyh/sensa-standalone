import type { SensaFormalPinnedLanguageContext } from '@sensa/contracts/sensa';

import { enrollPersonal } from '../../data/library/personalLearning';
import type { PersonalMeaningLearningSource } from './contracts';

/**
 * Curriculum calls this handoff only after an explicit Add-to-Learning intent.
 * Content Supply owns the resulting preparation task and returns no Learning state.
 */
export async function requestPersonalContentProvisioning(input: {
  operationId: string;
  source: PersonalMeaningLearningSource;
  languageContext: SensaFormalPinnedLanguageContext;
  useContext: boolean;
}) {
  const task = await enrollPersonal(
    input.operationId,
    input.source,
    input.languageContext,
    input.useContext,
  );
  return {
    provisioningTaskId: task.id,
    provisioningStatus: task.status === 'ready'||task.status==='covered' ? 'ready' as const : 'waiting' as const,
  };
}
