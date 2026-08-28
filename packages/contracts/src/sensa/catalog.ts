/**
 * Public boundary for the Sensa Catalog Module.
 *
 * The implementation behind this Interface may read the relational Content
 * Kernel and Curriculum tables, but callers only receive business DTOs.  In
 * particular, this boundary has no representation for a draft, retired or
 * superseded public item: retired Books and superseded Releases are resolved
 * by pinned-runtime code, never by new catalog discovery.
 */

export const sensaCatalogContractVersion = "sensa-catalog-v1" as const;
export const sensaPublicLaunchMinimumLexemeCount = 1_000 as const;

declare const publicLaunchLexemeCountBrand: unique symbol;

/** A count that has passed the non-negotiable public V1 launch gate. */
export type PublicLaunchEligibleLexemeCount = number & {
  readonly [publicLaunchLexemeCountBrand]: "public-launch-eligible";
};

/**
 * The Catalog Adapter must construct this value before returning a public
 * Book.  This keeps the five-word fixture and other incomplete Books out of
 * the public Interface instead of relying on a route-level convention.
 */
export function createPublicLaunchEligibleLexemeCount(
  value: number,
): PublicLaunchEligibleLexemeCount {
  if (
    !Number.isSafeInteger(value) ||
    value < sensaPublicLaunchMinimumLexemeCount
  ) {
    throw new Error(
      `Sensa public Book requires at least ${sensaPublicLaunchMinimumLexemeCount} distinct Lexemes`,
    );
  }

  return value as PublicLaunchEligibleLexemeCount;
}

/** Catalog cursors are opaque to callers and must not be decoded here. */
export type SensaCatalogCursor = string;

export type SensaPublicContentReleaseReference = Readonly<{
  contentReleaseId: string;
  releaseKey: string;
  versionNumber: number;
  targetLanguage: string;
  learnerLocale: string;
  schemaVersion: string;
  sourceDigest: string;
  validatorVersion: string;
  status: "published";
}>;

export type SensaPublicBookSummary = Readonly<{
  bookId: string;
  bookKey: string;
  bookVersionId: string;
  versionNumber: number;
  contentRelease: SensaPublicContentReleaseReference;
  targetLanguage: string;
  learnerLocale: string;
  title: string;
  description: string;
  manifestDigest: string;
  senseCount: number;
  lexemeCount: PublicLaunchEligibleLexemeCount;
  status: "published";
  publishedAt: string;
}>;

export type SensaPublicBookListInput = Readonly<{
  targetLanguage?: string;
  learnerLocale?: string;
  cursor: SensaCatalogCursor | null;
  pageSize: number;
}>;

export type SensaPublicBookListPage = Readonly<{
  books: ReadonlyArray<SensaPublicBookSummary>;
  nextCursor: SensaCatalogCursor | null;
  hasMore: boolean;
}>;

export type SensaPublicBookManifestMember = Readonly<{
  ordinal: number;
  senseVersionId: string;
  senseId: string;
  senseKey: string;
  lexemeVersionId: string;
  lexemeId: string;
  lemma: string;
  partOfSpeech: string;
  guideLabelL1: string;
  teachingPriority: "core" | "extended" | "recognition";
  packageDigest: string;
}>;

export type SensaPublicBookManifest = Readonly<{
  book: SensaPublicBookSummary;
  contentRelease: SensaPublicContentReleaseReference;
  members: ReadonlyArray<SensaPublicBookManifestMember>;
  manifestDigest: string;
}>;

export type SensaPublicBookManifestInput = Readonly<{
  bookVersionId: string;
}>;

/**
 * Public packages contain business content rather than Content Kernel rows.
 * The tuple form is used for fields whose frozen contract requires at least
 * one sourced value, so a route cannot accidentally expose an unsourced
 * placeholder package.
 */
/** Runtime schemas enforce non-empty arrays; the serialized type stays composable. */
export type SensaNonEmptyArray<T> = ReadonlyArray<T>;
export type SensaNonEmptyStringArray = SensaNonEmptyArray<string>;

export type SensaPublicAssetProvenance = Readonly<{
  sourceEvidenceRefs: SensaNonEmptyStringArray;
  generatorProvider: string | null;
  generatorModel: string | null;
  promptVersion: string | null;
  sourceLicense: string | null;
  sourceAttribution: string | null;
}>;

/** Exact provenance columns available on sensa.acquisition_profiles. */
export type SensaPublicProfileProvenance = Readonly<{
  generatorProvider: string | null;
  generatorModel: string | null;
  promptVersion: string | null;
}>;

export type SensaPublicAcquisitionNeed =
  | "perceptual_grounding"
  | "boundary_formation"
  | "abstraction_invariant"
  | "spatial_aspectual_tuning"
  | "social_normative_calibration"
  | "form_binding";

export type SensaPublicAcquisitionPrimitive =
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

export type SensaPublicAssetCapability =
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

export type SensaPublicMediaReference = Readonly<{
  mediaBlobId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
}>;

export type SensaPublicLexemeSnapshot = Readonly<{
  lexemeVersionId: string;
  lexemeId: string;
  languageTag: string;
  lemma: string;
  forms: SensaNonEmptyStringArray;
  /** Dictionary fields are nullable because a published row may lack one accent. */
  ipaUs: string | null;
  ipaUk: string | null;
  syllables: string | null;
}>;

export type SensaPublicSenseSnapshot = Readonly<{
  senseVersionId: string;
  senseId: string;
  senseKey: string;
  senseRank: number;
  partOfSpeech: string;
  guideLabelL1: string;
  definitionL2: string;
  teachingPriority: "core" | "extended" | "recognition";
  reviewStatus: "approved";
}>;

export type SensaPublicSenseRelationSnapshot = Readonly<{
  contentReleaseId: string;
  senseRelationId: string;
  sourceSenseId: string;
  targetSenseId: string;
  sourceLexemeId: string;
  targetLexemeId: string;
  relationType: string;
  scope: "intra_word" | "cross_word";
  distinguishingFeature: string;
  sourceEvidenceRefs: SensaNonEmptyStringArray;
  reviewStatus: "approved";
}>;

export type SensaPublicUsagePatternSlot = Readonly<{
  ordinal: number;
  slotName: string;
  semanticRole: string;
  valueDescription: string;
  isOptional: boolean;
}>;

export type SensaPublicUsagePatternSnapshot = Readonly<{
  contentReleaseId: string;
  usagePatternId: string;
  senseVersionId: string;
  ordinal: number;
  canonicalPattern: string;
  commonCollocations: ReadonlyArray<string>;
  registerLabel: string | null;
  domainLabel: string | null;
  usageRestriction: string | null;
  sourceEvidenceRefs: SensaNonEmptyStringArray;
  slots: ReadonlyArray<SensaPublicUsagePatternSlot>;
  reviewStatus: "approved";
}>;

export type SensaPublicProfileBoundaryTarget = Readonly<{
  senseRelationId: string;
  ordinal: number;
  isRequired: boolean;
}>;

export type SensaPublicAcquisitionProfileSnapshot = Readonly<{
  contentReleaseId: string;
  acquisitionProfileId: string;
  senseVersionId: string;
  learnerLocale: string;
  schemaVersion: string;
  acquisitionNeeds: SensaNonEmptyArray<SensaPublicAcquisitionNeed>;
  minimumSufficientExperience: string;
  distinguishingFeatures: SensaNonEmptyStringArray;
  preferredPrimitives: SensaNonEmptyArray<SensaPublicAcquisitionPrimitive>;
  requiredAssetCapabilities: ReadonlyArray<SensaPublicAssetCapability>;
  optionalAssetCapabilities: ReadonlyArray<SensaPublicAssetCapability>;
  fallbackPrimitives: ReadonlyArray<SensaPublicAcquisitionPrimitive>;
  domainBound: boolean;
  domainConstraints: ReadonlyArray<string>;
  boundaryTargets: ReadonlyArray<SensaPublicProfileBoundaryTarget>;
  sourceDigest: string;
  profileProvenance: SensaPublicProfileProvenance;
  reviewStatus: "approved";
}>;

type SensaPublicSenseAssetBase = Readonly<{
  learningAssetId: string;
  contentReleaseId: string;
  senseVersionId: string;
  learnerLocale: string;
  contentDigest: string;
  reviewStatus: "approved";
  provenance: SensaPublicAssetProvenance;
}>;

type SensaPublicLexemeAssetBase = Readonly<{
  learningAssetId: string;
  contentReleaseId: string;
  lexemeVersionId: string;
  learnerLocale: string | null;
  contentDigest: string;
  reviewStatus: "approved";
  provenance: SensaPublicAssetProvenance;
}>;

export type SensaPublicExperienceSketchAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "experience_sketch";
    body: string;
  }>;

export type SensaPublicL1BridgeAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "l1_bridge";
    body: string;
  }>;

export type SensaPublicBoundaryNoteAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "boundary_note";
    body: string;
    senseRelationId: string;
  }>;

export type SensaPublicExampleAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "example";
    ordinal: number;
    textL2: string;
    textL1: string;
    targetForm: string;
    targetStart: number;
    targetEnd: number;
    construction:
      | "head_verb"
      | "nonfinite_verb"
      | "passive"
      | "subject"
      | "object"
      | "prep_object"
      | "predicative"
      | "modifier"
      | "adverbial";
    sceneDomain:
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
    disambiguatingCue: string | null;
    collocations: ReadonlyArray<string>;
    variationNote: string | null;
    role: "study" | "quiz";
    contextL2: string | null;
    contextL1: string | null;
  }>;

export type SensaPublicContrastCaseAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "contrast_pair" | "counterexample";
    senseRelationId: string;
    positiveTextL2: string;
    positiveTextL1: string;
    negativeTextL2: string;
    negativeTextL1: string;
    distinguishingFeature: string;
  }>;

export type SensaPublicVisualGroundingAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "visual_grounding";
    media: SensaPublicMediaReference;
    altText: string;
    distinguishingFeature: string;
  }>;

export type SensaPublicSpatialDiagramAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "spatial_diagram";
    figureLabel: string;
    groundLabel: string;
    pathDescription: string;
    topology: string;
    textFallback: string;
    startDescription: string | null;
    endpointDescription: string | null;
    contrastRelationId: string | null;
  }>;

export type SensaPublicSequenceStep = Readonly<{
  ordinal: number;
  label: string;
  description: string;
}>;

/** Runtime schemas enforce at least two steps for sequence assets. */
export type SensaAtLeastTwoArray<T> = ReadonlyArray<T>;

export type SensaPublicSequenceAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "causal_sequence" | "temporal_sequence";
    textFallback: string;
    steps: SensaAtLeastTwoArray<SensaPublicSequenceStep>;
  }>;

export type SensaPublicPronunciationAudioAsset =
  & SensaPublicLexemeAssetBase
  & Readonly<{
    kind: "pronunciation_audio";
    senseVersionId: null;
    media: SensaPublicMediaReference;
    sourceExampleAssetId: null;
    accentLocale: string | null;
    provider: string | null;
    model: string | null;
    voice: string | null;
    sourceTextDigest: string;
    durationMs: number;
  }>;

export type SensaPublicExampleAudioAsset =
  & SensaPublicSenseAssetBase
  & Readonly<{
    kind: "study_example_audio" | "extended_audio";
    media: SensaPublicMediaReference;
    sourceExampleAssetId: string | null;
    accentLocale: string;
    provider: string;
    model: string;
    voice: string;
    sourceTextDigest: string;
    durationMs: number;
  }>;

export type SensaPublicLearningAsset =
  | SensaPublicExperienceSketchAsset
  | SensaPublicL1BridgeAsset
  | SensaPublicBoundaryNoteAsset
  | SensaPublicExampleAsset
  | SensaPublicContrastCaseAsset
  | SensaPublicVisualGroundingAsset
  | SensaPublicSpatialDiagramAsset
  | SensaPublicSequenceAsset
  | SensaPublicPronunciationAudioAsset
  | SensaPublicExampleAudioAsset;

export type SensaPublicManifestRequirement = Readonly<{
  manifestRequirementId: string;
  requirementKey: string;
  capability: SensaPublicAssetCapability;
  requiredCount: number;
  satisfiedCount: number;
  matchedResourceIds: SensaNonEmptyStringArray;
  status: "satisfied";
}>;

export type SensaPublicRequiredAssetManifest = Readonly<{
  requiredAssetManifestId: string;
  contentReleaseId: string;
  senseVersionId: string;
  acquisitionProfileId: string;
  validatorVersion: string;
  capabilityResolverVersion: string;
  status: "satisfied";
  packageDigest: string;
  validatedAt: string;
  requirements: SensaNonEmptyArray<SensaPublicManifestRequirement>;
}>;

export type SensaPublicSenseLearningPackageSnapshot = Readonly<{
  packageDigest: string;
  contentRelease: SensaPublicContentReleaseReference;
  lexeme: SensaPublicLexemeSnapshot;
  sense: SensaPublicSenseSnapshot;
  relations: ReadonlyArray<SensaPublicSenseRelationSnapshot>;
  /** Empty when evidence is insufficient and the Profile does not require it. */
  usagePatterns: ReadonlyArray<SensaPublicUsagePatternSnapshot>;
  acquisitionProfile: SensaPublicAcquisitionProfileSnapshot;
  learningAssets: SensaNonEmptyArray<SensaPublicLearningAsset>;
  requiredAssetManifest: SensaPublicRequiredAssetManifest;
}>;

/** Every page item is a complete immutable package snapshot, not an ID list. */
export type SensaPublicContentReleaseItem = Readonly<{
  ordinal: number;
  package: SensaPublicSenseLearningPackageSnapshot;
}>;

export type SensaPublicContentReleasePageInput = Readonly<{
  /** Required launch-gate anchor; the adapter must verify this Book is live. */
  bookVersionId: string;
  contentReleaseId: string;
  cursor: SensaCatalogCursor | null;
  pageSize: number;
}>;

export type SensaPublicContentReleasePage = Readonly<{
  book: SensaPublicBookSummary;
  contentRelease: SensaPublicContentReleaseReference;
  items: ReadonlyArray<SensaPublicContentReleaseItem>;
  nextCursor: SensaCatalogCursor | null;
  hasMore: boolean;
}>;

export interface SensaCatalogModule {
  listPublicBooks(
    input: SensaPublicBookListInput,
  ): Promise<SensaPublicBookListPage>;

  getPublicBookManifest(
    input: SensaPublicBookManifestInput,
  ): Promise<SensaPublicBookManifest>;

  /**
   * The adapter must reject unless the published Book Version identified by
   * `bookVersionId` has a launch-eligible lexemeCount and pins exactly the
   * requested published Content Release.  Release ID alone is never a public
   * authorization path.
   */
  getPublicContentReleasePage(
    input: SensaPublicContentReleasePageInput,
  ): Promise<SensaPublicContentReleasePage>;
}

/**
 * Pinned content is intentionally separate from public Catalog discovery.
 * A learner's active Study Plan may continue to read an immutable retired
 * Book Version and superseded Content Release.
 */
export const sensaPinnedContentContractVersion = "sensa-pinned-content-v1" as const;

export type SensaPinnedContentReleaseReference = Omit<
  SensaPublicContentReleaseReference,
  "status"
> & Readonly<{
  status: "published" | "superseded";
}>;

export type SensaPinnedBookSummary = Omit<
  SensaPublicBookSummary,
  "contentRelease" | "status" | "lexemeCount"
> & Readonly<{
  contentRelease: SensaPinnedContentReleaseReference;
  lexemeCount: number;
  status: "published" | "retired";
}>;

export type SensaPinnedSenseLearningPackageSnapshot = Omit<
  SensaPublicSenseLearningPackageSnapshot,
  "contentRelease"
> & Readonly<{
  contentRelease: SensaPinnedContentReleaseReference;
}>;

export type SensaPinnedContentIdentity = Readonly<{
  studyPlanId: string;
  bookVersionId: string;
  contentReleaseId: string;
  manifestDigest: string;
  targetLanguage: string;
  learnerLocale: string;
}>;

export type SensaPinnedContentItem = Readonly<{
  ordinal: number;
  package: SensaPinnedSenseLearningPackageSnapshot;
}>;

export type SensaPinnedContentManifest = SensaPinnedContentIdentity & Readonly<{
  book: SensaPinnedBookSummary;
  contentRelease: SensaPinnedContentReleaseReference;
  members: ReadonlyArray<SensaPublicBookManifestMember>;
}>;

export type SensaPinnedContentPage = SensaPinnedContentIdentity & Readonly<{
  book: SensaPinnedBookSummary;
  contentRelease: SensaPinnedContentReleaseReference;
  items: ReadonlyArray<SensaPinnedContentItem>;
  nextCursor: SensaCatalogCursor | null;
  hasMore: boolean;
}>;

export type SensaPinnedContentManifestInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  studyPlanId: string;
}>;

export type SensaPinnedContentPageInput = SensaPinnedContentManifestInput & Readonly<{
  cursor: SensaCatalogCursor | null;
  pageSize: number;
}>;

/**
 * One member's complete package, addressed by Sense.  The manifest is the
 * index a client can hold entirely in memory; this is how it fetches the body
 * of a single entry without walking the ordinal pages that precede it.
 */
export type SensaPinnedContentSingleItem = SensaPinnedContentIdentity & Readonly<{
  book: SensaPinnedBookSummary;
  contentRelease: SensaPinnedContentReleaseReference;
  item: SensaPinnedContentItem;
}>;

export type SensaPinnedContentItemInput = SensaPinnedContentManifestInput & Readonly<{
  senseId: string;
}>;

export interface SensaPinnedContentModule {
  getManifest(input: SensaPinnedContentManifestInput): Promise<SensaPinnedContentManifest>;
  getPage(input: SensaPinnedContentPageInput): Promise<SensaPinnedContentPage>;
  getItem(input: SensaPinnedContentItemInput): Promise<SensaPinnedContentSingleItem>;
}
