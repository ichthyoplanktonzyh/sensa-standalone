import type { PrototypeLearningTargetId } from "../../learningJourney/prototypeLearning";
import { AssuranceSummary } from "./AssuranceSummary";
interface StructuredRetentionSummaryScreenProps {
  active: boolean;
  retainingTargetIds: readonly PrototypeLearningTargetId[];
  relearningCompletedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
}
export const StructuredRetentionSummaryScreen = ({
  active,
  retainingTargetIds,
  relearningCompletedTargetIds,
  declaredMasteryTargetIds,
  onExit,
}: StructuredRetentionSummaryScreenProps) => (
  <AssuranceSummary
    id="s-structured-retention-summary"
    active={active}
    review
    completed={retainingTargetIds}
    repaired={relearningCompletedTargetIds}
    declared={declaredMasteryTargetIds}
    onExit={onExit}
  />
);
