import assert from "node:assert/strict";
import type {
  SensaSyncAppendFact,
  SensaSyncV2Operation,
  SensaSyncV2OperationResult,
} from "@sensa/contracts/sensa";
import {
  canonicalJsonDigest,
  canonicalLearningActionDigestV3,
  learningActionSchema,
  parseLearningActionPayload,
  parseLearningResponsePayload,
  sensaEvidenceRuleVersion,
  sensaLearningActionSchemaVersion,
} from "@sensa/learning-kernel";
import { resolveActionView } from "../apps/web/src/features/study/resolveActionView.ts";
import {
  nextAttemptOrdinal,
  shouldQueueTerminalCompletion,
  unresolvedAttemptOperations,
} from "../apps/web/src/features/study/lifecycle.ts";
import {
  createDeclaredMasteryOperation,
  masteryMutationIdentity,
} from "../apps/web/src/features/mastery/declaredMastery.ts";
import type { SensaLocalSnapshot } from "../apps/web/src/store.ts";

const digest = "a".repeat(64);
const payload = { kind: "grounding_bind" as const, schemaVersion: sensaLearningActionSchemaVersion };
const ids = ["experience", "bridge", "example-1", "example-2", "example-3", "pronunciation", "audio-1", "audio-2", "audio-3"];
const roles = ["experience_sketch", "l1_bridge", "study_example", "study_example", "study_example", "pronunciation", "study_example_audio", "study_example_audio", "study_example_audio"];
const references = ids.map((learningAssetId, index) => ({ learningAssetId, ordinal: index + 1, role: roles[index]! }));
const action = {
  learningActionId: "action-1",
  ordinal: 1,
  targetDimension: "grounding" as const,
  primitive: "visual_grounding" as const,
  scaffoldLevel: "full" as const,
  rendererKind: "content" as const,
  semanticPolicyDecisionCode: "introduction_grounding" as const,
  actionSchemaVersion: sensaLearningActionSchemaVersion,
  evidenceRuleVersion: sensaEvidenceRuleVersion,
  actionPayload: { object: payload, digest: canonicalJsonDigest(payload) },
  actionDigest: canonicalLearningActionDigestV3(
    "encounter-1",
    1,
    "introduction_grounding",
    payload,
    references,
  ),
  assets: references,
};

assert.equal(learningActionSchema.safeParse(action).success, true);
assert.equal(learningActionSchema.safeParse({ ...action, assets: references.slice(0, 8) }).success, false);
assert.deepEqual(parseLearningActionPayload(payload), payload);
assert.equal(parseLearningActionPayload({ ...payload, schemaVersion: "sensa-learning-action-v1" }), null);
assert.deepEqual(parseLearningResponsePayload({ kind: "acknowledgement", acknowledged: true }), { kind: "acknowledgement", acknowledged: true });
assert.equal(parseLearningResponsePayload({ kind: "acknowledgement", acknowledged: false }), null);

const assetBase = (learningAssetId: string, senseVersionId = "sense-version") => ({
  learningAssetId,
  contentReleaseId: "release-1",
  senseVersionId,
  learnerLocale: "zh-Hans",
  contentDigest: digest,
  reviewStatus: "approved" as const,
  provenance: { sourceEvidenceRefs: ["evidence-1"], generatorProvider: null, generatorModel: null, promptVersion: null, sourceLicense: null, sourceAttribution: null },
});
const example = (learningAssetId: string, ordinal: number) => ({
  ...assetBase(learningAssetId), kind: "example" as const, ordinal, textL2: `The target word appears ${ordinal}.`, textL1: `中文${ordinal}`, targetForm: "target", targetStart: 4, targetEnd: 10,
  construction: "head_verb" as const, sceneDomain: "daily_life" as const, disambiguatingCue: "cue", collocations: [], variationNote: "variation", role: "study" as const, contextL2: null, contextL1: null,
});
const item = {
  packageDigest: digest,
  contentRelease: { contentReleaseId: "release-1", releaseKey: "r1", versionNumber: 1, targetLanguage: "en", learnerLocale: "zh-Hans", schemaVersion: "v1", sourceDigest: digest, validatorVersion: "v1", status: "published" as const },
  lexeme: {
    lexemeVersionId: "lexeme-version",
    lexemeId: "lexeme-1",
    languageTag: "en",
    lemma: "target",
    forms: ["target"],
    ipaUs: "ˈtɑːrɡɪt",
    ipaUk: "ˈtɑːɡɪt",
    syllables: "tar·get",
  },
  sense: { senseVersionId: "sense-version", senseId: "sense-1", senseKey: "target.1", senseRank: 1, partOfSpeech: "v.", guideLabelL1: "目标", definitionL2: "to target", teachingPriority: "core" as const, reviewStatus: "approved" as const },
  relations: [], usagePatterns: [{ patternId: "pattern-1", pattern: "target", translation: "目标", notes: null }], acquisitionProfile: {},
  learningAssets: [
    { ...assetBase("experience"), kind: "experience_sketch" as const, body: "A person points at a clear destination." },
    { ...assetBase("bridge"), kind: "l1_bridge" as const, body: "把注意力连到目标上。" },
    example("example-1", 1), example("example-2", 2), example("example-3", 3),
    { ...assetBase("pronunciation", "sense-version"), kind: "pronunciation_audio" as const, senseVersionId: null, lexemeVersionId: "lexeme-version", learnerLocale: null, media: { mediaBlobId: "media-1", sha256: digest, mimeType: "audio/mpeg", sizeBytes: 1 }, sourceExampleAssetId: null, accentLocale: "en-US", provider: null, model: null, voice: null, sourceTextDigest: digest, durationMs: 100 },
    ...[1, 2, 3].map((number) => ({ ...assetBase(`audio-${number}`), kind: "study_example_audio" as const, media: { mediaBlobId: `media-${number + 1}`, sha256: digest, mimeType: "audio/mpeg", sizeBytes: 1 }, sourceExampleAssetId: `example-${number}`, accentLocale: "en-US", provider: "local", model: "local", voice: "local", sourceTextDigest: digest, durationMs: 100 })),
  ],
  requiredAssetManifest: {},
} as const;

const valid = resolveActionView(action, item, "encounter-1");
assert.equal(valid.valid, true);
if (valid.valid) assert.equal(valid.orderedStudyExamples.length, 3);

const malformed = { ...action, assets: references.map((reference) => reference.learningAssetId === "audio-2" ? { ...reference, learningAssetId: "audio-1" } : reference) };
assert.equal(resolveActionView(malformed, item, "encounter-1").valid, false);
const leaked = { ...item, learningAssets: item.learningAssets.map((asset) => asset.learningAssetId === "experience" ? { ...asset, body: "target appears here" } : asset) } as typeof item;
assert.equal(resolveActionView(action, leaked, "encounter-1").valid, false);

// Attempt ordinals are scoped to one immutable Action. A new Action starts at
// one, while an invalid same-Action attempt resumes at the next ordinal.
const emptyLifecycle = { appendFacts: [], outbox: [] } as const;
assert.equal(nextAttemptOrdinal(emptyLifecycle, "action-2"), 1);
const priorAttempt = {
  factSequence: "fact-1",
  factType: "learning_attempt",
  factId: "attempt-1",
  occurredAt: new Date().toISOString(),
  fact: { learningActionId: "action-1", ordinal: 1 },
} as unknown as SensaSyncAppendFact;
assert.equal(nextAttemptOrdinal({ appendFacts: [priorAttempt], outbox: [] }, "action-1"), 2);
const retryOperation = {
  operationId: "attempt-2",
  occurredAt: new Date().toISOString(),
  kind: "learning_attempt.record",
  learningAttemptId: "attempt-2",
  senseEncounterId: "encounter-1",
  learningActionId: "action-1",
  ordinal: 2,
  responseSchemaVersion: "sensa-learning-response-v1",
  responsePayload: { object: { kind: "text_input", answer: "" }, digest },
  durationMs: null,
} as unknown as SensaSyncV2Operation;
assert.equal(unresolvedAttemptOperations({ appendFacts: [], outbox: [{ operation: retryOperation, status: "failed" }] }, "action-1").length, 1);
assert.equal(unresolvedAttemptOperations({ appendFacts: [], outbox: [{ operation: retryOperation, status: "conflict" }] }, "action-1").length, 1);

const terminalResult = {
  operationId: "attempt-terminal",
  status: "applied",
  acknowledged: true,
  errorCode: null,
  resultDigest: digest,
  mutableCursor: null,
  factCursor: "fact-2",
  payload: {
    kind: "learning_attempt",
    fact: { senseEncounterId: "encounter-1" },
    nextAction: null,
  },
} as unknown as SensaSyncV2OperationResult;
assert.equal(shouldQueueTerminalCompletion({ attemptResult: terminalResult, encounterStatus: "active", existingOperations: [] }), true);
const completionOperation = {
  operationId: "complete-1",
  occurredAt: new Date().toISOString(),
  kind: "sense_encounter.complete",
  senseEncounterId: "encounter-1",
  expectedRevision: 1,
} as unknown as SensaSyncV2Operation;
assert.equal(shouldQueueTerminalCompletion({ attemptResult: terminalResult, encounterStatus: "active", existingOperations: [completionOperation] }), false);

// Offline mastery changes form one ordered, idempotent chain. The second
// intent reuses the first intent's immutable ID and advances its revision.
const scope = { workspaceId: "workspace-1", learnerUserId: "learner-1", replicaId: "b6c1ae55-968a-4d8a-9e92-04a7e95fb9b2" };
const baseMasterySnapshot = { masteries: [], outbox: [] } as unknown as SensaLocalSnapshot;
const firstIdentity = masteryMutationIdentity(baseMasterySnapshot, "sense-1");
const firstMastery = createDeclaredMasteryOperation({ scope, senseId: "sense-1", isMastered: true, entityId: firstIdentity.entityId, expectedRevision: firstIdentity.expectedRevision, encounter: null });
const pendingTrue = { operation: firstMastery, status: "pending" as const, occurredAt: firstMastery.occurredAt };
const chainedSnapshot = { masteries: [], outbox: [pendingTrue] } as unknown as SensaLocalSnapshot;
const secondIdentity = masteryMutationIdentity(chainedSnapshot, "sense-1");
assert.equal(secondIdentity.entityId, firstIdentity.entityId);
assert.equal(secondIdentity.expectedRevision, 1);
const secondMastery = createDeclaredMasteryOperation({ scope, senseId: "sense-1", isMastered: false, entityId: secondIdentity.entityId, expectedRevision: secondIdentity.expectedRevision, encounter: null });
const replaySnapshot = { masteries: [], outbox: [{ operation: secondMastery, status: "failed" as const, occurredAt: secondMastery.occurredAt }, pendingTrue] } as unknown as SensaLocalSnapshot;
const replayIdentity = masteryMutationIdentity(replaySnapshot, "sense-1");
assert.equal(replayIdentity.entityId, firstIdentity.entityId);
assert.equal(replayIdentity.expectedRevision, 2);
const authoritativeMastery = {
  learnerDeclaredMasteryId: firstIdentity.entityId,
  senseId: "sense-1",
  revision: 1,
  isMastered: true,
} as const;
const revoke = createDeclaredMasteryOperation({
  scope,
  senseId: "sense-1",
  isMastered: false,
  entityId: authoritativeMastery.learnerDeclaredMasteryId,
  expectedRevision: authoritativeMastery.revision,
  encounter: null,
});
const revokeSnapshot = {
  masteries: [authoritativeMastery],
  outbox: [{ operation: revoke, status: "failed" as const, occurredAt: revoke.occurredAt }],
} as unknown as SensaLocalSnapshot;
const restoreIdentity = masteryMutationIdentity(revokeSnapshot, "sense-1");
assert.equal(restoreIdentity.entityId, authoritativeMastery.learnerDeclaredMasteryId);
assert.equal(restoreIdentity.expectedRevision, 2);
const conflictedSnapshot = {
  masteries: [authoritativeMastery],
  outbox: [{ operation: revoke, status: "conflict" as const, occurredAt: revoke.occurredAt }],
} as unknown as SensaLocalSnapshot;
const recoveredIdentity = masteryMutationIdentity(conflictedSnapshot, "sense-1");
assert.equal(recoveredIdentity.entityId, authoritativeMastery.learnerDeclaredMasteryId);
assert.equal(recoveredIdentity.expectedRevision, authoritativeMastery.revision);

console.log("Sensa runtime contract smoke passed");
