import type { ResolvedPracticeScope } from '../practiceScope';
import { SensaFreePracticeScreen } from './SensaFreePracticeScreen';
import type {PracticeScopeAvailability} from '../usePracticeScope';

export interface AcademyScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenPracticeScope: () => void;
  onOpenRealWorldListening: () => void;
  onBrowseContent: () => void;
  onRecordContext: () => void;
  practiceScope: ResolvedPracticeScope;
  scopeAvailability?: PracticeScopeAvailability;
  onRetryScope?:()=>void;
}

export const AcademyScreen = (props: AcademyScreenProps) => (
  <SensaFreePracticeScreen {...props} />
);
