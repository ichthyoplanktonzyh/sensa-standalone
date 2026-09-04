import { stableUuid } from '@sensa/learning-kernel';

import {
  createContentAgentProvisioningModule,
  type ContentAgentConversationMessage,
  type ContentAgentModelAdapter,
  type ContentAgentModelTurn,
} from './contentAgentProvisioning';
import {
  LIGHTWEIGHT_REFERENCE_FACT_LOOKUP_TOOL,
  createLightweightReferenceFactLookupTool,
  provisionLightweightInitialContentWithAgent,
} from './lightweightAgenticProvisioning';
import type { LightweightInitialContentInput } from './lightweightInitialContent';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const fixedNow = '2026-09-04T08:00:00.000Z';
const id = (value: string): string => stableUuid(`agentic-provisioning-smoke:${value}`);

const contentInput = (targetKey: string, expression: string): LightweightInitialContentInput => ({
  learnerUserId: 'agentic-smoke-learner',
  learningTargetId: id(`${targetKey}:target`),
  senseId: id(`${targetKey}:sense`),
  senseVersionId: id(`${targetKey}:sense:v1`),
  senseExpressionBindingId: id(`${targetKey}:binding`),
  resolvedLearningPlanRevisionId: `${targetKey}:plan:v1`,
  expressionSourceVersion: `${targetKey}:expression:v1`,
  senseSourceVersion: `${targetKey}:sense:v1`,
  expression: {
    surface: expression,
    languageTag: 'en',
    expressionKind: 'word',
  },
  sense: {
    meaning: '表达真实意见时照顾对方感受，避免让对方难堪。',
    familiarLanguageTag: 'zh-CN',
  },
  originExperience: {
    source: 'personal_anchor',
    sourceVersion: `${targetKey}:personal-anchor:v1`,
    personalAnchorUseGrantId: id(`${targetKey}:use-grant`),
    experience: {
      scene: '同事的方案有明显问题，你想坦诚指出，但也想给他留面子。',
      senseFocus: '真实表达意见，同时照顾对方感受。',
      featureLabels: ['坦诚', '留面子'],
    },
  },
  referenceFacts: [],
  requestedAt: fixedNow,
});

const userPayload = (messages: readonly ContentAgentConversationMessage[]) => {
  const user = messages.find((message) => message.role === 'user');
  if (!user || user.role !== 'user') throw new Error('Scripted model did not receive Task input.');
  return JSON.parse(user.content) as {
    initialContextArtifacts: Array<{
      artifactId: string;
      contextKind: string;
    }>;
  };
};

const modelTurn = (
  toolCalls: ContentAgentModelTurn['toolCalls'],
): ContentAgentModelTurn => ({
  content: null,
  reasoningContent: null,
  toolCalls,
  inputTokens: 100,
  outputTokens: 50,
});

let successfulModelTurns = 0;
const successfulModel: ContentAgentModelAdapter = {
  provider: 'scripted-smoke-provider',
  model: 'scripted-content-agent-v1',
  complete: async ({ messages, tools }) => {
    successfulModelTurns += 1;
    check('模型只看到请求批准的工具与系统提交工具',
      tools.some((tool) => tool.toolKey === LIGHTWEIGHT_REFERENCE_FACT_LOOKUP_TOOL.toolKey)
      && tools.some((tool) => tool.toolKey === 'submit_material_candidate_bundle')
      && tools.length === 2);
    const toolMessage = [...messages].reverse().find((message) => message.role === 'tool');
    if (!toolMessage || toolMessage.role !== 'tool') {
      return modelTurn([{
        toolCallId: 'smoke-reference-call',
        toolKey: LIGHTWEIGHT_REFERENCE_FACT_LOOKUP_TOOL.toolKey,
        argumentsJson: JSON.stringify({
          factKinds: ['language_structure', 'usage_example'],
        }),
      }]);
    }
    const task = userPayload(messages);
    const senseArtifactId = task.initialContextArtifacts.find((artifact) =>
      artifact.contextKind === 'sense_snapshot')!.artifactId;
    const experienceArtifactId = task.initialContextArtifacts.find((artifact) =>
      artifact.contextKind === 'origin_experience')!.artifactId;
    const toolResult = JSON.parse(toolMessage.content) as {
      supportingContextArtifacts: Array<{
        artifactId: string;
        payload: { factKind?: string };
      }>;
    };
    const structureArtifactId = toolResult.supportingContextArtifacts.find((artifact) =>
      artifact.payload.factKind === 'language_structure')!.artifactId;
    const usageArtifactId = toolResult.supportingContextArtifacts.find((artifact) =>
      artifact.payload.factKind === 'usage_example')!.artifactId;
    return modelTurn([{
      toolCallId: 'smoke-submit-call',
      toolKey: 'submit_material_candidate_bundle',
      argumentsJson: JSON.stringify({
        candidates: [
          {
            materialRoleKey: 'experience_recall_cue',
            ordinal: 0,
            contentPayload: {
              scene: '会议上你需要指出方案的问题，同时让同事感到被尊重。',
              senseFocus: '坦诚表达，但照顾对方感受。',
            },
            sourceArtifactIds: [senseArtifactId, experienceArtifactId],
          },
          {
            materialRoleKey: 'language_structure',
            ordinal: 0,
            contentPayload: {
              expressionKind: 'word',
              expressionTypeLabel: 'adjective',
              partOfSpeech: 'adjective',
            },
            sourceArtifactIds: [senseArtifactId, structureArtifactId],
          },
          {
            materialRoleKey: 'usage_guidance',
            ordinal: 0,
            contentPayload: {
              example: 'She gave tactful feedback on his proposal.',
            },
            sourceArtifactIds: [senseArtifactId, usageArtifactId],
          },
        ],
        omissions: [
          {
            materialRoleKey: 'recall_support',
            reasonCode: 'not_needed',
            rationale: '经验线索已经足够清晰。',
          },
          {
            materialRoleKey: 'pronunciation',
            reasonCode: 'objective_fact_unavailable',
            rationale: '没有获得可靠发音事实。',
          },
          {
            materialRoleKey: 'scene_bridge',
            reasonCode: 'not_needed',
            rationale: '示例已经完成场景连接。',
          },
        ],
      }),
    }]);
  },
};

const referenceTool = createLightweightReferenceFactLookupTool({
  facts: [
    {
      source: 'dictionary',
      sourceVersion: 'smoke-dictionary-v1',
      fact: {
        factKind: 'language_structure',
        expressionTypeLabel: 'adjective',
        partOfSpeech: 'adjective',
      },
    },
    {
      source: 'corpus',
      sourceVersion: 'smoke-corpus-v1',
      fact: {
        factKind: 'usage_example',
        example: 'She gave tactful feedback on his proposal.',
      },
    },
  ],
});

const successfulModule = createContentAgentProvisioningModule({
  modelAdapter: successfulModel,
  toolAdapters: [referenceTool],
  now: () => fixedNow,
});
const successful = await provisionLightweightInitialContentWithAgent({
  contentInput: contentInput('success', 'tactful'),
  agentModule: successfulModule,
  approvedTools: [referenceTool.definition],
  requireReferenceLookup: true,
  now: () => fixedNow,
});

check('Agent 经一次工具调用和一次提交后终止',
  successful.status === 'ready'
  && successfulModelTurns === 2
  && successful.attempt.status === 'submitted'
  && successful.attempt.usage.modelTurns === 2
  && successful.attempt.usage.toolCalls === 1);
check('工具结果冻结为 Bundle supporting artifact 并保留调用 provenance',
  successful.status === 'ready'
  && successful.bundle.supportingContextArtifacts.length === 2
  && successful.bundle.toolCalls.length === 1
  && successful.bundle.toolCalls[0]?.status === 'succeeded'
  && successful.bundle.supportingContextArtifacts.every((artifact) =>
    artifact.producerToolCallId === successful.bundle.toolCalls[0]?.toolCallId));
check('Agent 提交不等于 ready；独立 admission 后才产生 Materialization',
  successful.status === 'ready'
  && successful.task.status === 'ready'
  && successful.task.learningMaterializationId
    === successful.materialization.snapshot.learningMaterializationId
  && successful.bundle.materialCandidateBundleId
    === successful.materialization.snapshot.provenance.materialCandidateBundleId);
check('Runtime 内容只保留已校验的 role-indexed resources',
  successful.status === 'ready'
  && successful.materialization.content.resources.some((resource) =>
    resource.materialRoleKey === 'experience_recall_cue')
  && successful.materialization.content.resources.some((resource) =>
    resource.materialRoleKey === 'usage_guidance'));

const leakingModel: ContentAgentModelAdapter = {
  provider: 'scripted-smoke-provider',
  model: 'scripted-leaking-agent-v1',
  complete: async ({ messages }) => {
    const task = userPayload(messages);
    const senseArtifactId = task.initialContextArtifacts.find((artifact) =>
      artifact.contextKind === 'sense_snapshot')!.artifactId;
    return modelTurn([{
      toolCallId: 'leaking-submit-call',
      toolKey: 'submit_material_candidate_bundle',
      argumentsJson: JSON.stringify({
        candidates: [{
          materialRoleKey: 'experience_recall_cue',
          ordinal: 0,
          contentPayload: {
            scene: '请回想你需要 tactful 地提出意见的时刻。',
            senseFocus: '照顾感受。',
          },
          sourceArtifactIds: [senseArtifactId],
        }],
        omissions: [
          { materialRoleKey: 'recall_support', reasonCode: 'none', rationale: '不需要。' },
          { materialRoleKey: 'pronunciation', reasonCode: 'none', rationale: '没有事实。' },
          { materialRoleKey: 'language_structure', reasonCode: 'none', rationale: '不需要。' },
          { materialRoleKey: 'usage_guidance', reasonCode: 'none', rationale: '不需要。' },
          { materialRoleKey: 'scene_bridge', reasonCode: 'none', rationale: '不需要。' },
        ],
      }),
    }]);
  },
};
const leakingModule = createContentAgentProvisioningModule({
  modelAdapter: leakingModel,
  toolAdapters: [],
  now: () => fixedNow,
});
const leaking = await provisionLightweightInitialContentWithAgent({
  contentInput: contentInput('leaking', 'tactful'),
  agentModule: leakingModule,
  approvedTools: [],
  now: () => fixedNow,
});

check('Agent 可成功提交，但独立 validator 仍拒绝 pre-reveal Expression 泄露',
  leaking.status === 'blocked'
  && leaking.attempt.status === 'submitted'
  && leaking.bundle !== null
  && leaking.task.status === 'blocked'
  && leaking.task.blockedReasonCode === 'candidate_bundle_invalid'
  && leaking.issues.some((issue) => issue.code === 'candidate_rejected'));

const retried = await provisionLightweightInitialContentWithAgent({
  contentInput: contentInput('leaking', 'tactful'),
  agentModule: successfulModule,
  approvedTools: [referenceTool.definition],
  priorTask: leaking.task,
  requireReferenceLookup: true,
  now: () => fixedNow,
});
check('Bundle 被拒绝后由同一 Task 创建新 Attempt，旧 Attempt identity 保留',
  retried.status === 'ready'
  && retried.task.contentProvisioningTaskId === leaking.task.contentProvisioningTaskId
  && retried.attempt.contentAgentAttemptId !== leaking.attempt.contentAgentAttemptId
  && retried.attempt.sequence === 2
  && retried.task.attemptIds.length === 2
  && retried.task.attemptIds[0] === leaking.attempt.contentAgentAttemptId
  && retried.task.attemptIds[1] === retried.attempt.contentAgentAttemptId);

const rogueModel: ContentAgentModelAdapter = {
  provider: 'scripted-smoke-provider',
  model: 'scripted-rogue-agent-v1',
  complete: async () => modelTurn([{
    toolCallId: 'rogue-call',
    toolKey: 'arbitrary_network_access',
    argumentsJson: '{}',
  }]),
};
const rogueModule = createContentAgentProvisioningModule({
  modelAdapter: rogueModel,
  toolAdapters: [],
  now: () => fixedNow,
});
const rogue = await provisionLightweightInitialContentWithAgent({
  contentInput: contentInput('rogue', 'tactful'),
  agentModule: rogueModule,
  approvedTools: [],
  now: () => fixedNow,
});

check('未批准工具不能因模型请求而获得执行权限',
  rogue.status === 'blocked'
  && rogue.bundle === null
  && rogue.attempt.status === 'failed'
  && rogue.attempt.failureCode === 'unapproved_tool_requested');

if (failures.length > 0) {
  console.error(`content-agent provisioning smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`content-agent provisioning smoke OK (${checks} checks)`);
