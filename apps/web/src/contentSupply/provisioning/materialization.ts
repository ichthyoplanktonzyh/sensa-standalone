import {
  LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
  sensaLearningConnectionContractVersion,
  sensaLearningMaterializationSnapshotSchema,
} from '@sensa/contracts/sensa';
import { canonicalJsonDigest, stableUuid } from '@sensa/learning-kernel';

import type { InstalledPackage } from '../../data/library/packageRecords';
import type { ContentProvisioningSource } from './contracts';
import type { LocalLearningMaterialization } from '../../learning/runtime/localProtocol';
import {
  validateLightweightInitialMaterialization,
  type LightweightInitialLearningMaterialization,
} from './lightweightInitialContent';

type PublishedEntry = InstalledPackage['content']['entries'][number];

/** Content Supply is the only production owner that assembles immutable materializations. */
export function materializePublishedEntry(input: {
  learnerUserId: string;
  learningTargetId: string;
  packageKey: string;
  installedPackage: InstalledPackage;
  entry: PublishedEntry;
  createdAt: string;
}): LocalLearningMaterialization {
  const { installedPackage: pack, entry } = input;
  const packageManifest=pack.portableOrigin.manifest;
  const content = structuredClone(entry.content);
  const snapshot = sensaLearningMaterializationSnapshotSchema.parse({
    contractVersion: sensaLearningConnectionContractVersion,
    learningMaterializationId: stableUuid(
      `sensa-material:${input.learnerUserId}:${input.packageKey}:${input.learningTargetId}`,
    ),
    learnerUserId: input.learnerUserId,
    learningTargetId: input.learningTargetId,
    protocolPurpose: 'initial_learning',
    provisioningPath: 'published',
    contentSchemaVersion: LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
    contentPayload: content,
    contentDigest: canonicalJsonDigest(content),
    validationStatus: 'validated',
    validatorVersion: 'sensa-web-package-v1',
    provenance: {
      packageKey: input.packageKey,
      bookId: packageManifest.metadata.packageId,
      bookVersionId: null,
      contentReleaseId: null,
      packageVersion: String(packageManifest.metadata.version),
      packageDigest: pack.digest,
      senseId: entry.senseId,
      senseVersionId: entry.senseVersionId,
      bindingId: entry.bindingId,
      bindingVersionId: entry.bindingVersionId,
    },
    personalAnchorUseGrantIds: [],
    createdAt: input.createdAt,
  });
  const material = { snapshot, content };
  validateLightweightInitialMaterialization(material);
  return material;
}

export function materializeOnDemandContent(input: {
  learnerUserId: string;
  learningTargetId: string;
  source: ContentProvisioningSource;
  content: LightweightInitialLearningMaterialization['content'];
  attemptId: string;
  personalAnchorUseGrantId: string | null;
  createdAt: string;
}): LocalLearningMaterialization {
  const { reference } = input.source;
  const provenance=input.source.sourceKind==='stable_sense'
    ?{kind:'stable_sense',curriculumEnrollmentId:input.source.reference.enrollmentId,sourceDigest:input.source.reference.sourceDigest}
    :{personalMeaningId:input.source.reference.personalMeaningId,personalMeaningRevisionId:input.source.reference.personalMeaningRevisionId,alignmentBasisReferenceId:input.source.reference.alignmentBasisReferenceId};
  if(input.source.sourceKind==='stable_sense'&&input.personalAnchorUseGrantId!==null)throw new Error('localFlow.meaningChanged');
  const content = structuredClone(input.content);
  const snapshot = sensaLearningMaterializationSnapshotSchema.parse({
    contractVersion: sensaLearningConnectionContractVersion,
    learningMaterializationId: stableUuid(`sensa-personal-material:${input.attemptId}`),
    learnerUserId: input.learnerUserId,
    learningTargetId: input.learningTargetId,
    protocolPurpose: 'initial_learning',
    provisioningPath: 'on_demand',
    contentSchemaVersion: LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,
    contentPayload: content,
    contentDigest: canonicalJsonDigest(content),
    validationStatus: 'validated',
    validatorVersion: 'sensa-web-content-v1',
    provenance: {
      ...provenance,
      senseId: reference.senseId,
      senseVersionId: reference.senseVersionId,
      bindingId: reference.bindingId,
      bindingVersionId: reference.bindingVersionId,
      attemptId: input.attemptId,
    },
    personalAnchorUseGrantIds: input.personalAnchorUseGrantId
      ? [input.personalAnchorUseGrantId]
      : [],
    createdAt: input.createdAt,
  });
  const material = { snapshot, content };
  validateLightweightInitialMaterialization(material);
  return material;
}
