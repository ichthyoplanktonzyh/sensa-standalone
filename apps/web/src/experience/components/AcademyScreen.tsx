import type {PracticeExpression,PracticeMaterialSelection} from '../practiceMaterials';
import { SensaFreePracticeScreen } from './SensaFreePracticeScreen';

export interface AcademyScreenProps {
  active: boolean;
  onBack: () => void;
  onOpenPracticeScope: () => void;
  onOpenRealWorldListening: () => void;
  onBrowseContent: () => void;
  onRecordContext: () => void;
  selection:PracticeMaterialSelection;
  preview:readonly PracticeExpression[];
  count:number|null;
  scopeAvailability?: 'loading'|'ready'|'unavailable';
  onRetryScope?:()=>void;
  starting?:boolean;onCancelStart?:()=>void;startError?:string;
  recentPlaybackCount?:number|null;
}

export const AcademyScreen = (props: AcademyScreenProps) => (
  <SensaFreePracticeScreen {...props} />
);
