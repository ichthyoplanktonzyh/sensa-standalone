import {
  PROTOTYPE_LEARNING_TARGET_ORDER,
  PROTOTYPE_LEARNING_TARGETS,
  type PrototypeLearningTargetId,
} from './prototypeLearning';
import {
  journeyFor,
  type InitialLearningCompletion,
  type JourneyState,
} from './journeyState';

export type LearningRecordKind =
  | 'initial_learning'
  | 'retention_review'
  | 'relearning';

export interface LearningRecordView {
  readonly recordId: string;
  readonly targetId: string;
  readonly meaning?: string;
  readonly expression: string;
  /** The language the learned expression is in. Every producer names one: a
   * record whose target was written before the language profile existed names
   * the pair the product has always shipped rather than no language at all. */
  readonly languageTag: string;
  readonly occurredAt: string;
  readonly kind: LearningRecordKind;
  readonly label: string;
  readonly detail: string;
}

const initialCompletionDetail = (
  kind: InitialLearningCompletion['completionKind'],
): string => {
  switch (kind) {
    case 'study_completion':
      return '完成首次学习，已进入保持阶段';
    case 'acquisition_graduation':
      return '完成高保证首次学习，已进入保持阶段';
    case 'imported_completion':
      return '既有学习进度已接续到保持阶段';
  }
};

const isValidTimestamp = (value: string): boolean => !Number.isNaN(Date.parse(value));

/**
 * 将 Runtime/Journey 已经写下的事实投影成 learner-facing 学习记录。
 *
 * 这里不读取 FSRS 内部状态，也不从“待学习/待复习”数量推测历史。没有发生过
 * 的事件就不会出现在记录里。
 */
export const projectLearningHistory = (
  state: JourneyState,
): readonly LearningRecordView[] => {
  const records: LearningRecordView[] = [];

  for (const targetId of PROTOTYPE_LEARNING_TARGET_ORDER) {
    const target = PROTOTYPE_LEARNING_TARGETS[targetId];
    const journey = journeyFor(state, targetId);

    if (journey.initialCompletion && isValidTimestamp(journey.initialCompletion.completedAt)) {
      records.push({
        recordId: `${targetId}:initial:${journey.initialCompletion.completedAt}`,
        targetId,
        expression: target.expression,
        languageTag: target.targetLanguageTag,
        occurredAt: journey.initialCompletion.completedAt,
        kind: 'initial_learning',
        label: '首次学习',
        detail: initialCompletionDetail(journey.initialCompletion.completionKind),
      });
    }

    const lightweightReviewedAt = journey.lightweightRetention?.lastReviewedAt;
    if (lightweightReviewedAt && isValidTimestamp(lightweightReviewedAt)) {
      records.push({
        recordId: `${targetId}:lightweight-review:${lightweightReviewedAt}`,
        targetId,
        expression: target.expression,
        languageTag: target.targetLanguageTag,
        occurredAt: lightweightReviewedAt,
        kind: 'retention_review',
        label: '保持复习',
        detail: '完成一次到期复习',
      });
    }

    const structuredReviewedAt = journey.structuredRetention?.lastReviewedAt;
    if (structuredReviewedAt && isValidTimestamp(structuredReviewedAt)) {
      records.push({
        recordId: `${targetId}:structured-review:${structuredReviewedAt}`,
        targetId,
        expression: target.expression,
        languageTag: target.targetLanguageTag,
        occurredAt: structuredReviewedAt,
        kind: 'retention_review',
        label: '保持复习',
        detail: '完成一次到期复习',
      });
    }

    const relearningCompletedAt = journey.structuredRetention?.relearningCompletedAt;
    if (relearningCompletedAt && isValidTimestamp(relearningCompletedAt)) {
      records.push({
        recordId: `${targetId}:relearning:${relearningCompletedAt}`,
        targetId,
        expression: target.expression,
        languageTag: target.targetLanguageTag,
        occurredAt: relearningCompletedAt,
        kind: 'relearning',
        label: '巩固完成',
        detail: '完成遗忘后的定向巩固',
      });
    }
  }

  return records.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
};
