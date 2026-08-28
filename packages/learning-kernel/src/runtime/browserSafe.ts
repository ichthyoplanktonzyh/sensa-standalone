/**
 * The browser-safe portion of the Sensa V1 runtime kernel.
 *
 * This module is intentionally dependency-free. It must stay free of Node,
 * Postgres, and backend adapter imports so the Web client can use the exact
 * same canonicalization, validation, identity, state projection, and frozen
 * version vocabulary as the backend.
 */

import {
  learningActionPayloadSchema,
  learningResponsePayloadSchema,
} from "./schemas.js";
import type { SensaSemanticPolicyDecisionCode } from "./semanticPolicyVocabulary.js";
import { sensaExecutableLearningCapabilityResolverVersion } from "./executableLearningCapabilityVocabulary.js";

export type SensaMasteryDimension =
  | "grounding"
  | "boundary"
  | "form_mapping"
  | "retrieval"
  | "transfer";

export const sensaRulePacketDimensions = Object.freeze([
  "grounding",
  "boundary",
  "form_mapping",
  "retrieval",
  "transfer",
] as const);

export type SensaRulePacketDimension =
  typeof sensaRulePacketDimensions[number];

export type SensaAcquisitionPrimitive =
  | "visual_grounding"
  | "motion_grounding"
  | "spatial_relation"
  | "causal_sequence"
  | "temporal_sequence"
  | "social_micro_scenario"
  | "introspective_scenario"
  | "contrast_pair"
  | "counterexample"
  | "contextual_variation"
  | "production_cue";

export type SensaScaffoldLevel = "full" | "reduced" | "minimal" | "none";

export type SensaRendererKind = "content" | "single_choice" | "text_input";

export type SensaEncounterStatus =
  | "planned"
  | "active"
  | "completed"
  | "interrupted"
  | "cancelled";

export type SensaPlanningTimeZoneSource =
  | "client"
  | "user_settings"
  | "utc_fallback";

export type MemoryOutcomeKind =
  | "introduced"
  | "retrieval_failed"
  | "supported_retrieval"
  | "independent_retrieval"
  | "transfer_confirmed";

export type ReviewRating = 0 | 1 | 2 | 3;

export const sensaMemoryOutcomeMappingVersion =
  "sensa-memory-outcome-v3" as const;

export const sensaSemanticPolicyVersion = "sensa-semantic-policy-v2" as const;
export const sensaStopPolicyVersion = "sensa-stop-policy-v2" as const;
export const sensaEvidenceRuleV1Version = "sensa-evidence-rule-v1" as const;
export const sensaEvidenceRuleVersion = "sensa-evidence-rule-v2" as const;
export const sensaStateUpdaterV1Version = "sensa-state-updater-v1" as const;
export const sensaStateUpdaterVersion = "sensa-state-updater-v2" as const;
export const sensaMemoryOutcomeVersion = sensaMemoryOutcomeMappingVersion;

export type SensaMemoryOutcomeMappingVersion =
  typeof sensaMemoryOutcomeMappingVersion;

export type SensaEvidenceRuleVersion =
  | typeof sensaEvidenceRuleV1Version
  | typeof sensaEvidenceRuleVersion;

export type SensaStateUpdaterVersion =
  | typeof sensaStateUpdaterV1Version
  | typeof sensaStateUpdaterVersion;

export const sensaPlanningKernelVersionTuple = Object.freeze({
  capabilityResolverVersion: sensaExecutableLearningCapabilityResolverVersion,
  semanticPolicyVersion: sensaSemanticPolicyVersion,
  stopPolicyVersion: sensaStopPolicyVersion,
  evidenceRuleVersion: sensaEvidenceRuleVersion,
  stateUpdaterVersion: sensaStateUpdaterVersion,
  outcomeMappingVersion: sensaMemoryOutcomeVersion,
});

export type SensaPlanningKernelVersionTuple =
  typeof sensaPlanningKernelVersionTuple;

/**
 * A canonical object whose schema version is carried by its owning action or
 * attempt. The digest is always the canonical SHA-256 digest of `object`.
 */
export type CanonicalObjectPayload = Readonly<{
  object: Readonly<Record<string, unknown>>;
  digest: string;
}>;

export type LearningAssetReference = Readonly<{
  learningAssetId: string;
  ordinal: number;
  role: string;
}>;

export type LearningAction = Readonly<{
  learningActionId: string;
  ordinal: number;
  targetDimension: SensaMasteryDimension;
  primitive: SensaAcquisitionPrimitive;
  scaffoldLevel: SensaScaffoldLevel;
  rendererKind: SensaRendererKind;
  semanticPolicyDecisionCode: SensaSemanticPolicyDecisionCode;
  actionSchemaVersion: string;
  evidenceRuleVersion: string;
  actionPayload: CanonicalObjectPayload;
  /** Digest of the complete immutable action and ordered asset references. */
  actionDigest: string;
  assets: ReadonlyArray<LearningAssetReference>;
}>;

export type SensaActionChoice = Readonly<{
  choiceId: "choice_a" | "choice_b";
  text: string;
}>;

export const sensaLearningActionSchemaVersion =
  "sensa-learning-action-v3" as const;
export const sensaLearningResponseSchemaVersion =
  "sensa-learning-response-v1" as const;

export type SensaGroundingBindPayload = Readonly<{
  kind: "grounding_bind";
  schemaVersion: typeof sensaLearningActionSchemaVersion;
}>;

export type SensaBoundaryDiscriminationPayload = Readonly<{
  kind: "boundary_discrimination";
  schemaVersion: typeof sensaLearningActionSchemaVersion;
  choices: readonly [SensaActionChoice, SensaActionChoice];
}>;

export type SensaMeaningToFormRecallPayload = Readonly<{
  kind: "meaning_to_form_recall";
  schemaVersion: typeof sensaLearningActionSchemaVersion;
  prompt: string;
}>;

export type SensaClozeRecallPayload = Readonly<{
  kind: "cloze_recall";
  schemaVersion: typeof sensaLearningActionSchemaVersion;
  exampleAssetId: string;
  maskedText: string;
  contextNovelty: "familiar" | "novel";
}>;

export type SensaRetrievalRepairPayload = Readonly<{
  kind: "retrieval_repair";
  schemaVersion: typeof sensaLearningActionSchemaVersion;
}>;

export type SensaLearningActionPayload =
  | SensaGroundingBindPayload
  | SensaBoundaryDiscriminationPayload
  | SensaMeaningToFormRecallPayload
  | SensaClozeRecallPayload
  | SensaRetrievalRepairPayload;

export type SensaAcknowledgementResponse = Readonly<{
  kind: "acknowledgement";
  acknowledged: true;
}>;

export type SensaSingleChoiceResponse = Readonly<{
  kind: "single_choice";
  choiceId: "choice_a" | "choice_b";
}>;

export type SensaTextInputResponse = Readonly<{
  kind: "text_input";
  answer: string;
}>;

export type SensaLearningResponsePayload =
  | SensaAcknowledgementResponse
  | SensaSingleChoiceResponse
  | SensaTextInputResponse;

export type SensaAttemptEvaluationFacts = Readonly<{
  /** Accepted headword and inflected forms for meaning-to-form recall. */
  acceptedForms: ReadonlyArray<string>;
  /** The immutable Example target for a Cloze Action, when applicable. */
  clozeTarget: string | null;
  /** The choice whose text is the immutable positive Boundary case. */
  boundaryPositiveChoiceId: "choice_a" | "choice_b" | null;
  /** Correctness facts from valid retrieval Attempts before the current one. */
  priorValidRetrievalCorrectness: ReadonlyArray<boolean | null>;
  /** Whether a grounding/repair Action has already been emitted. */
  strongSupportEmitted: boolean;
  /** Retrieval level at the moment the current Action is evaluated. */
  retrievalMasteryLevel: "unknown" | "emerging" | "stable";
}>;

export type SensaAttemptEvaluationInput = Readonly<{
  action: Readonly<{
    payload: SensaLearningActionPayload;
    scaffoldLevel: SensaScaffoldLevel;
  }>;
  responseSchemaVersion: string;
  responseObject: Readonly<Record<string, unknown>>;
  evidenceRuleVersion: SensaEvidenceRuleVersion;
  facts: SensaAttemptEvaluationFacts;
}>;

export type SensaAttemptEvaluation = Readonly<{
  validity: "valid" | "invalid";
  isCorrect: boolean | null;
  evaluationCode: string;
  /** The closed payload exactly as accepted for persistence. */
  acceptedResponse: SensaLearningResponsePayload | null;
  responsePayload: Readonly<Record<string, unknown>>;
  evidence: ReadonlyArray<SensaEvidenceCandidate>;
}>;

export type SensaEncounterCompletionDecisionInput = Readonly<{
  encounterKind: "introduction" | "review";
  action: Readonly<{
    payload: SensaLearningActionPayload;
    scaffoldLevel: SensaScaffoldLevel;
  }>;
  evaluation: Pick<
    SensaAttemptEvaluation,
    "validity" | "isCorrect" | "evidence"
  >;
  priorValidRetrievalCorrectness: ReadonlyArray<boolean | null>;
  strongSupportEmitted: boolean;
}>;

export type SensaEvidencePolarity = "positive" | "negative";

export type SensaEvidenceCandidate = Readonly<{
  dimension: SensaRulePacketDimension;
  polarity: SensaEvidencePolarity;
  contextNovelty: "familiar" | "novel";
  basisCode: string;
}>;

export type SensaSemanticDimensionSnapshot = Readonly<{
  level: "unknown" | "emerging" | "stable";
  positiveCount: number;
  failureStreak: number;
}>;

export type SensaSemanticStateSnapshot = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  grounding: SensaSemanticDimensionSnapshot;
  boundary: SensaSemanticDimensionSnapshot;
  form_mapping: SensaSemanticDimensionSnapshot;
  retrieval: SensaSemanticDimensionSnapshot;
  transfer: SensaSemanticDimensionSnapshot;
  projectionVersion: SensaStateUpdaterVersion;
  revision: number;
  stateDigest: string;
  projectedThroughEvidenceId: string | null;
}>; 

export type SensaEvidenceProjectionFact = Readonly<
  SensaEvidenceCandidate & {
    learningEvidenceId: string;
    evidenceRuleVersion: SensaEvidenceRuleVersion;
  }
>;

const dimensionOrder = new Map<string, number>(
  sensaRulePacketDimensions.map((dimension, index) => [dimension, index]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isChoiceId(value: unknown): value is "choice_a" | "choice_b" {
  return value === "choice_a" || value === "choice_b";
}

function isSchemaVersion(value: unknown, expected: string): boolean {
  return value === expected;
}

/**
 * JSON canonicalization is intentionally narrow and deterministic. It rejects
 * values that JSON.stringify would silently coerce, so an accepted fact can be
 * replayed without changing its digest.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (!isRecord(value)) throw new Error("JSON value is not canonicalizable");
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`
  )).join(",")}}`;
}

export function canonicalizeText(value: string): string {
  return value.normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(
        0xc0 | (codePoint >> 6),
        0x80 | (codePoint & 0x3f),
      );
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Synchronous SHA-256 over UTF-8 bytes, with no platform-specific imports. */
export function sha256(value: string): string {
  const input = utf8Bytes(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  // The message length is encoded as a 64-bit big-endian integer. The high
  // word expression remains exact for all practical JavaScript strings.
  const bitLength = input.length * 8;
  const high = Math.floor(input.length / 0x20000000);
  const low = bitLength >>> 0;
  const lengthOffset = padded.length - 8;
  padded[lengthOffset] = (high >>> 24) & 0xff;
  padded[lengthOffset + 1] = (high >>> 16) & 0xff;
  padded[lengthOffset + 2] = (high >>> 8) & 0xff;
  padded[lengthOffset + 3] = high & 0xff;
  padded[lengthOffset + 4] = (low >>> 24) & 0xff;
  padded[lengthOffset + 5] = (low >>> 16) & 0xff;
  padded[lengthOffset + 6] = (low >>> 8) & 0xff;
  padded[lengthOffset + 7] = low & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);

  for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = blockOffset + index * 4;
      schedule[index] = (
        (padded[offset]! << 24)
        | (padded[offset + 1]! << 16)
        | (padded[offset + 2]! << 8)
        | padded[offset + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const valueA = schedule[index - 15]!;
      const valueB = schedule[index - 2]!;
      const sigma0 = rotateRight(valueA, 7)
        ^ rotateRight(valueA, 18)
        ^ (valueA >>> 3);
      const sigma1 = rotateRight(valueB, 17)
        ^ rotateRight(valueB, 19)
        ^ (valueB >>> 10);
      schedule[index] = (
        schedule[index - 16]!
        + sigma0
        + schedule[index - 7]!
        + sigma1
      ) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6)
        ^ rotateRight(e, 11)
        ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_K[index]! + schedule[index]!) >>> 0;
      const sigma0 = rotateRight(a, 2)
        ^ rotateRight(a, 13)
        ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

export function canonicalJsonDigest(value: unknown): string {
  return sha256(canonicalizeJson(value));
}

/**
 * Legacy V2 Action digest retained only until the in-progress Web rewrite
 * adopts the V3 reason-bearing identity below. New runtime code must not use it.
 */
export function canonicalLearningActionDigest(
  encounterId: string,
  ordinal: number,
  payload: unknown,
  assets: readonly LearningAssetReference[],
): string {
  return canonicalJsonDigest({ encounterId, ordinal, payload, assets });
}

/** V3 Action digest including the immutable Semantic Policy reason. */
export function canonicalLearningActionDigestV3(
  encounterId: string,
  ordinal: number,
  semanticPolicyDecisionCode: SensaSemanticPolicyDecisionCode,
  payload: unknown,
  assets: readonly LearningAssetReference[],
): string {
  return canonicalJsonDigest({
    encounterId,
    ordinal,
    semanticPolicyDecisionCode,
    payload,
    assets,
  });
}

/** Stable UUID derived from a fact identity, with UUID v4/variant bits set. */
export function stableUuid(value: string): string {
  const digest = sha256(value);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseLearningActionPayload(
  value: unknown,
): SensaLearningActionPayload | null {
  const result = learningActionPayloadSchema.safeParse(value);
  return result.success ? (result.data as SensaLearningActionPayload) : null;
}

export function parseLearningResponsePayload(
  value: unknown,
): SensaLearningResponsePayload | null {
  const result = learningResponsePayloadSchema.safeParse(value);
  return result.success ? (result.data as SensaLearningResponsePayload) : null;
}

function invalidAttemptEvaluation(
  responseObject: Readonly<Record<string, unknown>>,
  evaluationCode: string,
): SensaAttemptEvaluation {
  return {
    validity: "invalid",
    isCorrect: null,
    evaluationCode,
    acceptedResponse: null,
    responsePayload: responseObject,
    evidence: [],
  };
}

/**
 * Evaluate one already closed response using only immutable runtime facts.
 *
 * The caller must provide the approved content facts required by the Action
 * kind. The Backend adapter remains responsible for loading those facts and
 * failing closed on missing or tampered assets; this function deliberately
 * knows nothing about SQL rows or content storage.
 */
export function evaluateSensaAttempt(
  input: SensaAttemptEvaluationInput,
): SensaAttemptEvaluation {
  if (input.responseSchemaVersion !== sensaLearningResponseSchemaVersion) {
    return invalidAttemptEvaluation(
      input.responseObject,
      "response_version_unsupported",
    );
  }
  const response = parseLearningResponsePayload(input.responseObject);
  if (response === null) {
    return invalidAttemptEvaluation(input.responseObject, "response_schema_invalid");
  }

  const payload = input.action.payload;
  if (payload.kind === "grounding_bind" || payload.kind === "retrieval_repair") {
    if (response.kind !== "acknowledgement") {
      return invalidAttemptEvaluation(input.responseObject, "response_schema_invalid");
    }
    return {
      validity: "valid",
      isCorrect: null,
      evaluationCode: "acknowledged",
      acceptedResponse: response,
      responsePayload: response,
      evidence: [],
    };
  }

  if (payload.kind === "boundary_discrimination") {
    if (response.kind !== "single_choice") {
      return invalidAttemptEvaluation(input.responseObject, "response_schema_invalid");
    }
    if (input.facts.boundaryPositiveChoiceId === null) {
      throw new Error("Boundary evaluation requires its immutable positive choice");
    }
    const isCorrect = response.choiceId === input.facts.boundaryPositiveChoiceId;
    return {
      validity: "valid",
      isCorrect,
      evaluationCode: isCorrect ? "boundary_correct" : "boundary_incorrect",
      acceptedResponse: response,
      responsePayload: response,
      evidence: [{
        dimension: "boundary",
        polarity: isCorrect ? "positive" : "negative",
        contextNovelty: "familiar",
        basisCode: `boundary_discrimination.${isCorrect ? "correct" : "incorrect"}`,
      }],
    };
  }

  if (response.kind !== "text_input") {
    return invalidAttemptEvaluation(input.responseObject, "response_schema_invalid");
  }
  const normalizedAnswer = canonicalizeText(response.answer);
  let isCorrect = false;
  let basis = "meaning_to_form";
  let contextNovelty: "familiar" | "novel" = "familiar";
  if (payload.kind === "meaning_to_form_recall") {
    isCorrect = input.facts.acceptedForms.some(
      (form) => canonicalizeText(form) === normalizedAnswer,
    );
  } else {
    if (input.facts.clozeTarget === null) {
      throw new Error("Cloze evaluation requires its immutable target form");
    }
    isCorrect = canonicalizeText(input.facts.clozeTarget) === normalizedAnswer;
    basis = "cloze";
    contextNovelty = payload.contextNovelty;
  }

  const correctness = isCorrect ? "correct" : "incorrect";
  const meaningToFormDimensions = input.evidenceRuleVersion === sensaEvidenceRuleV1Version
    || isCorrect
    ? ["grounding", "form_mapping", "retrieval"] as const
    : ["form_mapping", "retrieval"] as const;
  const evidence: SensaEvidenceCandidate[] = payload.kind === "meaning_to_form_recall"
    ? meaningToFormDimensions.map((dimension) => ({
      dimension,
      polarity: isCorrect ? "positive" : "negative",
      contextNovelty,
      basisCode: `${basis}.${correctness}`,
    }))
    : ["form_mapping", "retrieval"].map((dimension) => ({
      dimension: dimension as SensaRulePacketDimension,
      polarity: isCorrect ? "positive" : "negative",
      contextNovelty,
      basisCode: `${basis}.${correctness}`,
    }));

  if (
    payload.kind === "cloze_recall"
    && payload.contextNovelty === "novel"
    && input.action.scaffoldLevel === "none"
    && input.facts.priorValidRetrievalCorrectness.length === 0
    && !input.facts.strongSupportEmitted
    && dimensionIsAtLeastEmerging(input.facts.retrievalMasteryLevel)
  ) {
    evidence.push({
      dimension: "transfer",
      polarity: isCorrect ? "positive" : "negative",
      contextNovelty: "novel",
      basisCode: `novel_cloze.${correctness}`,
    });
  }

  return {
    validity: "valid",
    isCorrect,
    evaluationCode: `${basis}_${correctness}`,
    acceptedResponse: response,
    responsePayload: response,
    evidence,
  };
}

export function createEvidenceId(
  attemptId: string,
  dimension: SensaRulePacketDimension,
  evidenceRuleVersion: string,
  basisCode: string,
): string {
  return stableUuid(`${attemptId}\n${dimension}\n${evidenceRuleVersion}\n${basisCode}`);
}

function initialDimension(): SensaSemanticDimensionSnapshot {
  return { level: "unknown", positiveCount: 0, failureStreak: 0 };
}

export function emptySemanticState(
  workspaceId: string,
  learnerUserId: string,
  senseId: string,
  projectionVersion: SensaStateUpdaterVersion = sensaStateUpdaterVersion,
): SensaSemanticStateSnapshot {
  const state = {
    workspaceId,
    learnerUserId,
    senseId,
    grounding: initialDimension(),
    boundary: initialDimension(),
    form_mapping: initialDimension(),
    retrieval: initialDimension(),
    transfer: initialDimension(),
    projectionVersion,
    revision: 1,
    stateDigest: "",
    projectedThroughEvidenceId: null,
  };
  return { ...state, stateDigest: createStateDigest(state) };
}

function updateDimension(
  current: SensaSemanticDimensionSnapshot,
  polarity: SensaEvidencePolarity,
  stateUpdaterVersion: SensaStateUpdaterVersion,
): SensaSemanticDimensionSnapshot {
  if (polarity === "positive") {
    const positiveCount = current.positiveCount + 1;
    return {
      level: positiveCount >= 2 ? "stable" : "emerging",
      positiveCount,
      failureStreak: 0,
    };
  }
  const failureStreak = current.failureStreak + 1;
  if (stateUpdaterVersion === sensaStateUpdaterVersion) {
    return {
      level: failureStreak >= 2
        ? "unknown"
        : current.level === "stable" ? "emerging" : current.level,
      positiveCount: current.positiveCount,
      failureStreak,
    };
  }
  return {
    level: failureStreak >= 2 ? "unknown" : "emerging",
    positiveCount: current.positiveCount,
    failureStreak,
  };
}

export function applyEvidenceToSemanticState(
  current: SensaSemanticStateSnapshot,
  evidence: readonly SensaEvidenceCandidate[],
  projectedThroughEvidenceId: string | null,
  stateUpdaterVersion: SensaStateUpdaterVersion = current.projectionVersion,
): SensaSemanticStateSnapshot {
  const next = { ...current } as {
    -readonly [K in keyof SensaSemanticStateSnapshot]: SensaSemanticStateSnapshot[K];
  };
  const ordered = [...evidence].sort((left, right) => (
    (dimensionOrder.get(left.dimension) ?? Number.MAX_SAFE_INTEGER)
      - (dimensionOrder.get(right.dimension) ?? Number.MAX_SAFE_INTEGER)
  ));
  for (const item of ordered) {
    next[item.dimension] = updateDimension(
      next[item.dimension],
      item.polarity,
      stateUpdaterVersion,
    );
  }
  next.projectionVersion = stateUpdaterVersion;
  next.revision = current.revision + 1;
  next.projectedThroughEvidenceId = projectedThroughEvidenceId;
  next.stateDigest = createStateDigest(next);
  return next;
}

/**
 * Rebuild the learner-by-Sense projection from immutable Evidence facts.
 *
 * V2 deliberately consumes the complete stream instead of mutating a V1
 * snapshot in place. It also excludes the legacy V1 Grounding-negative row
 * produced by an incorrect meaning-to-form Attempt: that response observes a
 * failed form recovery, not failed comprehension of the Sense cue.
 */
export function rebuildSemanticState(
  input: Readonly<{
    workspaceId: string;
    learnerUserId: string;
    senseId: string;
    evidence: readonly SensaEvidenceProjectionFact[];
    projectionVersion?: SensaStateUpdaterVersion;
    revision?: number;
  }>,
): SensaSemanticStateSnapshot {
  const projectionVersion = input.projectionVersion ?? sensaStateUpdaterVersion;
  let state = emptySemanticState(
    input.workspaceId,
    input.learnerUserId,
    input.senseId,
    projectionVersion,
  );
  for (const fact of input.evidence) {
    const isLegacyOverreach = projectionVersion === sensaStateUpdaterVersion
      && fact.evidenceRuleVersion === sensaEvidenceRuleV1Version
      && fact.dimension === "grounding"
      && fact.polarity === "negative"
      && fact.basisCode === "meaning_to_form.incorrect";
    state = applyEvidenceToSemanticState(
      state,
      isLegacyOverreach ? [] : [fact],
      fact.learningEvidenceId,
      projectionVersion,
    );
  }
  if (input.revision === undefined || input.revision === state.revision) {
    return state;
  }
  return { ...state, revision: input.revision };
}

export function createStateDigest(
  state: Pick<
    SensaSemanticStateSnapshot,
    | "workspaceId"
    | "learnerUserId"
    | "senseId"
    | "projectionVersion"
    | "grounding"
    | "boundary"
    | "form_mapping"
    | "retrieval"
    | "transfer"
    | "projectedThroughEvidenceId"
  >,
): string {
  const lines = [
    `workspace=${state.workspaceId}`,
    `learner=${state.learnerUserId}`,
    `sense=${state.senseId}`,
    `projection=${state.projectionVersion}`,
    ...sensaRulePacketDimensions.map((dimension) => {
      const value = state[dimension];
      return `${dimension}=${value.level},${value.positiveCount},${value.failureStreak}`;
    }),
    `projectedThroughEvidenceId=${state.projectedThroughEvidenceId ?? ""}`,
  ];
  return sha256(lines.join("\n"));
}

export function isRetrievalAction(
  payload: SensaLearningActionPayload,
): boolean {
  return payload.kind === "meaning_to_form_recall" || payload.kind === "cloze_recall";
}

export function isStrongSupportScaffold(level: SensaScaffoldLevel): boolean {
  return level === "full" || level === "reduced";
}

export function dimensionIsAtLeastEmerging(
  level: "unknown" | "emerging" | "stable",
): boolean {
  return level === "emerging" || level === "stable";
}

export function assertRulePacketDimension(
  value: string,
): asserts value is SensaMasteryDimension {
  if (!dimensionOrder.has(value)) throw new Error(`Unsupported mastery dimension: ${value}`);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Memory Outcome kind: ${String(value)}`);
}

export function mapMemoryOutcomeToFsrsRating(
  kind: MemoryOutcomeKind,
): ReviewRating | null {
  switch (kind) {
    case "introduced":
      return null;
    case "retrieval_failed":
      return 0;
    case "supported_retrieval":
      return 1;
    case "independent_retrieval":
      return 2;
    case "transfer_confirmed":
      return 3;
    default:
      return assertNever(kind);
  }
}

export type SensaTypedLearningAction = Readonly<{
  action: LearningAction;
  payload: SensaLearningActionPayload;
}>;
