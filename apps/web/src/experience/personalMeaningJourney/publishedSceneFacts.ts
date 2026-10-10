/** Admit fixed published semantic versions and construct learner scene revisions. */
import type {SensaExpressionVersionSnapshot,SensaSenseExpressionBindingVersionSnapshot,SensaSenseSnapshot,SensaSenseVersionSnapshot} from '@sensa/contracts/sensa';
import {publishedLearningSemanticFactsSchema} from '@sensa/contracts/sensa';
import type {JourneyState} from './store';
import type {JourneyFactPorts} from './ports';
import type {PublishedLearningSceneAcceptanceInput} from './types';
import {isUuid} from './ids';
import {digestOf} from './digest';
const PSW='sensa-personal-semantic-world-v3' as const,REG='sensa-semantic-registry-v1' as const;
const normalizedForm=(surfaceForm:string,languageTag:string)=>surfaceForm.trim().toLocaleLowerCase(languageTag);

export function installPublishedLearningFacts(state:JourneyState,input: PublishedLearningSceneAcceptanceInput): void {
  const semantic = publishedLearningSemanticFactsSchema.parse(input.semantic);
  const { source, target } = input;
  for (const value of [
    source.bookId, source.bookVersionId, source.contentReleaseId,
    target.learningTargetId, target.curriculumMembershipId, target.senseId,
    target.senseVersionId, target.bindingId, target.bindingVersionId,
    semantic.expressionId, semantic.expressionVersionId,
  ]) if (!isUuid(value)) throw new Error('学习包语义身份无效。');
  if (!Number.isFinite(Date.parse(source.publishedAt)) || !target.expression.trim()
    || !target.targetLanguageTag.trim()) throw new Error('学习包语义来源无效。');

  const sourceReferenceIds = [source.contentReleaseId, source.bookVersionId, source.packageKey];
  const semanticProvenance = {
    sourceKind: 'published_release' as const,
    sourceReferenceIds,
    generator: null,
  };
  const senseVersion: SensaSenseVersionSnapshot = {
    contractVersion: REG,
    senseVersionId: target.senseVersionId,
    senseId: target.senseId,
    versionNumber: semantic.senseVersionNumber,
    origin: 'published_release',
    semanticPolicyVersion: semantic.semanticPolicyVersion,
    semanticSpec: structuredClone(semantic.semanticSpec),
    provenance: semanticProvenance,
    reviewStatus: 'reviewed',
    contentReleaseId: source.contentReleaseId,
    createdAt: source.publishedAt,
  };
  const expressionVersion: SensaExpressionVersionSnapshot = {
    contractVersion: REG,
    expressionVersionId: semantic.expressionVersionId,
    expressionId: semantic.expressionId,
    versionNumber: semantic.expressionVersionNumber,
    surfaceForm: target.expression.trim(),
    normalizedForm: normalizedForm(target.expression, target.targetLanguageTag),
    structure: structuredClone(semantic.expressionStructure),
    provenance: semanticProvenance,
    createdAt: source.publishedAt,
  };
  const bindingVersion: SensaSenseExpressionBindingVersionSnapshot = {
    contractVersion: REG,
    bindingVersionId: target.bindingVersionId,
    senseExpressionBindingId: target.bindingId,
    versionNumber: semantic.bindingVersionNumber,
    senseVersionId: target.senseVersionId,
    expressionVersionId: semantic.expressionVersionId,
    semanticCoverage: semantic.semanticCoverage,
    registerLabel: semantic.registerLabel,
    usageConstraints: [...semantic.usageConstraints],
    provenance: semanticProvenance,
    reviewStatus: 'reviewed',
    createdAt: source.publishedAt,
  };

  const existingSenseByKey = state.registry.senses.find((fact) => fact.senseKey === semantic.senseKey);
  if (existingSenseByKey && existingSenseByKey.senseId !== target.senseId) {
    throw new Error('学习包 Sense key 与本机语义注册表冲突。');
  }
  const existingSense = state.registry.senses.find((fact) => fact.senseId === target.senseId);
  if (existingSense) {
    if (existingSense.senseKey !== semantic.senseKey) throw new Error('学习包 Sense identity 冲突。');
    if (semantic.senseVersionNumber > existingSense.currentVersionNumber) {
      state.registry.senses[state.registry.senses.indexOf(existingSense)]={
        ...existingSense,
        currentVersionNumber:semantic.senseVersionNumber,
        currentSenseVersionId:target.senseVersionId,
      };
    }
  } else {
    state.registry.senses.push({
      contractVersion: REG,
      senseId: target.senseId,
      senseKey: semantic.senseKey,
      currentSenseVersionId: target.senseVersionId,
      currentVersionNumber: semantic.senseVersionNumber,
      createdAt: source.publishedAt,
    } satisfies SensaSenseSnapshot);
  }
  const existingSenseVersion = state.registry.senseVersions.find((fact) => fact.senseVersionId === target.senseVersionId);
  if (existingSenseVersion) {
    if (digestOf({senseId:existingSenseVersion.senseId,versionNumber:existingSenseVersion.versionNumber,semanticPolicyVersion:existingSenseVersion.semanticPolicyVersion,semanticSpec:existingSenseVersion.semanticSpec,reviewStatus:existingSenseVersion.reviewStatus})
      !== digestOf({senseId:senseVersion.senseId,versionNumber:senseVersion.versionNumber,semanticPolicyVersion:senseVersion.semanticPolicyVersion,semanticSpec:senseVersion.semanticSpec,reviewStatus:senseVersion.reviewStatus})) throw new Error('学习包 Sense Version 冲突。');
  } else state.registry.senseVersions.push(senseVersion);

  const existingExpression = state.registry.expressions.find((fact) => fact.expressionId === semantic.expressionId);
  if (existingExpression) {
    if (existingExpression.expressionType !== semantic.expressionType
      || existingExpression.languageTag !== target.targetLanguageTag) throw new Error('学习包 Expression identity 冲突。');
    if (semantic.expressionVersionNumber > existingExpression.currentVersionNumber) {
      state.registry.expressions[state.registry.expressions.indexOf(existingExpression)]={
        ...existingExpression,
        currentVersionNumber:semantic.expressionVersionNumber,
        currentExpressionVersionId:semantic.expressionVersionId,
      };
    }
  } else {
    state.registry.expressions.push({
      contractVersion: REG,
      expressionId: semantic.expressionId,
      expressionType: semantic.expressionType,
      languageTag: target.targetLanguageTag,
      lexemeId: null,
      currentExpressionVersionId: semantic.expressionVersionId,
      currentVersionNumber: semantic.expressionVersionNumber,
      createdAt: source.publishedAt,
    });
  }
  const existingExpressionVersion = state.registry.expressionVersions.find((fact) => fact.expressionVersionId === semantic.expressionVersionId);
  if (existingExpressionVersion) {
    if (digestOf({expressionId:existingExpressionVersion.expressionId,versionNumber:existingExpressionVersion.versionNumber,surfaceForm:existingExpressionVersion.surfaceForm,normalizedForm:existingExpressionVersion.normalizedForm,structure:existingExpressionVersion.structure})
      !== digestOf({expressionId:expressionVersion.expressionId,versionNumber:expressionVersion.versionNumber,surfaceForm:expressionVersion.surfaceForm,normalizedForm:expressionVersion.normalizedForm,structure:expressionVersion.structure})) throw new Error('学习包 Expression Version 冲突。');
  } else state.registry.expressionVersions.push(expressionVersion);

  const existingBinding = state.registry.bindings.find((fact) => fact.senseExpressionBindingId === target.bindingId);
  if (existingBinding) {
    if (existingBinding.senseId !== target.senseId
      || existingBinding.expressionId !== semantic.expressionId
      || existingBinding.relation !== semantic.relation) throw new Error('学习包 Binding identity 冲突。');
    if (semantic.bindingVersionNumber > existingBinding.currentVersionNumber) {
      state.registry.bindings[state.registry.bindings.indexOf(existingBinding)]={
        ...existingBinding,
        currentVersionNumber:semantic.bindingVersionNumber,
        currentBindingVersionId:target.bindingVersionId,
      };
    }
  } else {
    state.registry.bindings.push({
      contractVersion: REG,
      senseExpressionBindingId: target.bindingId,
      senseId: target.senseId,
      expressionId: semantic.expressionId,
      relation: semantic.relation,
      currentBindingVersionId: target.bindingVersionId,
      currentVersionNumber: semantic.bindingVersionNumber,
      createdAt: source.publishedAt,
    });
  }
  const existingBindingVersion = state.registry.bindingVersions.find((fact) => fact.bindingVersionId === target.bindingVersionId);
  if (existingBindingVersion) {
    if (digestOf({senseExpressionBindingId:existingBindingVersion.senseExpressionBindingId,versionNumber:existingBindingVersion.versionNumber,senseVersionId:existingBindingVersion.senseVersionId,expressionVersionId:existingBindingVersion.expressionVersionId,semanticCoverage:existingBindingVersion.semanticCoverage,registerLabel:existingBindingVersion.registerLabel,usageConstraints:existingBindingVersion.usageConstraints,reviewStatus:existingBindingVersion.reviewStatus})
      !== digestOf({senseExpressionBindingId:bindingVersion.senseExpressionBindingId,versionNumber:bindingVersion.versionNumber,senseVersionId:bindingVersion.senseVersionId,expressionVersionId:bindingVersion.expressionVersionId,semanticCoverage:bindingVersion.semanticCoverage,registerLabel:bindingVersion.registerLabel,usageConstraints:bindingVersion.usageConstraints,reviewStatus:bindingVersion.reviewStatus})) throw new Error('学习包 Binding Version 冲突。');
  } else state.registry.bindingVersions.push(bindingVersion);
}

export function learningSceneAnchorRevision(
  ports:JourneyFactPorts,
  anchorId: string,
  revision: number,
  input: PublishedLearningSceneAcceptanceInput,
  revisionId = ports.newId(),
) {
  const now = ports.nowIso();
  return {
    contractVersion: PSW,
    personalSemanticAnchorRevisionId: revisionId,
    personalSemanticAnchorId: anchorId,
    revision,
    anchorKind: 'scene' as const,
    languageTag: null,
    bodyText: input.scene.body.trim() || null,
    personalMediaObjectId: null,
    structuredPayload: {
      learningScene: {
        sceneId: input.scene.sceneId,
        revisionId: input.scene.revisionId,
        revision: input.scene.revision,
        learningTargetId: input.target.learningTargetId,
        curriculumMembershipId: input.target.curriculumMembershipId,
      },
      media: structuredClone(input.scene.media),
      publishedSource: structuredClone(input.source),
    },
    provenance: {
      kind: 'learner_authored' as const,
      sourceReferenceIds: [input.scene.revisionId, input.source.contentReleaseId],
      createdByOperationId: input.operationId,
    },
    createdAt: now,
  };
}
