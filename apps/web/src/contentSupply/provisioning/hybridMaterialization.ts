import { z } from 'zod';
import {
  SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,
  resourceSupplementRequestSchema,
  resourceSupplementResultSchema,
  sensaLightweightTargetExpressionMaterialSchema,
  type ResourceSupplementRequest,
  type ResourceSupplementResult,
} from '@sensa/contracts/sensa';
import { canonicalJsonDigest, stableUuid } from '@sensa/learning-kernel';

import type { LocalLearningMaterialization } from '../../learning/runtime/localProtocol';
import { validateLightweightInitialMaterialization } from './lightweightInitialContent';
import {assertMaterialAvailableAt} from './materialReadiness';

const revisionSchema = z.object({
  operationId: z.string().uuid(),
  readyAt: z.string().datetime({offset:true}),
  baseContentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  baseMaterializationId: z.string().uuid(),
  response: resourceSupplementResultSchema,
}).strict();

export function supplementRequest(
  material: LocalLearningMaterialization,
  role: ResourceSupplementRequest['role'],
  supportLanguageTag: string,
): ResourceSupplementRequest {
  const expression = sensaLightweightTargetExpressionMaterialSchema.parse(
    material.content.resources.find((resource) => resource.materialRoleKey === 'target_expression')?.contentPayload,
  );
  return resourceSupplementRequestSchema.parse({
    role,
    surface: expression.surface,
    targetLanguageTag: expression.languageTag,
    supportLanguageTag,
    expressionKind: expression.expressionKind,
  });
}

export function baseContentBeforeSupplement(
  material: LocalLearningMaterialization,
  supportLanguageTag?: string,
) {
  const raw = material.snapshot.provenance.resourceSupplement;
  if (!raw) return material.content;
  const revision = revisionSchema.parse(raw);
  const response = revision.response;
  if (response.result.status !== 'available') throw Error('localFlow.resourceInvalid');
  if (canonicalJsonDigest(response.request) !== canonicalJsonDigest(supplementRequest(
    material,
    response.request.role,
    supportLanguageTag ?? response.request.supportLanguageTag,
  ))) throw Error('localFlow.resourceInvalid');
  const added = material.content.resources.filter((resource) => resource.materialRoleKey === response.request.role);
  if (
    added.length !== 1
    || canonicalJsonDigest(added[0]!.contentPayload) !== canonicalJsonDigest(response.result.payload)
    || added[0]!.materialCandidateId !== stableUuid(`supplement:${revision.operationId}`)
    || added[0]!.producerProvider !== response.provider
    || added[0]!.sourceArtifactIds[0] !== `${response.provider}:${response.sourceVersion}`
  ) throw Error('localFlow.resourceInvalid');
  const base = {
    ...material.content,
    resources: material.content.resources.filter((resource) => resource.materialRoleKey !== response.request.role),
  };
  if (canonicalJsonDigest(base) !== revision.baseContentDigest) throw Error('localFlow.resourceInvalid');
  return base;
}

export function appendResourceSupplement(
  base: LocalLearningMaterialization,
  responseInput: ResourceSupplementResult,
  operationId: string,
  at: string,
  supportLanguageTag: string,
): LocalLearningMaterialization {
  validateLightweightInitialMaterialization(base);
  assertMaterialAvailableAt(base,at);
  const response = resourceSupplementResultSchema.parse(responseInput);
  if (response.result.status !== 'available') throw Error('localFlow.resourceInvalid');
  if (canonicalJsonDigest(response.request) !== canonicalJsonDigest(supplementRequest(
    base,
    response.request.role,
    supportLanguageTag,
  ))) throw Error('localFlow.resourceInvalid');
  if (
    base.content.resources.some((resource) => resource.materialRoleKey === response.request.role)
    || base.snapshot.provenance.resourceSupplement
  ) throw Error('localFlow.stepChanged');
  const role = SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.find(
    (candidate) => candidate.materialRoleKey === response.request.role,
  )!;
  if (role.required) throw Error('localFlow.resourceInvalid');
  const resource = {
    resourceKey: `${response.request.role}:0`,
    materialRoleKey: response.request.role,
    ordinal: 0,
    materialCandidateId: stableUuid(`supplement:${operationId}`),
    contentSchemaId: role.contentSchemaId,
    contentSchemaVersion: role.contentSchemaVersion,
    contentPayload: response.result.payload,
    contentDigest: canonicalJsonDigest(response.result.payload),
    sourceArtifactIds: [`${response.provider}:${response.sourceVersion}`],
    sourceMaterialCandidateIds: [],
    productionMethod: 'published_reuse' as const,
    producerProvider: response.provider,
    producerModel: null,
    producerPolicyId: role.provisioningPolicyId,
    producerPolicyVersion: role.provisioningPolicyVersion,
  };
  const content = { ...base.content, resources: [...base.content.resources, resource] };
  const material = {
    content,
    snapshot: {
      ...structuredClone(base.snapshot),
      learningMaterializationId: stableUuid(`supplement-material:${operationId}`),
      createdAt: at,
      contentPayload: content,
      contentDigest: canonicalJsonDigest(content),
      provenance: {
        ...base.snapshot.provenance,
        resourceSupplement: {
          operationId,
          readyAt: at,
          baseContentDigest: base.snapshot.contentDigest,
          baseMaterializationId: base.snapshot.learningMaterializationId,
          response,
        },
      },
    },
  };
  validateLightweightInitialMaterialization(material);
  baseContentBeforeSupplement(material);
  return material;
}

/** Select material for a Step that has not been acted. A compatible publication
 * may explicitly rebind the current Step before its first action. */
export function materialForNextStep(
  current: LocalLearningMaterialization,
  published: LocalLearningMaterialization,
): LocalLearningMaterialization {
  const raw = published.snapshot.provenance.resourceSupplement;
  if (raw && revisionSchema.parse(raw).baseContentDigest === current.snapshot.contentDigest) return current;
  return published;
}
