import {
  browserTelemetryBatchSchema,
  type BrowserTelemetryEvent,
} from "@sensa/contracts/sensa";
import type { Hono } from "hono";

export type BrowserTelemetrySink = (event: BrowserTelemetryEvent) => void;

const defaultSink: BrowserTelemetrySink = (event) => {
  console.info(JSON.stringify({ event: "sensa.browser", ...event }));
};

/**
 * Accepts only the shared, bounded browser event contract. The schema has no
 * message, stack, URL, account or content field, so payloads cannot turn the
 * operational log into a second store of learner data.
 */
export function registerBrowserTelemetry(
  app: Hono,
  sink: BrowserTelemetrySink = defaultSink,
): void {
  app.post("/sensa/browser-events", async (context) => {
    const batch = browserTelemetryBatchSchema.parse(await context.req.json());
    for (const event of batch.events) {
      try {
        sink(event);
      } catch {
        // Observability must never make an otherwise healthy client unhealthy.
      }
    }
    context.header("Cache-Control", "no-store");
    return context.body(null, 202);
  });
}
