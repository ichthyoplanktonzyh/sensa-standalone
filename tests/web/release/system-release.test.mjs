import {test} from "vitest";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

import {
  automaticReleasePolicyFormat,
  classifyReleaseChanges,
  finalizeSystemRelease,
  planSystemRelease,
  systemReleaseManifestFormat,
} from "../../../scripts/release/systemRelease.mjs";

const sha = (character) => character.repeat(40);
const digest = (character) => character.repeat(64);
const releaseId = (commit = sha("b")) => `sensa-system-${commit.slice(0, 12)}-123-1`;
const previous = {
  format: systemReleaseManifestFormat,
  releaseId: releaseId(sha("a")),
  completedAt: "2026-09-28T00:00:00.000Z",
  source: {commit: sha("a"), baseCommit: null, changes: []},
  components: {
    application: {kind: "application", sourceCommit: sha("a"), web: {versionId: "old-web"}},
    learningContent: {
      kind: "learning-content",
      sourceCommit: sha("a"),
      registry: {revision: digest("1"), url: "https://fixture.supabase.co/registry.json"},
      bookVersions: [],
      packageCount: 0,
    },
  },
};
const media = {
  mediaReleaseTag: `sensa-learning-media-${digest("c").slice(0, 12)}`,
  mediaPackSha256: digest("c"),
};

test("system release planner separates independent components and couples shared contracts", () => {
  assert.deepEqual(classifyReleaseChanges([
    "apps/web/src/App.tsx",
    "content/authored/book.json",
    "packages/contracts/src/sensa/catalog.ts",
    "docs/sensa/engineering.md",
  ]), {
    application: true,
    learningContent: true,
    changes: [
      {path: "apps/web/src/App.tsx", impact: "application"},
      {path: "content/authored/book.json", impact: "learning-content"},
      {path: "docs/sensa/engineering.md", impact: "operational"},
      {path: "packages/contracts/src/sensa/catalog.ts", impact: "coupled"},
    ],
  });

  const application = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["apps/api/src/app.ts"], releaseId: releaseId(),
  });
  assert.equal(application.decision.kind, "application-only");
  assert.equal(application.inputs.learningContent, null);
  assert.deepEqual(application.previousRelease.components.learningContent, previous.components.learningContent);

  const testConfiguration = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "application",
    changedPaths: ["apps/web/src/App.tsx", "playwright.config.ts"], releaseId: releaseId(),
  });
  assert.equal(testConfiguration.decision.kind, "application-only");
  assert.equal(testConfiguration.inputs.learningContent, null);
  assert.equal(testConfiguration.source.changes.find(({path}) => path === "playwright.config.ts").impact, "operational");
  // Only this known test configuration is excluded; unfamiliar source still couples releases.
  assert.throws(() => planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "application",
    changedPaths: ["unknown.config.ts"], releaseId: releaseId(),
  }), /Learning-content changes/u);

  assert.throws(() => planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["content/authored/book.json"], releaseId: releaseId(),
  }), /sealed media/u);
  const content = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["content/authored/book.json"], releaseId: releaseId(), ...media,
  });
  assert.equal(content.decision.kind, "content-only");
  assert.equal(content.inputs.learningContent.sha256, media.mediaPackSha256);

  assert.throws(() => planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "application",
    changedPaths: ["packages/contracts/src/sensa/catalog.ts"], releaseId: releaseId(),
  }), /Learning-content changes/u);
  const coupled = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["packages/contracts/src/sensa/catalog.ts"], releaseId: releaseId(), ...media,
  });
  assert.equal(coupled.decision.kind, "coupled");

  const fromLegacyManifest = planSystemRelease({
    targetCommit: sha("b"), previousManifest: {...previous, format: "sensa-system-release-manifest-v1"},
    requestedScope: "auto", changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(),
  });
  assert.equal(fromLegacyManifest.previousRelease.releaseId, previous.releaseId);
});

test("system release planner bootstraps safely and refuses meaningless manual releases", () => {
  assert.throws(() => planSystemRelease({
    targetCommit: sha("b"), requestedScope: "application",
    changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(),
  }), /first unified release/u);
  const bootstrap = planSystemRelease({
    targetCommit: sha("b"), requestedScope: "auto",
    changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(), ...media,
  });
  assert.equal(bootstrap.decision.kind, "coupled");
  assert.throws(() => planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["docs/sensa/engineering.md"], releaseId: releaseId(),
  }), /No production component changed/u);
});

test("standing policy automatically releases ordinary application changes and blocks new authority", () => {
  const application = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    releaseMode: "automatic", changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(),
  });
  assert.equal(application.authorization.format, automaticReleasePolicyFormat);
  assert.equal(application.authorization.mode, "automatic-policy");
  assert.equal(application.authorization.outcome, "approved");
  assert.equal(application.decision.kind, "application-only");

  const operational = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    releaseMode: "automatic", changedPaths: ["docs/sensa/engineering.md"], releaseId: releaseId(),
  });
  assert.equal(operational.authorization.outcome, "no-op");
  assert.equal(operational.decision.kind, "no-op");
  assert.equal(operational.decision.deployApplication, false);
  assert.equal(operational.decision.publishLearningContent, false);

  for (const changedPaths of [
    ["content/authored/book.json"],
    ["packages/contracts/src/sensa/catalog.ts"],
    ["db/migrations/0042_breaking.sql"],
    ["supabase/config.toml"],
    ["supabase/functions/sensa-api/index.ts"],
    ["wrangler.jsonc"],
    ["infra/certs/production.pem"],
    ["apps/api/src/auth/principal.ts"],
    ["apps/api/src/sensa/access/auth.ts"],
    ["apps/api/src/server/environment.ts"],
  ]) {
    const pending = planSystemRelease({
      targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
      releaseMode: "automatic", changedPaths, releaseId: releaseId(), ...media,
    });
    assert.equal(pending.authorization.outcome, 'requires-approval');
    assert.equal(pending.decision.kind, 'awaiting-approval');
    assert.equal(pending.decision.deployApplication, false);
    assert.equal(pending.decision.publishLearningContent, false);
    assert.throws(() => finalizeSystemRelease({plan: pending}), /not a successful release/u);
  }
  const bootstrapPending = planSystemRelease({
    targetCommit: sha("b"), requestedScope: "auto", releaseMode: "automatic",
    changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(), ...media,
  });
  assert.equal(bootstrapPending.authorization.outcome, 'requires-approval');
  assert.match(bootstrapPending.authorization.reasons[0], /full bootstrap/u);

  const explicit = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    releaseMode: "manual", changedPaths: ["db/migrations/0042_forward.sql"], releaseId: releaseId(),
  });
  assert.equal(explicit.authorization.mode, "explicit-owner");
  assert.equal(explicit.decision.kind, "application-only");
});

test("system release manifest records new evidence and carries an unchanged component", () => {
  const plan = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["apps/web/src/App.tsx"], releaseId: releaseId(),
  });
  const candidate = {
    format: "sensa-release-candidate-v2",
    commit: sha("b"),
    provenance: {
      repository: "sensa/example",
      workflowRunId: "100",
      workflowRunAttempt: "1",
    },
    webOrigin: "https://learn.example.com",
    apiUrl: "https://fixture.supabase.co/functions/v1/sensa-api",
    supabaseOrigin: "https://fixture.supabase.co",
    supportUrl: "mailto:support@example.com",
    database: {
      format: "sensa-forward-migration-set-v1",
      sha256: digest("4"),
      count: 1,
      latest: "db/migrations/0001_fixture.sql",
    },
    files: [{path: "apps/web/dist/index.html", bytes: 1, sha256: digest("2")}],
  };
  const manifest = finalizeSystemRelease({
    plan,
    applicationCandidate: candidate,
    ciCandidateSource: {format: 'sensa-ci-candidate-source-v1', repository: 'sensa/example', commit: sha('b'),
      workflowRunId: '100', buildAttempt: '1', validationAttempt: '2', artifactId: 9,
      artifactName: `sensa-production-${sha('b')}-attempt-1`, artifactDigest: 'sha256:' + digest('8')},
    cloudflareVersion: {
      format: "sensa-cloudflare-version-v1",
      releaseSha: sha("b"),
      versionId: "cloudflare-version-2",
    },
    repository: "sensa/example",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    completedAt: "2026-09-29T00:00:00.000Z",
  });
  assert.equal(manifest.format, systemReleaseManifestFormat);
  assert.equal(manifest.authorization.mode, "explicit-owner");
  assert.equal(manifest.components.application.sourceCommit, sha("b"));
  assert.equal(manifest.components.application.candidate.workflowRunId, "100");
  assert.equal(manifest.components.application.candidate.validationRunAttempt, '2');
  assert.equal(manifest.components.application.candidate.workflowRunAttempt, '1');
  assert.equal(manifest.components.application.web.versionId, "cloudflare-version-2");
  assert.equal(manifest.components.application.database.migrationSetSha256, digest("4"));
  assert.equal(manifest.components.application.targets.webOrigin, "https://learn.example.com");
  assert.deepEqual(manifest.components.learningContent, previous.components.learningContent);
  assert.equal(manifest.previousReleaseId, previous.releaseId);
  assert.match(manifest.evidence.workflowRunUrl, /actions\/runs\/123$/u);
});

test("system release manifest rejects mismatched component evidence", () => {
  const plan = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "content",
    changedPaths: ["content/authored/book.json"], releaseId: releaseId(), ...media,
  });
  assert.throws(() => finalizeSystemRelease({
    plan,
    learningContentPublication: {
      format: "sensa-portable-learning-content-publication-v2",
      releaseSha: sha("a"),
      registryRevision: digest("3"),
      registryUrl: "https://fixture.supabase.co/registry.json",
      bookVersions: [],
      packageCount: 0,
    },
    repository: "sensa/example",
    workflowRunId: "123",
    workflowRunAttempt: "1",
  }), /does not match/u);
});

test("system release manifest records a content-only promotion", () => {
  const plan = planSystemRelease({
    targetCommit: sha("b"), previousManifest: previous, requestedScope: "auto",
    changedPaths: ["content/authored/book.json"], releaseId: releaseId(), ...media,
  });
  const manifest = finalizeSystemRelease({
    plan,
    learningContentPublication: {
      format: "sensa-portable-learning-content-publication-v2",
      releaseSha: sha("b"),
      registryRevision: digest("5"),
      registryUrl: "https://fixture.supabase.co/storage/v1/object/public/content/registry.json",
      bookVersions: [{bookId: "fixture", bookVersionId: "version", bookArchiveSha256: digest("6")}],
      packageCount: 3,
    },
    repository: "sensa/example",
    workflowRunId: "124",
    workflowRunAttempt: "1",
  });
  assert.deepEqual(manifest.components.application, previous.components.application);
  assert.equal(manifest.components.learningContent.sourceCommit, sha("b"));
  assert.equal(manifest.components.learningContent.registry.revision, digest("5"));
  assert.equal(manifest.components.learningContent.packageCount, 3);
});

test("production promotes the exact application candidate tested by main CI", async () => {
  const [system, application, content, ci] = await Promise.all([
    readFile(new URL("../../../.github/workflows/sensa-release.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/sensa-web-deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/sensa-learning-content-publish.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/sensa-consumer-check.yml", import.meta.url), "utf8"),
  ]);
  assert.match(system, /workflow_dispatch:/u);
  assert.match(system, /workflow_run:/u);
  assert.match(system, /workflows: \[Sensa CI\]/u);
  assert.match(system, /github\.event\.workflow_run\.conclusion == 'success'/u);
  assert.match(system, /run\?\.head_repository\?\.full_name!==env\.GITHUB_REPOSITORY/u);
  assert.match(system, /SENSA_RELEASE_MODE: \$\{\{ github\.event_name == 'workflow_run' && 'automatic' \|\| 'manual' \}\}/u);
  assert.match(system, /github\.event_name == 'workflow_dispatch' && !inputs\.owner_accepted/u);
  assert.match(system, /--status success --limit 20/u);
  assert.ok(system.indexOf("Require green main CI for this revision") < system.indexOf("- uses: actions/checkout"),
    "the privileged workflow_run path must validate its same-repository main provenance before checkout");
  assert.match(system, /uses: \.\/\.github\/workflows\/sensa-web-deploy\.yml/u);
  assert.match(system, /uses: \.\/\.github\/workflows\/sensa-learning-content-publish\.yml/u);
  assert.match(system, /application:\n\s+needs: \[plan, learning_content\]/u,
    "content promotion precedes a coupled application promotion");
  assert.match(system, /candidate_run_id: \$\{\{ steps\.ci\.outputs\.run_id \}\}/u);
  assert.match(system, /candidate_run_attempt: \$\{\{ steps\.candidate\.outputs\.build_attempt \}\}/u);
  assert.match(system, /candidate_validation_attempt: \$\{\{ steps\.ci\.outputs\.run_attempt \}\}/u);
  assert.match(system, /node scripts\/release\/candidateSource\.mjs/u);
  assert.match(system, /candidate_run_id: \$\{\{ needs\.plan\.outputs\.candidate_run_id \}\}/u);
  assert.match(system, /candidate_run_attempt: \$\{\{ needs\.plan\.outputs\.candidate_run_attempt \}\}/u);
  assert.match(ci, /name: Build, seal and verify the main release candidate/u);
  assert.match(ci, /name: sensa-production-\$\{\{ github\.sha \}\}-attempt-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(application, /artifact-ids: \$\{\{ inputs\.candidate_artifact_id \}\}/u);
  assert.match(application, /merge-multiple: true/u);
  assert.match(system, /needs\.plan\.outputs\.authorization_outcome != 'requires-approval'/u);
  assert.match(application, /node scripts\/release\/releaseStatus\.mjs application/u);
  assert.match(system, /node scripts\/release\/releaseStatus\.mjs system/u);
  assert.match(ci, /node scripts\/release\/verifyCandidate\.mjs/u);
  assert.match(ci, /npx wrangler versions upload --dry-run --strict/u);
  assert.match(application, /run-id: \$\{\{ inputs\.candidate_run_id \}\}/u);
  assert.match(application, /github-token: \$\{\{ github\.token \}\}/u);
  assert.match(application, /SENSA_CANDIDATE_RUN_ID: \$\{\{ inputs\.candidate_run_id \}\}/u);
  assert.match(application, /SENSA_CANDIDATE_RUN_ATTEMPT: \$\{\{ inputs\.candidate_run_attempt \}\}/u);
  assert.doesNotMatch(application, /npm run build/u,
    "production must promote the tested CI artifact instead of rebuilding it");
  assert.match(application, /npx wrangler triggers deploy --name "\$CLOUDFLARE_WORKER_NAME"/u,
    "version promotion alone does not apply custom domains or the workers.dev boundary");
  assert.ok(application.indexOf('name: Promote Web version to production') < application.indexOf('name: Apply production domain routing'));
  assert.ok(application.indexOf('name: Apply production domain routing') < application.indexOf('name: Public non-model smoke'),
    "release smoke must exercise the deployed custom domain");
  assert.match(application, /VITE_SUPABASE_URL: \$\{\{ format\('https:\/\/\{0\}\.supabase\.co', vars\.SUPABASE_PROJECT_REF\) \}\}/u,
    "the production verifier must derive the Supabase origin from its approved project ref instead of requiring duplicate configuration");
  for (const executor of [application, content]) {
    assert.match(executor, /workflow_call:/u);
    assert.doesNotMatch(executor, /workflow_dispatch:/u);
  }
});
