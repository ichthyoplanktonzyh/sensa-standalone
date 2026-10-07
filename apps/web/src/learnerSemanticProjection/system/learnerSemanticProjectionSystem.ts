import { personalContentSystem } from '../../personalContent/system';
import type { SensaExpressionType } from '@sensa/contracts/sensa';
import type { RuntimeLearningContent } from '../../learning/content/learningCatalog';
import { BUNDLED_PACKAGE_BY_SENSE } from '../../learning/content/bundledLearningContent';
import { PRACTICE_SENSES, type PracticeSenseItem } from '../../experience/practiceData';
import { journeyGateway } from '../../experience/personalMeaningJourney/gateway';
import {worldReadRepository} from '../../experience/personalMeaningJourney/worldRepository';
import type {WorldBrowseItem} from '../../experience/personalMeaningJourney/worldRead';
import type { PersonalMeaningJourneyPhase } from '../../experience/personalMeaningJourney/types';
import { subscribeAll } from '../../experience/services/createSnapshotStore';
import {
  learningSystem,
  type LearningSemanticMemoryProjection,
} from '../../learning/system';
import type {ContentSectionId} from '../../experience/contentRoute';
export {CONTENT_SECTION_IDS,isContentSectionId,type ContentSectionId} from '../../experience/contentRoute';

type SemanticMemoryTarget = LearningSemanticMemoryProjection['targets'][number];
type ReviewSchedule = NonNullable<SemanticMemoryTarget['memory']>;

export type SemanticStatus = 'forming' | 'established' | 'reinforce';

export interface SemanticGroundProjection {
  labelL1: string;
  bridgeL1: string;
  experienceL1: string;
  featureLabelsL1: string[];
}

export interface SemanticWordExpressionProjection {
  kind: 'word' | 'expression';
  formL2: string;
  partOfSpeech: string;
  ipa: string;
}

export interface SemanticPersonalContextPreview {
  contextId: string;
  body: string;
  imageDataUrl: string | null;
  imageAltText: string;
}

export interface SemanticPersonalProjection {
  contextCount: number;
  latestContext: SemanticPersonalContextPreview | null;
  notePreview: string | null;
}

export interface SemanticSenseItem {
  targetId?: string;
  senseId: string;
  status: SemanticStatus;
  lastReview: number;
  ground: SemanticGroundProjection;
  expression: SemanticWordExpressionProjection;
  personal: SemanticPersonalProjection;
}

export interface PersonalSemanticRegionItem {
  regionId: string;
  name: string;
  personalMeaningCount: number;
}

export interface PersonalMeaningItem {
  personalMeaningId: string;
  primaryLabel: string;
  regionId: string | null;
  regionName: string | null;
  /**
   * Journey phase, DERIVED from journey facts (never a stored status). Freshly
   * created Personal Meanings read as `unclarified` until clarification begins.
   */
  phase: PersonalMeaningJourneyPhase;
  familiarExpressions: Array<{
    personalExpressionAnchorId: string;
    expressionType: SensaExpressionType;
    surfaceForm: string;
  }>;
  semanticAnchors: Array<{
    personalSemanticAnchorId: string;
    anchorKind: 'scene';
    bodyText: string;
  }>;
  confirmedSenseCount: number;
  confirmedExpressionCount: number;
  updatedAt: number;
}

export interface ContentNoteItem {
  noteId: string;
  word: string;
  body: string;
  reference: ContentSenseReference;
}

export interface SavedExampleItem {
  exampleId: string;
  sense: PracticeSenseItem;
}

export interface PersonalMeaningReferenceItem {
  personalMeaningId: string;
  personalMeaningAlignmentId?: string;
  historical?: boolean;
  primary?: boolean;
  senseId: string;
  word: string;
  meaning: string;
}

export interface LearningContentReference {
  targetId: string;
  senseId: string;
  word: string;
  meaning: string;
}
export type ContentSenseReference =
  | (PersonalMeaningReferenceItem & {kind:'personal_meaning'})
  | (LearningContentReference & {kind:'learning_target'})
  | {kind:'practice';senseId:string;word:string;meaning:string;practice:PracticeSenseItem};

export interface LearnerSemanticProjectionSnapshot {
  recent: ContentSenseReference[];
  learned: ContentSenseReference[];
  known: ContentSenseReference[];
  savedSenses: ContentSenseReference[];
  savedExamples: SavedExampleItem[];
  /** Retained owner annotations, including unavailable original sources. */
  savedExampleCount: number;
  notes: ContentNoteItem[];
  learningStatus: 'loading' | 'ready' | 'error';
  annotationStatus: 'loading' | 'ready' | 'error';
  personalReferenceStatus: 'loading' | 'ready' | 'error';
  semanticSenses: SemanticSenseItem[];
  personalSemanticRegions: PersonalSemanticRegionItem[];
  personalMeanings: PersonalMeaningItem[];
}

/** Return the exact immutable Example identity selected by the Package manifest. */
export const exampleIdForSense = (item: PracticeSenseItem): string => item.example.exampleId;

const sensesByWordId = new Map<string, PracticeSenseItem[]>();
const sensesById = new Map<string, PracticeSenseItem>();

PRACTICE_SENSES.forEach((item) => {
  sensesById.set(item.senseId, item);
  const byId = sensesByWordId.get(item.wordId) || [];
  byId.push(item);
  sensesByWordId.set(item.wordId, byId);
});

const unambiguousSense = (id: string): PracticeSenseItem | undefined => {
  const exact = sensesById.get(id);
  if (exact) return exact;

  const matches = sensesByWordId.get(id) || [];
  return matches.length === 1 ? matches[0] : undefined;
};

export const contentSenseForId = (senseId: string): PracticeSenseItem | null =>
  sensesById.get(senseId) ?? null;

const semanticStatusFor = (schedule: ReviewSchedule, now: number): SemanticStatus => {
  if (
    schedule.fsrsCardState === 'relearning'
    || schedule.dueAt.getTime() <= new Date(now).setHours(23, 59, 59, 999)
  ) {
    return 'reinforce';
  }
  if (schedule.reps >= 3 && schedule.fsrsStability >= 3) return 'established';
  return 'forming';
};

const experiencePreviewFor = (content: RuntimeLearningContent): string => {
  if (content.experience.kind === 'text') return content.experience.sceneL1;
  return content.experience.fallbackTextSceneL1 ?? content.experience.stageCaptionL1;
};

const projectSemanticSense = (
  content: RuntimeLearningContent,
  schedule: ReviewSchedule,
  now: number,
  senseId: string,
  targetId: string,
): SemanticSenseItem => {
  const personal = personalContentSystem.read({ kind: 'sense', senseId });
  const latestContext = personal.contexts[0] ?? null;
  const latestMedia = latestContext?.media[0] ?? null;
  const note = personal.note.trim();

  return {
    senseId, targetId,
    status: semanticStatusFor(schedule, now),
    lastReview: schedule.fsrsLastReviewedAt.getTime(),
    ground: {
      labelL1: content.guideLabelL1,
      bridgeL1: content.l1Bridge,
      experienceL1: experiencePreviewFor(content),
      featureLabelsL1: content.meaningToFormRecall.cueFeatureLabelsL1,
    },
    expression: {
      kind: 'word',
      formL2: content.lemma,
      partOfSpeech: content.partOfSpeech,
      ipa: content.ipa,
    },
    personal: {
      contextCount: personal.contexts.length,
      latestContext: latestContext
        ? {
            contextId: latestContext.contextId,
            body: latestContext.body,
            imageDataUrl: latestMedia?.dataUrl ?? null,
            imageAltText: latestMedia?.altText || latestMedia?.fileName || '我的场景图片',
          }
        : null,
      notePreview: note || null,
    },
  };
};

/**
 * Build My Content and My Semantic World from the authoritative local Library.
 * Only committed Memory State and explicit declared-mastery facts can create
 * learned/known projections. Browsing the bundled practice catalog never does.
 */
export const buildLearnerSemanticProjection = (
  targets: readonly SemanticMemoryTarget[] = [],
  references: readonly WorldBrowseItem[] = [],
  personalReferenceStatus: LearnerSemanticProjectionSnapshot['personalReferenceStatus'] = 'ready',
  learningStatus: LearnerSemanticProjectionSnapshot['learningStatus'] = 'ready',
): LearnerSemanticProjectionSnapshot => {
  const now = Date.now();

  const sortedTargets=[...targets].sort((a,b)=>(b.memory?.fsrsLastReviewedAt.getTime()??0)-(a.memory?.fsrsLastReviewedAt.getTime()??0)||a.targetId.localeCompare(b.targetId));
  const uniqueTargets=new Map<string,SemanticMemoryTarget>();
  for(const target of sortedTargets){
    if(!uniqueTargets.has(target.senseId))uniqueTargets.set(target.senseId,target);
  }
  const learnedTargets=sortedTargets.filter(target=>!!target.memory);
  const learnedWithState = learnedTargets
    .flatMap((target) => {
      if (!target.memory) return [];
      const item = unambiguousSense(target.senseId);
      return item ? [{ item, target, schedule: target.memory }] : [];
    })
    .sort((left, right) => (
      right.schedule.fsrsLastReviewedAt.getTime()
      - left.schedule.fsrsLastReviewedAt.getTime()
    ))
    ;

  const semanticSenses = learnedWithState
    .flatMap(({ target, schedule }) => {
      const pkg = BUNDLED_PACKAGE_BY_SENSE.get(target.senseId);
      return pkg ? [projectSemanticSense(pkg.content, schedule, now, target.senseId, target.targetId)] : [];
    })
    ;
  for(const target of learnedTargets){
    if(unambiguousSense(target.senseId))continue;
    const personal=personalContentSystem.read({kind:'sense',senseId:target.senseId}),latest=personal.contexts[0],media=latest?.media[0],presentation=target.presentation;
    semanticSenses.push({senseId:target.senseId,targetId:target.targetId,status:semanticStatusFor(target.memory!,now),lastReview:target.memory!.fsrsLastReviewedAt.getTime(),
      ground:{labelL1:presentation.meaning,bridgeL1:presentation.meaning,experienceL1:presentation.scene,featureLabelsL1:[]},
      expression:{kind:'expression',formL2:presentation.expression,partOfSpeech:'',ipa:''},
      personal:{contextCount:personal.contexts.length,notePreview:personal.note||null,latestContext:latest?{contextId:latest.contextId,body:latest.body,imageDataUrl:media?.dataUrl??null,imageAltText:media?.altText??''}:null}});
  }
  semanticSenses.sort((a,b)=>b.lastReview-a.lastReview||a.senseId.localeCompare(b.senseId));
  // v2 Personal Meanings are not assigned to legacy prototype regions. Keep
  // the region projection empty until a server-owned grouping contract exists;
  // the map will place all gateway items in its explicit ungrouped zone.
  const personalSemanticRegions: PersonalSemanticRegionItem[] = [];
  // The v2 gateway owns both identity and Anchor facts. Do not merge the
  // legacy PersonalContentService collection here: doing so would reintroduce
  // two Personal Meaning identities into the world/map projection.
  const personalMeaningItems = journeyGateway.getListItems().map((item) => ({
    personalMeaningId: item.personalMeaningId,
    primaryLabel: item.primaryLabel,
    regionId: null,
    regionName: null,
    phase: item.phase,
    familiarExpressions: item.familiarAnchors.map((anchor) => ({
      personalExpressionAnchorId: anchor.anchorId,
      expressionType: anchor.expressionType,
      surfaceForm: anchor.surfaceForm,
    })),
    semanticAnchors: item.experienceAnchors.map((anchor) => ({
      personalSemanticAnchorId: anchor.anchorId,
      anchorKind: 'scene' as const,
      bodyText: anchor.surfaceForm,
    })),
    confirmedSenseCount: item.confirmedSenseCount,
    confirmedExpressionCount: item.confirmedExpressionCount,
    updatedAt: Date.parse(item.updatedAt),
  }));

  const personalContent = personalContentSystem.read({ kind: 'snapshot' });
  const savedSenseIds = personalContent.savedSenseIds;
  const savedExampleIds = personalContent.savedExampleIds;
  const savedExamples = PRACTICE_SENSES
    .map((sense) => ({ exampleId: exampleIdForSense(sense), sense }))
    .filter((item) => savedExampleIds.has(item.exampleId));

  // Personal meanings are not practice items: no fabricated Example, Word or
  // Memory State. Resolve only annotated IDs through the indexed World read.
  const personalReferences = new Map<string, PersonalMeaningReferenceItem>();
  for (const item of references) for (const [index,reference] of (item.references ?? (item.senseIds??[]).map(senseId=>({senseId,word:item.label,meaning:item.primaryLabel,historical:false}))).entries()) {
    if (item.status !== 'active' || sensesById.has(reference.senseId)) continue;
    const previous=personalReferences.get(reference.senseId);
    if(previous&&!previous.historical)continue;
    personalReferences.set(reference.senseId, {personalMeaningId:item.personalMeaningId,...reference,primary:index===0&&!reference.historical});
  }
  const learningReference=(target:SemanticMemoryTarget):ContentSenseReference=>({kind:'learning_target',targetId:target.targetId,senseId:target.senseId,word:target.presentation.expression,meaning:target.presentation.meaning});
  const referenceFor=(senseId:string):ContentSenseReference|null=>{
    const practice=sensesById.get(senseId);if(practice)return {kind:'practice',senseId,word:practice.word,meaning:practice.meaning,practice};
    const personal=personalReferences.get(senseId);if(personal)return {kind:'personal_meaning',...personal};
    const target=uniqueTargets.get(senseId);
    // A retained historical personal Target must not reconstruct a deleted
    // Meaning in the default markers list. Learning history remains separate.
    return target&&!target.presentation.personalMeaningId?learningReference(target):null;
  };
  const savedSenses=[...savedSenseIds].flatMap(id=>{const reference=referenceFor(id);return reference?[reference]:[];});
  const notes:ContentNoteItem[]=Object.entries(personalContent.senseNotes).flatMap(([senseId,body])=>{const reference=referenceFor(senseId);return reference&&body.trim()?[{noteId:`sense-note:${senseId}`,word:reference.word,body,reference}]:[];});
  const learned=learnedTargets.map(learningReference);
  const known=sortedTargets.filter(target=>target.declaredMastery).map(learningReference);

  return {
    recent: learned.slice(0,8),
    learned,
    known,
    savedSenses,
    savedExamples,
    savedExampleCount:savedExampleIds.size,
    notes,learningStatus,annotationStatus:personalContent.status,
    personalReferenceStatus:personalContent.status!=='ready'?personalContent.status:personalReferenceStatus==='ready'?learningStatus:personalReferenceStatus,
    semanticSenses,
    personalSemanticRegions,
    personalMeanings: personalMeaningItems,
  };
};

export const contentSectionMeta: Record<ContentSectionId, { title: string; description: string }> = {
  recent: { title: '最近学过', description: '按最近一次学习事实排列，只展示能定位到具体意思的内容。' },
  learned: { title: '全部已学', description: '已经开始形成记忆的意思；浏览不会改变学习状态。' },
  known: { title: '已会的意思', description: '你明确标记为已会的意思，可以回看，不代表整词已掌握。' },
  'saved-senses': { title: '收藏的意思', description: '稍后想再看的具体意思；收藏不会自动加入学习。' },
  'saved-examples': { title: '收藏的例句', description: '你保存的学习例句，与其对应的具体意思保持关联。' },
  notes: { title: '我的笔记', description: '自己的理解和提醒，每条笔记都对应一个具体意思。' },
};

export const semanticStatusLabel: Record<SemanticStatus, string> = {
  forming: '正在形成',
  established: '已经建立',
  reinforce: '需要巩固',
};

export interface LearnerSemanticProjectionSystem {
  /** A stable, derived snapshot. It never accepts commands or owns source facts. */
  read(): LearnerSemanticProjectionSnapshot;
  subscribe(listener: () => void): () => void;
  retryReferences(): void;
}

const projectionStore = (() => {
  let targets: readonly SemanticMemoryTarget[] = [];
  let references: readonly WorldBrowseItem[] = [];
  let referenceStatus: LearnerSemanticProjectionSnapshot['personalReferenceStatus'] = 'loading';
  let learningStatus: LearnerSemanticProjectionSnapshot['learningStatus'] = 'loading';
  let snapshot = buildLearnerSemanticProjection(targets, [], referenceStatus, learningStatus);
  let stopSources: (() => void) | null = null;
  let loadRevision = 0;
  let referenceRevision = 0;
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = buildLearnerSemanticProjection(targets, references, referenceStatus, learningStatus);
    for (const listener of listeners) listener();
  };

  const loadReferences = async () => {
    const revision=++referenceRevision;
    const personal=personalContentSystem.read({kind:'snapshot'});
    if(personal.status!=='ready'){referenceStatus=personal.status;publish();return;}
    const ids=[...new Set([...personal.savedSenseIds,...Object.keys(personal.senseNotes)])].filter(id=>!sensesById.has(id));
    referenceStatus=ids.length?'loading':'ready';
    if(!ids.length){references=[];publish();return;}
    publish();
    try {
      const result=await worldReadRepository.references(ids);
      if(revision!==referenceRevision)return;
      references=result;referenceStatus='ready';publish();
    } catch {
      if(revision!==referenceRevision)return;
      referenceStatus='error';publish();
    }
  };

  const loadLearningTargets = async () => {
    const revision = ++loadRevision;
    learningStatus='loading';publish();
    try {
      const nextTargets = await learningSystem.read({ kind: 'semantic_memory' });
      if (revision !== loadRevision) return;
      targets = nextTargets.targets;
      learningStatus='ready';
      publish();
    } catch {
      if(revision!==loadRevision)return;
      learningStatus='error';publish();
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      stopSources = subscribeAll([
        (onChange) => learningSystem.subscribe(
          { kind: 'semantic_memory' },
          () => { void loadLearningTargets(); },
        ),
        () => personalContentSystem.subscribe({ kind: 'snapshot' }, () => {void loadReferences();}),
        () => worldReadRepository.subscribe(() => {void loadReferences();}),
        (onChange) => journeyGateway.subscribe(onChange),
      ])(publish);
      void loadLearningTargets();
      void loadReferences();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopSources?.();
        stopSources = null;
      }
    };
  };

  return { read: () => snapshot, subscribe, retryReferences: () => {void personalContentSystem.refresh().then(()=>{void loadReferences();void loadLearningTargets();}).catch(()=>undefined);} };
})();

export const learnerSemanticProjectionSystem: LearnerSemanticProjectionSystem = projectionStore;
