import type {
  IngestResult,
  SensaIntakeItem,
  SensaIntakePayload,
  SensaIntakeSense,
} from '@sensa/contracts/sensa';

/**
 * Result of a durable Intake command. `replayed` is diagnostic only: callers
 * must treat an exact retry exactly like the original successful command.
 */
export type SemanticIntakeResult = IngestResult & { replayed: boolean };

export interface ResolveSemanticIntakeCommand {
  operationId: string;
  intakeId: string;
  sense: SensaIntakeSense;
}

export interface DismissSemanticIntakeCommand {
  operationId: string;
  intakeId: string;
}

/**
 * The port-neutral Semantic Intake deep Module interface.
 *
 * Every Intake Surface submits the same payload here. The Module owns schema
 * validation, operation idempotency, fast/slow routing, Inbox lifecycle and
 * the atomic hand-off into the Personal Semantic World. Transport identity,
 * mailbox delivery and clarification presentation stay outside this seam.
 */
export interface SemanticIntakeModule {
  subscribe(listener: () => void): () => void;
  snapshot(): SensaIntakeItem[];
  submit(payload: SensaIntakePayload): Promise<SemanticIntakeResult>;
  resolve(command: ResolveSemanticIntakeCommand): Promise<SemanticIntakeResult>;
  dismiss(command: DismissSemanticIntakeCommand): Promise<void>;
}
