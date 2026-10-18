/** Material anchors and Personal Meaning creation facts. No IO or commit ownership. */
import type {SensaIntakePayload,SensaIntakeContext,SensaPersonalMeaningRevisionSnapshot} from '@sensa/contracts/sensa';
import type {JourneyState,MeaningJourneyRecord} from './store';
import type {JourneyFactPorts,CommandLanguages} from './ports';
import type {MaterialBlockInput,CreatePersonalMeaningInput,CreatePersonalMeaningResult} from './types';
import {referencedContextFacts} from './contextFacts';
const PSW='sensa-personal-semantic-world-v3' as const,LEARNER_USER_ID='sensa-local-learner';
type PersonalProvenanceKind=SensaPersonalMeaningRevisionSnapshot['provenance']['kind'];
const normalizedForm=(surfaceForm:string,languageTag:string)=>surfaceForm.trim().toLocaleLowerCase(languageTag);
export const contextProvenanceKind = (
  context: SensaIntakeContext | null | undefined,
): PersonalProvenanceKind => context?.source?.client === 'sensa-web' || !context?.source
  ? 'learner_authored'
  : 'imported';

export interface MeaningCreationFactsOptions{intake?:SensaIntakePayload|null;completedContext?:SensaIntakeContext|null;contextWordingSource?:'learner_authored'|'llm_suggested'}
export function appendMaterialAnchor(
  ports:JourneyFactPorts,
  record: MeaningJourneyRecord,
  operationId: string,
  block: MaterialBlockInput,
  intake: SensaIntakePayload | null = null,
  completedContext: SensaIntakeContext | null = intake?.context ?? null,
): { anchorId: string; anchorRevisionId: string } {
  const now = ports.nowIso();
  const anchorId = ports.newId();
  const anchorRevisionId = ports.newId();
  const isImage = block.kind === 'image';
  const bodyText = block.bodyText?.trim() ?? '';
  if (isImage) {
    if (!block.personalMediaObjectId) {
      throw new Error('图片材料块必须引用本地媒体对象。');
    }
  } else if (!bodyText) {
    throw new Error('文字材料块不能为空。');
  }
  record.personalSemanticAnchors.push({
    contractVersion: PSW,
    personalSemanticAnchorId: anchorId,
    personalMeaningId: record.personalMeaning.personalMeaningId,
    currentRevision: 1,
    lifecycleRevision: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedByOperationId: null,
  });
  record.personalSemanticAnchorRevisions.push({
    contractVersion: PSW,
    personalSemanticAnchorRevisionId: anchorRevisionId,
    personalSemanticAnchorId: anchorId,
    revision: 1,
    anchorKind: isImage ? 'image' : 'text',
    languageTag: isImage ? null : completedContext?.languageTag ?? null,
    bodyText: isImage ? null : bodyText,
    personalMediaObjectId: isImage ? block.personalMediaObjectId! : null,
    structuredPayload: intake ? {
      intake: {
        contractVersion: intake.contractVersion,
        operationId: intake.operationId,
        capturedAt: intake.capturedAt,
        contextSource: intake.context?.source ?? null,
        contextLanguageTag: intake.context?.languageTag ?? null,
        contextLanguageObservation:intake.context?.languageObservation??null,
        mediaReferenceIds: intake.context?.mediaReferenceIds ?? [],
        completedContextSource: completedContext?.source ?? null,
        completedContextLanguageTag: completedContext?.languageTag ?? null,
        completedContextLanguageObservation:completedContext?.languageObservation??null,
        expression: intake.expression,
        contextText: intake.context?.textSegment ?? null,
        senseCandidate: intake.sense,
        submittedAcceptance: intake.acceptance,
      },
    } : {},
    provenance: {
      kind: contextProvenanceKind(completedContext),
      sourceReferenceIds: intake
        ? [
            intake.operationId,
            intake.context?.source?.sourceReferenceId,
            completedContext?.source?.sourceReferenceId,
          ]
          .filter((value): value is string => Boolean(value))
        : [anchorId],
      createdByOperationId: operationId,
    },
    createdAt: now,
  });
  return { anchorId, anchorRevisionId };
}

export function createPersonalMeaningFacts(state:JourneyState,ports:JourneyFactPorts,input:CreatePersonalMeaningInput,languages:CommandLanguages,options:MeaningCreationFactsOptions={}):Omit<CreatePersonalMeaningResult,'replayed'>{
    const familiarSurface = input.familiarExpression?.surfaceForm.trim() ?? '';
    if (input.familiarExpression && !familiarSurface) {
      throw new Error('熟悉表达不能为空。');
    }
    const blocks = input.blocks ?? [];
    if (blocks.length === 0 && !familiarSurface&&!input.contextReferences?.length&&!input.learnerIntentNote?.trim()&&!input.draftExpression?.surfaceForm.trim()) {
      throw new Error('个人意义至少需要一个材料块或一个熟悉表达。');
    }

    // Read once, before any fact exists: this creation operation uses one
    // resolved language context throughout.
    const personalMeaningId = ports.newId();
    const personalMeaningRevisionId = ports.newId();
    const now = ports.nowIso();
    const familiarExpressionAnchorId = familiarSurface ? ports.newId() : null;
    const familiarExpressionAnchorRevisionId = familiarSurface ? ports.newId() : null;

    const firstText = input.learnerIntentNote?.trim()||blocks.find((block) => block.kind === 'text')?.bodyText?.trim()||input.contextReferences?.map(ref=>state.contexts.anchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===ref.revisionId)?.bodyText).find(Boolean)||'';
    const record: MeaningJourneyRecord = {
      personalMeaning: {
        contractVersion: PSW,
        personalMeaningId,
        learnerUserId: LEARNER_USER_ID,
        currentRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      },
      personalMeaningRevisions: [],
      personalSemanticAnchors: [],
      personalSemanticAnchorRevisions: [],
      personalExpressionAnchors: [],
      personalExpressionAnchorRevisions: [],
      focuses: [],
      focusRevisions: [],
      focusAcceptances: [],
      constructions: [],
      constructionTurns: [],
      proposals: [],
      proposalVersions: [],
      senseConfirmations: [],
      semanticAcceptances: [],
      alignments: [],
      alignmentEvents: [],
      bindingConfirmations: [],
      mockState: {
        focusAspectLabels: {},
        startingPoint: input.startingPoint ?? null,
      },
    };

    if (familiarSurface && familiarExpressionAnchorId && familiarExpressionAnchorRevisionId) {
      record.personalExpressionAnchors.push({
        contractVersion: PSW,
        personalExpressionAnchorId: familiarExpressionAnchorId,
        personalMeaningId,
        currentRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: familiarExpressionAnchorRevisionId,
        personalExpressionAnchorId: familiarExpressionAnchorId,
        revision: 1,
        // Provisional classification: the composer deliberately does not ask
        // for one, and the model refines it during clarification.
        expressionType: 'phrase',
        languageTag: languages.supportLanguageTag,
        surfaceForm: familiarSurface,
        normalizedForm: normalizedForm(familiarSurface, languages.supportLanguageTag),
        contextAnchorRevisionId: null,
        occurrence: null,
        provenanceKind: 'learner_authored',
        verificationStatus: 'unverified',
        provenance: {
          kind: 'learner_authored',
          sourceReferenceIds: [familiarExpressionAnchorId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }
    const blockAnchors = blocks.map((block,index) => {
      const sourceText=index===0&&block.kind==='text'?options.intake?.context?.textSegment:null;
      const rewritten=Boolean(sourceText&&sourceText!==block.bodyText?.trim());
      const original=appendMaterialAnchor(ports,record,input.operationId,
        rewritten?{...block,bodyText:sourceText!}:block,options.intake??null,
        rewritten?options.intake!.context:options.completedContext??options.intake?.context??null,
      );
      if(rewritten){
        const sourceRevision=record.personalSemanticAnchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===original.anchorRevisionId)!;
        const anchor=record.personalSemanticAnchors.find(row=>row.personalSemanticAnchorId===original.anchorId)!;
        const now=ports.nowIso();
        // Preserve the captured version for occurrence locators. The accepted
        // clarified Context is a new revision, never a replacement of its source.
        record.personalSemanticAnchorRevisions.push({
          ...sourceRevision,personalSemanticAnchorRevisionId:ports.newId(),revision:2,
          bodyText:block.bodyText!.trim(),languageTag:options.completedContext?.languageTag??null,
          structuredPayload:{...sourceRevision.structuredPayload,intake:{
            ...(sourceRevision.structuredPayload.intake as Record<string,unknown>),
            completedContextSource:options.completedContext?.source??null,
            completedContextLanguageTag:options.completedContext?.languageTag??null,
            completedContextLanguageObservation:options.completedContext?.languageObservation??null,
          }},provenance:{...sourceRevision.provenance,
            kind:options.contextWordingSource??sourceRevision.provenance.kind,
            sourceReferenceIds:[sourceRevision.personalSemanticAnchorRevisionId],
          },createdAt:now,
        });
        anchor.currentRevision=2;anchor.updatedAt=now;
      }
      return original;
    });
    const referenced=input.contextReferences??[];
    if(new Set(referenced.map(ref=>ref.contextId)).size!==referenced.length)throw Error('semantic_context_invalid');
    for(const ref of referenced){const {head,revisions,selected}=referencedContextFacts(state,ref);const {learnerUserId:_,currentRevisionId:__,conflictHistory:___,...association}=head;record.personalSemanticAnchors.push({...association,personalMeaningId,currentRevision:selected.revision});record.personalSemanticAnchorRevisions.push(...revisions);blockAnchors.push({anchorId:ref.contextId,anchorRevisionId:ref.revisionId});}

    // A captured Expression belongs to the same Context even while its Sense
    // is unresolved. Preserve the exact occurrence as an unverified source
    // Anchor; learner confirmation later promotes this Anchor instead of
    // manufacturing a source-less duplicate.
    const capturedExpression = options.intake?.expression;
    const capturedLocator=capturedExpression?.occurrence?.locator;
    const capturedContextAnchor=capturedLocator?.kind==='media_region'
      ? blockAnchors[blocks.findIndex(block=>block.personalMediaObjectId===capturedLocator.mediaReferenceId)]
      : blockAnchors[0];
    let capturedExpressionAnchorId: string | null = null;
    if (
      capturedExpression?.occurrence
      && capturedExpression.languageTag
      && capturedContextAnchor
    ) {
      const anchorId = ports.newId();
      const anchorRevisionId = ports.newId();
      capturedExpressionAnchorId = anchorId;
      const sourceKind = contextProvenanceKind(
        options.completedContext ?? options.intake?.context,
      );
      record.personalExpressionAnchors.push({
        contractVersion: PSW,
        personalExpressionAnchorId: anchorId,
        personalMeaningId,
        currentRevision: 1,
        lifecycleRevision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByOperationId: null,
      });
      record.personalExpressionAnchorRevisions.push({
        contractVersion: PSW,
        personalExpressionAnchorRevisionId: anchorRevisionId,
        personalExpressionAnchorId: anchorId,
        revision: 1,
        expressionType: capturedExpression.expressionTypeHint ?? 'word',
        languageTag: capturedExpression.languageTag,
        surfaceForm: capturedExpression.surfaceForm,
        normalizedForm: normalizedForm(capturedExpression.surfaceForm, capturedExpression.languageTag),
        contextAnchorRevisionId: capturedContextAnchor.anchorRevisionId,
        occurrence: capturedExpression.occurrence.locator,
        provenanceKind: sourceKind,
        verificationStatus: 'unverified',
        provenance: {
          kind: sourceKind,
          sourceReferenceIds: [options.intake!.operationId],
          createdByOperationId: input.operationId,
        },
        createdAt: now,
      });
    }

    record.personalMeaningRevisions.push({
      contractVersion: PSW,
      personalMeaningRevisionId,
      personalMeaningId,
      revision: 1,
      displayLabel: familiarSurface
        || (firstText.length > 24 ? `${firstText.slice(0, 24)}…` : firstText)
        || '我的个人意义',
      learnerIntentNote: input.learnerIntentNote?.trim()||null,
      ...(input.draftExpression?{draftExpression:input.draftExpression}:{}),
      provenance: {
        kind: 'learner_authored',
        sourceReferenceIds: [
          familiarExpressionAnchorId,
          ...blockAnchors.map((anchor) => anchor.anchorId),
          capturedExpressionAnchorId,
        ].filter((id): id is string => id !== null),
        createdByOperationId: input.operationId,
      },
      createdAt: now,
    });

    state.meanings.push(record);
    const result = {
      personalMeaningId,
      personalMeaningRevisionId,
      familiarExpressionAnchorId,
    };
    return result;
}
