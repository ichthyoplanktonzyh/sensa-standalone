import type { Word, QuickDictEntry } from '../types';
import { SensaExampleScreen } from './SensaExampleScreen';

export interface ExampleScreenProps {
  screenId?: string;
  active: boolean;
  curWord: Word;
  initialSenseIdx?: number;
  initialSentenceIdx?: number;
  /** Only an Action-authorized ordered sequence may enable Example pagination. */
  sentenceSequence?: number[];
  onClose: () => void;
  onOpenDict?: (word: Word | QuickDictEntry | string, tab?: string) => void;
  onNextWord: () => void;
  nextLabel?: string;
  toast: (msg: string) => void;
}

export const ExampleScreen = (props: ExampleScreenProps) => (
  <SensaExampleScreen {...props} />
);
