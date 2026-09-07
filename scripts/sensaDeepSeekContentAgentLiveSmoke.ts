import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";

import { stableUuid } from "@sensa/learning-kernel";

import { createContentAgentProvisioningModule } from "../apps/web-next/src/learningRuntime/contentAgentProvisioning.ts";
import {
  createLightweightReferenceFactLookupTool,
  provisionLightweightInitialContentWithAgent,
} from "../apps/web-next/src/learningRuntime/lightweightAgenticProvisioning.ts";
import type { LightweightInitialContentInput } from "../apps/web-next/src/learningRuntime/lightweightInitialContent.ts";
import { assembleLightweightInitialPresentation } from "../apps/web-next/src/learningRuntime/lightweightInitialPresentation.ts";
import {
  createLightweightInitialProtocolRun,
  currentLightweightInitialStep,
  transitionLightweightInitialProtocol,
} from "../apps/web-next/src/learningRuntime/lightweightInitialProtocol.ts";
import { createDeepSeekContentAgentModelAdapter } from "./support/deepSeekContentAgentAdapter.ts";

const main = async (): Promise<void> => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY is not configured; no paid live request was made.");
    process.exitCode = 2;
    return;
  }

const requestedAt = new Date().toISOString();
const id = (value: string): string => stableUuid(`deepseek-content-agent-live-smoke:${value}`);
const contentInput: LightweightInitialContentInput = {
  learnerUserId: "deepseek-live-smoke-learner",
  learningTargetId: id("target:tactful"),
  senseId: id("sense:tactful"),
  senseVersionId: id("sense:tactful:v1"),
  senseExpressionBindingId: id("binding:tactful"),
  resolvedLearningPlanRevisionId: "deepseek-live-smoke-plan-v1",
  expressionSourceVersion: "deepseek-live-smoke-expression-v1",
  senseSourceVersion: "deepseek-live-smoke-sense-v1",
  expression: {
    surface: "tactful",
    languageTag: "en",
    expressionKind: "word",
  },
  sense: {
    meaning: "表达真实意见时照顾对方感受，避免让对方难堪。",
    familiarLanguageTag: "zh-CN",
  },
  originExperience: {
    source: "personal_anchor",
    sourceVersion: "deepseek-live-smoke-personal-anchor-v1",
    personalAnchorUseGrantId: id("personal-anchor-use-grant"),
    experience: {
      scene: "同事的方案有明显问题，你想坦诚指出，但也想给他留面子。",
      senseFocus: "真实表达意见，同时照顾对方感受。",
      featureLabels: ["坦诚", "留面子"],
    },
  },
  referenceFacts: [],
  requestedAt,
};

const referenceTool = createLightweightReferenceFactLookupTool({
  facts: [
    {
      source: "dictionary",
      sourceVersion: "deepseek-live-smoke-dictionary-v1",
      fact: {
        factKind: "language_structure",
        expressionTypeLabel: "adjective",
        partOfSpeech: "adjective",
      },
    },
    {
      source: "corpus",
      sourceVersion: "deepseek-live-smoke-corpus-v1",
      fact: {
        factKind: "usage_example",
        example: "She gave tactful feedback on his proposal.",
      },
    },
  ],
});
const deepSeekModelAdapter = createDeepSeekContentAgentModelAdapter({
  apiKey,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  maxOutputTokens: 4_096,
  reasoningEffort: "high",
  thinking: "enabled",
});
const modelAdapter = Object.freeze({
  provider: deepSeekModelAdapter.provider,
  model: deepSeekModelAdapter.model,
  complete: async (...args: Parameters<typeof deepSeekModelAdapter.complete>) => {
    try {
      return await deepSeekModelAdapter.complete(...args);
    } catch (error) {
      console.error(JSON.stringify({
        phase: "deepseek_model_call",
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});
const agentModule = createContentAgentProvisioningModule({
  modelAdapter,
  toolAdapters: [referenceTool],
});

const result = await provisionLightweightInitialContentWithAgent({
  contentInput,
  agentModule,
  approvedTools: [referenceTool.definition],
  requireReferenceLookup: true,
});

if (result.status !== "ready") {
  console.error(JSON.stringify({
    status: result.status,
    taskStatus: result.task.status,
    attemptStatus: result.attempt.status,
    failureCode: result.attempt.failureCode,
    issueCodes: result.issues.map((issue) => issue.code),
    bundleSubmitted: result.bundle !== null,
  }, null, 2));
  process.exit(1);
}

assert.ok(result.attempt.usage.modelTurns >= 2, "Live Agent must perform a tool turn and a submission turn.");
assert.ok(result.bundle.toolCalls.length >= 1, "Live Agent must call an approved reference tool.");
assert.equal(result.bundle.toolCalls.every((call) => call.status === "succeeded"), true);
assert.equal(result.task.learningMaterializationId, result.materialization.snapshot.learningMaterializationId);

const protocol = createLightweightInitialProtocolRun({
  protocolRunId: "deepseek-live-smoke:protocol-run",
  retentionTargetId: id("retention-target:tactful"),
  learningMaterializationId: result.materialization.snapshot.learningMaterializationId,
  materialResources: result.materialization.content.resources,
});
const recallStep = currentLightweightInitialStep(protocol);
assert.ok(recallStep);
const recallPresentation = assembleLightweightInitialPresentation(
  recallStep,
  result.materialization,
);
assert.equal(recallPresentation.kind, "experience_recall");
const revealState = transitionLightweightInitialProtocol(
  protocol,
  "reveal_requested",
).state;
const revealStep = currentLightweightInitialStep(revealState);
assert.ok(revealStep);
const revealPresentation = assembleLightweightInitialPresentation(
  revealStep,
  result.materialization,
);
assert.equal(revealPresentation.kind, "expression_reveal");
assert.equal(revealPresentation.slots.expressionPrimary.surface, "tactful");

  if(process.env.SENSA_SAVE_CONTENT_TRIAL==='1'){
    const directory='content/data/consumer-generations';await mkdir(directory,{recursive:true});
    await writeFile(directory+'/tactful-trial.json',JSON.stringify({content:result.materialization.content,provider:result.attempt.provider,model:result.attempt.model,usage:result.attempt.usage,generatedAt:new Date().toISOString()},null,2));
  }
  console.log(JSON.stringify({
    status: result.status,
    provider: result.attempt.provider,
    model: result.attempt.model,
    modelTurns: result.attempt.usage.modelTurns,
    toolCalls: result.bundle.toolCalls.map((call) => `${call.toolKey}@${call.toolVersion}`),
    supportingArtifactCount: result.bundle.supportingContextArtifacts.length,
    candidateRoles: result.bundle.candidates.map((candidate) => candidate.materialRoleKey),
    omittedRoles: result.bundle.omissions.map((omission) => omission.materialRoleKey),
    materializationId: result.materialization.snapshot.learningMaterializationId,
    runtimePresentations: [recallPresentation.kind, revealPresentation.kind],
  }, null, 2));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
