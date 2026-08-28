import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react';
import { WORDS } from './data';
import type { Word, LearningStage, QuickDictEntry } from './types';
import { useLearnQueue } from './engine/useLearnQueue';
import { useReviewQueue } from './engine/useReviewQueue';
import type { ReviewAnswerType } from './engine/ReviewQueue';
import { storageService } from './services/storageService';
import { IconSprite } from './components/IconSprite';
import { HomeScreen } from './components/HomeScreen';
import { AcademyScreen } from './components/AcademyScreen';
import { ContentScreen } from './components/ContentScreen';
import { StudyScreen } from './components/StudyScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { LearnScreen } from './components/LearnScreen';
import { ExampleScreen } from './components/ExampleScreen';
import { DictDetailModal } from './components/DictDetailModal';
import { NoteEditorModal } from './components/NoteEditorModal';
import { SpellingModal } from './components/SpellingModal';
import { WordListScreen } from './components/WordListScreen';
import { FinishScreen } from './components/FinishScreen';
import { StatsScreen } from './components/StatsScreen';
import { SidePanel } from './components/SidePanel';

type ViewMode = 'main' | 'study' | 'finish';
type FlowType = 'learn' | 'review' | 'demo';

export default function App() {
  /* ---------- 顶层视图模式 (主页面体系 vs 独立全屏学习流 vs 结算) ---------- */
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  /* ---------- 主页面 Sheet 路由栈 ---------- */
  const [mainStack, setMainStack] = useState<string[]>([]);
  const goMain = useCallback((id: string) => {
    setMainStack((s) => (s.includes(id) ? s : [...s, id]));
  }, []);
  const backMain = useCallback(() => {
    setMainStack((s) => s.slice(0, -1));
  }, []);
  const resetMain = useCallback(() => {
    setMainStack([]);
  }, []);

  // 是否为首页纯净壁纸态（主页面且无弹层），决定状态栏与底条为浅色文字
  const isLight = viewMode === 'main' && mainStack.length === 0;

  /* ---------- 例句全屏卡独立状态 ---------- */
  const [isExampleOpen, setIsExampleOpen] = useState(false);
  const [selectedSenseIdx, setSelectedSenseIdx] = useState(0);

  /* ---------- 柯林斯多维词典大卡片独立状态 ---------- */
  const [dictModalWord, setDictModalWord] = useState<Word | QuickDictEntry | string | null>(null);
  const [dictModalTab, setDictModalTab] = useState<string>('柯林斯');

  const openDictModal = useCallback((word: Word | QuickDictEntry | string, tab = '柯林斯') => {
    setDictModalWord(word);
    setDictModalTab(tab);
  }, []);

  const closeDictModal = useCallback(() => {
    setDictModalWord(null);
  }, []);

  /* ---------- 独立笔记编辑全屏弹窗状态 ---------- */
  const [noteModalWord, setNoteModalWord] = useState<Word | QuickDictEntry | string | null>(null);

  const openNoteEditor = useCallback((word?: Word | QuickDictEntry | string) => {
    if (word) {
      setNoteModalWord(word);
    }
  }, []);

  const closeNoteEditor = useCallback(() => {
    setNoteModalWord(null);
  }, []);

  /* ---------- 独立单词拼写练习弹窗状态 ---------- */
  const [spellingWord, setSpellingWord] = useState<Word | QuickDictEntry | string | null>(null);

  const openSpelling = useCallback((word?: Word | QuickDictEntry | string) => {
    if (word) {
      setSpellingWord(word);
    }
  }, []);

  const closeSpelling = useCallback(() => {
    setSpellingWord(null);
  }, []);

  /* ---------- 全局 Toast ---------- */
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1900);
  }, []);

  /* ---------- 全局弹窗菜单 ---------- */
  const [menuMoreOpen, setMenuMoreOpen] = useState(false);
  const [menuBookOpen, setMenuBookOpen] = useState(false);
  const closeMenus = useCallback(() => {
    setMenuMoreOpen(false);
    setMenuBookOpen(false);
  }, []);

  /* ---------- 业务状态（签到、资产、统计） ---------- */
  const [signed, setSigned] = useState(false);
  const [coins, setCoins] = useState(2470);
  const [streak, setStreak] = useState(0);
  const [studyTab, setStudyTab] = useState<'a' | 'b'>('a');

  const doSign = useCallback(() => {
    if (signed) {
      toast('今天已经签到过啦');
      return;
    }
    setSigned(true);
    setCoins((c) => c + 10);
    setStreak(1);
    toast('签到成功　+10 酷币　连续签到 1 天');
  }, [signed, toast]);

  /* ---------- 流程模式与每日新学词数 ---------- */
  const [flowMode, setFlowType] = useState<FlowType>('learn');
  const [dailyNewCount, setDailyNewCount] = useState<number>(() => storageService.getDailyNewCount());
  const [reviewN, setReviewN] = useState<number>(() => storageService.getDueWords(WORDS).length);

  const refreshReviewCount = useCallback(() => {
    setReviewN(storageService.getDueWords(WORDS).length);
  }, []);

  const handleDailyNewCountChange = useCallback((count: number) => {
    storageService.setDailyNewCount(count);
    setDailyNewCount(count);
  }, []);

  /* ---------- 穿插调度算法引擎 (新词学习流) ---------- */
  const {
    session: learnSession,
    stats: queueStats,
    isDone: queueDone,
    start: startLearnQueue,
    settle: settleLearnQueue,
    next: nextLearnQueue,
    undo: undoLearnQueue,
    markMistake: markMistakeLearnQueue,
    markKnown: markKnownLearnQueue,
    overrideDemo: overrideDemoQueue,
  } = useLearnQueue(WORDS, { groupSize: dailyNewCount, minGap: 2 });

  /* ---------- 全量到期流式复习引擎 (FSRS 复习流) ---------- */
  const {
    session: reviewSession,
    stats: reviewStats,
    isDone: reviewDone,
    start: startReviewQueue,
    settle: settleReviewQueue,
    next: nextReviewQueue,
    undo: undoReviewQueue,
    markMistake: markMistakeReviewQueue,
    markMature: markMatureReviewQueue,
  } = useReviewQueue();

  const [wordOffset, setWordOffset] = useState(0);

  const getWordBatch = useCallback((offset: number, size = dailyNewCount) => {
    const batch: Word[] = [];
    for (let i = 0; i < size; i++) {
      batch.push(WORDS[(offset + i) % WORDS.length]);
    }
    return batch;
  }, [dailyNewCount]);

  // 开始学习当前组：即时初始化队列并切入独立学习流
  const startLearn = useCallback((offset = wordOffset) => {
    closeMenus();
    setIsExampleOpen(false);
    setFlowType('learn');
    const currentBatch = getWordBatch(offset, dailyNewCount);
    startLearnQueue(currentBatch);
    setViewMode('study');
  }, [wordOffset, dailyNewCount, getWordBatch, closeMenus, startLearnQueue]);

  // 继续学习下一组
  const handleContinueNextGroup = useCallback(() => {
    const nextOffset = (wordOffset + dailyNewCount) % WORDS.length;
    setWordOffset(nextOffset);
    startLearn(nextOffset);
  }, [wordOffset, dailyNewCount, startLearn]);

  // 开始真实复习流程 (全量到期流式复习)
  const startReview = useCallback(() => {
    closeMenus();
    setIsExampleOpen(false);
    const dueWords = storageService.getDueWords(WORDS);
    if (dueWords.length === 0) {
      toast('今日暂无待复习单词，先去学新词吧');
      return;
    }
    setFlowType('review');
    startReviewQueue(dueWords);
    setViewMode('study');
    toast(`开始今日复习：共 ${dueWords.length} 词`);
  }, [closeMenus, startReviewQueue, toast]);

  // 退出学习回首页
  const exitLearn = useCallback(() => {
    setIsExampleOpen(false);
    closeMenus();
    setViewMode('main');
    resetMain();
    refreshReviewCount();
  }, [closeMenus, resetMain, refreshReviewCount]);

  // 演示跳转 showStage (1~10 阶段)
  const showStage = useCallback((stageNum: number) => {
    closeMenus();
    setIsExampleOpen(false);
    setViewMode('study');
    setFlowType('demo');

    const base = { ...WORDS[0] };

    switch (stageNum) {
      case 1:
        base.level = 0;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'choice', 7, 20);
        toast('已切换至：① 第一次遇见');
        break;
      case 2:
        base.level = 1;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'detail', 7, 20);
        toast('已切换至：② 第一次答对');
        break;
      case 3:
        base.level = 1;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'recall', 9, 20);
        toast('已切换至：③ 第二次初遇见');
        break;
      case 4:
        base.level = 2;
        base.badge = '2';
        base.isMastered = false;
        overrideDemoQueue(base, 'detail', 9, 20);
        toast('已切换至：④ 第二次答对');
        break;
      case 5:
        base.level = 2;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'audio_choice', 13, 20);
        toast('已切换至：⑤ 第三次初遇见 (听音选义)');
        break;
      case 6:
        base.level = 3;
        base.badge = '3';
        base.isMastered = false;
        overrideDemoQueue(base, 'detail', 13, 20);
        toast('已切换至：⑥ 第三次答对');
        break;
      case 7:
        base.level = 3;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'final_gate', 18, 20);
        toast('已切换至：⑦ 第4次遇见 (终极回想)');
        break;
      case 8:
        base.level = 4;
        base.isMastered = true;
        base.badge = '';
        overrideDemoQueue(base, 'detail', 19, 20);
        toast('已切换至：⑧ 最后一次答对 (成功掌握)');
        break;
      case 9:
        base.level = undefined;
        base.badge = '';
        base.isMastered = false;
        overrideDemoQueue(base, 'review_recall', 3, 15);
        toast('已切换至：复习提问态 (图1)');
        break;
      case 10:
        base.level = 4;
        base.badge = '';
        base.isMastered = true;
        overrideDemoQueue(base, 'detail', 4, 15);
        toast('已切换至：复习答后详情态 (图2)');
        break;
      default:
        break;
    }
  }, [closeMenus, overrideDemoQueue, toast]);

  // 选择题作答完成
  const handlePickOption = useCallback((ok: boolean) => {
    settleLearnQueue(ok);
    if (!ok) {
      toast('选择错误：进度已清零，已重新排入队尾从第 1 关学起');
    }
  }, [settleLearnQueue, toast]);

  // 看答案
  const handleShowAnswer = useCallback(() => {
    settleLearnQueue(false);
    toast('看了答案：进度已清零，将重新从第 1 关学起');
  }, [settleLearnQueue, toast]);

  // 第二次学习：认识 / 不认识
  const handlePickRecall = useCallback((known: boolean) => {
    settleLearnQueue(known);
    if (known) {
      toast('👍 认识！掌握度提升至 2 级');
    } else {
      toast('不认识：进度已清零，已重新排入队尾');
    }
  }, [settleLearnQueue, toast]);

  // 复习三向作答：认识 / 模糊 / 忘记了
  const handlePickReviewRecall = useCallback(
    (type: ReviewAnswerType) => {
      if (flowMode === 'demo') {
        const base = learnSession ? { ...learnSession.wordState.word } : { ...WORDS[0] };
        base.level = 4;
        base.badge = '';
        base.isMastered = true;
        overrideDemoQueue(base, 'detail', (learnSession?.index ?? 3) + 1, learnSession?.totalTarget ?? 15);
        if (type === 'known') toast('👍 认识！巩固记忆成功');
        else if (type === 'vague') toast('🤔 模糊：查看详细释义与例句强化巩固');
        else toast('忘记了：已安排强化巩固，先复习完整释义');
      } else {
        settleReviewQueue(type);
        if (type === 'known') {
          toast('👍 认识！FSRS 记忆稳定性提升');
        } else if (type === 'vague') {
          toast('🤔 模糊：记忆稳定性适度微增');
        } else {
          toast('忘记了：已排入当场复习队尾重测');
        }
      }
    },
    [flowMode, learnSession, overrideDemoQueue, settleReviewQueue, toast]
  );

  // 第4次学习：终极回想 认识 / 不认识
  const handlePickFinalGate = useCallback((known: boolean) => {
    settleLearnQueue(known);
    if (known) {
      toast('🎉 该词已完成全部 4 次学习，成功掌握！');
    } else {
      toast('不认识：进度已清零，已重新排入队尾');
    }
  }, [settleLearnQueue, toast]);

  // 记错了（误判纠错）
  const handleMarkMistake = useCallback(() => {
    if (flowMode === 'review') {
      markMistakeReviewQueue();
      toast('已标记为「记错了」，已排入队尾重测');
    } else {
      markMistakeLearnQueue();
      toast('已标记为「记错了」，掌握度已清零并重新排入队尾');
    }
  }, [flowMode, markMistakeReviewQueue, markMistakeLearnQueue, toast]);

  // 熟词标记
  const handleMarkKnown = useCallback(() => {
    if (flowMode === 'review') {
      markMatureReviewQueue();
      toast('已标记为熟词并移出复习队列');
      refreshReviewCount();
    } else {
      markKnownLearnQueue();
      toast('已标记为熟词，本组内不再出现');
    }
  }, [flowMode, markMatureReviewQueue, markKnownLearnQueue, refreshReviewCount, toast]);

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

  // 下一词
  const handleNextWord = useCallback(() => {
    if (flowMode === 'review') {
      if (reviewDone) {
        setIsExampleOpen(false);
        refreshReviewCount();
        setViewMode('finish');
        return;
      }
      nextReviewQueue();
    } else {
      if (queueDone) {
        setIsExampleOpen(false);
        const currentBatch = getWordBatch(wordOffset, dailyNewCount);
        currentBatch.forEach((w) => {
          storageService.graduateWord(w.id || `w_${w.w}`, 0);
        });
        refreshReviewCount();
        setViewMode('finish');
        return;
      }
      nextLearnQueue();
    }
  }, [flowMode, reviewDone, queueDone, nextReviewQueue, nextLearnQueue, getWordBatch, wordOffset, dailyNewCount, refreshReviewCount]);

  // 监听整组学习完成或复习完成自动切至结算页
  useEffect(() => {
    if (viewMode === 'study') {
      if (flowMode === 'learn' && queueDone && (!learnSession || learnSession.settled)) {
        setIsExampleOpen(false);
        const currentBatch = getWordBatch(wordOffset, dailyNewCount);
        currentBatch.forEach((w) => {
          storageService.graduateWord(w.id || `w_${w.w}`, 0);
        });
        refreshReviewCount();
        setViewMode('finish');
      } else if (flowMode === 'review' && reviewDone && (!reviewSession || reviewSession.settled)) {
        setIsExampleOpen(false);
        refreshReviewCount();
        setViewMode('finish');
      }
    }
  }, [queueDone, reviewDone, viewMode, flowMode, learnSession, reviewSession, getWordBatch, wordOffset, dailyNewCount, refreshReviewCount]);

  // 打开例句卡
  const handleOpenExample = useCallback((senseIdx: number = 0) => {
    setSelectedSenseIdx(senseIdx);
    setIsExampleOpen(true);
  }, []);

  // 关闭例句卡
  const handleCloseExample = useCallback(() => {
    setIsExampleOpen(false);
  }, []);

  // 当前用于渲染的词与阶段
  const currentWord: Word =
    flowMode === 'review' && reviewSession
      ? reviewSession.word
      : learnSession
      ? learnSession.wordState.word
      : WORDS[0];

  const currentStage: LearningStage =
    flowMode === 'review' && reviewSession
      ? reviewSession.stage
      : learnSession
      ? learnSession.stage
      : 'choice';

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
    <>
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
            onStartLearn={() => startLearn()}
            onStartReview={startReview}
            reviewN={reviewN}
            signed={signed}
            onSign={doSign}
            learnN={Math.max(0, 4373 - queueStats.sessionsCompleted)}
            toast={toast}
          />

          {/* 2. 不背学堂 */}
          <AcademyScreen
            active={viewMode === 'main' && mainStack.includes('s-academy')}
            onBack={backMain}
            toast={toast}
          />

          {/* 3. 我的内容 */}
          <ContentScreen
            active={viewMode === 'main' && mainStack.includes('s-content')}
            onGo={goMain}
            onBack={backMain}
            toast={toast}
          />

          {/* 3.1 在学词书 (Word List / 单词表) */}
          <WordListScreen
            active={viewMode === 'main' && mainStack.includes('s-wordlist')}
            bookTitle="COCA 20000 (上)"
            totalBookWords={5585}
            onBack={backMain}
            onOpenDict={openDictModal}
            onOpenSpelling={openSpelling}
            toast={toast}
          />

          {/* 4. 我的学习 / 学习偏好 */}
          <StudyScreen
            active={viewMode === 'main' && mainStack.includes('s-study')}
            tab={studyTab}
            onTabChange={setStudyTab}
            onBack={backMain}
            onOpenBookMenu={(e: MouseEvent) => {
              e.stopPropagation();
              closeMenus();
              setMenuBookOpen(true);
            }}
            onOpenStats={() => goMain('s-stats')}
            toast={toast}
            streak={streak}
            totalLearned={queueStats.sessionsCompleted + reviewStats.completedWords}
            dailyNewCount={dailyNewCount}
            onDailyNewCountChange={handleDailyNewCountChange}
          />

          {/* 4.1 学习统计概览 (Overview / Stats Screen, 对应图1、图2) */}
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

          {/* ================= 独立学习流 (Study Flow) ================= */}
          {/* 6. 单词学习流程 */}
          <LearnScreen
            active={viewMode === 'study'}
            isBehind={isExampleOpen}
            curWord={currentWord}
            stage={currentStage}
            step={currentStep}
            groupSize={totalTarget}
            onExit={exitLearn}
            onUndo={handleUndoWord}
            onMarkKnown={handleMarkKnown}
            onOpenMenuMore={(e: MouseEvent) => {
              e.stopPropagation();
              closeMenus();
              setMenuMoreOpen(true);
            }}
            onOpenExample={handleOpenExample}
            onOpenDict={openDictModal}
            onOpenNoteEditor={openNoteEditor}
            onOpenSpelling={openSpelling}
            onNextWord={handleNextWord}
            onMarkMistake={handleMarkMistake}
            onShowAnswer={handleShowAnswer}
            onPickOption={handlePickOption}
            onPickRecall={handlePickRecall}
            onPickFinalGate={handlePickFinalGate}
            onPickReviewRecall={handlePickReviewRecall}
            toast={toast}
          />

          {/* 7. 原声例句全屏卡 */}
          <ExampleScreen
            active={viewMode === 'study' && isExampleOpen}
            curWord={currentWord}
            initialSenseIdx={selectedSenseIdx}
            onClose={handleCloseExample}
            onOpenDict={openDictModal}
            onNextWord={() => {
              handleCloseExample();
              handleNextWord();
            }}
            toast={toast}
          />

          {/* 8. 柯林斯多维词典全屏卡 (Dictionary Detail Modal) */}
          <DictDetailModal
            active={!!dictModalWord}
            wordData={dictModalWord}
            initialTab={dictModalTab}
            onClose={closeDictModal}
            toast={toast}
          />

          {/* 9. 独立笔记编辑全屏弹窗 (Note Editor Modal) */}
          <NoteEditorModal
            active={!!noteModalWord}
            wordData={noteModalWord}
            onClose={closeNoteEditor}
            toast={toast}
          />

          {/* 10. 独立单词拼写练习全屏弹窗 (Spelling Modal) */}
          <SpellingModal
            active={!!spellingWord}
            wordData={spellingWord}
            onClose={closeSpelling}
            toast={toast}
          />

          {/* ================= 本组结算页 (Finish Flow) ================= */}
          {/* 11. 完成页 */}
          <FinishScreen
            active={viewMode === 'finish'}
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
        onGoStudyTab={(tab: 'a' | 'b') => {
          exitLearn();
          setStudyTab(tab);
          goMain('s-study');
        }}
        onOpenExampleDirect={() => {
          setViewMode('study');
          const base = { ...WORDS[0], level: 1, badge: '', isMastered: false };
          overrideDemoQueue(base, 'detail', 7, 20);
          setSelectedSenseIdx(0);
          setIsExampleOpen(true);
        }}
        onOpenNoteEditor={(w) => openNoteEditor(w || currentWord)}
        onOpenSpelling={(w) => openSpelling(w || currentWord)}
      />
    </>
  );
}
