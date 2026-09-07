import type { LearningRecordKind, LearningRecordView } from './learningHistory';

export type StatisticsRange = 'today' | 'week' | 'month' | 'all' | 'custom';
export const localRecordDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

/** Counts available records only; the journey snapshot is not a lifetime ledger. */
export function projectLearningStatistics(
  records: readonly LearningRecordView[],
  options: { now: Date; range: StatisticsRange; start: string; end: string; kind: 'all' | LearningRecordKind },
) {
  const today = localRecordDate(options.now);
  const since = new Date(options.now.getFullYear(), options.now.getMonth(), options.now.getDate());
  since.setDate(since.getDate() - (options.range === 'week' ? 6 : options.range === 'month' ? 29 : 0));
  const start = options.range === 'custom' ? options.start : options.range === 'all' ? '' : localRecordDate(since);
  const end = options.range === 'custom' ? options.end : today;
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    return localRecordDate(new Date(year, month-1, day)) === value;
  };
  const invalidRange = options.range === 'custom' &&
    (!validDate(start) || !validDate(end) || start > end || end > today);
  const seen = new Set<string>();
  const available = records.filter(record => {
    const time = Date.parse(record.occurredAt);
    if (!Number.isFinite(time) || time > options.now.getTime() || seen.has(record.recordId)) return false;
    seen.add(record.recordId);
    return true;
  });
  const selected = invalidRange ? [] : available.filter(record => {
    const day = localRecordDate(new Date(record.occurredAt));
    return (!start || day >= start) && day <= end && (options.kind === 'all' || record.kind === options.kind);
  }).sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
  const counts: Record<LearningRecordKind,number> = {initial_learning:0,retention_review:0,relearning:0};
  const days = new Map<string, Record<LearningRecordKind,number>>();
  for (const record of selected) {
    counts[record.kind]++;
    const day = localRecordDate(new Date(record.occurredAt));
    const row = days.get(day) ?? {initial_learning:0,retention_review:0,relearning:0};
    row[record.kind]++;
    days.set(day,row);
  }
  return {records:selected,counts,days:[...days].sort(([a],[b])=>b.localeCompare(a)),invalidRange,hasRecords:available.length>0};
}
