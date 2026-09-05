import type { ResolvedPracticeScope } from '../practiceScope';
import { SensaFreePracticeScreen } from './SensaFreePracticeScreen';

export interface AcademyScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenPracticeScope: () => void;
  onOpenRealWorldListening: () => void;
  practiceScope: ResolvedPracticeScope;
}

export const AcademyScreen = (props: AcademyScreenProps) => (
  <SensaFreePracticeScreen {...props} />
);
