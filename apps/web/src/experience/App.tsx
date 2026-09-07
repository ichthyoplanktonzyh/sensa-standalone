import { LearningPreferencesPanel } from './components/learning/LearningPreferencesPanel';
import { runtimeCheckpoint } from './learningRuntime/runtimeCheckpoint';
import { runtimeText } from '../i18n/runtimeText';
import { useTranslation } from 'react-i18next';
import { uiClass } from './ui/classes';
import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, type MouseEvent } from 'react';
import type { GradedMemoryOutcome } from '@sensa/learning-kernel';
import type { Word } from './types';
import { useLearnQueue } from './engine/useLearnQueue';
import './learningRuntime/runtimeComposition';
import { useReviewQueue } from './engine/useReviewQueue';
import type {
  RetentionRuntimeTargetStatus,
  ReviewRuntimeEffect,
} from './engine/ReviewQueue';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
} from './review/types';
import {
  resolveLearnerRatedMemoryOutcome,
  resolveReviewMemoryOutcome,
} from './review/types';
import { storageService } from './services/storageService';
import { lookupDictionaryEntry } from './services/quickDict';
import { personalContentService } from './services/personalContentService';
import { IconSprite } from './components/IconSprite';
import { HomeScreen } from './components/HomeScreen';
import { AcademyScreen } from './components/AcademyScreen';
import { PracticeScopeScreen } from './components/PracticeScopeScreen';
import { YouGlishListeningScreen } from './components/YouGlishListeningScreen';
import { ContentScreen } from './components/ContentScreen';
import { ContentLibraryScreen } from './components/ContentLibraryScreen';
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
import {
  InterleavedFourStageRuntimeScreen,
  type FourStageCompletionItem,
} from './components/learning/InterleavedFourStageRuntimeScreen';
import { InterleavedFourStageReviewScreen } from './components/learning/InterleavedFourStageReviewScreen';
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
import { FinishScreen } from './components/FinishScreen';
import { StatsScreen } from './components/StatsScreen';
import { WebShell } from './ui/WebShell';
import { PRACTICE_SENSES, type PracticeSenseItem } from './practiceData';
import { usePracticeScope } from './usePracticeScope';
import type { ResolvedPracticeScope } from './practiceScope';
import {
  contentSenseForId,
  isContentSectionId,
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from './contentProjection';
import {
  PROTOTYPE_INTRODUCTION_PACKAGES,
  materializeReviewRepairContent,
  toWordPresentation,
} from './content/learningCatalog';
import { PROTOTYPE_RUNTIME_PACKAGES } from './learningRuntime/prototypeRuntimeFixtures';
import type { PrototypeIntroductionPackage } from './content/learningCatalog';
import type {
  LearningCapability,
  LearningStepKind,
  MeaningToFormRecallOutcome,
  NovelTransferOutcome,
  ReviewCandidate,
} from './engine/types';
import { retentionTargetIdOf } from './engine/types';
import {
  PROTOTYPE_LEARNING_TARGET_ORDER,
  PROTOTYPE_LEARNING_TARGETS,
  defaultRetentionTargetIdFor,
  isPrototypeLearningTargetId,
  lightweightInitialMaterializationForTarget,
  provisionedForPolicy,
  readinessForPolicy,
  runtimePackageForTarget,
  type PrototypeLearningPolicy,
  type PrototypeLearningTargetId,
  type PrototypeLightweightRating,
} from './learningJourney/prototypeLearning';
import {
  addedTargetIds,
  committedTargetIds,
  completedTargetIds,
  effectivePolicies,
  effectivePolicyFor,
  isDeclaredMastery,
  journeyFor,
  preparationFor,
  preparations,
  relativeReviewLabel,
} from './learningJourney/journeyState';
import { projectLearningHistory } from './learningJourney/learningHistory';
import { useJourneyState } from './learningJourney/useJourneyState';
import type { LearningProtocolPurpose } from './learningRuntime/policyProfiles';
import { learningRuntimeCoordinator } from './learningRuntime/runtimeCoordinator';
import {
  retentionStoreRegistry,
  type RetentionStoreId,
} from './learningRuntime/retentionStores';
import { useRuntimeSession } from './learningRuntime/useRuntimeSession';
import { initialRunOn, retentionRunOn } from './learningRuntime/runtimeSession';
import {
  runtimeSurfaceRegistry,
  type RuntimeSurfaceContext,
} from './learningRuntime/runtimeSurfaces';
import type { StepRendererHost } from './learningRuntime/stepRenderers';
import { useLightweightInitialProtocol } from './learningRuntime/useLightweightInitialProtocol';
import { useShellNavigation } from './router/useShellNavigation';
import { usePresentationStore } from './stores/presentationStore';
import { useOverlayStore } from './stores/overlayStore';

import { setDailyNewCount, useDailyNewCount, useDueReviewCount } from './stores/dailyPlanStore';
import { planDailyInitialTargets } from './planning/dailyInitialPlanner';
import { useLearningFlow } from './learningFlow/useLearningFlow';
import { demoSceneForStage, demoWordFor } from './learningFlow/demoScenes';

type RuntimePackage = (typeof PROTOTYPE_RUNTIME_PACKAGES)[number];

type LearningPolicyContext =
  | { kind: 'default' }
  | { kind: 'target'; targetId: PrototypeLearningTargetId };


const LIGHTWEIGHT_REVIEW_SCHEDULE: Record<
  PrototypeLightweightRating,
  { delayMs: number; nextReviewLabel: string }
> = {
  // 重学步，与第一档（学习步 2，FIXED_LADDER_FIRST_RUNG）同为 Anki 式短步长。
  again: { delayMs: 10 * 60 * 1000, nextReviewLabel: '10 分钟后' },
  hard: { delayMs: 24 * 60 * 60 * 1000, nextReviewLabel: '明天' },
  good: { delayMs: 3 * 24 * 60 * 60 * 1000, nextReviewLabel: '3 天后' },
};

const TARGET_ID_BY_RETENTION_TARGET = new Map(
  PROTOTYPE_LEARNING_TARGET_ORDER.map((targetId) => [
    defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]),
    targetId,
  ] as const),
);

const PROTOTYPE_BOUND_LEARNING_PACKAGES = PROTOTYPE_LEARNING_TARGET_ORDER.flatMap(
  (targetId) => {
    const packageItem = runtimePackageForTarget(PROTOTYPE_LEARNING_TARGETS[targetId]);
    return packageItem ? [packageItem] : [];
  },
);

/**
 * 这条 Policy 的长期保持事实存在哪。见 learningRuntime/retentionStores.ts。
 *
 * 下面每一处读写长期状态的地方原本问的是 surface 名字。问 store 之后，
 * 新增一个复用同一 store 的 surface 不会波及它们。
 */
function retentionStoreForPolicy(
  policy: PrototypeLearningPolicy,
  purpose: LearningProtocolPurpose = 'retention_review',
) {
  return learningRuntimeCoordinator.retentionStoreFor(policy, purpose);
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
  const { t } = useTranslation();
  const [learningPreferencesOpen,setLearningPreferencesOpen]=useState(false);
  const closeLearningPreferences=useCallback(()=>{
    setLearningPreferencesOpen(false);
    requestAnimationFrame(()=>document.getElementById('learning-more-button')?.focus());
  },[]);

  const checkpointError = useSyncExternalStore(runtimeCheckpoint.subscribe, runtimeCheckpoint.getError, () => null);
  const [pausedLightweightFlow, setPausedFlowState] = useState<'lightweight' | 'lightweightReview' | 'study' | null>(()=>runtimeCheckpoint.read().pausedFlow??runtimeCheckpoint.read().lastFlow??null);
  const setPausedLightweightFlow=useCallback((flow:'lightweight'|'lightweightReview'|'study'|null)=>{
    runtimeCheckpoint.update({pausedFlow:flow});
    runtimeCheckpoint.afterCommit(()=>setPausedFlowState(flow));
  },[]);
  /* ---------- 顶层视图模式与 Sheet 栈：真相源是 URL ---------- */
  const {
    viewMode,
    mainStack,
    params,
    setViewMode,
    goMain,
    backMain,
    resetMain,
    returnHome,
    leaveRuntime,
    setMainStack,
  } = useShellNavigation();

  /* ---------- 自由练习范围：typed sources → learner selection → resolved scope ---------- */
  const { catalog: practiceScopeCatalog, selectScope } = usePracticeScope();
  const [activePracticeScope, setActivePracticeScope] = useState<ResolvedPracticeScope | null>(null);
  const openRealWorldListening = useCallback(() => {
    const current = practiceScopeCatalog.currentScope;
    // Pin the resolved target list for this activity run. Later source changes
    // only affect the next run, never the one already on screen.
    setActivePracticeScope({ ...current, targets: [...current.targets] });
    goMain('s-real-world-listening');
  }, [goMain, practiceScopeCatalog.currentScope]);

  // 剩余展示版本对照开关由 presentationStore 持有：写在侧栏、读在各屏。
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

  // 是否为首页纯净壁纸态（主页面且无弹层），决定状态栏与底条为浅色文字
  const isLight = viewMode === 'main' && mainStack.length === 0;

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


  // 例句卡：开着时是"看第几个义项、第几句"，关着时为 null。
  const exampleSheet = useOverlayStore((state) => state.exampleSheet);
  const openExample = useOverlayStore((state) => state.openExample);
  const closeExample = useOverlayStore((state) => state.closeExample);

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

  /* ---------- 业务状态（签到、统计） ---------- */
  const [studyTab, setStudyTab] = useState<'a' | 'b'>('a');
  /**
   * 打开的是哪条 Target、正在编辑谁的学习方式——这两个都是"某个 sheet 正在
   * 展示什么"，和内容区的 senseId / meaningId 是同一类东西，所以同样由 URL 描述。
   * 换来的是这两屏也能被深链和分享，且离开时 param 随 sheet 一起消失。
   */
  const selectedLearningTargetId: PrototypeLearningTargetId =
    isPrototypeLearningTargetId(params.targetId) ? params.targetId : 'borrow-receive';
  const learningPolicyContext: LearningPolicyContext =
    isPrototypeLearningTargetId(params.policyTarget)
      ? { kind: 'target', targetId: params.policyTarget }
      : { kind: 'default' };
  /**
   * 每条 Target 走到哪一步了。原先是八个用同一个 key 索引的平行 map
   * 加一个默认方式，规则见 learningJourney/journeyState.ts。
   */
  const { journey, dispatchJourney } = useJourneyState();
  const defaultLearningPolicy = journey.defaultPolicy;
  const learningRecords = useMemo(() => projectLearningHistory(journey), [journey]);
  const declaredMasteryRetentionTargetIds = journey.declaredMasteryRetentionTargetIds;
  /**
   * "现在跑着什么、刚跑完什么"——五个原本各自为政的 useState，规则见
   * learningRuntime/runtimeSession.ts。
   */
  const runtimeSession = useRuntimeSession();
  const {
    initialSummary,
    retentionSummary,
    startInitialRun,
    finishInitialTarget,
    finishInitialRun,
    startRetentionRun,
    // App 自己也有一个 finishLightweightReview（还要接着开下一段复习），
    // 这里只是会话状态那一半。
    finishRetentionRun: finishRetentionRunSession,
    showInitialSummary,
    showRetentionSummary,
  } = runtimeSession;
  /**
   * 会话状态本身不再按学习方式起名，但屏幕仍然是按 surface 渲染的——在 Step
   * renderer 注册表之前，"哪块屏拿哪次运行"只能在这里点名。三处派生集中在
   * 一起，比散在下游各处好查。
   */
  const structuredInitialTargetIds = initialRunOn(runtimeSession, 'structured_session');
  const lightweightInitialTargetIds = initialRunOn(runtimeSession, 'lightweight_initial');
  const lightweightInitialTargetId = lightweightInitialTargetIds[0] ?? null;
  const lightweightInitialRetentionTargetId = lightweightInitialTargetId
    ? defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[lightweightInitialTargetId])
    : null;
  const lightweightInitialMaterialization = useMemo(
    () => lightweightInitialTargetId
      ? lightweightInitialMaterializationForTarget(
          PROTOTYPE_LEARNING_TARGETS[lightweightInitialTargetId],
        )
      : null,
    [lightweightInitialTargetId],
  );
  const {
    state: lightweightInitialProtocolState,
    step: lightweightInitialProtocolStep,
    reveal: revealLightweightExpression,
    rate: rateLightweightInitial,
  } = useLightweightInitialProtocol(
    lightweightInitialRetentionTargetId,
    lightweightInitialMaterialization,
  );
  const lightweightReviewTargetIds = retentionRunOn(runtimeSession, 'lightweight_retention');
  const fourStageInitialTargetIds = initialRunOn(runtimeSession, 'interleaved_four_stage');
  const fourStageReviewTargetIds = retentionRunOn(
    runtimeSession,
    'interleaved_four_stage_review',
  );
  const retentionRunSurface = runtimeSession.retentionRun?.surface ?? null;

  const openLearningTarget = useCallback((targetId: PrototypeLearningTargetId) => {
    goMain('s-learning-target', { targetId });
  }, [goMain]);

  const openTargetLearningPolicy = useCallback(() => {
    if (journeyFor(journey, selectedLearningTargetId).committedPolicy) {
      toast('学习方式已在首次正式学习开始时锁定');
      return;
    }
    goMain('s-learning-policy', { policyTarget: selectedLearningTargetId });
  }, [goMain, journey, selectedLearningTargetId, toast]);

  const selectLearningPolicy = useCallback((policy: PrototypeLearningPolicy) => {
    if (learningPolicyContext.kind === 'default') {
      dispatchJourney({ type: 'selectDefaultPolicy', policy });
      return;
    }
    if (journeyFor(journey, learningPolicyContext.targetId).committedPolicy) {
      toast('这条目标的学习方式已经锁定');
      return;
    }
    dispatchJourney({
      type: 'selectTargetPolicy',
      targetId: learningPolicyContext.targetId,
      policy,
    });
  }, [dispatchJourney, journey, learningPolicyContext, toast]);

  const addSelectedLearningTarget = useCallback(() => {
    dispatchJourney({ type: 'addTarget', targetId: selectedLearningTargetId });
    toast('已加入“我的学习”，内容会按所选方式准备');
  }, [dispatchJourney, selectedLearningTargetId, toast]);

  const refreshSelectedTargetPreparation = useCallback(() => {
    const configured = readinessForPolicy(
      PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId],
      effectivePolicyFor(journey, selectedLearningTargetId),
    ).status;
    // Rechecking reports provisioned capabilities; it cannot complete preparation.
    const nextPreparation = configured;
    dispatchJourney({
      type: 'setPreparation',
      targetId: selectedLearningTargetId,
      preparation: nextPreparation,
    });
    toast(t('learningSetup.' + (nextPreparation === 'ready' ? 'checkReady' : nextPreparation === 'preparing' ? 'checkPreparing' : 'checkBlocked')));
  }, [dispatchJourney, journey, selectedLearningTargetId, toast, t]);

  const openLearningSource = useCallback(() => {
    const target = PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId];
    if (target.sourceKind === 'personal_semantic_world') {
      setMainStack(['s-semantic-world']);
      return;
    }
    setMainStack(['s-study', 's-learning-entry']);
  }, [selectedLearningTargetId]);

  /* ---------- 流程模式与每日新学词数 ---------- */
  // 一台状态机，不是六个互相牵制的 useState：demo 的负载只挂在 demo 分支上，
  // 切走即随之消失。见 learningFlow/flowState.ts。
  const { flowMode, demo, enterLearn, enterReview, enterDemo, advanceDemo } = useLearningFlow();
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
      const { initialCompletion, structuredRetention, committedPolicy } =
        journeyFor(journey, targetId);
      if (
        !initialCompletion
        || !committedPolicy
        || retentionStoreForPolicy(committedPolicy) !== 'scheduler_memory'
        || structuredRetention?.reviewCount
      ) return false;
      const retentionTargetId = defaultRetentionTargetIdFor(
        PROTOTYPE_LEARNING_TARGETS[targetId],
      );
      if (declaredMasteryRetentionTargetIds.has(retentionTargetId)) return false;
      const memory = storageService.getFSRSItems()[retentionTargetId];
      return memory !== undefined && memory.due > dueAt;
    });
    if (targetIdsToAdvance.length === 0) return;

    targetIdsToAdvance.forEach((targetId) => {
      const retentionTargetId = defaultRetentionTargetIdFor(
        PROTOTYPE_LEARNING_TARGETS[targetId],
      );
      const memory = storageService.getFSRSItems()[retentionTargetId]!;
      storageService.saveFSRSItem({ ...memory, due: dueAt, scheduledDays: 0 });
    });
    dispatchJourney({ type: 'advanceStructuredHandoffs', targetIds: targetIdsToAdvance, dueAt });
  }, [declaredMasteryRetentionTargetIds, dispatchJourney, journey]);


  const visibleLearningTargetIds = addedTargetIds(journey);
  // Study Plan owns the only quantity decision. Planning writes a durable-in-this-
  // prototype `initialPlannedAt` fact before a Protocol can consume the Target;
  // completing one Target therefore cannot replenish today's cohort by slicing a
  // changing ready list again.
  useEffect(() => {
    const plannedAt = new Date().toISOString();
    const targetIds = planDailyInitialTargets(
      visibleLearningTargetIds.map((targetId) => ({
        targetId,
        eligible: journeyFor(journey, targetId).committedPolicy === null
          && !isDeclaredMastery(journey, targetId)
          && preparationFor(journey, targetId) === 'ready',
        initialPlannedAt: journeyFor(journey, targetId).initialPlannedAt,
      })),
      dailyNewCount,
      plannedAt,
    );
    if (targetIds.length > 0) {
      dispatchJourney({ type: 'planInitialTargets', targetIds, plannedAt });
    }
  }, [dailyNewCount, dispatchJourney, journey, visibleLearningTargetIds]);

  // Unfinished work planned on an earlier day remains available without consuming
  // today's new quota. Protocols see only this Planner-owned cohort.
  const plannedInitialTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const targetJourney = journeyFor(journey, targetId);
    if (targetJourney.initialPlannedAt === null || targetJourney.committedPolicy) return false;
    if (isDeclaredMastery(journey, targetId)) return false;
    return preparationFor(journey, targetId) === 'ready';
  });
  const lightweightDueTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const { lightweightRetention, committedPolicy } = journeyFor(journey, targetId);
    return committedPolicy !== null
      && retentionStoreForPolicy(committedPolicy) === 'fixed_ladder'
      && lightweightRetention !== null
      && (lightweightRetention.relearning
        || Date.parse(lightweightRetention.nextReviewAt) <= Date.now());
  });
  const lightweightRelearningTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const { lightweightRetention, committedPolicy } = journeyFor(journey, targetId);
    return committedPolicy !== null
      && retentionStoreForPolicy(committedPolicy, 'relearning') === 'fixed_ladder'
      && lightweightRetention?.relearning === true;
  });

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
    getGraduatedRetentionTargetIds,
    overrideDemo: overrideDemoQueue,
  } = useLearnQueue(PROTOTYPE_BOUND_LEARNING_PACKAGES, {
    minGap: 2,
  });

  // Structured Graduation creates the common Initial Completion. The committed
  // Profile then chooses which retention adapter receives the Scheduling Handoff.
  // Keep this idempotent because two render paths can observe the same settled queue.
  const persistGraduatedSenses = useCallback(() => {
    return runtimeCheckpoint.atomic(()=>{
    const fsrsItems = storageService.getFSRSItems();
    const graduatedRetentionTargetIds = getGraduatedRetentionTargetIds();
    graduatedRetentionTargetIds.forEach((retentionTargetId) => {
      const targetId = TARGET_ID_BY_RETENTION_TARGET.get(retentionTargetId);
      const policy = targetId ? journeyFor(journey, targetId).committedPolicy : null;
      if (
        policy
        && retentionStoreForPolicy(policy) === 'scheduler_memory'
        && !fsrsItems[retentionTargetId]
      ) {
        storageService.graduateRetentionTarget(retentionTargetId, 0);
      }
    });
    const memoryItems = storageService.getFSRSItems();
    const graduatedRetentionTargetIdSet = new Set(graduatedRetentionTargetIds);
    const completedAt = new Date().toISOString();
    if (structuredInitialTargetIds.length > 0) {
      showInitialSummary({
        graduatedTargetIds: structuredInitialTargetIds.filter((targetId) => {
          const retentionTargetId = defaultRetentionTargetIdFor(
            PROTOTYPE_LEARNING_TARGETS[targetId],
          );
          return graduatedRetentionTargetIdSet.has(retentionTargetId);
        }),
        declaredMasteryTargetIds: structuredInitialTargetIds.filter((targetId) => {
          return declaredMasteryRetentionTargetIds.has(defaultRetentionTargetIdFor(
            PROTOTYPE_LEARNING_TARGETS[targetId],
          ));
        }),
      });
    }
    // 谁算毕业、交接写进哪一份，规则在 journeyReducer 里；这里只交出输入。
    dispatchJourney({
      type: 'recordQueueInitialCompletions',
      completedRetentionTargetIds: graduatedRetentionTargetIds,
      dueByRetentionTargetId: Object.fromEntries(
        Object.values(memoryItems).map((item) => [item.memoryKey, item.due]),
      ),
      completedAt,
      now: Date.now(),
    });
    });
  }, [
    structuredInitialTargetIds,
    declaredMasteryRetentionTargetIds,
    dispatchJourney,
    getGraduatedRetentionTargetIds,
    journey,
    showInitialSummary,
  ]);

  /* ---------- 全量到期流式复习引擎 (FSRS 复习流) ---------- */
  const onReviewEffect = useCallback((effect: ReviewRuntimeEffect<PrototypeIntroductionPackage>) => {
    storageService.applyReviewRuntimeEffect(effect);
    const retentionTargetId = retentionTargetIdOf(effect.candidate.package);
    const targetId = TARGET_ID_BY_RETENTION_TARGET.get(retentionTargetId);
    if (targetId) {
      const memory = storageService.getFSRSItems()[retentionTargetId]!;
      const cycle = storageService.getRelearningCycle(retentionTargetId);
      const occurredAt = new Date().toISOString();
      // 只交出这次事件；累加与延续由 reducer 基于它持有的上一份算。
      const counted = effect.type === 'retention_outcome';
      dispatchJourney({
        type: 'recordStructuredRetention',
        targetId,
        occurredAt,
        counted,
        outcome: counted ? effect.result.memoryOutcome?.basis ?? null : null,
        dueAt: memory.due,
        lapses: memory.lapses,
        relearningStage: cycle?.stage ?? null,
        retestPassed: effect.type === 'relearning_progress' && effect.event === 'retest_passed',
        now: Date.now(),
      });
    }
  }, [dispatchJourney]);
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

  const pendingMixedTargetRef = useRef<PrototypeLearningTargetId[] | null>((runtimeCheckpoint.read().pendingMixed as PrototypeLearningTargetId[]|null)??null);
  const setPendingMixedTargets=useCallback((targets:PrototypeLearningTargetId[]|null)=>{
    runtimeCheckpoint.update({pendingMixed:targets});
    runtimeCheckpoint.afterCommit(()=>{pendingMixedTargetRef.current=targets;});
  },[]);
  useEffect(()=>{
    if(viewMode==='lightweight'||viewMode==='lightweightReview'||viewMode==='study') {
      try {runtimeCheckpoint.update({lastFlow:viewMode});} catch { /* RuntimeFrame reports persistence failures. */ }
    }
  },[viewMode]);

  const getReviewCandidates = useCallback((): ReviewCandidate<PrototypeIntroductionPackage>[] => {
    const boundTargets = PROTOTYPE_LEARNING_TARGET_ORDER.flatMap((targetId) => {
      const packageItem = runtimePackageForTarget(PROTOTYPE_LEARNING_TARGETS[targetId]);
      return packageItem ? [{ targetId, packageItem }] : [];
    });
    const retentionTargetIds = boundTargets.map(({ packageItem }) =>
      retentionTargetIdOf(packageItem));
    const reviewReadyRetentionTargetIds = new Set([
      ...storageService.getDueRetentionTargetIds(retentionTargetIds),
      ...storageService.getRelearningRetentionTargetIds(),
    ]);
    return boundTargets.flatMap(({ targetId, packageItem }) => {
      const retentionTargetId = retentionTargetIdOf(packageItem);
      if (!reviewReadyRetentionTargetIds.has(retentionTargetId)) return [];
      if (declaredMasteryRetentionTargetIds.has(retentionTargetId)) return [];
      const { committedPolicy, initialCompletion } = journeyFor(journey, targetId);
      if (
        !committedPolicy
        || retentionStoreForPolicy(committedPolicy) !== 'scheduler_memory'
      ) return [];
      if (!initialCompletion) return [];
      const item = storageService.getFSRSItems()[retentionTargetId];
      if (!item) return [];
      const relearning = storageService.getRelearningCycle(retentionTargetId);
      return [{
        package: packageItem,
        dueAt: item.due,
        reps: item.reps,
        lapses: item.lapses,
        phase: relearning || item.state === 'relearning'
          ? 'relearning' as const
          : 'retaining' as const,
        relearning,
      }];
    });
  }, [declaredMasteryRetentionTargetIds, journey]);

  const structuredReviewCandidates = getReviewCandidates();
  const structuredReviewRetentionTargetIds = new Set(
    structuredReviewCandidates.map((candidate) => retentionTargetIdOf(candidate.package)),
  );
  const structuredReviewDueTargetIds = visibleLearningTargetIds.filter((targetId) => {
    const retentionTargetId = defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]);
    return journeyFor(journey, targetId).initialCompletion !== null
      && structuredReviewRetentionTargetIds.has(retentionTargetId);
  });
  const structuredRelearningRetentionTargetIds = new Set(
    structuredReviewCandidates
      .filter((candidate) => candidate.phase === 'relearning')
      .map((candidate) => retentionTargetIdOf(candidate.package)),
  );
  const structuredRelearningTargetIds = structuredReviewDueTargetIds.filter((targetId) => {
    const retentionTargetId = defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]);
    return structuredRelearningRetentionTargetIds.has(retentionTargetId);
  });
  const targetIdsForRetentionStatuses = (
    ...statuses: readonly RetentionRuntimeTargetStatus[]
  ): PrototypeLearningTargetId[] => retentionRuntimeProjection.targets.flatMap((target) => {
    const targetId = TARGET_ID_BY_RETENTION_TARGET.get(target.retentionTargetId);
    return targetId && statuses.includes(target.status) ? [targetId] : [];
  });
  const structuredReviewingTargetIds = targetIdsForRetentionStatuses('reviewing');
  const structuredRelearningRepairTargetIds = targetIdsForRetentionStatuses('relearning_repair');
  const structuredRelearningRetestTargetIds = targetIdsForRetentionStatuses('relearning_retest');
  const retentionRuntimeLaunches = learningRuntimeCoordinator.planRetention([
    ...[...lightweightDueTargetIds, ...structuredReviewDueTargetIds].map((targetId) => ({
      targetId,
      profileId: journeyFor(journey, targetId).committedPolicy!,
      ready: true,
      executable: true,
    })),
  ]);
  // 首页的复习计数按 store 分桶：调度器那一桶还要受它自己的到期数封顶，
  // 固定档期那一桶没有第二个数据源，投影里有几条就是几条。
  const retentionCountForStore = (storeId: RetentionStoreId) => retentionRuntimeLaunches
    .filter((launch) =>
      learningRuntimeCoordinator.retentionStoreOfAdapter(launch.adapterId) === storeId)
    .reduce((count, launch) => count + launch.targetIds.length, 0);
  const ladderReviewCount = retentionCountForStore('fixed_ladder');
  const schedulerReviewCount = Math.min(reviewN, retentionCountForStore('scheduler_memory'));
  const totalReviewCount = ladderReviewCount + schedulerReviewCount;

  const getReviewCandidatesForTargets = useCallback((
    targetIds: readonly PrototypeLearningTargetId[],
  ) => {
    const eligibleTargetIds = new Set(targetIds);
    return getReviewCandidates().filter((candidate) => {
      const targetId = TARGET_ID_BY_RETENTION_TARGET.get(
        retentionTargetIdOf(candidate.package),
      );
      return targetId !== undefined && eligibleTargetIds.has(targetId);
    });
  }, [getReviewCandidates]);

  /**
   * 宿主提供给 Runtime Surface handler 的能力面。
   *
   * 这些方法此前是各入口 if/else 里的行内语句。收成一份合同后，surface 的
   * 启动顺序、失败处理和文案归 `runtimeSurfaces.ts` 所有，App 只提供能力。
   */
  const runtimeSurfaceContext = useMemo<RuntimeSurfaceContext>(() => ({
    toast,
    showFlow: (flow) => runtimeCheckpoint.afterCommit(() => setViewMode(flow)),
    enterReviewMode: enterReview,
    commitPolicies: (targetIds) => {
      dispatchJourney({
        type: 'commitPolicies',
        entries: targetIds.map((targetId) => ({
          targetId,
          policy: effectivePolicyFor(journey, targetId),
        })),
      });
    },
    beginInitialRun: startInitialRun,
    beginRetentionRun: startRetentionRun,
    openStructuredQueue: (targetIds) => {
      const runtimePackages = targetIds.map((targetId) =>
        runtimePackageForTarget(PROTOTYPE_LEARNING_TARGETS[targetId])!);
      if (runtimePackages.length === 0) {
        toast('当前学习方式要求的内容尚未完整接入');
        return false;
      }
      if (!startLearnQueue(runtimePackages)) {
        toast('首次学习运行创建失败');
        return false;
      }
      return true;
    },
    countDueReviews: (targetIds) => getReviewCandidatesForTargets(targetIds).length,
    openStructuredReviewQueue: (targetIds) => {
      startReviewQueue(getReviewCandidatesForTargets(targetIds));
    },
  }), [
    toast,
    setViewMode,
    enterReview,
    dispatchJourney,
    journey,
    startInitialRun,
    startRetentionRun,
    startLearnQueue,
    getReviewCandidatesForTargets,
    startReviewQueue,
  ]);

  const beginInitialTargetRuntime = useCallback((targetId: PrototypeLearningTargetId) => {
    if (!journeyFor(journey, targetId).added) {
      toast('请先把这条目标加入学习');
      return false;
    }
    if (journeyFor(journey, targetId).committedPolicy) {
      toast(runtimeText('alreadyStarted'));
      return false;
    }

    const preparation = preparationFor(journey, targetId);
    if (preparation !== 'ready') {
      toast(preparation === 'preparing' ? runtimeText('preparing') : runtimeText('notReady'));
      return false;
    }

    closeMenus();
    closeExample();
    enterLearn();

    if (!plannedInitialTargetIds.includes(targetId)) {
      toast(runtimeText('notPlanned'));
      return false;
    }

    const initialCandidates = plannedInitialTargetIds
      .filter((candidateId) => !journeyFor(journey, candidateId).committedPolicy)
      .map((candidateId) => {
        const candidatePolicy = effectivePolicyFor(journey, candidateId);
        return {
          targetId: candidateId,
          profileId: candidatePolicy,
          ready: preparationFor(journey, candidateId, candidatePolicy) === 'ready',
          // 建不建得起来问的是内容供给，不是问哪块屏：`ready` 是可被"刷新准备状态"
          // 推上去的声明状态，推不出一个不存在的学习包。
          executable: provisionedForPolicy(
            PROTOTYPE_LEARNING_TARGETS[candidateId],
            candidatePolicy,
          ),
        };
      });
    const launch = learningRuntimeCoordinator.planInitial(targetId, initialCandidates);
    if (!launch) {
      toast(runtimeText('cannotStart'));
      return false;
    }

    return runtimeCheckpoint.atomic(() => runtimeSurfaceRegistry
      .get(launch.surface)
      .startInitial(runtimeSurfaceContext, launch));
  }, [
    closeMenus,
    enterLearn,
    journey,
    runtimeSurfaceContext,
    plannedInitialTargetIds,
    toast,
    closeExample,
  ]);

  const continueCommittedTargetRuntime = useCallback((targetId: PrototypeLearningTargetId) => {
    const { committedPolicy, initialCompletion } = journeyFor(journey, targetId);
    if (!committedPolicy) return;
    const surface = learningRuntimeCoordinator.surfaceFor(committedPolicy, 'initial_learning');
    runtimeSurfaceRegistry
      .get(surface)
      .continueInitial(runtimeSurfaceContext, targetId, {
        initialCompletion: initialCompletion !== null,
        declaredMastery: declaredMasteryRetentionTargetIds.has(defaultRetentionTargetIdFor(
          PROTOTYPE_LEARNING_TARGETS[targetId],
        )),
        inActiveRun: initialRunOn(runtimeSession, surface).includes(targetId),
      });
  }, [
    declaredMasteryRetentionTargetIds,
    journey,
    runtimeSession,
    runtimeSurfaceContext,
  ]);

  // 开始第一个可运行的 Target；运行创建成功才会提交并锁定 Policy。
  const startLearn = useCallback(() => {
    try { runtimeCheckpoint.atomic(() => {
    setPendingMixedTargets(null);
    const nextTargetId = plannedInitialTargetIds[0];
    if (!nextTargetId) {
      toast(runtimeText('noNew'));
      return;
    }
    beginInitialTargetRuntime(nextTargetId);
    }); } catch { toast(runtimeText('saveError')); }
  }, [beginInitialTargetRuntime, plannedInitialTargetIds, toast]);

  // 继续学习下一组
  const handleContinueNextGroup = useCallback(() => {
    startLearn();
  }, [startLearn]);

  // 开始真实复习流程 (全量到期流式复习)
  const startReview = useCallback(() => {
    try { runtimeCheckpoint.atomic(() => {
    setPendingMixedTargets(null);
    closeMenus();
    closeExample();
    enterReview();
    const launch = retentionRuntimeLaunches[0];
    runtimeCheckpoint.update({retentionPlan:retentionRuntimeLaunches});
    if (!launch) {
      toast(runtimeText('noDue'));
      return;
    }
    const started = runtimeSurfaceRegistry.get(launch.surface).startRetention(
      runtimeSurfaceContext,
      launch,
      {
        announce: (count) => runtimeText('startingReview', { count }),
        enterOnEmpty: false,
      },
    );
    if (!started) toast(runtimeText('noDue'));
    }); } catch { toast(runtimeText('saveError')); }
  }, [closeMenus, enterReview, retentionRuntimeLaunches, runtimeSurfaceContext, toast, closeExample]);

  // MVP Mixed intent uses the same two proven runtimes in sequence: due Review
  // comes first, then ready Acquisition continues without returning home.
  const startMixedLearning = useCallback(() => {
    try { runtimeCheckpoint.atomic(() => {
    closeMenus();
    closeExample();
    enterLearn();

    const newTargetIds = [...plannedInitialTargetIds];
    const launch = retentionRuntimeLaunches[0];
    runtimeCheckpoint.update({retentionPlan:retentionRuntimeLaunches});

    if (launch) {
      setPendingMixedTargets(newTargetIds.length > 0 ? newTargetIds : null);
      const started = runtimeSurfaceRegistry.get(launch.surface).startRetention(
        runtimeSurfaceContext,
        launch,
        {
          announce: (count) => runtimeText('startingReview', { count }),
          // 混合流照旧进入复习 Runtime，即使这一组已经没有到期项。
          enterOnEmpty: true,
        },
      );
      if (started) return;
    }

    setPendingMixedTargets(null);
    if (newTargetIds[0]) {
      beginInitialTargetRuntime(newTargetIds[0]);
      return;
    }

    toast(runtimeText('sessionDone'));
    }); } catch { toast(runtimeText('saveError')); }
  }, [
    beginInitialTargetRuntime,
    closeMenus,
    enterLearn,
    retentionRuntimeLaunches,
    runtimeSurfaceContext,
    plannedInitialTargetIds,
    toast,
    closeExample,
  ]);

  // 退出学习回首页
  const exitLearn = useCallback(() => {
    closeExample(); closeMenus();
    if(flowMode!=='demo') {
      const hasTask=flowMode==='review'?!!reviewSession:!!learnSession;
      setPausedLightweightFlow(hasTask?'study':null);
      if(!hasTask)runtimeCheckpoint.update({lastFlow:null});
    }
    returnHome();
  }, [flowMode, reviewSession, learnSession, closeExample, closeMenus, setPausedLightweightFlow, returnHome]);

  const exitStructuredSummary = useCallback(() => {
    try { runtimeCheckpoint.atomic(()=>{
      runtimeCheckpoint.update({lastFlow:null,pausedFlow:null,cardDraft:undefined,...(flowMode==='learn'?{learnQueue:undefined}:{reviewQueue:undefined})});
      setPausedLightweightFlow(null);
      if(flowMode==='learn')finishInitialRun('structured_session');
      runtimeCheckpoint.afterCommit(returnHome);
    }); } catch { toast(runtimeText('saveError')); }
  },[flowMode,finishInitialRun,returnHome,setPausedLightweightFlow,toast]);

  const exitLightweightRuntime = useCallback(() => {
    setPausedLightweightFlow('lightweight');
    returnHome();
  }, [returnHome]);

  const completeLightweightRuntime = useCallback((
    rating: Exclude<PrototypeLightweightRating, 'again'>,
  ) => {
    if (!lightweightInitialTargetId) return;
    const targetId = lightweightInitialTargetId;
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    const policy = journeyFor(journey, targetId).committedPolicy;
    if (!policy) return;
    const completedAt = new Date().toISOString();
    // 轻量首学的交接落点由 committed Policy 的 retention store 决定，不看这块界面
    // 自己是什么：轻量首学 + 调度器保持是合法组合，交接就要开一条调度记忆。
    const store = retentionStoreRegistry.get(retentionStoreForPolicy(policy));
    const handoff = store.openHandoff({
      completedAt,
      openSchedulerDue: () => {
        const retentionTargetId = defaultRetentionTargetIdFor(target);
        const existing = storageService.getFSRSItems()[retentionTargetId];
        return (
          existing ?? storageService.graduateRetentionTarget(retentionTargetId, 0)
        ).due;
      },
      reviewLabel: relativeReviewLabel,
    });

    dispatchJourney({
      type: 'completeProtocolInitial',
      targetId,
      rating,
      completedAt,
      nextReviewAt: handoff.nextReviewAt,
      nextReviewLabel: handoff.nextReviewLabel,
      startLightweightRetention: store.opensJourneyLadder,
    });
  }, [dispatchJourney, journey, lightweightInitialTargetId]);

  const handleLightweightInitialRating = useCallback((rating: PrototypeLightweightRating) => {
    try {
      runtimeCheckpoint.atomic(()=>{
        const result=rateLightweightInitial(rating);
        if(!result||rating==='again')return;
        if(!result.state.progress.completed)throw Error('Incomplete protocol result');
        completeLightweightRuntime(rating);
      });
    } catch {toast(runtimeText('saveError'));}
  },[completeLightweightRuntime,rateLightweightInitial,toast]);

  const finishLightweightRuntime = useCallback(() => {
    if (!lightweightInitialTargetId) return;
    const hasNextTarget = lightweightInitialTargetIds.length > 1;
    try {
      runtimeCheckpoint.atomic(() => {
        runtimeCheckpoint.update({lastFlow:hasNextTarget?'lightweight':null});
        setPausedLightweightFlow(null);
        finishInitialTarget('lightweight_initial', lightweightInitialTargetId);
      });
    } catch { toast(runtimeText('saveError')); return; }
    if (hasNextTarget) {
      toast(runtimeText('nextToast'));
      return;
    }
    returnHome();
    toast(runtimeText('initialToast'));
  }, [
    finishInitialTarget,
    lightweightInitialTargetId,
    lightweightInitialTargetIds.length,
    returnHome,
    toast,
  ]);

  const exitFourStageRuntime = useCallback(() => {
    setViewMode('main');
    setMainStack(['s-study', 's-learning-library']);
  }, []);

  const completeFourStageRuntime = useCallback((
    completionItems: readonly FourStageCompletionItem[],
  ) => {
    const completedAt = new Date().toISOString();
    const completedRetentionTargetIds = completionItems.map(({ targetId }) =>
      defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]));
    completionItems.forEach(({ targetId, mistakeCount }) => {
      const policy = journeyFor(journey, targetId).committedPolicy;
      if (!policy || retentionStoreForPolicy(policy) !== 'scheduler_memory') return;
      const retentionTargetId = defaultRetentionTargetIdFor(
        PROTOTYPE_LEARNING_TARGETS[targetId],
      );
      if (!storageService.getFSRSItems()[retentionTargetId]) {
        storageService.graduateRetentionTarget(retentionTargetId, mistakeCount);
      }
    });
    const memoryItems = storageService.getFSRSItems();
    dispatchJourney({
      type: 'recordQueueInitialCompletions',
      completedRetentionTargetIds,
      dueByRetentionTargetId: Object.fromEntries(
        Object.values(memoryItems).map((item) => [item.memoryKey, item.due]),
      ),
      completedAt,
      now: Date.now(),
    });
  }, [dispatchJourney, journey]);

  const finishFourStageRuntime = useCallback(() => {
    finishInitialRun('interleaved_four_stage');
    setViewMode('main');
    resetMain();
    toast('四阶段首次学习已完成，后续由长期记忆调度安排复习');
  }, [finishInitialRun, resetMain, toast]);

  const exitLightweightReview = useCallback(() => {
    setPausedLightweightFlow('lightweightReview');
    returnHome();
  }, [returnHome]);

  const completeLightweightReviewTarget = useCallback((
    targetId: PrototypeLearningTargetId,
    rating: PrototypeLightweightRating,
  ) => {
    const reviewedAt = new Date();
    const outcome = resolveLearnerRatedMemoryOutcome(rating);
    const schedule = LIGHTWEIGHT_REVIEW_SCHEDULE[outcome.grade];
    dispatchJourney({
      type: 'recordLightweightReview',
      targetId,
      outcome,
      reviewedAt: reviewedAt.toISOString(),
      nextReviewAt: new Date(reviewedAt.getTime() + schedule.delayMs).toISOString(),
      nextReviewLabel: schedule.nextReviewLabel,
    });
  }, [dispatchJourney]);

  const completeLightweightReviewRepair = useCallback((
    targetId: PrototypeLearningTargetId,
  ) => {
    dispatchJourney({ type: 'clearLightweightRelearning', targetId });
  }, [dispatchJourney]);

  const exitFourStageReview = useCallback(() => {
    setViewMode('main');
    resetMain();
  }, [resetMain]);

  const recordFourStageMemoryOutcome = useCallback((
    targetId: PrototypeLearningTargetId,
    outcome: GradedMemoryOutcome,
  ) => {
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    const runtimePackage = runtimePackageForTarget(target);
    if (!runtimePackage) throw new Error(`Four-stage Review content is unavailable for ${targetId}.`);
    const retentionTargetId = defaultRetentionTargetIdFor(target);
    const memory = storageService.getFSRSItems()[retentionTargetId];
    if (!memory) throw new Error(`Four-stage Review lacks Memory State for ${targetId}.`);
    const occurredAt = new Date().toISOString();
    const settlement = storageService.settleRetentionReview({
      outcomeKey: `four-stage-review:${retentionTargetId}:${memory.lastReview}:${memory.due}`,
      packageId: runtimePackage.packageId,
      senseId: runtimePackage.senseId,
      retentionTargetId,
      actionKey: 'interleaved-four-stage-self-rating-v1',
      memoryOutcome: outcome,
      repairTarget: {
        kind: 'protocol_checkpoint',
        checkpointId: 'four-stage:final-recall',
      },
    });
    dispatchJourney({
      type: 'recordStructuredRetention',
      targetId,
      occurredAt,
      counted: settlement.applied,
      outcome: settlement.applied ? outcome.basis : null,
      dueAt: settlement.memoryState.due,
      lapses: settlement.memoryState.lapses,
      relearningStage: settlement.relearningCycle?.stage ?? null,
      retestPassed: false,
      now: Date.now(),
    });
  }, [dispatchJourney]);

  const completeFourStageRelearning = useCallback((targetId: PrototypeLearningTargetId) => {
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    const retentionTargetId = defaultRetentionTargetIdFor(target);
    const cycle = storageService.getRelearningCycle(retentionTargetId);
    if (!cycle) return;
    storageService.applyRelearningProgress({
      event: 'retest_passed',
      retentionTargetId,
      cycle,
    });
    const memory = storageService.getFSRSItems()[retentionTargetId]!;
    dispatchJourney({
      type: 'recordStructuredRetention',
      targetId,
      occurredAt: new Date().toISOString(),
      counted: false,
      outcome: null,
      dueAt: memory.due,
      lapses: memory.lapses,
      relearningStage: null,
      retestPassed: true,
      now: Date.now(),
    });
  }, [dispatchJourney]);

  // 演示跳转：新学卡 + 长期 Review 评测目录。
  // 屏号到演示内容的映射是纯的，见 learningFlow/demoScenes.ts；这里只负责施加副作用。
  const showStage = useCallback((stageNum: number) => {
    const scene = demoSceneForStage(stageNum);
    if (!scene) return;
    closeMenus();
    closeExample();
    setViewMode('study');
    enterDemo(scene.presentation);
    overrideDemoQueue(scene.queue.pkg, scene.queue.capability, scene.queue.step, scene.queue.total);
    toast(scene.toast);
  }, [closeMenus, enterDemo, overrideDemoQueue, toast, closeExample]);

  const handleCompleteIntroduction = useCallback(() => {
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({ stage: 'recognition', word: demoWordFor(pkg, 1) });
      overrideDemoQueue(pkg, 'contextual_recognition', 2, 4);
      toast('这个义项已建立初次连接，稍后会在新语境中再次出现');
      return;
    }
    if (flowMode === 'review' && reviewSession?.action.intent === 'repair') {
      completeReviewRepair();
      return;
    }
    if (flowMode === 'learn' && learnSession?.action.intent === 'repair') {
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
        case null:
          throw new Error('An Introduction Step cannot be an acquisition repair.');
      }
      toast(t('assurance.completeRepair'));
      return;
    }
    completeLearnIntroduction();
  }, [
    flowMode,
    learnSession,
    reviewSession,
    advanceDemo,
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
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({
        stage: correct ? 'recall' : 'recognition',
        word: demoWordFor(pkg, correct ? 2 : 1),
      });
      overrideDemoQueue(
        pkg,
        correct ? 'meaning_to_form_recall' : 'contextual_recognition',
        (learnSession?.index ?? 2) + 1,
        learnSession?.totalTarget ?? 4,
      );
    } else {
      completeLearnRecognition(correct);
    }
    toast(correct ? t('assurance.correct') : t('assurance.continueLater'));
  }, [flowMode, learnSession, advanceDemo, overrideDemoQueue, completeLearnRecognition, toast]);

  const handleCompleteMeaningToFormRecall = useCallback((
    outcome: MeaningToFormRecallOutcome,
  ) => {
    const independentlyRecalled = outcome === 'independent';
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({
        stage: independentlyRecalled ? 'transfer' : 'recall',
        word: demoWordFor(pkg, independentlyRecalled ? 3 : 2),
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
        ? t('assurance.correct')
        : t('assurance.continueLater'),
    );
  }, [
    flowMode,
    learnSession,
    advanceDemo,
    overrideDemoQueue,
    completeLearnMeaningToFormRecall,
    toast,
  ]);

  const handleCompleteNovelTransfer = useCallback((outcome: NovelTransferOutcome) => {
    const succeeded = outcome === 'success';
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({
        stage: 'transfer',
        word: demoWordFor(pkg, succeeded ? 4 : 3, succeeded),
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
        ? t('assurance.correct')
        : t('assurance.continueLater'),
    );
  }, [flowMode, learnSession, advanceDemo, overrideDemoQueue, completeLearnNovelTransfer, toast]);

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
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({
        stage: 'review_feedback',
        word: demoWordFor(pkg, 4, true),
        reviewKind: result.kind,
        reviewResult: result,
      });
    } else if (flowMode === 'learn' && learnSession?.action.capability === 'boundary_discrimination') {
      completeLearnBoundary(result.correct);
    } else {
      settleReviewQueue(result);
    }
    toast(
      result.correct
        ? canonicalMemoryOutcome?.basis === 'transfer_confirmed'
          ? t('assurance.correct')
          : t('assurance.correct')
        : t('assurance.retry'),
    );
  }, [
    flowMode,
    learnSession,
    reviewSession,
    advanceDemo,
    completeLearnBoundary,
    settleReviewQueue,
    toast,
  ]);

  // 熟词标记
  const handleMarkKnown = useCallback(() => {
    try { runtimeCheckpoint.atomic(()=>{
    if (flowMode === 'demo') {
      markKnownLearnQueue();
      toast(t('assurance.declared'));
      return;
    }
    const retentionTargetId = flowMode === 'review'
      ? reviewSession?.package.retentionTargetId
      : learnSession?.package.retentionTargetId;
    const targetId = retentionTargetId
      ? TARGET_ID_BY_RETENTION_TARGET.get(retentionTargetId)
      : undefined;
    if (!retentionTargetId || !targetId) return;
    dispatchJourney({ type: 'declareMastery', retentionTargetIds: [retentionTargetId] });
    if (flowMode === 'review') {
      excludeCurrentReviewForDeclaredMastery();
    } else {
      markKnownLearnQueue();
    }
    toast(t('assurance.declared'));
    }); } catch { toast(runtimeText('saveError')); }
  }, [
    excludeCurrentReviewForDeclaredMastery,
    flowMode,
    learnSession,
    markKnownLearnQueue,
    reviewSession,
    toast,
  ]);

  const revokeDeclaredMastery = useCallback((targetId: PrototypeLearningTargetId) => {
    const retentionTargetId = defaultRetentionTargetIdFor(
      PROTOTYPE_LEARNING_TARGETS[targetId],
    );
    dispatchJourney({ type: 'revokeMastery', retentionTargetIds: [retentionTargetId] });
    setLearnDeclaredMastery(
      defaultRetentionTargetIdFor(PROTOTYPE_LEARNING_TARGETS[targetId]),
      false,
    );
    toast(t('assurance.continue'));
  }, [setLearnDeclaredMastery, toast]);

  // 撤回上一词
  const handleUndoWord = useCallback(() => {
    if (flowMode === 'review') {
      const prev = undoReviewQueue();
      if (!prev) {
        toast(t('assurance.noTask'));
      } else {
        toast(t('assurance.undo'));
      }
    } else {
      const prev = undoLearnQueue();
      if (!prev) {
        toast(t('assurance.noTask'));
      } else {
        toast(t('assurance.undo'));
      }
    }
  }, [flowMode, undoReviewQueue, undoLearnQueue, toast]);

  const continueMixedAfterReview = useCallback(() => {
    const pendingTargetIds = pendingMixedTargetRef.current;
    if (!pendingTargetIds?.length) return false;

    closeExample();
    const started = beginInitialTargetRuntime(pendingTargetIds[0]);
    if (started) {
      setPendingMixedTargets(null);
      toast(runtimeText('continueNewToast'));
    }
    return started;
  }, [beginInitialTargetRuntime, toast, closeExample]);

  /**
   * 跑完一组到期复习后，按 `planRetention` 的顺序接上下一组。
   *
   * 此前这里写的是"找那个 surface 是 structured_session 的 launch"，等于把
   * 组间交接写死成"轻量之后一定是结构化"。改成顺序推进后，交接对 surface
   * 的种类和数量都不敏感；跑完的是哪一组，由会话状态里那条复习运行回答，
   * 不再要调用方自报家门。
   */
  const startNextRetentionGroup = useCallback((): boolean => {
    const sessionPlan = runtimeCheckpoint.read().retentionPlan ?? retentionRuntimeLaunches;
    const finishedIndex = sessionPlan.findIndex(
      (launch) => launch.surface === retentionRunSurface,
    );
    // 能跑完某组，说明它在本次 plan 里；找不到时不猜，交给调用方收尾。
    const nextLaunch = finishedIndex < 0
      ? undefined
      : sessionPlan[finishedIndex + 1];
    if (!nextLaunch) return false;
    return runtimeSurfaceRegistry.get(nextLaunch.surface).startRetention(
      runtimeSurfaceContext,
      nextLaunch,
      {
        announce: (count) => `当前复习组已完成，继续处理 ${count} 个复习`,
        enterOnEmpty: true,
      },
    );
  }, [retentionRuntimeLaunches, retentionRunSurface, runtimeSurfaceContext]);

  const finishStructuredRetentionRuntime = useCallback(() => {
    return runtimeCheckpoint.atomic(()=>{
    // 与轻量复习的收尾同一条顺序：先交接下一组，再回混合流，最后才是结算。
    if (startNextRetentionGroup()) return;
    finishRetentionRunSession();
    if (continueMixedAfterReview()) return;

    showRetentionSummary({
      retainingTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RETENTION_TARGET.get(target.retentionTargetId);
        return targetId && target.status === 'retaining' && !target.relearningCompleted
          ? [targetId]
          : [];
      }),
      relearningCompletedTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RETENTION_TARGET.get(target.retentionTargetId);
        return targetId && target.status === 'retaining' && target.relearningCompleted
          ? [targetId]
          : [];
      }),
      declaredMasteryTargetIds: retentionRuntimeProjection.targets.flatMap((target) => {
        const targetId = TARGET_ID_BY_RETENTION_TARGET.get(target.retentionTargetId);
        return targetId && target.status === 'declared_mastery' ? [targetId] : [];
      }),
    });
    runtimeCheckpoint.afterCommit(()=>setViewMode('finish'));
    });
  }, [
    continueMixedAfterReview,
    finishRetentionRunSession,
    retentionRuntimeProjection,
    showRetentionSummary,
    startNextRetentionGroup,
  ]);


  const finishLightweightReview = useCallback(() => {
    try {
      runtimeCheckpoint.atomic(() => {
        runtimeCheckpoint.update({lastFlow:null});
        setPausedLightweightFlow(null);
        if (startNextRetentionGroup()) return;
        finishRetentionRunSession();
        if (continueMixedAfterReview()) return;
        runtimeCheckpoint.afterCommit(() => {
          returnHome();
          toast(runtimeText('reviewToast'));
        });
      });
    } catch { toast(runtimeText('saveError')); }
  }, [
    continueMixedAfterReview,
    returnHome,
    startNextRetentionGroup,
    toast,
    finishRetentionRunSession,
  ]);

  // 下一词
  const handleNextWord = useCallback(() => {
    if (flowMode === 'review') {
      if (reviewDone) {
        closeExample();
        finishStructuredRetentionRuntime();
        return;
      }
      nextReviewQueue();
    } else {
      if (queueDone) {
        closeExample();
        persistGraduatedSenses();
        runtimeCheckpoint.afterCommit(()=>setViewMode('finish'));
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
    closeExample,
  ]);

  const handleContinueReviewFeedback = useCallback(() => {
    if (flowMode === 'demo') {
      const pkg = learnSession?.package ?? PROTOTYPE_RUNTIME_PACKAGES[0];
      if (!pkg) return;
      advanceDemo({
        stage: 'review_assessment',
        word: demoWordFor(pkg, 4, true),
        reviewResult: null,
      });
      overrideDemoQueue(pkg, 'contextual_recognition', 1, 1);
      toast('可从右侧 Review 目录继续查看其他评测卡');
      return;
    }
    handleNextWord();
  }, [flowMode, learnSession, advanceDemo, overrideDemoQueue, handleNextWord, toast]);

  // 监听整组学习完成或复习完成自动切至结算页
  useEffect(() => {
    if (viewMode === 'study') {
      if (flowMode === 'learn' && queueDone && (!learnSession || learnSession.settled)) {
        closeExample();
        persistGraduatedSenses();
        runtimeCheckpoint.afterCommit(()=>setViewMode('finish'));
      } else if (flowMode === 'review' && reviewDone && (!reviewSession || reviewSession.settled)) {
        closeExample();
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

  // 当前用于渲染的词与阶段
  const currentPackage: RuntimePackage | null = demo
    ? demo.pkg
    : flowMode === 'review' && reviewSession
    ? reviewSession.package as RuntimePackage
    : learnSession
    ? learnSession.package as RuntimePackage
    : PROTOTYPE_RUNTIME_PACKAGES[0] ?? null;
  const rawIntroductionContent = currentPackage?.content ?? null;
  const currentRepairAction = flowMode === 'review'
    ? reviewSession?.action ?? null
    : flowMode === 'learn'
    ? learnSession?.action ?? null
    : null;
  const currentIntroductionContent = currentPackage
    ? currentRepairAction?.intent === 'repair'
      ? materializeReviewRepairContent(rawIntroductionContent!, currentRepairAction.repairResourceRef)
      : currentPackage.content
    : null;
  const currentWord: Word = demo
    ? demo.word
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

  /**
   * 这一步渲染哪张卡：读编排盖的章，不再由这里推。
   *
   * 落地前这里是三段公式：复习流读 `session.stage`，首学流拿 capability 过
   * `stageForCapability`，外面再套一层 `intent === 'repair' → review_repair`。
   * 三段现在都由 `stepKind` 回答——修复步的章本来就是 `review_repair`，
   * 反馈相位由复习会话自己改章。
   */
  const currentStage: LearningStepKind = demo
    ? demo.stage
    : flowMode === 'review' && reviewSession
    ? reviewSession.stepKind
    : learnSession
    ? learnSession.action.stepKind
    : 'introduction';

  const currentIntroductionPosition = currentIntroductionContent
    ? PROTOTYPE_INTRODUCTION_PACKAGES.findIndex(
        (content) => content.packageKey === currentIntroductionContent.packageKey,
      ) + 1
    : 0;

  const currentReviewAssessmentKind = flowMode === 'review'
    ? reviewSession?.assessmentKind ?? null
    : demo
    ? demo.reviewKind
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
    : demo
    ? demo.reviewResult
    : null;

  // 选中的这条 Target：一次查找，而不是从八个平行 map 里各取一次。
  const selectedJourney = journeyFor(journey, selectedLearningTargetId);
  const selectedPrototypeLearningTarget =
    PROTOTYPE_LEARNING_TARGETS[selectedLearningTargetId];
  const selectedPrototypeLearningPolicy = effectivePolicyFor(journey, selectedLearningTargetId);
  const selectedPrototypePreparation = preparationFor(
    journey,
    selectedLearningTargetId,
    selectedPrototypeLearningPolicy,
  );
  const selectedCommittedPolicy = selectedJourney.committedPolicy;
  const selectedLightweightRetention = selectedJourney.lightweightRetention;
  const selectedInitialLearningCompletion = selectedJourney.initialCompletion;
  const selectedStructuredRetention = selectedJourney.structuredRetention;
  const selectedInitialCompletionKind = selectedInitialLearningCompletion?.completionKind ?? null;
  const selectedReviewDue = selectedLightweightRetention
    ? selectedLightweightRetention.relearning
      || Date.parse(selectedLightweightRetention.nextReviewAt) <= Date.now()
    : structuredReviewDueTargetIds.includes(selectedLearningTargetId);
  const selectedRetentionRuntimeState = retentionRuntimeProjection.targets.find((target) =>
    target.retentionTargetId === defaultRetentionTargetIdFor(
      selectedPrototypeLearningTarget,
    ))?.status ?? null;
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
  const visibleDeclaredMasteryTargetIds = new Set(
    visibleLearningTargetIds.filter((targetId) => isDeclaredMastery(journey, targetId)),
  );
  const selectedDeclaredMastery = visibleDeclaredMasteryTargetIds.has(selectedLearningTargetId);
  const policyTarget = learningPolicyContext.kind === 'target'
    ? PROTOTYPE_LEARNING_TARGETS[learningPolicyContext.targetId]
    : null;
  const selectedPolicyForPolicyScreen = learningPolicyContext.kind === 'target'
    ? effectivePolicyFor(journey, learningPolicyContext.targetId)
    : defaultLearningPolicy;
  const activeLightweightRuntimeTarget = lightweightInitialTargetId
    ? PROTOTYPE_LEARNING_TARGETS[lightweightInitialTargetId]
    : null;
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

  /**
   * 卡片的宿主能力面：App 提供一份，所有 stepKind 的卡共用，合同见
   * learningRuntime/stepRenderers.tsx。落地前这些接线以十余个 prop 的形态
   * 摊在 LearnScreen 上；现在收进一份，LearnScreen 只保留自己的工具栏回调。
   */
  const stepRendererHost = useMemo<StepRendererHost>(() => ({
    toast,
    openExample,
    openDict: openDictModal,
    openNoteEditor,
    openSceneEditor: (content, anchorId) => {
      setSceneEditorTarget({ content, anchorId });
    },
    lookupDictionary: lookupDictionaryEntry,
    completeIntroduction: handleCompleteIntroduction,
    completeRecognition: handleCompleteRecognition,
    completeMeaningToFormRecall: handleCompleteMeaningToFormRecall,
    completeNovelTransfer: handleCompleteNovelTransfer,
    completeReviewAssessment: handleCompleteReviewAssessment,
    continueReviewFeedback: handleContinueReviewFeedback,
  }), [
    toast,
    openExample,
    openDictModal,
    openNoteEditor,
    setSceneEditorTarget,
    handleCompleteIntroduction,
    handleCompleteRecognition,
    handleCompleteMeaningToFormRecall,
    handleCompleteNovelTransfer,
    handleCompleteReviewAssessment,
    handleContinueReviewFeedback,
  ]);



  return (
    <DictionaryPresentationProvider presentation={dictionaryPresentation}>
      <IconSprite />

      {checkpointError && <div role="alert" className="fixed inset-x-4 top-4 z-[9999] mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t('runtime.' + checkpointError)}</div>}
      <WebShell
        current={mainStack[mainStack.length - 1] ?? 's-home'}
        focused={viewMode !== 'main'}
        onNavigate={(id) => setMainStack(id === 's-home' ? [] : [id])}
      >
          {/* ================= 主页面体系 (Main Shell) ================= */}
          {/* 1. 首页 */}
          <HomeScreen
            active={viewMode === 'main'}
            onGo={goMain}
            onResume={pausedLightweightFlow ? () => { setViewMode(pausedLightweightFlow); setPausedLightweightFlow(null); } : undefined}
            onStartMixed={startMixedLearning}
            onStartReview={pausedLightweightFlow === 'lightweightReview' || (pausedLightweightFlow === 'study' && runtimeCheckpoint.read().structuredMode === 'review') ? () => { setViewMode(pausedLightweightFlow!); setPausedLightweightFlow(null); } : startReview}
            reviewDueN={totalReviewCount}
            onRecordContext={() => goMain('s-semantic-world', { worldAction: 'create' })}
            mixedReadyN={plannedInitialTargetIds.length + totalReviewCount}
          />

          {/* 2. 自由练习 */}
          <AcademyScreen
            active={viewMode === 'main' && mainStack.includes('s-academy')}
            onBack={backMain}
            onOpenPracticeScope={() => goMain('s-practice-scope')}
            onOpenRealWorldListening={openRealWorldListening}
            practiceScope={practiceScopeCatalog.currentScope}
          />

          {/* 2.1 自由练习范围：来源选择与 Personal Meaning target 选择 */}
          <PracticeScopeScreen
            active={viewMode === 'main' && mainStack.includes('s-practice-scope')}
            catalog={practiceScopeCatalog}
            onBack={backMain}
            onSelectScope={selectScope}
          />

          {/* 3. 我的内容 */}
          <ContentScreen
            active={viewMode === 'main' && (mainStack.includes('s-content') || mainStack.includes('s-semantic-world'))}
            screenId={mainStack.includes('s-semantic-world') ? 's-semantic-world' : 's-content'}
            initialAction={params.worldAction === 'create' ? 'create' : undefined}
            onBrowseExisting={() => goMain('s-learning-entry')}
            onOpenPersonalMeaning={openPersonalMeaning}
            onOpenConfirmedSense={openConfirmedSense}
            onOpenSense={openSemanticWorldSense}
            onOpenSection={openContentSection}
            toast={toast}
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

          {/* 3.8 自由练习 / 真实语流泛化（YouGlish，按 Expression form 检索） */}
          <YouGlishListeningScreen
            active={viewMode === 'main' && mainStack.includes('s-real-world-listening')}
            targets={(activePracticeScope ?? practiceScopeCatalog.currentScope).targets}
            onBack={backMain}
            toast={toast}
          />

          {/* 4. 我的学习 / 学习偏好 */}
          <StudyScreen
            active={viewMode === 'main' && mainStack.includes('s-study')}
            tab={studyTab}
            onTabChange={setStudyTab}
            onAddLearning={() => goMain('s-learning-entry')}
            onOpenTargetLibrary={() => goMain('s-learning-library')}
            onOpenTarget={openLearningTarget}
            onPolicyChange={policy => dispatchJourney({ type: 'selectDefaultPolicy', policy })}
            defaultPolicy={defaultLearningPolicy}
            learningTargetCount={visibleLearningTargetIds.length}
            readyInitialCount={plannedInitialTargetIds.length}
            reviewCount={totalReviewCount}
            dailyNewCount={dailyNewCount}
            learningRecords={learningRecords}
            onOpenStats={() => goMain('s-stats')}
            onDailyNewCountChange={setDailyNewCount}
          />

          {/* 4.1 Target 库：主页只保留入口，具体内容在此展开 */}
          <LearningTargetLibraryScreen
            active={viewMode === 'main' && mainStack.includes('s-learning-library')}
            targetIds={visibleLearningTargetIds}
            policyByTarget={effectivePolicies(journey)}
            preparationByTarget={preparations(journey)}
            committedTargetIds={committedTargetIds(journey)}
            completedTargetIds={completedTargetIds(journey)}
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
            declaredMasteryTargetIds={visibleDeclaredMasteryTargetIds}
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
            isAdded={selectedJourney.added}
            onBack={backMain}
            onAdd={addSelectedLearningTarget}
            onOpenPolicy={openTargetLearningPolicy}
            onOpenSource={openLearningSource}
            onRefreshPreparation={refreshSelectedTargetPreparation}
            onGoHome={resetMain}
            onStartReview={startReview}
            onContinueRetentionRuntime={() => {
              enterReview();
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
            records={learningRecords}
            onOpenTarget={openLearningTarget}
          />

          {/* 5. 个人中心 */}
          <ProfileScreen
            active={viewMode === 'main' && mainStack.includes('s-profile')}
            onGoStudyPlan={() => {
              setStudyTab('a');
              goMain('s-study');
            }}
            defaultPolicy={defaultLearningPolicy}
            dailyNewCount={dailyNewCount}
            onPolicyChange={policy => dispatchJourney({ type: 'selectDefaultPolicy', policy })}
            onDailyNewCountChange={setDailyNewCount}
          />

          {/* 5.1 轻量首次运行入口：创建运行即提交并锁定 Learning Policy。 */}
          <LightweightRuntimeStartScreen
            active={viewMode === 'lightweight'}
            target={activeLightweightRuntimeTarget}
            materialization={lightweightInitialMaterialization}
            step={lightweightInitialProtocolStep}
            completed={lightweightInitialProtocolState?.progress.completed ?? false}
            hasNextTarget={lightweightInitialTargetIds.length > 1}
            onExit={exitLightweightRuntime}
            onReveal={() => { try {revealLightweightExpression();} catch {toast(runtimeText('saveError'));} }}
            onRate={handleLightweightInitialRating}
            onFinish={finishLightweightRuntime}
          />

          {/* 5.2 轻量长期复习：一次 due Review 只记录一次结果，遗忘后单独完成修复。 */}
          {lightweightReviewTargetIds.length > 0 && (
            <LightweightReviewRuntimeScreen
              active={viewMode === 'lightweightReview'}
              targetIds={lightweightReviewTargetIds}
              onExit={exitLightweightReview}
              onRateTarget={completeLightweightReviewTarget}
              onCompleteRepair={completeLightweightReviewRepair}
              finishLabel={schedulerReviewCount > 0
                ? t('runtime.continueReview')
                : pendingMixedTargetRef.current?.length
                  ? t('runtime.continueNew')
                  : t('runtime.home')}
              onFinish={finishLightweightReview}
            />
          )}

          {/* 5.3 第三种 Profile：四阶段协议拥有自己的进度、穿插与整轮重置。 */}
          {fourStageInitialTargetIds.length > 0 && (
            <InterleavedFourStageRuntimeScreen
              active={viewMode === 'fourStage'}
              targetIds={fourStageInitialTargetIds}
              onExit={exitFourStageRuntime}
              onComplete={completeFourStageRuntime}
              onFinish={finishFourStageRuntime}
            />
          )}

          {/* 5.4 第三种 Profile 的三向到期复习；Hard 不再被压成 boolean。 */}
          {fourStageReviewTargetIds.length > 0 && (
            <InterleavedFourStageReviewScreen
              active={viewMode === 'fourStageReview'}
              targetIds={fourStageReviewTargetIds}
              relearningTargetIds={new Set(structuredRelearningTargetIds)}
              onExit={exitFourStageReview}
              onMemoryOutcome={recordFourStageMemoryOutcome}
              onRelearningComplete={completeFourStageRelearning}
              onFinish={finishLightweightReview}
            />
          )}

          {/* ================= 独立学习流 (Study Flow) ================= */}
          {/* 6. 单词学习流程 */}
          <LearnScreen
            hasTask={flowMode==='demo'||!!(flowMode==='review'?reviewSession:learnSession)}
            active={viewMode === 'study'}
            isBehind={exampleSheet !== null}
            curWord={currentWord}
            stage={currentStage}
            step={currentStep}
            groupSize={totalTarget}
            introductionContent={rawIntroductionContent}
            repairContent={currentRepairAction?.intent === 'repair'
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
            reviewAssessmentKind={currentReviewAssessmentKind}
            reviewAssessmentTaskKey={currentReviewAssessmentTaskKey}
            assessmentPackageIdentity={currentAssessmentPackageIdentity}
            reviewAssessmentResult={currentReviewAssessmentResult}
            repairResourceRef={currentRepairAction?.intent === 'repair'
              ? currentRepairAction.repairResourceRef ?? null
              : null}
            host={stepRendererHost}
          />

          {/* 7. 原声例句全屏卡 */}
          <ExampleScreen
            active={viewMode === 'study' && exampleSheet !== null}
            curWord={currentWord}
            initialSenseIdx={exampleSheet?.senseIdx ?? 0}
            initialSentenceIdx={exampleSheet?.sentenceIdx ?? 0}
            onClose={closeExample}
            onOpenDict={openDictModal}
            onNextWord={() => {
              closeExample();
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

          {/* ================= 本组结算页 (Finish Flow) ================= */}
          {/* 11. Structured Graduation / Declared Mastery 总结不复用旧词组完成叙事。 */}
          {initialSummary && (
            <StructuredRuntimeSummaryScreen
              active={viewMode === 'finish' && flowMode === 'learn'}
              graduatedTargetIds={initialSummary.graduatedTargetIds}
              declaredMasteryTargetIds={initialSummary.declaredMasteryTargetIds}
              onExit={exitStructuredSummary}
            />
          )}

          {retentionSummary && (
            <StructuredRetentionSummaryScreen
              active={viewMode === 'finish' && flowMode === 'review'}
              retainingTargetIds={retentionSummary.retainingTargetIds}
              relearningCompletedTargetIds={retentionSummary.relearningCompletedTargetIds}
              declaredMasteryTargetIds={retentionSummary.declaredMasteryTargetIds}
              onExit={exitStructuredSummary}
            />
          )}

          {/* 11.1 既有完成页只保留给尚未接入统一总结的旧演示流。 */}
          <FinishScreen
            active={viewMode === 'finish' && (
              flowMode === 'learn'
                ? !initialSummary
                : flowMode === 'review'
                  ? !retentionSummary
                  : true
            )}
            mode={flowMode === 'review' ? 'review' : 'learn'}
            wordCount={
              flowMode === 'review'
                ? reviewStats.completedTargets || reviewStats.totalTargets
                : queueStats.totalTargets
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
            className={uiClass(`mask${menuMoreOpen || menuBookOpen ? ' on' : ''}`, "#mask")}
            id="mask"
            onClick={closeMenus}
          />

          {/* 学习页右上角菜单 */}
          <div className={uiClass(`menu${menuMoreOpen ? ' on' : ''}`, "#menu-more")} id="menu-more">
            {menuPersonalContent && (
              <>
                <div className={uiClass("menu-personal-context")}>
                  <span>{t('assurance.currentMeaning')}</span>
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
                  <svg className={uiClass("icon")}><use href="#i-pen" /></svg>{t('assurance.note')}
                </button>
                <button
                  onClick={() => {
                    const content = menuPersonalContent;
                    const anchorId = menuPersonalAnchors[0]?.anchorId;
                    closeMenus();
                    setSceneEditorTarget({ content, anchorId });
                  }}
                >
                  <svg className={uiClass("icon")}><use href="#i-bulb" /></svg>
                  {t('assurance.personalScene')}
                </button>
                {menuPersonalAnchors.length > 0 && (
                  <button
                    onClick={() => {
                      const content = menuPersonalContent;
                      closeMenus();
                      setSceneEditorTarget({ content });
                    }}
                  >
                    <svg className={uiClass("icon")}><use href="#i-penplus" /></svg>{t('assurance.addScene')}
                  </button>
                )}
                <div className={uiClass("menu-section-divider")} />
              </>
            )}
            <button
              onClick={() => {
                closeMenus();
                setLearningPreferencesOpen(true);
              }}
            >
              <svg className={uiClass("icon")}><use href="#i-sliders" /></svg>{t('assurance.preferences')}
            </button>
          </div>

          {learningPreferencesOpen && viewMode==='study' && <LearningPreferencesPanel
            defaultPolicy={defaultLearningPolicy} dailyNewCount={dailyNewCount}
            onPolicyChange={policy=>dispatchJourney({type:'selectDefaultPolicy',policy})}
            onDailyNewCountChange={setDailyNewCount}
            onClose={closeLearningPreferences}
          />}

          {/* 词书设置菜单 */}
          <div className={uiClass(`menu${menuBookOpen ? ' on' : ''}`, "#menu-book")} id="menu-book">
            <button onClick={() => { closeMenus(); toast('选择学习范围：按词频段 / 章节筛选'); }}>
              <svg className={uiClass("icon")}><use href="#i-filter" /></svg>选择学习范围
            </button>
            <button onClick={() => { closeMenus(); setMainStack(['s-study', 's-learning-library']); }}>
              <svg className={uiClass("icon")}><use href="#i-list" /></svg>查看学习内容
            </button>
            <button onClick={() => { closeMenus(); toast('开始下载离线单词包…'); }}>
              <svg className={uiClass("icon")}><use href="#i-dl" /></svg>下载离线单词包
            </button>
            <button onClick={() => { closeMenus(); toast('重学词书会清空当前进度'); }}>
              <svg className={uiClass("icon")}><use href="#i-relearn" /></svg>重学词书
            </button>
            <button disabled>
              <svg className={uiClass("icon")}><use href="#i-refresh" /></svg>更新词书
            </button>
          </div>

          {/* 全局 Toast 提示 */}
          <div className={uiClass(`toast${toastMsg ? ' on' : ''}`, "#toast")} id="toast">
            {toastMsg}
          </div>
      </WebShell>
    </DictionaryPresentationProvider>
  );
}
