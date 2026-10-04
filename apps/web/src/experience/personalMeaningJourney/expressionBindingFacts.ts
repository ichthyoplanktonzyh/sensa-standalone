/** Shared Expression/Binding fact writer. No storage, receipts, model calls or IO. */
import type {SensaPersonalMeaningAlignmentSnapshot,SensaExpressionType,SensaExpressionBindingRelation,SensaSemanticCoverage,SensaPersonalExpressionAnchorRevisionSnapshot,SensaPersonalExpressionAnchorSnapshot,SensaExpressionSnapshot,SensaExpressionVersionSnapshot,SensaSenseExpressionBindingSnapshot,SensaSenseExpressionBindingVersionSnapshot,SensaConfirmExpressionBindingFact} from '@sensa/contracts/sensa';
import type {JourneyState,MeaningJourneyRecord} from './store';
import type {JourneyFactPorts} from './ports';
import {activeExpressionAnchors,appendMeaningRevision} from './meaningRecords';
const PSW='sensa-personal-semantic-world-v3' as const,REG='sensa-semantic-registry-v1' as const,LEARNER_USER_ID='sensa-local-learner';
type PersonalProvenanceKind=SensaPersonalExpressionAnchorRevisionSnapshot['provenanceKind'];
type PersonalExpressionVerificationStatus=SensaPersonalExpressionAnchorRevisionSnapshot['verificationStatus'];
const normalizedForm=(surfaceForm:string,languageTag:string)=>surfaceForm.trim().toLocaleLowerCase(languageTag);

function expressionAnchorRevisionFor(
  record: MeaningJourneyRecord,
  anchorId: string,
  revision: number,
): SensaPersonalExpressionAnchorRevisionSnapshot | null {
  return record.personalExpressionAnchorRevisions.find(
    (candidate) =>
      candidate.personalExpressionAnchorId === anchorId
      && candidate.revision === revision,
  ) ?? null;
}

/**
 * Shared binding core for `confirmClarification` and the standalone
 * `confirmExpressionBinding`. Caller owns validation, receipts and persist;
 * this only writes facts.
 */
export function settleExpressionBinding(
  state: JourneyState,
  ports: JourneyFactPorts,
  record: MeaningJourneyRecord,
  alignment: SensaPersonalMeaningAlignmentSnapshot,
  candidate: {
    candidateId: string;
    expressionType: SensaExpressionType;
    languageTag: string;
    surfaceForm: string;
    provenanceKind?: PersonalProvenanceKind;
    personalExpressionAnchorRevisionId?: string | null;
  },
  input: {
    operationId: string;
    senseVersionId: string;
    surfaceForm: string;
    languageTag: string;
    expressionType: SensaExpressionType;
    relation: SensaExpressionBindingRelation;
    semanticCoverage: SensaSemanticCoverage;
  },
  senseProposalVersionId: string | null,
  pinned?: {
    expressionId: string;
    expressionVersionId: string;
    senseExpressionBindingId: string;
    bindingVersionId: string;
  },
): {
  expressionBindingConfirmationId: string;
  personalExpressionAnchorRevisionId: string;
  expressionId: string;
  expressionVersionId: string;
  senseExpressionBindingId: string;
  bindingVersionId: string;
} {
  const unchangedCandidate =
    input.languageTag === candidate.languageTag
    && input.expressionType === candidate.expressionType
    && input.surfaceForm === candidate.surfaceForm;
  const provenanceKind: PersonalProvenanceKind = unchangedCandidate
    ? candidate.provenanceKind ?? 'llm_suggested'
    : 'learner_authored';
  const form = normalizedForm(input.surfaceForm, input.languageTag);
  const existingExpression = pinned
    ? state.registry.expressions.find((expression) => expression.expressionId === pinned.expressionId)
    : state.registry.expressions.find((expression) =>
        expression.expressionType === input.expressionType
        && expression.languageTag === input.languageTag
        && state.registry.expressionVersions.some(
          (version) =>
            version.expressionId === expression.expressionId
            && version.normalizedForm === form,
        ),
      );
  let expression: SensaExpressionSnapshot;
  let expressionVersion: SensaExpressionVersionSnapshot;
  const now = ports.nowIso();
  if (pinned && !existingExpression) {
    throw new Error('固定的已发布 Expression 不存在。');
  }
  if (existingExpression) {
    expression = existingExpression;
    expressionVersion = state.registry.expressionVersions.find(
      (version) => pinned
        ? version.expressionVersionId === pinned.expressionVersionId
        : version.expressionId === expression.expressionId && version.normalizedForm === form,
    )!;
    if (!expressionVersion || expression.expressionType !== input.expressionType
      || expression.languageTag !== input.languageTag || expressionVersion.normalizedForm !== form) {
      throw new Error('固定的已发布 Expression Version 与学习目标不一致。');
    }
  } else {
    const expressionId = ports.newId();
    const expressionVersionId = ports.newId();
    expression = {
      contractVersion: REG,
      expressionId,
      expressionType: input.expressionType,
      languageTag: input.languageTag,
      lexemeId: null,
      currentExpressionVersionId: expressionVersionId,
      currentVersionNumber: 1,
      createdAt: now,
    };
    expressionVersion = {
      contractVersion: REG,
      expressionVersionId,
      expressionId,
      versionNumber: 1,
      surfaceForm: input.surfaceForm,
      normalizedForm: form,
      structure: {},
      provenance: {
        sourceKind: 'learner_confirmed',
        sourceReferenceIds: [candidate.candidateId],
        generator: null,
      },
      createdAt: now,
    };
    state.registry.expressions.push(expression);
    state.registry.expressionVersions.push(expressionVersion);
  }

  const existingBinding = pinned
    ? state.registry.bindings.find((binding) => binding.senseExpressionBindingId === pinned.senseExpressionBindingId)
    : state.registry.bindings.find(
        (binding) =>
          binding.senseId === alignment.senseId
          && binding.expressionId === expression.expressionId
          && binding.relation === input.relation,
      );
  let binding: SensaSenseExpressionBindingSnapshot;
  let bindingVersion: SensaSenseExpressionBindingVersionSnapshot | undefined;
  if (pinned && !existingBinding) {
    throw new Error('固定的已发布 Binding 不存在。');
  }
  if (existingBinding) {
    binding = existingBinding;
    bindingVersion = state.registry.bindingVersions.find(
      (version) => pinned
        ? version.bindingVersionId === pinned.bindingVersionId
        : version.senseExpressionBindingId === binding.senseExpressionBindingId
          && version.senseVersionId === input.senseVersionId
          && version.expressionVersionId === expressionVersion.expressionVersionId
          && version.semanticCoverage === input.semanticCoverage,
    );
    if (pinned && (!bindingVersion || binding.senseId !== alignment.senseId
      || binding.expressionId !== expression.expressionId || binding.relation !== input.relation
      || bindingVersion.senseVersionId !== input.senseVersionId
      || bindingVersion.expressionVersionId !== expressionVersion.expressionVersionId
      || bindingVersion.semanticCoverage !== input.semanticCoverage)) {
      throw new Error('固定的已发布 Binding Version 与学习目标不一致。');
    }
    if (!bindingVersion) {
      const nextVersion = binding.currentVersionNumber + 1;
      const nextBindingVersionId = ports.newId();
      const updatedBinding={
        ...binding,
        currentVersionNumber:nextVersion,
        currentBindingVersionId:nextBindingVersionId,
      };
      state.registry.bindings[state.registry.bindings.indexOf(binding)]=updatedBinding;
      binding=updatedBinding;
      bindingVersion = {
        contractVersion: REG,
        bindingVersionId: nextBindingVersionId,
        senseExpressionBindingId: binding.senseExpressionBindingId,
        versionNumber: nextVersion,
        senseVersionId: input.senseVersionId,
        expressionVersionId: expressionVersion.expressionVersionId,
        semanticCoverage: input.semanticCoverage,
        registerLabel: null,
        usageConstraints: [],
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [candidate.candidateId],
          generator: null,
        },
        reviewStatus: 'learner_confirmed',
        createdAt: now,
      };
      state.registry.bindingVersions.push(bindingVersion);
    }
  } else {
    const senseExpressionBindingId = ports.newId();
    const bindingVersionId = ports.newId();
    binding = {
      contractVersion: REG,
      senseExpressionBindingId,
      senseId: alignment.senseId,
      expressionId: expression.expressionId,
      relation: input.relation,
      currentBindingVersionId: bindingVersionId,
      currentVersionNumber: 1,
      createdAt: now,
    };
    bindingVersion = {
      contractVersion: REG,
      bindingVersionId,
      senseExpressionBindingId,
      versionNumber: 1,
      senseVersionId: input.senseVersionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      semanticCoverage: input.semanticCoverage,
      registerLabel: null,
      usageConstraints: [],
      provenance: {
        sourceKind: 'learner_confirmed',
        sourceReferenceIds: [candidate.candidateId],
        generator: null,
      },
      reviewStatus: 'learner_confirmed',
      createdAt: now,
    };
    state.registry.bindings.push(binding);
    state.registry.bindingVersions.push(bindingVersion);
  }

  const existingConfirmation = record.bindingConfirmations.find(
    (confirmation) =>
      confirmation.senseVersionId === input.senseVersionId
      && confirmation.expressionVersionId === expressionVersion.expressionVersionId
      && confirmation.bindingVersionId === bindingVersion!.bindingVersionId,
  );
  if (existingConfirmation) {
    return {
      expressionBindingConfirmationId: existingConfirmation.expressionBindingConfirmationId,
      personalExpressionAnchorRevisionId: existingConfirmation.personalExpressionAnchorRevisionId,
      expressionId: expression.expressionId,
      expressionVersionId: expressionVersion.expressionVersionId,
      senseExpressionBindingId: binding.senseExpressionBindingId,
      bindingVersionId: bindingVersion.bindingVersionId,
    };
  }

  let anchorRevision: SensaPersonalExpressionAnchorRevisionSnapshot | null = null;
  let anchor: SensaPersonalExpressionAnchorSnapshot | undefined;
  let createdTargetAnchor = false;
  if (candidate.personalExpressionAnchorRevisionId) {
    const captured = record.personalExpressionAnchorRevisions.find(
      (revision) => revision.personalExpressionAnchorRevisionId
        === candidate.personalExpressionAnchorRevisionId,
    );
    const capturedAnchor = captured && record.personalExpressionAnchors.find(
      (item) => item.personalExpressionAnchorId === captured.personalExpressionAnchorId
        && item.status === 'active',
    );
    if (
      captured
      && capturedAnchor
      && captured.languageTag === input.languageTag
      && captured.expressionType === input.expressionType
      && captured.surfaceForm === input.surfaceForm
    ) {
      anchor = capturedAnchor;
      if (captured.verificationStatus === 'learner_confirmed') {
        anchorRevision = captured;
      } else {
        anchorRevision = {
          ...captured,
          personalExpressionAnchorRevisionId: ports.newId(),
          revision: capturedAnchor.currentRevision + 1,
          verificationStatus: 'learner_confirmed',
          provenance: {
            ...captured.provenance,
            sourceReferenceIds: [...new Set([
              ...captured.provenance.sourceReferenceIds,
              candidate.candidateId,
            ])],
            createdByOperationId: input.operationId,
          },
          createdAt: now,
        };
        capturedAnchor.currentRevision = anchorRevision.revision;
        capturedAnchor.updatedAt = now;
        record.personalExpressionAnchorRevisions.push(anchorRevision);
      }
    }
  }
  // The intake fast track pre-creates the captured expression anchor with
  // this candidate id in its provenance (either language role), so match
  // any active anchor before creating a duplicate.
  for (const candidateAnchor of anchorRevision ? [] : activeExpressionAnchors(record)) {
    const current = expressionAnchorRevisionFor(
      record,
      candidateAnchor.personalExpressionAnchorId,
      candidateAnchor.currentRevision,
    );
    if (
      current
      && current.provenance.sourceReferenceIds.includes(candidate.candidateId)
      && current.languageTag === input.languageTag
      && current.expressionType === input.expressionType
      && current.surfaceForm === input.surfaceForm
    ) {
      anchor = candidateAnchor;
      anchorRevision = current;
      break;
    }
  }
  if (!anchorRevision) {
    const anchorId = ports.newId();
    const anchorRevisionId = ports.newId();
    anchor = {
      contractVersion: PSW,
      personalExpressionAnchorId: anchorId,
      personalMeaningId: record.personalMeaning.personalMeaningId,
      currentRevision: 1,
      lifecycleRevision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedByOperationId: null,
    };
    anchorRevision = {
      contractVersion: PSW,
      personalExpressionAnchorRevisionId: anchorRevisionId,
      personalExpressionAnchorId: anchorId,
      revision: 1,
      expressionType: input.expressionType,
      languageTag: input.languageTag,
      surfaceForm: input.surfaceForm,
      normalizedForm: form,
      contextAnchorRevisionId: null,
      occurrence: null,
      provenanceKind,
      verificationStatus: 'learner_confirmed' as PersonalExpressionVerificationStatus,
      provenance: {
        kind: provenanceKind,
        sourceReferenceIds: [candidate.candidateId],
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    };
    record.personalExpressionAnchors.push(anchor);
    record.personalExpressionAnchorRevisions.push(anchorRevision);
    createdTargetAnchor = true;
  }

  if (createdTargetAnchor) {
    appendMeaningRevision(ports,record, input.operationId, [anchorRevision.personalExpressionAnchorId]);
  }

  const expressionBindingConfirmationId = ports.newId();
  const confirmation: SensaConfirmExpressionBindingFact = {
    contractVersion: PSW,
    expressionBindingConfirmationId,
    operationId: input.operationId,
    learnerUserId: LEARNER_USER_ID,
    senseProposalVersionId,
    personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
    senseVersionId: input.senseVersionId,
    expressionVersionId: expressionVersion.expressionVersionId,
    bindingVersionId: bindingVersion.bindingVersionId,
    confirmedAt: now,
  };
  record.bindingConfirmations.push(confirmation);
  return {
    expressionBindingConfirmationId,
    personalExpressionAnchorRevisionId: anchorRevision.personalExpressionAnchorRevisionId,
    expressionId: expression.expressionId,
    expressionVersionId: expressionVersion.expressionVersionId,
    senseExpressionBindingId: binding.senseExpressionBindingId,
    bindingVersionId: bindingVersion.bindingVersionId,
  };
}
