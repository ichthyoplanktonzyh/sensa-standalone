/**
 * Unified Planner 在 web-next 原型里的每日新学数量边界。
 *
 * preset/Profile/Protocol 不出现在这个接口里：它们拿到 Planner 选好的 Target 后
 * 才开始工作。`initialPlannedAt` 是 Planner 已经为该 Target 占用过当日名额的事实；
 * 已经开始但来自更早日期的 Protocol work 不是今天的新 Introduction，不占今天额度。
 */
export interface DailyInitialCandidate<TargetId> {
  readonly targetId: TargetId;
  readonly eligible: boolean;
  readonly initialPlannedAt: string | null;
}

const localDayKey = (value: string | number | Date): string | null => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
};

/**
 * 返回今天尚未开始、但已获准进入首学的 Target，顺序完全保留 Planner 输入顺序。
 * 调高设置只补足剩余额度；调低设置不会撤销今天已经创建的正式运行。
 */
export const planDailyInitialTargets = <TargetId>(
  candidates: readonly DailyInitialCandidate<TargetId>[],
  dailyNewCount: number,
  now: string | number | Date = Date.now(),
): readonly TargetId[] => {
  const today = localDayKey(now);
  if (today === null) return [];

  const plannedToday = new Set(
    candidates.flatMap((candidate) =>
      candidate.initialPlannedAt !== null
      && localDayKey(candidate.initialPlannedAt) === today
        ? [candidate.targetId]
        : []),
  );
  const limit = Number.isFinite(dailyNewCount)
    ? Math.max(0, Math.floor(dailyNewCount))
    : 0;
  const remaining = Math.max(0, limit - plannedToday.size);
  if (remaining === 0) return [];

  const selected: TargetId[] = [];
  const seen = new Set<TargetId>();
  for (const candidate of candidates) {
    if (
      !candidate.eligible
      || candidate.initialPlannedAt !== null
      || seen.has(candidate.targetId)
    ) continue;
    seen.add(candidate.targetId);
    selected.push(candidate.targetId);
    if (selected.length === remaining) break;
  }
  return selected;
};
