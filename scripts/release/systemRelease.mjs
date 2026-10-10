/**
 * Plan and record one coherent Sensa production release.
 *
 * This module never deploys. GitHub Actions remains the only production
 * executor; this file owns the deterministic decision and evidence formats.
 */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {appendFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {candidateArtifactName} from './candidateSource.mjs';

export const systemReleasePlanFormat = "sensa-system-release-plan-v2";
export const systemReleaseManifestFormat = "sensa-system-release-manifest-v2";
export const automaticReleasePolicyFormat = "sensa-automatic-release-policy-v1";
const previousSystemReleaseManifestFormats = new Set([
  "sensa-system-release-manifest-v1",
  systemReleaseManifestFormat,
]);

const fullSha = /^[a-f0-9]{40}$/u;
const mediaTag = /^sensa-learning-media-([a-f0-9]{12,64})$/u;
const releaseIdPattern = /^sensa-system-[a-f0-9]{12}-[1-9][0-9]*-[1-9][0-9]*$/u;

const operationalPrefixes = [
  ".github/",
  "docs/",
  "tests/",
  "scripts/release/",
];
const operationalFiles = new Set([
  ".gitignore",
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "content/README.md",
  "infra/README.md",
  "playwright.config.ts",
]);
const sharedPrefixes = [
  "packages/contracts/",
  "packages/content-validator/",
  "packages/learning-kernel/",
];
const contentReleaseScripts = new Set([
  "scripts/release/buildAuthoredMediaPack.mts",
  "scripts/release/buildPortableBookRegistry.mts",
  "scripts/release/learningContentBucket.mjs",
  "scripts/release/publishPortableLearningRegistry.mjs",
]);
const applicationPrefixes = [
  "apps/",
  "db/",
  "infra/",
  "packages/mcp-server/",
  "packages/model-runtime/",
  "supabase/",
];
const applicationFiles = new Set([
  "scripts/prepareWebMedia.mjs",
  "wrangler.jsonc",
]);
const automaticAuthorizationFiles = new Map([
  ["wrangler.jsonc", "Cloudflare production configuration"],
  ["apps/api/src/server/environment.ts", "production service configuration contract"],
]);
const automaticAuthorizationPrefixes = new Map([
  ["apps/api/src/auth/", "API authentication authority"],
  ["apps/api/src/sensa/access/", "API authorization or access-control authority"],
  ["db/migrations/", "database schema or data migration"],
  ["infra/", "production infrastructure or trust configuration"],
  ["supabase/", "Supabase project or Edge entry configuration"],
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

function assertFullSha(value, label) {
  if (!fullSha.test(value ?? "")) throw new Error(`${label} must be a full Git commit SHA`);
  return value;
}

function assertPreviousManifest(value) {
  if (!value) return null;
  if (!previousSystemReleaseManifestFormats.has(value.format)
    || !releaseIdPattern.test(value.releaseId ?? "")
    || !fullSha.test(value.source?.commit ?? "")
    || !value.components?.application
    || !value.components?.learningContent) {
    throw new Error("Previous system release manifest is incomplete or unsupported");
  }
  return value;
}

/** Return the production component(s) a path can change. Unknown source paths
 * are deliberately coupled; release automation must fail safe as the repo grows. */
export function classifyReleasePath(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("..")) {
    throw new Error("Release change path must be repository-relative");
  }
  if (contentReleaseScripts.has(path) || path.startsWith("content/") && path !== "content/README.md") {
    return "learning-content";
  }
  if (operationalFiles.has(path) || operationalPrefixes.some((prefix) => path.startsWith(prefix))) {
    return "operational";
  }
  if (sharedPrefixes.some((prefix) => path.startsWith(prefix))) return "coupled";
  if (applicationFiles.has(path) || applicationPrefixes.some((prefix) => path.startsWith(prefix))) {
    return "application";
  }
  if (path.startsWith("scripts/")) return "operational";
  return "coupled";
}

export function classifyReleaseChanges(paths) {
  const changes = [...new Set(paths)].sort().map((path) => ({
    path,
    impact: classifyReleasePath(path),
  }));
  const application = changes.some(({impact}) => impact === "application" || impact === "coupled");
  const learningContent = changes.some(({impact}) => impact === "learning-content" || impact === "coupled");
  return {changes, application, learningContent};
}

function selectedComponents(scope, required, hasPrevious, allowNoop) {
  if (!hasPrevious && scope !== "all" && scope !== "auto") {
    throw new Error("The first unified release must use scope=all so both production components are recorded");
  }
  const selected = scope === "auto"
    ? {...required}
    : {application: scope === "application" || scope === "all", learningContent: scope === "content" || scope === "all"};
  if (required.application && !selected.application) {
    throw new Error("Application changes cannot be omitted from this release");
  }
  if (required.learningContent && !selected.learningContent) {
    throw new Error("Learning-content changes cannot be omitted from this release");
  }
  if (!selected.application && !selected.learningContent && (!allowNoop || scope !== "auto" || !hasPrevious)) {
    throw new Error("No production component changed; choose an explicit scope only when intentionally republishing");
  }
  return selected;
}

function releaseAuthorization(mode, classified, hasPrevious) {
  if (mode === "manual") {
    return {
      format: automaticReleasePolicyFormat,
      mode: "explicit-owner",
      outcome: "approved",
      reasons: ["The owner explicitly authorized this exact revision and requested scope."],
    };
  }
  if (mode !== "automatic") throw new Error("Release mode must be automatic or manual");
  const blockers = [];
  if (!hasPrevious) blockers.push("the first system release requires an explicitly authorized full bootstrap");
  if (classified.learningContent) {
    blockers.push("learning-content publication still requires a separately sealed authored-media input");
  }
  for (const {path, impact} of classified.changes) {
    if (impact === "operational") continue;
    const exact = automaticAuthorizationFiles.get(path);
    if (exact) blockers.push(`${path} changes ${exact}`);
    for (const [prefix, reason] of automaticAuthorizationPrefixes) {
      if (path.startsWith(prefix)) blockers.push(`${path} changes ${reason}`);
    }
  }
  if (blockers.length > 0) {
    return {format: automaticReleasePolicyFormat, mode: 'automatic-policy', outcome: 'requires-approval', reasons: [...new Set(blockers)]};
  }
  return {
    format: automaticReleasePolicyFormat,
    mode: "automatic-policy",
    outcome: classified.application ? "approved" : "no-op",
    reasons: classified.application
      ? ["A green main CI candidate contains application-only changes allowed by the standing release policy."]
      : ["The revision contains no production component changes; production state is carried forward unchanged."],
  };
}

function verifiedMediaInput(tag, digest) {
  const match = mediaTag.exec(tag ?? "");
  if (!match || !/^[a-f0-9]{64}$/u.test(digest ?? "") || !digest.startsWith(match[1])) {
    throw new Error("A content release requires a sealed media tag and its matching full SHA-256");
  }
  return {releaseTag: tag, sha256: digest};
}

export function planSystemRelease({
  targetCommit,
  previousManifest = null,
  requestedScope = "auto",
  releaseMode = "manual",
  changedPaths,
  mediaReleaseTag = "",
  mediaPackSha256 = "",
  releaseId,
  createdAt = new Date().toISOString(),
}) {
  assertFullSha(targetCommit, "Target release");
  if (!new Set(["auto", "application", "content", "all"]).has(requestedScope)) {
    throw new Error("Release scope must be auto, application, content or all");
  }
  if (!releaseIdPattern.test(releaseId ?? "")) throw new Error("System release id is invalid");
  const previous = assertPreviousManifest(previousManifest);
  const classified = classifyReleaseChanges(changedPaths);
  if (releaseMode === "automatic" && requestedScope !== "auto") {
    throw new Error("Automatic releases must use scope=auto");
  }
  const authorization = releaseAuthorization(releaseMode, classified, Boolean(previous));
  const required = previous
    ? {application: classified.application, learningContent: classified.learningContent}
    : {application: true, learningContent: true};
  const awaitingApproval = authorization.outcome === 'requires-approval';
  const selected = awaitingApproval ? {application: false, learningContent: false}
    : selectedComponents(requestedScope, required, Boolean(previous), releaseMode === "automatic");
  const contentInput = selected.learningContent
    ? verifiedMediaInput(mediaReleaseTag, mediaPackSha256)
    : null;
  const decision = awaitingApproval ? 'awaiting-approval' : selected.application && selected.learningContent
    ? "coupled"
    : selected.application ? "application-only" : selected.learningContent ? "content-only" : "no-op";
  return {
    format: systemReleasePlanFormat,
    releaseId,
    createdAt,
    source: {
      commit: targetCommit,
      baseCommit: previous?.source.commit ?? null,
      changes: classified.changes,
    },
    previousRelease: previous ? {
      releaseId: previous.releaseId,
      components: clone(previous.components),
    } : null,
    authorization,
    request: {scope: requestedScope},
    decision: {
      kind: decision,
      requiredComponents: required,
      deployApplication: selected.application,
      publishLearningContent: selected.learningContent,
      compatibility: awaitingApproval ? 'No production mutation is authorized; explicit approval and any sealed content input are still required.' : decision === "coupled"
        ? "Both components are promoted in one workflow; shared contract changes must remain rolling-compatible."
        : decision === "no-op"
          ? "No production component is promoted; both component identities are carried from the previous release."
          : "The unchanged component is reused from the previous successful system release.",
    },
    inputs: {learningContent: contentInput},
  };
}

function assertPlan(plan) {
  if (plan?.format !== systemReleasePlanFormat
    || !releaseIdPattern.test(plan.releaseId ?? "")
    || !fullSha.test(plan.source?.commit ?? "")
    || plan.authorization?.format !== automaticReleasePolicyFormat
    || !new Set(["automatic-policy", "explicit-owner"]).has(plan.authorization?.mode)
    || typeof plan.decision?.deployApplication !== "boolean"
    || typeof plan.decision?.publishLearningContent !== "boolean") {
    throw new Error("System release plan is incomplete or unsupported");
  }
}

function applicationComponent(plan, candidate, cloudflare, repository, source) {
  if (candidate?.format !== "sensa-release-candidate-v2"
    || candidate.commit !== plan.source.commit
    || candidate.provenance?.repository !== repository
    || !/^[1-9][0-9]*$/u.test(candidate.provenance?.workflowRunId ?? "")
    || !/^[1-9][0-9]*$/u.test(candidate.provenance?.workflowRunAttempt ?? "")
    || !Array.isArray(candidate.files)
    || candidate.files.length === 0
    || candidate.database?.format !== "sensa-forward-migration-set-v1"
    || !/^[a-f0-9]{64}$/u.test(candidate.database.sha256 ?? "")) {
    throw new Error("Application candidate evidence does not match the release plan");
  }
  if (cloudflare?.format !== "sensa-cloudflare-version-v1"
    || cloudflare.releaseSha !== plan.source.commit
    || typeof cloudflare.versionId !== "string"
    || cloudflare.versionId === "") {
    throw new Error("Cloudflare promotion evidence does not match the release plan");
  }
  if (source?.format !== 'sensa-ci-candidate-source-v1' || source.repository !== repository
    || source.commit !== candidate.commit || source.workflowRunId !== candidate.provenance.workflowRunId
    || source.buildAttempt !== candidate.provenance.workflowRunAttempt
    || !Number.isSafeInteger(Number(source.validationAttempt)) || Number(source.validationAttempt) < Number(source.buildAttempt)
    || source.artifactName !== candidateArtifactName(candidate.commit, source.buildAttempt)
    || !Number.isSafeInteger(source.artifactId) || source.artifactId < 1
    || !/^sha256:[a-f0-9]{64}$/.test(source.artifactDigest ?? '')) throw Error('CI candidate source evidence does not match the built artifact');
  return {
    kind: "application",
    sourceCommit: plan.source.commit,
    candidate: {
      format: candidate.format,
      manifestSha256: sha256(`${JSON.stringify(candidate, null, 2)}\n`),
      fileCount: candidate.files.length,
      workflowRunId: candidate.provenance.workflowRunId,
      workflowRunAttempt: candidate.provenance.workflowRunAttempt,
      validationRunAttempt: source.validationAttempt,
      artifactId: source.artifactId,
      artifactName: source.artifactName,
      artifactDigest: source.artifactDigest,
    },
    web: {provider: "cloudflare-workers", versionId: cloudflare.versionId},
    api: {provider: "supabase-edge-functions", releaseSha: plan.source.commit},
    targets: {
      webOrigin: candidate.webOrigin,
      apiUrl: candidate.apiUrl,
      supabaseOrigin: candidate.supabaseOrigin,
      supportUrl: candidate.supportUrl,
    },
    database: {
      migrationPolicy: "forward-only",
      migrationSetSha256: candidate.database.sha256,
      migrationCount: candidate.database.count,
      latestMigration: candidate.database.latest,
    },
  };
}

function learningContentComponent(plan, publication) {
  if (publication?.format !== "sensa-portable-learning-content-publication-v2"
    || publication.releaseSha !== plan.source.commit
    || !/^[a-f0-9]{64}$/u.test(publication.registryRevision ?? "")
    || !Array.isArray(publication.bookVersions)
    || !Number.isInteger(publication.packageCount)
    || publication.packageCount < 0) {
    throw new Error("Learning-content publication evidence does not match the release plan");
  }
  let registryUrl;
  try {
    registryUrl = new URL(publication.registryUrl);
  } catch {
    throw new Error("Learning-content publication URL is invalid");
  }
  if (registryUrl.protocol !== "https:") throw new Error("Learning-content publication URL must use HTTPS");
  return {
    kind: "learning-content",
    sourceCommit: plan.source.commit,
    registry: {revision: publication.registryRevision, url: registryUrl.href},
    bookVersions: clone(publication.bookVersions),
    packageCount: publication.packageCount,
  };
}

export function finalizeSystemRelease({
  plan,
  applicationCandidate = null,
  ciCandidateSource = null,
  cloudflareVersion = null,
  learningContentPublication = null,
  completedAt = new Date().toISOString(),
  repository,
  workflowRunId,
  workflowRunAttempt,
}) {
  assertPlan(plan);
  if (plan.authorization.outcome === 'requires-approval') throw Error('An awaiting-approval plan is not a successful release');
  const previousComponents = plan.previousRelease?.components;
  const application = plan.decision.deployApplication
    ? applicationComponent(plan, applicationCandidate, cloudflareVersion, repository, ciCandidateSource)
    : clone(previousComponents?.application);
  const learningContent = plan.decision.publishLearningContent
    ? learningContentComponent(plan, learningContentPublication)
    : clone(previousComponents?.learningContent);
  if (!application || !learningContent) {
    throw new Error("A successful system release must identify both production components");
  }
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository ?? "")
    || !/^[1-9][0-9]*$/u.test(String(workflowRunId ?? ""))
    || !/^[1-9][0-9]*$/u.test(String(workflowRunAttempt ?? ""))) {
    throw new Error("GitHub release evidence is incomplete");
  }
  return {
    format: systemReleaseManifestFormat,
    releaseId: plan.releaseId,
    completedAt,
    source: {
      commit: plan.source.commit,
      baseCommit: plan.source.baseCommit,
      changes: clone(plan.source.changes),
    },
    previousReleaseId: plan.previousRelease?.releaseId ?? null,
    authorization: clone(plan.authorization),
    decision: clone(plan.decision),
    components: {application, learningContent},
    evidence: {
      repository,
      workflowRunId: String(workflowRunId),
      workflowRunAttempt: String(workflowRunAttempt),
      workflowRunUrl: `https://github.com/${repository}/actions/runs/${workflowRunId}`,
    },
  };
}

function git(root, args) {
  return execFileSync("git", args, {cwd: root, encoding: "utf8"});
}

function changedPaths(root, targetCommit, previousManifest) {
  if (!previousManifest) {
    return git(root, ["ls-tree", "-r", "--name-only", targetCommit]).split("\n").filter(Boolean);
  }
  const base = assertFullSha(previousManifest.source.commit, "Previous release");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, targetCommit], {cwd: root, stdio: "ignore"});
  } catch {
    throw new Error("Previous system release is not an ancestor of the requested revision");
  }
  return git(root, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, targetCommit])
    .split("\n").filter(Boolean);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendOutputs(plan) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, [
    `release_sha=${plan.source.commit}`,
    `deploy_application=${plan.decision.deployApplication}`,
    `publish_learning_content=${plan.decision.publishLearningContent}`,
    `release_id=${plan.releaseId}`,
    `authorization_outcome=${plan.authorization.outcome}`,
    "",
  ].join("\n"));
}

async function appendSummary(plan) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const impacted = plan.source.changes.filter(({impact}) => impact !== "operational").length;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "### Sensa release plan",
    "",
    `- Release: \`${plan.releaseId}\``,
    `- Revision: \`${plan.source.commit}\``,
    `- Decision: \`${plan.decision.kind}\``,
    `- Authorization: \`${plan.authorization.mode}\` (\`${plan.authorization.outcome}\`)`,
    `- Production-impacting paths: ${impacted}`,
    ...plan.authorization.reasons.map(reason => `- Policy: ${reason}`),
    "",
  ].join("\n"));
}

async function planFromEnvironment(root) {
  const targetCommit = assertFullSha(process.env.SENSA_RELEASE_SHA, "Target release");
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (head !== targetCommit) throw new Error("Checked-out revision does not match the planned release");
  const previousPath = process.env.SENSA_PREVIOUS_RELEASE_MANIFEST?.trim();
  const previousManifest = previousPath ? await readJson(resolve(root, previousPath)) : null;
  const plan = planSystemRelease({
    targetCommit,
    previousManifest,
    requestedScope: process.env.SENSA_RELEASE_SCOPE ?? "auto",
    releaseMode: process.env.SENSA_RELEASE_MODE ?? "manual",
    changedPaths: changedPaths(root, targetCommit, previousManifest),
    mediaReleaseTag: process.env.SENSA_MEDIA_RELEASE_TAG,
    mediaPackSha256: process.env.SENSA_MEDIA_PACK_SHA256,
    releaseId: process.env.SENSA_SYSTEM_RELEASE_ID,
  });
  const output = resolve(root, process.env.SENSA_RELEASE_PLAN_OUTPUT ?? "release-candidate/system-release-plan.json");
  await writeJson(output, plan);
  await appendOutputs(plan);
  await appendSummary(plan);
  console.log(`Planned ${plan.decision.kind} release ${plan.releaseId}.`);
}

async function uniqueJson(directory, basename) {
  const {readdir} = await import("node:fs/promises");
  async function visit(path) {
    const entries = await readdir(path, {withFileTypes: true});
    const nested = await Promise.all(entries.map((entry) => {
      const child = resolve(path, entry.name);
      return entry.isDirectory() ? visit(child) : entry.name === basename ? [child] : [];
    }));
    return nested.flat();
  }
  const matches = await visit(resolve(directory));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${basename} in release evidence`);
  return readJson(matches[0]);
}

async function finalizeFromEnvironment(root) {
  const plan = await uniqueJson(
    resolve(root, process.env.SENSA_RELEASE_PLAN_DIRECTORY ?? ".tmp/system-release-plan"),
    "system-release-plan.json",
  );
  const applicationDirectory = process.env.SENSA_APPLICATION_EVIDENCE_DIRECTORY;
  const contentDirectory = process.env.SENSA_CONTENT_EVIDENCE_DIRECTORY;
  const manifest = finalizeSystemRelease({
    plan,
    applicationCandidate: plan.decision.deployApplication
      ? await uniqueJson(resolve(root, applicationDirectory), "manifest.json") : null,
    ciCandidateSource: plan.decision.deployApplication
      ? await uniqueJson(resolve(root, process.env.SENSA_RELEASE_PLAN_DIRECTORY ?? '.tmp/system-release-plan'), 'ci-candidate-source.json') : null,
    cloudflareVersion: plan.decision.deployApplication
      ? await uniqueJson(resolve(root, applicationDirectory), "cloudflare-version.json") : null,
    learningContentPublication: plan.decision.publishLearningContent
      ? await uniqueJson(resolve(root, contentDirectory), "portable-learning-content-publication.json") : null,
    repository: process.env.GITHUB_REPOSITORY,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  const output = resolve(root, process.env.SENSA_RELEASE_MANIFEST_OUTPUT ?? "release-candidate/system-release-manifest.json");
  await writeJson(output, manifest);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "### Production release recorded",
      "",
      `- System release: \`${manifest.releaseId}\``,
      `- Application: \`${manifest.components.application.sourceCommit}\``,
      `- Learning Registry: \`${manifest.components.learningContent.registry.revision}\``,
      "",
    ].join("\n"));
  }
  console.log(`Recorded successful system release ${manifest.releaseId}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  const root = process.cwd();
  try {
    if (command === "plan") await planFromEnvironment(root);
    else if (command === "finalize") await finalizeFromEnvironment(root);
    else throw new Error("Usage: node scripts/release/systemRelease.mjs plan|finalize");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
