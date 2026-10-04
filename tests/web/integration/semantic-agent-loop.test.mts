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
assert(runner.includes("name:'lookup_meanings'"));
assert(!runner.includes("name: 'organize_answer'"));
assert(!runner.includes("name: 'reply_to_learner'"));
assert(runner.includes("complete(provider,'teacher',executionId,messages,teacherTools,modelSignal,"));
assert(!runner.includes('openingReplyPrompt'));
assert(!runner.includes('isOpeningReply'));
assert(runner.includes('parseTeacherTurn'));
assert(runner.includes('teacherReplyPrefix'));
assert(!runner.includes('projectionPrompt'));
assert(runner.includes("responseFormat:'json_object'"));
assert(route.includes('teacher:[...SENSA_TEACHER_AGENT_TOOLS]'));
assert(!runner.includes("name: 'lookup_reference_facts'"));
assert(modelProtocol.includes("SENSA_TEACHER_AGENT_TOOLS=['lookup_meanings']"));
assert(!contract.includes("SemanticAgentTurnMode = 'chat' | 'consolidate'"));
assert(contract.includes('onAssistantText?: (text: string) => void'));
assert(runner.includes('input.onAssistantText?.(result.reply)'));
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
assert(screen.includes('if (!session.readyToConfirm || !context || !sense'));
assert(screen.includes('if (!detail || !session?.readyToConfirm || busy || !confirmedFocus'));
assert(screen.includes('session?.readyToConfirm && working.expression && alignment?.expressionCandidates.length'));
const contextAdapter=await readFile('apps/web/src/experience/personalMeaningJourney/clarificationContext.ts','utf8');
assert(screen.includes('completedContextForDraft(clarificationDraft, context,'));
assert(contextAdapter.includes('textSegment=context.summary.trim()'));
assert(!contextAdapter.includes('conversationText = messages'));
assert(!screen.includes('const conversationText = messages'));
assert(world.includes('confirmedExpressionFor(item)'));
assert(screen.includes('maxImages={MAX_SCENE_IMAGES}'));
assert(learningWorkspace.includes('onStartConversation={startSensaConversation}'));
assert(
 learningWorkspace.includes('worldAction:undefined'),
 'opening clarification must consume the one-shot create action so Back cannot immediately reopen it',
);
assert(learningWorkspace.includes('onConversationCreated={openPersonalMeaning}'));
assert(learningWorkspace.includes('alignmentLearningControls={(detail,alignment)'));
assert(!app.includes("'s-personal-meaning':"),'personal detail must share the explicit learning bridge controller, not a disconnected App renderer');

const inboxSource=await readFile('apps/web/src/experience/components/IntakeInboxDrawer.tsx','utf8');
assert(!inboxSource.includes("uiText('webSource')"),'Agent intake provenance must not be mislabeled as a webpage');
assert(inboxSource.includes('intakeSourceLabel(source)'),'Inbox delegates source presentation to the recorded-client formatter');
const {intakeSourceLabel}=await import('../../../apps/web/src/experience/personalMeaningJourney/sourcePresentation.ts');
const source={client:'codex',title:'Original conversation',url:null,sourceReferenceId:null,domSelector:null,paragraphContext:null};
assert.equal(intakeSourceLabel(source),'Codex · Original conversation','Agent provenance must remain visibly distinct from a webpage');
assert.equal(intakeSourceLabel({...source,client:'another-agent'}),'another-agent · Original conversation','an unknown producer must not be relabeled as Sensa or a webpage');
console.log('PASS: native Sensa entry and Inbox clarification share one bounded teacher loop with a streamed reply and private final proposal; only owned-semantic lookup is a tool. No model/paid calls.');

});
