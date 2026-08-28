import type { SensaSyncStudyPlanSnapshot } from "@sensa/contracts/sensa";
import { effectiveMasteryIds } from "./features/mastery/declaredMastery";
import type { SensaLocalOutbox, SensaLocalSnapshot } from "./store";

/*
 * Read-only projections over the synchronized facts. Nothing here decides
 * anything: scheduling is FSRS's answer and planning is the server's, so these
 * only count what already happened. `plannedLocalDate` is used for anything
 * day-shaped because the server stamped it in the learner's own zone.
 */

export function localDate(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function masteredSenseIds(snapshot: SensaLocalSnapshot): ReadonlySet<string> {
  return effectiveMasteryIds(snapshot);
}

/** Senses this learner has met at least once, mastery declarations included. */
export function touchedSenseIds(snapshot: SensaLocalSnapshot): ReadonlySet<string> {
  return new Set(snapshot.memoryStates.map((state) => state.senseId));
}

export type SensaTodayCounts = Readonly<{
  dailyTarget: number;
  introducedToday: number;
  remainingNew: number;
  dueNow: number;
  completedToday: number;
}>;

export function todayCounts(
  snapshot: SensaLocalSnapshot,
  plan: SensaSyncStudyPlanSnapshot | null,
  now: Date = new Date(),
): SensaTodayCounts {
  const today = localDate(now);
  const mastered = masteredSenseIds(snapshot);
  const dailyTarget = plan?.dailyNewSenseTarget ?? 0;
  let introducedToday = 0;
  let completedToday = 0;
  for (const encounter of snapshot.encounters) {
    if (encounter.plannedLocalDate !== today || encounter.status !== "completed") continue;
    completedToday += 1;
    if (encounter.kind === "introduction") introducedToday += 1;
  }
  const dueNow = snapshot.memoryStates.filter((state) =>
    state.dueAt !== null
    && Date.parse(state.dueAt) <= now.getTime()
    && !mastered.has(state.senseId)).length;
  return {
    dailyTarget,
    introducedToday,
    remainingNew: Math.max(0, dailyTarget - introducedToday),
    dueNow,
    completedToday,
  };
}

/** Distinct local dates that closed at least one Encounter, newest first. */
export function studiedDates(snapshot: SensaLocalSnapshot): readonly string[] {
  const dates = new Set<string>();
  for (const encounter of snapshot.encounters) {
    if (encounter.status === "completed") dates.add(encounter.plannedLocalDate);
  }
  return [...dates].sort((left, right) => right.localeCompare(left));
}

export function studyStreak(snapshot: SensaLocalSnapshot, now: Date = new Date()): number {
  const dates = new Set(studiedDates(snapshot));
  if (dates.size === 0) return 0;
  const cursor = new Date(now);
  // A day that has not been studied yet does not break a streak until it ends.
  if (!dates.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(localDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export type SensaWeekDay = Readonly<{
  date: string;
  dayOfMonth: number;
  studied: boolean;
  isToday: boolean;
}>;

export function currentWeek(snapshot: SensaLocalSnapshot, now: Date = new Date()): readonly SensaWeekDay[] {
  const dates = new Set(studiedDates(snapshot));
  const today = localDate(now);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_unused, offset) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + offset);
    const date = localDate(day);
    return { date, dayOfMonth: day.getDate(), studied: dates.has(date), isToday: date === today };
  });
}

export type SensaOutboxHealth = Readonly<{
  pending: number;
  blocked: number;
  unreadable: number;
}>;

/**
 * Queued intents the server refused. They are kept verbatim rather than
 * discarded, so this is what the recovery UI lists: a real response the learner
 * made that has not become a fact yet.
 */
export function blockedOutbox(snapshot: SensaLocalSnapshot): readonly SensaLocalOutbox[] {
  return snapshot.outbox.filter((record) => record.status !== "pending");
}

const operationLabels: Readonly<Record<string, string>> = {
  "study_plan.create": "新建学习计划",
  "study_plan.update": "计划设置",
  "learning_session.start": "开始学习会话",
  "learning_session.complete": "结束学习会话",
  "sense_encounter.open": "打开一个意思",
  "learning_attempt.record": "一次作答",
  "sense_encounter.complete": "完成一个意思",
  "sense_encounter.interrupt": "中断一个意思",
  "learner_declared_mastery.set": "已会标记",
};

export function describeOperation(record: SensaLocalOutbox): string {
  return operationLabels[record.operation.kind] ?? record.operation.kind;
}

export function outboxHealth(snapshot: SensaLocalSnapshot): SensaOutboxHealth {
  let pending = 0;
  let blocked = 0;
  for (const record of snapshot.outbox) {
    if (record.status === "pending") pending += 1;
    else blocked += 1;
  }
  return { pending, blocked, unreadable: snapshot.invalidOutbox.length };
}
