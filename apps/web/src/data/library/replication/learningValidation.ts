import {
  assertLearningSystemState,
  LearningSystemInvariantError,
  type LearningSystemStateInput,
} from '../learningAuthority';

/** Replica/backup adapter for the Learning System authority. */
export function validateLearningReplica(input: LearningSystemStateInput): void {
  try{assertLearningSystemState(input);}
  catch(error){
    // A restoration inconsistency is not a live learner clock/resource error.
    // Preserve specific Content Supply evidence diagnostics; do not admit data
    // merely because a different authority layer rejected it first.
    if(error instanceof LearningSystemInvariantError||error instanceof Error&&['localFlow.resourceInvalid','localFlow.clockChanged'].includes(error.message))input.fail();
    throw error;
  }
}
