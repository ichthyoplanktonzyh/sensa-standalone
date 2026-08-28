import type { DatabaseExecutor } from "../../database/index.js";
import {
  sensaSyncWireVersion,
  type SensaSyncOperation,
  type SensaSyncPushInput,
  type SensaSyncV2Operation,
  type SensaSyncV2PushInput,
} from "@sensa/contracts/sensa";
import { executeDeclaredMasteryOperation } from "./operations/declaredMastery.js";
import { executeEncounterOperation } from "./operations/encounter.js";
import { executePlanSessionOperation } from "./operations/planSession.js";
import type {
  OperationExecution,
  V2OperationExecution,
} from "./operations/types.js";

export async function executeDomainOperation(
  executor: DatabaseExecutor,
  input: SensaSyncPushInput,
  operation: SensaSyncOperation,
): Promise<OperationExecution> {
  switch (operation.kind) {
    case "study_plan.create":
    case "study_plan.update":
    case "learning_session.start":
    case "learning_session.complete":
      return executePlanSessionOperation(executor, input.scope, operation);
    case "sense_encounter.open":
    case "learning_attempt.record":
    case "sense_encounter.complete":
    case "sense_encounter.interrupt":
      return executeEncounterOperation(executor, input.scope, operation);
  }
}

export async function executeV2DomainOperation(
  executor: DatabaseExecutor,
  input: SensaSyncV2PushInput,
  operation: SensaSyncV2Operation,
): Promise<V2OperationExecution> {
  if (operation.kind === "learner_declared_mastery.set") {
    return executeDeclaredMasteryOperation(executor, input.scope, operation);
  }
  const v1Input: SensaSyncPushInput = {
    scope: input.scope,
    wireVersion: sensaSyncWireVersion,
    cursors: input.cursors,
    operations: [operation],
  };
  return executeDomainOperation(executor, v1Input, operation);
}
