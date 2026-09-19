import { z } from "zod";

const browserEventCommon = {
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  release: z.string().regex(/^(?:development|[0-9a-f]{7,40})$/u),
  surface: z.enum(["home", "learning", "semantic_world", "academy", "account", "shell"]),
  visibility: z.enum(["visible", "hidden"]),
  online: z.boolean(),
} as const;

export const browserErrorEventSchema = z.object({
  ...browserEventCommon,
  type: z.enum([
    "react_caught",
    "react_uncaught",
    "react_recoverable",
    "window_error",
    "unhandled_rejection",
  ]),
  errorName: z.enum([
    "Error",
    "TypeError",
    "ReferenceError",
    "RangeError",
    "SyntaxError",
    "URIError",
    "AggregateError",
    "DOMException",
    "UnknownError",
  ]),
  source: z.enum(["first_party", "third_party", "inline", "unknown"]),
  fingerprint: z.string().regex(/^[0-9a-f]{8}$/u),
}).strict();

export const browserPerformanceEventSchema = z.object({
  ...browserEventCommon,
  type: z.literal("performance"),
  metric: z.enum(["fcp", "lcp", "cls", "ttfb"]),
  value: z.number().finite().nonnegative().max(3_600_000),
  rating: z.enum(["good", "needs_improvement", "poor"]),
}).strict();

export const browserTelemetryEventSchema = z.discriminatedUnion("type", [
  browserErrorEventSchema,
  browserPerformanceEventSchema,
]);

export const browserTelemetryBatchSchema = z.object({
  events: z.array(browserTelemetryEventSchema).min(1).max(20),
}).strict();

export type BrowserErrorEvent = z.infer<typeof browserErrorEventSchema>;
export type BrowserPerformanceEvent = z.infer<typeof browserPerformanceEventSchema>;
export type BrowserTelemetryEvent = z.infer<typeof browserTelemetryEventSchema>;
export type BrowserTelemetryBatch = z.infer<typeof browserTelemetryBatchSchema>;
