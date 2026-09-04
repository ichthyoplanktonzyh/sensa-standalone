/**
 * FSRS (Free Spaced Repetition Scheduler) 记忆调度算法模块
 * 基于 DSR (Difficulty, Stability, Retrievability) 认知模型
 */

export enum Rating {
  Again = 1, // 忘记了
  Hard = 2,  // 模糊
  Good = 3,  // 认识
  Easy = 4,  // 熟词 / 极其简单
}

export type FSRSState = 'new' | 'learning' | 'review' | 'relearning';

export interface FSRSItem {
  /** The scheduler-owned identity. In Sensa Runtime this is a Retention Target id. */
  memoryKey: string;
  state: FSRSState;         // 当前记忆状态
  stability: number;        // S: 记忆稳定性 (单位: 天，表示 90% 留存率对应的天数)
  difficulty: number;       // D: 难度 (1.0 ~ 10.0)
  reps: number;             // 累计复习次数
  lapses: number;           // 遗忘次数 (选 Again 的次数)
  lastReview: number;       // 上次复习时间戳 (ms)
  due: number;              // 下次复习到期时间戳 (ms)
  scheduledDays: number;    // 当前安排的间隔天数
}

export interface ReviewLog {
  memoryKey: string;
  rating: Rating;
  state: FSRSState;
  due: number;
  stability: number;
  difficulty: number;
  reviewTime: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 计算当前时刻的可提取留存率 R (0.0 ~ 1.0)
 * R(t, S) = (1 + factor * t / S) ^ power
 */
export function calculateRetrievability(item: FSRSItem, now: number = Date.now()): number {
  if (item.stability <= 0) return 0;
  const elapsedDays = Math.max(0, (now - item.lastReview) / MS_PER_DAY);
  const factor = 19 / 81;
  return Math.pow(1 + (factor * elapsedDays) / item.stability, -0.5);
}

/**
 * 接收 Scheduling Handoff 后创建初始 FSRS Memory State
 * @param memoryKey 调度记忆标识；Sensa Runtime 传 Retention Target id
 * @param mistakeCount 首次学习协议允许交给 initializer 的错误计数
 */
export function initFSRSFromLearn(memoryKey: string, mistakeCount: number = 0): FSRSItem {
  // 零失误初始难度较低、稳定性较高；失误越多初始难度越高、稳定性越低
  let initD = 5.0;
  let initS = 2.5; // 默认首次复习在 2~3 天后

  if (mistakeCount === 0) {
    initD = 4.5;
    initS = 3.0;
  } else if (mistakeCount === 1) {
    initD = 6.0;
    initS = 1.5;
  } else {
    initD = 7.5;
    initS = 0.8;
  }

  const now = Date.now();
  const scheduledDays = Math.max(1, Math.round(initS));
  const due = now + scheduledDays * MS_PER_DAY;

  return {
    memoryKey,
    state: 'review',
    stability: initS,
    difficulty: initD,
    reps: 1,
    lapses: mistakeCount,
    lastReview: now,
    due,
    scheduledDays,
  };
}

/**
 * 复习评级更新算法
 * @param prev 之前的 FSRS 状态
 * @param rating 用户评分 (Again / Hard / Good / Easy)
 * @param now 当前时间戳
 */
export function reviewFSRS(
  prev: FSRSItem,
  rating: Rating,
  now: number = Date.now()
): FSRSItem {
  const r = calculateRetrievability(prev, now);

  let newD = prev.difficulty;
  let newS = prev.stability;
  let nextState: FSRSState = prev.state;
  let lapses = prev.lapses;

  // 1. 更新难度 D (Difficulty: 1 ~ 10)
  const deltaD = -0.7 * (rating - 3);
  newD = Math.min(10, Math.max(1, prev.difficulty + deltaD));

  // 2. 更新稳定性 S (Stability in days)
  if (rating === Rating.Again) {
    // 遗忘：稳定性大幅衰减，增加 lapse 计数
    lapses += 1;
    nextState = 'relearning';
    newS = Math.max(0.3, prev.stability * 0.25 * ((11 - newD) / 10));
  } else if (rating === Rating.Hard) {
    // 模糊：难度上升，稳定性适度小幅增长
    nextState = 'review';
    newS = Math.max(1.0, prev.stability * 1.25);
  } else if (rating === Rating.Good) {
    // 认识：根据遗忘难度与当前留存率进行乘数放大
    nextState = 'review';
    const recallBonus = 1 + 2.2 * ((11 - newD) / 10) * Math.max(0.1, 1 - r);
    newS = Math.max(prev.stability + 1, prev.stability * recallBonus);
  } else if (rating === Rating.Easy) {
    // 熟词 / 极其简单
    nextState = 'review';
    const easyBonus = 1 + 3.8 * ((11 - newD) / 10) * Math.max(0.1, 1 - r);
    newS = Math.max(prev.stability + 2, prev.stability * easyBonus * 1.3);
  }

  // 3. 计算下次复习间隔天数 (目标留存率 90% 对应的主间隔约为 newS)
  const scheduledDays = Math.max(1, Math.round(newS));
  const due = now + scheduledDays * MS_PER_DAY;

  return {
    memoryKey: prev.memoryKey,
    state: nextState,
    stability: Number(newS.toFixed(2)),
    difficulty: Number(newD.toFixed(2)),
    reps: prev.reps + 1,
    lapses,
    lastReview: now,
    due,
    scheduledDays,
  };
}
