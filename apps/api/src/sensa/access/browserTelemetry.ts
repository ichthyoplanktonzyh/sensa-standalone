import {
  browserTelemetryBatchSchema,
  type BrowserTelemetryEvent,
} from "@sensa/contracts/sensa";
import type { Hono } from "hono";
import { setTelemetryError } from './telemetry.js';

export type BrowserTelemetrySink = (event: BrowserTelemetryEvent) => void;

export class BrowserTelemetryRateLimiter {
  private readonly sources = new Map<string, { window: number; events: number }>();
  private total = { window: 0, events: 0 };
  constructor(
    private readonly now: () => number = Date.now,
    private readonly sourceEventsPerMinute = 120,
    private readonly totalEventsPerMinute = 2_000,
  ) {}
  accept(source: string, events: number): boolean {
    const window = Math.floor(this.now() / 60_000);
    if (this.total.window !== window) { this.total = { window, events: 0 }; this.sources.clear(); }
    const key = sourceFingerprint(source);
    const current = this.sources.get(key)?.window === window ? this.sources.get(key)! : { window, events: 0 };
    if (current.events + events > this.sourceEventsPerMinute || this.total.events + events > this.totalEventsPerMinute) return false;
    current.events += events;
    this.total.events += events;
    this.sources.set(key, current);
    return true;
  }
}

const sourceFingerprint = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

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
  options: {
    allowedOrigins?: readonly string[];
    limiter?: BrowserTelemetryRateLimiter;
  } = {},
): void {
  const enforceOrigins = options.allowedOrigins !== undefined;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const limiter = options.limiter ?? new BrowserTelemetryRateLimiter();
  app.post("/sensa/browser-events", async (context) => {
    const origin = context.req.header('origin');
    if (enforceOrigins && (!origin || !allowedOrigins.has(origin))) {
      setTelemetryError(context, 'browser_telemetry_origin_rejected');
      return context.json({ code: 'browser_telemetry_origin_rejected' }, 403);
    }
    const batch = browserTelemetryBatchSchema.parse(await context.req.json());
    const source = context.req.header('cf-connecting-ip') ?? origin ?? 'unknown';
    if (!limiter.accept(source, batch.events.length)) {
      setTelemetryError(context, 'browser_telemetry_rate_limited');
      context.header('Retry-After', '60');
      return context.json({ code: 'browser_telemetry_rate_limited' }, 429);
    }
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
