import type {
  SensaLearningSessionSnapshot,
  SensaPinnedSenseLearningPackageSnapshot,
  SensaPlanNextResult,
  SensaSyncSenseEncounterSnapshot,
  SensaSyncStudyPlanSnapshot,
} from "@sensa/contracts/sensa";
import type { LearningAction } from "@sensa/learning-kernel";
import { SensaContractError, sensaApi, type SensaScope } from "./api";
import { sensaContent } from "./content";
import { resolveActionView, type StudyActionView } from "./features/study/resolveActionView";
import { nextAttemptOrdinal, unresolvedAttemptOperations } from "./features/study/lifecycle";
import {
  createLocalAction,
  outboxRecord,
  sensaStore,
  type SensaLocalSnapshot,
} from "./store";
import { encounterInterruptOperation, learningAttemptOperation, synchronize } from "./sync";

export type SensaActiveEncounter = Readonly<{
  encounterId: string;
  learningSessionId: string;
  studyPlanId: string;
  senseId: string;
  kind: "introduction" | "review";
  sessionOrdinal: number;
  revision: number;
}>;

/** Everything a renderer is allowed to see, and nothing beyond it. */
export type SensaStudyTarget = Readonly<{
  encounter: SensaActiveEncounter;
  action: LearningAction;
  item: SensaPinnedSenseLearningPackageSnapshot;
  view: StudyActionView;
}>;

export type SensaStudyStep = Readonly<
  | { kind: "action"; target: SensaStudyTarget }
  | { kind: "rejected"; encounter: SensaActiveEncounter; senseId: string; reason: string }
  | { kind: "exhausted"; reason: Extract<SensaPlanNextResult, { kind: "no_candidate" }>["reason"] }
  | { kind: "no_plan" }
>;

export function activePlan(snapshot: SensaLocalSnapshot): SensaSyncStudyPlanSnapshot | null {
  return snapshot.plans.find((plan) => plan.status === "active") ?? null;
}

export function encounterOf(
  snapshot: SensaLocalSnapshot,
  encounterId: string,
): SensaSyncSenseEncounterSnapshot | null {
  return snapshot.encounters.find((item) => item.senseEncounterId === encounterId) ?? null;
}

function activeEncounter(source: Readonly<{
  encounterId: string;
  learningSessionId: string;
  studyPlanId: string;
  senseId: string;
  kind: "introduction" | "review";
  sessionOrdinal: number;
  revision: number;
}>): SensaActiveEncounter {
  return { ...source };
}

async function ensureSession(
  scope: SensaScope,
  snapshot: SensaLocalSnapshot,
  plan: SensaSyncStudyPlanSnapshot,
): Promise<SensaLearningSessionSnapshot> {
  const existing = snapshot.sessions.find(
    (item) => item.studyPlanId === plan.studyPlanId && item.status === "active",
  );
  return sensaApi.startOrResumeSession(
    scope,
    plan.studyPlanId,
    existing?.learningSessionId ?? crypto.randomUUID(),
  );
}

/**
 * Builds the one renderable step for an Action. The Action's ordered asset
 * references are the closed list of what may be shown; a package that cannot
 * satisfy them is rejected with its reason rather than being partially drawn.
 */
function toStep(
  encounter: SensaActiveEncounter,
  action: LearningAction,
  item: SensaPinnedSenseLearningPackageSnapshot,
): SensaStudyStep {
  const view = resolveActionView(action, item, encounter.encounterId);
  if (!view.valid) {
    return { kind: "rejected", encounter, senseId: encounter.senseId, reason: view.reason };
  }
  return { kind: "action", target: { encounter, action, item, view } };
}

/**
 * Opens an Encounter the planner has just handed us. The package is fetched
 * first because it is the only thing the client owes; the Action, its order and
 * its stopping condition all come from the server.
 */
async function openStep(
  scope: SensaScope,
  encounter: SensaActiveEncounter,
): Promise<SensaStudyStep> {
  const item = await sensaContent.package(scope, encounter.studyPlanId, encounter.senseId);
  const opened = await sensaApi.openEncounter(scope, encounter.encounterId);
  if (opened.kind !== "next_action") {
    throw new SensaContractError(
      "sense-encounters/open",
      "服务端返回了一个没有下一步动作的已完成 Encounter。",
    );
  }
  await sensaStore.setCurrentAction(createLocalAction(opened.action, encounter.encounterId));
  return toStep(encounter, opened.action, item);
}

/**
 * Asks the planner for the next Sense and opens it. Planning is a server
 * decision: this never picks a Sense, a kind, or an order of its own.
 */
export async function planNextStep(
  scope: SensaScope,
  snapshot: SensaLocalSnapshot,
): Promise<SensaStudyStep> {
  const plan = activePlan(snapshot);
  if (plan === null) return { kind: "no_plan" };
  const session = await ensureSession(scope, snapshot, plan);
  const planned = await sensaApi.planNext(scope, plan.studyPlanId, session.learningSessionId);
  if (planned.kind === "no_candidate") return { kind: "exhausted", reason: planned.reason };
  return openStep(scope, activeEncounter(planned.encounter));
}

/**
 * Rebuilds the step for an Action that survived a reload. Resume must not
 * re-plan: the Encounter is already open and its current Action is a fact.
 */
export async function resumeStep(
  scope: SensaScope,
  snapshot: SensaLocalSnapshot,
): Promise<SensaStudyStep | null> {
  const current = snapshot.meta.currentAction;
  if (current === null) return null;
  const stored = encounterOf(snapshot, current.encounterId);
  if (stored === null || stored.status !== "active") {
    await sensaStore.setCurrentAction(null);
    return null;
  }
  const encounter = activeEncounter({
    encounterId: stored.senseEncounterId,
    learningSessionId: stored.learningSessionId,
    studyPlanId: stored.studyPlanId,
    senseId: stored.senseId,
    kind: stored.kind,
    sessionOrdinal: stored.sessionOrdinal,
    revision: stored.revision,
  });
  const item = await sensaContent.package(scope, encounter.studyPlanId, encounter.senseId);
  return toStep(encounter, current.action, item);
}

export type SensaAttemptResult = Readonly<
  | { kind: "blocked"; snapshot: SensaLocalSnapshot }
  | { kind: "step"; snapshot: SensaLocalSnapshot; step: SensaStudyStep; notice: string | null }
  | {
      kind: "encounter_closed";
      snapshot: SensaLocalSnapshot;
      encounterId: string;
      status: string | undefined;
      notice: string | null;
    }
>;

/**
 * Records one Attempt and reports what the server decided next. The client
 * never evaluates the response, never decides whether the Encounter is over,
 * and never emits its own follow-up Action.
 */
export async function submitAttempt(input: Readonly<{
  scope: SensaScope;
  snapshot: SensaLocalSnapshot;
  target: SensaStudyTarget;
  response: Readonly<Record<string, unknown>>;
  durationMs: number | null;
}>): Promise<SensaAttemptResult> {
  const { scope, snapshot, target } = input;
  const actionId = target.action.learningActionId;
  if (unresolvedAttemptOperations(snapshot, actionId).length > 0) {
    return { kind: "blocked", snapshot };
  }
  const current = snapshot.meta.currentAction;
  const ordinal = nextAttemptOrdinal(
    snapshot,
    actionId,
    current?.learningActionId === actionId ? current.attemptOrdinal : 1,
  );
  await sensaStore.addOutbox(outboxRecord(scope, learningAttemptOperation({
    attemptId: crypto.randomUUID(),
    encounterId: target.encounter.encounterId,
    actionId,
    ordinal,
    response: input.response,
    durationMs: input.durationMs,
  })));

  const synchronized = await synchronize(scope);
  const next = synchronized.snapshot.meta.currentAction;
  if (next !== null && next.encounterId === target.encounter.encounterId) {
    const encounter = encounterOf(synchronized.snapshot, target.encounter.encounterId);
    const revised = encounter === null
      ? target.encounter
      : { ...target.encounter, revision: encounter.revision };
    return {
      kind: "step",
      snapshot: synchronized.snapshot,
      step: toStep(revised, next.action, target.item),
      notice: synchronized.notice,
    };
  }
  return {
    kind: "encounter_closed",
    snapshot: synchronized.snapshot,
    encounterId: target.encounter.encounterId,
    status: encounterOf(synchronized.snapshot, target.encounter.encounterId)?.status,
    notice: synchronized.notice,
  };
}

/**
 * Leaves an Encounter without answering it. Interruption produces no Attempt,
 * no Evidence and no Memory Outcome; the Sense simply returns on its own
 * schedule.
 */
export async function leaveEncounter(
  scope: SensaScope,
  encounter: SensaActiveEncounter,
  status: "interrupted" | "cancelled" = "interrupted",
): Promise<void> {
  await sensaStore.setCurrentAction(null);
  await sensaStore.addOutbox(outboxRecord(scope, encounterInterruptOperation({
    encounterId: encounter.encounterId,
    expectedRevision: encounter.revision,
    status,
  })));
}

/** The Memory Outcome the server recorded for a closed Encounter, if pulled. */
export function outcomeOf(snapshot: SensaLocalSnapshot, encounterId: string): Readonly<{
  outcomeKind: "introduced" | "retrieval_failed" | "supported_retrieval" | "independent_retrieval" | "transfer_confirmed";
  senseId: string;
}> | null {
  for (const fact of snapshot.appendFacts) {
    if (fact.factType === "memory_outcome" && fact.fact.senseEncounterId === encounterId) {
      return { outcomeKind: fact.fact.outcomeKind, senseId: fact.fact.senseId };
    }
  }
  return null;
}

/**
 * The server's verdict on the most recent Attempt for one Action. Correctness
 * is never computed on this side -- it is read back from the accepted fact so
 * the learner is told what actually happened, not what the client guessed.
 */
export function latestAttemptVerdict(
  snapshot: SensaLocalSnapshot,
  actionId: string,
): Readonly<{ actionId: string; isCorrect: boolean | null; evaluationCode: string }> | null {
  let best: Readonly<{ ordinal: number; isCorrect: boolean | null; evaluationCode: string }> | null = null;
  for (const item of snapshot.appendFacts) {
    if (item.factType !== "learning_attempt") continue;
    const fact = item.fact;
    if (fact.learningActionId !== actionId || fact.validity !== "valid") continue;
    if (best === null || fact.ordinal > best.ordinal) {
      best = { ordinal: fact.ordinal, isCorrect: fact.isCorrect, evaluationCode: fact.evaluationCode };
    }
  }
  return best === null
    ? null
    : { actionId, isCorrect: best.isCorrect, evaluationCode: best.evaluationCode };
}
