import { projectLearningHistory } from './learningHistory';
import {
  INITIAL_JOURNEY,
  type JourneyState,
  type TargetJourney,
} from './journeyState';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

assert(projectLearningHistory(INITIAL_JOURNEY).length === 0, '没有完成事实时应返回空记录');

const borrow: TargetJourney = {
  ...INITIAL_JOURNEY.byTarget['borrow-receive'],
  initialCompletion: {
    completionKind: 'study_completion',
    protocolOutcome: 'study_completed',
    completedAt: '2026-09-03T09:00:00.000Z',
    nextReviewAt: '2026-09-04T09:00:00.000Z',
    nextReviewLabel: '明天',
    schedulingHandoffBasis: 'protocol_completion',
    evidenceLevel: 'non_evidentiary',
    learnerVisibleClaim: '测试数据',
  },
  lightweightRetention: {
    nextReviewAt: '2026-09-08T09:00:00.000Z',
    nextReviewLabel: '5 天后',
    reviewCount: 1,
    lapseCount: 0,
    relearning: false,
    lastReviewedAt: '2026-09-04T09:00:00.000Z',
  },
};

const lend: TargetJourney = {
  ...INITIAL_JOURNEY.byTarget['lend-give'],
  structuredRetention: {
    lastReviewedAt: '2026-09-04T10:00:00.000Z',
    nextReviewAt: '2026-09-09T10:00:00.000Z',
    nextReviewLabel: '5 天后',
    reviewCount: 1,
    lapseCount: 1,
    lastOutcome: null,
    relearning: false,
    relearningStage: null,
    relearningCompletedAt: '2026-09-04T11:00:00.000Z',
  },
};

const state: JourneyState = {
  ...INITIAL_JOURNEY,
  byTarget: {
    ...INITIAL_JOURNEY.byTarget,
    'borrow-receive': borrow,
    'lend-give': lend,
  },
};

const history = projectLearningHistory(state);
assert(history.length === 4, '应投影首次学习、两次复习与一次巩固事实');
assert(history[0]?.kind === 'relearning', '记录应按发生时间倒序排列');
assert(history[1]?.label === '保持复习', '结构化复习应使用 learner-facing 标签');
assert(history[3]?.label === '首次学习', '首次学习应使用 learner-facing 标签');
assert(
  Object.keys(history[0] ?? {}).every((key) => !['reps', 'senseId', 'evidenceLevel'].includes(key)),
  '展示记录不能泄露 FSRS、Sense ID 或 Evidence 内部字段',
);

const invalidState: JourneyState = {
  ...state,
  byTarget: {
    ...state.byTarget,
    'borrow-receive': {
      ...borrow,
      initialCompletion: borrow.initialCompletion
        ? { ...borrow.initialCompletion, completedAt: 'not-a-date' }
        : null,
    },
  },
};
assert(projectLearningHistory(invalidState).length === 3, '无效时间的事实不应进入展示记录');

console.log('learning history smoke: 全部通过');
