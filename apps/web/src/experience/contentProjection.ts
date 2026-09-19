import type { ReviewSchedule } from '@sensa/learning-kernel';
import { contentAnnotations } from '../data/library/contentAnnotations';
import type { SensaExpressionType } from '@sensa/contracts/sensa';
import type { RuntimeLearningContent } from '../learning/content/learningCatalog';
import { BUNDLED_PACKAGE_BY_SENSE } from '../learning/content/bundledLearningContent';
import { PRACTICE_SENSES, type PracticeSenseItem } from './practiceData';
import { journeyGateway } from './personalMeaningJourney/gateway';
import type { PersonalMeaningJourneyPhase } from './personalMeaningJourney/types';
import type { LocalLearningTarget } from '../learning/runtime/localProtocol';
import {hasDeclaredMasteryOverride} from '../learning/runtime/targetPlanningOverrides';
import type {ContentSectionId} from './contentRoute';
export {CONTENT_SECTION_IDS,isContentSectionId,type ContentSectionId} from './contentRoute';

export type SemanticStatus = 'forming' | 'established' | 'reinforce';

export interface SemanticGroundProjection {
  labelL1: string;
  bridgeL1: string;
  experienceL1: string;
  featureLabelsL1: string[];
}

export interface SemanticWordExpressionProjection {
  kind: 'word';
  formL2: string;
  partOfSpeech: string;
  ipa: string;
}

export interface SemanticPersonalAnchorPreview {
  anchorId: string;
  body: string;
  imageDataUrl: string | null;
  imageAltText: string;
}

export interface SemanticPersonalProjection {
  anchorCount: number;
  latestAnchor: SemanticPersonalAnchorPreview | null;
  notePreview: string | null;
}

export interface SemanticSenseItem {
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
  sense: PracticeSenseItem;
}

export interface SavedExampleItem {
  exampleId: string;
  sense: PracticeSenseItem;
}

export interface ContentProjectionSnapshot {
  recent: PracticeSenseItem[];
  learned: PracticeSenseItem[];
  known: PracticeSenseItem[];
  savedSenses: PracticeSenseItem[];
  savedExamples: SavedExampleItem[];
  notes: ContentNoteItem[];
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
): SemanticSenseItem => {
  const anchors = contentAnnotations.getSemanticAnchors(content.senseKey);
  const latestAnchor = anchors[0] ?? null;
  const latestMedia = latestAnchor?.media[0] ?? null;
  const note = contentAnnotations.getSenseNote(content.senseKey).trim();

  return {
    senseId: content.senseKey,
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
      anchorCount: anchors.length,
      latestAnchor: latestAnchor
        ? {
            anchorId: latestAnchor.anchorId,
            body: latestAnchor.body,
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
export const buildContentProjection = (
  targets: readonly LocalLearningTarget[] = [],
): ContentProjectionSnapshot => {
  const now = Date.now();

  const learnedWithState = targets
    .flatMap((target) => {
      if (!target.memory) return [];
      const item = unambiguousSense(target.identity.senseId);
      return item ? [{ item, target, schedule: target.memory }] : [];
    })
    .sort((left, right) => (
      right.schedule.fsrsLastReviewedAt.getTime()
      - left.schedule.fsrsLastReviewedAt.getTime()
    ))
    .filter((entry, index, all) => (
      all.findIndex((candidate) => candidate.item.senseId === entry.item.senseId) === index
    ));

  const learned = learnedWithState.map((entry) => entry.item);
  const semanticSenses = learnedWithState
    .flatMap(({ target, schedule }) => {
      const pkg = BUNDLED_PACKAGE_BY_SENSE.get(target.identity.senseId);
      return pkg ? [projectSemanticSense(pkg.content, schedule, now)] : [];
    })
    .sort((left, right) => right.lastReview - left.lastReview);
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
  const declaredMasterySenseIds = new Set(
    targets.filter(hasDeclaredMasteryOverride).map((target) => target.identity.senseId),
  );
  const known = PRACTICE_SENSES.filter((item) => declaredMasterySenseIds.has(item.senseId));

  const savedSenseIds = contentAnnotations.getSavedSenseIds();
  const savedExampleIds = contentAnnotations.getSavedExampleIds();
  const savedSenses = PRACTICE_SENSES.filter((item) => savedSenseIds.has(item.senseId));
  const savedExamples = PRACTICE_SENSES
    .map((sense) => ({ exampleId: exampleIdForSense(sense), sense }))
    .filter((item) => savedExampleIds.has(item.exampleId));

  const senseNotes: ContentNoteItem[] = Object.entries(contentAnnotations.getAllSenseNotes())
    .flatMap(([senseId, body]) => {
      const sense = sensesById.get(senseId);
      if (!sense || !body.trim()) return [];
      return [{
        noteId: `sense-note:${senseId}`,
        word: sense.word,
        body,
        sense,
      }];
    });

  return {
    recent: learned.slice(0, 8),
    learned,
    known,
    savedSenses,
    savedExamples,
    notes: senseNotes,
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
