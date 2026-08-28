import type { ResolvedStudyAsset, StudyAsset } from "../features/study/resolveActionView";

/*
 * Narrowing helpers over the Action's resolved asset list. Every lookup here is
 * by the reference's role -- the Action's own ordered, closed list -- and never
 * by scanning the Package, which is the rule these renderers exist to keep.
 */

export type SensaExampleAsset = Extract<StudyAsset, { kind: "example" }>;
export type SensaAudioAsset = Extract<StudyAsset, { kind: "study_example_audio" | "extended_audio" }>;
export type SensaPronunciationAsset = Extract<StudyAsset, { kind: "pronunciation_audio" }>;
export type SensaBoundaryAsset = Extract<StudyAsset, { kind: "contrast_pair" | "counterexample" }>;

export function byRole(
  assets: readonly ResolvedStudyAsset[],
  role: string,
): readonly ResolvedStudyAsset[] {
  return assets.filter((entry) => entry.reference.role === role);
}

export function firstByRole(
  assets: readonly ResolvedStudyAsset[],
  role: string,
): ResolvedStudyAsset | null {
  return assets.find((entry) => entry.reference.role === role) ?? null;
}

export function bodyOf(entry: ResolvedStudyAsset | null): string | null {
  if (entry === null) return null;
  const asset = entry.asset;
  return asset.kind === "experience_sketch" || asset.kind === "l1_bridge" ? asset.body : null;
}

export function exampleOf(entry: ResolvedStudyAsset | null): SensaExampleAsset | null {
  return entry !== null && entry.asset.kind === "example" ? entry.asset : null;
}

export function boundaryOf(entry: ResolvedStudyAsset | null): SensaBoundaryAsset | null {
  if (entry === null) return null;
  const asset = entry.asset;
  return asset.kind === "contrast_pair" || asset.kind === "counterexample" ? asset : null;
}

/** Pairs each study example with the audio asset the Action bound to it. */
export function pairExamplesWithAudio(
  assets: readonly ResolvedStudyAsset[],
): readonly Readonly<{ example: ResolvedStudyAsset; audio: ResolvedStudyAsset | null }>[] {
  const audio = byRole(assets, "study_example_audio");
  return byRole(assets, "study_example").map((example) => ({
    example,
    audio: audio.find((entry) => {
      const asset = entry.asset;
      return (asset.kind === "study_example_audio" || asset.kind === "extended_audio")
        && asset.sourceExampleAssetId === example.asset.learningAssetId;
    }) ?? null,
  }));
}

export type SensaExampleCard = Readonly<{
  example: SensaExampleAsset;
  /** Null when no Action currently references audio for this example. */
  audioAssetId: string | null;
  source: string;
}>;

function sourceLabel(asset: SensaExampleAsset): string {
  const provenance = asset.provenance;
  if (provenance.sourceAttribution !== null) return `${provenance.sourceAttribution} · 已审核`;
  if (provenance.generatorModel !== null) return "AI 生成情境 · 已审核";
  return "已审核内容";
}

/**
 * Example cards for an open Action: audio is addressable because the Action
 * referenced it, so the media capability endpoint will answer for these ids.
 */
export function exampleCardsFromAction(
  assets: readonly ResolvedStudyAsset[],
): readonly SensaExampleCard[] {
  return pairExamplesWithAudio(assets).flatMap((pair) => {
    const example = exampleOf(pair.example);
    return example === null
      ? []
      : [{ example, audioAssetId: pair.audio?.asset.learningAssetId ?? null, source: sourceLabel(example) }];
  });
}

/**
 * Example cards for browsing a Sense outside an Encounter. Audio is
 * deliberately unavailable: a media URL is issued against an Action, and there
 * is no Action here, so offering a play button would be offering nothing.
 */
export function exampleCardsFromPackage(
  assets: readonly StudyAsset[],
): readonly SensaExampleCard[] {
  return assets
    .flatMap((asset) => asset.kind === "example" && asset.role === "study" ? [asset] : [])
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((example) => ({ example, audioAssetId: null, source: sourceLabel(example) }));
}
