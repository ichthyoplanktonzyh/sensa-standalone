/**
 * Deterministic Personal Meaning journey smoke.
 *
 * No test framework, network, paid LLM or browser is involved. The smoke
 * drives the same gateway seam the React clarification workspace uses —
 * save material, append blocks, confirm a clarification thread, settle the
 * last Expression Binding — and validates stored facts with the existing
 * contract schemas.
 */

import {
  sensaConfirmExpressionBindingFactSchema,
  sensaConfirmSenseProposalFactSchema,
  sensaExpressionSnapshotSchema,
  sensaExpressionVersionSnapshotSchema,
  sensaMeaningFocusAcceptanceFactSchema,
  sensaMeaningFocusRevisionSnapshotSchema,
  sensaMeaningFocusSnapshotSchema,
  sensaPersonalExpressionAnchorRevisionSnapshotSchema,
  sensaPersonalExpressionAnchorSnapshotSchema,
  sensaPersonalMeaningAlignmentEventSchema,
  sensaPersonalMeaningAlignmentSnapshotSchema,
  sensaPersonalMeaningRevisionSnapshotSchema,
  sensaPersonalMeaningSnapshotSchema,
  sensaPersonalSemanticAnchorRevisionSnapshotSchema,
  sensaPersonalSemanticAnchorSnapshotSchema,
  sensaSenseConstructionSnapshotSchema,
  sensaSenseConstructionTurnSchema,
  sensaSenseExpressionBindingSnapshotSchema,
  sensaSenseExpressionBindingVersionSnapshotSchema,
  sensaSenseProposalSnapshotSchema,
  sensaSenseProposalVersionSnapshotSchema,
  sensaSenseSnapshotSchema,
  sensaSenseVersionSnapshotSchema,
  sensaSemanticAcceptanceFactSchema,
} from '@sensa/contracts/sensa';
import { createJourneyGateway } from './gateway';
import { createSeededIdPort } from './ids';
import { MemoryStoragePort, createSeededClock } from './ports';
import { loadJourneyState, JOURNEY_STORE_KEY } from './store';
import type { PersonalMeaningJourneyGateway } from './gateway';
import type {
  ConfirmClarificationInput,
  CreatePersonalMeaningInput,
} from './types';

let checks = 0;
const assert = (condition: boolean, message: string): void => {
  checks += 1;
  if (!condition) throw new Error(`SMOKE FAILED: ${message}`);
};

const op = (n: number): string =>
  `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;

const expectFailure = async (
  action: () => Promise<unknown>,
  message: string,
): Promise<void> => {
  try {
    await action();
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`SMOKE FAILED: ${message}`);
};

const newGateway = (storage: MemoryStoragePort): PersonalMeaningJourneyGateway =>
  createJourneyGateway({
    storage,
    clock: createSeededClock(),
    ids: createSeededIdPort(1),
  });

const createMeaning = async (
  gateway: PersonalMeaningJourneyGateway,
  input: Omit<CreatePersonalMeaningInput, 'operationId'>,
  operationNumber: number,
): Promise<string> => {
  const result = await gateway.createPersonalMeaning({
    operationId: op(operationNumber),
    ...input,
  });
  assert(result.personalMeaningId.length === 36, 'created Personal Meaning uses one bare UUID');
  const replay = await gateway.createPersonalMeaning({
    operationId: op(operationNumber),
    ...input,
  });
  assert(replay.personalMeaningId === result.personalMeaningId, 'CreatePersonalMeaning replay keeps exact id');
  assert(replay.replayed, 'CreatePersonalMeaning replay is marked');
  return result.personalMeaningId;
};

const PROVENANCE = { provider: 'smoke', model: 'smoke-model', promptVersion: 'smoke-v1' };
const POLICY_VERSION = 'sensa-semantic-policy-smoke-v1';

const borrowSense = {
  proposedSenseKey: 'borrow-temporary-use-return',
  coreMeaningFocus: '暂时取得别人的东西使用，并预期归还',
  prototypeScenes: [{
    summary: '一方把自己的物品暂时交给另一方使用',
    participantRoles: ['出借者', '借用者'],
    states: ['物品暂时易手', '预期归还'],
    directionOrCausality: '从所有者流向使用者',
  }],
  includedCases: ['借伞', '借书'],
  excludedCases: ['收到礼物'],
  neighborContrasts: [{ label: 'lend', distinction: '方向相反，是出借方视角' }],
  openQuestions: [],
  unresolvedQuestions: [],
};

const lendSense = {
  ...borrowSense,
  proposedSenseKey: 'lend-temporary-use-return',
  coreMeaningFocus: '把自己的东西暂时给别人使用，并预期收回',
};

const transcript = (learnerBody: string) => [
  {
    messageId: op(900),
    role: 'assistant' as const,
    body: '你想强调的是暂时取得别人的东西，并且之后会归还吗？',
    occurredAt: '2026-01-01T00:00:00.000Z',
  },
  {
    messageId: op(901),
    role: 'learner' as const,
    body: learnerBody,
    occurredAt: '2026-01-01T00:00:01.000Z',
  },
];

const clarificationInput = (
  personalMeaningId: string,
  operationNumber: number,
  overrides: Partial<ConfirmClarificationInput> = {},
): ConfirmClarificationInput => ({
  operationId: op(operationNumber),
  personalMeaningId,
  focus: {
    statement: '从他人那里暂时取得某物，用完之后归还',
    distinguishingNotes: ['重点在“我这边暂时得到了东西”'],
    aspectLabel: '接收方向',
  },
  sense: borrowSense,
  expression: {
    surfaceForm: 'borrow',
    expressionType: 'word',
    languageTag: 'en',
    relation: 'realizes',
    semanticCoverage: 'exact',
  },
  confirmExpression: true,
  transcript: transcript('对，我关注的是拿来使用并预期归还。'),
  provenance: PROVENANCE,
  semanticPolicyVersion: POLICY_VERSION,
  ...overrides,
});

const validateFacts = (storage: MemoryStoragePort): void => {
  const state = loadJourneyState(storage);
  for (const record of state.meanings) {
    sensaPersonalMeaningSnapshotSchema.parse(record.personalMeaning);
    record.personalMeaningRevisions.forEach((fact) => sensaPersonalMeaningRevisionSnapshotSchema.parse(fact));
    record.personalSemanticAnchors.forEach((fact) => sensaPersonalSemanticAnchorSnapshotSchema.parse(fact));
    record.personalSemanticAnchorRevisions.forEach((fact) => sensaPersonalSemanticAnchorRevisionSnapshotSchema.parse(fact));
    record.personalExpressionAnchors.forEach((fact) => sensaPersonalExpressionAnchorSnapshotSchema.parse(fact));
    record.personalExpressionAnchorRevisions.forEach((fact) => sensaPersonalExpressionAnchorRevisionSnapshotSchema.parse(fact));
    record.focuses.forEach((fact) => sensaMeaningFocusSnapshotSchema.parse(fact));
    record.focusRevisions.forEach((fact) => sensaMeaningFocusRevisionSnapshotSchema.parse(fact));
    record.focusAcceptances.forEach((fact) => sensaMeaningFocusAcceptanceFactSchema.parse(fact));
    record.constructions.forEach((fact) => sensaSenseConstructionSnapshotSchema.parse(fact));
    record.constructionTurns.forEach((fact) => sensaSenseConstructionTurnSchema.parse(fact));
    record.proposals.forEach((fact) => sensaSenseProposalSnapshotSchema.parse(fact));
    record.proposalVersions.forEach((fact) => sensaSenseProposalVersionSnapshotSchema.parse(fact));
    record.senseConfirmations.forEach((fact) => sensaConfirmSenseProposalFactSchema.parse(fact));
    record.semanticAcceptances.forEach((fact) => sensaSemanticAcceptanceFactSchema.parse(fact));
    record.alignments.forEach((fact) => sensaPersonalMeaningAlignmentSnapshotSchema.parse(fact));
    record.alignmentEvents.forEach((fact) => sensaPersonalMeaningAlignmentEventSchema.parse(fact));
    record.bindingConfirmations.forEach((fact) => sensaConfirmExpressionBindingFactSchema.parse(fact));
  }
  state.registry.senses.forEach((fact) => sensaSenseSnapshotSchema.parse(fact));
  state.registry.senseVersions.forEach((fact) => sensaSenseVersionSnapshotSchema.parse(fact));
  state.registry.expressions.forEach((fact) => sensaExpressionSnapshotSchema.parse(fact));
  state.registry.expressionVersions.forEach((fact) => sensaExpressionVersionSnapshotSchema.parse(fact));
  state.registry.bindings.forEach((fact) => sensaSenseExpressionBindingSnapshotSchema.parse(fact));
  state.registry.bindingVersions.forEach((fact) => sensaSenseExpressionBindingVersionSnapshotSchema.parse(fact));
};

const run = async (): Promise<void> => {
  // === Material: blocks, familiar expression, starting stance ============
  const storage = new MemoryStoragePort();
  const gateway = newGateway(storage);
  const umbrellaId = await createMeaning(gateway, {
    familiarExpression: { surfaceForm: '借伞', languageTag: 'zh-CN' },
    blocks: [
      { kind: 'text', bodyText: '下雨天同事把伞借给我，我用完后还给他' },
      { kind: 'image', personalMediaObjectId: op(500) },
    ],
    startingPoint: 'from_experience',
  }, 1);
  let detail = gateway.getDetail(umbrellaId)!;
  assert(detail.materialBlocks.length === 2, 'material keeps every block as its own Anchor');
  assert(detail.materialBlocks[1]!.kind === 'image', 'image blocks survive as image Anchors');
  assert(
    detail.materialBlocks[1]!.personalMediaObjectId === op(500),
    'an image Anchor references the media object, not inline bytes',
  );
  assert(detail.experienceAnchors.length === 1, 'the text projection stays text-only');
  assert(detail.familiarAnchors.length === 1, 'the familiar expression is kept separately');
  assert(detail.startingPoint === 'from_experience', 'the declared stance is readable back');
  assert(detail.focuses.length === 0, 'saving material creates no Focus');
  let world = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(world.senseFormation.phase === 'focus_missing', 'world creation has no derived Focus progress');
  assert(world.expressionBinding.phase === 'not_ready', 'world creation keeps Expression Binding unavailable');

  const added = await gateway.addMaterialBlock({
    operationId: op(10),
    personalMeaningId: umbrellaId,
    block: { kind: 'text', bodyText: '归还的时候我会说谢谢' },
  });
  const addedReplay = await gateway.addMaterialBlock({
    operationId: op(10),
    personalMeaningId: umbrellaId,
    block: { kind: 'text', bodyText: '归还的时候我会说谢谢' },
  });
  assert(addedReplay.anchorId === added.anchorId && addedReplay.replayed, 'AddMaterialBlock replay keeps the anchor id');
  detail = gateway.getDetail(umbrellaId)!;
  assert(detail.materialBlocks.length === 3, 'appended block is visible immediately');
  assert(
    loadJourneyState(storage).meanings[0]!.personalMeaningRevisions.length === 2,
    'appending a block appends a meaning revision',
  );

  // === One confirmation, three facts ======================================
  const confirmed = await gateway.confirmClarification(clarificationInput(umbrellaId, 20));
  assert(confirmed.resolution === 'create_new', 'first confirmation registers a new Sense');
  assert(confirmed.expressionConfirmed, 'the optional binding lands in the same intent');
  detail = gateway.getDetail(umbrellaId)!;
  assert(detail.focuses.length === 1, 'one confirmation creates exactly one Focus');
  const focus = detail.focuses[0]!;
  assert(focus.accepted, 'the Focus acceptance fact is recorded independently');
  assert(focus.aspectLabel === '接收方向', 'the aspect label survives the projection');
  assert(focus.phase === 'aligned', 'all three facts land as aligned');
  assert(focus.alignment!.confirmedBindings.length === 1, 'the binding projects as one confirmed edge');
  assert(
    focus.alignment!.confirmedBindings[0]!.surfaceForm === 'borrow',
    'the confirmed Binding keeps the learner surface form',
  );
  assert(
    focus.alignment!.expressionCandidates[0]!.bindingStatus === 'confirmed',
    'the candidate the binding came from is marked confirmed',
  );
  assert(detail.familiarAnchors.length === 1, 'the target Expression Anchor is not misclassified as familiar input');
  world = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(world.senseFormation.phase === 'sense_confirmed', 'world Sense Formation axis counts the confirmed Sense');
  assert(world.expressionBinding.phase === 'bound', 'world Binding axis becomes bound after the third fact');
  const stored = loadJourneyState(storage).meanings[0]!;
  assert(stored.constructionTurns.length === 2, 'the transcript becomes authoritative Construction turns');
  assert(
    stored.constructionTurns[0]!.actor === 'semantic_llm' && stored.constructionTurns[1]!.actor === 'learner',
    'transcript roles map onto construction turn actors',
  );
  validateFacts(storage);

  // Replay is idempotent and creates no parallel Focus identity.
  const confirmedReplay = await gateway.confirmClarification(clarificationInput(umbrellaId, 20));
  assert(confirmedReplay.replayed, 'one clarification confirmation is idempotent');
  assert(
    confirmedReplay.meaningFocusId === confirmed.meaningFocusId,
    'replaying a confirmation creates no parallel Focus identity',
  );
  assert(gateway.getDetail(umbrellaId)!.focuses.length === 1, 'replay adds no second Focus');

  // === All or nothing: a rejected confirmation leaves nothing behind =====
  await expectFailure(
    () => gateway.confirmClarification(clarificationInput(umbrellaId, 21, {
      expression: {
        surfaceForm: '   ',
        expressionType: 'word',
        languageTag: 'en',
        relation: 'realizes',
        semanticCoverage: 'exact',
      },
    })),
    'a blank expression rejects the whole confirmation',
  );
  const afterFailure = gateway.getDetail(umbrellaId)!;
  assert(afterFailure.focuses.length === 1, 'a rejected confirmation leaves no orphan Focus');
  const failureRecord = loadJourneyState(storage).meanings[0]!;
  assert(
    failureRecord.constructions.length === 1 && failureRecord.proposals.length === 1,
    'a rejected confirmation leaves no orphan Construction or Proposal',
  );

  // === Stopping at 2 / 3 is a legal resting state =========================
  const partialId = await createMeaning(gateway, {
    blocks: [{ kind: 'text', bodyText: '表达不同意见，但不让对方难堪' }],
  }, 30);
  const partial = await gateway.confirmClarification(clarificationInput(partialId, 31, {
    focus: {
      statement: '表达不同意见但照顾对方感受',
      distinguishingNotes: ['重点在“不同意也能说得体”'],
      aspectLabel: '委婉表达',
    },
    sense: lendSense,
    confirmExpression: false,
  }));
  assert(!partial.expressionConfirmed, 'Sense confirmed with Expression pending is supported');
  let partialDetail = gateway.getDetail(partialId)!;
  assert(partialDetail.focuses[0]!.phase === 'sense_confirmed_expression_pending', 'two of three facts rest before binding');
  assert(partialDetail.expressionBinding.phase === 'pending', 'the world axis reads back as Sense confirmed / Binding pending');
  assert(
    partialDetail.focuses[0]!.alignment!.expressionCandidates.length === 1,
    'the deferred candidate is still recorded for a later binding',
  );

  // The last fact can be settled later through the independent binding command.
  const partialFocus = partialDetail.focuses[0]!;
  const candidate = partialFocus.alignment!.expressionCandidates[0]!;
  const settled = await gateway.confirmExpressionBinding({
    operationId: op(32),
    personalMeaningId: partialId,
    meaningFocusId: partialFocus.meaningFocusId,
    senseVersionId: partialFocus.alignment!.senseVersionId,
    candidateId: candidate.candidateId,
    languageTag: candidate.languageTag,
    surfaceForm: candidate.surfaceForm,
    expressionType: candidate.expressionType,
    relation: 'realizes',
    semanticCoverage: 'exact',
  });
  assert(!settled.replayed, 'the standalone binding is not a replay');
  const settledReplay = await gateway.confirmExpressionBinding({
    operationId: op(32),
    personalMeaningId: partialId,
    meaningFocusId: partialFocus.meaningFocusId,
    senseVersionId: partialFocus.alignment!.senseVersionId,
    candidateId: candidate.candidateId,
    languageTag: candidate.languageTag,
    surfaceForm: candidate.surfaceForm,
    expressionType: candidate.expressionType,
    relation: 'realizes',
    semanticCoverage: 'exact',
  });
  assert(settledReplay.bindingVersionId === settled.bindingVersionId, 'binding replay keeps the exact version identity');
  partialDetail = gateway.getDetail(partialId)!;
  assert(partialDetail.focuses[0]!.phase === 'aligned', 'settling the last fact completes the thread');
  assert(
    partialDetail.focuses[0]!.alignment!.expressionCandidates[0]!.bindingStatus === 'confirmed',
    'the settled candidate is marked confirmed',
  );
  validateFacts(storage);

  // === A second thread on the same material becomes a sibling Focus ======
  const sibling = await gateway.confirmClarification(clarificationInput(umbrellaId, 40, {
    focus: {
      statement: '把自己的物品暂时交给他人使用，之后收回',
      distinguishingNotes: ['重点在给予方向'],
      aspectLabel: '给予方向',
    },
    sense: lendSense,
    expression: {
      surfaceForm: 'lend',
      expressionType: 'word',
      languageTag: 'en',
      relation: 'realizes',
      semanticCoverage: 'exact',
    },
  }));
  assert(
    sibling.meaningFocusId !== confirmed.meaningFocusId,
    'a second thread on the same material keeps an independent Focus identity',
  );
  detail = gateway.getDetail(umbrellaId)!;
  assert(detail.focuses.length === 2, 'sibling Focuses share one Personal Meaning');
  assert(detail.materialBlocks.length === 3, 'confirming never rewrites the material');
  assert(
    detail.focuses.every((item) => item.alignment !== null),
    'both sibling threads carry their own Alignment',
  );
  validateFacts(storage);

  // === Confirming the same sense key on new material reuses the Sense =====
  const reuseId = await createMeaning(gateway, {
    blocks: [{ kind: 'text', bodyText: '朋友把书借给我，我两周后还了回去' }],
  }, 50);
  const reuse = await gateway.confirmClarification(clarificationInput(reuseId, 51));
  assert(reuse.resolution === 'reuse_existing', 'confirming a known sense key reuses the registered Sense');
  assert(reuse.senseId === confirmed.senseId, 'reuse keeps the exact Sense identity');
  assert(
    loadJourneyState(storage).registry.senses.length === 2,
    'reuse registers no duplicate Sense',
  );
  validateFacts(storage);

  // === Reload keeps every id and fact stable ==============================
  const factsBeforeReload = storage.read(JOURNEY_STORE_KEY)!;
  const beforeReload = gateway.getDetail(umbrellaId)!;
  const reloaded = newGateway(storage);
  const afterReload = reloaded.getDetail(umbrellaId)!;
  assert(afterReload.personalMeaningId === beforeReload.personalMeaningId, 'reload keeps the Personal Meaning id');
  assert(
    afterReload.focuses.map((item) => item.meaningFocusId).join(',')
      === beforeReload.focuses.map((item) => item.meaningFocusId).join(','),
    'reload keeps Focus ids',
  );
  assert(
    afterReload.focuses[0]!.alignment!.senseVersionId === beforeReload.focuses[0]!.alignment!.senseVersionId,
    'reload keeps the Sense Version id',
  );
  assert(storage.read(JOURNEY_STORE_KEY) === factsBeforeReload, 'reload does not rewrite facts or IDs');
  validateFacts(storage);

  console.log(`SMOKE OK — ${checks} checks passed.`);
};

run().catch((error) => {
  console.log(error instanceof Error ? error.message : String(error));
  throw error;
});
