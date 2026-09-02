import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateGoldenContentBundle } from '@sensa/content-validator/authoring';
import { fragileGoldenBundle } from '../apps/web-next/src/content/fragileGoldenBundle.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const validDraft = validateGoldenContentBundle(fragileGoldenBundle);
assert(validDraft.previewable, 'The fragile draft must be previewable.');
assert(validDraft.status === 'incomplete', 'A draft awaiting human review must remain incomplete.');
assert(validDraft.bundle !== null, 'A structurally valid draft must return its parsed Bundle.');
assert(!validDraft.issues.some((issue) => issue.severity === 'invalid'), 'The fragile draft must have no invalid issues.');

const fragilePackage = validDraft.bundle.packages[0];
assert(fragilePackage, 'The fragile Bundle must contain its Sense Package.');
assert(
  fragilePackage.acquisitionProfile.preferredPrimitives.includes('causal_sequence'),
  'The fragile Profile must prefer the causal-sequence teaching mechanism.',
);
const experienceRenderKinds = new Set(fragilePackage.experience.renders.map((render) => render.kind));
for (const requiredKind of ['text', 'image', 'sequence', 'interaction']) {
  assert(experienceRenderKinds.has(requiredKind), `The full tracer must include a ${requiredKind} Experience Render.`);
}

const imageMedia = validDraft.bundle.media.find((media) => media.kind === 'image');
assert(imageMedia?.sha256, 'The image Render must resolve to image media with a SHA-256 digest.');
const imageBytes = readFileSync(new URL(
  '../content/data/media/images/fragile/experience-physical-care-v1.png',
  import.meta.url,
));
const imageDigest = `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`;
assert(imageDigest === imageMedia.sha256, 'The local generated image must match the authored media digest.');

const preferredSelection = fragilePackage.experience.renderPlan.selections.find((selection) =>
  selection.role === 'preferred');
assert(
  preferredSelection?.renderKey === 'fragile.experience.render.interaction.v1',
  'The interaction must be the preferred fragile Experience Render.',
);
const textFallbackSelection = fragilePackage.experience.renderPlan.selections.find((selection) =>
  selection.role === 'fallback');
assert(
  textFallbackSelection?.renderKey === 'fragile.experience.render.text.v1',
  'The text Experience Render must be the approved fallback.',
);

const exposedTransfer = structuredClone(fragileGoldenBundle);
const transfer = exposedTransfer.packages[0]?.examples.find((item) =>
  item.roles.includes('transfer_assessment'));
assert(transfer, 'The smoke fixture must contain a protected Transfer Example.');
transfer.visibility = 'learning_only';

const exposedTransferResult = validateGoldenContentBundle(exposedTransfer);
assert(exposedTransferResult.status === 'invalid', 'An exposed Transfer Example must invalidate the Bundle.');
assert(
  exposedTransferResult.issues.some((issue) => issue.code === 'example.transfer_not_protected'),
  'The validator must report protected Transfer exposure.',
);

const brokenSpan = structuredClone(fragileGoldenBundle);
const firstExample = brokenSpan.packages[0]?.examples[0];
assert(firstExample, 'The smoke fixture must contain a Study Example.');
firstExample.target.start += 1;

const brokenSpanResult = validateGoldenContentBundle(brokenSpan);
assert(brokenSpanResult.status === 'invalid', 'An incorrect target span must invalidate the Bundle.');
assert(
  brokenSpanResult.issues.some((issue) => issue.code === 'example.target_span_invalid'),
  'The validator must report the incorrect target span.',
);

const wrongMediaKind = structuredClone(fragileGoldenBundle);
const authoredImage = wrongMediaKind.media.find((media) => media.kind === 'image');
assert(authoredImage, 'The smoke fixture must contain image media.');
authoredImage.kind = 'audio';
const wrongMediaKindResult = validateGoldenContentBundle(wrongMediaKind);
assert(wrongMediaKindResult.status === 'invalid', 'An Image Render pointing at audio media must invalidate the Bundle.');
assert(
  wrongMediaKindResult.issues.some((issue) => issue.code === 'reference.media_kind_mismatch'),
  'The validator must report media kind mismatches.',
);

const missingFallback = structuredClone(fragileGoldenBundle);
const fallbackSelection = missingFallback.packages[0]?.experience.renderPlan.selections.find((selection) =>
  selection.role === 'fallback');
assert(fallbackSelection, 'The smoke fixture must contain a fallback Render selection.');
fallbackSelection.role = 'alternative';
const missingFallbackResult = validateGoldenContentBundle(missingFallback);
assert(missingFallbackResult.status === 'invalid', 'A Render Plan without fallback must invalidate the Bundle.');
assert(
  missingFallbackResult.issues.some((issue) => issue.code === 'render.text_scene_fallback_missing'),
  'The validator must report a missing Text Experience Render fallback.',
);

const unauthorizedPrimitive = structuredClone(fragileGoldenBundle);
const imageRender = unauthorizedPrimitive.packages[0]?.experience.renders.find((render) =>
  render.kind === 'image');
assert(imageRender, 'The smoke fixture must contain an Image Render.');
imageRender.primitive = 'spatial_relation';
const unauthorizedPrimitiveResult = validateGoldenContentBundle(unauthorizedPrimitive);
assert(unauthorizedPrimitiveResult.status === 'invalid', 'An undeclared Render Primitive must invalidate the Bundle.');
assert(
  unauthorizedPrimitiveResult.issues.some((issue) => issue.code === 'render.primitive_unauthorized'),
  'The validator must report an undeclared Render Primitive.',
);

const missingRequiredAsset = structuredClone(fragileGoldenBundle);
missingRequiredAsset.packages[0]?.acquisitionProfile.requiredAssetCapabilities.push('pronunciation');
const missingRequiredAssetResult = validateGoldenContentBundle(missingRequiredAsset);
assert(
  missingRequiredAssetResult.issues.some((issue) => issue.code === 'capability.required_asset_missing'),
  'The validator must report an unresolved required Asset Capability.',
);

console.log(JSON.stringify({
  validatorVersion: validDraft.validatorVersion,
  draftStatus: validDraft.status,
  previewable: validDraft.previewable,
  packages: validDraft.bundle.packages.length,
  experienceRenderKinds: [...experienceRenderKinds].sort(),
  preferredRender: preferredSelection.renderKey,
  fallbackRender: textFallbackSelection.renderKey,
  imageDigestVerified: true,
  pendingReviewIssues: validDraft.issues.filter((issue) => issue.code === 'review.pending').length,
  transferExposureRejected: true,
  incorrectTargetSpanRejected: true,
  mediaKindMismatchRejected: true,
  missingFallbackRejected: true,
  unauthorizedPrimitiveRejected: true,
  missingRequiredAssetReported: true,
}, null, 2));
