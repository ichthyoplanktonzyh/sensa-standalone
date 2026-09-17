/** Static boundary smoke for the native clarification Agent. No browser/network/model calls. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const runner=await readFile('apps/web/src/experience/personalMeaningJourney/realSemanticAgent.ts','utf8');
const contract=await readFile('apps/web/src/experience/personalMeaningJourney/semanticAgent.ts','utf8');
const screen=await readFile('apps/web/src/experience/components/PersonalMeaningDetailScreen.tsx','utf8');
const world=await readFile('apps/web/src/experience/components/ContentScreen.tsx','utf8');
const app=await readFile('apps/web/src/experience/App.tsx','utf8');
const route=await readFile('apps/api/src/sensa/models/turn.ts','utf8');
const modelProtocol=await readFile('packages/contracts/src/sensa/modelProtocol.ts','utf8');

assert(runner.includes('MAX_MODEL_TURNS = 6'));
assert(runner.includes('for (let round = 0; round < MAX_MODEL_TURNS; round += 1)'));
assert(!runner.includes('openingReplyPrompt'));
assert(!runner.includes('isOpeningReply'));
assert(runner.includes('const teacherTurnSchema'));
assert(runner.includes("context: z.enum(['clear', 'unclear'])"));
assert(runner.includes("'json_object'"));
assert(runner.includes("name: 'lookup_meanings'"));
assert(route.includes("teacher:['lookup_meanings']"));
assert(!runner.includes("name: 'lookup_reference_facts'"));
assert(!runner.includes("name: 'propose_meaning'"));
assert(!modelProtocol.includes("'propose_meaning'"));
assert(!modelProtocol.includes("'ask_learner'"));
assert(!contract.includes("SemanticAgentTurnMode = 'chat' | 'consolidate'"));
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
assert(app.includes('onStartConversation={startSensaConversation}'));
assert(app.includes('onConversationCreated={openPersonalMeaning}'));

console.log('PASS: native Sensa entry and Inbox clarification share one natural teacher loop whose structured clarity assessment is final output; only semantic-world lookup is a tool, with no consolidate mode or model/paid calls.');
