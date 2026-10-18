import {learningHistoryWindow} from '../../learning/system/learningHistoryModel';
import type { LearningRecordKind, LearningRecordView } from './learningHistory';

export type StatisticsRange = import('../../learning/system/learningHistoryModel').LearningHistoryRange;
export const localRecordDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

/** Counts available records only; the journey snapshot is not a lifetime ledger. */
export function projectLearningStatistics(
  records: readonly LearningRecordView[],
  options: { now: Date; range: StatisticsRange; start: string; end: string; kind: 'all' | LearningRecordKind },
) {
  const window=learningHistoryWindow({...options,surface:'statistics',clock:options.now.getTime(),activeLanguageTag:'en',languageChoice:'all',cursor:null,limit:20});
  const invalidRange=window.invalidRange;
  const seen = new Set<string>();
  const available = records.filter(record => {
    const time = Date.parse(record.occurredAt);
    if (!Number.isFinite(time) || time > options.now.getTime() || seen.has(record.recordId)) return false;
    seen.add(record.recordId);
    return true;
  });
  const selected = invalidRange ? [] : available.filter(record => {
    const time=Date.parse(record.occurredAt);
    return (window.from===null||time>=window.from)&&(window.until===null||time<window.until) && (options.kind === 'all' || record.kind === options.kind);
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
