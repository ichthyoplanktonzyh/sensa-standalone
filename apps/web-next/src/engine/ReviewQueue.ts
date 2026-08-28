import type { Word } from '../types';
import { Rating } from '../services/fsrs';
import { storageService } from '../services/storageService';

export type ReviewAnswerType = 'known' | 'vague' | 'forgotten';

export interface ReviewSession {
  index: number;       // 当前进度序号 (例如 1 / 15)
  totalTarget: number; // 今日待复习总词数
  word: Word;          // 当前单词
  stage: 'review_recall' | 'detail'; // 提问态 vs 答后详情态
  settled: boolean;    // 本题是否已完成打分
  result: ReviewAnswerType | null;
}

export interface ReviewStats {
  totalWords: number;      // 初始总词数
  completedWords: number;  // 最终已通关词数
  totalAttempts: number;   // 总判词次数 (含忘记回炉重测)
  correctAttempts: number; // 认识/模糊的次数
  accuracy: number;        // 记忆提取率 (%)
  startTime: number;
}

interface ReviewSnapshot {
  pendingQueue: Word[];
  completedCount: number;
  totalAttempts: number;
  totalCorrect: number;
  currentSession: ReviewSession | null;
}

export class ReviewQueue {
  private pendingQueue: Word[];
  private currentWord: Word | null = null;
  private currentSession: ReviewSession | null = null;
  private totalInitialCount: number;
  private completedCount = 0;
  private totalAttempts = 0;
  private totalCorrect = 0;
  private startTime: number;
  private historySnapshots: ReviewSnapshot[] = [];

  constructor(dueWords: Word[]) {
    this.totalInitialCount = dueWords.length;
    this.pendingQueue = dueWords.map((w) => ({ ...w }));
    this.startTime = Date.now();
    this.next();
  }

  public getCurrentSession(): ReviewSession | null {
    return this.currentSession;
  }

  public isDone(): boolean {
    return this.pendingQueue.length === 0 && (!this.currentSession || this.currentSession.settled);
  }

  /**
   * 推进到下一个待复习单词
   */
  public next(): ReviewSession | null {
    this.saveSnapshot();

    if (this.pendingQueue.length === 0) {
      this.currentSession = null;
      this.currentWord = null;
      return null;
    }

    const nextWord = this.pendingQueue.shift()!;
    this.currentWord = nextWord;

    const session: ReviewSession = {
      index: Math.min(this.totalInitialCount, this.completedCount + 1),
      totalTarget: this.totalInitialCount,
      word: nextWord,
      stage: 'review_recall',
      settled: false,
      result: null,
    };

    this.currentSession = session;
    return session;
  }

  /**
   * 提交三向作答打分
   * @param answer 'known' (认识) | 'vague' (模糊) | 'forgotten' (忘记了)
   */
  public settle(answer: ReviewAnswerType): ReviewSession | null {
    if (!this.currentSession || this.currentSession.settled) {
      return this.currentSession;
    }

    const s = this.currentSession;
    const w = s.word;
    const wordId = w.id || `w_${w.w}`;

    s.settled = true;
    s.result = answer;
    this.totalAttempts++;

    if (answer === 'known' || answer === 'vague') {
      this.totalCorrect++;
      this.completedCount++;
      const rating = answer === 'known' ? Rating.Good : Rating.Hard;
      storageService.recordReview(wordId, rating);
      // 顺利通过，不重新排队
    } else {
      // 忘记了 (Again)：更新 FSRS 记忆数据，并将该词重新塞入队尾重测 (Relearning Loop)
      storageService.recordReview(wordId, Rating.Again);
      this.pendingQueue.push({ ...w });
    }

    // 切换至详情态巩固
    s.stage = 'detail';
    return s;
  }

  /**
   * 在详情页点击「记错了」纠错反悔
   */
  public markMistake(): void {
    if (!this.currentSession || !this.currentWord) return;
    const w = this.currentWord;
    const wordId = w.id || `w_${w.w}`;

    // 如果之前算作通过，回退完成数
    if (this.currentSession.result !== 'forgotten') {
      this.completedCount = Math.max(0, this.completedCount - 1);
      this.totalCorrect = Math.max(0, this.totalCorrect - 1);
    }

    this.currentSession.result = 'forgotten';
    storageService.recordReview(wordId, Rating.Again);

    // 重新塞回待测队列末尾
    this.pendingQueue.push({ ...w });
  }

  /**
   * 标记熟词
   */
  public markMature(): void {
    if (!this.currentSession || !this.currentWord) return;
    const w = this.currentWord;
    const wordId = w.id || `w_${w.w}`;
    storageService.recordReview(wordId, Rating.Easy);
    this.completedCount++;
    this.next();
  }

  /**
   * 撤回上一词
   */
  public undo(): ReviewSession | null {
    if (this.historySnapshots.length === 0) return null;
    const snapshot = this.historySnapshots.pop()!;
    this.pendingQueue = snapshot.pendingQueue;
    this.completedCount = snapshot.completedCount;
    this.totalAttempts = snapshot.totalAttempts;
    this.totalCorrect = snapshot.totalCorrect;
    this.currentSession = snapshot.currentSession;
    this.currentWord = snapshot.currentSession ? snapshot.currentSession.word : null;
    return this.currentSession;
  }

  public getStats(): ReviewStats {
    const accuracy = this.totalAttempts > 0
      ? Math.round((this.totalCorrect / this.totalAttempts) * 100)
      : 100;

    return {
      totalWords: this.totalInitialCount,
      completedWords: this.completedCount,
      totalAttempts: this.totalAttempts,
      correctAttempts: this.totalCorrect,
      accuracy,
      startTime: this.startTime,
    };
  }

  private saveSnapshot(): void {
    this.historySnapshots.push({
      pendingQueue: this.pendingQueue.map((w) => ({ ...w })),
      completedCount: this.completedCount,
      totalAttempts: this.totalAttempts,
      totalCorrect: this.totalCorrect,
      currentSession: this.currentSession ? { ...this.currentSession } : null,
    });
    if (this.historySnapshots.length > 20) {
      this.historySnapshots.shift();
    }
  }
}
