import {
  assertLearningSystemState,
  type LearningSystemStateInput,
} from '../learningAuthority';

/** Replica/backup adapter for the Learning System authority. */
export function validateLearningReplica(input: LearningSystemStateInput): void {
  assertLearningSystemState(input);
}
