import type { CardExecution } from './CardExecution';
import type { MeaningToFormRecallAssessmentResource } from '../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type { MeaningToFormRecallOutcome } from '../../engine/types';
import { SensaRecallCard } from './SensaRecallCard';

export interface RecallCardProps {
  execution?: CardExecution;
  content: PrototypeIntroductionPackage;
  /** Exact Assessment Resource selected by the current Action. */
  assessment: MeaningToFormRecallAssessmentResource;
  purpose?: 'acquisition' | 'retention';
  onComplete: (outcome: MeaningToFormRecallOutcome, responseId?: string | null) => void;
  onOpenDictionary: (word: string) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  onViewChange: () => void;
  toast: (message: string) => void;
}

export function RecallCard(props: RecallCardProps) {
  if (
    props.assessment.packageKey !== props.content.packageKey
    || props.assessment.senseKey !== props.content.senseKey
  ) {
    throw new Error('Recall card resource does not match the selected Package.');
  }
  return <SensaRecallCard {...props} />;
}
