import { createContext, useContext, type ReactNode } from 'react';

export type DictionaryPresentation = 'sensa' | 'baseline';

const DictionaryPresentationContext = createContext<DictionaryPresentation>('sensa');

export function DictionaryPresentationProvider({
  presentation,
  children,
}: {
  presentation: DictionaryPresentation;
  children: ReactNode;
}) {
  return (
    <DictionaryPresentationContext.Provider value={presentation}>
      {children}
    </DictionaryPresentationContext.Provider>
  );
}

export function useDictionaryPresentation(): DictionaryPresentation {
  return useContext(DictionaryPresentationContext);
}
