import {localRunPolicy,localTargetPolicy} from '../learning/runtime/localRuntimeBindings';
import {composeLocalLearningRuntime} from './learningRuntime/runtimeComposition';
import {BatchPersonalLearning} from './library/BatchPersonalLearning';
import {localFlowText} from '../i18n/localFlowText';
import {usePersonalLearning} from './library/usePersonalLearning';
import {useLanguageRoutes} from './library/useLanguageRoutes';
import {sensaLanguageDisplayName} from '@sensa/contracts/sensa';
import i18n from '../i18n';
import {
  PersonalLearningControls,
  PersonalPreparationTarget,
  pendingPersonalTargetView,
} from './library/PersonalLearningControls';
import {LearningSetupFrame} from './components/learning/LearningSetupFrame';
import {usePackageLearning} from './library/usePackageLearning';
import {
  PackageEntry,
  PackageTarget,
  PackageRuntime,
  localTargetView,
  localRuntimePresentationRegistry,
} from './library/PackageLearningViews';
import type {AssuranceSupportHost} from './library/AssuranceLearningViews';
import {useLocalMeaningLibrary} from './library/useLocalMeaningLibrary';
import {ProviderPanel} from './components/ProviderPanel';
import {LearningPreferencesPanel} from './components/learning/LearningPreferencesPanel';
import {useTranslation} from 'react-i18next';
import {iconClass} from './ui/primitives';
import {useState,useCallback,useMemo} from 'react';
import {contentAnnotations} from '../data/library/contentAnnotations';
import {lookupDictionaryEntry} from './services/quickDict';
import {IconSprite} from './components/IconSprite';
import {HomeScreen} from './components/HomeScreen';
import {AcademyScreen} from './components/AcademyScreen';
import {PracticeScopeScreen} from './components/PracticeScopeScreen';
import {YouGlishListeningScreen} from './components/YouGlishListeningScreen';
import {ContentScreen} from './components/ContentScreen';
import {ContentLibraryScreen} from './components/ContentLibraryScreen';
import {PersonalMeaningDetailScreen} from './components/PersonalMeaningDetailScreen';
import {ConfirmedSenseDetailScreen} from './components/ConfirmedSenseDetailScreen';
import {ExpressionBindingScreen} from './components/ExpressionBindingScreen';
import {ContentSenseDetailScreen} from './components/ContentSenseDetailScreen';
import {ContentExampleDetailScreen} from './components/ContentExampleDetailScreen';
import {ContentComingSoonScreen} from './components/ContentComingSoonScreen';
import {StudyScreen} from './components/StudyScreen';
import {LearningTargetLibraryScreen} from './components/learning/LearningTargetLibraryScreen';
import {ProfileScreen} from './components/ProfileScreen';
import {DictDetailModal} from './components/DictDetailModal';
import {ReferenceDictionaryScreen} from './components/ReferenceDictionaryScreen';
import {ReferenceExampleViewer} from './components/ReferenceExampleViewer';
import {DictionaryPresentationProvider} from './components/DictionaryPresentationContext';
import {NoteEditorModal} from './components/NoteEditorModal';
import {SceneEditorModal} from './components/SceneEditorModal';
import {StatsScreen} from './components/StatsScreen';
import {WebShell} from './ui/WebShell';
import type {PracticeSenseItem} from './practiceData';
import {usePracticeScope} from './usePracticeScope';
import type {ResolvedPracticeScope} from './practiceScope';
import {
  contentSenseForId,
  isContentSectionId,
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from './contentProjection';
import {useShellNavigation} from './router/useShellNavigation';
import {usePresentationStore} from './stores/presentationStore';
import {useOverlayStore} from './stores/overlayStore';

const localLearningRuntimeComposition=composeLocalLearningRuntime(localRuntimePresentationRegistry);

export default function App() {
  void localLearningRuntimeComposition;
  const { t } = useTranslation();
  const [learningPreferencesOpen,setLearningPreferencesOpen]=useState(false);
  const closeLearningPreferences=useCallback(()=>{
    setLearningPreferencesOpen(false);
    requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.screen.active [data-learning-more]')?.focus());
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
    setMainStack,
  } = useShellNavigation();

  const packageLearning=usePackageLearning(viewMode==='main'&&mainStack.includes('s-learning-entry'));
  const personalLearning=usePersonalLearning();
  const {activeRoute}=useLanguageRoutes();
  const pendingPersonal=personalLearning.tasks.filter(task=>!packageLearning.targets.some(target=>target.id===task.targetId&&target.curriculumMemberships.some(membership=>membership.id===task.curriculumMembershipId)));
  /** What the learner is learning now: the queue, today's new items and the
   * counts beside them. The lists that browse everything keep every language. */
  const activePendingPersonal=pendingPersonal.filter(task=>task.languageContext.languageRouteId===activeRoute.id);
  const selectedPersonalTask=activePendingPersonal.find(t=>t.targetId===params.targetId);
  const localSelectedTarget=packageLearning.activeTargets.find(t=>t.id===params.targetId);
  const localSelectedMembership=localSelectedTarget?packageLearning.membershipByTarget[localSelectedTarget.id]:undefined;
  const openLocalTarget=(id:string)=>goMain('s-learning-target',{targetId:id});
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

  /* ---------- 我的语义世界读取投影与下钻目标 ---------- */
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
  const [clarificationStart, setClarificationStart] = useState<{id:string;draftId:string}|null>(null);
  const localLibrary = useLocalMeaningLibrary(personalMeaningId, viewMode === 'main' && mainStack.includes('s-personal-meaning'), clarificationStart, id=>goMain('s-personal-meaning',{meaningId:id}));
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
    setClarificationStart({id:crypto.randomUUID(),draftId:nextPersonalMeaningId});
    goMain('s-personal-meaning', {
      meaningId: nextPersonalMeaningId,
      focusId: nextMeaningFocusId,
    });
  }, [goMain]);

  const openConfirmedSense = useCallback((nextPersonalMeaningId: string, nextMeaningFocusId: string) => {
    if(localLibrary.source.items.some(item=>item.personalMeaningId===nextPersonalMeaningId)){openPersonalMeaning(nextPersonalMeaningId);return;}
    goMain('s-confirmed-sense', {
      meaningId: nextPersonalMeaningId,
      focusId: nextMeaningFocusId,
    });
  }, [goMain,localLibrary.source.items,openPersonalMeaning]);

  const openExpressionBinding = useCallback(() => {
    goMain('s-expression-binding');
  }, [goMain]);

  const openContentExample = useCallback((item: PracticeSenseItem) => {
    goMain('s-content-example', { exampleId: item.senseId });
  }, [goMain]);

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

  const toastMsg = useOverlayStore((state) => state.toastMsg);
  const toast = useOverlayStore((state) => state.toast);

  const menuMoreOpen = useOverlayStore((state) => state.menuMoreOpen);
  const menuBookOpen = useOverlayStore((state) => state.menuBookOpen);
  const menuPersonalContent = useOverlayStore((state) => state.menuPersonalContent);
  const setMenuMoreOpen = useOverlayStore((state) => state.setMenuMoreOpen);
  const setMenuPersonalContent = useOverlayStore((state) => state.setMenuPersonalContent);
  const closeMenus = useOverlayStore((state) => state.closeMenus);

  const menuPersonalAnchors = menuPersonalContent
    ? contentAnnotations.getSemanticAnchors(menuPersonalContent.senseKey)
    : [];

  /* ---------- Learning Runtime composition ---------- */
  const [studyTab, setStudyTab] = useState<'a' | 'b'>('a');
  const dailyNewCount = packageLearning.dailyLimit ?? 20;
  const [quantityTarget,setQuantityTarget]=useState<string|null>(null);
  const [quantityChoice,setQuantityChoice]=useState(20);
  const quantityTargetRecord=quantityTarget
    ? packageLearning.targets.find(target=>target.id===quantityTarget)
    : undefined;

  const updateLocalQuantity=(value:number)=>{
    void packageLearning.confirmQuantity(value);
  };

  const startLocalLearning=async(id?:string,reviewOnly=false)=>{
    const targetId=id
      ?? packageLearning.run?.targetId
      ?? packageLearning.due[0]?.id
      ?? (!reviewOnly ? packageLearning.initialReady[0]?.id : undefined);
    if(!targetId){
      goMain('s-learning-entry');
      return;
    }
    if(packageLearning.dailyLimit===undefined){
      setQuantityChoice(dailyNewCount);
      setQuantityTarget(targetId);
      return;
    }
    if(await packageLearning.start(targetId,dailyNewCount))setViewMode('lightweight');
  };

  const packageRuntimeHost=useMemo<AssuranceSupportHost>(()=>({
    toast,
    openDict:openDictModal,
    openNoteEditor,
    openSceneEditor:(content,anchorId,learningTarget)=>{
      setSceneEditorTarget({content,anchorId,learningTarget});
    },
    lookupDictionary:lookupDictionaryEntry,
    onOpenMenuMore:(event,content)=>{
      event.stopPropagation();
      closeMenus();
      setMenuPersonalContent(content);
      setMenuMoreOpen(true);
    },
  }),[
    toast,
    openDictModal,
    openNoteEditor,
    setSceneEditorTarget,
    closeMenus,
    setMenuPersonalContent,
    setMenuMoreOpen,
  ]);

  return (
    <DictionaryPresentationProvider presentation={dictionaryPresentation}>
      <IconSprite />

      <WebShell
        current={mainStack[mainStack.length - 1] ?? 's-home'}
        focused={viewMode !== 'main'}
        onNavigate={(id) => setMainStack(id === 's-home' ? [] : [id])}
      >
          {/* ================= 主页面体系 (Main Shell) ================= */}
          {/* 1. 首页 */}
          <HomeScreen active={viewMode==='main'} onGo={goMain}
            busy={packageLearning.busy} status={packageLearning.notice&&<p role="status">{packageLearning.notice}</p>}
            onResume={packageLearning.run?()=>setViewMode('lightweight'):undefined}
            onStartMixed={()=>void startLocalLearning()} onStartReview={()=>void startLocalLearning(undefined,true)}
            reviewDueN={packageLearning.due.length} newAvailable={packageLearning.initialReady.length}
            onRecordContext={()=>goMain('s-semantic-world',{worldAction:'create'})}
            mixedReadyN={packageLearning.initialReady.length+packageLearning.due.length}/>


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

          {/* 3. 我的语义世界 */}
          <ContentScreen
            localLibrary={localLibrary.source}
            bulkLearning={(items,list)=><BatchPersonalLearning items={items} meanings={localLibrary.meanings} c={personalLearning}>{list}</BatchPersonalLearning>}
            onStartConversation={()=>openPersonalMeaning('new')}
            active={viewMode === 'main' && (mainStack.includes('s-content') || mainStack.includes('s-semantic-world'))}
            screenId={mainStack.includes('s-semantic-world') ? 's-semantic-world' : 's-content'}
            initialAction={params.worldAction === 'create' || params.worldAction === 'inbox' ? params.worldAction : undefined}
            onBrowseExisting={() => goMain('s-learning-entry')}
            onOpenPersonalMeaning={openPersonalMeaning}
            onOpenConfirmedSense={openConfirmedSense}
            onOpenSense={openSemanticWorldSense}
            onOpenSection={openContentSection}
            toast={toast}
          />

          {/* 3.1.1 AI 澄清：一段对话收敛 Focus / Sense / Expression，一次确认落三个事实 */}
          {localLibrary.loaded && (!localLibrary.isLocal || localLibrary.conversation) && <PersonalMeaningDetailScreen
            key={personalMeaningId}
            conversation={localLibrary.isLocal ? localLibrary.conversation : undefined}
            learningControls={localLibrary.meaning&&<PersonalLearningControls key={localLibrary.meaning.id} meaning={localLibrary.meaning} c={personalLearning} onStart={id=>void startLocalLearning(id)}/>}
            active={viewMode === 'main' && mainStack.includes('s-personal-meaning')}
            personalMeaningId={personalMeaningId}
            onBack={backMain}
            onOpenConfirmedSense={openConfirmedSense}
            toast={toast}
          />}

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

          {/* 3.2 我的语义世界清单：学习、收藏与笔记读取投影 */}
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
          <StudyScreen policySummary={[...new Set(packageLearning.targets.map(localTargetPolicy))].map(policy=>t('learningPreferences.policies.'+policy)).join(' · ')||undefined}
            active={viewMode === 'main' && mainStack.includes('s-study')}
            tab={studyTab}
            onTabChange={setStudyTab}
            onAddLearning={() => goMain('s-learning-entry')}
            onOpenTargetLibrary={() => goMain('s-learning-library')}
            onOpenTarget={openLocalTarget}
            onPolicyChange={()=>{}}
            defaultPolicy="lightweight" fixedPolicy
            learningTargetCount={packageLearning.activeTargets.length+activePendingPersonal.length}
            languageLabel={sensaLanguageDisplayName(activeRoute.targetLanguageTag,i18n.language==='en'?'en':'zh-CN')}
            readyInitialCount={packageLearning.initialReady.length}
            reviewCount={packageLearning.due.length}
            dailyNewCount={dailyNewCount}
            learningRecords={packageLearning.records}
            onOpenStats={() => goMain('s-stats')}
            onDailyNewCountChange={updateLocalQuantity}
          />

          {/* 4.1 Target 库：主页只保留入口，具体内容在此展开 */}
          <LearningTargetLibraryScreen active={viewMode==='main'&&mainStack.includes('s-learning-library')}
            targets={Object.fromEntries([...packageLearning.activeTargets.map(t=>[t.id,localTargetView(t,packageLearning.membershipByTarget[t.id]!,packageLearning.readinessByTarget[t.id]??'blocked')]),...activePendingPersonal.map(t=>[t.targetId,pendingPersonalTargetView(t)])])}
            targetIds={[...packageLearning.activeTargets.map(t=>t.id),...activePendingPersonal.map(t=>t.targetId)]}
            policyByTarget={Object.fromEntries([...packageLearning.activeTargets.map(t=>[t.id,localTargetPolicy(t)]),...activePendingPersonal.map(t=>[t.targetId,'lightweight' as const])])}
            preparationByTarget={Object.fromEntries([...packageLearning.activeTargets.map(t=>[t.id,packageLearning.readinessByTarget[t.id]??'blocked']),...activePendingPersonal.map(t=>[t.targetId,t.status==='failed'||t.status==='rejected'?'blocked' as const:'preparing' as const])])}
            committedTargetIds={new Set(packageLearning.activeTargets.filter(t=>t.startedAt).map(t=>t.id))}
            completedTargetIds={new Set(packageLearning.activeTargets.filter(t=>t.completedAt).map(t=>t.id))}
            reviewDueTargetIds={new Set(packageLearning.due.map(t=>t.id))}
            relearningTargetIds={new Set(packageLearning.activeTargets.filter(t=>t.relearnAt).map(t=>t.id))}
            reviewingTargetIds={new Set()} relearningRepairTargetIds={new Set()} relearningRetestTargetIds={new Set()} declaredMasteryTargetIds={new Set()}
            onBack={backMain} onAddLearning={()=>goMain('s-learning-entry')} onOpenTarget={openLocalTarget}/>


          {/* 4.2 学习包：列表选择、详情下载与显式加入学习 */}
          <PackageEntry active={viewMode==='main'&&mainStack.includes('s-learning-entry')} c={packageLearning} onBack={backMain} onLearning={()=>setMainStack(['s-study'])} onTarget={openLocalTarget}/>


          {/* 4.3 学习目标详情：来源、方式和准备状态分开表达 */}
          {localSelectedTarget&&localSelectedMembership&&<PackageTarget active={viewMode==='main'&&mainStack.includes('s-learning-target')} target={localSelectedTarget} c={packageLearning} onSource={()=>{const m=localLibrary.meanings.find(m=>m.id===localSelectedMembership.material.snapshot.provenance.meaningId);if(m)openPersonalMeaning(m.draftId);else backMain();}} onBack={backMain} onHome={resetMain} onStart={()=>void startLocalLearning(localSelectedTarget.id)}/>}
          {selectedPersonalTask&&<PersonalPreparationTarget task={selectedPersonalTask} c={personalLearning} onSource={()=>openPersonalMeaning(selectedPersonalTask.meaning.draftId)} active={viewMode==='main'&&mainStack.includes('s-learning-target')} onBack={backMain} onHome={resetMain} onStart={id=>void startLocalLearning(id)}/>}
          {!localSelectedTarget&&!selectedPersonalTask&&viewMode==='main'&&mainStack.includes('s-learning-target')&&<LearningSetupFrame id="s-learning-target" active title={localFlowText('learningTarget')} onBack={backMain}><p role="status">{packageLearning.loaded?localFlowText('targetMissing'):localFlowText('targetLoading')}</p></LearningSetupFrame>}

          {/* 4.5 学习统计概览 (Overview / Stats Screen, 对应图1、图2) */}
          <StatsScreen
            active={viewMode === 'main' && mainStack.includes('s-stats')}
            onBack={backMain}
            records={packageLearning.records}
            onOpenTarget={openLocalTarget}
          />

          {/* 5. 个人中心 */}
          <ProfileScreen
            localLibrary fixedLearningPolicy
            modelSettings={<ProviderPanel/>}
            active={viewMode === 'main' && mainStack.includes('s-profile')}
            onGoStudyPlan={() => {
              setStudyTab('a');
              goMain('s-study');
            }}
            defaultPolicy="lightweight"
            dailyNewCount={dailyNewCount}
            onPolicyChange={()=>{}}
            onDailyNewCountChange={updateLocalQuantity}
          />

          {/* 5.1 轻量首次运行入口：创建运行即提交并锁定 Learning Policy。 */}
          {quantityTarget&&quantityTargetRecord&&(
            <LearningPreferencesPanel fixedPolicy defaultPolicy={localTargetPolicy(quantityTargetRecord)} dailyNewCount={quantityChoice} onPolicyChange={()=>{}} onDailyNewCountChange={setQuantityChoice} busy={packageLearning.busy} status={packageLearning.notice&&<p role="status">{packageLearning.notice}</p>} onClose={()=>setQuantityTarget(null)} closeLabel={localFlowText('confirmAndStart')} onConfirm={()=>void packageLearning.confirmQuantity(quantityChoice).then(async ok=>{if(!ok)return;const target=quantityTarget;setQuantityTarget(null);if(await packageLearning.start(target,quantityChoice))setViewMode('lightweight');})}/>
          )}
          <PackageRuntime host={packageRuntimeHost} active={viewMode==='lightweight'} c={packageLearning} onExit={returnHome} onFinish={()=>void packageLearning.finish().then(async ok=>{if(!ok)return;if(packageLearning.nextTarget){if(await packageLearning.start(packageLearning.nextTarget.id,dailyNewCount))return;}returnHome();})}/>


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
            learningTarget={sceneEditorTarget?.learningTarget}
            onClose={closeSceneEditor}
            toast={toast}
          />

          {/* 全局遮罩与菜单 */}
          <div
            className={`fixed inset-0 z-[70] bg-overlay transition-opacity motion-reduce:transition-none ${menuMoreOpen || menuBookOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            id="mask"
            onClick={closeMenus}
          />

          {/* 学习页右上角菜单 */}
          <div className={`fixed right-5 top-20 z-[80] min-w-64 overflow-hidden rounded-overlay border border-border-subtle bg-surface-raised p-2 text-fg-primary shadow-overlay transition-[opacity,transform,visibility] motion-reduce:transition-none [&>button]:flex [&>button]:min-h-12 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-left [&>button]:text-control-label [&>button]:hover:bg-surface-subtle [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-focus ${menuMoreOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-2 opacity-0'}`} id="menu-more">
            {menuPersonalContent && (
              <>
                <div className="mb-2 rounded-control bg-accent-soft p-3">
                  <span className="block text-metadata text-fg-tertiary">{t('assurance.currentMeaning')}</span>
                  <strong className="mt-1 block font-language text-lg text-action-primary">{menuPersonalContent.lemma}</strong>
                  <small>{menuPersonalContent.guideLabelL1}</small>
                </div>
                <button
                  onClick={() => {
                    const content = menuPersonalContent;
                    closeMenus();
                    openNoteEditor(content.lemma, content.senseKey, content.guideLabelL1);
                  }}
                >
                  <svg className={iconClass} aria-hidden="true"><use href="#i-pen" /></svg>{t('assurance.note')}
                </button>
                <button
                  onClick={() => {
                    const content = menuPersonalContent;
                    const anchorId = menuPersonalAnchors[0]?.anchorId;
                    closeMenus();
                    setSceneEditorTarget({ content, anchorId });
                  }}
                >
                  <svg className={iconClass} aria-hidden="true"><use href="#i-bulb" /></svg>
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
                    <svg className={iconClass} aria-hidden="true"><use href="#i-penplus" /></svg>{t('assurance.addScene')}
                  </button>
                )}
                <button onClick={()=>{const content=menuPersonalContent;closeMenus();openDictModal(content.lemma);}}><svg className={iconClass} aria-hidden="true"><use href="#i-search" /></svg>{t('originalCards.dictionary')}</button>
                <div className="my-2 border-t border-border-subtle" />
              </>
            )}
            <button
              onClick={() => {
                closeMenus();
                setLearningPreferencesOpen(true);
              }}
            >
              <svg className={iconClass} aria-hidden="true"><use href="#i-sliders" /></svg>{t('assurance.preferences')}
            </button>
          </div>

          {learningPreferencesOpen && viewMode==='lightweight' && <LearningPreferencesPanel
            fixedPolicy busy={packageLearning.busy}
            defaultPolicy={packageLearning.run?localRunPolicy(packageLearning.run):'lightweight'} dailyNewCount={dailyNewCount}
            onPolicyChange={()=>{}}
            onDailyNewCountChange={updateLocalQuantity}
            onClose={closeLearningPreferences}
          />}

          {/* 词书设置菜单 */}
          <div className={`fixed right-5 top-20 z-[80] min-w-64 overflow-hidden rounded-overlay border border-border-subtle bg-surface-raised p-2 text-fg-primary shadow-overlay transition-[opacity,transform,visibility] motion-reduce:transition-none [&>button]:flex [&>button]:min-h-12 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-control [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-left [&>button]:text-control-label [&>button]:hover:bg-surface-subtle [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-focus ${menuBookOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-2 opacity-0'}`} id="menu-book">
            <button onClick={() => { closeMenus(); toast(localFlowText('chooseRangeHint')); }}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-filter" /></svg>{localFlowText('chooseRange')}</button>
            <button onClick={() => { closeMenus(); setMainStack(['s-study', 's-learning-library']); }}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-list" /></svg>{localFlowText('viewContent')}</button>
            <button onClick={() => { closeMenus(); toast(localFlowText('downloadingWords')); }}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-dl" /></svg>{localFlowText('downloadWords')}</button>
            <button onClick={() => { closeMenus(); toast(localFlowText('resetBookWarning')); }}>
              <svg className={iconClass} aria-hidden="true"><use href="#i-relearn" /></svg>{localFlowText('relearnBook')}</button>
            <button disabled>
              <svg className={iconClass} aria-hidden="true"><use href="#i-refresh" /></svg>{localFlowText('updateBook')}</button>
          </div>

          {/* 全局 Toast 提示 */}
          <div className={`fixed bottom-6 left-1/2 z-[150] max-w-[calc(100%-3rem)] -translate-x-1/2 rounded-control bg-fg-primary px-5 py-3 text-center text-control-label text-surface-canvas shadow-overlay transition-[opacity,transform,visibility] motion-reduce:transition-none ${toastMsg ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-2 opacity-0'}`} id="toast" role="status" aria-live="polite">
            {toastMsg}
          </div>
      </WebShell>
    </DictionaryPresentationProvider>
  );
}
