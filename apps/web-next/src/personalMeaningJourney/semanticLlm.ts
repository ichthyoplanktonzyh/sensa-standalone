/**
 * Shared provenance and proposal draft shapes.
 *
 * These shapes cross the semantic agent seam: the HTTP adapter reports the
 * provenance of every turn, and Sense candidates are described with the same
 * scene/contrast vocabulary the gateway later stamps into contract facts.
 *
 * Domain invariant (personal-semantic-world-model.md §4, production-architecture
 * Module 8): the model only *proposes and clarifies*. It never accepts a
 * Focus, confirms a Sense, creates an Alignment or binds an Expression — those
 * are deterministic learner facts owned by the gateway regardless of adapter.
 */

/** Provenance the adapter reports so the gateway can stamp contract facts. */
export interface SemanticLlmProvenance {
  provider: string;
  model: string;
  promptVersion: string;
}

export interface ProposalDraftScene {
  summary: string;
  participantRoles: string[];
  states: string[];
  directionOrCausality: string | null;
}

export interface ProposalDraftNeighborContrast {
  label: string;
  distinction: string;
}
