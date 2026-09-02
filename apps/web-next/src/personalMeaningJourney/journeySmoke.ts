/**
 * Deterministic v2 Personal Meaning journey smoke.
 *
 * No test framework, network, paid LLM or browser is involved. The smoke
 * drives the same gateway seam used by React and validates stored facts with
 * the existing contract schemas.
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
} from '@sensa/contracts/sensa';
import { createJourneyGateway } from './gateway';
import { createMockSemanticLlm } from './mockSemanticLlm';
import { createSeededIdPort } from './ids';
import { MemoryStoragePort, createSeededClock } from './ports';
import { loadJourneyState, JOURNEY_STORE_KEY } from './store';
import type { PersonalMeaningJourneyGateway } from './gateway';
import type {
  ConfirmExpressionBindingInput,
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
  expectedText?: string,
): Promise<void> => {
  try {
    await action();
  } catch (error) {
    checks += 1;
    if (expectedText) {
      assert(error instanceof Error && error.message.includes(expectedText), `${message} returns a clear unavailable error`);
    }
    return;
  }
  throw new Error(`SMOKE FAILED: ${message}`);
};

const newGateway = (storage: MemoryStoragePort): PersonalMeaningJourneyGateway =>
  createJourneyGateway({
    storage,
    clock: createSeededClock(),
    ids: createSeededIdPort(1),
    llm: createMockSemanticLlm(),
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

const generateFocus = async (
  gateway: PersonalMeaningJourneyGateway,
  personalMeaningId: string,
  operationNumber: number,
) => {
  await gateway.generateFocusSuggestions({
    operationId: op(operationNumber),
    personalMeaningId,
  });
  const detail = gateway.getDetail(personalMeaningId)!;
  assert(detail.focuses.length === 0, 'LLM suggestions do not create Focus facts');
  assert(detail.focusSuggestions.length > 0, 'matched scenario returns stable suggestions');
  return detail;
};

const acceptSuggestion = async (
  gateway: PersonalMeaningJourneyGateway,
  personalMeaningId: string,
  suggestionIndex: number,
  operationNumber: number,
) => {
  const suggestion = gateway.getDetail(personalMeaningId)!.focusSuggestions[suggestionIndex];
  const created = await gateway.createMeaningFocus({
    operationId: op(operationNumber),
    personalMeaningId,
    suggestionId: suggestion.suggestionId,
  });
  const detail = gateway.getDetail(personalMeaningId)!;
  const focus = detail.focuses.find((item) => item.meaningFocusId === created.meaningFocusId)!;
  assert(!focus.accepted, 'CreateMeaningFocus leaves acceptedRevision null');
  assert(focus.phase === 'focus_pending_acceptance', 'created Focus waits for explicit acceptance');
  await expectFailure(
    () => gateway.startConstruction({
      operationId: op(operationNumber + 1000),
      personalMeaningId,
      meaningFocusId: focus.meaningFocusId,
      meaningFocusRevisionId: focus.currentRevisionId,
    }),
    'unaccepted Focus cannot start Construction',
  );
  await gateway.acceptMeaningFocusRevision({
    operationId: op(operationNumber + 1),
    personalMeaningId,
    meaningFocusId: focus.meaningFocusId,
    meaningFocusRevisionId: focus.currentRevisionId,
  });
  const afterAccept = gateway.getDetail(personalMeaningId)!.focuses
    .find((item) => item.meaningFocusId === focus.meaningFocusId)!;
  assert(afterAccept.accepted, 'AcceptMeaningFocusRevision accepts current revision');
  return afterAccept;
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

const buildBindingInput = (
  personalMeaningId: string,
  focusId: string,
  senseVersionId: string,
  candidate: {
    candidateId: string;
    languageTag: string;
    surfaceForm: string;
    expressionType: ConfirmExpressionBindingInput['expressionType'];
  },
  operationNumber: number,
): ConfirmExpressionBindingInput => ({
  operationId: op(operationNumber),
  personalMeaningId,
  meaningFocusId: focusId,
  senseVersionId,
  candidateId: candidate.candidateId,
  languageTag: candidate.languageTag,
  surfaceForm: candidate.surfaceForm,
  expressionType: candidate.expressionType,
  relation: 'realizes',
  semanticCoverage: 'exact',
});

const run = async (): Promise<void> => {
  // === Creation identity, Focus lifecycle, split, anchors, confirm/bind =====
  const storage = new MemoryStoragePort();
  const gateway = newGateway(storage);
  const umbrellaId = await createMeaning(gateway, {
    familiarExpression: { surfaceForm: '借伞', languageTag: 'zh-CN' },
    blocks: [{ kind: 'text', bodyText: '下雨天同事把伞借给我，我用完后还给他' }],
  }, 1);
  const experienceOnlyId = await createMeaning(gateway, {
    blocks: [{ kind: 'text', bodyText: '下雨时朋友把伞递给我，之后我归还' }],
  }, 10);
  const familiarOnlyId = await createMeaning(gateway, {
    familiarExpression: { surfaceForm: '表达不同意见但不让人难堪' },
  }, 20);
  assert(gateway.getDetail(experienceOnlyId)!.familiarAnchors.length === 0, 'experience-only create has no fake expression');
  assert(gateway.getDetail(familiarOnlyId)!.experienceAnchors.length === 0, 'familiar-only create has no fake experience');
  assert(gateway.getListItems().every((item) => item.personalMeaningId.length === 36), 'list uses one PM identity');
  const worldAfterCreate = gateway.getWorldItems();
  assert(worldAfterCreate.length === 3, 'world query immediately contains every active created Personal Meaning');
  assert(worldAfterCreate.every((item) => item.detail.personalMeaningId === item.personalMeaningId), 'world compact/detail projections share the canonical Personal Meaning id');
  assert(worldAfterCreate.every((item) => item.senseFormation.phase === 'focus_missing'), 'world creation has no derived Focus progress');
  assert(worldAfterCreate.every((item) => item.expressionBinding.phase === 'not_ready'), 'world creation keeps Expression Binding unavailable');

  let detail = await generateFocus(gateway, umbrellaId, 30);
  const unrelatedFocus = await gateway.createMeaningFocus({
    operationId: op(24),
    personalMeaningId: umbrellaId,
    statement: '把完全无关的自定义侧面保存下来',
    distinguishingNotes: [],
  });
  await gateway.acceptMeaningFocusRevision({
    operationId: op(25),
    personalMeaningId: umbrellaId,
    meaningFocusId: unrelatedFocus.meaningFocusId,
    meaningFocusRevisionId: unrelatedFocus.meaningFocusRevisionId,
  });
  const beforeUnmatchedConstruction = loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!;
  const beforeConstructionCount = beforeUnmatchedConstruction.constructions.length;
  const beforeProposalCount = beforeUnmatchedConstruction.proposals.length;
  await expectFailure(
    () => gateway.startConstruction({
      operationId: op(26),
      personalMeaningId: umbrellaId,
      meaningFocusId: unrelatedFocus.meaningFocusId,
      meaningFocusRevisionId: unrelatedFocus.meaningFocusRevisionId,
    }),
    'unmatched custom Focus is explicitly unavailable',
    'Focus 与匹配的模拟场景不相符',
  );
  const afterUnmatchedConstruction = loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!;
  assert(afterUnmatchedConstruction.constructions.length === beforeConstructionCount, 'unmatched custom Focus creates no Construction');
  assert(afterUnmatchedConstruction.proposals.length === beforeProposalCount, 'unmatched custom Focus creates no Proposal');
  const initialFamiliarAnchor = detail.familiarAnchors[0];
  await gateway.addAnchor({
    operationId: op(27),
    personalMeaningId: umbrellaId,
    kind: 'familiar_expression',
    surfaceForm: '借用一会儿',
    expressionType: 'phrase',
  });
  const addedAnchor = gateway.getDetail(umbrellaId)!.familiarAnchors
    .find((anchor) => anchor.anchorId !== initialFamiliarAnchor.anchorId)!;
  await gateway.editAnchor({
    operationId: op(28),
    personalMeaningId: umbrellaId,
    anchorId: addedAnchor.anchorId,
    kind: 'familiar_expression',
    surfaceForm: '暂时借用一会儿',
    expressionType: 'phrase',
  });
  const editedAnchor = gateway.getDetail(umbrellaId)!.familiarAnchors
    .find((anchor) => anchor.anchorId === addedAnchor.anchorId)!;
  assert(editedAnchor.anchorId === addedAnchor.anchorId && editedAnchor.revision === 2, 'Anchor edit keeps identity and appends revision');
  await gateway.removeAnchor({
    operationId: op(29),
    personalMeaningId: umbrellaId,
    anchorId: editedAnchor.anchorId,
    kind: 'familiar_expression',
  });
  const removedState = loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!;
  const removedAnchor = removedState.personalExpressionAnchors
    .find((anchor) => anchor.personalExpressionAnchorId === editedAnchor.anchorId)!;
  assert(removedAnchor.status === 'deleted' && removedAnchor.deletedAt !== null, 'Anchor removal is a soft-deleted fact');
  const removeRevisionCount = removedState.personalExpressionAnchorRevisions
    .filter((revision) => revision.personalExpressionAnchorId === editedAnchor.anchorId).length;
  await gateway.removeAnchor({
    operationId: op(29),
    personalMeaningId: umbrellaId,
    anchorId: editedAnchor.anchorId,
    kind: 'familiar_expression',
  });
  assert(loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!
    .personalExpressionAnchorRevisions
    .filter((revision) => revision.personalExpressionAnchorId === editedAnchor.anchorId).length === removeRevisionCount, 'Anchor remove replay does not append a revision');

  detail = gateway.getDetail(umbrellaId)!;
  const borrow = await acceptSuggestion(gateway, umbrellaId, 0, 31);
  const worldAfterFocus = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(worldAfterFocus.detail.personalMeaningId === umbrellaId && worldAfterFocus.detail.focuses.length > 0, 'world query exposes the real Focus fact under the same PM identity');
  assert(worldAfterFocus.senseFormation.phase === 'clarifying', 'world Sense Formation axis exposes accepted Focuses as clarifying');
  assert(worldAfterFocus.expressionBinding.phase === 'not_ready', 'world Expression Binding axis stays unavailable before Sense confirmation');
  const stateAfterAcceptance = loadJourneyState(storage);
  assert(stateAfterAcceptance.meanings[0].focusAcceptances
    .some((fact) => fact.meaningFocusId === borrow.meaningFocusId), 'Focus acceptance fact is explicit');
  const borrowFocus = gateway.getDetail(umbrellaId)!.focuses
    .find((focus) => focus.meaningFocusId === borrow.meaningFocusId)!;
  const acceptReplayBefore = loadJourneyState(storage).meanings[0].focusAcceptances.length;
  await gateway.acceptMeaningFocusRevision({
    operationId: op(32),
    personalMeaningId: umbrellaId,
    meaningFocusId: borrowFocus.meaningFocusId,
    meaningFocusRevisionId: borrowFocus.currentRevisionId,
  });
  assert(loadJourneyState(storage).meanings[0].focusAcceptances.length === acceptReplayBefore, 'same Focus revision does not create parallel acceptance');

  // Split reuses the PM and its Anchors, but starts unaccepted.
  await gateway.splitMeaningFocus({
    operationId: op(33),
    personalMeaningId: umbrellaId,
    meaningFocusId: borrowFocus.meaningFocusId,
    statement: '把自己的物品暂时交给他人使用，之后收回',
    distinguishingNotes: ['重点在给予方向'],
    aspectLabel: '给予方向',
  });
  detail = gateway.getDetail(umbrellaId)!;
  const sibling = detail.focuses.find(
    (focus) =>
      focus.meaningFocusId !== borrowFocus.meaningFocusId
      && focus.meaningFocusId !== unrelatedFocus.meaningFocusId,
  )!;
  assert(sibling.splitFromMeaningFocusId === borrowFocus.meaningFocusId, 'split records source Focus');
  assert(!sibling.accepted, 'split sibling starts unaccepted');
  assert(detail.familiarAnchors.length === 1 && detail.experienceAnchors.length === 1, 'sibling shares PM Anchors');

  // Edit the accepted Focus: old acceptance remains, current revision is pending.
  await gateway.editMeaningFocus({
    operationId: op(34),
    personalMeaningId: umbrellaId,
    meaningFocusId: borrowFocus.meaningFocusId,
    statement: borrowFocus.statement,
    distinguishingNotes: [...borrowFocus.distinguishingNotes, '编辑后需再次明确接受'],
  });
  detail = gateway.getDetail(umbrellaId)!;
  const editedBorrow = detail.focuses.find((focus) => focus.meaningFocusId === borrowFocus.meaningFocusId)!;
  assert(!editedBorrow.accepted && editedBorrow.phase === 'focus_pending_acceptance', 'edited current Focus revision returns to pending acceptance');
  await expectFailure(
    () => gateway.startConstruction({
      operationId: op(35),
      personalMeaningId: umbrellaId,
      meaningFocusId: editedBorrow.meaningFocusId,
      meaningFocusRevisionId: editedBorrow.currentRevisionId,
    }),
    'edited unaccepted current revision cannot start Construction',
  );
  await gateway.acceptMeaningFocusRevision({
    operationId: op(36),
    personalMeaningId: umbrellaId,
    meaningFocusId: editedBorrow.meaningFocusId,
    meaningFocusRevisionId: editedBorrow.currentRevisionId,
  });

  // The sibling is independently accepted and can use the same PM/Anchors.
  await gateway.acceptMeaningFocusRevision({
    operationId: op(37),
    personalMeaningId: umbrellaId,
    meaningFocusId: sibling.meaningFocusId,
    meaningFocusRevisionId: sibling.currentRevisionId,
  });

  // Borrow construction and proposal.
  await gateway.startConstruction({
    operationId: op(38),
    personalMeaningId: umbrellaId,
    meaningFocusId: editedBorrow.meaningFocusId,
    meaningFocusRevisionId: gateway.getDetail(umbrellaId)!.focuses
      .find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!.currentRevisionId,
  });
  detail = gateway.getDetail(umbrellaId)!;
  let borrowJourney = detail.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!;
  assert(borrowJourney.phase === 'constructing' && borrowJourney.construction?.awaitingLearnerAnswer === true, 'Construction begins with boundary question');
  await gateway.pauseConstruction({ operationId: op(39), personalMeaningId: umbrellaId, meaningFocusId: editedBorrow.meaningFocusId });
  await gateway.resumeConstruction({ operationId: op(40), personalMeaningId: umbrellaId, meaningFocusId: editedBorrow.meaningFocusId });
  await gateway.answerConstruction({
    operationId: op(41),
    personalMeaningId: umbrellaId,
    meaningFocusId: editedBorrow.meaningFocusId,
    answer: '一定会归还，只是暂时使用',
  });
  await gateway.generateProposal({ operationId: op(42), personalMeaningId: umbrellaId, meaningFocusId: editedBorrow.meaningFocusId });
  detail = gateway.getDetail(umbrellaId)!;
  borrowJourney = detail.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!;
  assert(borrowJourney.phase === 'proposal_ready', 'proposal is available only after accepted Focus construction');
  const borrowProposal = borrowJourney.proposal!;
  const borrowCandidate = borrowProposal.expressionCandidates.find((candidate) => candidate.surfaceForm === 'borrow')!;
  const worldWithProposal = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(worldWithProposal.detail.focuses.some((focus) => focus.proposal?.senseProposalId === borrowProposal.senseProposalId), 'world query exposes the open Proposal branch from facts');
  assert(worldWithProposal.senseFormation.phase === 'proposal_pending', 'open Proposal is explicit on the Sense Formation axis');
  assert(worldWithProposal.expressionBinding.phase === 'not_ready', 'open Proposal cannot start Expression Binding');

  const senseConfirm = await gateway.confirmSense({
    operationId: op(43),
    personalMeaningId: umbrellaId,
    meaningFocusId: editedBorrow.meaningFocusId,
    senseProposalVersionId: borrowProposal.senseProposalVersionId,
  });
  assert(senseConfirm.replayed === false, 'first Sense confirmation is not a replay');
  detail = gateway.getDetail(umbrellaId)!;
  borrowJourney = detail.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!;
  assert(borrowJourney.phase === 'sense_confirmed_expression_pending', 'Sense confirmation leaves Expression pending');
  assert(borrowJourney.alignment?.confirmedBindings.length === 0, 'Sense confirmation does not silently bind expression');
  assert(borrowJourney.alignment?.senseVersionNumber === 1, 'alignment projection exposes the registered SenseVersion number');
  assert(borrowJourney.alignment?.semanticSpec?.coreMeaningFocus === borrowProposal.coreMeaningFocus, 'confirmed Sense detail reads semantic spec from the exact SenseVersion');
  assert(borrowJourney.alignment?.expressionCandidates.some((candidate) => candidate.candidateId === borrowCandidate.candidateId) ?? false, 'confirmed Sense detail keeps candidates from the confirmed Proposal version');
  assert(borrowJourney.construction?.status === 'completed', 'Sense confirmation completes its Construction');
  const worldWithSense = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  const worldSenseFocus = worldWithSense.detail.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!;
  const worldSenseAlignment = worldSenseFocus.alignment;
  assert(worldSenseAlignment !== null && worldSenseAlignment.confirmedBindings.length === 0, 'world query shows confirmed Sense without fabricating an Expression');
  assert(worldSenseFocus.accepted && worldSenseFocus.phase === 'sense_confirmed_expression_pending', 'Sense without Binding remains an accepted Focus in the detail projection');
  assert(worldSenseAlignment !== null && worldSenseAlignment.senseVersionNumber === 1, 'world projection keeps the registered SenseVersion number');
  assert(worldWithSense.senseFormation.confirmedSenseCount === 1, 'world Sense Formation axis counts the confirmed Sense');
  assert(worldWithSense.expressionBinding.phase === 'pending', 'confirmed Sense without Binding is pending on the independent Binding axis');
  const senseConfirmReplay = await gateway.confirmSense({
    operationId: op(43),
    personalMeaningId: umbrellaId,
    meaningFocusId: editedBorrow.meaningFocusId,
    senseProposalVersionId: borrowProposal.senseProposalVersionId,
  });
  assert(senseConfirmReplay.senseId === senseConfirm.senseId && senseConfirmReplay.replayed, 'Sense confirm replay returns exact IDs');
  assert(loadJourneyState(storage).meanings.find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!.senseConfirmations.length === 1, 'Sense replay creates no duplicate confirmation');
  const borrowBinding = await gateway.confirmExpressionBinding(buildBindingInput(
    umbrellaId,
    editedBorrow.meaningFocusId,
    senseConfirm.senseVersionId,
    borrowCandidate,
    44,
  ));
  assert(borrowBinding.replayed === false, 'first binding confirmation is not a replay');
  assert(gateway.getDetail(umbrellaId)!.familiarAnchors.length === 1, 'target Expression Anchor is not misclassified as familiar input');
  const bindingAgain = await gateway.confirmExpressionBinding({
    ...buildBindingInput(umbrellaId, editedBorrow.meaningFocusId, senseConfirm.senseVersionId, borrowCandidate, 45),
    relation: 'realizes',
    semanticCoverage: 'exact',
  });
  assert(bindingAgain.expressionId === borrowBinding.expressionId, 'same expression triple reuses Expression identity');
  assert(loadJourneyState(storage).meanings.find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!.bindingConfirmations.length === 1, 'same binding triple creates no parallel confirmation');

  const differentRelationBinding = await gateway.confirmExpressionBinding({
    ...buildBindingInput(umbrellaId, editedBorrow.meaningFocusId, senseConfirm.senseVersionId, borrowCandidate, 121),
    relation: 'approximates',
  });
  assert(differentRelationBinding.expressionId === borrowBinding.expressionId, 'relation change reuses Expression identity');
  assert(differentRelationBinding.senseExpressionBindingId !== borrowBinding.senseExpressionBindingId, 'relation change creates a new Binding identity');
  assert(differentRelationBinding.bindingVersionId !== borrowBinding.bindingVersionId, 'relation change creates a new BindingVersion');

  const differentCoverageBinding = await gateway.confirmExpressionBinding({
    ...buildBindingInput(umbrellaId, editedBorrow.meaningFocusId, senseConfirm.senseVersionId, borrowCandidate, 122),
    semanticCoverage: 'broader',
  });
  assert(differentCoverageBinding.expressionId === borrowBinding.expressionId, 'coverage change reuses Expression identity');
  assert(differentCoverageBinding.senseExpressionBindingId === borrowBinding.senseExpressionBindingId, 'same relation reuses Binding identity');
  assert(differentCoverageBinding.bindingVersionId !== borrowBinding.bindingVersionId, 'coverage change appends a BindingVersion');
  const bindingViews = gateway.getDetail(umbrellaId)!.focuses
    .find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!.alignment!.confirmedBindings;
  assert(bindingViews.length === 2, 'current Binding projection keeps one edge per Binding identity');
  assert(!bindingViews.some((binding) => binding.bindingVersionId === borrowBinding.bindingVersionId), 'historical coverage BindingVersion is not projected as a current edge');
  assert(bindingViews.find((binding) => binding.bindingVersionId === differentRelationBinding.bindingVersionId)!.relation === 'approximates', 'new relation BindingVersion projects its own relation');
  assert(bindingViews.find((binding) => binding.bindingVersionId === differentCoverageBinding.bindingVersionId)!.semanticCoverage === 'broader', 'coverage change projects its own immutable version');

  const editedCandidate = borrowProposal.expressionCandidates.find(
    (candidate) => candidate.expressionType === 'construction',
  )!;
  const editedBinding = await gateway.confirmExpressionBinding({
    ...buildBindingInput(
      umbrellaId,
      editedBorrow.meaningFocusId,
      senseConfirm.senseVersionId,
      editedCandidate,
      120,
    ),
    surfaceForm: 'borrow something from someone',
  });
  const editedCandidateAnchorRevision = loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!
    .personalExpressionAnchorRevisions.find(
      (revision) => revision.personalExpressionAnchorRevisionId === editedBinding.personalExpressionAnchorRevisionId,
    )!;
  assert(editedCandidateAnchorRevision.provenanceKind === 'learner_authored', 'edited candidate provenance is learner_authored');
  assert(gateway.getDetail(umbrellaId)!.focuses
    .find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!.phase === 'aligned', 'binding confirmation advances only its Focus to aligned');
  const worldWithBinding = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  const worldBoundFocus = worldWithBinding.detail.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!;
  assert(worldBoundFocus.alignment!.confirmedBindings.length === 3, 'world query keeps only current Binding edges visible');
  assert(!worldBoundFocus.alignment!.confirmedBindings.some((binding) => binding.bindingVersionId === borrowBinding.bindingVersionId), 'world query omits the superseded coverage version');
  assert(worldBoundFocus.alignment!.expressionCandidates.find((candidate) => candidate.candidateId === editedCandidate.candidateId)?.bindingStatus === 'used', 'edited candidate is marked as used provenance rather than original candidate bound');
  assert(worldWithBinding.expressionBinding.phase === 'bound', 'world Binding axis becomes bound only after a real Expression Binding confirmation');

  const storedBorrowAnchorRevision = loadJourneyState(storage).meanings
    .find((record) => record.personalMeaning.personalMeaningId === umbrellaId)!
    .personalExpressionAnchorRevisions.find((revision) => revision.personalExpressionAnchorRevisionId === borrowBinding.personalExpressionAnchorRevisionId)!;
  assert(storedBorrowAnchorRevision.provenanceKind === 'llm_suggested', 'unchanged candidate provenance is llm_suggested');
  assert(storedBorrowAnchorRevision.verificationStatus === 'learner_confirmed', 'candidate confirmation has learner_confirmed verification');

  // Lend sibling uses another expression identity even though it is en + word.
  await gateway.startConstruction({
    operationId: op(46),
    personalMeaningId: umbrellaId,
    meaningFocusId: sibling.meaningFocusId,
    meaningFocusRevisionId: sibling.currentRevisionId,
  });
  await gateway.answerConstruction({ operationId: op(47), personalMeaningId: umbrellaId, meaningFocusId: sibling.meaningFocusId, answer: '暂时给出，之后收回' });
  await gateway.generateProposal({ operationId: op(48), personalMeaningId: umbrellaId, meaningFocusId: sibling.meaningFocusId });
  const lendJourney = gateway.getDetail(umbrellaId)!.focuses.find((focus) => focus.meaningFocusId === sibling.meaningFocusId)!;
  const lendProposal = lendJourney.proposal!;
  const lendCandidate = lendProposal.expressionCandidates.find((candidate) => candidate.surfaceForm === 'lend')!;
  const lendConfirm = await gateway.confirmSense({ operationId: op(49), personalMeaningId: umbrellaId, meaningFocusId: sibling.meaningFocusId, senseProposalVersionId: lendProposal.senseProposalVersionId });
  const worldWithPartialBinding = gateway.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(worldWithPartialBinding.expressionBinding.phase === 'partial', 'world Binding axis distinguishes partially bound confirmed Senses');
  const lendBinding = await gateway.confirmExpressionBinding(buildBindingInput(umbrellaId, sibling.meaningFocusId, lendConfirm.senseVersionId, lendCandidate, 50));
  assert(lendBinding.expressionId !== borrowBinding.expressionId, 'borrow and lend are distinct Expression identities');

  // === Reject + continue keeps one SenseProposal identity and increments version ===
  const rejectId = await createMeaning(gateway, { blocks: [{ kind: 'text', bodyText: '表达不同意见，但不让对方难堪' }] }, 60);
  await generateFocus(gateway, rejectId, 61);
  const rejectFocus = await acceptSuggestion(gateway, rejectId, 0, 62);
  await gateway.startConstruction({ operationId: op(70), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId, meaningFocusRevisionId: rejectFocus.currentRevisionId });
  await gateway.answerConstruction({ operationId: op(71), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId, answer: '措辞得体、不让人难堪' });
  await gateway.generateProposal({ operationId: op(72), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId });
  const firstProposal = gateway.getDetail(rejectId)!.focuses
    .find((focus) => focus.meaningFocusId === rejectFocus.meaningFocusId)!.proposal!;
  await gateway.rejectProposal({ operationId: op(73), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId });
  const rejectedState = loadJourneyState(storage);
  const rejectedRecord = rejectedState.meanings.find((record) => record.personalMeaning.personalMeaningId === rejectId)!;
  assert(rejectedRecord.senseConfirmations.length === 0 && rejectedRecord.alignments.length === 0, 'reject creates no Sense or Alignment');
  assert(rejectedRecord.proposalVersions.length === 1 && rejectedRecord.proposals[0].status === 'rejected', 'reject does not fabricate a Sense');
  await gateway.continueClarifying({ operationId: op(74), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId });
  await gateway.answerConstruction({ operationId: op(75), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId, answer: '措辞上让人不难堪' });
  await gateway.generateProposal({ operationId: op(76), personalMeaningId: rejectId, meaningFocusId: rejectFocus.meaningFocusId });
  const secondProposal = gateway.getDetail(rejectId)!.focuses
    .find((focus) => focus.meaningFocusId === rejectFocus.meaningFocusId)!.proposal!;
  assert(secondProposal.senseProposalId === firstProposal.senseProposalId, 'continue reuses SenseProposal identity');
  assert(secondProposal.version === firstProposal.version + 1, 'continue increments immutable proposal version');

  // === Reuse existing Sense and no generic fallback =======================
  const reuseId = await createMeaning(gateway, { blocks: [{ kind: 'text', bodyText: '设身处地为别人着想，顾及对方感受' }] }, 80);
  await generateFocus(gateway, reuseId, 81);
  const reuseFocus = await acceptSuggestion(gateway, reuseId, 0, 82);
  await gateway.startConstruction({ operationId: op(87), personalMeaningId: reuseId, meaningFocusId: reuseFocus.meaningFocusId, meaningFocusRevisionId: reuseFocus.currentRevisionId });
  await gateway.answerConstruction({ operationId: op(88), personalMeaningId: reuseId, meaningFocusId: reuseFocus.meaningFocusId, answer: '主动为对方着想' });
  await gateway.generateProposal({ operationId: op(89), personalMeaningId: reuseId, meaningFocusId: reuseFocus.meaningFocusId });
  const reuseProposal = gateway.getDetail(reuseId)!.focuses
    .find((focus) => focus.meaningFocusId === reuseFocus.meaningFocusId)!.proposal!;
  const reuse = await gateway.confirmSense({ operationId: op(90), personalMeaningId: reuseId, meaningFocusId: reuseFocus.meaningFocusId, senseProposalVersionId: reuseProposal.senseProposalVersionId });
  assert(reuse.resolution === 'reuse_existing', 'seeded scenario reuses existing Sense');

  const unavailableId = await createMeaning(gateway, { blocks: [{ kind: 'text', bodyText: '一个没有模拟场景的私人回忆' }] }, 100);
  await expectFailure(
    () => gateway.generateFocusSuggestions({ operationId: op(101), personalMeaningId: unavailableId }),
    'unmatched mock scenario is explicitly unavailable',
  );
  assert(gateway.getDetail(unavailableId)!.focuses.length === 0, 'unavailable scenario creates no fake Focus');
  assert(gateway.getDetail(unavailableId)!.focusSuggestions.length === 0, 'unavailable scenario creates no generic suggestion');

  // v2 reload does not read the legacy v1 key and keeps all IDs/facts stable.
  storage.write('sensa_personal_meaning_journey_v1', JSON.stringify({ version: 'sensa-personal-meaning-journey-store-v1', meanings: [] }));
  const beforeReload = gateway.getDetail(umbrellaId)!;
  const factsBeforeReload = storage.read(JOURNEY_STORE_KEY)!;
  const currentBindingVersionIdsBeforeReload = beforeReload.focuses
    .flatMap((focus) => focus.alignment?.confirmedBindings.map((binding) => binding.bindingVersionId) ?? []);
  const reloaded = newGateway(storage);
  const afterReload = reloaded.getDetail(umbrellaId)!;
  const reloadedWorldItem = reloaded.getWorldItems().find((item) => item.personalMeaningId === umbrellaId)!;
  assert(afterReload.personalMeaningId === beforeReload.personalMeaningId, 'v2 reload keeps Personal Meaning id');
  assert(reloadedWorldItem.detail.personalMeaningId === afterReload.personalMeaningId, 'reloaded world and detail keep one canonical Personal Meaning id');
  assert(afterReload.focuses.map((focus) => focus.meaningFocusId).join(',') === beforeReload.focuses.map((focus) => focus.meaningFocusId).join(','), 'v2 reload keeps Focus ids');
  assert(afterReload.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!.alignment!.senseVersionId === senseConfirm.senseVersionId, 'v2 reload keeps Sense Version id');
  assert(afterReload.focuses.find((focus) => focus.meaningFocusId === editedBorrow.meaningFocusId)!.alignment!.semanticSpec !== null, 'v2 reload keeps the exact Sense semantic spec for the confirmed detail');
  const currentBindingVersionIdsAfterReload = afterReload.focuses
    .flatMap((focus) => focus.alignment?.confirmedBindings.map((binding) => binding.bindingVersionId) ?? []);
  assert(currentBindingVersionIdsAfterReload.join(',') === currentBindingVersionIdsBeforeReload.join(','), 'v2 reload keeps current Binding identities and omits historical versions');
  assert(storage.read(JOURNEY_STORE_KEY) !== null, 'facts are persisted under v2 key');
  assert(storage.read(JOURNEY_STORE_KEY) === factsBeforeReload, 'v2 reload does not rewrite facts or IDs');
  validateFacts(storage);

  // Construction is model-led and may need zero learner clarification turns.
  const directStorage = new MemoryStoragePort();
  const baseLlm = createMockSemanticLlm();
  const directGateway = createJourneyGateway({
    storage: directStorage,
    clock: createSeededClock(),
    ids: createSeededIdPort(900),
    llm: {
      ...baseLlm,
      nextConstructionTurn: async (context) => {
        const draft = await baseLlm.nextConstructionTurn(context);
        return context.priorTurns.length === 0
          ? { ...draft, body: '现有经验已经足够形成一个稳定理解。', boundaryOptions: [], readyForProposal: true }
          : draft;
      },
    },
  });
  const directMeaningId = await createMeaning(
    directGateway,
    { blocks: [{ kind: 'text', bodyText: '下雨天我没带伞，同事把伞借给了我' }] },
    200,
  );
  await generateFocus(directGateway, directMeaningId, 201);
  const directFocus = await acceptSuggestion(directGateway, directMeaningId, 0, 202);
  await directGateway.startConstruction({
    operationId: op(204),
    personalMeaningId: directMeaningId,
    meaningFocusId: directFocus.meaningFocusId,
    meaningFocusRevisionId: directFocus.currentRevisionId,
  });
  const directConstruction = directGateway.getDetail(directMeaningId)!.focuses
    .find((focus) => focus.meaningFocusId === directFocus.meaningFocusId)!.construction!;
  assert(!directConstruction.awaitingLearnerAnswer, 'model-ready Construction asks no mandatory learner question');
  assert(directConstruction.readyForProposal, 'model-ready Construction can proceed directly to Proposal');
  await directGateway.generateProposal({
    operationId: op(205),
    personalMeaningId: directMeaningId,
    meaningFocusId: directFocus.meaningFocusId,
  });
  assert(
    directGateway.getDetail(directMeaningId)!.focuses
      .find((focus) => focus.meaningFocusId === directFocus.meaningFocusId)!.phase === 'proposal_ready',
    'zero-turn model-led Construction produces a confirmable Proposal',
  );
  validateFacts(directStorage);

  // The open-ended agent loop can materialize one confirmed Sense from its
  // transcript without replaying the legacy three-operation LLM workflow.
  const agentStorage = new MemoryStoragePort();
  const agentGateway = newGateway(agentStorage);
  const agentMeaningId = await createMeaning(
    agentGateway,
    { blocks: [{ kind: 'text', bodyText: '下雨天我没带伞，同事把伞借给了我' }] },
    300,
  );
  await generateFocus(agentGateway, agentMeaningId, 301);
  const agentFocus = await acceptSuggestion(agentGateway, agentMeaningId, 0, 302);
  const agentProposal = await createMockSemanticLlm().generateSenseProposal({
    familiarExpressions: [],
    experienceAnchors: [{ bodyText: '下雨天我没带伞，同事把伞借给了我' }],
    learnerIntentNote: null,
    focusStatement: agentFocus.statement,
    focusDistinguishingNotes: agentFocus.distinguishingNotes,
    priorTurns: [
      { actor: 'semantic_llm', body: '你想强调的是暂时取得别人的东西，并且之后会归还吗？' },
      { actor: 'learner', body: '对，我关注的是拿来使用并预期归还。' },
    ],
  });
  const agentInput = {
    operationId: op(304),
    personalMeaningId: agentMeaningId,
    meaningFocusId: agentFocus.meaningFocusId,
    proposal: agentProposal,
    transcript: [
      {
        messageId: op(310),
        role: 'assistant' as const,
        body: '你想强调的是暂时取得别人的东西，并且之后会归还吗？',
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        messageId: op(311),
        role: 'learner' as const,
        body: '对，我关注的是拿来使用并预期归还。',
        occurredAt: '2026-01-01T00:00:01.000Z',
      },
    ],
  };
  const agentResult = await agentGateway.confirmAgentSense(agentInput);
  const agentReplay = await agentGateway.confirmAgentSense(agentInput);
  const confirmedAgentFocus = agentGateway.getDetail(agentMeaningId)!.focuses
    .find((focus) => focus.meaningFocusId === agentFocus.meaningFocusId)!;
  assert(Boolean(confirmedAgentFocus.alignment), 'agent transcript materializes a confirmed Sense alignment');
  assert(
    (confirmedAgentFocus.alignment?.expressionCandidates.length ?? 0) > 0,
    'agent Sense keeps expression candidates for the separate binding confirmation',
  );
  assert(agentReplay.replayed, 'agent Sense confirmation is idempotent');
  assert(agentReplay.senseId === agentResult.senseId, 'agent Sense replay keeps exact identity');
  validateFacts(agentStorage);

  // === One learner confirmation, three independent facts, all or nothing ===
  // This is the live AI clarification path: the screen never calls the legacy
  // suggest → construct → answer → propose commands.
  const clarifyStorage = new MemoryStoragePort();
  const clarifyGateway = newGateway(clarifyStorage);
  const clarifyId = await createMeaning(
    clarifyGateway,
    {
      blocks: [
        { kind: 'text', bodyText: '下雨天我没带伞，同事把伞借给了我' },
        { kind: 'image', personalMediaObjectId: op(398) },
      ],
      familiarExpression: { surfaceForm: '借伞' },
      startingPoint: 'from_experience',
    },
    400,
  );
  const clarifyDetail = clarifyGateway.getDetail(clarifyId)!;
  assert(clarifyDetail.materialBlocks.length === 2, 'material keeps every block as its own Anchor');
  assert(clarifyDetail.materialBlocks[1].kind === 'image', 'image blocks survive as image Anchors');
  assert(
    clarifyDetail.materialBlocks[1].personalMediaObjectId === op(398),
    'an image Anchor references the media object, not inline bytes',
  );
  assert(clarifyDetail.experienceAnchors.length === 1, 'the text projection stays text-only');
  assert(clarifyDetail.startingPoint === 'from_experience', 'the declared stance is readable back');
  assert(clarifyDetail.focuses.length === 0, 'saving material creates no Focus');

  const clarifySense = {
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
  const clarifyProvenance = { provider: 'test', model: 'test-model', promptVersion: 'test-v1' };

  // A rejected step must leave nothing behind: an unusable expression type is
  // caught after the Focus and the Sense would already have been written.
  await expectFailure(
    () => clarifyGateway.confirmClarification({
      operationId: op(401),
      personalMeaningId: clarifyId,
      focus: { statement: '接收方向', distinguishingNotes: ['我是拿到伞的一方'], aspectLabel: '接收' },
      sense: clarifySense,
      expression: {
        surfaceForm: '   ',
        expressionType: 'word',
        languageTag: 'en',
        relation: 'realizes',
        semanticCoverage: 'overlapping',
      },
      confirmExpression: true,
      transcript: [{
        messageId: op(410), role: 'learner' as const, body: '我要的是拿到伞那一方',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }],
      provenance: clarifyProvenance,
      semanticPolicyVersion: 'test-policy-v1',
    }),
    'a blank expression rejects the whole confirmation',
  );
  const afterFailure = clarifyGateway.getDetail(clarifyId)!;
  assert(afterFailure.focuses.length === 0, 'a rejected confirmation leaves no orphan Focus');
  const failureState = loadJourneyState(clarifyStorage);
  const failureRecord = failureState.meanings.find(
    (record) => record.personalMeaning.personalMeaningId === clarifyId,
  )!;
  assert(
    failureRecord.constructions.length === 0 && failureRecord.proposals.length === 0,
    'a rejected confirmation leaves no orphan Construction or open Proposal on disk',
  );

  // Confirming only two facts is a legal resting state, not a failure.
  const partialInput = {
    operationId: op(402),
    personalMeaningId: clarifyId,
    focus: {
      statement: '接收方向',
      distinguishingNotes: ['我是拿到伞的一方'],
      aspectLabel: '接收',
    },
    sense: clarifySense,
    expression: null,
    confirmExpression: false,
    transcript: [{
      messageId: op(411), role: 'learner' as const, body: '我要的是拿到伞那一方',
      occurredAt: '2026-01-01T00:00:00.000Z',
    }],
    provenance: clarifyProvenance,
    semanticPolicyVersion: 'test-policy-v1',
  };
  const partial = await clarifyGateway.confirmClarification(partialInput);
  assert(!partial.expressionConfirmed, 'Sense confirmed with Expression pending is supported');
  const partialReplay = await clarifyGateway.confirmClarification(partialInput);
  assert(partialReplay.replayed, 'one clarification confirmation is idempotent');
  assert(
    partialReplay.meaningFocusId === partial.meaningFocusId,
    'replaying a confirmation creates no parallel Focus identity',
  );
  const partialDetail = clarifyGateway.getDetail(clarifyId)!;
  assert(partialDetail.focuses.length === 1, 'one confirmation creates exactly one Focus');
  assert(partialDetail.focuses[0].accepted, 'the Focus acceptance fact is recorded independently');
  assert(Boolean(partialDetail.focuses[0].alignment), 'the Sense confirmation creates an Alignment');
  assert(
    partialDetail.focuses[0].alignment!.confirmedBindings.length === 0,
    'no Binding is invented when the learner deferred the expression',
  );
  assert(
    partialDetail.expressionBinding.phase === 'pending',
    'the world axis reads back as Sense confirmed / Binding pending',
  );

  // A second thread on the same material becomes a sibling Focus, all three facts.
  const siblingConfirm = await clarifyGateway.confirmClarification({
    operationId: op(403),
    personalMeaningId: clarifyId,
    focus: { statement: '出借方向', distinguishingNotes: ['同事是给出伞的一方'], aspectLabel: '出借' },
    sense: {
      ...clarifySense,
      proposedSenseKey: 'lend-temporary-use-return',
      coreMeaningFocus: '把自己的东西暂时给别人使用，并预期收回',
    },
    expression: {
      surfaceForm: 'lend',
      expressionType: 'word',
      languageTag: 'en',
      relation: 'realizes',
      semanticCoverage: 'overlapping',
    },
    confirmExpression: true,
    transcript: [{
      messageId: op(412), role: 'learner' as const, body: '这次我说的是同事那一方',
      occurredAt: '2026-01-01T00:01:00.000Z',
    }],
    provenance: clarifyProvenance,
    semanticPolicyVersion: 'test-policy-v1',
  });
  assert(siblingConfirm.expressionConfirmed, 'all three facts can land in one confirmation');
  assert(
    siblingConfirm.meaningFocusId !== partial.meaningFocusId,
    'a second thread on the same material keeps an independent Focus identity',
  );
  const siblingDetail = clarifyGateway.getDetail(clarifyId)!;
  assert(siblingDetail.focuses.length === 2, 'sibling Focuses share one Personal Meaning');
  assert(siblingDetail.materialBlocks.length === 2, 'confirming never rewrites the material');
  const siblingFocus = siblingDetail.focuses
    .find((focus) => focus.meaningFocusId === siblingConfirm.meaningFocusId)!;
  const siblingBinding = siblingFocus.alignment!.confirmedBindings[0];
  assert(siblingBinding.surfaceForm === 'lend', 'the confirmed Binding keeps the learner surface form');
  assert(
    siblingBinding.relation === 'realizes' && siblingBinding.semanticCoverage === 'overlapping',
    'relation and coverage are confirmed values, never a translation-equality default',
  );
  validateFacts(clarifyStorage);

  console.log(`SMOKE OK — ${checks} checks passed.`);
};

run().catch((error) => {
  console.log(error instanceof Error ? error.message : String(error));
  throw error;
});
