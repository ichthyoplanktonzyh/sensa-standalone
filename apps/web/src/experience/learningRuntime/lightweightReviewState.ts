import type { PrototypeLightweightRating } from "../learningJourney/prototypeLearning";
export type ReviewPhase =
  | "recall"
  | "answer"
  | "repair"
  | "retry"
  | "retry_answer"
  | "summary";
export interface ReviewState {
  index: number;
  phase: ReviewPhase;
  results: { targetId: string; rating: PrototypeLightweightRating }[];
}
export const initialReviewState = (): ReviewState => ({
  index: 0,
  phase: "recall",
  results: [],
});
export type ReviewAction =
  | { type: "reveal" }
  | { type: "rate"; rating: PrototypeLightweightRating }
  | { type: "retry" }
  | { type: "repairResult"; restored: boolean };
export interface ReviewTransition {
  state: ReviewState;
  rating?: PrototypeLightweightRating;
  repaired?: boolean;
}
/** Repair never issues a second Memory Outcome for the due review. */
export function transitionReview(
  state: ReviewState,
  action: ReviewAction,
  targets: readonly string[],
): ReviewTransition {
  const targetId = targets[state.index];
  if (!targetId || state.phase === "summary") return { state };
  const advance = (rating: PrototypeLightweightRating): ReviewState => ({
    ...state,
    results: [...state.results, { targetId, rating }],
    index: state.index + 1 < targets.length ? state.index + 1 : state.index,
    phase: state.index + 1 < targets.length ? "recall" : "summary",
  });
  if (
    action.type === "reveal" &&
    (state.phase === "recall" || state.phase === "retry")
  )
    return {
      state: {
        ...state,
        phase: state.phase === "recall" ? "answer" : "retry_answer",
      },
    };
  if (action.type === "rate" && state.phase === "answer")
    return {
      state:
        action.rating === "again"
          ? { ...state, phase: "repair" }
          : advance(action.rating),
      rating: action.rating,
    };
  if (action.type === "retry" && state.phase === "repair")
    return { state: { ...state, phase: "retry" } };
  if (action.type === "repairResult" && state.phase === "retry_answer")
    return action.restored
      ? { state: advance("again"), repaired: true }
      : { state: { ...state, phase: "repair" } };
  return { state };
}
