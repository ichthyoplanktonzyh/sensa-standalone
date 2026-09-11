import type { CardExecution } from './CardExecution';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type {
  DictionaryLookup,
  QuickDictEntry,
} from '../../types';
import type { RecognitionAssessmentResource } from '../../content/assessmentResources';
import { SensaRecognitionCard } from './SensaRecognitionCard';

export type AssessmentPurpose = 'acquisition' | 'retention';

export interface RecognitionCardProps {
  execution?: CardExecution;
  content: PrototypeIntroductionPackage;
  /** Exact Assessment Resource selected by the current Action. */
  assessment: RecognitionAssessmentResource;
  purpose?: AssessmentPurpose;
  onComplete: (correct: boolean, responseId?: string | null) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

export function RecognitionCard(props: RecognitionCardProps) {
  if (
    props.assessment.packageKey !== props.content.packageKey
    || props.assessment.senseKey !== props.content.senseKey
  ) {
    throw new Error('Recognition card resource does not match the selected Package.');
  }
  return <SensaRecognitionCard {...props} />;
}
