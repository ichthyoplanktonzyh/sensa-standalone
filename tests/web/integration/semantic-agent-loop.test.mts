import {test} from 'vitest';
/** Static boundary smoke for the native clarification Agent. No browser/network/model calls. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test("semantic-agent-loop", async () => {

const runner=await readFile('apps/web/src/experience/personalMeaningJourney/realSemanticAgent.ts','utf8');
const contract=await readFile('apps/web/src/experience/personalMeaningJourney/semanticAgent.ts','utf8');
const screen=await readFile('apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx','utf8');
const world=await readFile('apps/web/src/experience/components/ContentScreen.tsx','utf8');
const app=await readFile('apps/web/src/experience/App.tsx','utf8');
const learningWorkspace=await readFile('apps/web/src/experience/library/LearningWorkspace.tsx','utf8');
const route=await readFile('apps/api/src/sensa/models/turn.ts','utf8');
const modelProtocol=await readFile('packages/contracts/src/sensa/modelProtocol.ts','utf8');

assert(runner.includes('MAX_STEPS = 6'));
assert(runner.includes("name: 'organize_answer'"));
assert(runner.includes("name: 'reply_to_learner'"));
assert(runner.includes("complete(provider, 'teacher', executionId, messages, teacherTools, modelSignal)"));
assert(!runner.includes('openingReplyPrompt'));
assert(!runner.includes('isOpeningReply'));
assert(runner.includes('parseOrganizedAnswer'));
assert(runner.includes('parseLearnerReply'));
assert(!runner.includes('projectionPrompt'));
assert(!runner.includes('responseFormat'));
assert(!runner.includes("name: 'lookup_meanings'"));
assert(route.includes('teacher:[...SENSA_TEACHER_AGENT_TOOLS]'));
assert(!runner.includes("name: 'lookup_reference_facts'"));
assert(modelProtocol.includes("'organize_answer','reply_to_learner'"));
assert(!contract.includes("SemanticAgentTurnMode = 'chat' | 'consolidate'"));
assert(contract.includes('onAssistantText?: (text: string) => void'));
assert(runner.includes('input.onAssistantText?.(reply)'));
assert(screen.includes('streamingAssistant'));
assert(modelProtocol.includes('stream: z.literal(false)'));
assert(modelProtocol.includes('modelTurnStreamEventSchema'));
assert(route.includes("app.post('/turn/stream'"));
assert(!screen.includes("runTurn(session, undefined, 'consolidate')"));
assert(screen.includes('NewMeaningConversationScreen'));
assert(screen.includes('ContextCard'));
assert(screen.includes('ConfirmedExpressionDetail'));
assert(screen.includes('gateway.reviseContext'));
assert(screen.includes('if (allConfirmed) return;'));
assert(screen.includes('const textSegment = context.summary.trim()'));
assert(!screen.includes('const conversationText = messages'));
assert(world.includes('confirmedExpressionFor(item)'));
assert(screen.includes('maxImages={MAX_SCENE_IMAGES}'));
assert(learningWorkspace.includes('onStartConversation={startSensaConversation}'));
assert(
 learningWorkspace.includes('worldAction:undefined'),
 'opening clarification must consume the one-shot create action so Back cannot immediately reopen it',
);
assert(app.includes('onConversationCreated={openPersonalMeaning}'));

console.log('PASS: native Sensa entry and Inbox clarification use one bounded teacher loop with separate proposal and visible-reply tools; no model/paid calls.');

});
