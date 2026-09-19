import type {
  BrowserErrorEvent,
  BrowserPerformanceEvent,
  BrowserTelemetryEvent,
} from "@sensa/contracts/sensa";

type ReactErrorKind = Extract<
  BrowserErrorEvent["type"],
  "react_caught" | "react_uncaught" | "react_recoverable"
>;

type ErrorKind = Exclude<BrowserErrorEvent["type"], "performance">;
type BrowserErrorName = BrowserErrorEvent["errorName"];
type BrowserSurface = BrowserTelemetryEvent["surface"];
type MetricName = BrowserPerformanceEvent["metric"];

export interface BrowserReliability {
  start(): () => void;
  reportReactError(kind: ReactErrorKind, error: unknown, componentStack?: string | null): void;
}

interface BrowserReliabilityOptions {
  readonly endpoint?: string;
  readonly release: string;
  readonly target?: Window;
  readonly metricSampled?: boolean;
  readonly now?: () => Date;
  readonly send?: (events: readonly BrowserTelemetryEvent[]) => Promise<void> | void;
}

const errorNames = new Set<BrowserErrorName>([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "AggregateError",
  "DOMException",
  "UnknownError",
]);

const thresholds: Readonly<Record<MetricName, readonly [number, number]>> = {
  fcp: [1_800, 3_000],
  lcp: [2_500, 4_000],
  cls: [0.1, 0.25],
  ttfb: [800, 1_800],
};

function errorDetails(error: unknown): { readonly name: BrowserErrorName; readonly stack: string } {
  if (typeof error !== "object" || error === null) return { name: "UnknownError", stack: "" };
  try {
    const candidate = error as { readonly name?: unknown; readonly stack?: unknown };
    const name = typeof candidate.name === "string" && errorNames.has(candidate.name as BrowserErrorName)
      ? candidate.name as BrowserErrorName
      : "UnknownError";
    // The first stack line commonly repeats Error.message and can contain user input.
    const stack = typeof candidate.stack === "string"
      ? candidate.stack.split("\n").slice(1).join("\n")
      : "";
    return { name, stack };
  } catch {
    return { name: "UnknownError", stack: "" };
  }
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function surfaceFor(pathname: string): BrowserSurface {
  const first = pathname.split("/").find(Boolean);
  if (first === undefined) return "home";
  if (first === "study" || first === "wordlist") return "learning";
  if (first === "content" || first === "personal-meaning" || first === "semantic-world") return "semantic_world";
  if (first === "academy") return "academy";
  if (first === "profile") return "account";
  return "shell";
}

function sourceFor(target: Window, filename: string | undefined, stack: string): BrowserErrorEvent["source"] {
  const location = filename || stack.match(/https?:\/\/[^\s)]+/u)?.[0];
  if (!location) return filename === "" ? "inline" : "unknown";
  try {
    return new URL(location, target.location.href).origin === target.location.origin
      ? "first_party"
      : "third_party";
  } catch {
    return "unknown";
  }
}

function ratingFor(metric: MetricName, value: number): BrowserPerformanceEvent["rating"] {
  const [good, poor] = thresholds[metric];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}

function performanceObserverFor(target: Window): typeof PerformanceObserver | undefined {
  return (target as Window & { readonly PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
}

function supported(target: Window, entryType: string): boolean {
  const observer = performanceObserverFor(target);
  return typeof observer === "function"
    && observer.supportedEntryTypes?.includes(entryType) === true;
}

/**
 * One browser reliability seam owns sanitization, sampling, deduplication and
 * delivery. Product components only report the error boundary that fired.
 */
export function createBrowserReliability(options: BrowserReliabilityOptions): BrowserReliability {
  const target = options.target ?? window;
  const endpoint = options.endpoint?.replace(/\/+$/u, "");
  const now = options.now ?? (() => new Date());
  const metricSampled = options.metricSampled ?? Math.random() < 0.1;
  const release = /^(?:development|[0-9a-f]{7,40})$/u.test(options.release)
    ? options.release
    : "development";
  const pending: BrowserTelemetryEvent[] = [];
  const fingerprints = new Set<string>();
  const observers: PerformanceObserver[] = [];
  let flushTimer: number | undefined;
  let accepted = 0;
  let started = false;
  let metricsFinalized = false;
  let largestContentfulPaint = 0;
  let cumulativeLayoutShift = 0;

  const send = options.send ?? (async (events: readonly BrowserTelemetryEvent[]) => {
    if (!endpoint || events.length === 0) return;
    await target.fetch(`${endpoint}/sensa/browser-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      credentials: "omit",
      keepalive: true,
      redirect: "error",
    });
  });

  const common = () => ({
    eventId: target.crypto.randomUUID(),
    occurredAt: now().toISOString(),
    release,
    surface: surfaceFor(target.location.pathname),
    visibility: target.document.visibilityState === "visible" ? "visible" as const : "hidden" as const,
    online: target.navigator.onLine,
  });

  const flush = () => {
    if (flushTimer !== undefined) target.clearTimeout(flushTimer);
    flushTimer = undefined;
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    try {
      void Promise.resolve(send(batch)).catch(() => undefined);
    } catch {
      // Reliability reporting is deliberately non-fatal.
    }
  };

  const enqueue = (event: BrowserTelemetryEvent) => {
    if (accepted >= 20 || !endpoint && options.send === undefined) return;
    accepted += 1;
    pending.push(event);
    flushTimer ??= target.setTimeout(flush, 250);
  };

  const reportError = (
    kind: ErrorKind,
    error: unknown,
    componentStack?: string | null,
    filename?: string,
    line = 0,
    column = 0,
  ) => {
    const details = errorDetails(error);
    const source = sourceFor(target, filename, details.stack);
    const digest = fingerprint([
      kind,
      details.name,
      source,
      details.stack,
      componentStack ?? "",
      line,
      column,
    ].join("|"));
    if (fingerprints.has(digest)) return;
    fingerprints.add(digest);
    enqueue({ ...common(), type: kind, errorName: details.name, source, fingerprint: digest });
  };

  const reportMetric = (metric: MetricName, rawValue: number) => {
    if (!metricSampled || !Number.isFinite(rawValue) || rawValue < 0) return;
    const value = metric === "cls"
      ? Math.round(rawValue * 1_000) / 1_000
      : Math.round(rawValue);
    enqueue({ ...common(), type: "performance", metric, value, rating: ratingFor(metric, value) });
  };

  const finalizeMetrics = () => {
    if (metricsFinalized) return;
    metricsFinalized = true;
    if (largestContentfulPaint > 0) reportMetric("lcp", largestContentfulPaint);
    reportMetric("cls", cumulativeLayoutShift);
    flush();
  };

  const onWindowError = (event: ErrorEvent) => {
    reportError("window_error", event.error, undefined, event.filename, event.lineno, event.colno);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportError("unhandled_rejection", event.reason);
  };
  const onVisibilityChange = () => {
    if (target.document.visibilityState === "hidden") finalizeMetrics();
  };
  const onPageHide = () => finalizeMetrics();

  const observe = (entryType: string, callback: (entries: readonly PerformanceEntry[]) => void) => {
    if (!metricSampled || !supported(target, entryType)) return;
    try {
      const Observer = performanceObserverFor(target)!;
      const observer = new Observer((list: PerformanceObserverEntryList) => callback(list.getEntries()));
      observer.observe({ type: entryType, buffered: true });
      observers.push(observer);
    } catch {
      // Older engines may expose a type but reject buffered observation.
    }
  };

  return {
    start() {
      if (started || !endpoint && options.send === undefined) return () => undefined;
      started = true;
      target.addEventListener("error", onWindowError);
      target.addEventListener("unhandledrejection", onUnhandledRejection);
      target.addEventListener("pagehide", onPageHide);
      target.document.addEventListener("visibilitychange", onVisibilityChange);

      observe("paint", (entries) => {
        const fcp = entries.find((entry) => entry.name === "first-contentful-paint");
        if (fcp) reportMetric("fcp", fcp.startTime);
      });
      observe("largest-contentful-paint", (entries) => {
        largestContentfulPaint = entries.at(-1)?.startTime ?? largestContentfulPaint;
      });
      observe("layout-shift", (entries) => {
        for (const entry of entries) {
          const shift = entry as PerformanceEntry & { readonly hadRecentInput?: boolean; readonly value?: number };
          if (!shift.hadRecentInput && typeof shift.value === "number") cumulativeLayoutShift += shift.value;
        }
      });

      const reportTtfb = () => {
        const navigation = target.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (navigation) reportMetric("ttfb", navigation.responseStart - navigation.requestStart);
      };
      if (target.document.readyState === "complete") target.setTimeout(reportTtfb, 0);
      else target.addEventListener("load", reportTtfb, { once: true });

      return () => {
        target.removeEventListener("error", onWindowError);
        target.removeEventListener("unhandledrejection", onUnhandledRejection);
        target.removeEventListener("pagehide", onPageHide);
        target.document.removeEventListener("visibilitychange", onVisibilityChange);
        target.removeEventListener("load", reportTtfb);
        for (const observer of observers) observer.disconnect();
        finalizeMetrics();
        started = false;
      };
    },
    reportReactError(kind, error, componentStack) {
      reportError(kind, error, componentStack);
    },
  };
}
