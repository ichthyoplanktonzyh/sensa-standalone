import { useState, useCallback, useRef } from 'react';
import type { Word } from '../types';
import { ReviewQueue, ReviewSession, ReviewStats, ReviewAnswerType } from './ReviewQueue';

export function useReviewQueue() {
  const queueRef = useRef<ReviewQueue | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [stats, setStats] = useState<ReviewStats>(() => ({
    totalWords: 0,
    completedWords: 0,
    totalAttempts: 0,
    correctAttempts: 0,
    accuracy: 100,
    startTime: Date.now(),
  }));
  const [isDone, setIsDone] = useState(false);

  // 初始化并启动复习流
  const start = useCallback((dueWords: Word[]) => {
    if (dueWords.length === 0) {
      setSession(null);
      setIsDone(true);
      return null;
    }
    const q = new ReviewQueue(dueWords);
    queueRef.current = q;
    const firstSession = q.getCurrentSession();
    setSession(firstSession ? { ...firstSession } : null);
    setStats(q.getStats());
    setIsDone(q.isDone());
    return firstSession;
  }, []);

  // 提交三向作答 (认识 / 模糊 / 忘记了)
  const settle = useCallback((answer: ReviewAnswerType) => {
    const q = queueRef.current;
    if (!q) return;
    const settledSession = q.settle(answer);
    if (settledSession) {
      setSession({ ...settledSession });
      setStats(q.getStats());
    }
  }, []);

  // 下一个单词
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

  // 详情页标记记错了
  const markMistake = useCallback(() => {
    const q = queueRef.current;
    if (!q || !session) return;
    q.markMistake();
    setSession({ ...session, result: 'forgotten' });
    setStats(q.getStats());
  }, [session]);

  // 标记熟词
  const markMature = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    q.markMature();
    setStats(q.getStats());
    next();
  }, [next]);

  return {
    session,
    stats,
    isDone,
    start,
    settle,
    next,
    undo,
    markMistake,
    markMature,
  };
}
