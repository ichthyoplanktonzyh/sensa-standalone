import type { Word, LearningStage } from '../types';
import type { WordState, Session, QueueStats, QueueConfig } from './types';

const PASS_STAGE_MAP: Record<number, LearningStage> = {
  1: 'choice',
  2: 'recall',
  3: 'audio_choice',
  4: 'final_gate',
};

interface HistorySnapshot {
  sessions: Session[];
  wordStates: WordState[];
  currentSessionIndex: number;
}

export class LearnQueue {
  private wordStates: WordState[];
  private currentSession: Session | null = null;
  private sessionHistory: Session[] = [];
  private historySnapshots: HistorySnapshot[] = [];
  private groupSize: number;
  private minGap: number;
  private totalTarget: number;
  private startTime: number;
  private totalAttempts = 0;
  private totalCorrect = 0;

  constructor(words: Word[], config?: QueueConfig) {
    this.groupSize = config?.groupSize ?? Math.min(5, words.length);
    this.minGap = config?.minGap ?? 2;
    this.totalTarget = this.groupSize * 4;
    this.startTime = Date.now();

    const selectedWords = words.slice(0, this.groupSize);
    this.wordStates = selectedWords.map((w) => ({
      word: { ...w },
      level: 0,
      pass: 1,
      isMastered: false,
      lastSessionIndex: -1,
      totalAttempts: 0,
      totalCorrect: 0,
    }));

    this.next();
  }

  /**
   * 获取当前作答会话
   */
  public getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * 是否已全部完成（所有活动单词均掌握）
   */
  public isDone(): boolean {
    return this.wordStates.every((w) => w.isMastered);
  }

  /**
   * 调度下一个待学习会话（核心穿插算法）
   */
  public next(): Session | null {
    if (this.isDone()) {
      this.currentSession = null;
      return null;
    }

    this.saveSnapshot();

    const currentIndex = this.sessionHistory.length + 1;
    const pending = this.wordStates.filter((w) => !w.isMastered);

    // 1. 过滤出满足冷却间隔 (minGap) 的候选单词
    let candidates = pending.filter(
      (w) => w.lastSessionIndex === -1 || currentIndex - w.lastSessionIndex > this.minGap
    );

    // 2. 如果没有满足 minGap 的候选词（如剩余词少于 minGap），则取最久未出现的词
    if (candidates.length === 0) {
      candidates = [...pending].sort((a, b) => a.lastSessionIndex - b.lastSessionIndex);
    }

    // 3. 优先级排序：优先推出新词/较低 Pass，次优按上次出现时间升序
    candidates.sort((a, b) => {
      if (a.pass !== b.pass) return a.pass - b.pass;
      return a.lastSessionIndex - b.lastSessionIndex;
    });

    const chosen = candidates[0];
    const initialStage = PASS_STAGE_MAP[chosen.pass] || 'choice';

    const session: Session = {
      index: currentIndex,
      totalTarget: this.totalTarget,
      wordState: chosen,
      stage: initialStage,
      settled: false,
      result: null,
    };

    this.currentSession = session;
    return session;
  }

  /**
   * 提交当前卡片作答结果
   * @param ok 是否答对/认识
   */
  public settle(ok: boolean): Session | null {
    if (!this.currentSession || this.currentSession.settled) {
      return this.currentSession;
    }

    const s = this.currentSession;
    const w = s.wordState;

    s.settled = true;
    s.result = ok;

    this.totalAttempts++;
    w.totalAttempts++;

    if (ok) {
      this.totalCorrect++;
      w.totalCorrect++;
      // 答对晋级
      w.level = Math.min(4, w.level + 1);
      if (w.level >= 4) {
        w.isMastered = true;
        w.pass = 4;
      } else {
        w.pass = w.level + 1;
      }
    } else {
      // 答错/看答案惩罚：4 点全部清零，打回第 1 关
      w.level = 0;
      w.isMastered = false;
      w.pass = 1;
    }

    w.lastSessionIndex = s.index;

    // 附加徽章文本
    w.word.level = w.level;
    w.word.badge = w.level === 2 ? '2' : w.level === 3 ? '3' : '';
    w.word.isMastered = w.isMastered;

    // 切换至详情态
    s.stage = 'detail';
    this.sessionHistory.push({ ...s });

    return s;
  }

  /**
   * 在详情页标记“记错了”（误判纠错）
   */
  public markMistake(): void {
    if (!this.currentSession) return;
    const w = this.currentSession.wordState;

    // 撤销答对并清零惩罚
    w.level = 0;
    w.isMastered = false;
    w.pass = 1;
    w.word.level = 0;
    w.word.badge = '';
    w.word.isMastered = false;

    this.currentSession.result = false;
  }

  /**
   * 标记熟词（直接掌握并移出队列）
   */
  public skipCurrent(): void {
    if (!this.currentSession) return;
    const w = this.currentSession.wordState;
    w.isMastered = true;
    w.level = 4;
    w.word.level = 4;
    w.word.isMastered = true;
  }

  /**
   * 撤回上一词
   */
  public undo(): Session | null {
    if (this.historySnapshots.length === 0) return null;
    const snapshot = this.historySnapshots.pop()!;
    this.sessionHistory = snapshot.sessions;
    this.wordStates = snapshot.wordStates;
    this.currentSession = this.sessionHistory[snapshot.currentSessionIndex] || null;
    return this.currentSession;
  }

  /**
   * 获取当前学习统计数据
   */
  public getStats(): QueueStats {
    const accuracy = this.totalAttempts > 0
      ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
      : 100;
    const masteredCount = this.wordStates.filter((w) => w.isMastered).length;

    return {
      sessionsCompleted: this.sessionHistory.length,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy,
      masteredCount,
      totalWords: this.groupSize,
      startTime: this.startTime,
    };
  }

  /**
   * 保存历史快照用于撤回
   */
  private saveSnapshot(): void {
    const snapshot: HistorySnapshot = {
      sessions: this.sessionHistory.map((s) => ({ ...s, wordState: { ...s.wordState } })),
      wordStates: this.wordStates.map((w) => ({ ...w, word: { ...w.word } })),
      currentSessionIndex: this.sessionHistory.length,
    };
    this.historySnapshots.push(snapshot);
    if (this.historySnapshots.length > 20) {
      this.historySnapshots.shift();
    }
  }
}
