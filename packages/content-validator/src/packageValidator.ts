import { createHash } from "node:crypto";
import {
  sensaExecutableLearningCapabilityModule,
  sensaExecutableLearningCapabilityResolverVersion,
} from "@sensa/learning-kernel";
import type {
  SensaCapabilityAssetSnapshot,
} from "@sensa/learning-kernel";

export const sensaPackageValidatorVersion = "sensa-package-validator-v3" as const;

export type PackageValidationStatus = "incomplete" | "satisfied" | "invalid";
export type ContentReviewStatus = "draft" | "approved" | "rejected";
export type ContentReleaseStatus = "draft" | "approved" | "published" | "superseded";
export type RelationScope = "intra_word" | "cross_word";
export type TeachingPriority = "core" | "extended" | "recognition";
export type ExampleRole = "study" | "quiz";
export type ExampleConstruction =
  | "head_verb"
  | "nonfinite_verb"
  | "passive"
  | "subject"
  | "object"
  | "prep_object"
  | "predicative"
  | "modifier"
  | "adverbial";
export type SceneDomain =
  | "daily_life"
  | "work_business"
  | "study_school"
  | "social_relations"
  | "media_news"
  | "travel_transport"
  | "health_body"
  | "tech_digital"
  | "nature_environment"
  | "arts_leisure";
export type AcquisitionNeed =
  | "perceptual_grounding"
  | "boundary_formation"
  | "abstraction_invariant"
  | "spatial_aspectual_tuning"
  | "social_normative_calibration"
  | "form_binding";
export type AcquisitionPrimitive =
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
export type AssetKind =
  | "experience_sketch"
  | "l1_bridge"
  | "example"
  | "pronunciation_audio"
  | "study_example_audio"
  | "boundary_note"
  | "contrast_pair"
  | "counterexample"
  | "visual_grounding"
  | "spatial_diagram"
  | "causal_sequence"
  | "temporal_sequence"
  | "extended_audio";
export type AssetCapability =
  | "meaning_grounding"
  | "l1_mediation"
  | "usage_pattern"
  | "contextual_variation"
  | "pronunciation"
  | "study_example_audio"
  | "boundary_contrast"
  | "counterexample"
  | "visual_grounding"
  | "spatial_grounding"
  | "causal_grounding"
  | "temporal_grounding"
  | "extended_audio";

export interface ContentReleaseCandidate {
  readonly contentReleaseId: string;
  readonly targetLanguage: string;
  readonly learnerLocale: string;
  readonly schemaVersion: string;
  readonly status?: ContentReleaseStatus;
  readonly validatorVersion?: string | null;
}

export interface LexemeVersionCandidate {
  readonly contentReleaseId: string;
  readonly lexemeVersionId: string;
  readonly lexemeId: string;
  readonly languageTag: string;
  readonly lemma: string;
  readonly forms: readonly string[];
  readonly pronunciationSourceDigest?: string | null;
}

export interface SenseVersionCandidate {
  readonly contentReleaseId: string;
  readonly senseVersionId: string;
  readonly senseId: string;
  readonly lexemeId: string;
  readonly senseRank: number;
  readonly partOfSpeech: string;
  readonly guideLabelL1: string;
  readonly definitionL2: string;
  readonly teachingPriority?: TeachingPriority;
  readonly reviewStatus: ContentReviewStatus;
}

export interface SenseRelationCandidate {
  readonly contentReleaseId: string;
  readonly senseRelationId: string;
  readonly sourceSenseId: string;
  readonly targetSenseId: string;
  readonly sourceLexemeId: string;
  readonly targetLexemeId: string;
  readonly relationType: string;
  readonly scope: RelationScope;
  readonly distinguishingFeature: string;
  readonly sourceEvidenceRefs: readonly string[];
  readonly reviewStatus: ContentReviewStatus;
}

export interface UsagePatternCandidate {
  readonly contentReleaseId: string;
  readonly usagePatternId: string;
  readonly senseVersionId: string;
  readonly ordinal: number;
  readonly canonicalPattern: string;
  readonly commonCollocations: readonly string[];
  readonly registerLabel?: string | null;
  readonly domainLabel?: string | null;
  readonly usageRestriction?: string | null;
  readonly sourceEvidenceRefs: readonly string[];
  readonly exampleAssetIds?: readonly string[];
  readonly reviewStatus: ContentReviewStatus;
}

export interface ProfileBoundaryTargetCandidate {
  readonly senseRelationId: string;
  readonly ordinal: number;
  readonly isRequired: boolean;
}

export interface AcquisitionProfileCandidate {
  readonly contentReleaseId: string;
  readonly acquisitionProfileId: string;
  readonly senseVersionId: string;
  readonly learnerLocale: string;
  readonly schemaVersion: string;
  readonly acquisitionNeeds: readonly AcquisitionNeed[];
  readonly minimumSufficientExperience: string;
  readonly distinguishingFeatures: readonly string[];
  readonly preferredPrimitives: readonly AcquisitionPrimitive[];
  readonly requiredAssetCapabilities: readonly AssetCapability[];
  readonly optionalAssetCapabilities: readonly AssetCapability[];
  readonly fallbackPrimitives: readonly AcquisitionPrimitive[];
  readonly domainBound: boolean;
  readonly domainConstraints: readonly string[];
  readonly boundaryTargets: readonly ProfileBoundaryTargetCandidate[];
  readonly reviewStatus: ContentReviewStatus;
}

interface LearningAssetBase {
  readonly learningAssetId: string;
  readonly contentReleaseId: string;
  readonly reviewStatus: ContentReviewStatus;
  readonly contentDigest: string;
  readonly sourceEvidenceRefs: readonly string[];
  readonly learnerLocale?: string | null;
  readonly generatorProvider?: string | null;
  readonly generatorModel?: string | null;
  readonly promptVersion?: string | null;
  readonly sourceLicense?: string | null;
  readonly sourceAttribution?: string | null;
}

export interface TextAssetCandidate extends LearningAssetBase {
  readonly kind: "experience_sketch" | "l1_bridge" | "boundary_note";
  readonly senseVersionId: string;
  readonly body: string;
  readonly senseRelationId?: string | null;
}

export interface ExampleAssetCandidate extends LearningAssetBase {
  readonly kind: "example";
  readonly senseVersionId: string;
  readonly ordinal: number;
  readonly textL2: string;
  readonly textL1: string;
  readonly targetForm: string;
  readonly targetStart: number;
  readonly targetEnd: number;
  readonly construction: ExampleConstruction;
  readonly sceneDomain: SceneDomain;
  readonly disambiguatingCue?: string | null;
  readonly collocations?: readonly string[];
  readonly variationNote?: string | null;
  readonly role: ExampleRole;
  readonly contextL2?: string | null;
  readonly contextL1?: string | null;
}

export interface ContrastCaseAssetCandidate extends LearningAssetBase {
  readonly kind: "contrast_pair" | "counterexample";
  readonly senseVersionId: string;
  readonly senseRelationId: string;
  readonly positiveTextL2: string;
  readonly positiveTextL1: string;
  readonly negativeTextL2: string;
  readonly negativeTextL1: string;
  readonly distinguishingFeature: string;
}

export interface VisualAssetCandidate extends LearningAssetBase {
  readonly kind: "visual_grounding";
  readonly senseVersionId: string;
  readonly mediaBlobId: string;
  readonly mediaSha256: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly altText: string;
  readonly distinguishingFeature: string;
  readonly sourceLicense: string;
  readonly sourceAttribution: string;
}

export interface DiagramAssetCandidate extends LearningAssetBase {
  readonly kind: "spatial_diagram";
  readonly senseVersionId: string;
  readonly figureLabel: string;
  readonly groundLabel: string;
  readonly pathDescription: string;
  readonly topology: string;
  readonly textFallback: string;
  readonly startDescription?: string | null;
  readonly endpointDescription?: string | null;
  readonly contrastRelationId?: string | null;
}

export interface SequenceAssetStepCandidate {
  readonly ordinal: number;
  readonly label: string;
  readonly description: string;
}

export interface SequenceAssetCandidate extends LearningAssetBase {
  readonly kind: "causal_sequence" | "temporal_sequence";
  readonly senseVersionId: string;
  readonly textFallback: string;
  readonly steps: readonly SequenceAssetStepCandidate[];
}

export interface AudioAssetCandidate extends LearningAssetBase {
  readonly kind: "pronunciation_audio" | "study_example_audio" | "extended_audio";
  readonly senseVersionId?: string | null;
  readonly lexemeVersionId?: string | null;
  readonly mediaBlobId: string;
  readonly mediaSha256: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sourceExampleAssetId?: string | null;
  readonly accentLocale?: string | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly voice?: string | null;
  readonly sourceTextDigest: string;
  readonly durationMs: number;
}

export type LearningAssetCandidate =
  | TextAssetCandidate
  | ExampleAssetCandidate
  | ContrastCaseAssetCandidate
  | VisualAssetCandidate
  | DiagramAssetCandidate
  | SequenceAssetCandidate
  | AudioAssetCandidate;

export interface SenseLearningPackageCandidate {
  readonly release: ContentReleaseCandidate;
  readonly lexemeVersion: LexemeVersionCandidate;
  readonly senseVersion: SenseVersionCandidate;
  readonly relations: readonly SenseRelationCandidate[];
  readonly usagePatterns: readonly UsagePatternCandidate[];
  readonly profile: AcquisitionProfileCandidate;
  readonly assets: readonly LearningAssetCandidate[];
}

export interface PackageValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface PackageValidationRequirement {
  readonly key: string;
  readonly capability: AssetCapability;
  readonly requiredCount: number;
  readonly matchedResourceIds: readonly string[];
  readonly status: PackageValidationStatus;
}

export interface PackageValidationResult {
  readonly status: PackageValidationStatus;
  readonly validatorVersion: typeof sensaPackageValidatorVersion;
  readonly capabilityResolverVersion: typeof sensaExecutableLearningCapabilityResolverVersion;
  readonly packageDigest: string;
  readonly requirements: readonly PackageValidationRequirement[];
  readonly issues: readonly PackageValidationIssue[];
}

type IssueSeverity = "invalid" | "incomplete";

interface InternalIssue extends PackageValidationIssue {
  readonly severity: IssueSeverity;
}

class IssueCollector {
  private readonly values: InternalIssue[] = [];

  add(severity: IssueSeverity, code: string, path: string, message: string): void {
    if (this.values.some((issue) => (
      issue.severity === severity
      && issue.code === code
      && issue.path === path
      && issue.message === message
    ))) {
      return;
    }
    this.values.push({ severity, code, path, message });
  }

  get hasInvalid(): boolean {
    return this.values.some((issue) => issue.severity === "invalid");
  }

  get hasIncomplete(): boolean {
    return this.values.some((issue) => issue.severity === "incomplete");
  }

  sorted(): readonly InternalIssue[] {
    return [...this.values].sort(compareIssues);
  }
}

interface RequirementDraft {
  readonly key: string;
  readonly capability: AssetCapability;
  readonly requiredCount: number;
  readonly matchedResourceIds: readonly string[];
  readonly status: PackageValidationStatus;
}

const assetKinds = new Set<AssetKind>([
  "experience_sketch",
  "l1_bridge",
  "example",
  "pronunciation_audio",
  "study_example_audio",
  "boundary_note",
  "contrast_pair",
  "counterexample",
  "visual_grounding",
  "spatial_diagram",
  "causal_sequence",
  "temporal_sequence",
  "extended_audio",
]);

const assetCapabilities = new Set<AssetCapability>([
  "meaning_grounding",
  "l1_mediation",
  "usage_pattern",
  "contextual_variation",
  "pronunciation",
  "study_example_audio",
  "boundary_contrast",
  "counterexample",
  "visual_grounding",
  "spatial_grounding",
  "causal_grounding",
  "temporal_grounding",
  "extended_audio",
]);

const relationScopes = new Set<RelationScope>(["intra_word", "cross_word"]);
const exampleRoles = new Set<ExampleRole>(["study", "quiz"]);
const exampleConstructions = new Set<ExampleConstruction>([
  "head_verb",
  "nonfinite_verb",
  "passive",
  "subject",
  "object",
  "prep_object",
  "predicative",
  "modifier",
  "adverbial",
]);
const sceneDomains = new Set<SceneDomain>([
  "daily_life",
  "work_business",
  "study_school",
  "social_relations",
  "media_news",
  "travel_transport",
  "health_body",
  "tech_digital",
  "nature_environment",
  "arts_leisure",
]);
const acquisitionNeeds = new Set<AcquisitionNeed>([
  "perceptual_grounding",
  "boundary_formation",
  "abstraction_invariant",
  "spatial_aspectual_tuning",
  "social_normative_calibration",
  "form_binding",
]);
const acquisitionPrimitives = new Set<AcquisitionPrimitive>([
  "visual_grounding",
  "motion_grounding",
  "spatial_relation",
  "causal_sequence",
  "temporal_sequence",
  "social_micro_scenario",
  "introspective_scenario",
  "contrast_pair",
  "counterexample",
  "contextual_variation",
  "production_cue",
]);

const conditionalCapabilityKinds = new Map<AssetCapability, readonly AssetKind[]>([
  ["meaning_grounding", ["experience_sketch"]],
  ["l1_mediation", ["l1_bridge"]],
  ["usage_pattern", []],
  ["contextual_variation", ["example"]],
  ["pronunciation", ["pronunciation_audio"]],
  ["study_example_audio", ["study_example_audio"]],
  // V3 only counts Assets that the current boundary_discrimination Action can
  // execute. A boundary_note remains valid content, but cannot satisfy an
  // interactive contrast requirement by itself.
  ["boundary_contrast", ["contrast_pair", "counterexample"]],
  ["counterexample", ["counterexample"]],
  ["visual_grounding", ["visual_grounding"]],
  ["spatial_grounding", ["spatial_diagram"]],
  ["causal_grounding", ["causal_sequence"]],
  ["temporal_grounding", ["temporal_sequence"]],
  ["extended_audio", ["extended_audio"]],
]);

const boundaryAssetKinds = new Set<AssetKind>([
  "boundary_note",
  "contrast_pair",
  "counterexample",
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(left: PackageValidationIssue, right: PackageValidationIssue): number {
  return compareStrings(left.code, right.code)
    || compareStrings(left.path, right.path)
    || compareStrings(left.message, right.message);
}

function compareRequirements(left: RequirementDraft, right: RequirementDraft): number {
  return compareStrings(left.key, right.key);
}

function compareCanonicalObjects(left: object, right: object): number {
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].map((value) => value.trim()).sort(compareStrings);
}

function nonEmptyText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== "";
}

function isPlaceholder(value: string | null | undefined): boolean {
  if (value == null || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "todo"
    || normalized === "tbd"
    || normalized === "placeholder"
    || normalized === "pending"
    || normalized === "n/a"
    || normalized === "na"
    || normalized === "null"
    || /^<[^>]+>$/.test(normalized);
}

function isSha256Digest(value: string | null | undefined): boolean {
  return value !== null
    && value !== undefined
    && /^[0-9a-f]{64}$/.test(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedNullable(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : value;
}

function containsWholeWord(text: string, needle: string): boolean {
  if (needle.trim() === "") return false;
  const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "iu").test(text);
}

function countWholeWord(text: string, needle: string): number {
  if (needle.trim() === "") return 0;
  const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "giu"))].length;
}

function mergedWholeWordSpans(text: string, needles: readonly string[]): readonly [number, number][] {
  const spans = needles.flatMap((needle) => {
    if (needle.trim() === "") return [];
    const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...text.matchAll(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "giu"))]
      .flatMap((match) => match.index === undefined ? [] : [[match.index, match.index + match[0].length] as [number, number]]);
  }).sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const previous = merged.at(-1);
    if (previous !== undefined && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isAssetKind(value: string): value is AssetKind {
  return assetKinds.has(value as AssetKind);
}

function isAssetCapability(value: string): value is AssetCapability {
  return assetCapabilities.has(value as AssetCapability);
}

function checkEnumArray<T extends string>(
  issues: IssueCollector,
  values: readonly T[],
  allowed: ReadonlySet<T>,
  path: string,
  code: string,
): boolean {
  let valid = true;
  if (hasDuplicate(values)) {
    issues.add("invalid", `${code}.duplicate`, path, "Enum arrays must not contain duplicate values.");
    valid = false;
  }
  if (values.some((value) => !allowed.has(value))) {
    issues.add("invalid", `${code}.unknown`, path, "The array contains a value outside the frozen vocabulary.");
    valid = false;
  }
  return valid;
}

function addTextIssue(
  issues: IssueCollector,
  value: string | null | undefined,
  path: string,
  code: string,
  severity: IssueSeverity = "invalid",
): void {
  if (isPlaceholder(value)) {
    issues.add(severity, code, path, "Content must be non-empty and cannot be a placeholder.");
  }
}

function checkReviewStatus(
  issues: IssueCollector,
  value: ContentReviewStatus,
  path: string,
): boolean {
  if (value === "approved") return true;
  if (value === "rejected") {
    issues.add("invalid", "review.rejected", path, "Rejected content cannot satisfy a publishable package.");
  } else if (value === "draft") {
    issues.add("incomplete", "review.not_approved", path, "Content must be approved before publication.");
  } else {
    issues.add("invalid", "review.invalid_status", path, "Content has an unknown review status.");
  }
  return false;
}

function checkReleaseIdentity(
  issues: IssueCollector,
  expectedReleaseId: string,
  actualReleaseId: string,
  path: string,
): boolean {
  if (expectedReleaseId === actualReleaseId) return true;
  issues.add("invalid", "release.cross_release_reference", path, "Referenced content belongs to a different Content Release.");
  return false;
}

function checkTextArray(
  issues: IssueCollector,
  values: readonly string[],
  path: string,
  code: string,
): boolean {
  if (values.length === 0 || values.some((value) => !nonEmptyText(value) || isPlaceholder(value))) {
    issues.add("invalid", code, path, "The array must contain non-empty, non-placeholder text values.");
    return false;
  }
  return true;
}

function checkMediaMetadata(
  issues: IssueCollector,
  asset: VisualAssetCandidate | AudioAssetCandidate,
  path: string,
  mediaTypePrefix: "image" | "audio",
): void {
  if (!isSha256Digest(asset.mediaSha256)) {
    issues.add("invalid", "media.digest_invalid", `${path}.mediaSha256`, "Media sha256 must be lowercase SHA-256 hex.");
  }
  const mimePattern = mediaTypePrefix === "image" ? /^image\/[^\s;]+$/i : /^audio\/[^\s;]+$/i;
  if (!mimePattern.test(asset.mimeType)) {
    issues.add("invalid", "media.mime_type_invalid", `${path}.mimeType`, `Media mimeType must be ${mediaTypePrefix}/*.`);
  }
  if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    issues.add("invalid", "media.size_invalid", `${path}.sizeBytes`, "Media sizeBytes must be a positive integer.");
  }
}

function hasCompleteTuple(values: readonly (string | null | undefined)[]): boolean {
  return values.every((value) => nonEmptyText(value) && !isPlaceholder(value));
}

function hasAnyTupleValue(values: readonly (string | null | undefined)[]): boolean {
  return values.some((value) => nonEmptyText(value));
}

function checkGeneratorProvenance(
  issues: IssueCollector,
  asset: LearningAssetCandidate,
  path: string,
): void {
  const values = [asset.generatorProvider, asset.generatorModel, asset.promptVersion];
  const complete = hasCompleteTuple(values);
  if (hasAnyTupleValue(values) && !complete) {
    issues.add("invalid", "provenance.generator_tuple_incomplete", path, "Generator provider, model, and prompt version must be supplied together.");
  }
  if ((asset.kind === "experience_sketch" || asset.kind === "l1_bridge" || asset.kind === "example") && !complete) {
    issues.add("invalid", "provenance.generator_required", path, "V1 Experience Sketch, L1 Bridge, and Example assets require complete generator provenance.");
  }
}

function checkSourceProvenanceTuple(
  issues: IssueCollector,
  asset: LearningAssetCandidate,
  path: string,
): void {
  const values = [asset.sourceLicense, asset.sourceAttribution];
  if (hasAnyTupleValue(values) && !hasCompleteTuple(values)) {
    issues.add("invalid", "provenance.source_tuple_incomplete", path, "Source license and attribution must be supplied together.");
  }
}

function normalizedBaseAsset(asset: LearningAssetCandidate): object {
  return {
    learningAssetId: asset.learningAssetId,
    contentReleaseId: asset.contentReleaseId,
    kind: asset.kind,
    reviewStatus: asset.reviewStatus,
    contentDigest: asset.contentDigest,
    sourceEvidenceRefs: sortedStrings(asset.sourceEvidenceRefs),
    learnerLocale: normalizedNullable(asset.learnerLocale),
    generatorProvider: normalizedNullable(asset.generatorProvider),
    generatorModel: normalizedNullable(asset.generatorModel),
    promptVersion: normalizedNullable(asset.promptVersion),
    sourceLicense: normalizedNullable(asset.sourceLicense),
    sourceAttribution: normalizedNullable(asset.sourceAttribution),
  };
}

function normalizedAsset(asset: LearningAssetCandidate): object {
  const base = normalizedBaseAsset(asset);
  switch (asset.kind) {
    case "experience_sketch":
    case "l1_bridge":
    case "boundary_note":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        body: asset.body,
        senseRelationId: normalizedNullable(asset.senseRelationId),
      };
    case "example":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        ordinal: asset.ordinal,
        textL2: asset.textL2,
        textL1: asset.textL1,
        targetForm: asset.targetForm,
        targetStart: asset.targetStart,
        targetEnd: asset.targetEnd,
        construction: asset.construction,
        sceneDomain: asset.sceneDomain,
        disambiguatingCue: normalizedNullable(asset.disambiguatingCue),
        collocations: sortedStrings(asset.collocations ?? []),
        variationNote: normalizedNullable(asset.variationNote),
        role: asset.role,
        contextL2: normalizedNullable(asset.contextL2),
        contextL1: normalizedNullable(asset.contextL1),
      };
    case "contrast_pair":
    case "counterexample":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        senseRelationId: asset.senseRelationId,
        positiveTextL2: asset.positiveTextL2,
        positiveTextL1: asset.positiveTextL1,
        negativeTextL2: asset.negativeTextL2,
        negativeTextL1: asset.negativeTextL1,
        distinguishingFeature: asset.distinguishingFeature,
      };
    case "visual_grounding":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        mediaBlobId: asset.mediaBlobId,
        mediaSha256: asset.mediaSha256,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        altText: asset.altText,
        distinguishingFeature: asset.distinguishingFeature,
        sourceLicense: asset.sourceLicense,
        sourceAttribution: asset.sourceAttribution,
      };
    case "spatial_diagram":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        figureLabel: asset.figureLabel,
        groundLabel: asset.groundLabel,
        pathDescription: asset.pathDescription,
        topology: asset.topology,
        textFallback: asset.textFallback,
        startDescription: normalizedNullable(asset.startDescription),
        endpointDescription: normalizedNullable(asset.endpointDescription),
        contrastRelationId: normalizedNullable(asset.contrastRelationId),
      };
    case "causal_sequence":
    case "temporal_sequence":
      return {
        ...base,
        senseVersionId: asset.senseVersionId,
        textFallback: asset.textFallback,
        steps: [...asset.steps]
          .sort((left, right) => left.ordinal - right.ordinal || compareCanonicalObjects(left, right))
          .map((step) => ({
            ordinal: step.ordinal,
            label: step.label,
            description: step.description,
          })),
      };
    case "pronunciation_audio":
    case "study_example_audio":
    case "extended_audio":
      return {
        ...base,
        senseVersionId: normalizedNullable(asset.senseVersionId),
        lexemeVersionId: normalizedNullable(asset.lexemeVersionId),
        mediaBlobId: asset.mediaBlobId,
        mediaSha256: asset.mediaSha256,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sourceExampleAssetId: normalizedNullable(asset.sourceExampleAssetId),
        accentLocale: normalizedNullable(asset.accentLocale),
        provider: normalizedNullable(asset.provider),
        model: normalizedNullable(asset.model),
        voice: normalizedNullable(asset.voice),
        sourceTextDigest: asset.sourceTextDigest,
        durationMs: asset.durationMs,
      };
  }
}

function canonicalCandidate(candidate: SenseLearningPackageCandidate): object {
  return {
    release: {
      contentReleaseId: candidate.release.contentReleaseId,
      targetLanguage: candidate.release.targetLanguage,
      learnerLocale: candidate.release.learnerLocale,
      schemaVersion: candidate.release.schemaVersion,
    },
    lexemeVersion: {
      contentReleaseId: candidate.lexemeVersion.contentReleaseId,
      lexemeVersionId: candidate.lexemeVersion.lexemeVersionId,
      lexemeId: candidate.lexemeVersion.lexemeId,
      languageTag: candidate.lexemeVersion.languageTag,
      lemma: candidate.lexemeVersion.lemma,
      forms: sortedStrings(candidate.lexemeVersion.forms),
      pronunciationSourceDigest: normalizedNullable(candidate.lexemeVersion.pronunciationSourceDigest),
    },
    senseVersion: {
      contentReleaseId: candidate.senseVersion.contentReleaseId,
      senseVersionId: candidate.senseVersion.senseVersionId,
      senseId: candidate.senseVersion.senseId,
      lexemeId: candidate.senseVersion.lexemeId,
      senseRank: candidate.senseVersion.senseRank,
      partOfSpeech: candidate.senseVersion.partOfSpeech,
      guideLabelL1: candidate.senseVersion.guideLabelL1,
      definitionL2: candidate.senseVersion.definitionL2,
      teachingPriority: normalizedNullable(candidate.senseVersion.teachingPriority),
      reviewStatus: candidate.senseVersion.reviewStatus,
    },
    relations: [...candidate.relations]
      .map((relation) => ({
        contentReleaseId: relation.contentReleaseId,
        senseRelationId: relation.senseRelationId,
        sourceSenseId: relation.sourceSenseId,
        targetSenseId: relation.targetSenseId,
        sourceLexemeId: relation.sourceLexemeId,
        targetLexemeId: relation.targetLexemeId,
        relationType: relation.relationType,
        scope: relation.scope,
        distinguishingFeature: relation.distinguishingFeature,
        sourceEvidenceRefs: sortedStrings(relation.sourceEvidenceRefs),
        reviewStatus: relation.reviewStatus,
      }))
      .sort((left, right) => compareStrings(left.senseRelationId, right.senseRelationId) || compareCanonicalObjects(left, right)),
    usagePatterns: [...candidate.usagePatterns]
      .map((pattern) => ({
        contentReleaseId: pattern.contentReleaseId,
        usagePatternId: pattern.usagePatternId,
        senseVersionId: pattern.senseVersionId,
        ordinal: pattern.ordinal,
        canonicalPattern: pattern.canonicalPattern,
        commonCollocations: sortedStrings(pattern.commonCollocations),
        registerLabel: normalizedNullable(pattern.registerLabel),
        domainLabel: normalizedNullable(pattern.domainLabel),
        usageRestriction: normalizedNullable(pattern.usageRestriction),
        sourceEvidenceRefs: sortedStrings(pattern.sourceEvidenceRefs),
        exampleAssetIds: sortedStrings(pattern.exampleAssetIds ?? []),
        reviewStatus: pattern.reviewStatus,
      }))
      .sort((left, right) => compareStrings(left.usagePatternId, right.usagePatternId) || compareCanonicalObjects(left, right)),
    profile: {
      contentReleaseId: candidate.profile.contentReleaseId,
      acquisitionProfileId: candidate.profile.acquisitionProfileId,
      senseVersionId: candidate.profile.senseVersionId,
      learnerLocale: candidate.profile.learnerLocale,
      schemaVersion: candidate.profile.schemaVersion,
      acquisitionNeeds: sortedStrings(candidate.profile.acquisitionNeeds),
      minimumSufficientExperience: candidate.profile.minimumSufficientExperience,
      distinguishingFeatures: sortedStrings(candidate.profile.distinguishingFeatures),
      preferredPrimitives: sortedStrings(candidate.profile.preferredPrimitives),
      requiredAssetCapabilities: sortedStrings(candidate.profile.requiredAssetCapabilities),
      optionalAssetCapabilities: sortedStrings(candidate.profile.optionalAssetCapabilities),
      fallbackPrimitives: sortedStrings(candidate.profile.fallbackPrimitives),
      domainBound: candidate.profile.domainBound,
      domainConstraints: sortedStrings(candidate.profile.domainConstraints),
      reviewStatus: candidate.profile.reviewStatus,
      boundaryTargets: [...candidate.profile.boundaryTargets]
        .map((target) => ({
          senseRelationId: target.senseRelationId,
          ordinal: target.ordinal,
          isRequired: target.isRequired,
        }))
        .sort((left, right) => compareStrings(left.senseRelationId, right.senseRelationId)
          || left.ordinal - right.ordinal
          || Number(left.isRequired) - Number(right.isRequired)),
    },
    assets: [...candidate.assets]
      .sort((left, right) => compareStrings(left.learningAssetId, right.learningAssetId)
        || compareCanonicalObjects(normalizedAsset(left), normalizedAsset(right)))
      .map(normalizedAsset),
  };
}

function packageDigest(candidate: SenseLearningPackageCandidate): string {
  return digest(JSON.stringify({
    validatorVersion: sensaPackageValidatorVersion,
    candidate: canonicalCandidate(candidate),
  }));
}

function checkAssetOwner(
  issues: IssueCollector,
  asset: LearningAssetCandidate,
  candidate: SenseLearningPackageCandidate,
): void {
  const path = `assets.${asset.learningAssetId}`;
  checkReleaseIdentity(issues, candidate.release.contentReleaseId, asset.contentReleaseId, `${path}.contentReleaseId`);
  if (asset.kind === "pronunciation_audio") {
    if (asset.lexemeVersionId !== candidate.lexemeVersion.lexemeVersionId || asset.senseVersionId != null) {
      issues.add("invalid", "asset.owner_mismatch", path, "Pronunciation audio must belong to the package Lexeme Version only.");
    }
    return;
  }
  const hasUnexpectedLexemeOwner = "lexemeVersionId" in asset && asset.lexemeVersionId != null;
  if (asset.senseVersionId !== candidate.senseVersion.senseVersionId || hasUnexpectedLexemeOwner) {
    issues.add("invalid", "asset.owner_mismatch", path, "The Learning Asset owner must be the package Sense Version.");
  }
}

function checkSequence(
  issues: IssueCollector,
  asset: SequenceAssetCandidate,
): void {
  if (asset.steps.length < 2) {
    issues.add("invalid", "asset.sequence_too_short", `assets.${asset.learningAssetId}.steps`, "A sequence asset must contain at least two steps.");
  }
  const ordinals = asset.steps.map((step) => step.ordinal);
  if (hasDuplicate(ordinals.map(String)) || ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) {
    issues.add("invalid", "asset.sequence_invalid_steps", `assets.${asset.learningAssetId}.steps`, "Sequence step ordinals must be unique positive integers.");
  }
  for (const step of asset.steps) {
    addTextIssue(issues, step.label, `assets.${asset.learningAssetId}.steps.${step.ordinal}.label`, "content.empty");
    addTextIssue(issues, step.description, `assets.${asset.learningAssetId}.steps.${step.ordinal}.description`, "content.empty");
  }
}

function checkAsset(
  issues: IssueCollector,
  asset: LearningAssetCandidate,
  candidate: SenseLearningPackageCandidate,
  relationsById: ReadonlyMap<string, SenseRelationCandidate>,
  examplesById: ReadonlyMap<string, ExampleAssetCandidate>,
): void {
  const path = `assets.${asset.learningAssetId}`;
  if (!isAssetKind(asset.kind)) {
    issues.add("invalid", "asset.unknown_kind", `${path}.kind`, "The Learning Asset kind is not in the frozen vocabulary.");
    return;
  }
  checkAssetOwner(issues, asset, candidate);
  if (!isSha256Digest(asset.contentDigest)) {
    issues.add("invalid", "asset.digest_invalid", `${path}.contentDigest`, "Learning Asset contentDigest must be lowercase SHA-256 hex.");
  }
  checkTextArray(issues, asset.sourceEvidenceRefs, `${path}.sourceEvidenceRefs`, "asset.source_evidence_missing");
  checkReviewStatus(issues, asset.reviewStatus, `${path}.reviewStatus`);
  checkGeneratorProvenance(issues, asset, path);
  checkSourceProvenanceTuple(issues, asset, path);
  if (asset.kind === "pronunciation_audio") {
    if (asset.learnerLocale != null && asset.learnerLocale !== candidate.release.learnerLocale) {
      issues.add("invalid", "asset.locale_mismatch", `${path}.learnerLocale`, "Pronunciation audio locale must match the release when present.");
    }
  } else if (asset.learnerLocale !== candidate.release.learnerLocale) {
    issues.add("invalid", "asset.locale_mismatch", `${path}.learnerLocale`, "Sense-owned pedagogical assets must match the Content Release learner locale.");
  }

  if (asset.kind === "experience_sketch" || asset.kind === "l1_bridge" || asset.kind === "boundary_note") {
    addTextIssue(issues, asset.body, `${path}.body`, "content.empty");
    if (asset.kind === "experience_sketch" && asset.body.trim().length > 80) {
      issues.add("invalid", "asset.text_too_long", `${path}.body`, "Experience Sketch exceeds the 80-character V1 limit.");
    } else if (asset.kind === "l1_bridge" && asset.body.trim().length > 60) {
      issues.add("invalid", "asset.text_too_long", `${path}.body`, "L1 Bridge exceeds the 60-character V1 limit.");
    }
    if (asset.kind === "experience_sketch") {
      const targetForms = [candidate.lexemeVersion.lemma, ...candidate.lexemeVersion.forms];
      if (targetForms.some((form) => containsWholeWord(asset.body, form))) {
        issues.add("invalid", "asset.experience_sketch_leaks_target", `${path}.body`, "Experience Sketch must not contain the target English form.");
      }
    }
    if (asset.kind === "boundary_note") {
      if (asset.senseRelationId == null || !relationsById.has(asset.senseRelationId)) {
        issues.add("invalid", "relation.invalid_reference", `${path}.senseRelationId`, "Boundary Note must reference a known Sense Relation.");
      }
    } else if (asset.senseRelationId != null) {
      issues.add("invalid", "relation.illegal_reference", `${path}.senseRelationId`, "Only Boundary Note may reference a Sense Relation.");
    }
    return;
  }

  if (asset.kind === "example") {
    checkExample(issues, asset, candidate);
    return;
  }

  if (asset.kind === "contrast_pair" || asset.kind === "counterexample") {
    if (!relationsById.has(asset.senseRelationId)) {
      issues.add("invalid", "relation.invalid_reference", `${path}.senseRelationId`, "Contrast assets must reference a known Sense Relation.");
    }
    addTextIssue(issues, asset.positiveTextL2, `${path}.positiveTextL2`, "content.empty");
    addTextIssue(issues, asset.positiveTextL1, `${path}.positiveTextL1`, "content.empty");
    addTextIssue(issues, asset.negativeTextL2, `${path}.negativeTextL2`, "content.empty");
    addTextIssue(issues, asset.negativeTextL1, `${path}.negativeTextL1`, "content.empty");
    addTextIssue(issues, asset.distinguishingFeature, `${path}.distinguishingFeature`, "content.empty");
    return;
  }

  if (asset.kind === "visual_grounding") {
    checkMediaMetadata(issues, asset, path, "image");
    addTextIssue(issues, asset.mediaBlobId, `${path}.mediaBlobId`, "media.invalid_reference");
    addTextIssue(issues, asset.altText, `${path}.altText`, "content.empty");
    addTextIssue(issues, asset.distinguishingFeature, `${path}.distinguishingFeature`, "content.empty");
    addTextIssue(issues, asset.sourceLicense, `${path}.sourceLicense`, "media.provenance_missing");
    addTextIssue(issues, asset.sourceAttribution, `${path}.sourceAttribution`, "media.provenance_missing");
    return;
  }

  if (asset.kind === "spatial_diagram") {
    addTextIssue(issues, asset.figureLabel, `${path}.figureLabel`, "content.empty");
    addTextIssue(issues, asset.groundLabel, `${path}.groundLabel`, "content.empty");
    addTextIssue(issues, asset.pathDescription, `${path}.pathDescription`, "content.empty");
    addTextIssue(issues, asset.topology, `${path}.topology`, "content.empty");
    addTextIssue(issues, asset.textFallback, `${path}.textFallback`, "content.empty");
    if (asset.contrastRelationId != null && !relationsById.has(asset.contrastRelationId)) {
      issues.add("invalid", "relation.invalid_reference", `${path}.contrastRelationId`, "Diagram contrastRelationId must reference a known Sense Relation.");
    }
    return;
  }

  if (asset.kind === "causal_sequence" || asset.kind === "temporal_sequence") {
    addTextIssue(issues, asset.textFallback, `${path}.textFallback`, "content.empty");
    checkSequence(issues, asset);
    return;
  }

  if (asset.kind === "pronunciation_audio" || asset.kind === "study_example_audio" || asset.kind === "extended_audio") {
    checkMediaMetadata(issues, asset, path, "audio");
    addTextIssue(issues, asset.mediaBlobId, `${path}.mediaBlobId`, "media.invalid_reference");
    if (!isSha256Digest(asset.sourceTextDigest)) {
      issues.add("invalid", "audio.source_digest_invalid", `${path}.sourceTextDigest`, "Audio sourceTextDigest must be lowercase SHA-256 hex.");
    }
    if (!Number.isInteger(asset.durationMs) || asset.durationMs <= 0) {
      issues.add("invalid", "audio.duration_invalid", `${path}.durationMs`, "Audio duration must be a positive integer.");
    }
    if ((asset.kind === "study_example_audio" || asset.kind === "extended_audio")
      && !hasCompleteTuple([asset.provider, asset.model, asset.voice, asset.accentLocale])) {
      issues.add("invalid", "provenance.tts_required", path, "Study and extended audio require provider, model, voice, and accent locale.");
    }
    if (asset.kind === "study_example_audio") {
      if (asset.sourceExampleAssetId == null) {
        issues.add("invalid", "audio.study_source_missing", `${path}.sourceExampleAssetId`, "Study Example Audio must reference a study Example.");
      } else {
        const sourceExample = examplesById.get(asset.sourceExampleAssetId);
        if (sourceExample === undefined || sourceExample.role !== "study") {
          issues.add("invalid", "audio.study_source_invalid", `${path}.sourceExampleAssetId`, "Study Example Audio source must be a study Example.");
        } else if (asset.sourceTextDigest !== digest(sourceExample.textL2)) {
          issues.add("invalid", "audio.source_digest_mismatch", `${path}.sourceTextDigest`, "Study Example Audio source digest must match SHA-256 UTF-8 of the Example textL2.");
        }
      }
    } else if (asset.kind === "pronunciation_audio") {
      if (asset.sourceExampleAssetId != null) {
        issues.add("invalid", "audio.pronunciation_source_illegal", `${path}.sourceExampleAssetId`, "Pronunciation Audio cannot reference an Example.");
      }
      if (asset.sourceTextDigest !== digest(candidate.lexemeVersion.lemma)) {
        issues.add("invalid", "audio.source_digest_mismatch", `${path}.sourceTextDigest`, "Pronunciation Audio source digest must match SHA-256 UTF-8 of the Lexeme lemma.");
      }
      if (!hasCompleteTuple([asset.provider, asset.model, asset.voice, asset.accentLocale])) {
        if (hasAnyTupleValue([asset.provider, asset.model, asset.voice, asset.accentLocale])) {
          issues.add("invalid", "provenance.tts_tuple_incomplete", path, "Pronunciation TTS provider, model, voice, and accent locale must be supplied together.");
        } else if (!hasCompleteTuple([asset.sourceLicense, asset.sourceAttribution])) {
          issues.add("invalid", "provenance.pronunciation_missing", path, "Pronunciation audio needs either a complete TTS tuple or source license and attribution.");
        }
      }
    } else {
      if (asset.sourceExampleAssetId != null) {
      issues.add("invalid", "audio.extended_source_illegal", `${path}.sourceExampleAssetId`, "Extended Audio cannot reference an Example.");
      }
    }
  }
}

function checkExample(
  issues: IssueCollector,
  asset: ExampleAssetCandidate,
  candidate: SenseLearningPackageCandidate,
): void {
  const path = `assets.${asset.learningAssetId}`;
  if (!Number.isInteger(asset.ordinal) || asset.ordinal < 1) {
    issues.add("invalid", "example.ordinal_invalid", `${path}.ordinal`, "Example ordinal must be a positive integer.");
  }
  if (!exampleRoles.has(asset.role)) {
    issues.add("invalid", "example.role_invalid", `${path}.role`, "Example role is outside the frozen vocabulary.");
  }
  if (!exampleConstructions.has(asset.construction)) {
    issues.add("invalid", "example.construction_invalid", `${path}.construction`, "Example construction is outside the frozen vocabulary.");
  }
  if (!sceneDomains.has(asset.sceneDomain)) {
    issues.add("invalid", "example.scene_domain_invalid", `${path}.sceneDomain`, "Example scene domain is outside the frozen vocabulary.");
  }
  addTextIssue(issues, asset.textL2, `${path}.textL2`, "content.empty");
  addTextIssue(issues, asset.textL1, `${path}.textL1`, "content.empty");
  addTextIssue(issues, asset.targetForm, `${path}.targetForm`, "content.empty");
  const lexemeForms = [candidate.lexemeVersion.lemma, ...candidate.lexemeVersion.forms]
    .filter((form) => nonEmptyText(form));
  const normalizedTargetForm = nonEmptyText(asset.targetForm) ? asset.targetForm.trim().toLowerCase() : null;
  if (normalizedTargetForm === null || !lexemeForms.some((form) => form.trim().toLowerCase() === normalizedTargetForm)) {
    issues.add("invalid", "example.target_form_not_lexeme_form", `${path}.targetForm`, "targetForm must be the Lexeme lemma or one of its declared forms.");
  }
  if (asset.disambiguatingCue != null) {
    addTextIssue(issues, asset.disambiguatingCue, `${path}.disambiguatingCue`, "content.empty");
  }
  if (asset.variationNote != null) {
    addTextIssue(issues, asset.variationNote, `${path}.variationNote`, "content.empty");
  }
  const collocations = asset.collocations ?? [];
  if (asset.collocations !== undefined) {
    if (collocations.some((value) => !nonEmptyText(value) || isPlaceholder(value))) {
      issues.add("invalid", "example.collocations_invalid", `${path}.collocations`, "Supplied collocations must contain only non-empty, non-placeholder text.");
    }
  }
  if (!Number.isInteger(asset.targetStart) || !Number.isInteger(asset.targetEnd)
    || asset.targetStart < 0
    || asset.targetEnd <= asset.targetStart
    || asset.targetEnd > asset.textL2.length) {
    issues.add("invalid", "example.span_invalid", `${path}.targetStart`, "targetStart/targetEnd must describe a valid substring of textL2.");
  } else {
    const targetSlice = asset.textL2.slice(asset.targetStart, asset.targetEnd);
    if (targetSlice.toLowerCase() !== asset.targetForm.toLowerCase()
      || countWholeWord(asset.textL2, asset.targetForm) !== 1) {
      issues.add("invalid", "example.target_substring_invalid", `${path}.targetForm`, "targetForm must occur exactly once at the declared target span.");
    }
    const lexemeSpans = mergedWholeWordSpans(asset.textL2, lexemeForms);
    if (lexemeSpans.length !== 1
      || lexemeSpans[0][0] !== asset.targetStart
      || lexemeSpans[0][1] !== asset.targetEnd) {
      issues.add("invalid", "example.target_multiple_lexeme_forms", `${path}.textL2`, "The target lemma/form inventory must occur exactly once in textL2, at the declared target span.");
    }
  }
  if (asset.disambiguatingCue != null && (
    !asset.textL2.includes(asset.disambiguatingCue)
    || containsWholeWord(asset.disambiguatingCue, asset.targetForm)
  )) {
    issues.add("invalid", "example.cue_substring_invalid", `${path}.disambiguatingCue`, "Supplied disambiguatingCue must be a target-free substring of textL2.");
  }
  for (const collocation of sortedStrings(collocations)) {
    if (!asset.textL2.includes(collocation)) {
      issues.add("invalid", "example.collocation_substring_invalid", `${path}.collocations.${collocation}`, "Each collocation must be a substring of textL2.");
    }
  }
  if (asset.role === "study") {
    addTextIssue(issues, asset.contextL2, `${path}.contextL2`, "example.study_context_missing");
    addTextIssue(issues, asset.contextL1, `${path}.contextL1`, "example.study_context_missing");
  }
  if (lexemeForms.some((form) => containsWholeWord(asset.textL1, form))) {
    issues.add("invalid", "example.l1_target_leak", `${path}.textL1`, "textL1 must not leak an approved target English form.");
  }
}

function requirement(
  key: string,
  capability: AssetCapability,
  requiredCount: number,
  matchedResourceIds: readonly string[],
  status: PackageValidationStatus,
): RequirementDraft {
  return {
    key,
    capability,
    requiredCount,
    matchedResourceIds: [...matchedResourceIds].sort(compareStrings),
    status,
  };
}

function countRequirement(
  key: string,
  capability: AssetCapability,
  requiredCount: number,
  matchedResourceIds: readonly string[],
  exactCount: number | null = null,
  invalidCount = false,
): RequirementDraft {
  const count = matchedResourceIds.length;
  const invalid = invalidCount || (exactCount !== null && count > exactCount);
  const satisfied = exactCount === null ? count >= requiredCount : count === exactCount;
  return requirement(key, capability, requiredCount, matchedResourceIds, invalid ? "invalid" : satisfied ? "satisfied" : "incomplete");
}

function assetMatchesCapability(asset: LearningAssetCandidate, capability: AssetCapability): boolean {
  return (conditionalCapabilityKinds.get(capability) ?? []).includes(asset.kind);
}

function validateRelations(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
): ReadonlyMap<string, SenseRelationCandidate> {
  const relationsById = new Map<string, SenseRelationCandidate>();
  for (const relation of candidate.relations) {
    const path = `relations.${relation.senseRelationId}`;
    if (relationsById.has(relation.senseRelationId)) {
      issues.add("invalid", "relation.duplicate_id", `${path}.senseRelationId`, "Sense Relation IDs must be unique.");
    }
    relationsById.set(relation.senseRelationId, relation);
    checkReleaseIdentity(issues, candidate.release.contentReleaseId, relation.contentReleaseId, `${path}.contentReleaseId`);
    checkReviewStatus(issues, relation.reviewStatus, `${path}.reviewStatus`);
    if (!relationScopes.has(relation.scope)) {
      issues.add("invalid", "relation.scope_invalid", `${path}.scope`, "Relation scope is outside the frozen vocabulary.");
    }
    addTextIssue(issues, relation.relationType, `${path}.relationType`, "content.empty");
    addTextIssue(issues, relation.distinguishingFeature, `${path}.distinguishingFeature`, "content.empty");
    checkTextArray(issues, relation.sourceEvidenceRefs, `${path}.sourceEvidenceRefs`, "relation.evidence_missing");
    const currentSenseId = candidate.senseVersion.senseId;
    if (relation.sourceSenseId !== currentSenseId && relation.targetSenseId !== currentSenseId) {
      issues.add("invalid", "relation.endpoint_outside_package", path, "Every Relation must have at least one endpoint equal to the package Sense.");
    }
    if (relation.sourceSenseId === currentSenseId && relation.sourceLexemeId !== candidate.lexemeVersion.lexemeId) {
      issues.add("invalid", "relation.endpoint_owner_mismatch", `${path}.sourceLexemeId`, "The package Sense endpoint must use the package Lexeme identity.");
    }
    if (relation.targetSenseId === currentSenseId && relation.targetLexemeId !== candidate.lexemeVersion.lexemeId) {
      issues.add("invalid", "relation.endpoint_owner_mismatch", `${path}.targetLexemeId`, "The package Sense endpoint must use the package Lexeme identity.");
    }
    const scopeInvalid = relation.sourceSenseId === relation.targetSenseId
      || (relation.scope === "cross_word" && relation.sourceLexemeId === relation.targetLexemeId)
      || (relation.scope === "intra_word" && relation.sourceLexemeId !== relation.targetLexemeId);
    if (scopeInvalid) {
      issues.add("invalid", "relation.scope_invalid", path, "Relation scope, lexeme identities, and endpoints are inconsistent.");
    }
  }
  return relationsById;
}

function validateUsagePatterns(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
): readonly UsagePatternCandidate[] {
  const patternsById = new Set<string>();
  const approved: UsagePatternCandidate[] = [];
  for (const pattern of candidate.usagePatterns) {
    const path = `usagePatterns.${pattern.usagePatternId}`;
    if (patternsById.has(pattern.usagePatternId)) {
      issues.add("invalid", "usage_pattern.duplicate_id", `${path}.usagePatternId`, "Usage Pattern IDs must be unique.");
    }
    patternsById.add(pattern.usagePatternId);
    checkReleaseIdentity(issues, candidate.release.contentReleaseId, pattern.contentReleaseId, `${path}.contentReleaseId`);
    if (pattern.senseVersionId !== candidate.senseVersion.senseVersionId) {
      issues.add("invalid", "usage_pattern.owner_mismatch", `${path}.senseVersionId`, "Usage Pattern must belong to the package Sense Version.");
    }
    checkReviewStatus(issues, pattern.reviewStatus, `${path}.reviewStatus`);
    addTextIssue(issues, pattern.canonicalPattern, `${path}.canonicalPattern`, "content.empty");
    checkTextArray(issues, pattern.sourceEvidenceRefs, `${path}.sourceEvidenceRefs`, "usage_pattern.evidence_missing");
    if (pattern.exampleAssetIds !== undefined && hasDuplicate(pattern.exampleAssetIds)) {
      issues.add("invalid", "usage_pattern.duplicate_example_reference", `${path}.exampleAssetIds`, "Usage Pattern example references must be unique.");
    }
    if (pattern.reviewStatus === "approved"
      && pattern.contentReleaseId === candidate.release.contentReleaseId
      && pattern.senseVersionId === candidate.senseVersion.senseVersionId
      && nonEmptyText(pattern.canonicalPattern)
      && pattern.sourceEvidenceRefs.length > 0
      && !isPlaceholder(pattern.canonicalPattern)) {
      approved.push(pattern);
    }
  }
  return approved.sort((left, right) => compareStrings(left.usagePatternId, right.usagePatternId));
}

function validateProfile(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
  relationsById: ReadonlyMap<string, SenseRelationCandidate>,
): readonly ProfileBoundaryTargetCandidate[] {
  const profile = candidate.profile;
  const path = "profile";
  checkReleaseIdentity(issues, candidate.release.contentReleaseId, profile.contentReleaseId, `${path}.contentReleaseId`);
  if (profile.senseVersionId !== candidate.senseVersion.senseVersionId) {
    issues.add("invalid", "profile.owner_mismatch", `${path}.senseVersionId`, "Acquisition Profile must belong to the package Sense Version.");
  }
  if (profile.learnerLocale !== candidate.release.learnerLocale) {
    issues.add("invalid", "profile.locale_mismatch", `${path}.learnerLocale`, "Acquisition Profile locale must match the Content Release locale.");
  }
  checkReviewStatus(issues, profile.reviewStatus, `${path}.reviewStatus`);
  addTextIssue(issues, profile.schemaVersion, `${path}.schemaVersion`, "content.empty");
  addTextIssue(issues, profile.minimumSufficientExperience, `${path}.minimumSufficientExperience`, "content.empty");
  checkTextArray(issues, profile.distinguishingFeatures, `${path}.distinguishingFeatures`, "profile.features_missing");
  if (profile.acquisitionNeeds.length === 0 || profile.preferredPrimitives.length === 0 || profile.fallbackPrimitives.length === 0) {
    issues.add("invalid", "profile.required_arrays_empty", path, "Profile acquisition needs and primitive arrays must be non-empty.");
  }
  checkEnumArray(issues, profile.acquisitionNeeds, acquisitionNeeds, `${path}.acquisitionNeeds`, "profile.acquisition_needs");
  checkEnumArray(issues, profile.preferredPrimitives, acquisitionPrimitives, `${path}.preferredPrimitives`, "profile.preferred_primitives");
  checkEnumArray(issues, profile.fallbackPrimitives, acquisitionPrimitives, `${path}.fallbackPrimitives`, "profile.fallback_primitives");
  checkEnumArray(issues, profile.requiredAssetCapabilities, assetCapabilities, `${path}.requiredAssetCapabilities`, "profile.required_capabilities");
  checkEnumArray(issues, profile.optionalAssetCapabilities, assetCapabilities, `${path}.optionalAssetCapabilities`, "profile.optional_capabilities");
  if (profile.requiredAssetCapabilities.some((capability) => profile.optionalAssetCapabilities.includes(capability))) {
    issues.add("invalid", "profile.capability_overlap", path, "Required and optional asset capabilities must be disjoint.");
  }
  if (profile.domainBound && profile.domainConstraints.length === 0) {
    issues.add("invalid", "profile.domain_constraints_missing", `${path}.domainConstraints`, "A domain-bound profile must declare at least one domain constraint.");
  }
  if (hasDuplicate(profile.domainConstraints)) {
    issues.add("invalid", "profile.domain_constraints_duplicate", `${path}.domainConstraints`, "Profile domain constraints must be unique.");
  }
  const targets = [...profile.boundaryTargets];
  const targetIds = targets.map((target) => target.senseRelationId);
  if (hasDuplicate(targetIds)) {
    issues.add("invalid", "profile.boundary_target_duplicate", `${path}.boundaryTargets`, "Boundary target Relation IDs must be unique.");
  }
  if (hasDuplicate(targets.map((target) => String(target.ordinal)))) {
    issues.add("invalid", "profile.boundary_ordinal_duplicate", `${path}.boundaryTargets`, "Boundary target ordinals must be unique.");
  }
  for (const target of targets) {
    if (!nonEmptyText(target.senseRelationId)) {
      issues.add("invalid", "profile.boundary_target_invalid", `${path}.boundaryTargets`, "Boundary targets must reference a non-empty Sense Relation ID.");
    }
    if (!Number.isInteger(target.ordinal) || target.ordinal < 1) {
      issues.add("invalid", "profile.boundary_ordinal_invalid", `${path}.boundaryTargets.${target.senseRelationId}.ordinal`, "Boundary target ordinal must be a positive integer.");
    }
    if (typeof target.isRequired !== "boolean") {
      issues.add("invalid", "profile.boundary_required_invalid", `${path}.boundaryTargets.${target.senseRelationId}.isRequired`, "Boundary target isRequired must be boolean.");
    }
    if (nonEmptyText(target.senseRelationId)
      && !relationsById.has(target.senseRelationId)) {
      issues.add("invalid", "relation.invalid_reference", `${path}.boundaryTargets.${target.senseRelationId}`, "Boundary target must reference a known Sense Relation.");
    }
  }
  const requiredTargets = targets.filter((target) => target.isRequired);
  const requiresExecutableBoundary = profile.acquisitionNeeds.includes("boundary_formation")
    || profile.requiredAssetCapabilities.includes("boundary_contrast")
    || profile.requiredAssetCapabilities.includes("counterexample");
  if (requiresExecutableBoundary && requiredTargets.length === 0) {
    issues.add("invalid", "profile.boundary_target_missing", `${path}.boundaryTargets`, "Boundary acquisition requires at least one required, Relation-backed target.");
  }
  return targets.sort((left, right) => compareStrings(left.senseRelationId, right.senseRelationId));
}

function validateReleaseAndIdentities(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
): void {
  const release = candidate.release;
  addTextIssue(issues, release.contentReleaseId, "release.contentReleaseId", "release.identity_missing");
  addTextIssue(issues, release.targetLanguage, "release.targetLanguage", "content.empty");
  addTextIssue(issues, release.learnerLocale, "release.learnerLocale", "content.empty");
  addTextIssue(issues, release.schemaVersion, "release.schemaVersion", "content.empty");
  checkReleaseIdentity(issues, release.contentReleaseId, candidate.lexemeVersion.contentReleaseId, "lexemeVersion.contentReleaseId");
  checkReleaseIdentity(issues, release.contentReleaseId, candidate.senseVersion.contentReleaseId, "senseVersion.contentReleaseId");
  if (candidate.lexemeVersion.languageTag !== release.targetLanguage) {
    issues.add("invalid", "lexeme.language_mismatch", "lexemeVersion.languageTag", "Lexeme language must match the Content Release target language.");
  }
  addTextIssue(issues, candidate.lexemeVersion.lexemeId, "lexemeVersion.lexemeId", "content.empty");
  addTextIssue(issues, candidate.lexemeVersion.lemma, "lexemeVersion.lemma", "content.empty");
  if (candidate.lexemeVersion.forms.length === 0 || candidate.lexemeVersion.forms.some((form) => !nonEmptyText(form) || isPlaceholder(form))) {
    issues.add("invalid", "lexeme.forms_invalid", "lexemeVersion.forms", "Lexeme Version forms must contain non-empty values.");
  }
  if (hasDuplicate(candidate.lexemeVersion.forms)) {
    issues.add("invalid", "lexeme.forms_duplicate", "lexemeVersion.forms", "Lexeme Version forms must be unique.");
  }
  if (candidate.lexemeVersion.pronunciationSourceDigest != null && !isSha256Digest(candidate.lexemeVersion.pronunciationSourceDigest)) {
    issues.add("invalid", "lexeme.pronunciation_digest_invalid", "lexemeVersion.pronunciationSourceDigest", "Pronunciation source digest must be lowercase SHA-256 hex.");
  }
  if (candidate.lexemeVersion.pronunciationSourceDigest != null
    && candidate.lexemeVersion.pronunciationSourceDigest !== digest(candidate.lexemeVersion.lemma)) {
    issues.add("invalid", "lexeme.pronunciation_digest_mismatch", "lexemeVersion.pronunciationSourceDigest", "Pronunciation source digest must match SHA-256 UTF-8 of the Lexeme lemma.");
  }
  addTextIssue(issues, candidate.senseVersion.senseId, "senseVersion.senseId", "content.empty");
  if (candidate.senseVersion.lexemeId !== candidate.lexemeVersion.lexemeId) {
    issues.add("invalid", "sense.owner_mismatch", "senseVersion.lexemeId", "Sense Version must belong to the package Lexeme Version.");
  }
  addTextIssue(issues, candidate.senseVersion.partOfSpeech, "senseVersion.partOfSpeech", "content.empty");
  addTextIssue(issues, candidate.senseVersion.guideLabelL1, "senseVersion.guideLabelL1", "content.empty");
  addTextIssue(issues, candidate.senseVersion.definitionL2, "senseVersion.definitionL2", "content.empty");
  checkReviewStatus(issues, candidate.senseVersion.reviewStatus, "senseVersion.reviewStatus");
}

function baselineRequirements(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
  approvedAssets: readonly LearningAssetCandidate[],
): readonly RequirementDraft[] {
  const experienceAssets = candidate.assets.filter((asset) => asset.kind === "experience_sketch");
  const approvedExperience = approvedAssets.filter((asset) => asset.kind === "experience_sketch");
  const l1Assets = candidate.assets.filter((asset) => asset.kind === "l1_bridge");
  const approvedL1 = approvedAssets.filter((asset) => asset.kind === "l1_bridge");
  const examples = candidate.assets.filter((asset): asset is ExampleAssetCandidate => asset.kind === "example");
  const approvedExamples = approvedAssets.filter((asset): asset is ExampleAssetCandidate => asset.kind === "example");
  const pronunciation = approvedAssets.filter((asset) => asset.kind === "pronunciation_audio");
  const studyAudio = approvedAssets.filter((asset) => asset.kind === "study_example_audio");

  if (experienceAssets.length > 1) {
    issues.add("invalid", "asset.duplicate_singleton", "assets.experience_sketch", "Exactly one Experience Sketch is allowed.");
  }
  if (l1Assets.length > 1) {
    issues.add("invalid", "asset.duplicate_singleton", "assets.l1_bridge", "Exactly one L1 Bridge is allowed.");
  }
  const exampleOrdinals = examples.map((example) => example.ordinal);
  if (hasDuplicate(exampleOrdinals.map(String))) {
    issues.add("invalid", "example.ordinal_duplicate", "assets.example.ordinal", "Example ordinals must be unique.");
  }
  const studyCount = approvedExamples.filter((example) => example.role === "study").length;
  const quizCount = approvedExamples.filter((example) => example.role === "quiz").length;
  if (studyCount > 3) {
    issues.add("invalid", "example.study_count_invalid", "assets.example.role", "There cannot be more than three approved study Examples.");
  } else if (studyCount < 3) {
    issues.add("incomplete", "example.study_count_incomplete", "assets.example.role", "A package needs exactly three approved study Examples.");
  }
  if (quizCount < 3) {
    issues.add("incomplete", "example.quiz_count_incomplete", "assets.example.role", "A package needs at least three approved quiz Examples.");
  }
  if (examples.length < 6) {
    issues.add("incomplete", "example.count_incomplete", "assets.example", "A package needs at least six approved Examples.");
  }
  if (pronunciation.length === 0) issues.add("incomplete", "audio.pronunciation_missing", "assets.pronunciation_audio", "At least one approved Lexeme pronunciation audio is required.");
  if (studyAudio.length > 3) issues.add("invalid", "audio.study_count_invalid", "assets.study_example_audio", "Exactly three approved Study Example Audio assets are allowed.");
  if (studyAudio.length < 3) issues.add("incomplete", "audio.study_count_incomplete", "assets.study_example_audio", "Exactly three approved Study Example Audio assets are required.");

  const approvedStudyIds = new Set(approvedExamples.filter((example) => example.role === "study").map((example) => example.learningAssetId));
  const audioSources = studyAudio.map((asset) => asset.kind === "study_example_audio" ? asset.sourceExampleAssetId ?? "" : "");
  if (hasDuplicate(audioSources) || audioSources.some((sourceId) => !approvedStudyIds.has(sourceId))) {
    issues.add("invalid", "audio.study_source_set_invalid", "assets.study_example_audio", "Study Example Audio must map one-to-one to the three approved study Examples.");
  }

  return [
    countRequirement("baseline.experience-sketch", "meaning_grounding", 1, approvedExperience.map((asset) => asset.learningAssetId), 1, experienceAssets.length > 1),
    countRequirement("baseline.l1-bridge", "l1_mediation", 1, approvedL1.map((asset) => asset.learningAssetId), 1, l1Assets.length > 1),
    countRequirement("baseline.examples", "contextual_variation", 6, approvedExamples.map((example) => example.learningAssetId)),
    countRequirement("baseline.pronunciation-audio", "pronunciation", 1, pronunciation.map((asset) => asset.learningAssetId)),
    countRequirement("baseline.study-example-audio", "study_example_audio", 3, studyAudio.map((asset) => asset.learningAssetId), 3, studyAudio.length > 3),
  ];
}

function conditionalRequirements(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
  approvedAssets: readonly LearningAssetCandidate[],
  approvedUsagePatterns: readonly UsagePatternCandidate[],
  relationsById: ReadonlyMap<string, SenseRelationCandidate>,
  boundaryTargets: readonly ProfileBoundaryTargetCandidate[],
): readonly RequirementDraft[] {
  const requirements: RequirementDraft[] = [];
  const capabilities = [...new Set(candidate.profile.requiredAssetCapabilities)].sort(compareStrings);
  for (const capabilityValue of capabilities) {
    if (!isAssetCapability(capabilityValue)) continue;
    const key = `conditional.capability.${capabilityValue}`;
    if (capabilityValue === "usage_pattern") {
      requirements.push(countRequirement(key, capabilityValue, 1, approvedUsagePatterns.map((pattern) => pattern.usagePatternId)));
      continue;
    }
    const matched = approvedAssets.filter((asset) => assetMatchesCapability(asset, capabilityValue));
    requirements.push(countRequirement(key, capabilityValue, 1, matched.map((asset) => asset.learningAssetId)));
  }
  for (const target of boundaryTargets.filter((boundaryTarget) => boundaryTarget.isRequired)) {
    const relation = relationsById.get(target.senseRelationId);
    const key = `conditional.boundary-target.${target.senseRelationId}`;
    if (relation === undefined) {
      issues.add("invalid", "relation.invalid_reference", `profile.boundaryTargets.${target.senseRelationId}`, "Required boundary target must reference a known Sense Relation.");
      requirements.push(requirement(key, "boundary_contrast", 1, [], "invalid"));
      continue;
    }
    const matched = approvedAssets.filter((asset) => (
      (asset.kind === "contrast_pair" || asset.kind === "counterexample")
      && asset.senseRelationId === relation.senseRelationId
    ));
    requirements.push(countRequirement(key, "boundary_contrast", 1, matched.map((asset) => asset.learningAssetId)));
  }
  return requirements;
}

function capabilityAssetSnapshot(
  asset: LearningAssetCandidate,
): SensaCapabilityAssetSnapshot {
  const baseline = {
    assetId: asset.learningAssetId,
    kind: asset.kind,
    text: null,
    exampleOrdinal: null,
    exampleRole: null,
    exampleText: null,
    exampleTargetStart: null,
    exampleTargetEnd: null,
    boundaryRelationId: null,
    positiveText: null,
    negativeText: null,
    sourceExampleAssetId: null,
  } as const;
  switch (asset.kind) {
    case "experience_sketch":
    case "l1_bridge":
    case "boundary_note":
      return { ...baseline, text: asset.body };
    case "example":
      return {
        ...baseline,
        exampleOrdinal: asset.ordinal,
        exampleRole: asset.role,
        exampleText: asset.textL2,
        exampleTargetStart: asset.targetStart,
        exampleTargetEnd: asset.targetEnd,
      };
    case "contrast_pair":
    case "counterexample":
      return {
        ...baseline,
        boundaryRelationId: asset.senseRelationId,
        positiveText: asset.positiveTextL2,
        negativeText: asset.negativeTextL2,
      };
    case "pronunciation_audio":
    case "study_example_audio":
    case "extended_audio":
      return {
        ...baseline,
        sourceExampleAssetId: asset.sourceExampleAssetId ?? null,
      };
    case "visual_grounding":
    case "spatial_diagram":
    case "causal_sequence":
    case "temporal_sequence":
      return baseline;
  }
}

function validateExecutableLearningCapabilities(
  issues: IssueCollector,
  candidate: SenseLearningPackageCandidate,
  approvedAssets: readonly LearningAssetCandidate[],
  boundaryTargets: readonly ProfileBoundaryTargetCandidate[],
): void {
  const result = sensaExecutableLearningCapabilityModule.resolve({
    profile: {
      acquisitionNeeds: candidate.profile.acquisitionNeeds,
      preferredPrimitives: candidate.profile.preferredPrimitives,
      fallbackPrimitives: candidate.profile.fallbackPrimitives,
      requiredAssetCapabilities: candidate.profile.requiredAssetCapabilities,
      optionalAssetCapabilities: candidate.profile.optionalAssetCapabilities,
    },
    boundaryTargets: boundaryTargets.map((target) => ({
      relationId: target.senseRelationId,
      ordinal: target.ordinal,
      required: target.isRequired,
    })),
    assets: approvedAssets.map(capabilityAssetSnapshot),
  });
  if (result.status === "executable") return;
  for (const resolutionIssue of result.issues) {
    issues.add(
      resolutionIssue.severity,
      `runtime.capability.${resolutionIssue.code}`,
      "profile",
      `The approved Package cannot be executed by the current learning runtime (${resolutionIssue.code}).`,
    );
  }
}

export function validateSenseLearningPackage(
  candidate: SenseLearningPackageCandidate,
): PackageValidationResult {
  const issues = new IssueCollector();
  const relationsById = validateRelations(issues, candidate);
  const boundaryTargets = validateProfile(issues, candidate, relationsById);
  validateReleaseAndIdentities(issues, candidate);

  const assetsById = new Map<string, LearningAssetCandidate>();
  const examplesById = new Map<string, ExampleAssetCandidate>();
  for (const asset of candidate.assets) {
    if (assetsById.has(asset.learningAssetId)) {
      issues.add("invalid", "asset.duplicate_id", `assets.${asset.learningAssetId}.learningAssetId`, "Learning Asset IDs must be unique.");
    }
    assetsById.set(asset.learningAssetId, asset);
    if (asset.kind === "example") examplesById.set(asset.learningAssetId, asset);
  }
  for (const asset of candidate.assets) {
    checkAsset(issues, asset, candidate, relationsById, examplesById);
  }

  const approvedAssets = candidate.assets.filter((asset) => asset.reviewStatus === "approved");
  const approvedUsagePatterns = validateUsagePatterns(issues, candidate);
  const baseline = baselineRequirements(issues, candidate, approvedAssets);
  const conditional = conditionalRequirements(issues, candidate, approvedAssets, approvedUsagePatterns, relationsById, boundaryTargets);
  validateExecutableLearningCapabilities(issues, candidate, approvedAssets, boundaryTargets);
  const requirements = [...baseline, ...conditional]
    .sort(compareRequirements)
    .map((draft) => ({
      key: draft.key,
      capability: draft.capability,
      requiredCount: draft.requiredCount,
      matchedResourceIds: draft.matchedResourceIds,
      status: draft.status,
    }));

  const requirementsIncomplete = requirements.some((requirement) => requirement.status === "incomplete");
  const requirementsInvalid = requirements.some((requirement) => requirement.status === "invalid");
  const status: PackageValidationStatus = issues.hasInvalid || requirementsInvalid
    ? "invalid"
    : issues.hasIncomplete || requirementsIncomplete
      ? "incomplete"
      : "satisfied";
  const orderedIssues = issues.sorted().map(({ code, path, message }) => ({ code, path, message }));
  return {
    status,
    validatorVersion: sensaPackageValidatorVersion,
    capabilityResolverVersion: sensaExecutableLearningCapabilityResolverVersion,
    packageDigest: packageDigest(candidate),
    requirements,
    issues: orderedIssues,
  };
}
