import assert from 'node:assert/strict';
// web-next keeps its own React 18 install; use the matching renderer for this
// server-only smoke so React elements do not cross duplicate runtimes.
import React from '../apps/web-next/node_modules/react/index.js';
import { renderToStaticMarkup } from '../apps/web-next/node_modules/react-dom/server.node.js';
import runtimeReleaseJson from '../apps/web-next/src/content/releases/golden-learning-release-v1.json';
import { validateRuntimeLearningRelease } from '@sensa/content-validator/runtime';
import type { SensaRuntimeLearningRelease } from '@sensa/contracts/sensa';
import { LearnQueue } from '../apps/web-next/src/engine/LearnQueue.ts';
import {
  ReviewQueue,
  type ReviewRuntimeEffect,
} from '../apps/web-next/src/engine/ReviewQueue.ts';
import { storageService } from '../apps/web-next/src/services/storageService.ts';
import type {
  LearningCapability,
  ReviewCandidate,
  SchedulablePackage,
  Session,
} from '../apps/web-next/src/engine/types.ts';
import { reviewOutcomeKey } from '../apps/web-next/src/engine/types.ts';
import type {
  ReviewAssessmentKind,
  ReviewAssessmentResult,
  ReviewFocusDimension,
} from '../apps/web-next/src/review/types.ts';
import {
  PROTOTYPE_LEARNING_PACKAGES,
  materializeReviewRepairContent,
  runtimeLearningRelease,
} from '../apps/web-next/src/content/learningCatalog.ts';
import {
  materializeAssessmentResource,
} from '../apps/web-next/src/content/assessmentResources.ts';
import { buildPrototypeReviewAssessment } from '../apps/web-next/src/content/prototypeReviewCards.ts';
import { SensaReviewAssessmentCard } from '../apps/web-next/src/components/cards/review/SensaReviewAssessmentCard.tsx';
import {
  LearningPolicyProfileRegistry,
  PROTOTYPE_LEARNING_POLICY_PROFILES,
  learningPolicyProfileRegistry,
  type LearningPolicyProfileDefinition,
  type PrototypeLearningPolicy,
} from '../apps/web-next/src/learningRuntime/policyProfiles.ts';
import {
  LearningRuntimeCoordinator,
  learningRuntimeCoordinator,
} from '../apps/web-next/src/learningRuntime/runtimeCoordinator.ts';

const smokeLocalStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => smokeLocalStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { smokeLocalStorage.set(key, value); },
    removeItem: (key: string) => { smokeLocalStorage.delete(key); },
    clear: () => { smokeLocalStorage.clear(); },
  },
});

function assertCondition(condition: unknown, message: string): asserts condition {
  assert.equal(Boolean(condition), true, message);
}

function renderedText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function reviewKind(capability: LearningCapability): ReviewAssessmentKind {
  switch (capability) {
    case 'contextual_recognition': return 'context_recognition';
    case 'meaning_to_form_recall': return 'meaning_to_form_recall';
    case 'novel_context_transfer': return 'novel_context_transfer';
    case 'boundary_discrimination': return 'boundary_contrast';
    default: throw new Error(`Unsupported review capability: ${capability}`);
  }
}

function focusFor(kind: ReviewAssessmentKind): ReviewFocusDimension {
  switch (kind) {
    case 'context_recognition': return '语境辨义';
    case 'meaning_to_form_recall': return '词形提取';
    case 'novel_context_transfer': return '新语境迁移';
    case 'boundary_contrast': return '义项边界';
  }
}

function settleLearningAction<TContent>(queue: LearnQueue<TContent>, session: Session<TContent>): void {
  switch (session.action.capability) {
    case 'introduction':
      queue.completeIntroduction();
      return;
    case 'contextual_recognition':
      queue.completeRecognition(true);
      return;
    case 'meaning_to_form_recall':
      queue.completeMeaningToFormRecall('independent');
      return;
    case 'novel_context_transfer':
      queue.completeNovelTransfer('success');
      return;
    case 'boundary_discrimination':
      queue.completeBoundary(true);
      return;
  }
}

function collectInterleavedOrder(): string[] {
  const queue = new LearnQueue(PROTOTYPE_LEARNING_PACKAGES, { activeWindow: 3, minGap: 2 });
  const order: string[] = [];
  let session = queue.getCurrentSession();
  let guard = 0;
  while (!queue.isDone() && session && guard < 240) {
    order.push(session.action.senseId);
    settleLearningAction(queue, session);
    session = queue.next();
    guard += 1;
  }
  assertCondition(queue.isDone(), 'Learn Queue should finish all Package Gates in the smoke fixture.');
  assertCondition(order.length > 0, 'Learn Queue should emit at least one action.');
  assertCondition(new Set(order.slice(0, 3)).size === 3, 'The first active window must contain three different Senses.');

  // The fourth Package must not be permanently hidden behind the initial
  // three. It should be introduced as soon as a window slot is available.
  const fourthSense = PROTOTYPE_LEARNING_PACKAGES[3]?.senseId;
  assertCondition(fourthSense && order.includes(fourthSense), 'The scheduler must eventually introduce every Package.');
  assertCondition(order.indexOf(fourthSense) < 16, 'A later Package must not starve behind the first active window.');

  // Check the portion where at least three active Senses are available. The
  // configured minGap means two other Actions must be between appearances.
  const lastBySense = new Map<string, number>();
  for (let index = 0; index < Math.min(order.length, 16); index += 1) {
    const senseId = order[index]!;
    const previous = lastBySense.get(senseId);
    if (previous !== undefined) {
      assertCondition(
        index - previous - 1 >= 2,
        `minGap must count other Actions between ${senseId} appearances.`,
      );
    }
    lastBySense.set(senseId, index);
  }
  return order;
}

function checkDirectionalFailure(): void {
  const packages = PROTOTYPE_LEARNING_PACKAGES.slice(0, 3);
  const queue = new LearnQueue(packages, { activeWindow: 3, minGap: 2 });
  let session = queue.getCurrentSession();
  assertCondition(session?.action.capability === 'introduction', 'A new Sense must start with Introduction.');

  // Fill the active window before any Gate assessment.
  for (let index = 0; index < 3; index += 1) {
    assertCondition(session?.action.capability === 'introduction', 'The active window must fill with Introductions first.');
    queue.completeIntroduction();
    session = queue.next();
  }
  assertCondition(session?.action.capability === 'contextual_recognition', 'The first Gate should be contextual recognition.');
  const failedSenseId = session!.action.senseId;
  const failedActionKey = session!.action.actionKey;
  queue.completeRecognition(false);
  const failedState = queue.getState(session!.action.packageId);
  assert.equal(failedState?.gateStatus.contextual_recognition, 'failed');
  assert.equal(failedState?.gateStatus.meaning_to_form_recall, 'unresolved');

  // The failure is not immediately repeated. We must first see at least two
  // other Sense Actions, then a distinct scheduler-created repair Action.
  let otherActionsBeforeRepair = 0;
  session = queue.next();
  while (session && session.action.senseId !== failedSenseId && otherActionsBeforeRepair < 20) {
    otherActionsBeforeRepair += 1;
    settleLearningAction(queue, session);
    session = queue.next();
  }
  assertCondition(session, 'A failed Gate must remain schedulable.');
  assertCondition(session.action.senseId === failedSenseId, 'The failed Sense should return for repair.');
  assertCondition(otherActionsBeforeRepair >= 2, 'Repair must follow at least minGap other Sense Actions.');
  assert.equal(session.action.mode, 'repair');
  assert.notEqual(session.action.actionKey, failedActionKey, 'A repair must not reuse the failed assessment identity.');
  assert.equal(session.action.taskKey, null, 'A scheduler repair must not masquerade as the assessment task.');
  assert.equal(session.action.repairResourceRef?.source, 'package_declared');
  assertCondition(session.action.repairResourceRef?.key, 'A repair must reference an approved Package resource.');
  assert.notEqual(session.action.repairResourceRef?.source, 'scheduler_fallback');

  queue.completeRecognition(true);
  const afterRepair = queue.getState(failedSenseId)!;
  assert.equal(afterRepair.gateStatus.contextual_recognition, 'unresolved');
  assert.equal(afterRepair.repairCounts.contextual_recognition, 1);

  // Repair itself is not Evidence. The independent retest also has to wait
  // for the same configured interference interval.
  let otherActionsBeforeRetest = 0;
  session = queue.next();
  while (
    session
    && !(session.action.senseId === failedSenseId
      && session.action.capability === 'contextual_recognition'
      && session.action.mode === 'assessment')
    && otherActionsBeforeRetest < 30
  ) {
    if (session.action.senseId !== failedSenseId) otherActionsBeforeRetest += 1;
    settleLearningAction(queue, session);
    session = queue.next();
  }
  assertCondition(session, 'The failed Gate must receive an independent retest after repair.');
  assert.equal(session.action.senseId, failedSenseId);
  assert.equal(session.action.mode, 'assessment');
  assert.notEqual(session.action.actionKey, session.action.repairForActionKey, 'Retest must not be the repair Action.');
  assertCondition(otherActionsBeforeRetest >= 2, 'Retest must follow repair interference spacing.');

  // A targeted failure does not erase unrelated Gates.
  const singleQueue = new LearnQueue([packages[0]!], { activeWindow: 1, minGap: 0 });
  let single = singleQueue.getCurrentSession();
  singleQueue.completeIntroduction();
  single = singleQueue.next();
  assert.equal(single?.action.capability, 'contextual_recognition');
  singleQueue.completeRecognition(true);
  single = singleQueue.next();
  assert.equal(single?.action.capability, 'meaning_to_form_recall');
  singleQueue.completeMeaningToFormRecall('independent');
  single = singleQueue.next();
  assert.equal(single?.action.capability, 'novel_context_transfer');
  singleQueue.completeNovelTransfer('repair');
  const targetedState = singleQueue.getState(packages[0]!.packageId)!;
  assert.equal(targetedState.gateStatus.contextual_recognition, 'passed');
  assert.equal(targetedState.gateStatus.meaning_to_form_recall, 'passed');
  assert.equal(targetedState.gateStatus.novel_context_transfer, 'failed');
}

function checkDeclaredMastery(): void {
  const packageItem = PROTOTYPE_LEARNING_PACKAGES[0];
  assertCondition(packageItem, 'Declared Mastery needs a Package.');
  const queue = new LearnQueue([packageItem]);
  const before = queue.getState(packageItem.packageId)!;
  const initialProjection = queue.getProjection();
  assert.equal(initialProjection.currentAction?.senseId, packageItem.senseId);
  assert.equal(
    initialProjection.targets[0]?.gates.length,
    packageItem.requiredCapabilities.filter((capability) => capability !== 'introduction').length,
  );
  queue.skipCurrent();
  const after = queue.getState(packageItem.packageId)!;
  assert.equal(after.phase, before.phase, 'Declared Mastery must not force retaining phase.');
  assert.equal(after.declaredMastery, true);
  assert.equal(after.skipped, true);
  assert.deepEqual(queue.getGraduatedSenseIds(), [], 'Declared Mastery must not count as Acquisition Graduation.');
  assert.equal(queue.isDone(), true, 'Declared Mastery should exclude the Sense from this planning run.');
  const excludedProjection = queue.getProjection().targets[0]!;
  assert.equal(excludedProjection.declaredMastery, true);
  assert.equal(excludedProjection.graduated, false);
  assert.deepEqual(excludedProjection.gates, initialProjection.targets[0]?.gates);

  assert.equal(queue.setDeclaredMastery(packageItem.senseId, false), true);
  const restored = queue.getState(packageItem.packageId)!;
  assert.equal(restored.declaredMastery, false);
  assert.equal(restored.skipped, false);
  assert.equal(restored.phase, before.phase);
  assert.deepEqual(restored.gateStatus, before.gateStatus);
  assert.equal(queue.isDone(), false, 'Revocation must restore the untouched acquisition run.');
  assert.equal(queue.next()?.action.capability, 'introduction');
}

function checkReviewDeclaredMasteryExclusion(): void {
  const packageItem = PROTOTYPE_LEARNING_PACKAGES[0];
  assertCondition(packageItem, 'Review Declared Mastery needs a Package.');
  const effects: ReviewRuntimeEffect<typeof packageItem.content>[] = [];
  const queue = new ReviewQueue([{
    package: packageItem,
    dueAt: 0,
    reps: 1,
    lapses: 0,
    phase: 'retaining',
  }], {
    onEffect: (effect) => effects.push(effect),
  });
  const current = queue.getCurrentSession();
  assertCondition(current, 'Review Declared Mastery needs an active Encounter.');
  assert.equal(queue.getProjection().targets[0]?.status, 'reviewing');
  const interrupted = queue.excludeCurrentForDeclaredMastery();
  assert.equal(interrupted?.action.senseId, current.action.senseId);
  assert.equal(effects.length, 0, 'Declared Mastery must not emit a Review or Relearning effect.');
  assert.equal(queue.getStats().totalAttempts, 0);
  assert.equal(queue.getStats().completedWords, 0);
  assert.equal(queue.isDone(), true, 'The declared Target must leave the current Planning inventory.');
  const excludedProjection = queue.getProjection();
  assert.equal(excludedProjection.currentAction, null);
  assert.equal(excludedProjection.targets[0]?.status, 'declared_mastery');
  assert.equal(excludedProjection.targets[0]?.memoryOutcome, null);
  assert.equal(excludedProjection.targets[0]?.reviewSettled, false);
}

function makeReviewResult(
  session: NonNullable<ReturnType<ReviewQueue['getCurrentSession']>>,
  correct: boolean,
): ReviewAssessmentResult {
  return {
    assessmentId: `${session.action.actionKey}.smoke`,
    kind: session.assessmentKind,
    // Deliberately contradictory; ReviewQueue must canonicalize this from
    // the valid Action kind rather than trusting the UI.
    focusDimension: '义项边界',
    correct,
    responseId: 'smoke',
    memoryOutcome: correct ? 'retrieval_failed' : 'transfer_confirmed',
    evidenceEligible: false,
  };
}

function checkReviewSettlement(): void {
  const packageItem = PROTOTYPE_LEARNING_PACKAGES[0];
  assertCondition(packageItem, 'A Review Package is required.');
  const senseId = packageItem.senseId;
  const now = Date.now();
  storageService.saveFSRSItem({
    wordId: senseId,
    state: 'review',
    stability: 12,
    difficulty: 5,
    reps: 7,
    lapses: 1,
    lastReview: now - 4 * 24 * 60 * 60 * 1000,
    due: 0,
    scheduledDays: 2,
  });
  const candidate: ReviewCandidate<typeof packageItem.content> = {
    package: packageItem,
    dueAt: 0,
    reps: 2,
    lapses: 7,
    phase: 'retaining',
  };
  const successfulQueue = new ReviewQueue([candidate]);
  const successfulSession = successfulQueue.getCurrentSession();
  assertCondition(successfulSession, 'A successful projection fixture needs an active Review.');
  assert.equal(successfulQueue.getProjection().targets[0]?.status, 'reviewing');
  successfulQueue.settle(makeReviewResult(successfulSession, true));
  const successfulProjection = successfulQueue.getProjection().targets[0]!;
  assert.equal(successfulProjection.status, 'retaining');
  assert.equal(successfulProjection.reviewSettled, true);
  assert.equal(successfulProjection.memoryOutcome, 'independent_retrieval');
  assert.equal(successfulProjection.relearningCompleted, false);

  const effects: ReviewRuntimeEffect<typeof packageItem.content>[] = [];
  const queue = new ReviewQueue([candidate], {
    onEffect: (effect) => {
      effects.push(effect);
      storageService.applyReviewRuntimeEffect(effect);
    },
  });
  const session = queue.getCurrentSession();
  assertCondition(session, 'A due retaining Sense must emit a Review session.');
  assert.equal(queue.getProjection().currentAction?.reason, 'due');
  assert.equal(queue.getProjection().targets[0]?.status, 'reviewing');
  assert.notEqual(session.action.capability, 'boundary_discrimination');
  assertCondition(
    packageItem.reviewActions.some((action) => action.actionKey === session.action.actionKey),
    'Review must select only an installed Package task.',
  );
  const result = makeReviewResult(session, true);
  const failedResult = makeReviewResult(session, false);
  const failed = queue.settle(failedResult)!;
  assert.equal(failed.stage, 'review_feedback');
  assert.equal(failed.assessmentKind, session.assessmentKind);
  assert.equal(failed.result?.memoryOutcome, 'retrieval_failed');
  assert.equal(failed.result?.focusDimension, focusFor(session.assessmentKind));
  assert.equal(failed.result?.evidenceEligible, true);
  const failedProjection = queue.getProjection().targets[0]!;
  assert.equal(failedProjection.status, 'relearning_repair');
  assert.equal(failedProjection.reviewSettled, true);
  assert.equal(failedProjection.memoryOutcome, 'retrieval_failed');
  assert.equal(effects.filter((effect) => effect.type === 'retention_outcome').length, 1);
  const failedMemory = { ...storageService.getFSRSItems()[senseId]! };
  assert.equal(failedMemory.state, 'relearning');
  assert.equal(failedMemory.reps, 8);
  const cycle = storageService.getRelearningCycle(senseId);
  assertCondition(cycle, 'A failed retention outcome must open a targeted Relearning Cycle.');
  assert.equal(cycle.targetCapability, session.action.capability);
  assert.equal(cycle.stage, 'repair_pending');
  assert.equal(cycle.repairCount, 0);

  // A repeated submit and undo/replay cannot call the external settlement a
  // second time. The persisted guard remains even if the queue is rebuilt.
  queue.settle(failedResult);
  assert.equal(effects.filter((effect) => effect.type === 'retention_outcome').length, 1);
  const undone = queue.undo();
  assertCondition(undone && !undone.settled, 'Undo should restore local assessment without external rollback.');
  // Even a changed answer on replay cannot replace the already emitted
  // Memory Outcome for this stable due Review identity.
  const replayed = queue.settle(result)!;
  assert.equal(replayed.result?.memoryOutcome, 'retrieval_failed');
  assert.equal(effects.filter((effect) => effect.type === 'retention_outcome').length, 1);
  assert.equal(queue.getStats().totalAttempts, 1);
  const outcomeKey = reviewOutcomeKey(candidate, session.action);
  assertCondition(storageService.getSettledReviewOutcome(outcomeKey), 'The stable retention outcome guard must persist.');

  const rebuiltEffects: ReviewRuntimeEffect<typeof packageItem.content>[] = [];
  const rebuiltQueue = new ReviewQueue([candidate], {
    onEffect: (effect) => {
      rebuiltEffects.push(effect);
      storageService.applyReviewRuntimeEffect(effect);
    },
  });
  const rebuiltSession = rebuiltQueue.getCurrentSession();
  assertCondition(rebuiltSession, 'A rebuilt queue must still expose the due Package action.');
  rebuiltQueue.settle(makeReviewResult(rebuiltSession, false));
  assert.equal(
    rebuiltEffects.filter((effect) => effect.type === 'retention_outcome').length,
    1,
    'A rebuilt queue may emit an effect, but the persisted guard must prevent a second settlement.',
  );
  assert.deepEqual(
    storageService.getFSRSItems()[senseId],
    failedMemory,
    'Rebuilding the queue must not advance FSRS a second time.',
  );

  let repair = queue.next();
  assertCondition(repair, 'A failed Review must schedule a repair Action.');
  assert.equal(repair.action.mode, 'repair');
  assert.equal(repair.action.kind, 'acquisition_gate');
  assert.equal(repair.action.capability, cycle.targetCapability);
  assert.equal(repair.action.taskKey, null);
  assert.equal(repair.action.repairResourceRef?.source, 'package_declared');
  assert.equal(queue.getProjection().targets[0]?.status, 'relearning_repair');
  assertCondition(repair.action.repairResourceRef?.key, 'Repair must reference a Package resource.');
  const declaredRepair = packageItem.repairActions?.find((action) =>
    action.capability === cycle.targetCapability && action.mode === 'repair');
  assertCondition(declaredRepair, 'The selected capability must have a declared Package repair.');
  assert.equal(
    repair.action.repairResourceRef?.key,
    declaredRepair.repairResourceRef?.key,
    'Review repair must route the exact declared Package resource key.',
  );
  assert.equal(
    repair.action.repairResourceRef?.role,
    declaredRepair.repairResourceRef?.role,
    'Review repair must preserve the declared Package resource role.',
  );
  const repairBefore = { ...storageService.getFSRSItems()[senseId]! };
  queue.completeRepair();
  assert.equal(queue.getProjection().targets[0]?.status, 'relearning_retest');
  assert.equal(effects.filter((effect) => effect.type === 'relearning_progress').length, 1);
  const afterRepair = storageService.getRelearningCycle(senseId)!;
  assert.equal(afterRepair.stage, 'retest_pending');
  assert.equal(afterRepair.repairCount, 1);
  assert.deepEqual(storageService.getFSRSItems()[senseId], repairBefore, 'Repair must not update FSRS.');

  const retest = queue.next();
  assertCondition(retest, 'Repair must be followed by an independent relearning gate.');
  assert.equal(retest.action.kind, 'relearning_gate');
  assert.equal(retest.action.mode, 'assessment');
  assert.equal(retest.action.capability, cycle.targetCapability);
  assert.equal(queue.getProjection().targets[0]?.status, 'relearning_retest');
  const retestSettled = queue.settle(makeReviewResult(retest, true))!;
  assert.equal(retestSettled.result?.evidenceEligible, false);
  assert.equal(effects.filter((effect) => effect.type === 'retention_outcome').length, 1);
  assert.equal(
    effects.filter((effect) => effect.type === 'relearning_progress' && effect.event === 'retest_passed').length,
    1,
  );
  const completedMemory = storageService.getFSRSItems()[senseId]!;
  assert.equal(completedMemory.state, 'review');
  assert.deepEqual(
    { ...completedMemory, state: failedMemory.state },
    failedMemory,
    'Relearning completion must preserve every failed-Review memory field except state.'
  );
  assert.equal(storageService.getRelearningCycle(senseId), null);
  const completedProjection = queue.getProjection().targets[0]!;
  assert.equal(completedProjection.status, 'retaining');
  assert.equal(completedProjection.relearningCompleted, true);
  assert.equal(completedProjection.memoryOutcome, 'retrieval_failed');
  assert.equal(queue.next(), null);
  assert.equal(queue.isDone(), true);

  // A cycle that fails its independent retest loops through repair again and
  // still emits no second retention Memory Outcome.
  const loopEffects: ReviewRuntimeEffect<typeof packageItem.content>[] = [];
  const loopQueue = new ReviewQueue([candidate], {
    onEffect: (effect) => loopEffects.push(effect),
  });
  const loopReview = loopQueue.getCurrentSession()!;
  loopQueue.settle(makeReviewResult(loopReview, false));
  const loopRepair = loopQueue.next()!;
  loopQueue.completeRepair();
  const loopRetest = loopQueue.next()!;
  loopQueue.settle(makeReviewResult(loopRetest, false));
  assert.equal(loopQueue.next()?.action.mode, 'repair');
  assert.equal(loopEffects.filter((effect) => effect.type === 'retention_outcome').length, 1);
  assert.equal(
    loopEffects.filter((effect) => effect.type === 'relearning_progress' && effect.event === 'retest_failed').length,
    1,
  );
  assert.equal(loopEffects.filter((effect) => effect.type === 'retention_outcome')[0]?.result.memoryOutcome, 'retrieval_failed');

  // Reconstructing a queue from the persisted Cycle resumes at repair rather
  // than waiting for the conservative FSRS due time.
  const restoredCycle = storageService.getRelearningCycle(senseId);
  assert.equal(restoredCycle, null, 'The completed cycle should not be restorable.');
  const diagnosticQueue = new ReviewQueue([{
    ...candidate,
    phase: 'relearning',
    relearning: {
      ...cycle,
      stage: 'repair_pending',
      repairCount: 2,
    },
  }]);
  const diagnosticSession = diagnosticQueue.getCurrentSession();
  assertCondition(diagnosticSession, 'A persisted Relearning cycle should resume with a Package repair.');
  assert.equal(diagnosticSession.action.mode, 'repair');
  assert.equal(diagnosticSession.action.capability, cycle.targetCapability);

  // Records written by the previous MVP may contain only FSRS.relearning.
  // The separated runtime projection must be able to upgrade that state on
  // the first repair effect, without changing any memory fields.
  storageService.saveFSRSItem({ ...completedMemory, state: 'relearning' });
  const legacyEffects: ReviewRuntimeEffect<typeof packageItem.content>[] = [];
  const legacyQueue = new ReviewQueue([{
    ...candidate,
    phase: 'relearning',
    relearning: null,
  }], {
    onEffect: (effect) => {
      legacyEffects.push(effect);
      storageService.applyReviewRuntimeEffect(effect);
    },
  });
  const legacyRepair = legacyQueue.getCurrentSession();
  assertCondition(legacyRepair, 'Legacy FSRS relearning must resume at Package repair.');
  assert.equal(legacyRepair.action.mode, 'repair');
  const legacyMemoryBefore = { ...storageService.getFSRSItems()[senseId]! };
  legacyQueue.completeRepair();
  assert.equal(storageService.getRelearningCycle(senseId)?.stage, 'retest_pending');
  assert.deepEqual(
    storageService.getFSRSItems()[senseId],
    legacyMemoryBefore,
    'Upgrading legacy Relearning must not revise FSRS during repair.',
  );
  assert.equal(
    legacyEffects.filter((effect) => effect.type === 'relearning_progress' && effect.event === 'repair_completed').length,
    1,
  );
  const legacyRetest = legacyQueue.next();
  assertCondition(legacyRetest, 'Upgraded legacy Relearning must expose its independent retest.');
  legacyQueue.settle(makeReviewResult(legacyRetest, true));
  assert.equal(storageService.getRelearningCycle(senseId), null);

  // Boundary-only due work is not silently consumed. A Package with a normal
  // task still chooses the normal task and leaves the boundary as a separate
  // diagnostic capability for a future eligible settlement contract.
  const boundaryPackage = PROTOTYPE_LEARNING_PACKAGES.find((item) =>
    item.content.boundaryContrast !== null);
  assertCondition(boundaryPackage, 'The runtime fixture must contain a Package with a Boundary relation.');
  const boundaryOnlyPackage: typeof boundaryPackage = {
    ...boundaryPackage,
    reviewActions: boundaryPackage.reviewActions.filter((action) =>
      action.capability === 'boundary_discrimination'),
  };
  const boundaryMemoryBefore = { ...storageService.getFSRSItems()[senseId]! };
  const boundaryQueue = new ReviewQueue([{
    ...candidate,
    package: boundaryOnlyPackage,
  }]);
  assert.equal(boundaryQueue.getCurrentSession(), null, 'Boundary-only due work must not become a completed Review.');
  assert.equal(boundaryQueue.isDone(), true);
  assert.deepEqual(
    storageService.getFSRSItems()[senseId],
    boundaryMemoryBefore,
    'Boundary-only due work must preserve the existing Memory projection.',
  );

  assertCondition(
    boundaryPackage.requiredCapabilities.includes('boundary_discrimination'),
    'Boundary must be driven by Package capability inventory.',
  );
  assertCondition(
    boundaryPackage.actions.some((action) => action.capability === 'boundary_discrimination'),
    'Boundary must have an executable acquisition action.',
  );
  assertCondition(
    boundaryPackage.reviewActions.some((action) => action.capability === 'boundary_discrimination'),
    'Boundary may be present in Package review inventory without becoming an automatic due settlement.',
  );
}

function checkPrototypeGraduationHandoff(): void {
  const senseId = 'smoke.prototype-graduation-immediate-review';
  const startedAt = Date.now();
  const graduated = storageService.graduateSense(senseId, 0);

  assertCondition(
    graduated.due >= startedAt && graduated.due <= Date.now(),
    'The local prototype must make the first high-assurance Review immediately due.',
  );
  assert.equal(graduated.scheduledDays, 0);
  assert.deepEqual(storageService.getDueSenseIds([senseId]), [senseId]);
}

function checkPolicyProfileRuntimeSeam(): void {
  const ready = {
    view: { status: 'ready' as const, label: 'ready', detail: 'runtime smoke' },
    provisioned: true,
  };
  const allReady = () => ready;
  const actualPlan = learningPolicyProfileRegistry.resolve('high_assurance', allReady);
  assert.equal(
    actualPlan.purposes.initial_learning.binding.runtimeAdapterId,
    'structured',
  );
  assert.equal(
    learningRuntimeCoordinator.surfaceFor('lightweight', 'retention_review'),
    'lightweight_retention',
  );
  assert.deepEqual(
    learningRuntimeCoordinator.planInitial('structured-b', [
      {
        targetId: 'lightweight-a',
        profileId: 'lightweight',
        ready: true,
        executable: true,
      },
      {
        targetId: 'structured-a',
        profileId: 'high_assurance',
        ready: true,
        executable: true,
      },
      {
        targetId: 'structured-b',
        profileId: 'high_assurance',
        ready: true,
        executable: true,
      },
    ]),
    {
      purpose: 'initial_learning',
      protocol: PROTOTYPE_LEARNING_POLICY_PROFILES[1].protocols.initial_learning,
      adapterId: 'structured',
      surface: 'structured_session',
      targetIds: ['structured-b', 'structured-a'],
    },
  );
  assert.deepEqual(
    learningRuntimeCoordinator.planRetention([
      {
        targetId: 'structured-a',
        profileId: 'high_assurance',
        ready: true,
        executable: true,
      },
      {
        targetId: 'lightweight-a',
        profileId: 'lightweight',
        ready: true,
        executable: true,
      },
    ]).map((launch) => launch.surface),
    ['lightweight_retention', 'structured_session'],
  );

  type ExtendedProfileId = PrototypeLearningPolicy | 'configuration_only_profile';
  const lightweightProfile = PROTOTYPE_LEARNING_POLICY_PROFILES[0];
  const highAssuranceProfile = PROTOTYPE_LEARNING_POLICY_PROFILES[1];
  const configurationOnlyProfile = {
    ...lightweightProfile,
    profileId: 'configuration_only_profile',
    profileVersion: 'configuration-only-profile-v1',
    presentation: {
      ...lightweightProfile.presentation,
      label: 'Configuration-only profile',
    },
    protocols: {
      initial_learning: lightweightProfile.protocols.initial_learning,
      retention_review: highAssuranceProfile.protocols.retention_review,
      relearning: highAssuranceProfile.protocols.relearning,
    },
  } as const satisfies LearningPolicyProfileDefinition<'configuration_only_profile'>;
  const extendedProfiles: readonly LearningPolicyProfileDefinition<ExtendedProfileId>[] = [
    ...PROTOTYPE_LEARNING_POLICY_PROFILES,
    configurationOnlyProfile,
  ];
  const extendedRegistry = new LearningPolicyProfileRegistry<ExtendedProfileId>(extendedProfiles);
  const extendedCoordinator = new LearningRuntimeCoordinator(extendedRegistry);
  const plan = extendedRegistry.resolve('configuration_only_profile', allReady);
  assert.equal(plan.purposes.initial_learning.binding.protocolId, 'lightweight-study');
  assert.equal(plan.purposes.retention_review.binding.runtimeAdapterId, 'structured');
  assert.equal(plan.purposes.relearning.binding.runtimeAdapterId, 'structured');

  const initialLaunch = extendedCoordinator.planInitial('target-a', [{
    targetId: 'target-a',
    profileId: 'configuration_only_profile',
    ready: true,
    executable: true,
  }]);
  assert.deepEqual(initialLaunch, {
    purpose: 'initial_learning',
    protocol: lightweightProfile.protocols.initial_learning,
    adapterId: 'lightweight',
    surface: 'lightweight_initial',
    targetIds: ['target-a'],
  });
  assert.deepEqual(
    extendedCoordinator.planRetention([{
      targetId: 'target-a',
      profileId: 'configuration_only_profile',
      ready: true,
      executable: true,
    }]),
    [{
      purpose: 'retention_review',
      protocol: highAssuranceProfile.protocols.retention_review,
      adapterId: 'structured',
      surface: 'structured_session',
      targetIds: ['target-a'],
    }],
  );
}

function checkReviewRelearningInterference(): void {
  const candidates = PROTOTYPE_LEARNING_PACKAGES.slice(0, 3).map((packageItem) => ({
    package: packageItem,
    dueAt: 0,
    reps: 0,
    lapses: 0,
    phase: 'retaining' as const,
  }));
  const availableSenseIds = new Set(candidates.map((candidate) => candidate.package.senseId));
  assert.equal(availableSenseIds.size, 3, 'The interference fixture must contain three Senses.');

  const queue = new ReviewQueue(candidates, { minGap: 2 });
  const firstReview = queue.getCurrentSession();
  assertCondition(firstReview, 'A multi-Sense Review fixture must start with a retention assessment.');
  const targetSenseId = firstReview.action.senseId;
  queue.settle(makeReviewResult(firstReview, false));

  // Keep the two unrelated Senses available by failing their first retention
  // assessment too. This leaves two concrete Package Actions to intervene
  // after the target's repair, instead of exhausting the queue before retest.
  const otherSensesBeforeRepair: string[] = [];
  let session = queue.next();
  let guard = 0;
  while (session && session.action.senseId !== targetSenseId && guard < 12) {
    otherSensesBeforeRepair.push(session.action.senseId);
    queue.settle(makeReviewResult(session, false));
    session = queue.next();
    guard += 1;
  }
  assertCondition(session, 'The failed multi-Sense Review must remain schedulable.');
  assert.equal(session.action.senseId, targetSenseId);
  assert.equal(session.action.mode, 'repair');
  assertCondition(
    otherSensesBeforeRepair.length >= 2
      && new Set(otherSensesBeforeRepair.slice(0, 2)).size === 2,
    'A failed retention assessment must wait for two different Senses before repair.',
  );

  queue.completeRepair();
  const otherSensesBeforeRetest: string[] = [];
  session = queue.next();
  guard = 0;
  while (session && session.action.senseId !== targetSenseId && guard < 12) {
    otherSensesBeforeRetest.push(session.action.senseId);
    if (session.action.mode === 'repair') {
      queue.completeRepair();
    } else {
      queue.settle(makeReviewResult(session, false));
    }
    session = queue.next();
    guard += 1;
  }
  assertCondition(session, 'The repaired Sense must remain schedulable for an independent retest.');
  assert.equal(session.action.senseId, targetSenseId);
  assert.equal(session.action.kind, 'relearning_gate');
  assert.equal(session.action.mode, 'assessment');
  assertCondition(
    otherSensesBeforeRetest.length >= 2
      && new Set(otherSensesBeforeRetest.slice(0, 2)).size === 2,
    'A repair must wait for two different Senses before relearning retest.',
  );

  // With no alternative Sense, the documented safe fallback is immediate and
  // observable: the next Action is returned on the very next ordinal rather
  // than stalling or falsely claiming that minGap was satisfied.
  const singleCandidate = {
    ...candidates[0]!,
    dueAt: 1,
  };
  const fallbackQueue = new ReviewQueue([singleCandidate], { minGap: 2 });
  const fallbackReview = fallbackQueue.getCurrentSession();
  assertCondition(fallbackReview, 'The single-Sense fallback fixture must start with a Review.');
  fallbackQueue.settle(makeReviewResult(fallbackReview, false));
  const fallbackRepair = fallbackQueue.next();
  assertCondition(fallbackRepair, 'A single Sense must use the safe repair fallback instead of stalling.');
  assert.equal(fallbackRepair.action.senseId, singleCandidate.package.senseId);
  assert.equal(fallbackRepair.action.mode, 'repair');
  assert.equal(
    fallbackRepair.action.ordinal,
    fallbackReview.action.ordinal + 1,
    'The single-Sense repair fallback must be explicit in the immediate ordinal.',
  );
  fallbackQueue.completeRepair();
  const fallbackRetest = fallbackQueue.next();
  assertCondition(fallbackRetest, 'The single-Sense fallback must continue to its retest.');
  assert.equal(fallbackRetest.action.senseId, singleCandidate.package.senseId);
  assert.equal(fallbackRetest.action.kind, 'relearning_gate');
  assert.equal(
    fallbackRetest.action.ordinal,
    fallbackRepair.action.ordinal + 1,
    'The single-Sense retest fallback must also proceed without stalling.',
  );
  fallbackQueue.settle(makeReviewResult(fallbackRetest, true));
  assert.equal(fallbackQueue.next(), null);
  assert.equal(fallbackQueue.isDone(), true);
}

function checkMissingMediaFailsClosed(release: SensaRuntimeLearningRelease): void {
  const firstExample = release.packages[0]?.examples.find((example) =>
    example.renders.some((render) => render.kind === 'static_audio'));
  const audioRender = firstExample?.renders.find((render) => render.kind === 'static_audio');
  assertCondition(audioRender?.kind === 'static_audio', 'The fixture must contain a Package audio reference.');
  const brokenRelease = structuredClone(release);
  brokenRelease.media = brokenRelease.media.filter((media) => media.mediaKey !== audioRender.mediaKey);
  const result = validateRuntimeLearningRelease(brokenRelease);
  assert.equal(result.status, 'invalid');
  assertCondition(
    result.issues.some((issue) => issue.code === 'reference.media_missing'),
    'A missing Package media reference must fail admission.',
  );
}

function checkPackageHasNoLearnerState(release: SensaRuntimeLearningRelease): void {
  const mutableRelease = structuredClone(release);
  const firstPackage = mutableRelease.packages[0] as unknown as Record<string, unknown>;
  firstPackage.learnerState = { phase: 'acquiring' };
  const result = validateRuntimeLearningRelease(mutableRelease);
  assert.equal(result.status, 'invalid');
  assertCondition(
    result.issues.some((issue) => issue.code.startsWith('schema.')),
    'Learner state must not be admitted into a runtime Package.',
  );
}

function checkPackageRepairInventory(): void {
  for (const packageItem of PROTOTYPE_LEARNING_PACKAGES) {
    const requiredCapabilities = packageItem.requiredCapabilities.filter((capability) =>
      capability !== 'introduction');
    for (const capability of requiredCapabilities) {
      const repair = packageItem.repairActions?.find((action) =>
        action.capability === capability && action.mode === 'repair');
      assertCondition(repair, `${packageItem.packageId} needs a repair Action for ${capability}.`);
      assert.equal(repair.taskKey, null, 'A repair Action must not masquerade as an assessment task.');
      assert.equal(repair.repairResourceRef?.source, 'package_declared');
      assertCondition(repair.repairResourceRef?.key, 'Repair metadata must expose an approved resource key.');
      assert.notEqual(repair.repairResourceRef?.fallbackReason, 'repair_binding_not_exposed');

      const rawPackage = runtimeLearningRelease.packages.find((candidate) =>
        candidate.identity.packageKey === packageItem.packageId
        && candidate.identity.senseKey === packageItem.senseId,
      );
      assertCondition(rawPackage, `${packageItem.packageId} must have an installed raw Package.`);
      const resourceRef = repair.repairResourceRef!;
      const materializedContent = materializeReviewRepairContent(packageItem.content, resourceRef);
      assertCondition(
        materializedContent,
        `${packageItem.packageId} ${capability} repair must materialize from its declared resource.`,
      );
      switch (resourceRef.role) {
        case 'experience_recap':
          assert.equal(rawPackage.experience.recap.recapKey, resourceRef.key);
          break;
        case 'l1_bridge':
          assert.equal(rawPackage.l1Bridge.assetKey, resourceRef.key);
          break;
        case 'learning_example':
          assertCondition(
            rawPackage.examples.some((example) =>
              example.exampleKey === resourceRef.key
              && example.visibility === 'learning_only'),
            `${packageItem.packageId} repair must bind a learning-only Package Example.`,
          );
          assertCondition(
            packageItem.content.learningExamples.some((example) =>
              example.exampleKey === resourceRef.key),
            `${packageItem.packageId} repair Example must survive catalog projection.`,
          );
          assert.equal(materializedContent.studyExample.exampleKey, resourceRef.key);
          break;
        case 'sense_features':
          assertCondition(
            runtimeLearningRelease.relations.some((relation) => relation.relationKey === resourceRef.key),
            `${packageItem.packageId} repair must bind an installed Package relation.`,
          );
          assert.equal(materializedContent.studyExample.exampleKey, packageItem.content.boundaryContrast?.example.exampleKey);
          break;
      }
    }
  }

  const borrow = PROTOTYPE_LEARNING_PACKAGES.find((item) => item.packageId.startsWith('borrow.'));
  const boundaryRepair = borrow?.repairActions?.find((action) =>
    action.capability === 'boundary_discrimination');
  assert.equal(
    boundaryRepair?.repairResourceRef?.key,
    'borrow-lend.viewpoint-temporary-transfer.v1',
    'The explicit Borrow boundary repair must preserve its declared relation identity.',
  );
}

function checkReviewActionResourceBinding(): void {
  for (const packageItem of PROTOTYPE_LEARNING_PACKAGES) {
    const rawPackage = runtimeLearningRelease.packages.find((candidate) =>
      candidate.identity.packageKey === packageItem.packageId
      && candidate.identity.senseKey === packageItem.senseId,
    );
    assertCondition(rawPackage, `${packageItem.packageId} must have an installed raw Package.`);

    for (const action of packageItem.reviewActions) {
      assertCondition(action.taskKey, `${action.actionKey} must retain its concrete Assessment Resource key.`);
      const kind = reviewKind(action.capability);
      const spec = buildPrototypeReviewAssessment(packageItem.content, kind, action.taskKey);
      assert.equal(
        spec.id,
        `${action.taskKey}.action-assessment`,
        'Review materialization must preserve the Action-selected task identity.',
      );

      switch (kind) {
        case 'context_recognition': {
          assert.equal(spec.kind, kind);
          const task = rawPackage.assessmentInventory.contextualRecognition.find(
            (candidate) => candidate.taskKey === action.taskKey,
          );
          assertCondition(task, `${action.taskKey} must resolve to contextual Recognition.`);
          assert.equal(spec.example.exampleKey, task.exampleKey);
          assert.equal(spec.questionL1, task.questionL1);
          assert.deepEqual(
            spec.options.map((option) => option.detailL1),
            task.options.map((option) => option.detailL1),
            'Recognition option details must survive exact resource projection.',
          );
          break;
        }
        case 'meaning_to_form_recall': {
          assert.equal(spec.kind, kind);
          const task = rawPackage.assessmentInventory.meaningToFormRecall.find(
            (candidate) => candidate.taskKey === action.taskKey,
          );
          assertCondition(task, `${action.taskKey} must resolve to Meaning-to-form Recall.`);
          assert.equal(spec.cueL1, task.cue.bodyL1);
          break;
        }
        case 'novel_context_transfer': {
          assert.equal(spec.kind, kind);
          const task = rawPackage.assessmentInventory.novelContextTransfer.find(
            (candidate) => candidate.taskKey === action.taskKey,
          );
          assertCondition(task, `${action.taskKey} must resolve to novel Transfer.`);
          assert.equal(spec.scenario.id, task.taskKey);
          assert.equal(spec.scenario.exampleKey, task.exampleKey);
          assert.equal(spec.scenario.questionL1, task.questionL1);
          break;
        }
        case 'boundary_contrast': {
          assert.equal(spec.kind, kind);
          const task = rawPackage.assessmentInventory.boundaryContrast.find(
            (candidate) => candidate.taskKey === action.taskKey,
          );
          assertCondition(task, `${action.taskKey} must resolve to Boundary Contrast.`);
          assert.equal(spec.example.exampleKey, task.exampleKey);
          assert.equal(spec.questionL1, task.questionL1);
          assert.deepEqual(
            spec.options.map((option) => option.detailL1),
            task.options.map((option) => option.detailL1),
            'Boundary option details must survive exact resource projection.',
          );
          break;
        }
      }
    }

    const transferActions = packageItem.reviewActions.filter(
      (action) => action.capability === 'novel_context_transfer' && action.taskKey,
    );
    if (transferActions.length > 1) {
      const firstAction = transferActions[0]!;
      const lastAction = transferActions[transferActions.length - 1]!;
      const first = buildPrototypeReviewAssessment(
        packageItem.content,
        'novel_context_transfer',
        firstAction.taskKey,
      );
      const last = buildPrototypeReviewAssessment(
        packageItem.content,
        'novel_context_transfer',
        lastAction.taskKey,
      );
      assert.equal(first.kind, 'novel_context_transfer');
      assert.equal(last.kind, 'novel_context_transfer');
      assert.notEqual(
        first.scenario.id,
        last.scenario.id,
        'Two same-capability Actions must not collapse onto one Transfer resource.',
      );
    }
  }

  const packageItem = PROTOTYPE_LEARNING_PACKAGES[0];
  assertCondition(packageItem, 'The smoke fixture must expose at least one projected Package.');
  const recognitionAction = packageItem.reviewActions.find(
    (action) => action.capability === 'contextual_recognition' && action.taskKey,
  );
  assertCondition(recognitionAction?.taskKey, 'The smoke fixture must expose a Recognition task key.');
  assert.throws(
    () => buildPrototypeReviewAssessment(
      packageItem.content,
      'novel_context_transfer',
      recognitionAction.taskKey,
    ),
    /is not a novel Transfer resource/,
    'A task key presented as the wrong assessment kind must fail closed.',
  );
  assert.throws(
    () => buildPrototypeReviewAssessment(packageItem.content, 'context_recognition', null),
    /must carry a non-null taskKey/,
    'An assessment Action without a concrete task key must fail closed.',
  );
}

function checkLearningActionResourceBinding(): void {
  const queue = new LearnQueue(PROTOTYPE_LEARNING_PACKAGES, { activeWindow: 3, minGap: 2 });
  let session = queue.getCurrentSession();
  let guard = 0;
  while (!queue.isDone() && session && guard < 240) {
    const { action } = session;
    if (action.capability !== 'introduction') {
      const kind = reviewKind(action.capability);
      const resource = materializeAssessmentResource({
        packageIdentity: {
          packageKey: session.package.packageId,
          senseKey: session.package.senseId,
        },
        content: session.package.content,
        taskKey: action.taskKey,
        kind,
        capability: action.capability,
      });
      assert.equal(resource.taskKey, action.taskKey);
      assert.equal(resource.packageKey, action.packageId);
    }
    settleLearningAction(queue, session);
    session = queue.next();
    guard += 1;
  }
  assertCondition(queue.isDone(), 'Learn Actions must all resolve to their exact Package resources.');
}

function checkSensaReviewRenderedResource(): void {
  const packageItem = PROTOTYPE_LEARNING_PACKAGES.find((item) =>
    item.reviewActions.some((action) => action.capability === 'novel_context_transfer')
      && item.reviewActions.filter((action) => action.capability === 'novel_context_transfer').length > 1,
  );
  assertCondition(packageItem, 'The smoke fixture must expose multiple Transfer review tasks.');
  const actions = [...new Map(
    packageItem.reviewActions
      .filter((action) => action.capability === 'novel_context_transfer' && action.taskKey)
      .map((action) => [action.taskKey!, action] as const),
  ).values()];
  const firstAction = actions[0]!;
  const secondAction = actions[1]!;
  const firstSpec = buildPrototypeReviewAssessment(
    packageItem.content,
    'novel_context_transfer',
    firstAction.taskKey,
  );
  const firstResource = materializeAssessmentResource({
    packageIdentity: {
      packageKey: packageItem.packageId,
      senseKey: packageItem.senseId,
    },
    content: packageItem.content,
    taskKey: firstAction.taskKey,
    kind: 'novel_context_transfer',
    capability: 'novel_context_transfer',
  });
  if (firstResource.kind !== 'novel_context_transfer') {
    throw new Error('Transfer Action must materialize a Transfer resource.');
  }
  assert.equal(firstSpec.taskKey, firstAction.taskKey);
  assert.equal(firstResource.scenario.id, firstAction.taskKey);
  const html = renderToStaticMarkup(React.createElement(SensaReviewAssessmentCard, {
    content: packageItem.content,
    spec: firstSpec,
    assessmentResource: firstResource,
    purpose: 'retention',
    onSubmit: () => undefined,
    onOpenDictionary: () => undefined,
    onOpenExample: () => undefined,
    onOpenNote: () => undefined,
    onOpenScene: () => undefined,
    lookupDictionary: () => null,
    onViewChange: () => undefined,
    toast: () => undefined,
  }));
  assert.match(html, new RegExp(`data-assessment-task-key="${firstAction.taskKey}"`));
  assert.ok(
    renderedText(html).replace(/\s+/g, '').includes(firstResource.scenario.setupL2.replace(/\s+/g, '')),
    'Sensa Review must render the selected Transfer scene text.',
  );
  const secondResource = materializeAssessmentResource({
    packageIdentity: {
      packageKey: packageItem.packageId,
      senseKey: packageItem.senseId,
    },
    content: packageItem.content,
    taskKey: secondAction.taskKey,
    kind: 'novel_context_transfer',
    capability: 'novel_context_transfer',
  });
  if (secondResource.kind !== 'novel_context_transfer') {
    throw new Error('Transfer Action must materialize a Transfer resource.');
  }
  assert.notEqual(firstResource.scenario.id, secondResource.scenario.id);
  assert.notEqual(firstResource.scenario.setupL2, secondResource.scenario.setupL2);
}

function checkAssessmentResourceFailures(): void {
  const packageItem = PROTOTYPE_LEARNING_PACKAGES[0];
  assertCondition(packageItem, 'The smoke fixture must expose a projected Package.');
  const recognitionAction = packageItem.reviewActions.find(
    (action) => action.capability === 'contextual_recognition' && action.taskKey,
  );
  assertCondition(recognitionAction?.taskKey, 'The smoke fixture must expose a Recognition task key.');
  const identity = {
    packageKey: packageItem.packageId,
    senseKey: packageItem.senseId,
  };
  assert.throws(
    () => materializeAssessmentResource({
      packageIdentity: identity,
      content: packageItem.content,
      taskKey: recognitionAction.taskKey,
      kind: 'novel_context_transfer',
    }),
    /is not a novel Transfer resource/,
    'A task key presented as the wrong assessment kind must fail closed.',
  );
  assert.throws(
    () => materializeAssessmentResource({
      packageIdentity: identity,
      content: packageItem.content,
      taskKey: null,
      kind: 'context_recognition',
    }),
    /must carry a non-null taskKey/,
    'An Assessment Action without a concrete task key must fail closed.',
  );
  assert.throws(
    () => materializeAssessmentResource({
      packageIdentity: identity,
      content: packageItem.content,
      taskKey: recognitionAction.taskKey,
      kind: 'context_recognition',
      capability: 'novel_context_transfer',
    }),
    /does not match/,
    'A scheduler capability/kind mismatch must fail closed.',
  );
  assert.throws(
    () => materializeAssessmentResource({
      packageIdentity: { packageKey: 'wrong-package', senseKey: packageItem.senseId },
      content: packageItem.content,
      taskKey: recognitionAction.taskKey,
      kind: 'context_recognition',
    }),
    /identity mismatch/,
    'A stale Package identity must fail closed.',
  );
}

const runtimeRelease = runtimeReleaseJson as unknown as SensaRuntimeLearningRelease;
const runtimeValidation = validateRuntimeLearningRelease(runtimeRelease);
assert.equal(runtimeValidation.status, 'satisfied');
assert.equal(runtimeValidation.release?.packages.length, 4);
for (const packageItem of runtimeRelease.packages) {
  assertCondition(packageItem.examples.length > 0, `${packageItem.identity.packageKey} needs Examples.`);
  assertCondition(
    packageItem.assessmentInventory.contextualRecognition.some((task) =>
      task.eligiblePurposes.includes('acquisition_gate')),
    `${packageItem.identity.packageKey} needs an acquisition Recognition task.`,
  );
  assertCondition(
    packageItem.assessmentInventory.meaningToFormRecall.some((task) =>
      task.eligiblePurposes.includes('acquisition_gate')),
    `${packageItem.identity.packageKey} needs an acquisition Recall task.`,
  );
  assertCondition(
    packageItem.assessmentInventory.novelContextTransfer.some((task) =>
      task.eligiblePurposes.includes('acquisition_gate')),
    `${packageItem.identity.packageKey} needs an acquisition Transfer task.`,
  );
}
assert.equal(runtimeLearningRelease.release.sourceDigest, runtimeRelease.release.sourceDigest);
const projectedExperienceKinds = PROTOTYPE_LEARNING_PACKAGES.map((item) => item.content.experience.kind);
assert.deepEqual(
  projectedExperienceKinds,
  ['interaction', 'interaction', 'text', 'text'],
  'Learning Catalog must follow each Package Render Plan instead of forcing every Sense through interaction.',
);
for (const packageItem of PROTOTYPE_LEARNING_PACKAGES) {
  const experience = packageItem.content.experience;
  if (experience.kind === 'text') {
    assertCondition(experience.sceneL1.length > 0, 'A Text Experience Render must expose a complete scene.');
  } else {
    assertCondition(
      experience.fallbackTextSceneL1,
      'A non-text preferred Experience Render must expose its approved Text Experience Render fallback.',
    );
  }
}
checkPackageRepairInventory();
checkReviewActionResourceBinding();
checkLearningActionResourceBinding();
checkSensaReviewRenderedResource();
checkAssessmentResourceFailures();

const firstOrder = collectInterleavedOrder();
const secondOrder = collectInterleavedOrder();
assert.deepEqual(firstOrder, secondOrder, 'Learn scheduling must be deterministic.');
checkDirectionalFailure();
checkDeclaredMastery();
checkReviewDeclaredMasteryExclusion();
checkPrototypeGraduationHandoff();
checkPolicyProfileRuntimeSeam();
checkReviewSettlement();
checkReviewRelearningInterference();
checkMissingMediaFailsClosed(runtimeRelease);
checkPackageHasNoLearnerState(runtimeRelease);

console.log(JSON.stringify({
  validatorVersion: runtimeValidation.validatorVersion,
  runtimeStatus: runtimeValidation.status,
  packages: runtimeRelease.packages.length,
  experienceKinds: projectedExperienceKinds,
  firstActions: firstOrder.slice(0, 16),
  interleaving: true,
  fairness: true,
  directionalFailure: true,
  repairSpacing: true,
  targetedFailure: true,
  declaredMasteryOrthogonal: true,
  reviewDeclaredMasteryExcludedWithoutOutcome: true,
  prototypeGraduationImmediatelyDue: true,
  policyProfileRuntimeSeam: true,
  conditionalBoundary: true,
  boundaryDuePreserved: true,
  oneReviewOneOutcome: true,
  inconsistentOutcomeCanonicalized: true,
  relearningNoFsrsReplay: true,
  reviewRelearningInterference: true,
  reviewFeedbackWired: true,
  reviewActionResourceBound: true,
  learnActionResourceBound: true,
  sensaReviewRenderedResourceBound: true,
  assessmentResourceFailClosed: true,
  repairResourceBound: true,
  missingMediaFailClosed: true,
  learnerStateRejected: true,
}, null, 2));
