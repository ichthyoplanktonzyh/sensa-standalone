import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from 'react';
import type {
  Word,
  FormalLearningStage,
} from './types';
import { useLearnQueue } from './engine/useLearnQueue';
import { useReviewQueue } from './engine/useReviewQueue';
import type {
  RetentionRuntimeTargetStatus,
  ReviewRuntimeEffect,
} from './engine/ReviewQueue';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
  ReviewMemoryOutcome,
} from './review/types';
import { resolveReviewMemoryOutcome } from './review/types';
import { storageService } from './services/storageService';
import { lookupDictionaryEntry } from './services/quickDict';
import { personalContentService } from './services/personalContentService';
import { IconSprite } from './components/IconSprite';
import { HomeScreen } from './components/HomeScreen';
import { AcademyScreen } from './components/AcademyScreen';
import {
  PortableListeningScreen,
} from './components/PortableListeningScreen';
import {
  RealWorldListeningScreen,
} from './components/RealWorldListeningScreen';
import { YouGlishListeningScreen } from './components/YouGlishListeningScreen';
import { ContentScreen } from './components/ContentScreen';
import { ContentLibraryScreen } from './components/ContentLibraryScreen';
import {
  SemanticWorldScreen,
} from './components/SemanticWorldScreen';
import { PersonalMeaningDetailScreen } from './components/PersonalMeaningDetailScreen';
import { ConfirmedSenseDetailScreen } from './components/ConfirmedSenseDetailScreen';
import { ExpressionBindingScreen } from './components/ExpressionBindingScreen';
import { ContentSenseDetailScreen } from './components/ContentSenseDetailScreen';
import { ContentExampleDetailScreen } from './components/ContentExampleDetailScreen';
import { ContentComingSoonScreen } from './components/ContentComingSoonScreen';
import { StudyScreen } from './components/StudyScreen';
import { LearningEntryScreen } from './components/learning/LearningEntryScreen';
import { LearningPolicyScreen } from './components/learning/LearningPolicyScreen';
import { LearningTargetDetailScreen } from './components/learning/LearningTargetDetailScreen';
import { LearningTargetLibraryScreen } from './components/learning/LearningTargetLibraryScreen';
import { LightweightReviewRuntimeScreen } from './components/learning/LightweightReviewRuntimeScreen';
import { LightweightRuntimeStartScreen } from './components/learning/LightweightRuntimeStartScreen';
import { StructuredRuntimeSummaryScreen } from './components/learning/StructuredRuntimeSummaryScreen';
import { StructuredRetentionSummaryScreen } from './components/learning/StructuredRetentionSummaryScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { LearnScreen } from './components/LearnScreen';
import { ExampleScreen } from './components/ExampleScreen';
import { DictDetailModal } from './components/DictDetailModal';
import { ReferenceDictionaryScreen } from './components/ReferenceDictionaryScreen';
import { ReferenceExampleViewer } from './components/ReferenceExampleViewer';
import { DictionaryPresentationProvider } from './components/DictionaryPresentationContext';
import { NoteEditorModal } from './components/NoteEditorModal';
import { SceneEditorModal } from './components/SceneEditorModal';
import { SpellingModal } from './components/SpellingModal';
import { WordListScreen } from './components/WordListScreen';
import { FinishScreen } from './components/FinishScreen';
import { StatsScreen } from './components/StatsScreen';
import { SidePanel } from './components/SidePanel';
import { DEFAULT_PRACTICE_SCOPE, type PracticeSenseItem } from './practiceData';
import {
  contentSenseForId,
  isContentSectionId,
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from './contentProjection';
import {
  PROTOTYPE_INTRODUCTION_PACKAGES,
  PROTOTYPE_LEARNING_PACKAGES,
  PROTOTYPE_PACKAGE_BY_SENSE,
  materializeReviewRepairContent,
  toWordPresentation,
} from './content/learningCatalog';
import type { PrototypeIntroductionPackage } from './content/learningCatalog';
import { materializeAssessmentResource } from './content/assessmentResources';
import type {
  LearningCapability,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  ReviewCandidate,
  RelearningCycleStage,
} from './engine/types';
import {
  PROTOTYPE_LEARNING_TARGET_ORDER,
  PROTOTYPE_LEARNING_TARGETS,
  readinessForPolicy,
  runtimePackageForTarget,
  type PrototypeLearningPolicy,
  type PrototypeLearningReadiness,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from './learningJourney/prototypeLearning';
import {
  learningPolicyProfileRegistry,
  type LearningProtocolPurpose,
} from './learningRuntime/policyProfiles';
import { learningRuntimeCoordinator } from './learningRuntime/runtimeCoordinator';
import { useShellNavigation } from './router/useShellNavigation';
import { usePresentationStore } from './stores/presentationStore';
import { useOverlayStore } from './stores/overlayStore';
import { setDailyNewCount, useDailyNewCount, useDueReviewCount } from './stores/dailyPlanStore';

type FlowType = 'learn' | 'review' | 'demo';
type RuntimeLearningStage = FormalLearningStage | 'review_repair';

type RuntimePackage = (typeof PROTOTYPE_LEARNING_PACKAGES)[number];

type LearningPolicyContext =
  | { kind: 'default' }
  | { kind: 'target'; targetId: PrototypeLearningTargetId };

type TargetPolicyMap = Partial<Record<PrototypeLearningTargetId, PrototypeLearningPolicy>>;
type TargetPreparationMap = Partial<Record<PrototypeLearningTargetId, PrototypeLearningReadiness>>;
type LightweightRetentionMap = Partial<Record<
  PrototypeLearningTargetId,
  {
    nextReviewAt: string;
    nextReviewLabel: string;
    reviewCount: number;
    lapseCount: number;
    relearning: boolean;
    lastReviewRating?: PrototypeLightweightRating;
    lastReviewedAt?: string;
  }
>>;
type InitialLearningCompletionMap = Partial<Record<
  PrototypeLearningTargetId,
  {
    completionKind: 'lightweight' | 'structured';
    completedAt: string;
    nextReviewAt: string;
    nextReviewLabel: string;
    schedulingHandoffBasis: 'study_completion' | 'acquisition_graduation';
    initialRating?: Exclude<PrototypeLightweightRating, 'again'>;
  }
>>;
type StructuredRuntimeSummary = {
  graduatedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
};
type StructuredRetentionMap = Partial<Record<
  PrototypeLearningTargetId,
  {
    lastReviewedAt: string | null;
    nextReviewAt: string;
    nextReviewLabel: string;
    reviewCount: number;
    lapseCount: number;
    lastOutcome: ReviewMemoryOutcome | null;
    relearning: boolean;
    relearningStage: RelearningCycleStage | null;
    relearningCompletedAt: string | null;
  }
>>;
type StructuredRetentionSummary = {
  retainingTargetIds: readonly PrototypeLearningTargetId[];
  relearningCompletedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
};

const LIGHTWEIGHT_REVIEW_SCHEDULE: Record<
  PrototypeLightweightRating,
  { delayMs: number; nextReviewLabel: string }
> = {
  again: { delayMs: 10 * 60 * 1000, nextReviewLabel: '10 分钟后' },
  hard: { delayMs: 24 * 60 * 60 * 1000, nextReviewLabel: '明天' },
  good: { delayMs: 3 * 24 * 60 * 60 * 1000, nextReviewLabel: '3 天后' },
};

const TARGET_ID_BY_RUNTIME_SENSE = new Map(
  PROTOTYPE_LEARNING_TARGET_ORDER.flatMap((targetId) => {
    const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
    return senseId ? [[senseId, targetId] as const] : [];
  }),
);

const DEFAULT_LEARNING_POLICY = learningPolicyProfileRegistry.list()[0]!.profileId;

function runtimeSurfaceForPolicy(
  policy: PrototypeLearningPolicy,
  purpose: LearningProtocolPurpose,
) {
  return learningRuntimeCoordinator.surfaceFor(policy, purpose);
}

function relativeReviewLabel(dueAt: number, now: number = Date.now()): string {
  const days = Math.max(0, Math.ceil((dueAt - now) / (24 * 60 * 60 * 1000)));
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

function effectivePolicyForTarget(
  targetId: PrototypeLearningTargetId,
  defaultPolicy: PrototypeLearningPolicy,
  addedTargetIds: ReadonlySet<PrototypeLearningTargetId>,
  policyByTarget: TargetPolicyMap,
  committedPolicyByTarget: TargetPolicyMap,
): PrototypeLearningPolicy {
  return committedPolicyByTarget[targetId]
    ?? policyByTarget[targetId]
    ?? (addedTargetIds.has(targetId)
      ? PROTOTYPE_LEARNING_TARGETS[targetId].policy
      : defaultPolicy);
}

function preparationForTarget(
  targetId: PrototypeLearningTargetId,
  policy: PrototypeLearningPolicy,
  preparationByTarget: TargetPreparationMap,
): PrototypeLearningReadiness {
  return preparationByTarget[targetId]
    ?? readinessForPolicy(PROTOTYPE_LEARNING_TARGETS[targetId], policy).status;
}

function stageForCapability(capability: LearningCapability): FormalLearningStage {
  switch (capability) {
    case 'introduction': return 'introduction';
    case 'contextual_recognition': return 'recognition';
    case 'meaning_to_form_recall': return 'recall';
    case 'novel_context_transfer': return 'transfer';
    case 'boundary_discrimination': return 'review_assessment';
  }
}

function reviewKindForCapability(capability: LearningCapability): ReviewAssessmentKind | null {
  switch (capability) {
    case 'contextual_recognition': return 'context_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_discrimination': return 'boundary_contrast';
    default: return null;
  }
}

export default function App() {
  /* ---------- 顶层视图模式与 Sheet 栈：真相源是 URL ---------- */
  const {
    viewMode,
    mainStack,
    params,
    setViewMode,
    goMain,
    backMain,
    resetMain,
    setMainStack,
  } = useShellNavigation();

  // 展示版本对照开关由 presentationStore 持有：写在侧栏、读在各屏，
  // 此前为此穿了十个 props 过 SidePanel。
  const semanticWorldPresentation = usePresentationStore((state) => state.semanticWorld);
  const practiceHomePresentation = usePresentationStore((state) => state.practiceHome);
  const portableListeningPresentation = usePresentationStore((state) => state.portableListening);
  const realWorldListeningPresentation = usePresentationStore((state) => state.realWorldListening);
  const dictionaryPresentation = usePresentationStore((state) => state.dictionary);

  /* ---------- 我的内容读取投影与下钻目标 ---------- */
  /**
   * 下钻目标由 URL 描述，而不是 useState 持有的对象。此前
   * selectedContentSense 存的是整个 PracticeSenseItem，深链接因此只能打开
   * sheet、打不开内容——刷新后对象就没了。URL 里只放 id，条目由 id 查回。
   */
  const contentSection: ContentSectionId = isContentSectionId(params.section)
    ? params.section
    : 'recent';
  const contentComingKind: 'scenes' | 'collections' =
    params.coming === 'collections' ? 'collections' : 'scenes';
  const personalMeaningId = params.meaningId ?? null;
  const meaningFocusId = params.focusId ?? null;
  const selectedContentSense = useMemo(
    () => (params.senseId ? contentSenseForId(params.senseId) : null),
    [params.senseId],
  );
  const selectedContentExample = useMemo(
    () => (params.exampleId ? contentSenseForId(params.exampleId) : null),
    [params.exampleId],
  );

  const openContentSection = useCallback((section: ContentSectionId) => {
    goMain('s-content-library', { section });
  }, [goMain]);

  const openContentSense = useCallback((item: PracticeSenseItem) => {
    goMain('s-content-sense', { senseId: item.senseId });
  }, [goMain]);

  const openSemanticWorldSense = useCallback((senseId: string) => {
    const item = contentSenseForId(senseId);
    if (item) openContentSense(item);
  }, [openContentSense]);

  const openPersonalMeaning = useCallback((
    nextPersonalMeaningId: string,
    nextMeaningFocusId?: string,
  ) => {
    goMain('s-personal-meaning', {
      meaningId: nextPersonalMeaningId,
      focusId: nextMeaningFocusId,
    });
  }, [goMain]);

  const openConfirmedSense = useCallback((nextPersonalMeaningId: string, nextMeaningFocusId: string) => {
    goMain('s-confirmed-sense', {
      meaningId: nextPersonalMeaningId,
      focusId: nextMeaningFocusId,
    });
  }, [goMain]);

  const openExpressionBinding = useCallback(() => {
    goMain('s-expression-binding');
  }, [goMain]);

  const openContentExample = useCallback((item: PracticeSenseItem) => {
    goMain('s-content-example', { exampleId: item.senseId });
  }, [goMain]);

  const openContentComingSoon = useCallback((kind: 'scenes' | 'collections') => {
    goMain('s-content-coming', { coming: kind });
  }, [goMain]);

  // 是否为首页纯净壁纸态（主页面且无弹层），决定状态栏与底条为浅色文字
  const isLight = viewMode === 'main' && mainStack.length === 0;

  /* ---------- 例句全屏卡独立状态 ---------- */
  const [isExampleOpen, setIsExampleOpen] = useState(false);
  const [selectedSenseIdx, setSelectedSenseIdx] = useState(0);
  const [selectedSentenceIdx, setSelectedSentenceIdx] = useState(0);

  /* ---------- 覆盖层：词典、笔记、场景、拼写、菜单、Toast ---------- */
  // 这些原本是十六个 useState，其唯一职责是让深层屏幕唤起一个浮层，
  // 因而每个 opener 都要作为 prop 一路传下去。改由 overlayStore 持有。
  const dictModalWord = useOverlayStore((state) => state.dictModalWord);
  const dictModalTab = useOverlayStore((state) => state.dictModalTab);
  const referenceExampleDeck = useOverlayStore((state) => state.referenceExampleDeck);
  const openDictModal = useOverlayStore((state) => state.openDictModal);
  const closeDictModal = useOverlayStore((state) => state.closeDictModal);
  const setReferenceExampleDeck = useOverlayStore((state) => state.setReferenceExampleDeck);

  const noteModalWord = useOverlayStore((state) => state.noteModalWord);
  const noteModalSense = useOverlayStore((state) => state.noteModalSense);
  const openNoteEditor = useOverlayStore((state) => state.openNoteEditor);
  const closeNoteEditor = useOverlayStore((state) => state.closeNoteEditor);

  const sceneEditorTarget = useOverlayStore((state) => state.sceneEditorTarget);
  const setSceneEditorTarget = useOverlayStore((state) => state.openSceneEditor);
  const closeSceneEditor = useOverlayStore((state) => state.closeSceneEditor);

  const spellingWord = useOverlayStore((state) => state.spellingWord);
  const spellingMode = useOverlayStore((state) => state.spellingMode);
  const spellingCue = useOverlayStore((state) => state.spellingCue);
  const openSpelling = useOverlayStore((state) => state.openSpelling);
  const closeSpelling = useOverlayStore((state) => state.closeSpelling);

  const toastMsg = useOverlayStore((state) => state.toastMsg);
  const toast = useOverlayStore((state) => state.toast);

  const menuMoreOpen = useOverlayStore((state) => state.menuMoreOpen);
  const menuBookOpen = useOverlayStore((state) => state.menuBookOpen);
  const menuPersonalContent = useOverlayStore((state) => state.menuPersonalContent);
  const setMenuMoreOpen = useOverlayStore((state) => state.setMenuMoreOpen);
  const setMenuPersonalContent = useOverlayStore((state) => state.setMenuPersonalContent);
  const closeMenus = useOverlayStore((state) => state.closeMenus);

  const menuPersonalAnchors = menuPersonalContent
    ? personalContentService.getSemanticAnchors(menuPersonalContent.senseKey)
    : [];

  /* ---------- 业务状态（签到、资产、统计） ---------- */
  const [signed, setSigned] = useState(false);
  const [coins] = useState(2470);
  const [streak, setStreak] = useState(0);
  const [studyTab, setStudyTab] = useState<'a' | 'b'>('a');
  const [defaultLearningPolicy, setDefaultLearningPolicy] =
    useState<PrototypeLearningPolicy>(DEFAULT_LEARNING_POLICY);
  const [selectedLearningTargetId, setSelectedLearningTargetId] =
    useState<PrototypeLearningTargetId>('borrow-receive');
  const [learningPolicyContext, setLearningPolicyContext] =
    useState<LearningPolicyContext>({ kind: 'default' });
  const [learningPolicyByTarget, setLearningPolicyByTarget] = useState<
    TargetPolicyMap
  >({});
  const [addedLearningTargetIds, setAddedLearningTargetIds] = useState<
    ReadonlySet<PrototypeLearningTargetId>
  >(() => new Set<PrototypeLearningTargetId>(['tactful-expression', 'lend-give']));
  const [preparationByTarget, setPreparationByTarget] = useState<TargetPreparationMap>({
    'tactful-expression': 'preparing',
  });
  const [committedPolicyByTarget, setCommittedPolicyByTarget] = useState<TargetPolicyMap>({});
  const [lightweightRetentionByTarget, setLightweightRetentionByTarget] =
    useState<LightweightRetentionMap>({});
  const [initialLearningCompletionByTarget, setInitialLearningCompletionByTarget] =
    useState<InitialLearningCompletionMap>({});
  const [declaredMasterySenseIds, setDeclaredMasterySenseIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [activeStructuredTargetIds, setActiveStructuredTargetIds] =
    useState<readonly PrototypeLearningTargetId[]>([]);
  const [structuredRuntimeSummary, setStructuredRuntimeSummary] =
    useState<StructuredRuntimeSummary | null>(null);
  const [structuredRetentionByTarget, setStructuredRetentionByTarget] =
    useState<StructuredRetentionMap>({});
  const [structuredRetentionSummary, setStructuredRetentionSummary] =
    useState<StructuredRetentionSummary | null>(null);
  const [activeLightweightRuntimeTargetId, setActiveLightweightRuntimeTargetId] =
    useState<PrototypeLearningTargetId | null>(null);
  const [activeLightweightReviewTargetIds, setActiveLightweightReviewTargetIds] =
    useState<readonly PrototypeLearningTargetId[]>([]);

  const openLearningTarget = useCallback((targetId: PrototypeLearningTargetId) => {
    setSelectedLearningTargetId(targetId);
    goMain('s-learning-target');
  }, [goMain]);

  const openDefaultLearningPolicy = useCallback(() => {
    setLearningPolicyContext({ kind: 'default' });
    goMain('s-learning-policy');
  }, [goMain]);

  const openTargetLearningPolicy = useCallback(() => {
    if (committedPolicyByTarget[selectedLearningTargetId]) {
      toast('学习方式已在首次正式学习开始时锁定');
      return;
    }
    setLearningPolicyContext({ kind: 'target', targetId: selectedLearningTargetId });
    goMain('s-learning-policy');
  }, [committedPolicyByTarget, goMain, selectedLearningTargetId, toast]);

  const selectLearningPolicy = useCallback((policy: PrototypeLearningPolicy) => {
    if (learningPolicyContext.kind === 'default') {
      setDefaultLearningPolicy(policy);
      return;
    }
    if (committedPolicyByTarget[learningPolicyContext.targetId]) {
      toast('这条目标的学习方式已经锁定');
      return;
    }
    setLearningPolicyByTarget((current) => ({
      ...current,
      [learningPolicyContext.targetId]: policy,
    }));
    setPreparationByTarget((current) => ({
      ...current,
      [learningPolicyContext.targetId]: readinessForPolicy(
        PROTOTYPE_LEARNING_TARGETS[learningPolicyContext.targetId],
        policy,
      ).status,
    }));
  }, [committedPolicyByTarget, learningPolicyContext, toast]);

  const addSelectedLearningTarget = useCallback(() => {
    const selectedPolicy = learningPolicyByTarget[selectedLearningTargetId]
      ?? defaultLearningPolicy;
    setLearningPolicyByTarget((current) => ({
      ...current,
      [selectedLearningTargetId]: current[selectedLearningTargetId] ?? selectedPolicy,
    }));
    setPreparationByTarget((current) => ({
      ...current,
      [selectedLearningTargetId]: readinessForPolicy(
        PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId],
        selectedPolicy,
      ).status,
    }));
    setAddedLearningTargetIds((current) => {
      const next = new Set(current);
      next.add(selectedLearningTargetId);
      return next;
    });
    toast('已加入“我的学习”，内容会按所选方式准备');
  }, [defaultLearningPolicy, learningPolicyByTarget, selectedLearningTargetId, toast]);

  const refreshSelectedTargetPreparation = useCallback(() => {
    const selectedPolicy = effectivePolicyForTarget(
      selectedLearningTargetId,
      defaultLearningPolicy,
      addedLearningTargetIds,
      learningPolicyByTarget,
      committedPolicyByTarget,
    );
    const configured = readinessForPolicy(
      PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId],
      selectedPolicy,
    ).status;
    const nextPreparation = configured === 'preparing' ? 'ready' : configured;
    setPreparationByTarget((current) => ({
      ...current,
      [selectedLearningTargetId]: nextPreparation,
    }));
    toast(nextPreparation === 'ready' ? '内容已准备好，可以进入今日学习' : '准备状态已更新');
  }, [
    addedLearningTargetIds,
    committedPolicyByTarget,
    defaultLearningPolicy,
    learningPolicyByTarget,
    selectedLearningTargetId,
    toast,
  ]);

  const openLearningSource = useCallback(() => {
    const target = PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId];
    if (target.sourceKind === 'personal_semantic_world') {
      setMainStack(['s-semantic-world']);
      return;
    }
    setMainStack(['s-study', 's-learning-entry']);
  }, [selectedLearningTargetId]);

  const doSign = useCallback(() => {
    if (signed) {
      toast(`今天已签到　连续签到 ${Math.max(1, streak)} 天`);
      return;
    }
    setSigned(true);
    setStreak(1);
    toast('签到成功　连续签到 1 天');
  }, [signed, streak, toast]);

  /* ---------- 流程模式与每日新学词数 ---------- */
  const [flowMode, setFlowType] = useState<FlowType>('learn');
  const [demoStage, setDemoStage] = useState<FormalLearningStage>('introduction');
  const [demoWord, setDemoWord] = useState<Word | null>(null);
  const [demoPackage, setDemoPackage] = useState<RuntimePackage | null>(null);
  const [demoReviewKind, setDemoReviewKind] = useState<ReviewAssessmentKind | null>(null);
  const [demoReviewResult, setDemoReviewResult] = useState<ReviewAssessmentResult | null>(null);
  // 这两个都不是状态：一个是 settings 里的设置项，一个是 FSRS 的派生计数。
  // 它们随 storageService 的写入自动更新，所以没有 refreshReviewCount 了。
  const dailyNewCount = useDailyNewCount();
  const reviewN = useDueReviewCount();

  // Keep structured-retention handoffs created earlier in the same hot-reloaded session
  // aligned with the immediate first-Review handoff. Once a Review has been
  // settled, its scheduler-owned next due time is never touched here.
  useEffect(() => {
    const dueAt = Date.now();
    const targetIdsToAdvance = PROTOTYPE_LEARNING_TARGET_ORDER.filter((targetId) => {
      const graduation = initialLearningCompletionByTarget[targetId];
      const retention = structuredRetentionByTarget[targetId];
      const policy = committedPolicyByTarget[targetId];
      const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
      if (
        !graduation
        || !policy
        || runtimeSurfaceForPolicy(policy, 'retention_review') !== 'structured_session'
        || retention?.reviewCount
        || !senseId
      ) return false;
      if (declaredMasterySenseIds.has(senseId)) return false;
      const memory = storageService.getFSRSItems()[senseId];
      return memory !== undefined && memory.due > dueAt;
    });
    if (targetIdsToAdvance.length === 0) return;

    targetIdsToAdvance.forEach((targetId) => {
      const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId!;
      const memory = storageService.getFSRSItems()[senseId]!;
      storageService.saveFSRSItem({ ...memory, due: dueAt, scheduledDays: 0 });
    });
    setInitialLearningCompletionByTarget((current) => {
      const next = { ...current };
      targetIdsToAdvance.forEach((targetId) => {
        next[targetId] = {
          ...next[targetId]!,
          nextReviewAt: new Date(dueAt).toISOString(),
          nextReviewLabel: '现在可复习（原型）',
        };
      });
      return next;
    });
  }, [
    declaredMasterySenseIds,
    committedPolicyByTarget,
    initialLearningCompletionByTarget,
    structuredRetentionByTarget,
  ]);


  const visibleLearningTargetIds = PROTOTYPE_LEARNING_TARGET_ORDER.filter((targetId) =>
    addedLearningTargetIds.has(targetId));
  const readyInitialTargetIds = visibleLearningTargetIds.filter((targetId) => {
    if (committedPolicyByTarget[targetId]) return false;
    const runtimeSenseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
    if (runtimeSenseId && declaredMasterySenseIds.has(runtimeSenseId)) return false;
    const policy = effectivePolicyForTarget(
      targetId,
      defaultLearningPolicy,
      addedLearningTargetIds,
      learningPolicyByTarget,
      committedPolicyByTarget,
    );
    return preparationForTarget(targetId, policy, preparationByTarget) === 'ready';
  });
  const todayInitialTargetIds = readyInitialTargetIds.slice(0, dailyNewCount);
  const lightweightDueTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const completion = lightweightRetentionByTarget[targetId];
    const policy = committedPolicyByTarget[targetId];
    return policy !== undefined
      && runtimeSurfaceForPolicy(policy, 'retention_review') === 'lightweight_retention'
      && completion !== undefined
      && (completion.relearning || Date.parse(completion.nextReviewAt) <= Date.now());
  });
  const lightweightRelearningTargetIds = visibleLearningTargetIds.filter(
    (targetId) => {
      const policy = committedPolicyByTarget[targetId];
      return policy !== undefined
        && runtimeSurfaceForPolicy(policy, 'relearning') === 'lightweight_retention'
        && lightweightRetentionByTarget[targetId]?.relearning;
    },
  );

  /* ---------- 穿插调度算法引擎 (新词学习流) ---------- */
  const {
    session: learnSession,
    stats: queueStats,
    isDone: queueDone,
    start: startLearnQueue,
    completeIntroduction: completeLearnIntroduction,
    completeRecognition: completeLearnRecognition,
    completeMeaningToFormRecall: completeLearnMeaningToFormRecall,
    completeBoundary: completeLearnBoundary,
    completeNovelTransfer: completeLearnNovelTransfer,
    next: nextLearnQueue,
    undo: undoLearnQueue,
    markKnown: markKnownLearnQueue,
    setDeclaredMastery: setLearnDeclaredMastery,
    getGraduatedSenseIds,
    overrideDemo: overrideDemoQueue,
  } = useLearnQueue(PROTOTYPE_LEARNING_PACKAGES, {
    activeWindow: 3,
    minGap: 2,
  });

  // Structured Graduation creates the common Initial Completion. The committed
  // Profile then chooses which retention adapter receives the Scheduling Handoff.
  // Keep this idempotent because two render paths can observe the same settled queue.
  const persistGraduatedSenses = useCallback(() => {
    const fsrsItems = storageService.getFSRSItems();
    const graduatedSenseIds = getGraduatedSenseIds();
    graduatedSenseIds.forEach((senseId) => {
      const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(senseId);
      const policy = targetId ? committedPolicyByTarget[targetId] : undefined;
      if (
        policy
        && runtimeSurfaceForPolicy(policy, 'retention_review') === 'structured_session'
        && !fsrsItems[senseId]
      ) {
        storageService.graduateSense(senseId, 0);
      }
    });
    const memoryItems = storageService.getFSRSItems();
    const graduatedSenseIdSet = new Set(graduatedSenseIds);
    const completedAt = new Date().toISOString();
    if (activeStructuredTargetIds.length > 0) {
      setStructuredRuntimeSummary({
        graduatedTargetIds: activeStructuredTargetIds.filter((targetId) => {
          const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
          return senseId !== null && graduatedSenseIdSet.has(senseId);
        }),
        declaredMasteryTargetIds: activeStructuredTargetIds.filter((targetId) => {
          const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
          return senseId !== null && declaredMasterySenseIds.has(senseId);
        }),
      });
    }
    setInitialLearningCompletionByTarget((current) => {
      let next = current;
      PROTOTYPE_LEARNING_TARGET_ORDER.forEach((targetId) => {
        const target = PROTOTYPE_LEARNING_TARGETS[targetId];
        const policy = committedPolicyByTarget[targetId];
        if (
          current[targetId]
          || !policy
          || runtimeSurfaceForPolicy(policy, 'initial_learning') !== 'structured_session'
          || !target.runtimeSenseId
          || !graduatedSenseIdSet.has(target.runtimeSenseId)
        ) return;
        const retentionSurface = runtimeSurfaceForPolicy(policy, 'retention_review');
        const memory = retentionSurface === 'structured_session'
          ? memoryItems[target.runtimeSenseId]
          : null;
        const nextReviewAt = memory
          ? new Date(memory.due).toISOString()
          : completedAt;
        next = {
          ...next,
          [targetId]: {
            completionKind: 'structured',
            completedAt,
            nextReviewAt,
            nextReviewLabel: memory
              ? relativeReviewLabel(memory.due)
              : '现在可复习（原型）',
            schedulingHandoffBasis: 'acquisition_graduation',
          },
        };
      });
      return next;
    });
    setLightweightRetentionByTarget((current) => {
      let next = current;
      PROTOTYPE_LEARNING_TARGET_ORDER.forEach((targetId) => {
        const target = PROTOTYPE_LEARNING_TARGETS[targetId];
        const policy = committedPolicyByTarget[targetId];
        if (
          current[targetId]
          || !policy
          || runtimeSurfaceForPolicy(policy, 'initial_learning') !== 'structured_session'
          || runtimeSurfaceForPolicy(policy, 'retention_review') !== 'lightweight_retention'
          || !target.runtimeSenseId
          || !graduatedSenseIdSet.has(target.runtimeSenseId)
        ) return;
        next = {
          ...next,
          [targetId]: {
            nextReviewAt: completedAt,
            nextReviewLabel: '现在可复习（原型）',
            reviewCount: 0,
            lapseCount: 0,
            relearning: false,
          },
        };
      });
      return next;
    });
  }, [
    activeStructuredTargetIds,
    committedPolicyByTarget,
    declaredMasterySenseIds,
    getGraduatedSenseIds,
  ]);

  /* ---------- 全量到期流式复习引擎 (FSRS 复习流) ---------- */
  const onReviewEffect = useCallback((effect: ReviewRuntimeEffect<PrototypeIntroductionPackage>) => {
    storageService.applyReviewRuntimeEffect(effect);
    const senseId = effect.candidate.package.senseId;
    const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(senseId);
    if (targetId) {
      const memory = storageService.getFSRSItems()[senseId]!;
      const cycle = storageService.getRelearningCycle(senseId);
      const occurredAt = new Date().toISOString();
      setStructuredRetentionByTarget((current) => {
        const previous = current[targetId];
        return {
          ...current,
          [targetId]: {
            lastReviewedAt: effect.type === 'retention_outcome'
              ? occurredAt
              : previous?.lastReviewedAt ?? null,
            nextReviewAt: new Date(memory.due).toISOString(),
            nextReviewLabel: relativeReviewLabel(memory.due),
            reviewCount: (previous?.reviewCount ?? 0)
              + (effect.type === 'retention_outcome' ? 1 : 0),
            lapseCount: memory.lapses,
            lastOutcome: effect.type === 'retention_outcome'
              ? effect.result.memoryOutcome
              : previous?.lastOutcome ?? null,
            relearning: cycle !== null,
            relearningStage: cycle?.stage ?? null,
            relearningCompletedAt: effect.type === 'relearning_progress'
              && effect.event === 'retest_passed'
              ? occurredAt
              : previous?.relearningCompletedAt ?? null,
          },
        };
      });
    }
  }, []);
  const {
    session: reviewSession,
    stats: reviewStats,
    isDone: reviewDone,
    projection: retentionRuntimeProjection,
    start: startReviewQueue,
    settle: settleReviewQueue,
    completeRepair: completeReviewRepair,
    excludeCurrentForDeclaredMastery: excludeCurrentReviewForDeclaredMastery,
    next: nextReviewQueue,
    undo: undoReviewQueue,
  } = useReviewQueue<PrototypeIntroductionPackage>(onReviewEffect, { minGap: 2 });

  const pendingMixedTargetRef = useRef<PrototypeLearningTargetId[] | null>(null);

  const getReviewCandidates = useCallback((): ReviewCandidate<PrototypeIntroductionPackage>[] => {
    const senseIds = PROTOTYPE_LEARNING_PACKAGES.map((item) => item.senseId);
    const reviewReadySenseIds = new Set([
      ...storageService.getDueSenseIds(senseIds),
      ...storageService.getRelearningSenseIds(),
    ]);
    return [...reviewReadySenseIds].flatMap((senseId) => {
      if (declaredMasterySenseIds.has(senseId)) return [];
      const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(senseId);
      if (!targetId) return [];
      const policy = committedPolicyByTarget[targetId];
      if (!policy || runtimeSurfaceForPolicy(policy, 'retention_review') !== 'structured_session') return [];
      if (!initialLearningCompletionByTarget[targetId]) return [];
      const pkg = PROTOTYPE_PACKAGE_BY_SENSE.get(senseId);
      const item = storageService.getFSRSItems()[senseId];
      if (!pkg || !item) return [];
      const relearning = storageService.getRelearningCycle(senseId);
      return [{
        package: pkg,
        dueAt: item.due,
        reps: item.reps,
        lapses: item.lapses,
        phase: relearning || item.state === 'relearning'
          ? 'relearning' as const
          : 'retaining' as const,
        relearning,
      }];
    });
  }, [committedPolicyByTarget, declaredMasterySenseIds, initialLearningCompletionByTarget]);

  const structuredReviewCandidates = getReviewCandidates();
  const structuredReviewSenseIds = new Set(
    structuredReviewCandidates.map((candidate) => candidate.package.senseId),
  );
  const structuredReviewDueTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
    return initialLearningCompletionByTarget[targetId] !== undefined
      && senseId !== null
      && structuredReviewSenseIds.has(senseId);
  });
  const structuredRelearningSenseIds = new Set(
    structuredReviewCandidates
      .filter((candidate) => candidate.phase === 'relearning')
      .map((candidate) => candidate.package.senseId),
  );
  const structuredRelearningTargetIds = structuredReviewDueTargetIds.filter((targetId) => {
    const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
    return senseId !== null && structuredRelearningSenseIds.has(senseId);
  });
  const targetIdsForRetentionStatuses = (
    ...statuses: readonly RetentionRuntimeTargetStatus[]
  ): PrototypeLearningTargetId[] => retentionRuntimeProjection.targets.flatMap((target) => {
    const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(target.senseId);
    return targetId && statuses.includes(target.status) ? [targetId] : [];
  });
  const structuredReviewingTargetIds = targetIdsForRetentionStatuses('reviewing');
  const structuredRelearningRepairTargetIds = targetIdsForRetentionStatuses('relearning_repair');
  const structuredRelearningRetestTargetIds = targetIdsForRetentionStatuses('relearning_retest');
  const retentionRuntimeLaunches = learningRuntimeCoordinator.planRetention([
    ...lightweightDueTargetIds.map((targetId) => ({
      targetId,
      profileId: committedPolicyByTarget[targetId]!,
      ready: true,
      executable: true,
    })),
    ...structuredReviewDueTargetIds.map((targetId) => ({
      targetId,
      profileId: committedPolicyByTarget[targetId]!,
      ready: true,
      executable: true,
    })),
  ]);
  const lightweightReviewCount = retentionRuntimeLaunches
    .filter((launch) => launch.surface === 'lightweight_retention')
    .reduce((count, launch) => count + launch.targetIds.length, 0);
  const structuredReviewCount = Math.min(
    reviewN,
    retentionRuntimeLaunches
      .filter((launch) => launch.surface === 'structured_session')
      .reduce((count, launch) => count + launch.targetIds.length, 0),
  );
  const totalReviewCount = lightweightReviewCount + structuredReviewCount;

  const beginInitialTargetRuntime = useCallback((targetId: PrototypeLearningTargetId) => {
    if (!addedLearningTargetIds.has(targetId)) {
      toast('请先把这条目标加入学习');
      return false;
    }
    if (committedPolicyByTarget[targetId]) {
      toast('这条目标已经创建过首次学习运行');
      return false;
    }

    const policy = effectivePolicyForTarget(
      targetId,
      defaultLearningPolicy,
      addedLearningTargetIds,
      learningPolicyByTarget,
      committedPolicyByTarget,
    );
    const preparation = preparationForTarget(targetId, policy, preparationByTarget);
    if (preparation !== 'ready') {
      toast(preparation === 'preparing' ? '学习内容仍在准备中' : '当前学习方式还不能开始');
      return false;
    }

    closeMenus();
    setIsExampleOpen(false);
    setDemoWord(null);
    setDemoPackage(null);
    setDemoReviewKind(null);

    const initialCandidates = [...new Set([targetId, ...todayInitialTargetIds])]
      .filter((candidateId) => !committedPolicyByTarget[candidateId])
      .map((candidateId) => {
        const candidatePolicy = effectivePolicyForTarget(
          candidateId,
          defaultLearningPolicy,
          addedLearningTargetIds,
          learningPolicyByTarget,
          committedPolicyByTarget,
        );
        const runtimeSurface = runtimeSurfaceForPolicy(candidatePolicy, 'initial_learning');
        return {
          targetId: candidateId,
          profileId: candidatePolicy,
          ready: preparationForTarget(candidateId, candidatePolicy, preparationByTarget) === 'ready',
          executable: runtimeSurface !== 'structured_session'
            || runtimePackageForTarget(PROTOTYPE_LEARNING_TARGETS[candidateId]) !== null,
        };
      });
    const launch = learningRuntimeCoordinator.planInitial(targetId, initialCandidates);
    if (!launch) {
      toast('当前学习方式还不能创建首次学习运行');
      return false;
    }

    if (launch.surface === 'lightweight_initial') {
      const activeTargetId = launch.targetIds[0]!;
      setCommittedPolicyByTarget((current) => ({
        ...current,
        [activeTargetId]: initialCandidates.find(
          (candidate) => candidate.targetId === activeTargetId,
        )!.profileId,
      }));
      setActiveLightweightRuntimeTargetId(activeTargetId);
      setViewMode('lightweight');
      return true;
    }

    const structuredTargetIds = launch.targetIds;
    const runtimePackages = structuredTargetIds.map((candidateId) =>
      runtimePackageForTarget(PROTOTYPE_LEARNING_TARGETS[candidateId])!);
    if (runtimePackages.length === 0) {
      toast('当前学习方式要求的内容尚未完整接入');
      return false;
    }
    const firstSession = startLearnQueue(runtimePackages);
    if (!firstSession) {
      toast('首次学习运行创建失败');
      return false;
    }
    setCommittedPolicyByTarget((current) => {
      const next = { ...current };
      structuredTargetIds.forEach((candidateId) => {
        next[candidateId] = initialCandidates.find(
          (candidate) => candidate.targetId === candidateId,
        )!.profileId;
      });
      return next;
    });
    setActiveStructuredTargetIds(structuredTargetIds);
    setStructuredRuntimeSummary(null);
    setActiveLightweightRuntimeTargetId(null);
    setFlowType('learn');
    setViewMode('study');
    return true;
  }, [
    addedLearningTargetIds,
    closeMenus,
    committedPolicyByTarget,
    defaultLearningPolicy,
    learningPolicyByTarget,
    preparationByTarget,
    startLearnQueue,
    todayInitialTargetIds,
    toast,
  ]);

  const continueCommittedTargetRuntime = useCallback((targetId: PrototypeLearningTargetId) => {
    const committedPolicy = committedPolicyByTarget[targetId];
    if (!committedPolicy) return;
    const surface = learningRuntimeCoordinator.surfaceFor(
      committedPolicy,
      'initial_learning',
    );
    if (surface === 'lightweight_initial') {
      if (initialLearningCompletionByTarget[targetId]) {
        toast('首次学习已经完成，等待进入长期复习');
        return;
      }
      setActiveLightweightRuntimeTargetId(targetId);
      setViewMode('lightweight');
      return;
    }
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    if (target.runtimeSenseId && declaredMasterySenseIds.has(target.runtimeSenseId)) {
      toast('这条目标已声明为熟词，不再进入正式学习计划');
      return;
    }
    if (initialLearningCompletionByTarget[targetId]) {
      toast('高保证首次学习已经完成，当前处于长期保持阶段');
      return;
    }
    if (activeStructuredTargetIds.includes(targetId) && !queueDone) {
      setViewMode('study');
      return;
    }
    toast('首次学习已结束，之后会按计划进入复习');
  }, [
    activeStructuredTargetIds,
    committedPolicyByTarget,
    declaredMasterySenseIds,
    learnSession,
    initialLearningCompletionByTarget,
    queueDone,
    toast,
  ]);

  // 开始第一个可运行的 Target；运行创建成功才会提交并锁定 Policy。
  const startLearn = useCallback(() => {
    pendingMixedTargetRef.current = null;
    const nextTargetId = todayInitialTargetIds[0];
    if (!nextTargetId) {
      toast('当前没有准备完成的新学习目标');
      return;
    }
    beginInitialTargetRuntime(nextTargetId);
  }, [beginInitialTargetRuntime, todayInitialTargetIds, toast]);

  // 继续学习下一组
  const handleContinueNextGroup = useCallback(() => {
    startLearn();
  }, [startLearn]);

  const getReviewCandidatesForTargets = useCallback((
    targetIds: readonly PrototypeLearningTargetId[],
  ) => {
    const eligibleTargetIds = new Set(targetIds);
    return getReviewCandidates().filter((candidate) => {
      const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(candidate.package.senseId);
      return targetId !== undefined && eligibleTargetIds.has(targetId);
    });
  }, [getReviewCandidates]);

  // 开始真实复习流程 (全量到期流式复习)
  const startReview = useCallback(() => {
    pendingMixedTargetRef.current = null;
    closeMenus();
    setIsExampleOpen(false);
    setDemoWord(null);
    setDemoPackage(null);
    setDemoReviewKind(null);
    const launch = retentionRuntimeLaunches[0];
    if (!launch) {
      toast('今天没有到期的意思，可以开始今日学习');
      return;
    }
    if (launch.surface === 'lightweight_retention') {
      setActiveLightweightReviewTargetIds(launch.targetIds);
      setViewMode('lightweightReview');
      toast(`开始今日复习：共 ${launch.targetIds.length} 个意思`);
      return;
    }
    const dueCandidates = getReviewCandidatesForTargets(launch.targetIds);
    if (dueCandidates.length === 0) {
      toast('今天没有到期的意思，可以开始今日学习');
      return;
    }
    setFlowType('review');
    setStructuredRetentionSummary(null);
    startReviewQueue(dueCandidates);
    setViewMode('study');
    toast(`开始今日复习：共 ${dueCandidates.length} 个意思`);
  }, [closeMenus, getReviewCandidatesForTargets, retentionRuntimeLaunches, startReviewQueue, toast]);

  // MVP Mixed intent uses the same two proven runtimes in sequence: due Review
  // comes first, then ready Acquisition continues without returning home.
  const startMixedLearning = useCallback(() => {
    closeMenus();
    setIsExampleOpen(false);
    setDemoWord(null);
    setDemoPackage(null);
    setDemoReviewKind(null);

    const newTargetIds = [...todayInitialTargetIds];
    const launch = retentionRuntimeLaunches[0];

    if (launch?.surface === 'lightweight_retention') {
      pendingMixedTargetRef.current = newTargetIds.length > 0 ? newTargetIds : null;
      setActiveLightweightReviewTargetIds(launch.targetIds);
      setViewMode('lightweightReview');
      toast(`进入今日学习流：先复习 ${launch.targetIds.length} 个意思`);
      return;
    }

    if (launch?.surface === 'structured_session') {
      const dueCandidates = getReviewCandidatesForTargets(launch.targetIds);
      pendingMixedTargetRef.current = newTargetIds.length > 0 ? newTargetIds : null;
      setFlowType('review');
      setStructuredRetentionSummary(null);
      startReviewQueue(dueCandidates);
      setViewMode('study');
      toast(`进入今日学习流：先复习 ${dueCandidates.length} 个意思`);
      return;
    }

    pendingMixedTargetRef.current = null;
    if (newTargetIds[0]) {
      beginInitialTargetRuntime(newTargetIds[0]);
      return;
    }

    toast('今天的学习流已经完成，可以去自由练习');
  }, [
    beginInitialTargetRuntime,
    closeMenus,
    getReviewCandidatesForTargets,
    retentionRuntimeLaunches,
    startReviewQueue,
    todayInitialTargetIds,
    toast,
  ]);

  // 退出学习回首页
  const exitLearn = useCallback(() => {
    pendingMixedTargetRef.current = null;
    setIsExampleOpen(false);
    closeMenus();
    setDemoPackage(null);
    setViewMode('main');
    resetMain();
  }, [closeMenus, resetMain]);

  const exitLightweightRuntime = useCallback(() => {
    setViewMode('main');
    setMainStack(['s-study', 's-learning-library', 's-learning-target']);
  }, []);

  const completeLightweightRuntime = useCallback((
    rating: Exclude<PrototypeLightweightRating, 'again'>,
  ) => {
    if (!activeLightweightRuntimeTargetId) return;
    const targetId = activeLightweightRuntimeTargetId;
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    const policy = committedPolicyByTarget[targetId];
    if (!policy) return;
    const completedAt = new Date().toISOString();
    const retentionSurface = runtimeSurfaceForPolicy(policy, 'retention_review');
    let nextReviewAt = completedAt;
    let nextReviewLabel = '现在可复习（原型）';

    if (retentionSurface === 'structured_session' && target.runtimeSenseId) {
      const existing = storageService.getFSRSItems()[target.runtimeSenseId];
      const memory = existing ?? storageService.graduateSense(target.runtimeSenseId, 0);
      nextReviewAt = new Date(memory.due).toISOString();
      nextReviewLabel = relativeReviewLabel(memory.due);
    }

    setInitialLearningCompletionByTarget((current) => ({
      ...current,
      [targetId]: {
        completionKind: 'lightweight',
        completedAt,
        nextReviewAt,
        nextReviewLabel,
        schedulingHandoffBasis: 'study_completion',
        initialRating: rating,
      },
    }));
    if (retentionSurface === 'lightweight_retention') {
      setLightweightRetentionByTarget((current) => ({
        ...current,
        [targetId]: {
          nextReviewAt: completedAt,
          nextReviewLabel: '现在可复习（原型）',
          reviewCount: 0,
          lapseCount: 0,
          relearning: false,
        },
      }));
    }
  }, [activeLightweightRuntimeTargetId, committedPolicyByTarget]);

  const finishLightweightRuntime = useCallback(() => {
    setActiveLightweightRuntimeTargetId(null);
    setViewMode('main');
    resetMain();
    toast('首次学习已完成，之后会按计划进入复习');
  }, [resetMain, toast]);

  const exitLightweightReview = useCallback(() => {
    setViewMode('main');
    resetMain();
  }, [resetMain]);

  const completeLightweightReviewTarget = useCallback((
    targetId: PrototypeLearningTargetId,
    rating: PrototypeLightweightRating,
  ) => {
    const reviewedAt = new Date();
    const schedule = LIGHTWEIGHT_REVIEW_SCHEDULE[rating];
    setLightweightRetentionByTarget((current) => {
      const completion = current[targetId]!;
      return {
        ...current,
        [targetId]: {
          ...completion,
          lastReviewRating: rating,
          lastReviewedAt: reviewedAt.toISOString(),
          nextReviewAt: new Date(reviewedAt.getTime() + schedule.delayMs).toISOString(),
          nextReviewLabel: schedule.nextReviewLabel,
          reviewCount: completion.reviewCount + 1,
          lapseCount: completion.lapseCount + (rating === 'again' ? 1 : 0),
          relearning: rating === 'again',
        },
      };
    });
  }, []);

  const completeLightweightReviewRepair = useCallback((
    targetId: PrototypeLearningTargetId,
  ) => {
    setLightweightRetentionByTarget((current) => ({
      ...current,
      [targetId]: {
        ...current[targetId]!,
        relearning: false,
      },
    }));
  }, []);

  // 演示跳转：新学卡 + 长期 Review 评测目录
  const showStage = useCallback((stageNum: number) => {
    closeMenus();
    setIsExampleOpen(false);
    setViewMode('study');
    setFlowType('demo');
    setDemoReviewResult(null);

    const basePackage = PROTOTYPE_LEARNING_PACKAGES[0];
    if (!basePackage) return;
    setDemoPackage(basePackage);
    const setDemoPresentation = (level: number, isMastered = false) => {
      setDemoWord({
        ...toWordPresentation(basePackage.content),
        level,
        badge: '',
        isMastered,
      });
    };
    const boundaryPackage = PROTOTYPE_LEARNING_PACKAGES.find(
      (pkg) => pkg.content.boundaryContrast !== null,
    ) ?? basePackage;

    switch (stageNum) {
      case 1:
        setDemoStage('introduction');
        setDemoPresentation(0);
        overrideDemoQueue(basePackage, 'introduction', 1, 4);
        toast('已切换至：① 第一次遇见');
        break;
      case 2:
        setDemoStage('recognition');
        setDemoPresentation(1);
        overrideDemoQueue(basePackage, 'contextual_recognition', 2, 4);
        toast('已切换至：② 语境判断');
        break;
      case 3:
        setDemoStage('recall');
        setDemoPresentation(2);
        overrideDemoQueue(basePackage, 'meaning_to_form_recall', 3, 4);
        toast('已切换至：③ 从意思想起表达');
        break;
      case 4:
        setDemoStage('transfer');
        setDemoPresentation(3);
        overrideDemoQueue(basePackage, 'novel_context_transfer', 4, 4);
        toast('已切换至：④ 新语境迁移');
        break;
      case 9:
        setDemoStage('review_assessment');
        setDemoPresentation(4, true);
        setDemoReviewKind('context_recognition');
        overrideDemoQueue(basePackage, 'contextual_recognition', 1, 1);
        toast('已切换至：Review · 语境判断');
        break;
      case 10:
        setDemoStage('review_assessment');
        setDemoPresentation(4, true);
        setDemoReviewKind('meaning_to_form_recall');
        overrideDemoQueue(basePackage, 'meaning_to_form_recall', 1, 1);
        toast('已切换至：Review · 意思到表达');
        break;
      case 11:
        setDemoStage('review_assessment');
        setDemoPresentation(4, true);
        setDemoReviewKind('novel_context_transfer');
        overrideDemoQueue(basePackage, 'novel_context_transfer', 1, 1);
        toast('已切换至：Review · 新语境迁移');
        break;
      case 12:
        setDemoStage('review_assessment');
        setDemoPackage(boundaryPackage);
        setDemoWord({ ...toWordPresentation(boundaryPackage.content), level: 4, badge: '', isMastered: true });
        setDemoReviewKind('boundary_contrast');
        overrideDemoQueue(boundaryPackage, 'boundary_discrimination', 1, 1);
        toast('已切换至：Review · 真实边界对比');
        break;
      case 13: {
        const recognitionAction = basePackage.actions.find((action) =>
          action.capability === 'contextual_recognition' && action.taskKey,
        );
        if (!recognitionAction?.taskKey) {
          throw new Error(`Package ${basePackage.packageId} has no Recognition demo resource.`);
        }
        const recognitionResource = materializeAssessmentResource({
          packageIdentity: {
            packageKey: basePackage.packageId,
            senseKey: basePackage.senseId,
          },
          content: basePackage.content,
          taskKey: recognitionAction.taskKey,
          kind: 'context_recognition',
          capability: 'contextual_recognition',
        });
        if (recognitionResource.kind !== 'context_recognition') {
          throw new Error('Recognition demo must materialize a Recognition resource.');
        }
        const incorrectOption = recognitionResource.options.find((option) => !option.isCorrect);
        if (!incorrectOption) {
          throw new Error(`Recognition task ${recognitionResource.taskKey} has no incorrect demo option.`);
        }
        setDemoStage('review_feedback');
        setDemoPresentation(4, true);
        setDemoReviewKind('context_recognition');
        setDemoReviewResult({
          assessmentId: `${recognitionResource.taskKey}.action-assessment`,
          kind: 'context_recognition',
          focusDimension: '语境辨义',
          correct: false,
          responseId: incorrectOption.id,
          memoryOutcome: 'retrieval_failed',
          evidenceEligible: true,
        });
        overrideDemoQueue(basePackage, 'contextual_recognition', 1, 1);
        toast('已切换至：统一 Adaptive Feedback / Repair');
        break;
      }
      default:
        break;
    }
  }, [closeMenus, overrideDemoQueue, toast]);

  const handleCompleteIntroduction = useCallback(() => {
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoStage('recognition');
      setDemoWord({ ...toWordPresentation(pkg.content), level: 1, badge: '', isMastered: false });
      overrideDemoQueue(pkg, 'contextual_recognition', 2, 4);
      toast('这个义项已建立初次连接，稍后会在新语境中再次出现');
      return;
    }
    if (flowMode === 'review' && reviewSession?.action.mode === 'repair') {
      completeReviewRepair();
      return;
    }
    if (flowMode === 'learn' && learnSession?.action.mode === 'repair') {
      switch (learnSession.action.capability) {
        case 'contextual_recognition':
          completeLearnRecognition(true);
          break;
        case 'meaning_to_form_recall':
          completeLearnMeaningToFormRecall('independent');
          break;
        case 'novel_context_transfer':
          completeLearnNovelTransfer('success');
          break;
        case 'boundary_discrimination':
          completeLearnBoundary(true);
          break;
        case 'introduction':
          throw new Error('An Introduction Action cannot be an acquisition repair.');
      }
      toast('定向修复已完成，稍后会再次独立检验');
      return;
    }
    completeLearnIntroduction();
  }, [
    flowMode,
    learnSession,
    reviewSession,
    overrideDemoQueue,
    completeReviewRepair,
    completeLearnRecognition,
    completeLearnMeaningToFormRecall,
    completeLearnNovelTransfer,
    completeLearnBoundary,
    completeLearnIntroduction,
    toast,
  ]);

  const handleCompleteRecognition = useCallback((correct: boolean) => {
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoStage(correct ? 'recall' : 'recognition');
      setDemoWord({ ...toWordPresentation(pkg.content), level: correct ? 2 : 1, badge: '', isMastered: false });
      overrideDemoQueue(
        pkg,
        correct ? 'meaning_to_form_recall' : 'contextual_recognition',
        (learnSession?.index ?? 2) + 1,
        learnSession?.totalTarget ?? 4,
      );
    } else {
      completeLearnRecognition(correct);
    }
    toast(correct ? '已认出这个意思，继续学习' : '这个区别稍后会换个语境再出现');
  }, [flowMode, learnSession, overrideDemoQueue, completeLearnRecognition, toast]);

  const handleCompleteMeaningToFormRecall = useCallback((
    outcome: MeaningToFormRecallOutcome,
  ) => {
    const independentlyRecalled = outcome === 'independent';
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoStage(independentlyRecalled ? 'transfer' : 'recall');
      setDemoWord({
        ...toWordPresentation(pkg.content),
        level: independentlyRecalled ? 3 : 2,
        badge: '',
        isMastered: false,
      });
      overrideDemoQueue(
        pkg,
        independentlyRecalled ? 'novel_context_transfer' : 'meaning_to_form_recall',
        (learnSession?.index ?? 3) + 1,
        learnSession?.totalTarget ?? 4,
      );
    } else {
      completeLearnMeaningToFormRecall(outcome);
    }

    toast(
      independentlyRecalled
        ? '已经独立想起这个表达，继续学习'
        : '这个连接已修复，稍后会再试一次独立回想',
    );
  }, [
    flowMode,
    learnSession,
    overrideDemoQueue,
    completeLearnMeaningToFormRecall,
    toast,
  ]);

  const handleCompleteNovelTransfer = useCallback((outcome: NovelTransferOutcome) => {
    const succeeded = outcome === 'success';
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoStage('transfer');
      setDemoWord({
        ...toWordPresentation(pkg.content),
        level: succeeded ? 4 : 3,
        badge: '',
        isMastered: succeeded,
      });
      overrideDemoQueue(
        pkg,
        'novel_context_transfer',
        (learnSession?.index ?? 4) + 1,
        learnSession?.totalTarget ?? 4,
        succeeded ? 0 : (learnSession?.transferScenarioIndex ?? 0) + 1,
      );
    } else {
      completeLearnNovelTransfer(outcome);
    }

    toast(
      succeeded
        ? '已完成这次新义项学习，后续进入长期记忆调度'
        : '这个迁移已修复，稍后会换一个新场景再试',
    );
  }, [flowMode, learnSession, overrideDemoQueue, completeLearnNovelTransfer, toast]);

  const handleCompleteReviewAssessment = useCallback((result: ReviewAssessmentResult) => {
    const actionTaskKey = flowMode === 'review'
      ? reviewSession?.action.taskKey
      : learnSession?.action.taskKey;
    if (actionTaskKey && result.assessmentId !== `${actionTaskKey}.action-assessment`) {
      throw new Error('Submitted Review result does not match the current Action task.');
    }
    // The card may include a provisional memoryOutcome/evidence flag. Derive
    // the user-facing branch from the closed kind + correctness contract; the
    // ReviewQueue independently canonicalizes the persisted result as well.
    const canonicalMemoryOutcome = resolveReviewMemoryOutcome(result.kind, result.correct);
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoReviewKind(result.kind);
      setDemoReviewResult(result);
      setDemoStage('review_feedback');
      setDemoWord({ ...toWordPresentation(pkg.content), level: 4, badge: '', isMastered: true });
    } else if (flowMode === 'learn' && learnSession?.action.capability === 'boundary_discrimination') {
      completeLearnBoundary(result.correct);
    } else {
      settleReviewQueue(result);
    }
    toast(
      result.correct
        ? canonicalMemoryOutcome === 'transfer_confirmed'
          ? '新语境迁移成立，本次复习已结算一次'
          : '已独立提取，本次复习已结算一次'
        : '本次记录为提取失败，接下来只做定向修复',
    );
  }, [flowMode, learnSession, reviewSession, completeLearnBoundary, settleReviewQueue, toast]);

  // 熟词标记
  const handleMarkKnown = useCallback(() => {
    if (flowMode === 'demo') {
      markKnownLearnQueue();
      toast('已标记为熟词，本组内不再出现');
      return;
    }
    const senseId = flowMode === 'review'
      ? reviewSession?.package.senseId
      : learnSession?.package.senseId;
    if (!senseId) return;
    setDeclaredMasterySenseIds((current) => {
      const next = new Set(current);
      next.add(senseId);
      return next;
    });
    if (flowMode === 'review') {
      excludeCurrentReviewForDeclaredMastery();
    } else {
      markKnownLearnQueue();
    }
    toast('已标记为熟词，本组内不再出现');
  }, [
    excludeCurrentReviewForDeclaredMastery,
    flowMode,
    learnSession,
    markKnownLearnQueue,
    reviewSession,
    toast,
  ]);

  const revokeDeclaredMastery = useCallback((targetId: PrototypeLearningTargetId) => {
    const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
    if (!senseId) return;
    setDeclaredMasterySenseIds((current) => {
      const next = new Set(current);
      next.delete(senseId);
      return next;
    });
    setLearnDeclaredMastery(senseId, false);
    toast('已撤销熟词声明，这条目标会按原有进度恢复计划资格');
  }, [setLearnDeclaredMastery, toast]);

  // 撤回上一词
  const handleUndoWord = useCallback(() => {
    if (flowMode === 'review') {
      const prev = undoReviewQueue();
      if (!prev) {
        toast('已经是本次复习第一个词了');
      } else {
        toast('已撤回上一词');
      }
    } else {
      const prev = undoLearnQueue();
      if (!prev) {
        toast('已经是本组第一个词了');
      } else {
        toast('已撤回上一词');
      }
    }
  }, [flowMode, undoReviewQueue, undoLearnQueue, toast]);

  const continueMixedAfterReview = useCallback(() => {
    const pendingTargetIds = pendingMixedTargetRef.current;
    if (!pendingTargetIds?.length) return false;

    pendingMixedTargetRef.current = null;
    setIsExampleOpen(false);
    const started = beginInitialTargetRuntime(pendingTargetIds[0]);
    if (started) toast('到期复习已完成，继续建立新的意思连接');
    return started;
  }, [beginInitialTargetRuntime, toast]);

  const finishStructuredRetentionRuntime = useCallback(() => {
    if (continueMixedAfterReview()) return;

    setStructuredRetentionSummary({
      retainingTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(target.senseId);
        return targetId && target.status === 'retaining' && !target.relearningCompleted
          ? [targetId]
          : [];
      }),
      relearningCompletedTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(target.senseId);
        return targetId && target.status === 'retaining' && target.relearningCompleted
          ? [targetId]
          : [];
      }),
      declaredMasteryTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RUNTIME_SENSE.get(target.senseId);
        return targetId && target.status === 'declared_mastery' ? [targetId] : [];
      }),
    });
    setViewMode('finish');
  }, [continueMixedAfterReview, retentionRuntimeProjection]);

  const finishLightweightReview = useCallback(() => {
    setActiveLightweightReviewTargetIds([]);
    const nextLaunch = retentionRuntimeLaunches.find(
      (launch) => launch.surface === 'structured_session',
    );
    if (nextLaunch) {
      const remainingStructuredReviews = getReviewCandidatesForTargets(nextLaunch.targetIds);
      setFlowType('review');
      setStructuredRetentionSummary(null);
      startReviewQueue(remainingStructuredReviews);
      setViewMode('study');
      toast(`当前复习组已完成，继续处理 ${remainingStructuredReviews.length} 个复习`);
      return;
    }
    if (continueMixedAfterReview()) return;
    setViewMode('main');
    resetMain();
    toast('今天的到期复习已完成');
  }, [
    continueMixedAfterReview,
    getReviewCandidatesForTargets,
    resetMain,
    retentionRuntimeLaunches,
    startReviewQueue,
    toast,
  ]);

  // 下一词
  const handleNextWord = useCallback(() => {
    if (flowMode === 'review') {
      if (reviewDone) {
        setIsExampleOpen(false);
        finishStructuredRetentionRuntime();
        return;
      }
      nextReviewQueue();
    } else {
      if (queueDone) {
        setIsExampleOpen(false);
        persistGraduatedSenses();
        setViewMode('finish');
        return;
      }
      nextLearnQueue();
    }
  }, [
    flowMode,
    reviewDone,
    queueDone,
    nextReviewQueue,
    nextLearnQueue,
    persistGraduatedSenses,
    finishStructuredRetentionRuntime,
  ]);

  const handleContinueReviewFeedback = useCallback(() => {
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_LEARNING_PACKAGES[0];
      if (!pkg) return;
      setDemoReviewResult(null);
      setDemoStage('review_assessment');
      setDemoWord({ ...toWordPresentation(pkg.content), level: 4, badge: '', isMastered: true });
      overrideDemoQueue(pkg, 'contextual_recognition', 1, 1);
      toast('可从右侧 Review 目录继续查看其他评测卡');
      return;
    }
    handleNextWord();
  }, [flowMode, learnSession, overrideDemoQueue, handleNextWord, toast]);

  // 监听整组学习完成或复习完成自动切至结算页
  useEffect(() => {
    if (viewMode === 'study') {
      if (flowMode === 'learn' && queueDone && (!learnSession || learnSession.settled)) {
        setIsExampleOpen(false);
        persistGraduatedSenses();
        setViewMode('finish');
      } else if (flowMode === 'review' && reviewDone && (!reviewSession || reviewSession.settled)) {
        setIsExampleOpen(false);
        finishStructuredRetentionRuntime();
      }
    }
  }, [
    queueDone,
    reviewDone,
    viewMode,
    flowMode,
    learnSession,
    reviewSession,
    persistGraduatedSenses,
    finishStructuredRetentionRuntime,
  ]);

  // 打开例句卡
  const handleOpenExample = useCallback((senseIdx: number = 0, sentenceIdx: number = 0) => {
    setSelectedSenseIdx(senseIdx);
    setSelectedSentenceIdx(sentenceIdx);
    setIsExampleOpen(true);
  }, []);

  // 关闭例句卡
  const handleCloseExample = useCallback(() => {
    setIsExampleOpen(false);
  }, []);

  // 当前用于渲染的词与阶段
  const currentPackage: RuntimePackage | null = flowMode === 'demo' && demoPackage
    ? demoPackage
    : flowMode === 'review' && reviewSession
    ? reviewSession.package as RuntimePackage
    : learnSession
    ? learnSession.package as RuntimePackage
    : PROTOTYPE_LEARNING_PACKAGES[0] ?? null;
  const rawIntroductionContent = currentPackage?.content ?? null;
  const currentRepairAction = flowMode === 'review'
    ? reviewSession?.action ?? null
    : flowMode === 'learn'
    ? learnSession?.action ?? null
    : null;
  const currentIntroductionContent = currentPackage
    ? currentRepairAction?.mode === 'repair'
      ? materializeReviewRepairContent(rawIntroductionContent!, currentRepairAction.repairResourceRef)
      : currentPackage.content
    : null;
  const currentWord: Word = flowMode === 'demo' && demoWord
    ? demoWord
    : currentIntroductionContent ? toWordPresentation(currentIntroductionContent) : {
      id: 'runtime-empty',
      w: '',
      syl: '',
      ph: '',
      total: 0,
      def: '',
      senses: [],
      options: [],
      sentences: [],
      mnemo: {},
    };

  const currentStage: RuntimeLearningStage = flowMode === 'demo'
    ? demoStage
    : flowMode === 'review' && reviewSession
    ? reviewSession.action.mode === 'repair'
      ? 'review_repair'
      : reviewSession.stage
    : learnSession
    ? learnSession.action.mode === 'repair'
      ? 'review_repair'
      : stageForCapability(learnSession.action.capability)
    : 'introduction';

  const currentIntroductionPosition = currentIntroductionContent
    ? PROTOTYPE_INTRODUCTION_PACKAGES.findIndex(
        (content) => content.packageKey === currentIntroductionContent.packageKey,
      ) + 1
    : 0;

  const currentReviewAssessmentKind = flowMode === 'review'
    ? reviewSession?.assessmentKind ?? null
    : flowMode === 'demo'
    ? demoReviewKind
    : learnSession?.action.capability === 'boundary_discrimination'
    ? reviewKindForCapability(learnSession.action.capability)
    : null;

  const currentReviewAssessmentTaskKey = flowMode === 'review'
    ? reviewSession?.action.taskKey ?? null
    : learnSession?.action.taskKey ?? null;

  const currentAssessmentPackageIdentity = currentPackage
    ? {
        packageKey: currentPackage.packageId,
        senseKey: currentPackage.senseId,
      }
    : null;

  const currentReviewAssessmentResult = flowMode === 'review'
    ? reviewSession?.result ?? null
    : flowMode === 'demo'
    ? demoReviewResult
    : null;

  const selectedPrototypeLearningTarget =
    PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId];
  const selectedPrototypeLearningPolicy =
    effectivePolicyForTarget(
      selectedLearningTargetId,
      defaultLearningPolicy,
      addedLearningTargetIds,
      learningPolicyByTarget,
      committedPolicyByTarget,
    );
  const selectedPrototypePreparation = preparationForTarget(
    selectedLearningTargetId,
    selectedPrototypeLearningPolicy,
    preparationByTarget,
  );
  const selectedCommittedPolicy = committedPolicyByTarget[selectedLearningTargetId] ?? null;
  const selectedLightweightRetention = lightweightRetentionByTarget[selectedLearningTargetId];
  const selectedInitialLearningCompletion =
    initialLearningCompletionByTarget[selectedLearningTargetId];
  const selectedStructuredRetention = structuredRetentionByTarget[selectedLearningTargetId];
  const selectedInitialCompletionKind = selectedInitialLearningCompletion?.completionKind ?? null;
  const selectedReviewDue = selectedLightweightRetention
    ? selectedLightweightRetention.relearning
      || Date.parse(selectedLightweightRetention.nextReviewAt) <= Date.now()
    : structuredReviewDueTargetIds.includes(selectedLearningTargetId);
  const selectedRetentionRuntimeState = retentionRuntimeProjection.targets.find((target) =>
    target.senseId === selectedPrototypeLearningTarget.runtimeSenseId)?.status ?? null;
  const selectedRelearning = selectedLightweightRetention?.relearning
    ?? (
      structuredRelearningTargetIds.includes(selectedLearningTargetId)
      || selectedRetentionRuntimeState === 'relearning_repair'
      || selectedRetentionRuntimeState === 'relearning_retest'
    );
  const selectedNextReviewLabel = selectedLightweightRetention?.nextReviewLabel
    ?? selectedStructuredRetention?.nextReviewLabel
    ?? selectedInitialLearningCompletion?.nextReviewLabel
    ?? null;
  const declaredMasteryTargetIds = new Set(
    visibleLearningTargetIds.filter((targetId) => {
      const senseId = PROTOTYPE_LEARNING_TARGETS[targetId].runtimeSenseId;
      return senseId !== null && declaredMasterySenseIds.has(senseId);
    }),
  );
  const selectedDeclaredMastery = declaredMasteryTargetIds.has(selectedLearningTargetId);
  const policyTarget = learningPolicyContext.kind === 'target'
    ? PROTOTYPE_LEARNING_TARGETS[learningPolicyContext.targetId]
    : null;
  const selectedPolicyForPolicyScreen = learningPolicyContext.kind === 'target'
    ? effectivePolicyForTarget(
        learningPolicyContext.targetId,
        defaultLearningPolicy,
        addedLearningTargetIds,
        learningPolicyByTarget,
        committedPolicyByTarget,
      )
    : defaultLearningPolicy;
  const activeLightweightRuntimeTarget = activeLightweightRuntimeTargetId
    ? PROTOTYPE_LEARNING_TARGETS[activeLightweightRuntimeTargetId]
    : null;
  const activeLightweightRuntimePolicy = activeLightweightRuntimeTargetId
    ? committedPolicyByTarget[activeLightweightRuntimeTargetId] ?? defaultLearningPolicy
    : defaultLearningPolicy;

  const currentStep =
    flowMode === 'review' && reviewSession
      ? reviewSession.index
      : learnSession
      ? learnSession.index
      : 1;

  const totalTarget =
    flowMode === 'review' && reviewSession
      ? reviewSession.totalTarget
      : learnSession
      ? learnSession.totalTarget
      : dailyNewCount * 4;

  // 时钟更新
  const [time, setTime] = useState(() => {
    const d = new Date();
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setTime(d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'));
    }, 20000);
    return () => clearInterval(t);
  }, []);

  return (
    <DictionaryPresentationProvider presentation={dictionaryPresentation}>
      <IconSprite />

      {/* 手机外壳 */}
      <div className="phone">
        {/* 状态栏 */}
        <div className={`statusbar${isLight ? ' light' : ''}`} id="statusbar">
          <span id="sbTime">{time}</span>
          <span className="sb-r">
            <svg className="icon" style={{ width: 14, height: 14 }}><use href="#i-clock" /></svg>
            <svg className="icon" style={{ width: 14, height: 14 }}><use href="#i-wifi" /></svg>
            <svg className="icon" style={{ width: 14, height: 14 }}><use href="#i-signal" /></svg>
            <i className="sb-bat" />
          </span>
        </div>

        {/* 手机屏幕视口 */}
        <div className="viewport">
          {/* ================= 主页面体系 (Main Shell) ================= */}
          {/* 1. 首页 */}
          <HomeScreen
            active={viewMode === 'main'}
            onGo={goMain}
            onStartMixed={startMixedLearning}
            onStartReview={startReview}
            reviewDueN={totalReviewCount}
            signed={signed}
            onSign={doSign}
            mixedReadyN={todayInitialTargetIds.length + totalReviewCount}
          />

          {/* 2. 自由练习 */}
          <AcademyScreen
            active={viewMode === 'main' && mainStack.includes('s-academy')}
            onBack={backMain}
            onOpenWordList={() => goMain('s-wordlist')}
            onOpenListening={() => goMain('s-listening')}
            onOpenRealWorldListening={() => goMain('s-real-world-listening')}
            onOpenQuickSpelling={(item) => {
              openSpelling(item.sourceWord, 'quick_spelling', `${item.pos} ${item.meaning}`);
            }}
            onOpenDictation={(item) => {
              openSpelling(item.sourceWord, 'dictation', `${item.pos} ${item.meaning}`);
            }}
            practiceScope={DEFAULT_PRACTICE_SCOPE}
            presentation={practiceHomePresentation}
            toast={toast}
          />

          {/* 3. 我的内容 */}
          <ContentScreen
            active={viewMode === 'main' && mainStack.includes('s-content')}
            onBack={backMain}
            onOpenSemanticWorld={() => goMain('s-semantic-world')}
            onOpenSection={openContentSection}
            onOpenComingSoon={openContentComingSoon}
          />

          {/* 3.1 我的词义世界：Personal Meaning / Sense / Binding 事实投影 */}
          <SemanticWorldScreen
            active={viewMode === 'main' && mainStack.includes('s-semantic-world')}
            onBack={backMain}
            onOpenSense={openSemanticWorldSense}
            onOpenPersonalMeaning={openPersonalMeaning}
            onOpenConfirmedSense={openConfirmedSense}
            toast={toast}
            presentation={semanticWorldPresentation}
          />

          {/* 3.1.1 AI 澄清：一段对话收敛 Focus / Sense / Expression，一次确认落三个事实 */}
          <PersonalMeaningDetailScreen
            active={viewMode === 'main' && mainStack.includes('s-personal-meaning')}
            personalMeaningId={personalMeaningId}
            onBack={backMain}
            onOpenConfirmedSense={openConfirmedSense}
            toast={toast}
          />

          {/* 3.1.2 已确认 Sense：Meaning Formation 终点与 Binding 入口 */}
          <ConfirmedSenseDetailScreen
            active={viewMode === 'main' && mainStack.includes('s-confirmed-sense')}
            personalMeaningId={personalMeaningId}
            meaningFocusId={meaningFocusId}
            onBack={backMain}
            onOpenBinding={openExpressionBinding}
          />

          {/* 3.1.3 独立 Expression Binding：本轮停止在此，不进入学习链 */}
          <ExpressionBindingScreen
            active={viewMode === 'main' && mainStack.includes('s-expression-binding')}
            personalMeaningId={personalMeaningId}
            meaningFocusId={meaningFocusId}
            onBack={backMain}
            toast={toast}
          />

          {/* 3.2 我的内容清单：学习、收藏与笔记读取投影 */}
          <ContentLibraryScreen
            active={viewMode === 'main' && mainStack.includes('s-content-library')}
            section={contentSection}
            onBack={backMain}
            onOpenSense={openContentSense}
            onOpenExample={(entry: SavedExampleItem) => openContentExample(entry.sense)}
            onEditNote={(entry: ContentNoteItem) => {
              if (entry.sense && !entry.isLegacy) {
                openNoteEditor(entry.sense.sourceWord, entry.sense.senseId, entry.sense.meaning);
              } else {
                openNoteEditor(entry.word);
              }
            }}
          />

          {/* 3.3 具体意思只读详情 */}
          <ContentSenseDetailScreen
            active={viewMode === 'main' && mainStack.includes('s-content-sense')}
            item={selectedContentSense}
            onBack={backMain}
            onOpenExample={openContentExample}
            onOpenSense={(item) => goMain('s-content-sense', { senseId: item.senseId })}
            onOpenDictionary={(item) => openDictModal(item.sourceWord)}
            onEditNote={(item) => openNoteEditor(item.sourceWord, item.senseId, item.meaning)}
            toast={toast}
          />

          {/* 3.4 收藏例句与学习例句详情 */}
          <ContentExampleDetailScreen
            active={viewMode === 'main' && mainStack.includes('s-content-example')}
            item={selectedContentExample}
            onBack={backMain}
            onOpenSense={(item) => {
              // 例句详情跳义项详情：替换栈顶，义项已在栈中时退回到它。
              const nextStack = mainStack.includes('s-content-sense')
                ? mainStack.slice(0, -1)
                : [...mainStack.slice(0, -1), 's-content-sense'];
              setMainStack(nextStack, { senseId: item.senseId });
            }}
            toast={toast}
          />

          {/* 3.5 Later 能力的说明性占位页 */}
          <ContentComingSoonScreen
            active={viewMode === 'main' && mainStack.includes('s-content-coming')}
            kind={contentComingKind}
            onBack={backMain}
          />

          {/* 3.6 在学词书 (Word List / 单词表) */}
          <WordListScreen
            active={viewMode === 'main' && mainStack.includes('s-wordlist')}
            bookTitle="COCA 20000 (上)"
            totalBookWords={5585}
            onBack={backMain}
            onOpenListening={() => goMain('s-listening')}
            onOpenDict={openDictModal}
            onOpenSpelling={openSpelling}
            toast={toast}
          />

          {/* 3.7 自由练习 / 随身听 (仅义项粒度的独立练习投影) */}
          <PortableListeningScreen
            active={viewMode === 'main' && mainStack.includes('s-listening')}
            bookTitle={DEFAULT_PRACTICE_SCOPE.bookTitle}
            items={DEFAULT_PRACTICE_SCOPE.items}
            onBack={backMain}
            toast={toast}
            presentation={portableListeningPresentation}
          />

          {/* 3.8 真实语流：sensa 版是义项过滤的自定义原型，youglish 版是嵌入 widget 的 baseline */}
          {realWorldListeningPresentation === 'youglish' ? (
            <YouGlishListeningScreen
              active={viewMode === 'main' && mainStack.includes('s-real-world-listening')}
              items={DEFAULT_PRACTICE_SCOPE.items}
              onBack={backMain}
              toast={toast}
            />
          ) : (
            <RealWorldListeningScreen
              active={viewMode === 'main' && mainStack.includes('s-real-world-listening')}
              items={DEFAULT_PRACTICE_SCOPE.items}
              onBack={backMain}
              toast={toast}
            />
          )}

          {/* 4. 我的学习 / 学习偏好 */}
          <StudyScreen
            active={viewMode === 'main' && mainStack.includes('s-study')}
            tab={studyTab}
            onTabChange={setStudyTab}
            onBack={backMain}
            onAddLearning={() => goMain('s-learning-entry')}
            onOpenTargetLibrary={() => goMain('s-learning-library')}
            onOpenDefaultPolicy={openDefaultLearningPolicy}
            defaultPolicy={defaultLearningPolicy}
            learningTargetCount={visibleLearningTargetIds.length}
            readyInitialCount={todayInitialTargetIds.length}
            reviewCount={totalReviewCount}
            dailyNewCount={dailyNewCount}
            onDailyNewCountChange={setDailyNewCount}
          />

          {/* 4.1 Target 库：主页只保留入口，具体内容在此展开 */}
          <LearningTargetLibraryScreen
            active={viewMode === 'main' && mainStack.includes('s-learning-library')}
            targetIds={visibleLearningTargetIds}
            policyByTarget={learningPolicyByTarget}
            preparationByTarget={preparationByTarget}
            committedPolicyByTarget={committedPolicyByTarget}
            completedTargetIds={new Set([
              ...Object.keys(initialLearningCompletionByTarget),
            ] as PrototypeLearningTargetId[])}
            reviewDueTargetIds={new Set([
              ...lightweightDueTargetIds,
              ...structuredReviewDueTargetIds,
            ])}
            relearningTargetIds={new Set([
              ...lightweightRelearningTargetIds,
              ...structuredRelearningTargetIds,
            ])}
            reviewingTargetIds={new Set(structuredReviewingTargetIds)}
            relearningRepairTargetIds={new Set(structuredRelearningRepairTargetIds)}
            relearningRetestTargetIds={new Set(structuredRelearningRetestTargetIds)}
            declaredMasteryTargetIds={declaredMasteryTargetIds}
            onBack={backMain}
            onAddLearning={() => goMain('s-learning-entry')}
            onOpenTarget={openLearningTarget}
          />

          {/* 4.2 添加学习内容：三种来源汇入同一学习目标 */}
          <LearningEntryScreen
            active={viewMode === 'main' && mainStack.includes('s-learning-entry')}
            onBack={backMain}
            onOpenTarget={openLearningTarget}
            onOpenPersonalSemanticWorld={() => setMainStack(['s-semantic-world'])}
          />

          {/* 4.3 学习目标详情：来源、方式和准备状态分开表达 */}
          <LearningTargetDetailScreen
            active={viewMode === 'main' && mainStack.includes('s-learning-target')}
            target={selectedPrototypeLearningTarget}
            selectedPolicy={selectedPrototypeLearningPolicy}
            preparation={selectedPrototypePreparation}
            committedPolicy={selectedCommittedPolicy}
            initialCompletionKind={selectedInitialCompletionKind}
            reviewDue={selectedReviewDue}
            relearning={selectedRelearning}
            retentionRuntimeState={selectedRetentionRuntimeState}
            nextReviewLabel={selectedNextReviewLabel}
            declaredMastery={selectedDeclaredMastery}
            isAdded={addedLearningTargetIds.has(selectedLearningTargetId)}
            onBack={backMain}
            onAdd={addSelectedLearningTarget}
            onOpenPolicy={openTargetLearningPolicy}
            onOpenSource={openLearningSource}
            onRefreshPreparation={refreshSelectedTargetPreparation}
            onGoHome={resetMain}
            onStartReview={startReview}
            onContinueRetentionRuntime={() => {
              setFlowType('review');
              setViewMode('study');
            }}
            onContinueRuntime={() => continueCommittedTargetRuntime(selectedLearningTargetId)}
            onRevokeDeclaredMastery={() => revokeDeclaredMastery(selectedLearningTargetId)}
          />

          {/* 4.4 学习方式选择：默认方式或单个目标覆盖 */}
          <LearningPolicyScreen
            active={viewMode === 'main' && mainStack.includes('s-learning-policy')}
            target={policyTarget}
            selectedPolicy={selectedPolicyForPolicyScreen}
            onBack={backMain}
            onSelect={selectLearningPolicy}
          />

          {/* 4.5 学习统计概览 (Overview / Stats Screen, 对应图1、图2) */}
          <StatsScreen
            active={viewMode === 'main' && mainStack.includes('s-stats')}
            onBack={backMain}
            todayLearnWords={Math.max(3, queueStats.sessionsCompleted)}
            todayReviewWords={reviewStats.completedWords}
            todayMinutes={14 + Math.round((queueStats.sessionsCompleted + reviewStats.completedWords) / 2)}
            totalMinutes={15348}
            toast={toast}
          />

          {/* 5. 个人中心 */}
          <ProfileScreen
            active={viewMode === 'main' && mainStack.includes('s-profile')}
            onBack={backMain}
            onGoStudyPref={() => {
              backMain();
              setTimeout(() => {
                goMain('s-study');
                setStudyTab('b');
              }, 260);
            }}
            toast={toast}
            coins={coins}
          />

          {/* 5.1 轻量首次运行入口：创建运行即提交并锁定 Learning Policy。 */}
          <LightweightRuntimeStartScreen
            active={viewMode === 'lightweight'}
            target={activeLightweightRuntimeTarget}
            committedPolicy={activeLightweightRuntimePolicy}
            onExit={exitLightweightRuntime}
            onComplete={completeLightweightRuntime}
            onFinish={finishLightweightRuntime}
          />

          {/* 5.2 轻量长期复习：一次 due Review 只记录一次结果，遗忘后单独完成修复。 */}
          {activeLightweightReviewTargetIds.length > 0 && (
            <LightweightReviewRuntimeScreen
              active={viewMode === 'lightweightReview'}
              targetIds={activeLightweightReviewTargetIds}
              onExit={exitLightweightReview}
              onRateTarget={completeLightweightReviewTarget}
              onCompleteRepair={completeLightweightReviewRepair}
              finishLabel={structuredReviewCount > 0
                ? '继续剩余复习'
                : pendingMixedTargetRef.current?.length
                  ? '继续今天的新学'
                  : '完成并回到首页'}
              onFinish={finishLightweightReview}
            />
          )}

          {/* ================= 独立学习流 (Study Flow) ================= */}
          {/* 6. 单词学习流程 */}
          <LearnScreen
            active={viewMode === 'study'}
            isBehind={isExampleOpen}
            curWord={currentWord}
            stage={currentStage}
            step={currentStep}
            groupSize={totalTarget}
            introductionContent={rawIntroductionContent}
            repairContent={currentRepairAction?.mode === 'repair'
              ? currentIntroductionContent
              : null}
            introductionPosition={currentIntroductionPosition}
            introductionTotal={PROTOTYPE_INTRODUCTION_PACKAGES.length}
            reviewAssessmentPurpose={flowMode === 'learn' ? 'acquisition' : 'retention'}
            onExit={exitLearn}
            onUndo={handleUndoWord}
            onMarkKnown={handleMarkKnown}
            onOpenMenuMore={(e: MouseEvent, personalContent) => {
              e.stopPropagation();
              closeMenus();
              setMenuPersonalContent(personalContent);
              setMenuMoreOpen(true);
            }}
            onOpenExample={handleOpenExample}
            onOpenDict={openDictModal}
            onOpenNoteEditor={openNoteEditor}
            onOpenSceneEditor={(content, anchorId) => {
              setSceneEditorTarget({ content, anchorId });
            }}
            onOpenSpelling={openSpelling}
            onCompleteMeaningToFormRecall={handleCompleteMeaningToFormRecall}
            onCompleteNovelTransfer={handleCompleteNovelTransfer}
            reviewAssessmentKind={currentReviewAssessmentKind}
            reviewAssessmentTaskKey={currentReviewAssessmentTaskKey}
            assessmentPackageIdentity={currentAssessmentPackageIdentity}
            lookupDictionary={lookupDictionaryEntry}
            reviewAssessmentResult={currentReviewAssessmentResult}
            repairResourceRef={currentRepairAction?.mode === 'repair'
              ? currentRepairAction.repairResourceRef ?? null
              : null}
            onCompleteReviewAssessment={handleCompleteReviewAssessment}
            onContinueReviewFeedback={handleContinueReviewFeedback}
            onCompleteIntroduction={handleCompleteIntroduction}
            onCompleteRecognition={handleCompleteRecognition}
            toast={toast}
          />

          {/* 7. 原声例句全屏卡 */}
          <ExampleScreen
            active={viewMode === 'study' && isExampleOpen}
            curWord={currentWord}
            initialSenseIdx={selectedSenseIdx}
            initialSentenceIdx={selectedSentenceIdx}
            onClose={handleCloseExample}
            onOpenDict={openDictModal}
            onNextWord={() => {
              handleCloseExample();
              if (currentStage === 'introduction') {
                handleCompleteIntroduction();
              } else {
                handleNextWord();
              }
            }}
            toast={toast}
          />

          {/* 8. Lexical Reference；原始词义面板保留为 baseline */}
          {dictionaryPresentation === 'baseline' ? (
            <DictDetailModal
              active={!!dictModalWord}
              wordData={dictModalWord}
              initialTab={dictModalTab}
              onClose={closeDictModal}
              toast={toast}
            />
          ) : (
            <ReferenceDictionaryScreen
              active={!!dictModalWord}
              wordData={dictModalWord}
              onClose={closeDictModal}
              onOpenExamples={setReferenceExampleDeck}
            />
          )}

          <ReferenceExampleViewer
            active={dictionaryPresentation === 'sensa' && !!referenceExampleDeck}
            deck={referenceExampleDeck}
            onClose={() => setReferenceExampleDeck(null)}
          />

          {/* 9. 独立笔记编辑全屏弹窗 (Note Editor Modal) */}
          <NoteEditorModal
            active={!!noteModalWord}
            wordData={noteModalWord}
            senseId={noteModalSense?.senseId}
            senseMeaning={noteModalSense?.meaning}
            onClose={closeNoteEditor}
            toast={toast}
          />

          {/* 9.1 我的场景富媒体编辑 */}
          <SceneEditorModal
            active={!!sceneEditorTarget}
            senseId={sceneEditorTarget?.content.senseKey ?? null}
            word={sceneEditorTarget?.content.lemma ?? ''}
            senseMeaning={sceneEditorTarget?.content.guideLabelL1 ?? ''}
            anchorId={sceneEditorTarget?.anchorId}
            onClose={closeSceneEditor}
            toast={toast}
          />

          {/* 10. 独立单词拼写练习全屏弹窗 (Spelling Modal) */}
          <SpellingModal
            active={!!spellingWord}
            wordData={spellingWord}
            mode={spellingMode}
            cueText={spellingCue}
            onClose={closeSpelling}
            toast={toast}
          />

          {/* ================= 本组结算页 (Finish Flow) ================= */}
          {/* 11. Structured Graduation / Declared Mastery 总结不复用旧词组完成叙事。 */}
          {structuredRuntimeSummary && (
            <StructuredRuntimeSummaryScreen
              active={viewMode === 'finish' && flowMode === 'learn'}
              graduatedTargetIds={structuredRuntimeSummary.graduatedTargetIds}
              declaredMasteryTargetIds={structuredRuntimeSummary.declaredMasteryTargetIds}
              onExit={exitLearn}
            />
          )}

          {structuredRetentionSummary && (
            <StructuredRetentionSummaryScreen
              active={viewMode === 'finish' && flowMode === 'review'}
              retainingTargetIds={structuredRetentionSummary.retainingTargetIds}
              relearningCompletedTargetIds={structuredRetentionSummary.relearningCompletedTargetIds}
              declaredMasteryTargetIds={structuredRetentionSummary.declaredMasteryTargetIds}
              onExit={exitLearn}
            />
          )}

          {/* 11.1 既有完成页只保留给尚未接入统一总结的旧演示流。 */}
          <FinishScreen
            active={viewMode === 'finish' && (
              flowMode === 'learn'
                ? !structuredRuntimeSummary
                : flowMode === 'review'
                  ? !structuredRetentionSummary
                  : true
            )}
            mode={flowMode === 'review' ? 'review' : 'learn'}
            wordCount={
              flowMode === 'review'
                ? reviewStats.completedWords || reviewStats.totalWords
                : queueStats.totalWords
            }
            accuracy={flowMode === 'review' ? reviewStats.accuracy : queueStats.accuracy}
            minutes={
              flowMode === 'review'
                ? Math.max(1, Math.round((Date.now() - reviewStats.startTime) / 60000))
                : Math.max(1, Math.round((Date.now() - queueStats.startTime) / 60000))
            }
            onContinue={handleContinueNextGroup}
            onExit={exitLearn}
          />

          {/* 全局遮罩与菜单 */}
          <div
            className={`mask${menuMoreOpen || menuBookOpen ? ' on' : ''}`}
            id="mask"
            onClick={closeMenus}
          />

          {/* 学习页右上角菜单 */}
          <div className={`menu${menuMoreOpen ? ' on' : ''}`} id="menu-more">
            {menuPersonalContent && (
              <>
                <div className="menu-personal-context">
                  <span>当前义项</span>
                  <strong>{menuPersonalContent.lemma}</strong>
                  <small>{menuPersonalContent.guideLabelL1}</small>
                </div>
                <button
                  onClick={() => {
                    const content = menuPersonalContent;
                    closeMenus();
                    openNoteEditor(content.lemma, content.senseKey, content.guideLabelL1);
                  }}
                >
                  <svg className="icon"><use href="#i-pen" /></svg>写／编辑笔记
                </button>
                <button
                  onClick={() => {
                    const content = menuPersonalContent;
                    const anchorId = menuPersonalAnchors[0]?.anchorId;
                    closeMenus();
                    setSceneEditorTarget({ content, anchorId });
                  }}
                >
                  <svg className="icon"><use href="#i-bulb" /></svg>
                  {menuPersonalAnchors.length > 0 ? `我的场景 · ${menuPersonalAnchors.length}` : '建立我的场景'}
                </button>
                {menuPersonalAnchors.length > 0 && (
                  <button
                    onClick={() => {
                      const content = menuPersonalContent;
                      closeMenus();
                      setSceneEditorTarget({ content });
                    }}
                  >
                    <svg className="icon"><use href="#i-penplus" /></svg>再建立一个场景
                  </button>
                )}
                <div className="menu-section-divider" />
              </>
            )}
            <button
              onClick={() => {
                closeMenus();
                exitLearn();
                goMain('s-study');
                setStudyTab('b');
              }}
            >
              <svg className="icon"><use href="#i-sliders" /></svg>学习偏好
            </button>
            <button onClick={() => { closeMenus(); toast('沉浸场景：为学习界面更换背景与音效'); }}>
              <svg className="icon"><use href="#i-music" /></svg>沉浸场景
            </button>
            <button onClick={() => { closeMenus(); toast('小窍门：先回想再选择，记得更牢'); }}>
              <svg className="icon"><use href="#i-bulb" /></svg>小窍门
            </button>
            <button onClick={() => { closeMenus(); toast('纠错｜举报'); }}>
              <svg className="icon"><use href="#i-fix" /></svg>纠错｜举报
            </button>
          </div>

          {/* 词书设置菜单 */}
          <div className={`menu${menuBookOpen ? ' on' : ''}`} id="menu-book">
            <button onClick={() => { closeMenus(); toast('选择学习范围：按词频段 / 章节筛选'); }}>
              <svg className="icon"><use href="#i-filter" /></svg>选择学习范围
            </button>
            <button onClick={() => { closeMenus(); goMain('s-wordlist'); }}>
              <svg className="icon"><use href="#i-list" /></svg>查看词书单词表
            </button>
            <button onClick={() => { closeMenus(); toast('开始下载离线单词包…'); }}>
              <svg className="icon"><use href="#i-dl" /></svg>下载离线单词包
            </button>
            <button onClick={() => { closeMenus(); toast('重学词书会清空当前进度'); }}>
              <svg className="icon"><use href="#i-relearn" /></svg>重学词书
            </button>
            <button disabled>
              <svg className="icon"><use href="#i-refresh" /></svg>更新词书
            </button>
          </div>

          {/* 全局 Toast 提示 */}
          <div className={`toast${toastMsg ? ' on' : ''}`} id="toast">
            {toastMsg}
          </div>
        </div>

        {/* 底部 home indicator */}
        <div className={`hbar${isLight ? ' light' : ''}`} id="hbar" />
      </div>

      {/* 右侧说明与测试面板 */}
      <SidePanel
        onShowStage={showStage}
        onGoHome={exitLearn}
        onGoScreen={(screenId: string) => {
          exitLearn();
          goMain(screenId);
        }}
        onSeedSemanticWorld={() => {
          const senseIds = PROTOTYPE_LEARNING_PACKAGES
            .slice(0, 3)
            .map((pkg) => pkg.senseId);
          storageService.ensureRuntimeSenseIds(senseIds);
          exitLearn();
          goMain('s-semantic-world');
          toast('已将 3 个义项放入长期复习，词义世界已更新');
        }}
        onGoStudyTab={(tab: 'a' | 'b') => {
          exitLearn();
          setStudyTab(tab);
          goMain('s-study');
        }}
        onOpenExampleDirect={() => {
          setViewMode('study');
          const pkg = PROTOTYPE_LEARNING_PACKAGES[0];
          if (!pkg) return;
          setFlowType('demo');
          setDemoPackage(pkg);
          setDemoStage('recall');
          setDemoWord({ ...toWordPresentation(pkg.content), level: 1, badge: '', isMastered: false });
          overrideDemoQueue(pkg, 'meaning_to_form_recall', 7, 20);
          setSelectedSenseIdx(0);
          setIsExampleOpen(true);
        }}
        onOpenNoteEditor={(w) => openNoteEditor(w || currentWord)}
        onOpenSpelling={(w) => openSpelling(w || currentWord)}
      />
    </DictionaryPresentationProvider>
  );
}
