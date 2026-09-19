import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  browserTelemetryBatchSchema,
  type BrowserTelemetryEvent,
} from "../packages/contracts/src/sensa/browserTelemetry.ts";
import { createConsumerRoutes } from "../apps/api/src/sensa/access/consumer.ts";
import { createBrowserReliability } from "../apps/web/src/observability/browserReliability.ts";
import { isKnownShellPath } from "../apps/web/src/experience/router/shellLocation.ts";

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
const app = createConsumerRoutes({ telemetry: () => undefined, browserTelemetry: (event) => received.push(event) });
const accepted = await app.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ events: clientEvents }),
});
assert.equal(accepted.status, 202);
assert.deepEqual(received, clientEvents);

const rejected = await app.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ events: [{ ...clientEvents[0], message: privateText }] }),
});
assert.equal(rejected.status, 400, "the API must reject undeclared, potentially private fields");
assert.equal(received.length, clientEvents.length);

const brokenSink = createConsumerRoutes({ telemetry: () => undefined, browserTelemetry: () => { throw new Error("sink down"); } });
assert.equal((await brokenSink.request("/sensa/browser-events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ events: [clientEvents[0]] }),
})).status, 202, "a failed telemetry sink must not fail the browser request");

assert(isKnownShellPath("/study/learning-library"));
assert(!isKnownShellPath("/study/not-a-screen"));
assert(!isKnownShellPath("/not-a-screen"));
console.log("PASS: browser errors are deduplicated and redacted, the API contract is strict/non-fatal, and unknown shell routes are rejected.");
