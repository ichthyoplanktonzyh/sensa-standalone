/** Narrow test bridge compiled only for the real-browser delivery smoke. */
import { listDrafts, saveDraft } from './data/library/drafts';
import { readCloudSync } from './data/library/cloudSync';
import {
  openLibrary,
  readLibrary,
  readLibraryStorageDiagnostics,
  restoreLibraryTransaction,
  writeLibraryCache,
} from './data/library/store';
import {loadJourneyStateFromLibrary} from './experience/personalMeaningJourney/repository';
import type {JourneyState} from './experience/personalMeaningJourney/store';

type BrowserSmokeBridge = {
  copyVerifiedLearningCapacityForTest(manifestPath:string):Promise<{targets:number;runs:number;events:number}>;
  learningCapacityCheckpointForTest(targetId:string):Promise<{targets:number;memoryRevision:number;runs:number;events:number;activeRunId:string|null;activeTargetId:string|null}>;
  setSpeechFixtureForTest(unavailable:boolean):Promise<void>;
  operatedStepMaterialsForTest():Promise<{eventId:string;runId:string;stepId:string;materializationId:string}[]>;
  meaningPinsForTest(id:string):Promise<Array<{senseId:string;senseVersionId:string}>>;
  retainExampleForTest(unavailable?:boolean):Promise<{exampleId:string;word:string|null;text:string|null}>;
  retainedExampleIdsForTest():Promise<string[]>;
  failAnnotationReadsForTest(active:boolean):Promise<void>;
  seedInboxForTest(payload:import('@sensa/contracts/sensa').SensaIntakePayload,media?:import('./data/library/media').StoredMedia):Promise<string>;
  appendInboxContextForTest(intakeId:string,text:string):Promise<void>;
  failNextInboxCommitForTest(intakeId:string):Promise<void>;
  loseNextInboxResolveResponseForTest(intakeId:string):Promise<void>;
  semanticMeaningCountForTest():Promise<number>;
  hideInboxMediaForTest(mediaId:string):Promise<void>;
  restoreInboxMediaForTest():Promise<void>;
  seedDrafts(drafts: number, images: number): Promise<number>;
  seedSemanticWorld(state:JourneyState):Promise<number>;
  holdDirectEnrollmentResultForTest():Promise<void>;
  releaseDirectEnrollmentResultForTest():void;
  failLearningWorkspaceReadsForTest(active:boolean):Promise<void>;
  failLearningManagementReadsForTest(active:boolean):Promise<void>;
  failLearningHistoryReadsForTest(active:boolean):Promise<void>;
  failLearningTargetReadsForTest(active:boolean):Promise<void>;
  learningReadsForTest(reset?:boolean):Promise<Record<string,number>>;
  traceLearningReadsForTest(active:boolean):Promise<void>;
  learningSettlementFactsForTest():Promise<{targets:{targetId:string;memoryRevision:number;reps:number|null}[];actionEventCount:number;behavioralEvidenceCount:number}>;
  failNextLearningCommitForTest(kind?:'action'|'quantity'|'finish'|'book_plan'|'supplemental'):Promise<void>;
  loseNextSupplementalResponseForTest():Promise<void>;
  failSupplementalReadsForTest(active:boolean):Promise<void>;
  supplementalDecisionsForTest():Promise<{states:import('./data/library/supplementalMemberships').SupplementalMembershipState[];commandCount:number}>;
  loseNextBookPlanResponseForTest():Promise<void>;
  failBookPlanReadsForTest(active:boolean):Promise<void>;
  loseNextLearningActionResponseForTest():Promise<void>;
  loseNextLearningQuantityResponseForTest():Promise<void>;
  loseNextSessionEndResponseForTest():Promise<void>;
  failReadsAfterSessionEndForTest():Promise<void>;
  commandsAfterSessionEndForTest():Promise<string[]>;
  holdNextLearningActionResponseForTest():Promise<void>;
  releaseLearningActionResponseForTest():void;
  holdWorldDetailReadsForTest():Promise<void>;
  releaseWorldDetailReadsForTest():void;
  holdWorldInboxReadsForTest():Promise<void>;
  releaseWorldInboxReadsForTest(fail?:boolean):void;
  notifyWorldReadForTest():Promise<void>;
  reviseMeaningContextForTest(id:string,text:string):Promise<void>;
  appendIntakeMaterialForTest(text:string):Promise<string>;
  semanticMediaCheckpoint():Promise<{mediaId:string;dataUrl:string}[]>;
  draftCount(): Promise<number>;
  syncStatus(): Promise<string>;
  semanticWorldContainsExpression(surfaceForm: string): Promise<boolean>;
  intakeInboxCount(): Promise<number>;
  provisioningCheckpoint():Promise<{taskId:string;targetId:string;status:string;useContext:boolean}[]>;
  firstMeaningId(): Promise<string | null>;
  navigate(path: string): Promise<void>;
  openReferenceFixture(): Promise<void>;
  closeReferenceFixture(): Promise<void>;
  storageDiagnostics(options?:Readonly<{verifyIntegrity?:boolean}>): ReturnType<typeof readLibraryStorageDiagnostics>;
  transactionConcurrency(): Promise<{readersOverlap:boolean;writerWaited:boolean}>;
  supplyCheckpoint(): Promise<{key:string;packageId:string;version:number;bookDigests:string[]}[]>;
  portablePackageDigestForTest(packageKey:string):Promise<{sha256:string;byteLength:number}>;
  bookProvenanceCheckpointForTest():Promise<{
    installations:import('./data/library/packageRecords').PackageInstallation[];
    cache:{key:string;publications:{archiveSha256:string;memberIndex:number|null}[]}[];
    identities:import('./data/library/packageCacheProjection').PackagePublicationIdentity[];
  }>;
  discardPackageCacheForRecoveryTest():Promise<void>;
  curriculumSourceCheckpointForTest():Promise<{
    targets:import('./learning/runtime/localProtocol').LocalLearningTarget[];
    runs:import('./learning/runtime/localProtocol').LocalLearningRun[];
  }>;
  learningArrangementCheckpointForTest():Promise<{
    session:import('./data/library/studyScopes').LocalLearningSession|null;
    scope:import('./data/library/studyScopes').LocalStudyScope|null;
    runScope:import('./data/library/studyScopes').LocalStudyScope|null;
  }>;
  learningActivityRecordForTest(runId:string):Promise<{run:import('./learning/runtime/localProtocol').LocalLearningRun|null;originSession:import('./data/library/studyScopes').LocalLearningSession|null}>;
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
  let releaseWorldReads:(()=>void)|undefined;
  let releaseInboxReads:((fail?:boolean)=>void)|undefined;
  let hiddenInboxMedia:import('./data/library/media').StoredMedia|undefined;
  let releaseDirectResult:(()=>void)|undefined,restoreLearningReads:(()=>void)|undefined,restoreAnnotationReads:(()=>void)|undefined;
  let releaseLearningResult:(()=>void)|undefined,learningReadCounts:Record<string,number>|undefined;
  let restoreLearningTrace:(()=>void)|undefined;
  window.__sensaBrowserSmoke = {
    async copyVerifiedLearningCapacityForTest(manifestPath){
      if(!manifestPath.startsWith('/__capacity_fixture/'))throw new Error('Invalid capacity fixture path');
      const [{libraryTables},{decodeBackupValue,encodeBackupValue},{sqliteRecordAdapter}]=await Promise.all([import('./data/library/store'),import('./data/library/backupCodec'),import('./data/library/sqliteAdapter')]);
      const manifest=await fetch(manifestPath).then(response=>response.json()) as {format:string;targets:number;runs:number;events:number;batches:{table:string;file:string;rowCount:number;sha256:string}[]};
      if(!['sensa-retention-capacity-facts-v1','sensa-learning-capacity-facts-v1'].includes(manifest.format)||manifest.targets<1||manifest.targets>10000)throw new Error('Invalid capacity fixture manifest');
      const adapter=await sqliteRecordAdapter();
      // Specialized fixture transport, not a product backup/atomic-restore
      // path. The Node producer fully replay-validates these exact facts before
      // writing digest-addressed batches. Copy one bounded batch at a time into
      // an empty test guest; never synthesize or strip Target/Run/Event fields.
      // The Library lock prevents app commands from observing partial setup.
      return restoreLibraryTransaction(async tx=>{
        if(await tx.get('meta','service-owner'))throw new Error('Capacity fixture requires an isolated guest');
        for(const table of libraryTables)if(!['meta','settings','operations','packageCache'].includes(table)&&await tx.count(table))throw new Error('Capacity fixture destination is occupied');
        const seen=new Set<string>();
        // Source dependency order also ensures completed history can find its
        // Targets when setup deliberately uses separate small transactions.
        for(const table of libraryTables)for(const batch of manifest.batches.filter(batch=>batch.table===table)){
          if(!/^\w+-\d+\.json$/u.test(batch.file)||seen.has(batch.file)||batch.rowCount<1||batch.rowCount>64)throw new Error('Invalid capacity fixture batch');seen.add(batch.file);
          const response=await fetch(`/__capacity_fixture/${batch.file}`);if(!response.ok)throw new Error('Capacity fixture missing');
          const bytes=new Uint8Array(await response.arrayBuffer()),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
          if([...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')!==batch.sha256)throw new Error('Capacity fixture digest mismatch');
          const chunk=decodeBackupValue(JSON.parse(new TextDecoder().decode(bytes)));if(!Array.isArray(chunk)||chunk.length!==batch.rowCount||chunk.some(row=>typeof row.key!=='string'||table==='meta'&&row.key==='service-owner'))throw new Error('Capacity fixture count or guest mismatch');
          await adapter.commit({clears:[],deletes:[],puts:chunk.map(row=>({table,key:row.key,encodedValue:JSON.stringify(encodeBackupValue(row.value))}))});
        }
        if(seen.size!==manifest.batches.length)throw new Error('Unknown capacity fixture table');
        const counts={targets:await tx.count('learningTargets'),runs:await tx.count('learningRuns'),events:await tx.count('learningEvents')};
        if(counts.targets!==manifest.targets||counts.runs!==manifest.runs||counts.events!==manifest.events)throw new Error('Capacity fixture source count mismatch');
        tx.put('meta','local-incarnation',crypto.randomUUID());
        return counts;
      });
    },
    async learningCapacityCheckpointForTest(targetId){
      return readLibrary(async tx=>{
        const target=await tx.get<import('./learning/runtime/localProtocol').LocalLearningTarget>('learningTargets',targetId),activeRunId=await tx.get<string>('meta','learning-active');
        const run=activeRunId?await tx.get<import('./learning/runtime/localProtocol').LocalLearningRun>('learningRuns',activeRunId):null;
        if(!target)throw new Error('Capacity Target missing');
        return {targets:await tx.count('learningTargets'),memoryRevision:target.memoryRevision,runs:await tx.count('learningRuns'),events:await tx.count('learningEvents'),activeRunId:activeRunId??null,activeTargetId:run?.targetId??null};
      });
    },
    async learningSettlementFactsForTest(){
      return readLibrary(async tx=>{
        const targets=await tx.all<import('./learning/runtime/localProtocol').LocalLearningTarget>('learningTargets');
        const events=await tx.all<{detail?:{formalEvaluation?:{evidence?:unknown[]}}}>('learningEvents');
        return {targets:targets.map(target=>({targetId:target.id,memoryRevision:target.memoryRevision,reps:target.memory?.reps??null})),actionEventCount:events.length,behavioralEvidenceCount:events.reduce((count,event)=>count+(event.detail?.formalEvaluation?.evidence?.length??0),0)};
      });
    },
    async traceLearningReadsForTest(active){
      if(!active){restoreLearningTrace?.();restoreLearningTrace=undefined;return;}
      if(restoreLearningTrace)throw new Error('Learning trace already active');
      const [{learningSystem},{sqliteRecordAdapter}]=await Promise.all([import('./learning/system'),import('./data/library/sqliteAdapter')]);
      const adapter=await sqliteRecordAdapter(),read=learningSystem.read,execute=learningSystem.execute,home=adapter.homeLearningProjection.bind(adapter),history=adapter.learningHistoryPage.bind(adapter),summary=adapter.learningManagementSummary.bind(adapter),candidates=adapter.runtimeLearningCandidates.bind(adapter);let sequence=0;
      const traced=async<T,>(label:string,work:()=>Promise<T>)=>{const id=++sequence;console.debug(`__sensaLearningTrace|start|${id}|${label}`);try{return await work();}finally{console.debug(`__sensaLearningTrace|end|${id}|${label}`);}};
      learningSystem.read=(async query=>traced(`query:${query.kind}`,()=>read(query))) as typeof read;
      learningSystem.execute=(async command=>traced(`command:${command.kind}`,()=>execute(command))) as typeof execute;
      adapter.homeLearningProjection=(routeId,clock)=>traced('storage:home',()=>home(routeId,clock));adapter.learningHistoryPage=query=>traced('storage:history',()=>history(query));adapter.learningManagementSummary=query=>traced('storage:summary',()=>summary(query));
      adapter.runtimeLearningCandidates=query=>traced('storage:candidates',()=>candidates(query));
      restoreLearningTrace=()=>{learningSystem.read=read;learningSystem.execute=execute;adapter.homeLearningProjection=home;adapter.learningHistoryPage=history;adapter.learningManagementSummary=summary;adapter.runtimeLearningCandidates=candidates;};
    },
    async learningReadsForTest(reset=false){
      if(!learningReadCounts){
        learningReadCounts={};const {learningSystem}=await import('./learning/system');const read=learningSystem.read;
        learningSystem.read=(async query=>{learningReadCounts![query.kind]=(learningReadCounts![query.kind]??0)+1;return read(query);}) as typeof read;
      }
      const result={...learningReadCounts};if(reset)learningReadCounts={};return result;
    },
    async failNextLearningCommitForTest(kind='action'){
      const {sqliteRecordAdapter}=await import('./data/library/sqliteAdapter');const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);
      adapter.commit=async mutation=>{const reject=kind==='finish'?mutation.deletes.some(row=>row.table==='meta'&&row.key==='learning-active'):mutation.puts.some(row=>kind==='quantity'?row.table==='settings'&&row.key==='language-route-study-plans':kind==='book_plan'?row.table==='curriculumEnrollments':kind==='supplemental'?row.table==='supplementalMembershipStates':row.table==='learningEvents');if(reject){adapter.commit=commit;throw new Error('fixture learning commit failed');}return commit(mutation);};
    },
    async loseNextSupplementalResponseForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='change_supplemental_membership'){learningSystem.execute=execute;throw new Error('fixture lost supplemental response');}return result;}) as typeof execute;
    },
    async failSupplementalReadsForTest(active){
      const {learningSystem}=await import('./learning/system'),held=Reflect.get(learningSystem,'supplementalReadFailureForTest') as {active:boolean}|undefined;
      if(held){held.active=active;return;}const control={active},read=learningSystem.read;Reflect.set(learningSystem,'supplementalReadFailureForTest',control);
      learningSystem.read=(async query=>{if(query.kind==='supplemental_memberships'&&control.active)throw Error('fixture supplemental read failed');return read(query);}) as typeof read;
    },
    async supplementalDecisionsForTest(){
      return readLibrary(async tx=>({states:await tx.all<import('./data/library/supplementalMemberships').SupplementalMembershipState>('supplementalMembershipStates'),commandCount:(await tx.all<{input:string}>('operations')).filter(row=>JSON.parse(row.input).kind==='learning.changeSupplementalMembership').length}));
    },
    async loseNextBookPlanResponseForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='change_book_plan'){learningSystem.execute=execute;throw new Error('fixture lost Book plan response');}return result;}) as typeof execute;
    },
    async failBookPlanReadsForTest(active){
      const {learningSystem}=await import('./learning/system');
      const held=Reflect.get(learningSystem,'bookPlanReadFailureForTest') as {active:boolean}|undefined;
      if(held){held.active=active;return;}
      const control={active},read=learningSystem.read;
      Reflect.set(learningSystem,'bookPlanReadFailureForTest',control);
      learningSystem.read=(async query=>{if(query.kind==='book_plans'&&control.active)throw Error('fixture Book plan read failed');return read(query);}) as typeof read;
    },
    async loseNextLearningActionResponseForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='act'){learningSystem.execute=execute;throw new Error('fixture lost committed Action receipt');}return result;}) as typeof execute;
    },
    async loseNextLearningQuantityResponseForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='confirm_quantity'){learningSystem.execute=execute;throw new Error('fixture lost committed quantity receipt');}return result;}) as typeof execute;
    },
    async loseNextSessionEndResponseForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='end_session'){learningSystem.execute=execute;throw Error('fixture lost committed Session end receipt');}return result;}) as typeof execute;
    },
    async failReadsAfterSessionEndForTest(){
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;
      if(restoreLearningReads)throw Error('Learning read fault already active');
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='end_session'){const commands:string[]=[];Reflect.set(learningSystem,'commandsAfterSessionEndForTest',commands);learningSystem.execute=(async next=>{commands.push(next.kind);return execute(next);}) as typeof execute;const read=learningSystem.read;learningSystem.read=(async query=>{if(query.kind==='runtime')throw Error('fixture post-end read failed');return read(query);}) as typeof read;restoreLearningReads=()=>{learningSystem.read=read;};}return result;}) as typeof execute;
    },
    async commandsAfterSessionEndForTest(){const {learningSystem}=await import('./learning/system');return [...(Reflect.get(learningSystem,'commandsAfterSessionEndForTest') as string[]??[])];},
    async holdNextLearningActionResponseForTest(){
      if(releaseLearningResult)throw new Error('Action response already held');
      const {learningSystem}=await import('./learning/system');const execute=learningSystem.execute;let release!:()=>void;
      const held=new Promise<void>(resolve=>{release=resolve;});
      learningSystem.execute=(async command=>{const result=await execute(command);if(command.kind==='act'){learningSystem.execute=execute;await held;}return result;}) as typeof execute;
      releaseLearningResult=()=>{learningSystem.execute=execute;release();releaseLearningResult=undefined;};
    },
    releaseLearningActionResponseForTest(){releaseLearningResult?.();},
    async operatedStepMaterialsForTest(){
      return readLibrary(async tx=>(await tx.entries('learningEvents')).flatMap(({key,value})=>{
        const event=value as {runId:string;detail?:{stepId?:string;materializationId?:string}};
        return event.detail?.stepId&&event.detail.materializationId?[{eventId:key,runId:event.runId,stepId:event.detail.stepId,materializationId:event.detail.materializationId}]:[];
      }).sort((left,right)=>left.eventId.localeCompare(right.eventId)));
    },
    async setSpeechFixtureForTest(unavailable){
      // Provider-boundary fixture only. Preparation still constructs requests,
      // validates all candidates and admits material through production code.
      const {replaceClientSpeechProvider}=await import('./data/library/speech/provider');
      replaceClientSpeechProvider({id:'browser-fixture',revision:1,displayName:'Synthetic browser fixture',synthesize:async input=>{
        if(unavailable)throw new Error('speech_language_unavailable');
        return {...input,audioUrl:'data:audio/mpeg;base64,UklGRg==',phoneticNotation:null,accentLabel:'en-US',source:'Synthetic browser fixture, not audible quality evidence',method:'tts'};
      }});
    },
    async holdDirectEnrollmentResultForTest(){
      if(releaseDirectResult)throw new Error('Direct result already held');
      const {learningSystem}=await import('./learning/system');const original=learningSystem.execute;
      let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
      learningSystem.execute=(async command=>{const result=await original(command);if(command.kind==='enroll_direct'){learningSystem.execute=original;await held;}return result;}) as typeof original;
      releaseDirectResult=()=>{learningSystem.execute=original;release();releaseDirectResult=undefined;};
    },
    releaseDirectEnrollmentResultForTest(){releaseDirectResult?.();},
    async failLearningWorkspaceReadsForTest(active){
      const {learningSystem}=await import('./learning/system');
      if(!active){restoreLearningReads?.();restoreLearningReads=undefined;return;}
      if(restoreLearningReads)throw new Error('Learning read fault already active');const original=learningSystem.read;
      learningSystem.read=(async query=>{if(query.kind==='workspace')throw new Error('fixture-workspace-read-failure');return original(query);}) as typeof original;
      restoreLearningReads=()=>{learningSystem.read=original;};
      window.dispatchEvent(new CustomEvent('sensa-library-changed',{detail:{tables:['curriculumEnrollments']}}));
    },
    async failLearningManagementReadsForTest(active){
      const {learningSystem}=await import('./learning/system');
      if(!active){restoreLearningReads?.();restoreLearningReads=undefined;return;}
      if(restoreLearningReads)throw new Error('Learning read fault already active');const original=learningSystem.read;
      learningSystem.read=(async query=>{if(query.kind==='management')throw new Error('fixture-management-read-failure');return original(query);}) as typeof original;
      restoreLearningReads=()=>{learningSystem.read=original;};
    },
    async failLearningHistoryReadsForTest(active){
      const {learningSystem}=await import('./learning/system');
      if(!active){restoreLearningReads?.();restoreLearningReads=undefined;return;}
      if(restoreLearningReads)throw new Error('Learning read fault already active');const original=learningSystem.read;
      learningSystem.read=(async query=>{if(query.kind==='history')throw new Error('fixture-history-read-failure');return original(query);}) as typeof original;
      restoreLearningReads=()=>{learningSystem.read=original;};
    },
    async failLearningTargetReadsForTest(active){
      const {learningSystem}=await import('./learning/system');
      if(!active){restoreLearningReads?.();restoreLearningReads=undefined;return;}
      if(restoreLearningReads)throw new Error('Learning read fault already active');const original=learningSystem.read;
      learningSystem.read=(async query=>{if(query.kind==='target')throw new Error('fixture-target-read-failure');return original(query);}) as typeof original;
      restoreLearningReads=()=>{learningSystem.read=original;};
    },
    async meaningPinsForTest(id){
      const {worldReadRepository}=await import('./experience/personalMeaningJourney/worldRepository');
      return (await worldReadRepository.detail(id)).detail?.directAlignments.map(({senseId,senseVersionId})=>({senseId,senseVersionId}))??[];
    },
    async retainExampleForTest(unavailable=false){
      // Seed an existing owner bookmark through the real command, not a new
      // public acquisition path, fabricated Meaning or learning outcome.
      const [{PRACTICE_SENSES},{personalContentSystem}]=await Promise.all([import('./experience/practiceData'),import('./personalContent/system')]);
      const item=unavailable?null:PRACTICE_SENSES[0];if(!unavailable&&!item)throw Error('Missing bundled Example fixture');
      const exampleId=item?.example.exampleId??crypto.randomUUID();
      await personalContentSystem.execute({kind:'set_saved_example',operationId:crypto.randomUUID(),exampleId,saved:true});
      return {exampleId,word:item?.word??null,text:item?.example.text??null};
    },
    async retainedExampleIdsForTest(){
      const {personalContentSystem}=await import('./personalContent/system');await personalContentSystem.refresh();
      return [...personalContentSystem.read({kind:'snapshot'}).savedExampleIds].sort();
    },
    async failAnnotationReadsForTest(active){
      if(!active){restoreAnnotationReads?.();restoreAnnotationReads=undefined;return;}
      if(restoreAnnotationReads)throw Error('Annotation read fault already active');
      const [{sqliteRecordAdapter},{personalContentSystem}]=await Promise.all([import('./data/library/sqliteAdapter'),import('./personalContent/system')]);
      const adapter=await sqliteRecordAdapter(),entries=adapter.entries.bind(adapter);
      adapter.entries=async table=>{if(table==='annotations')throw Error('fixture annotation read failed');return entries(table);};
      restoreAnnotationReads=()=>{adapter.entries=entries;};
      await personalContentSystem.refresh().catch(()=>undefined);
      if(personalContentSystem.read({kind:'snapshot'}).status!=='error')throw Error('Annotation read fault was not exercised');
    },
    async failNextInboxCommitForTest(intakeId){
      const {sqliteRecordAdapter}=await import('./data/library/sqliteAdapter');
      const adapter=await sqliteRecordAdapter(),commit=adapter.commit.bind(adapter);
      adapter.commit=async mutation=>{if(mutation.deletes.some(row=>row.table==='semanticInbox'&&row.key===intakeId)){adapter.commit=commit;throw new Error('fixture Inbox commit failure');}return commit(mutation);};
    },
    async semanticMeaningCountForTest(){return (await loadJourneyStateFromLibrary()).meanings.length;},
    async loseNextInboxResolveResponseForTest(intakeId){
      const {semanticIntakeModule}=await import('./experience/personalMeaningJourney/gateway');
      const resolve=semanticIntakeModule.resolve.bind(semanticIntakeModule);
      semanticIntakeModule.resolve=async command=>{
        if(command.intakeId!==intakeId)return resolve(command);
        const result=await resolve(command);semanticIntakeModule.resolve=resolve;
        if(result.route!=='fast_track')throw new Error('fixture expected committed Meaning');
        throw new Error('fixture lost committed result');
      };
    },
    async appendInboxContextForTest(intakeId,text){
      const {createJourneyGateway}=await import('./experience/personalMeaningJourney/gateway');
      await createJourneyGateway().addClarificationMaterial(crypto.randomUUID(),intakeId,{kind:'text',bodyText:text});
    },
    async hideInboxMediaForTest(mediaId){
      if(hiddenInboxMedia)throw new Error('one media fault at a time');
      await restoreLibraryTransaction(async tx=>{const row=await tx.get<import('./data/library/media').StoredMedia>('media',mediaId);if(!row)throw new Error('fixture media missing');hiddenInboxMedia=row;tx.delete('media',mediaId);});
    },
    async restoreInboxMediaForTest(){
      const row=hiddenInboxMedia;if(!row)throw new Error('no held media');
      await restoreLibraryTransaction(async tx=>tx.put('media',row.mediaId,row));hiddenInboxMedia=undefined;
    },
    async seedInboxForTest(payload,media){
      const {createJourneyModules}=await import('./experience/personalMeaningJourney/gateway');
      if(media){const {stageMedia}=await import('./experience/personalMeaningJourney/mediaStore');stageMedia(media);}
      const result=await createJourneyModules().semanticIntake.submit(payload);
      if(result.route!=='inbox')throw new Error('fixture requires an incomplete or unaccepted tuple');
      return result.intakeId;
    },
    async holdWorldInboxReadsForTest(){
      if(releaseInboxReads)throw new Error('Inbox read fixture is already held');
      const {worldReadRepository}=await import('./experience/personalMeaningJourney/worldRepository');
      const original=worldReadRepository.inbox;let resume!:(fail:boolean)=>void;
      const held=new Promise<boolean>(resolve=>{resume=resolve;});
      worldReadRepository.inbox=async()=>{if(await held)throw new Error('fixture-inbox-read-failure');return original();};
      releaseInboxReads=(fail=false)=>{worldReadRepository.inbox=original;resume(fail);releaseInboxReads=undefined;};
    },
    releaseWorldInboxReadsForTest(fail){releaseInboxReads?.(fail);},
    async holdWorldDetailReadsForTest(){
      if(releaseWorldReads)throw new Error('World read fixture is already held');
      const {worldReadRepository}=await import('./experience/personalMeaningJourney/worldRepository');
      const original=worldReadRepository.detail;
      let resume:()=>void=()=>{};
      const held=new Promise<void>(resolve=>{resume=resolve;});
      worldReadRepository.detail=async id=>{await held;return original(id);};
      releaseWorldReads=()=>{worldReadRepository.detail=original;resume();releaseWorldReads=undefined;};
    },
    releaseWorldDetailReadsForTest(){releaseWorldReads?.();},
    async notifyWorldReadForTest(){
      // A coarse semantic invalidation hint, not an unrelated meta write.
      // It forces a coherent reread without manufacturing learner facts.
      window.dispatchEvent(new CustomEvent('sensa-library-changed',{detail:{tables:['semanticMeanings']}}));
    },
    async reviseMeaningContextForTest(id,text){
      const [{worldReadRepository},{createJourneyGateway}]=await Promise.all([
        import('./experience/personalMeaningJourney/worldRepository'),import('./experience/personalMeaningJourney/gateway'),
      ]);
      const source=await worldReadRepository.detail(id);if(!source.detail)throw new Error('Missing fixture Meaning');
      // Separate command gateway, like a foreign writer. No provider/model or
      // fabricated fact: the actual command validates and commits the revision.
      await createJourneyGateway().reviseContext({operationId:crypto.randomUUID(),personalMeaningId:id,expectedRevision:source.detail.revision,blocks:[{kind:'text',bodyText:text}]});
    },
    async appendIntakeMaterialForTest(text){
      const {createJourneyGateway}=await import('./experience/personalMeaningJourney/gateway');
      const rows=await readLibrary(tx=>tx.entries('semanticInbox'));
      if(rows.length!==1)throw new Error('This browser fixture requires exactly one pending Intake');
      const id=(rows[0]!.value as JourneyState['inboxItems'][number]).intakeId;
      await createJourneyGateway().addClarificationMaterial(crypto.randomUUID(),id,{kind:'text',bodyText:text});return id;
    },
    async semanticMediaCheckpoint(){return readLibrary(async tx=>(await tx.entries('media')).map(row=>({mediaId:row.value.mediaId as string,dataUrl:row.value.dataUrl as string})));},
    async seedSemanticWorld(state){
      // Browser-test setup only: validate actual domain facts and use the same
      // atomic repository as the application. Never overwrite a populated World.
      const [{LibraryJourneyRepository},{assertPersonalSemanticWorldState}]=await Promise.all([
        import('./experience/personalMeaningJourney/repository'),import('./experience/personalMeaningJourney/authority'),
      ]);
      assertPersonalSemanticWorldState(state);
      const repository=new LibraryJourneyRepository(),before=await repository.load();
      if(before.meanings.length||before.inboxItems.length||Object.values(before.registry).some(rows=>rows.length))throw new Error('semantic scale setup requires an empty isolated World');
      await repository.commit({before,after:state});return state.meanings.length;
    },
    async discardPackageCacheForRecoveryTest(){
      // Fault injection only: learner facts and installation identities remain.
      await writeLibraryCache(async tx=>{tx.clear('packageCache');});
    },
    async supplyCheckpoint() {
      const {contentSupplySystem}=await import('./contentSupply/system');
      const snapshot=await contentSupplySystem.read({kind:'workspace'});
      return snapshot.packages.map(pack=>({
        key:pack.key,packageId:pack.portableOrigin.manifest.metadata.packageId,
        version:pack.portableOrigin.manifest.metadata.version,
        bookDigests:pack.portableOrigin.publications.map(publication=>publication.bookArchiveSha256),
      })).sort((left,right)=>left.key.localeCompare(right.key));
    },
    async portablePackageDigestForTest(packageKey){
      // Read-only roundtrip through the public export boundary: this hydrates
      // the real stored media and validates the original Portable identity.
      const {contentSupplySystem}=await import('./contentSupply/system');
      const {bytes}=await contentSupplySystem.execute({kind:'export_portable_package',packageKey});
      const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
      return {sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),byteLength:bytes.byteLength};
    },
    async bookProvenanceCheckpointForTest(){
      return readLibrary(async tx=>({
        installations:(await tx.all<import('./data/library/packageRecords').PackageInstallation>('packageInstallations')).sort((a,b)=>a.key.localeCompare(b.key)),
        cache:(await tx.packageCacheProjection({kind:'summaries'})).map(pack=>({key:pack.key,publications:pack.portableOrigin.publications.map(publication=>({archiveSha256:publication.bookArchiveSha256,memberIndex:publication.memberIndex??null})).sort((a,b)=>a.archiveSha256.localeCompare(b.archiveSha256))})),
        identities:await tx.packageCacheProjection({kind:'publication_identities'}),
      }));
    },
    async curriculumSourceCheckpointForTest(){
      // Read-only assertions over actual UI admissions/actions; never seed facts.
      return readLibrary(async tx=>({
        targets:await tx.all<import('./learning/runtime/localProtocol').LocalLearningTarget>('learningTargets'),
        runs:await tx.all<import('./learning/runtime/localProtocol').LocalLearningRun>('learningRuns'),
      }));
    },
    async learningArrangementCheckpointForTest(){
      // Read only: all arrangements being checked were created through the UI.
      return readLibrary(async tx=>{
        const id=await tx.get<string>('meta','learning-session-active');
        const session=id?await tx.get<import('./data/library/studyScopes').LocalLearningSession>('learningSessions',id)??null:null;
        const active=await tx.get<string>('meta','learning-active'),run=active?await tx.get<import('./learning/runtime/localProtocol').LocalLearningRun>('learningRuns',active):null;
        return {session,scope:session?await tx.get<import('./data/library/studyScopes').LocalStudyScope>('studyScopes',session.scopeRevisionId)??null:null,runScope:run?.studyScopeRevisionId?await tx.get<import('./data/library/studyScopes').LocalStudyScope>('studyScopes',run.studyScopeRevisionId)??null:null};
      });
    },
    async learningActivityRecordForTest(runId){
      return readLibrary(async tx=>{const run=await tx.get<import('./learning/runtime/localProtocol').LocalLearningRun>('learningRuns',runId)??null;return {run,originSession:run?.learningSessionId?await tx.get<import('./data/library/studyScopes').LocalLearningSession>('learningSessions',run.learningSessionId)??null:null};});
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
    async provisioningCheckpoint(){
      const {contentSupplySystem}=await import('./contentSupply/system');
      return (await contentSupplySystem.read({kind:'provisioning_tasks'})).map(task=>({taskId:task.id,targetId:task.targetId,status:task.status,useContext:task.useContext})).sort((left,right)=>left.taskId.localeCompare(right.taskId));
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
