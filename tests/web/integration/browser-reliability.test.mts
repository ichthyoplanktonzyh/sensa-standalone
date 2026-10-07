import {test} from 'vitest';
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  browserTelemetryBatchSchema,
  type BrowserTelemetryEvent,
} from "../../../packages/contracts/src/sensa/browserTelemetry.ts";
import { createConsumerRoutes } from "../../../apps/api/src/sensa/access/consumer.ts";
import { BrowserTelemetryRateLimiter } from '../../../apps/api/src/sensa/access/browserTelemetry.ts';
import { createBrowserReliability } from "../../../apps/web/src/observability/browserReliability.ts";
import {
  KNOWN_SHEET_IDS,
  buildPathname,
  isKnownShellPath,
  parseMainStack,
  parsePathParams,
  retainParamsForStack,
} from "../../../apps/web/src/experience/router/shellLocation.ts";
import {
  SHELL_SCREEN_DEFINITIONS,
  screenInstanceKey,
  shellScreenHost,
} from "../../../apps/web/src/experience/router/screenRegistry.ts";

test("browser-reliability", async () => {

const privateText = "learner-text-and-secret-must-never-leave-the-browser";
const window = new Window({ url: "https://sensa.test/study/learning-library?meaningId=private" });
const batches: BrowserTelemetryEvent[][] = [];
const reliability = createBrowserReliability({
  endpoint: "https://api.sensa.test",
  release: "abcdef1",
  target: window as unknown as globalThis.Window,
  metricSampled: false,
  now: () => new Date("2026-09-19T08:00:00.000Z"),
  send: (events) => { batches.push([...events]); },
});

const stop = reliability.start();
const renderFailure = new Error(privateText);
renderFailure.stack = `Error: ${privateText}\n    at render (https://sensa.test/assets/app-abcd.js:10:20)`;
reliability.reportReactError("react_uncaught", renderFailure, `\n    at Private${privateText}`);
reliability.reportReactError("react_uncaught", renderFailure, `\n    at Private${privateText}`);
const rejection = new window.Event("unhandledrejection");
Object.defineProperty(rejection, "reason", { value: privateText });
window.dispatchEvent(rejection);
window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
stop();

const clientEvents = batches.flat();
assert.equal(clientEvents.length, 2, "duplicate React failures should be collapsed per page");
assert.equal(clientEvents[0]?.surface, "learning");
assert.equal(clientEvents[0]?.source, "first_party");
assert.equal(clientEvents[1]?.errorName, "UnknownError");
assert(!JSON.stringify(clientEvents).includes(privateText), "browser events leaked an error message or component detail");
browserTelemetryBatchSchema.parse({ events: clientEvents });

const received: BrowserTelemetryEvent[] = [];
const app = createConsumerRoutes({ telemetry: () => undefined, browserTelemetry: (event) => received.push(event), browserTelemetryOrigins: ['https://sensa.test'] });
const accepted = await app.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json", origin: 'https://sensa.test' },
  body: JSON.stringify({ events: clientEvents }),
});
assert.equal(accepted.status, 202);
assert.deepEqual(received, clientEvents);

const rejected = await app.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json", origin: 'https://sensa.test' },
  body: JSON.stringify({ events: [{ ...clientEvents[0], message: privateText }] }),
});
assert.equal(rejected.status, 400, "the API must reject undeclared, potentially private fields");
assert.equal(received.length, clientEvents.length);

const brokenSink = createConsumerRoutes({ telemetry: () => undefined, browserTelemetry: () => { throw new Error("sink down"); }, browserTelemetryOrigins: ['https://sensa.test'] });
assert.equal((await brokenSink.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json", origin: 'https://sensa.test' },
  body: JSON.stringify({ events: [clientEvents[0]] }),
})).status, 202, "a failed telemetry sink must not fail the browser request");

assert.equal((await app.request('/sensa/browser-events', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.test' }, body: JSON.stringify({events:[clientEvents[0]]}),
})).status, 403, 'anonymous telemetry must require the exact production origin');
assert.equal((await app.request('/sensa/browser-events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({events:[clientEvents[0]]}),
})).status, 403, 'anonymous telemetry without a browser origin must be rejected');
const unconfiguredOrigins = createConsumerRoutes({ telemetry: () => undefined, browserTelemetryOrigins: [] });
assert.equal((await unconfiguredOrigins.request('/sensa/browser-events', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://sensa.test' }, body: JSON.stringify({events:[clientEvents[0]]}),
})).status, 403, 'an explicitly unconfigured production origin list must fail closed');
const limited = createConsumerRoutes({
  telemetry: () => undefined,
  browserTelemetry: () => undefined,
  browserTelemetryOrigins: ['https://sensa.test'],
  browserTelemetryRateLimiter: new BrowserTelemetryRateLimiter(() => 60_000, 2, 10),
});
const limitedRequest = () => limited.request('/sensa/browser-events', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://sensa.test', 'cf-connecting-ip': '203.0.113.8' }, body: JSON.stringify({events:[clientEvents[0],clientEvents[1]]}),
});
assert.equal((await limitedRequest()).status, 202);
const rateLimited = await limitedRequest();
assert.equal(rateLimited.status, 429);
assert.equal(rateLimited.headers.get('retry-after'), '60');

assert(isKnownShellPath("/study/learning-library"));
assert(!isKnownShellPath("/study/not-a-screen"));
assert(!isKnownShellPath("/not-a-screen"));
const catalogDetailPath=buildPathname(['s-catalog','s-catalog-book'],{bookKey:'english-foundation'});
assert.equal(catalogDetailPath,'/catalog/english-foundation');
assert.deepEqual(parseMainStack(catalogDetailPath),['s-catalog','s-catalog-book']);
assert.deepEqual(parsePathParams(catalogDetailPath),{bookKey:'english-foundation'});
assert(isKnownShellPath(catalogDetailPath));
assert(!isKnownShellPath('/catalog/not%2Fa%2Fbook'));
assert.equal(new Set(SHELL_SCREEN_DEFINITIONS.map(({id})=>id)).size,KNOWN_SHEET_IDS.length);
for (const sheetId of KNOWN_SHEET_IDS) {
  const path = buildPathname([sheetId]);
  assert.deepEqual(parseMainStack(path), [sheetId], `single-sheet route did not round-trip: ${path}`);
  assert(isKnownShellPath(path), `known sheet was rejected: ${path}`);
  assert(shellScreenHost(sheetId), `known sheet has no rendering host: ${sheetId}`);
}
for (const stack of [
  ['s-study', 's-learning-library'],
  ['s-content', 's-content-library'],
  ['s-content', 's-content-sense'],
  ['s-semantic-world', 's-personal-meaning'],
] as const) {
  const path = buildPathname(stack);
  assert.deepEqual(parseMainStack(path), [...stack], `sheet stack did not round-trip: ${path}`);
}
assert.deepEqual(
  retainParamsForStack({senseId:'sense',meaningId:'meaning',targetId:'target',alignmentId:'old-alignment'},['s-content','s-content-sense']),
  {senseId:'sense',targetId:'target',meaningId:'meaning',alignmentId:'old-alignment'},
  'navigation params must leave history with their owning sheet',
);
assert.equal(screenInstanceKey('s-personal-meaning',{}),'s-personal-meaning:new');
assert.deepEqual(retainParamsForStack({senseId:'sense',targetId:'target',meaningId:'meaning',alignmentId:'old-alignment',section:'notes'},['s-content','s-content-library']),{section:'notes'},'leaving all reference kinds removes their IDs');
assert.equal(screenInstanceKey('s-content-sense',{senseId:'sense'}),'s-content-sense:sense:missing:missing:missing');
assert.equal(screenInstanceKey('s-content-sense',{targetId:'target'}),'s-content-sense:missing:target:missing:missing');
assert.equal(screenInstanceKey('s-content-sense',{meaningId:'meaning',alignmentId:'old-alignment'}),'s-content-sense:missing:missing:meaning:old-alignment');
assert.notEqual(screenInstanceKey('s-content-sense',{meaningId:'meaning',alignmentId:'a'}),screenInstanceKey('s-content-sense',{meaningId:'meaning',alignmentId:'b'}),'two historical interpretations must not share screen memory');
assert.notEqual(screenInstanceKey('s-content-sense',{senseId:'same'}),screenInstanceKey('s-content-sense',{targetId:'same'}),'a practice reference and Target reference must not share screen memory');
assert.equal(screenInstanceKey('s-catalog-book',{bookKey:'english-foundation'}),'s-catalog-book:english-foundation');
console.log("PASS: browser errors are deduplicated and redacted, the API contract is strict/non-fatal, and shell routes round-trip while unknown paths are rejected.");

});
