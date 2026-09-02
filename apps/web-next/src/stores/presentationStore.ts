import { create } from 'zustand';
import type { PracticeHomePresentation } from '../components/AcademyScreen';
import type { DictionaryPresentation } from '../components/DictionaryPresentationContext';
import type { PortableListeningPresentation } from '../components/PortableListeningScreen';
import type { RealWorldListeningPresentation } from '../components/RealWorldListeningScreen';
import type { SemanticWorldPresentation } from '../components/SemanticWorldScreen';

/**
 * Which variant each screen renders -- the Sensa design against the baseline
 * it is being compared with.
 *
 * These are a genuine cross-cutting UI preference: written in one place (the
 * side panel) and read in another (each screen). Held in App they cost five
 * `useState`s and ten props threaded through `SidePanel` purely to reach it.
 *
 * They are also all that is left needing a store once routing owns navigation
 * and the URL owns drill-down targets -- which is the point: the answer to
 * "which state manager" was to move most state somewhere it belongs first, so
 * what remains is small enough that selective subscription is the only feature
 * actually needed.
 *
 * Not persisted: these were `useState` and reset on reload, and a comparison
 * toggle silently surviving a refresh would misrepresent what is being shown.
 */
export interface PresentationState {
  readonly semanticWorld: SemanticWorldPresentation;
  readonly practiceHome: PracticeHomePresentation;
  readonly portableListening: PortableListeningPresentation;
  readonly realWorldListening: RealWorldListeningPresentation;
  readonly dictionary: DictionaryPresentation;
  setSemanticWorld: (presentation: SemanticWorldPresentation) => void;
  setPracticeHome: (presentation: PracticeHomePresentation) => void;
  setPortableListening: (presentation: PortableListeningPresentation) => void;
  setRealWorldListening: (presentation: RealWorldListeningPresentation) => void;
  setDictionary: (presentation: DictionaryPresentation) => void;
}

export const usePresentationStore = create<PresentationState>((set) => ({
  semanticWorld: 'sensa',
  practiceHome: 'sensa',
  portableListening: 'sensa',
  realWorldListening: 'sensa',
  dictionary: 'sensa',
  setSemanticWorld: (semanticWorld) => set({ semanticWorld }),
  setPracticeHome: (practiceHome) => set({ practiceHome }),
  setPortableListening: (portableListening) => set({ portableListening }),
  setRealWorldListening: (realWorldListening) => set({ realWorldListening }),
  setDictionary: (dictionary) => set({ dictionary }),
}));
