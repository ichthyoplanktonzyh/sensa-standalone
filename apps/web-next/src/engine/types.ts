import type { Word, LearningStage } from '../types';

export interface WordState {
  word: Word;
  level: number; // 0..4
  pass: number;  // 1: 看词选义, 2: 例句回想, 3: 听音辨义, 4: 终极回想
  isMastered: boolean;
  lastSessionIndex: number;
  totalAttempts: number;
  totalCorrect: number;
}

export interface Session {
  index: number;      // 1-based, 当前作答场次序号 (如 1/20)
  totalTarget: number; // 目标场次数 (5 词 * 4 次 = 20)
  wordState: WordState;
  stage: LearningStage;
  settled: boolean;
  result: boolean | null;
}

export interface QueueStats {
  sessionsCompleted: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number; // 0..100
  masteredCount: number;
  totalWords: number;
  startTime: number;
}

export interface QueueConfig {
  groupSize?: number; // 默认 5 个词一组 (即 20 场次)
  minGap?: number;    // 同一单词再次出现的最小冷却间隔 (默认 2)
}
