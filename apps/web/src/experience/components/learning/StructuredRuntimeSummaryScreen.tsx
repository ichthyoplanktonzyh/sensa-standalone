import type { PrototypeLearningTargetId } from "../../learningJourney/prototypeLearning";
import { AssuranceSummary } from "./AssuranceSummary";
interface StructuredRuntimeSummaryScreenProps {
  active: boolean;
  graduatedTargetIds: readonly PrototypeLearningTargetId[];
  declaredMasteryTargetIds: readonly PrototypeLearningTargetId[];
  onExit: () => void;
}
export const StructuredRuntimeSummaryScreen = ({
  active,
  graduatedTargetIds,
  declaredMasteryTargetIds,
  onExit,
}: StructuredRuntimeSummaryScreenProps) => (
  <AssuranceSummary
    id="s-structured-runtime-summary"
    active={active}
    completed={graduatedTargetIds}
    declared={declaredMasteryTargetIds}
    onExit={onExit}
  />
);
