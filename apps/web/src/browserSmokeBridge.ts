/** Narrow test bridge compiled only for the real-browser delivery smoke. */
import { listDrafts, saveDraft } from './data/library/drafts';
import { readCloudSync } from './data/library/cloudSync';
import {
  openLibrary,
  readLibrary,
  readLibraryStorageDiagnostics,
  restoreLibraryTransaction,
} from './data/library/store';
import {loadJourneyStateFromLibrary} from './experience/personalMeaningJourney/repository';

type BrowserSmokeBridge = {
  seedDrafts(drafts: number, images: number): Promise<number>;
  draftCount(): Promise<number>;
  syncStatus(): Promise<string>;
  semanticWorldContainsExpression(surfaceForm: string): Promise<boolean>;
  intakeInboxCount(): Promise<number>;
  firstMeaningId(): Promise<string | null>;
  navigate(path: string): Promise<void>;
  openReferenceFixture(): Promise<void>;
  closeReferenceFixture(): Promise<void>;
  storageDiagnostics(): ReturnType<typeof readLibraryStorageDiagnostics>;
  transactionConcurrency(): Promise<{readersOverlap:boolean;writerWaited:boolean}>;
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
      const state=await loadJourneyStateFromLibrary();
      return state.meanings.some((meaning) =>
        meaning.personalExpressionAnchorRevisions.some(
          (revision) => revision.surfaceForm === surfaceForm,
        ));
    },
    async intakeInboxCount() {
      return (await loadJourneyStateFromLibrary()).inboxItems.length;
    },
    async firstMeaningId() {
      return (await loadJourneyStateFromLibrary()).meanings[0]?.personalMeaning.personalMeaningId ?? null;
    },
    async navigate(path) {
      const {router}=await import('./experience/router/router');
      router.history.push(path);
    },
    async openReferenceFixture() {
      const {useOverlayStore}=await import('./experience/stores/overlayStore');
      const sense={
        referenceSenseId:'fixture-sense',order:1,partOfSpeech:'interjection',
        glossL1:'打招呼用语',definitionL2:'hello or hi',examples:[],
      };
      useOverlayStore.getState().openDictModal({
        word:'hola',phonetic:'/ˈola/',senses:[],
        referenceLookup:{
          release:{releaseId:'fixture-release',provider:'Fixture',edition:'2026',targetLanguage:'es',learnerLocale:'zh-CN',rightsLabel:'Fixture only',status:'prototype'},
          entry:{referenceLexicalUnitId:'fixture-entry',releaseId:'fixture-release',headword:'hola',visibility:'reference_visible',pronunciations:[],forms:['hola'],senses:[sense],attribution:'Fixture'},
        },
      });
    },
    async closeReferenceFixture() {
      const {useOverlayStore}=await import('./experience/stores/overlayStore');
      useOverlayStore.getState().closeDictModal();
    },
    storageDiagnostics: readLibraryStorageDiagnostics,
    async transactionConcurrency() {
      let announceReader!:()=>void;
      let releaseReader!:()=>void;
      const readerStarted=new Promise<void>(resolve=>{announceReader=resolve;});
      const readerGate=new Promise<void>(resolve=>{releaseReader=resolve;});
      const first=readLibrary(async(tx)=>{
        await tx.get('meta','identity');
        announceReader();
        await readerGate;
      });
      await readerStarted;
      const readersOverlap=await Promise.race([
        readLibrary((tx)=>tx.get('meta','identity')).then(()=>true),
        new Promise<false>(resolve=>setTimeout(()=>resolve(false),1_000)),
      ]);
      let writerEntered=false;
      const writer=restoreLibraryTransaction(async(tx)=>{
        writerEntered=true;
        await tx.get('meta','identity');
      });
      await new Promise(resolve=>setTimeout(resolve,50));
      const writerWaited=!writerEntered;
      releaseReader();
      await Promise.all([first,writer]);
      return {readersOverlap,writerWaited};
    },
  };
}
