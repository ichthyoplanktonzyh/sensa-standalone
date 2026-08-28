import type {
  EncounterModule,
  EncounterStep,
  InterruptEncounterInput,
  OpenEncounterInput,
  SubmitAttemptInput,
} from "@sensa/learning-kernel";

export type {
  EncounterModule,
  EncounterStep,
  InterruptEncounterInput,
  OpenEncounterInput,
  SubmitAttemptInput,
};

export const sensaEncounterContractVersion = "sensa-encounter-v1" as const;

export type SensaEncounterErrorCode =
  | "not_found"
  | "scope_mismatch"
  | "runtime_version_unsupported"
  | "content_unavailable"
  | "not_openable"
  | "terminal_state_conflict"
  | "replica_scope_mismatch"
  | "attempt_identity_conflict"
  | "attempt_ordinal_conflict"
  | "action_not_current"
  | "response_invalid"
  | "response_version_unsupported"
  | "invalid_input"
  | "state_corrupt"
  | "schedule_conflict"
  | "revision_conflict"
  | "kernel_replay_failed"
  | "rule_violation";

export class SensaEncounterError extends Error {
  readonly code: SensaEncounterErrorCode;
  readonly statusCode: number;

  constructor(code: SensaEncounterErrorCode, message: string, statusCode = 409) {
    super(message);
    this.name = "SensaEncounterError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function createEncounterError(
  code: SensaEncounterErrorCode,
  message: string,
  statusCode = 409,
): SensaEncounterError {
  return new SensaEncounterError(code, message, statusCode);
}

export function isCompletedStep(step: EncounterStep): step is Extract<EncounterStep, { kind: "completed" }> {
  return step.kind === "completed";
}
