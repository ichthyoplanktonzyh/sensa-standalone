import type { LearningRunView, LearningTargetView } from './learningSystem';

export const learningRunTargetIds = (run: LearningRunView): string[] => [...run.targetIds];

export const learningTargetHasDeclaredMastery = (target: LearningTargetView): boolean =>
  target.planningOverrides.some((override) => override.kind === 'declared_mastery');
