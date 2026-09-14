/** Narrow test bridge compiled only for the real-browser delivery smoke. */
import { listDrafts, saveDraft } from './data/library/drafts';
import { readCloudSync } from './data/library/cloudSync';
import { openLibrary, readLibrary, readLibraryStorageDiagnostics } from './data/library/store';
import { JOURNEY_STORE_KEY, type JourneyState } from './experience/personalMeaningJourney/store';

type BrowserSmokeBridge = {
  seedDrafts(drafts: number, images: number): Promise<number>;
  draftCount(): Promise<number>;
  syncStatus(): Promise<string>;
  semanticWorldContainsExpression(surfaceForm: string): Promise<boolean>;
  storageDiagnostics(): ReturnType<typeof readLibraryStorageDiagnostics>;
};

declare global {
  interface Window {
    __sensaBrowserSmoke?: BrowserSmokeBridge;
  }
}

const randomDataUrl = (size: number): string => {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 65_536) {
    crypto.getRandomValues(bytes.subarray(at, Math.min(size, at + 65_536)));
  }
  let binary = '';
  for (let at = 0; at < size; at += 3_000) {
    binary += String.fromCharCode(...bytes.subarray(at, Math.min(size, at + 3_000)));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
};

if (import.meta.env.VITE_SENSA_BROWSER_SMOKE === 'true') {
  window.__sensaBrowserSmoke = {
    async seedDrafts(drafts, images) {
      await openLibrary();
      // Reuse one real-sized image under differently shaped rows. Canonical sync should
      // upload its media chunks once; legacy fixed-width repacking expands near the
      // logical size and exercises a production-sized restore.
      const sharedImage = randomDataUrl(180_000);
      for (let index = 0; index < drafts; index++) {
        await saveDraft(crypto.randomUUID(), {
          id: crypto.randomUUID(),
          expectedRevision: 0,
          text: `fixture context ${index} ${'x'.repeat(index * 137)}`,
          images: Array.from({ length: images }, (_, image) => ({
            id: crypto.randomUUID(),
            name: `fixture-${index}-${image}.jpg`,
            dataUrl: sharedImage,
          })),
        });
      }
      return (await listDrafts()).length;
    },
    async draftCount() {
      return (await listDrafts()).length;
    },
    async syncStatus() {
      return (await readCloudSync())?.status ?? 'none';
    },
    async semanticWorldContainsExpression(surfaceForm) {
      const raw = await readLibrary((tx) => tx.get<string>('semanticWorld', JOURNEY_STORE_KEY));
      if (!raw) return false;
      const state = JSON.parse(raw) as JourneyState;
      return state.meanings.some((meaning) =>
        meaning.personalExpressionAnchorRevisions.some(
          (revision) => revision.surfaceForm === surfaceForm,
        ));
    },
    storageDiagnostics: readLibraryStorageDiagnostics,
  };
}
