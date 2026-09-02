import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGoldenContentDraftV2 } from "@sensa/content-validator/authoring-draft-v2";
import { validateRuntimeLearningRelease } from "@sensa/content-validator/runtime";
import type {
  SensaGoldenContentDraftV2Bundle,
  SensaRuntimeLearningRelease,
} from "@sensa/contracts/sensa";
import { goldenDraftV2Bundle } from "../apps/web-next/src/content/goldenDraftV2Bundle.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(
  scriptDirectory,
  "../apps/web-next/src/content/releases/golden-learning-release-v1.json",
);
const runtimeDeliveryProfile = "sensa-web-prototype-acquisition-v1";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Remove authoring-only governance metadata without interpreting content. */
function stripAuthoringMetadata<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripAuthoringMetadata(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const projected = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "provenance")
        .map(([key, item]) => [key, stripAuthoringMetadata(item)]),
    );
    return projected as T;
  }
  return value;
}

type RuntimePresentationVariant =
  | "physical_threshold"
  | "continuation_timeline"
  | "receiver_transfer"
  | "provider_transfer";

/**
 * Add only delivery metadata that is derived from the closed renderer
 * vocabulary.  All Sense-specific labels and object facts stay in the
 * authoring payload; this table never inspects a lexeme or subject.
 */
const runtimeStageClassByVariant: Record<RuntimePresentationVariant, string> = {
  physical_threshold: "physical",
  continuation_timeline: "process",
  receiver_transfer: "borrow",
  provider_transfer: "lend",
};

function projectInteractionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const presentation = payload.runtimePresentation;
  if (presentation === null || typeof presentation !== "object" || Array.isArray(presentation)) {
    throw new Error("Interaction Render is missing its runtime presentation descriptor.");
  }
  const variant = (presentation as Record<string, unknown>).variant;
  if (!(typeof variant === "string" && variant in runtimeStageClassByVariant)) {
    throw new Error(`Interaction Render has an unsupported runtime presentation variant: ${String(variant)}`);
  }
  return {
    ...payload,
    runtimePresentation: {
      ...presentation,
      stageClassName: runtimeStageClassByVariant[variant as RuntimePresentationVariant],
    },
  };
}

function compilePackage(
  item: SensaGoldenContentDraftV2Bundle["packages"][number],
): SensaRuntimeLearningRelease["packages"][number] {
  const projected = stripAuthoringMetadata(item);
  return {
    ...projected,
    schemaVersion: "sensa-sense-learning-package-v1",
    experience: {
      ...projected.experience,
      renders: projected.experience.renders.map((render) => {
        const deliveryRender = {
          ...render,
          supportedDeliveryProfiles: render.supportedDeliveryProfiles.map(() => runtimeDeliveryProfile),
        };
        return render.kind === "interaction"
          ? {
              ...deliveryRender,
              payload: projectInteractionPayload(render.payload),
            }
          : deliveryRender;
      }),
    },
  } as SensaRuntimeLearningRelease["packages"][number];
}

function compile(
  draft: SensaGoldenContentDraftV2Bundle,
): SensaRuntimeLearningRelease {
  const sourceDigest = sha256(stableJson(draft));
  return {
    schemaVersion: "sensa-runtime-learning-release-v1",
    release: {
      releaseKey: draft.release.releaseKey,
      version: draft.release.version,
      targetLanguage: draft.release.targetLanguage,
      learnerLocale: draft.release.learnerLocale,
      deliveryProfileVersion: runtimeDeliveryProfile,
      validatorVersion: "sensa-runtime-learning-release-validator-v1",
      capabilityResolverVersion: "sensa-executable-learning-capability-resolver-v1",
      sourceDigest,
    },
    media: draft.media.map((media) => stripAuthoringMetadata(media)),
    lexemes: draft.lexemes.map((lexeme) => stripAuthoringMetadata(lexeme)),
    relations: draft.relations.map((relation) => stripAuthoringMetadata(relation)),
    packages: draft.packages.map(compilePackage),
  } as SensaRuntimeLearningRelease;
}

const draft = goldenDraftV2Bundle as unknown as SensaGoldenContentDraftV2Bundle;
const draftResult = validateGoldenContentDraftV2(draft);
if (!draftResult.previewable || draftResult.bundle === null) {
  throw new Error(
    `Cannot compile Golden Draft V2: ${draftResult.issues.map((issue) => `${issue.code}@${issue.path}`).join(", ")}`,
  );
}

const release = compile(draftResult.bundle);
const runtimeResult = validateRuntimeLearningRelease(release);
if (runtimeResult.status !== "satisfied") {
  throw new Error(
    `Compiled runtime release is invalid: ${runtimeResult.issues.map((issue) => `${issue.code}@${issue.path}`).join(", ")}`,
  );
}

const output = resolve(process.argv[2] ?? defaultOutput);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(release, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  schemaVersion: release.schemaVersion,
  releaseKey: release.release.releaseKey,
  sourceDigest: release.release.sourceDigest,
  packages: release.packages.length,
  status: runtimeResult.status,
}, null, 2));

// Keep the import visible to bundlers that execute this script from a built
// package, while making accidental empty output obvious during local runs.
if (readFileSync(output, "utf8").trim().length === 0) {
  throw new Error(`Compiler wrote an empty release: ${output}`);
}
