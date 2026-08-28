import { useState, useCallback, useRef } from 'react';
import type { Word, LearningStage } from '../types';
import { LearnQueue } from './LearnQueue';
import type { Session, QueueStats, QueueConfig } from './types';

export function useLearnQueue(initialWords: Word[], config?: QueueConfig) {
  const queueRef = useRef<LearnQueue | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [stats, setStats] = useState<QueueStats>(() => ({
    sessionsCompleted: 0,
    totalAttempts: 0,
    correctAttempts: 0,
    accuracy: 100,
    masteredCount: 0,
    totalWords: config?.groupSize ?? 5,
    startTime: Date.now(),
  }));
  const [isDone, setIsDone] = useState(false);

  // 初始化或重新开始
  const start = useCallback((wordsToLearn: Word[] = initialWords) => {
    const q = new LearnQueue(wordsToLearn, config);
    queueRef.current = q;
    const firstSession = q.getCurrentSession();
    setSession(firstSession ? { ...firstSession } : null);
    setStats(q.getStats());
    setIsDone(q.isDone());
    return firstSession;
  }, [initialWords, config]);

  // 提交当前卡片作答
  const settle = useCallback((ok: boolean) => {
    const q = queueRef.current;
    if (!q) return;
    const settledSession = q.settle(ok);
    if (settledSession) {
      setSession({ ...settledSession });
      setStats(q.getStats());
    }
  }, []);

  // 下一个会话（推进到下一张卡片）
  const next = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    if (q.isDone()) {
      setIsDone(true);
      setSession(null);
      setStats(q.getStats());
      return;
    }
    const nextSession = q.next();
    setSession(nextSession ? { ...nextSession } : null);
    setStats(q.getStats());
    setIsDone(q.isDone());
  }, []);

  // 撤回
  const undo = useCallback(() => {
    const q = queueRef.current;
    if (!q) return null;
    const prevSession = q.undo();
    if (prevSession) {
      setSession({ ...prevSession });
      setStats(q.getStats());
      setIsDone(false);
    }
    return prevSession;
  }, []);

  // 标记记错了
  const markMistake = useCallback(() => {
    const q = queueRef.current;
    if (!q || !session) return;
    q.markMistake();
    setSession({ ...session, result: false, wordState: { ...session.wordState, level: 0, isMastered: false, pass: 1 } });
    setStats(q.getStats());
  }, [session]);

  // 标记熟词
  const markKnown = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    q.skipCurrent();
    setStats(q.getStats());
    next();
  }, [next]);

  // 演示模式覆盖：用于右侧 SidePanel ①~⑧ 阶段快速直达预览
  const overrideDemo = useCallback((demoWord: Word, demoStage: LearningStage, demoStep: number, total: number) => {
    setSession({
      index: demoStep,
      totalTarget: total,
      wordState: {
        word: { ...demoWord },
        level: demoWord.level ?? 0,
        pass: demoStage === 'choice' ? 1 : demoStage === 'recall' ? 2 : demoStage === 'audio_choice' ? 3 : 4,
        isMastered: !!demoWord.isMastered,
        lastSessionIndex: 0,
        totalAttempts: 0,
        totalCorrect: 0,
      },
      stage: demoStage,
      settled: demoStage === 'detail',
      result: true,
    });
    setIsDone(false);
  }, []);

  return {
    session,
    stats,
    isDone,
    start,
    settle,
    next,
    undo,
    markMistake,
    markKnown,
    overrideDemo,
  };
}
