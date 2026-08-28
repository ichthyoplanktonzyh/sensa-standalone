export type TimeZoneValidationResult =
  | Readonly<{ ok: true; timeZone: string }>
  | Readonly<{ ok: false; issue: "required" | "invalid" }>;

export function validateIanaTimeZone(value: string): TimeZoneValidationResult {
  const timeZone = value.trim();
  if (timeZone === "") return { ok: false, issue: "required" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return { ok: false, issue: "invalid" };
  }
  return { ok: true, timeZone };
}

function requiredPart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  type: "year" | "month" | "day",
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`Timezone date is missing ${type}`);
  return value;
}

export function formatDateAsTimeZoneLocalDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return `${requiredPart(parts, "year")}-${requiredPart(parts, "month")}-${requiredPart(parts, "day")}`;
}
