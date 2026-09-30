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
  storageDiagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): ReturnType<typeof readLibraryStorageDiagnostics>;
  transactionConcurrency(): Promise<{readersOverlap:boolean;writerWaited:boolean}>;
  supplyCheckpoint(): Promise<{key:string;packageId:string;version:number;bookDigests:string[]}[]>;
  learningCheckpoint(): Promise<{
    targetIds:string[];
    enrollments:{enrollmentId:string;sourceKind:string;bookVersionNumber:number|null;bookDigest:string|null}[];
    runtime:{runId:string;targetId:string;stepId:string|null;materializationId:string|null}|null;
    records:{recordId:string;targetId:string;kind:string}[];
    completedTargets:{targetId:string;nextReviewAt:string|null}[];
  }>;
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
    async supplyCheckpoint() {
      const {contentSupplySystem}=await import('./contentSupply/system');
      const snapshot=await contentSupplySystem.read({kind:'workspace'});
      return snapshot.packages.map(pack=>({
        key:pack.key,packageId:pack.portableOrigin.manifest.metadata.packageId,
        version:pack.portableOrigin.manifest.metadata.version,
        bookDigests:pack.portableOrigin.publications.map(publication=>publication.bookArchiveSha256),
      })).sort((left,right)=>left.key.localeCompare(right.key));
    },
    async learningCheckpoint() {
      const [{languageRoutesSnapshot},{learningSystem}]=await Promise.all([
        import('./data/library/language'),import('./learning/system/learningSystem'),
      ]);
      const {context}=await languageRoutesSnapshot();
      const snapshot=await learningSystem.read({kind:'workspace',languageContext:context});
      const runtime=snapshot.runtime;
      return {
        targetIds:snapshot.targets.map(target=>target.targetId).sort(),
        enrollments:snapshot.enrollments.map(enrollment=>({
          enrollmentId:enrollment.enrollmentId,sourceKind:enrollment.source.kind,
          bookVersionNumber:enrollment.source.kind==='published_book'?enrollment.source.bookVersionNumber:null,
          bookDigest:enrollment.source.kind==='published_book'?enrollment.source.publicationArchiveSha256:null,
        })).sort((left,right)=>left.enrollmentId.localeCompare(right.enrollmentId)),
        runtime:runtime?{
          runId:runtime.runId,targetId:runtime.currentTargetId,
          stepId:runtime.kind==='lightweight'?runtime.step?.protocolStepInstanceId??null:null,
          materializationId:runtime.kind==='lightweight'?runtime.step?.materialization.snapshot.learningMaterializationId??null:null,
        }:null,
        records:snapshot.records.map(record=>({recordId:record.recordId,targetId:record.targetId,kind:record.kind})),
        completedTargets:snapshot.targets.filter(target=>target.completed).map(target=>({targetId:target.targetId,nextReviewAt:target.nextReviewAt})),
      };
    },
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
