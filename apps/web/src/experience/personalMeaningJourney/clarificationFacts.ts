/** Explicit clarification acceptance facts; the gateway owns source guards and commit. */
import type {SensaConfirmSenseProposalFact,SensaMeaningFocusAcceptanceFact,SensaPersonalMeaningAlignmentEvent,SensaPersonalMeaningAlignmentSnapshot,SensaSenseProposalVersionSnapshot,SensaSenseSemanticSpec,SensaSenseVersionSnapshot} from '@sensa/contracts/sensa';
import {sensaPinnedLanguageContextSchema} from '@sensa/contracts/sensa';
import type {JourneyState,MeaningJourneyRecord} from './store';
import type {JourneyFactPorts} from './ports';
import type {ConfirmClarificationInput,ConfirmClarificationResult} from './types';
import type {MeaningLookupMatch} from './meaningLookup';
import {digestOf} from './digest';
import {latestMeaningRevision} from './meaningRecords';
import {settleExpressionBinding} from './expressionBindingFacts';
const PSW='sensa-personal-semantic-world-v3' as const,REG='sensa-semantic-registry-v1' as const,SPEC_SCHEMA='sensa-sense-semantic-spec-v1' as const,LEARNER_USER_ID='sensa-local-learner';

const cleanNotes = (notes: string[] | undefined): string[] =>
  (notes ?? []).map((note) => note.trim()).filter(Boolean);

const cloneSpec = (spec: SensaSenseSemanticSpec): SensaSenseSemanticSpec => ({
  schemaVersion: SPEC_SCHEMA,
  coreMeaningFocus: spec.coreMeaningFocus,
  prototypeScenes: spec.prototypeScenes.map((scene) => ({
    summary: scene.summary,
    participantRoles: [...scene.participantRoles],
    states: [...scene.states],
    directionOrCausality: scene.directionOrCausality,
  })),
  includedCases: [...spec.includedCases],
  excludedCases: [...spec.excludedCases],
  neighborContrasts: spec.neighborContrasts.map((contrast) => ({ ...contrast })),
  openQuestions: [...spec.openQuestions],
});

function buildSemanticSpec(proposal: {
  coreMeaningFocus: string;
  prototypeScenes: SensaSenseSemanticSpec['prototypeScenes'];
  includedCases: string[];
  excludedCases: string[];
  neighborContrasts: SensaSenseSemanticSpec['neighborContrasts'];
  openQuestions: string[];
}): SensaSenseSemanticSpec {
  return cloneSpec({
    schemaVersion: SPEC_SCHEMA,
    coreMeaningFocus: proposal.coreMeaningFocus,
    prototypeScenes: proposal.prototypeScenes,
    includedCases: proposal.includedCases,
    excludedCases: proposal.excludedCases,
    neighborContrasts: proposal.neighborContrasts,
    openQuestions: proposal.openQuestions,
  });
}

type SemanticGeneratorProvenance=NonNullable<SensaSenseVersionSnapshot['provenance']['generator']>;
type ProposalGeneratorProvenance=SensaSenseProposalVersionSnapshot['generatorProvenance'];
export function applyClarificationFacts(state:JourneyState,record:MeaningJourneyRecord,input:ConfirmClarificationInput,ports:JourneyFactPorts,reused:MeaningLookupMatch|null):Omit<ConfirmClarificationResult,'replayed'>{
    const languages = sensaPinnedLanguageContextSchema.parse(input.languageContext);

    // Validate the whole intent before writing any fact: a rejected step must
    // leave the store exactly as it was.
    const focusInput = input.focus ?? null;
    const statement = focusInput?.statement.trim() ?? '';
    if (focusInput && !statement) throw new Error('表达侧面陈述不能为空。');
    const notes = focusInput ? cleanNotes(focusInput.distinguishingNotes) : [];
    const aspectLabel = focusInput?.aspectLabel.trim() ?? '';
    const senseKey = input.sense.proposedSenseKey.trim();
    if (!senseKey) throw new Error('稳定意思缺少可复用的语义 key。');
    if (!input.sense.coreMeaningFocus.trim()) throw new Error('稳定意思不能为空。');
    if (input.sense.prototypeScenes.length === 0) {
      throw new Error('稳定意思至少需要一个原型场景。');
    }
    if (!input.semanticPolicyVersion.trim()) throw new Error('缺少语义策略版本。');
    const semanticSpec = buildSemanticSpec(input.sense);
    if (input.sense.reuseSense && (!reused || reused.senseKey !== senseKey
      || digestOf(reused.semanticSpec) !== digestOf(semanticSpec))) {
      throw new Error('要复用的已确认意思已变化，或与当前审阅的语义不一致。请重新澄清。');
    }
    const existingSense = state.registry.senses.find((sense) => sense.senseKey === senseKey);
    if (!reused && existingSense) {
      throw new Error('这个语义 key 已存在；复用必须明确选择已确认的 Sense Version，不能只按 key 自动匹配。请重新澄清。');
    }
    const provenance = input.provenance;
    if (!provenance.provider.trim() || !provenance.model.trim() || !provenance.promptVersion.trim()) {
      throw new Error('缺少模型来源信息。');
    }
    const expressionInput = input.expression
      ? (() => {
          const surfaceForm = input.expression!.surfaceForm.trim();
          if (!surfaceForm) throw new Error('目标表达不能为空。');
          const languageTag = input.expression!.languageTag.trim();
          if (!languageTag) throw new Error('目标表达必须带语言标签。');
          if (input.confirmExpression) {
            if (!['realizes', 'approximates', 'evokes'].includes(input.expression!.relation)) {
              throw new Error('请明确选择目标表达与 Sense 的关系。');
            }
            if (!['exact', 'broader', 'narrower', 'overlapping'].includes(input.expression!.semanticCoverage)) {
              throw new Error('请明确选择目标表达的语义覆盖范围。');
            }
          }
          return {
            surfaceForm,
            languageTag,
            expressionType: input.expression!.expressionType,
            relation: input.expression!.relation,
            semanticCoverage: input.expression!.semanticCoverage,
          };
        })()
      : null;
    if (!focusInput && (!expressionInput || !input.confirmExpression)) {
      throw new Error('无需 Focus 的语义条目必须同时确认 Context、Sense 与 Expression。');
    }

    const now = ports.nowIso();
    const personalMeaningRevision = latestMeaningRevision(record);
    if (!personalMeaningRevision) throw new Error('个人意义修订不存在，无法确认。');

    // 1) A Meaning Focus exists only when this Context needed an explicit
    //    aspect boundary. Clear contexts proceed directly to Sense construction.
    const meaningFocusId = focusInput ? ports.newId() : null;
    const meaningFocusRevisionId = focusInput ? ports.newId() : null;
    if (focusInput && meaningFocusId && meaningFocusRevisionId) {
      record.focuses.push({
        contractVersion: PSW,
        meaningFocusId,
        personalMeaningId: input.personalMeaningId,
        splitFromMeaningFocusId: null,
        currentRevision: 1,
        acceptedRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      });
      record.focusRevisions.push({
        contractVersion: PSW,
        meaningFocusRevisionId,
        meaningFocusId,
        revision: 1,
        statement,
        distinguishingNotes: notes,
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [input.personalMeaningId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
      const acceptance: SensaMeaningFocusAcceptanceFact = {
        contractVersion: PSW,
        meaningFocusAcceptanceId: ports.newId(),
        meaningFocusId,
        meaningFocusRevisionId,
        operationId: input.operationId,
        acceptedAt: now,
      };
      record.focusAcceptances.push(acceptance);
      if (aspectLabel) record.mockState.focusAspectLabels[meaningFocusId] = aspectLabel;
    }

    // 2) The transcript becomes the authoritative Construction turns.
    const senseConstructionId = ports.newId();
    record.constructions.push({
      contractVersion: PSW,
      senseConstructionId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: personalMeaningRevision.personalMeaningRevisionId,
      meaningFocusId,
      meaningFocusRevisionId,
      languageContext:languages,
      semanticPolicyVersion: input.semanticPolicyVersion,
      status: 'completed',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    input.transcript.forEach((message, index) => {
      const modelProvenance = message.role === 'learner'
        ? null
        : {
            provider: provenance.provider,
            model: provenance.model,
            promptVersion: provenance.promptVersion,
          };
      record.constructionTurns.push({
        contractVersion: PSW,
        constructionTurnId: ports.newId(),
        senseConstructionId,
        ordinal: index + 1,
        actor: message.role === 'learner' ? 'learner' : 'semantic_llm',
        body: message.body,
        inputDigest: null,
        outputDigest: digestOf(message.body),
        modelProvenance,
        occurredAt: message.occurredAt,
      });
    });

    // 3) The proposal version carries the semantic spec and, when the panel
    //    had one, the expression candidate. Recording a candidate is
    //    provenance, never confirmation.
    const senseProposalId = ports.newId();
    const senseProposalVersionId = ports.newId();
    const generator: ProposalGeneratorProvenance = {
      provider: provenance.provider,
      model: provenance.model,
      promptVersion: provenance.promptVersion,
      inputDigest: digestOf({ focus: focusInput, transcript: input.transcript }),
      outputDigest: digestOf(input.sense),
    };
    const candidatesList = (input.expressionCandidates && input.expressionCandidates.length > 0)
      ? input.expressionCandidates
      : expressionInput ? [expressionInput] : [];

    let chosenCandidateId: string | null = null;
    const proposalExpressionCandidates = candidatesList.map((item) => {
      const id = ports.newId();
      if (expressionInput && item.surfaceForm === expressionInput.surfaceForm && !chosenCandidateId) {
        chosenCandidateId = id;
      }
      const capturedRevision = record.personalExpressionAnchorRevisions.find((revision) => (
        revision.verificationStatus === 'unverified'
        && revision.languageTag === item.languageTag
        && revision.expressionType === item.expressionType
        && revision.surfaceForm === item.surfaceForm
      ));
      return {
        candidateId: id,
        personalExpressionAnchorRevisionId:
          capturedRevision?.personalExpressionAnchorRevisionId ?? null,
        expressionType: item.expressionType,
        languageTag: item.languageTag,
        surfaceForm: item.surfaceForm,
        rationale: '由澄清对话提议的候选表达',
      };
    });

    const candidateId = chosenCandidateId ?? (expressionInput ? ports.newId() : null);
    record.proposals.push({
      contractVersion: PSW,
      senseProposalId,
      senseConstructionId,
      currentVersion: 1,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });
    record.proposalVersions.push({
      contractVersion: PSW,
      senseProposalVersionId,
      senseProposalId,
      version: 1,
      meaningFocusRevisionId,
      semanticSpec,
      expressionCandidates: proposalExpressionCandidates,
      unresolvedQuestions: cleanNotes(input.sense.unresolvedQuestions),
      semanticPolicyVersion: input.semanticPolicyVersion,
      generatorProvenance: generator,
      createdAt: now,
    });

    // 4) Sense resolution: reuse an existing Sense with the same key, or
    //    register a new learner-confirmed one.
    let senseId: string;
    let senseVersionId: string;
    let resolution: 'create_new' | 'reuse_existing';
    if (reused) {
      senseId = reused.senseId;
      senseVersionId = reused.senseVersionId;
      resolution = 'reuse_existing';
    } else {
      senseId = ports.newId();
      senseVersionId = ports.newId();
      resolution = 'create_new';
      const senseGenerator: SemanticGeneratorProvenance = {
        provider: provenance.provider,
        model: provenance.model,
        promptVersion: provenance.promptVersion,
        policyVersion: input.semanticPolicyVersion,
        inputDigest: generator.inputDigest,
        outputDigest: generator.outputDigest,
      };
      state.registry.senses.push({
        contractVersion: REG,
        senseId,
        senseKey,
        currentSenseVersionId: senseVersionId,
        currentVersionNumber: 1,
        createdAt: now,
      });
      state.registry.senseVersions.push({
        contractVersion: REG,
        senseVersionId,
        senseId,
        versionNumber: 1,
        origin: 'learner_confirmed',
        semanticPolicyVersion: input.semanticPolicyVersion,
        semanticSpec: cloneSpec(semanticSpec),
        provenance: {
          sourceKind: 'learner_confirmed',
          sourceReferenceIds: [senseProposalVersionId],
          generator: senseGenerator,
        },
        reviewStatus: 'learner_confirmed',
        contentReleaseId: null,
        createdAt: now,
      });
    }

    // 5) Sense confirmation + Alignment facts.
    const senseProposalConfirmationId = ports.newId();
    const senseConfirmation: SensaConfirmSenseProposalFact = {
      contractVersion: PSW,
      senseProposalConfirmationId,
      operationId: input.operationId,
      learnerUserId: LEARNER_USER_ID,
      senseProposalVersionId,
      meaningFocusRevisionId,
      resolution,
      senseId,
      senseVersionId,
      confirmedAt: now,
    };
    record.senseConfirmations.push(senseConfirmation);
    const personalMeaningAlignmentId = ports.newId();
    const alignment: SensaPersonalMeaningAlignmentSnapshot = {
      contractVersion: PSW,
      personalMeaningAlignmentId,
      learnerUserId: LEARNER_USER_ID,
      personalMeaningId: input.personalMeaningId,
      personalMeaningRevisionId: personalMeaningRevision.personalMeaningRevisionId,
      basis: {
        kind: 'sense_construction',
        meaningFocusId,
        meaningFocusRevisionId,
        senseProposalConfirmationId,
      },
      senseId,
      senseVersionId,
      status: 'active',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    record.alignments.push(alignment);
    const alignmentEvent: SensaPersonalMeaningAlignmentEvent = {
      contractVersion: PSW,
      personalMeaningAlignmentEventId: ports.newId(),
      personalMeaningAlignmentId,
      ordinal: 1,
      eventType: 'confirmed',
      operationId: input.operationId,
      reason: null,
      occurredAt: now,
    };
    record.alignmentEvents.push(alignmentEvent);

    // 6) The optional third fact, in the same intent.
    let expressionConfirmed = false;
    if (expressionInput && input.confirmExpression && candidateId) {
      settleExpressionBinding(state,ports,
        record,
        alignment,
        {
          candidateId,
          expressionType: expressionInput.expressionType,
          languageTag: expressionInput.languageTag,
          surfaceForm: expressionInput.surfaceForm,
          personalExpressionAnchorRevisionId: proposalExpressionCandidates.find(
            (candidate) => candidate.candidateId === candidateId,
          )?.personalExpressionAnchorRevisionId ?? null,
        },
        {
          operationId: input.operationId,
          senseVersionId,
          surfaceForm: expressionInput.surfaceForm,
          languageTag: expressionInput.languageTag,
          expressionType: expressionInput.expressionType,
          relation: expressionInput.relation,
          semanticCoverage: expressionInput.semanticCoverage,
        },
        senseProposalVersionId,
      );
      expressionConfirmed = true;
    }

    const result = {
      meaningFocusId,
      senseId,
      senseVersionId,
      personalMeaningAlignmentId,
      resolution,
      expressionConfirmed,
    };
    return result;
}
