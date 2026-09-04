/**
 * Deterministic smoke for the ubiquitous multimodal intake flow.
 *
 * No test framework, network, paid LLM or browser is involved. The smoke
 * drives the same gateway seam the capture UIs use — ingest a payload,
 * triage into the Inbox, promote or dismiss a draft — and validates every
 * stored fact against the contract schemas, reusing the journey smoke's
 * fact-validation baseline.
 */

import {
  sensaConfirmExpressionBindingFactSchema,
  sensaConfirmSenseProposalFactSchema,
  sensaExpressionSnapshotSchema,
  sensaExpressionVersionSnapshotSchema,
  sensaIntakeItemSchema,
  sensaIntakePayloadSchema,
  sensaIntakeResultSchema,
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
  type SensaIntakePayload,
} from '@sensa/contracts/sensa';
import { createJourneyGateway } from './gateway';
import { createSeededIdPort } from './ids';
import { MemoryStoragePort, createSeededClock } from './ports';
import { loadJourneyState, JOURNEY_STORE_KEY } from './store';
import type { PersonalMeaningJourneyGateway } from './gateway';
import type { IngestCommandResult } from './types';

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

const assertFastTrack = (result: IngestCommandResult, message: string): string => {
  checks += 1;
  if (result.route !== 'fast_track') throw new Error(`SMOKE FAILED: ${message}`);
  return result.personalMeaningId;
};

const assertInboxRoute = (result: IngestCommandResult, message: string): string => {
  checks += 1;
  if (result.route !== 'inbox') throw new Error(`SMOKE FAILED: ${message}`);
  return result.intakeId;
};

const assertRejected = (result: IngestCommandResult, message: string): string => {
  checks += 1;
  if (result.route !== 'rejected') throw new Error(`SMOKE FAILED: ${message}`);
  return result.reason;
};

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

// ---------------------------------------------------------------------------
// Capture payload builders
// ---------------------------------------------------------------------------

const CAPTURED_AT = '2026-09-02T08:00:00.000Z';
const LOAN_TEXT = 'The library will loan the atlas to students for one week.';

const loanSense = {
  senseKey: 'loan-temporary-give-use-return',
  confirmationStatus: 'user_confirmed' as const,
  definitionSummary: '把自己的东西暂时交给别人使用，并预期收回',
  wordingSource: 'learner_authored' as const,
  candidates: [{ senseKey: null, definitionSummary: '借出' }],
};

const fastTrackPayload = (
  intakeOperationId: string,
  overrides: Partial<SensaIntakePayload> = {},
): SensaIntakePayload => ({
  contractVersion: 'sensa-intake-v1',
  intakeOperationId,
  capturedAt: CAPTURED_AT,
  context: {
    modality: 'text',
    textSegment: LOAN_TEXT,
    mediaReferenceIds: [],
    source: null,
  },
  expression: {
    surfaceForm: 'loan',
    languageRole: 'target',
    characterSpan: { start: 17, end: 21 },
    expressionTypeHint: 'word',
  },
  sense: loanSense,
  ...overrides,
});

const run = async (): Promise<void> => {
  // === Contract: intake schemas round-trip and stay strict ================
  const probe = fastTrackPayload(op(1));
  const parsed = sensaIntakePayloadSchema.parse(probe);
  assert(parsed.expression!.surfaceForm === 'loan', 'the payload schema keeps the expression');
  assert(
    sensaIntakePayloadSchema.safeParse({ ...probe, extra: 1 }).success === false,
    'the intake payload schema rejects unknown fields',
  );
  assert(
    sensaIntakePayloadSchema.safeParse({ ...probe, capturedAt: 'yesterday' }).success === false,
    'the intake payload schema validates the timestamp format',
  );
  assert(
    sensaIntakeResultSchema.safeParse({ route: 'fast_track', personalMeaningId: op(2) }).success
      && sensaIntakeResultSchema.safeParse({ route: 'inbox', intakeId: op(3) }).success
      && sensaIntakeResultSchema.safeParse({ route: 'rejected', reason: 'x' }).success,
    'the result union round-trips all three routes',
  );
  assert(
    sensaIntakeResultSchema.safeParse({ route: 'teleport' }).success === false,
    'the result union rejects unknown routes',
  );

  // === Fast track: one capture, one atomic meaning ========================
  const storage = new MemoryStoragePort();
  const gateway = newGateway(storage);
  const fast = await gateway.ingest(op(1), probe);
  assert(!fast.replayed, 'a first ingest is not a replay');
  const meaningId = assertFastTrack(fast, 'a complete capture materializes through the fast track');
  assert(meaningId.length === 36, 'the fast track returns one bare Personal Meaning id');
  const detail = gateway.getDetail(meaningId)!;
  assert(detail.focuses.length === 1, 'the fast track creates exactly one Focus');
  const focus = detail.focuses[0]!;
  assert(focus.accepted, 'the Meaning Focus is born accepted');
  assert(focus.phase === 'aligned', 'the fast track lands all three facts at once');
  assert(focus.alignment!.resolution === 'create_new', 'a fresh sense key registers a new Sense');
  assert(
    focus.alignment!.coreMeaningFocus === loanSense.definitionSummary,
    'the confirmed statement becomes the core meaning focus',
  );
  assert(focus.alignment!.confirmedBindings.length === 1, 'the Binding settles in the same command');
  assert(
    focus.alignment!.confirmedBindings[0]!.surfaceForm === 'loan'
      && focus.alignment!.confirmedBindings[0]!.languageTag === 'en',
    'a target-role capture binds its word in English',
  );
  assert(detail.materialBlocks.length === 1, 'the captured sentence becomes the one material block');
  assert(detail.familiarAnchors.length === 0, 'a target-role capture is not misfiled as familiar input');
  assert(detail.experienceAnchors.length === 1, 'the captured sentence stays a text experience Anchor');
  assert(
    detail.displayLabel === `${LOAN_TEXT.slice(0, 24)}…`,
    'with no familiar word the label falls back to the captured sentence',
  );
  const world = gateway.getWorldItems().find((item) => item.personalMeaningId === meaningId)!;
  assert(world.senseFormation.phase === 'sense_confirmed', 'the world Sense Formation axis is confirmed immediately');
  assert(world.expressionBinding.phase === 'bound', 'the world Binding axis is bound immediately');
  let record = loadJourneyState(storage).meanings[0]!;
  assert(record.bindingConfirmations.length === 1, 'the shared binding core records the confirmation fact');
  assert(
    record.bindingConfirmations[0]!.senseVersionId === focus.alignment!.senseVersionId,
    'the confirmation fact references the same Sense Version as the Alignment',
  );
  assert(
    record.personalExpressionAnchorRevisions.length === 1
      && record.personalExpressionAnchorRevisions[0]!.learnerLanguageRole === 'target',
    'the engine-prepared expression anchor is reused, not duplicated',
  );
  const stateAfterFast = loadJourneyState(storage);
  assert(stateAfterFast.registry.senses.length === 1, 'the fast track registers exactly one Sense');
  assert(stateAfterFast.registry.expressions.length === 1, 'the fast track registers exactly one Expression');
  assert(stateAfterFast.registry.bindings.length === 1, 'the fast track registers exactly one Binding');
  assert(gateway.getInboxItems().length === 0, 'the fast track leaves nothing in the Inbox');

  const fastReplay = await gateway.ingest(op(1), probe);
  assert(fastReplay.replayed, 'an ingest replay is marked');
  assert(
    assertFastTrack(fastReplay, 'a replay keeps the fast track') === meaningId,
    'an ingest replay keeps the exact Personal Meaning id',
  );
  assert(loadJourneyState(storage).meanings.length === 1, 'an ingest replay creates no second meaning');

  await expectFailure(
    () => gateway.ingest(op(2), fastTrackPayload(op(3))),
    'ingest rejects a mismatched idempotency key',
  );
  await expectFailure(
    () => gateway.ingest(op(2), { ...fastTrackPayload(op(2)), capturedAt: 'not-a-timestamp' }),
    'ingest validates the payload against the contract at the boundary',
  );
  const receiptsAfter = loadJourneyState(storage).commandReceipts;
  assert(
    receiptsAfter.every((candidate) => candidate.operationId !== op(2) && candidate.operationId !== op(3)),
    'a rejected ingest records no receipt',
  );
  assert(loadJourneyState(storage).meanings.length === 1, 'a rejected ingest writes nothing');

  // === Fast track: provenance honesty and registry reuse ==================
  const importedPayload = fastTrackPayload(op(4), {
    context: {
      modality: 'text',
      textSegment: 'Banks loan money, but friends loan trust.',
      mediaReferenceIds: ['media-atlas-photo'],
      source: {
        client: 'browser-extension',
        url: 'https://example.com/reading',
        title: 'Reading list',
        domSelector: 'p:nth-of-type(3)',
        paragraphContext: 'Banks loan money, but friends loan trust.',
      },
    },
    sense: { ...loanSense, wordingSource: 'llm_suggested' },
  });
  const secondId = assertFastTrack(
    await gateway.ingest(op(4), importedPayload),
    'a second complete capture fast-tracks',
  );
  const secondDetail = gateway.getDetail(secondId)!;
  record = loadJourneyState(storage).meanings[1]!;
  assert(
    record.personalSemanticAnchorRevisions[0]!.provenance.kind === 'imported',
    'a captured web context is provenance-honest as imported',
  );
  const structured = record.personalSemanticAnchorRevisions[0]!.structuredPayload;
  assert(
    Array.isArray(structured.mediaReferenceIds)
      && (structured.mediaReferenceIds as string[])[0] === 'media-atlas-photo',
    'the structured anchor payload keeps the media references',
  );
  assert(structured.source != null, 'the structured anchor payload keeps the source meta');
  assert(
    record.personalExpressionAnchorRevisions[0]!.provenanceKind === 'llm_suggested',
    'LLM wording is never disguised as learner-authored',
  );
  assert(
    secondDetail.focuses[0]!.alignment!.resolution === 'reuse_existing',
    'the same sense key reuses the registered Sense',
  );
  assert(
    secondDetail.focuses[0]!.alignment!.senseVersionId === focus.alignment!.senseVersionId,
    'reuse keeps the exact Sense Version identity',
  );
  assert(record.bindingConfirmations.length === 1, 'the reused binding still records its confirmation fact');
  const stateAfterReuse = loadJourneyState(storage);
  assert(stateAfterReuse.registry.senses.length === 1, 'reuse registers no duplicate Sense');
  assert(stateAfterReuse.registry.expressions.length === 1, 'the same normalized expression reuses the registry entry');
  assert(stateAfterReuse.registry.bindings.length === 1, 'the same sense-expression edge reuses the Binding');
  assert(stateAfterReuse.registry.bindingVersions.length === 1, 'an unchanged binding reuses the exact version');
  validateFacts(storage);

  // === Fast track: a familiar-role capture reuses its pre-set anchor ======
  const familiarPayload = fastTrackPayload(op(5), {
    context: {
      modality: 'text',
      textSegment: '他把旧相机借给了表弟。',
      mediaReferenceIds: [],
      source: null,
    },
    expression: {
      surfaceForm: '借出',
      languageRole: 'familiar',
      characterSpan: { start: 3, end: 5 },
      expressionTypeHint: 'word',
    },
  });
  const familiarId = assertFastTrack(
    await gateway.ingest(op(5), familiarPayload),
    'a familiar-role capture fast-tracks',
  );
  record = loadJourneyState(storage).meanings[2]!;
  assert(
    record.personalExpressionAnchorRevisions.length === 1,
    'the familiar capture reuses its pre-set anchor instead of spawning a target one',
  );
  assert(
    record.personalExpressionAnchorRevisions[0]!.learnerLanguageRole === 'familiar'
      && record.personalExpressionAnchorRevisions[0]!.languageTag === 'zh-CN',
    'the familiar word keeps its familiar role and language',
  );
  assert(record.bindingConfirmations.length === 1, 'the familiar binding still lands as a confirmation fact');
  const familiarDetail = gateway.getDetail(familiarId)!;
  assert(familiarDetail.familiarAnchors.length === 1, 'the familiar word is filed as familiar input');
  const stateAfterFamiliar = loadJourneyState(storage);
  assert(stateAfterFamiliar.registry.expressions.length === 2, 'a different word registers its own Expression');
  assert(stateAfterFamiliar.registry.bindings.length === 2, 'a new sense-expression edge registers its own Binding');
  validateFacts(storage);

  // === Slow track: triage into the Inbox ==================================
  const inboxStorage = new MemoryStoragePort();
  const inboxGateway = newGateway(inboxStorage);
  const longText = 'The negotiation stalled because neither side would move on the timeline.';
  const pendingSensePayload = fastTrackPayload(op(10), {
    context: { modality: 'text', textSegment: longText, mediaReferenceIds: [], source: null },
    sense: null,
  });
  const pendingSenseId = assertInboxRoute(
    await inboxGateway.ingest(op(10), pendingSensePayload),
    'a capture without a sense defers to the Inbox',
  );
  let inbox = inboxGateway.getInboxItems();
  assert(inbox.length === 1, 'the Inbox keeps the deferred capture');
  const pendingSenseItem = inbox[0]!;
  assert(pendingSenseItem.intakeId === pendingSenseId, 'the Inbox result id matches the stored item');
  assert(pendingSenseItem.status === 'pending_sense', 'an item with a word but no meaning waits for a sense');
  assert(
    pendingSenseItem.summaryView === `${longText.slice(0, 42)}…`,
    'the Inbox summary is a truncated context line',
  );
  sensaIntakeItemSchema.parse(pendingSenseItem);

  const pendingExpressionPayload = fastTrackPayload(op(11), { expression: null });
  const pendingExpressionId = assertInboxRoute(
    await inboxGateway.ingest(op(11), pendingExpressionPayload),
    'a capture without a word defers to the Inbox',
  );
  const barePayload = fastTrackPayload(op(12), { expression: null, sense: null });
  const bareId = assertInboxRoute(
    await inboxGateway.ingest(op(12), barePayload),
    'a bare capture defers to the Inbox',
  );
  assert(
    inboxGateway.getInboxItems().find((item) => item.intakeId === bareId)!.status === 'pending_expression',
    'a missing word is the shallower gap for triage',
  );
  const imagePayload = fastTrackPayload(op(13), {
    context: {
      modality: 'image',
      textSegment: null,
      mediaReferenceIds: ['media-whiteboard-1'],
      source: null,
    },
    expression: null,
    sense: null,
  });
  const imageId = assertInboxRoute(
    await inboxGateway.ingest(op(13), imagePayload),
    'an image capture defers to the Inbox',
  );
  assert(
    inboxGateway.getInboxItems().find((item) => item.intakeId === imageId)!.summaryView === '（图片材料）',
    'an image item summarizes its modality',
  );

  const audioPayload = fastTrackPayload(op(14), {
    context: { modality: 'audio', textSegment: null, mediaReferenceIds: [], source: null },
    expression: null,
    sense: null,
  });
  const reason = assertRejected(
    await inboxGateway.ingest(op(14), audioPayload),
    'a pure audio capture is rejected for this milestone',
  );
  assert(reason.length > 0, 'the rejection names its reason');
  assert(inboxGateway.getInboxItems().length === 4, 'a rejection never reaches the Inbox');
  const audioReplay = await inboxGateway.ingest(op(14), audioPayload);
  assert(
    audioReplay.replayed && assertRejected(audioReplay, 'a rejection replay keeps the route') === reason,
    'a rejection replay keeps its verdict',
  );

  const inboxReplay = await inboxGateway.ingest(op(10), pendingSensePayload);
  assert(
    inboxReplay.replayed && assertInboxRoute(inboxReplay, 'an Inbox replay keeps the route') === pendingSenseId,
    'an Inbox ingest replay keeps the exact item id',
  );
  assert(inboxGateway.getInboxItems().length === 4, 'an Inbox ingest replay creates no duplicate item');
  assert(
    inboxGateway.getInboxItems().map((item) => item.intakeId).join(',')
      === [pendingSenseId, pendingExpressionId, bareId, imageId].join(','),
    'the Inbox keeps capture order',
  );
  await expectFailure(
    () => inboxGateway.dismissInboxItem(op(10), pendingSenseId),
    'one operationId cannot serve two different commands',
  );

  // === Slow track: promotion and dismissal ================================
  const promoted = await inboxGateway.resolveInboxItem(op(20), pendingSenseId, { sense: loanSense });
  const promotedId = assertFastTrack(
    promoted,
    'a confirmed sense promotes the draft through the fast track',
  );
  assert(inboxGateway.getInboxItems().length === 3, 'a promoted draft leaves the Inbox');
  const promotedDetail = inboxGateway.getDetail(promotedId)!;
  assert(
    promotedDetail.focuses.length === 1 && promotedDetail.focuses[0]!.phase === 'aligned',
    'the promoted meaning is indistinguishable from a direct fast track',
  );
  assert(
    promotedDetail.focuses[0]!.alignment!.coreMeaningFocus === loanSense.definitionSummary,
    'the promoted meaning keeps the confirmed statement',
  );
  assert(promotedDetail.materialBlocks.length === 1, 'the promoted meaning keeps the original context');
  const promotedReplay = await inboxGateway.resolveInboxItem(op(20), pendingSenseId, { sense: loanSense });
  assert(
    promotedReplay.replayed
      && assertFastTrack(promotedReplay, 'a promotion replay keeps the route') === promotedId,
    'a promotion replay keeps the exact meaning id',
  );
  assert(inboxGateway.getInboxItems().length === 3, 'a promotion replay removes nothing more');
  await expectFailure(
    () => inboxGateway.resolveInboxItem(op(21), op(999), { sense: loanSense }),
    'resolving an unknown draft fails loudly',
  );
  await expectFailure(
    () => inboxGateway.resolveInboxItem(op(22), pendingExpressionId, {
      sense: { ...loanSense, definitionSummary: '   ' },
    }),
    'a blank confirmed statement fails contract validation before any write',
  );

  await inboxGateway.dismissInboxItem(op(23), bareId);
  assert(inboxGateway.getInboxItems().length === 2, 'a dismissed draft is removed');
  await inboxGateway.dismissInboxItem(op(23), bareId);
  assert(inboxGateway.getInboxItems().length === 2, 'a dismissal replay removes nothing more');
  await expectFailure(
    () => inboxGateway.dismissInboxItem(op(24), bareId),
    'dismissing an unknown draft fails loudly',
  );
  const remaining = inboxGateway.getInboxItems();
  remaining.forEach((item) => sensaIntakeItemSchema.parse(item));
  validateFacts(inboxStorage);

  // === Reload keeps facts and the Inbox stable ============================
  const factsBeforeReload = inboxStorage.read(JOURNEY_STORE_KEY)!;
  const inboxBeforeReload = remaining.map((item) => item.intakeId).join(',');
  const reloaded = newGateway(inboxStorage);
  assert(
    reloaded.getInboxItems().map((item) => item.intakeId).join(',') === inboxBeforeReload,
    'reload keeps the Inbox order and ids',
  );
  assert(loadJourneyState(inboxStorage).meanings.length === 1, 'reload keeps promoted meanings');
  assert(inboxStorage.read(JOURNEY_STORE_KEY) === factsBeforeReload, 'reload does not rewrite facts');
  validateFacts(inboxStorage);
  validateFacts(storage);

  console.log(`SMOKE OK — ${checks} checks passed.`);
};

run().catch((error) => {
  console.log(error instanceof Error ? error.message : String(error));
  throw error;
});
