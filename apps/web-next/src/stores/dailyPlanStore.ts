/**
 * 今日计划：每日新学词数与待复习条数。
 *
 * 这两个值此前是 App 里的 `useState`，但它们都不是状态——它们是
 * `storageService` 的投影：
 *
 *   - `dailyNewCount` 直接存在 settings 里，`setDailyNewCount` 写回去；
 *     useState 只是把它抄了一份，于是同一个数字有了两个源头。
 *   - `reviewN` 完全由 FSRS 到期项与 relearning 项算出来，靠一个
 *     手动的 `refreshReviewCount()` 刷新——十一个调用点，漏一个就是
 *     一个"数字不动"的 bug，而且是那种只在特定路径下才出现的。
 *
 * 改成 `useSyncExternalStore` 之后，写入即通知，读取即最新：
 * `refreshReviewCount` 连同它那十一个调用点一起没有了，因为没有什么
 * 需要被刷新——storageService 的写入方法本来就会 notify。
 *
 * 注意 due 的判定含"今天结束前"这个时间边界，所以跨过午夜时这个数字
 * 会偏旧，直到下一次写入。这与改动前一致（改前更差：不显式刷新就永远不变）。
 */
import { useSyncExternalStore } from 'react';
import { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';
import { createSnapshotStore } from '../services/createSnapshotStore';
import { storageService } from '../services/storageService';

const subscribeToStorage = (listener: () => void) => storageService.subscribe(listener);

const dailyNewCountStore = createSnapshotStore(
  () => storageService.getDailyNewCount(),
  subscribeToStorage,
);

const dueReviewCountStore = createSnapshotStore(
  () => {
    const senseIds = PROTOTYPE_LEARNING_PACKAGES.map((item) => item.senseId);
    return new Set([
      ...storageService.getDueSenseIds(senseIds),
      ...storageService.getRelearningSenseIds(),
    ]).size;
  },
  subscribeToStorage,
);

/** 每日新学词数（设置项，用户可改）。 */
export const useDailyNewCount = (): number =>
  useSyncExternalStore(dailyNewCountStore.subscribe, dailyNewCountStore.getSnapshot);

/**
 * 写回每日新学词数。不是 setState——写的是 storageService，
 * 订阅者随后被通知，包括 `useDailyNewCount` 自己。
 */
export const setDailyNewCount = (count: number): void => {
  storageService.setDailyNewCount(count);
};

/** 今天到期 + 处于 relearning 的 Sense 条数。派生值，无写入口。 */
export const useDueReviewCount = (): number =>
  useSyncExternalStore(dueReviewCountStore.subscribe, dueReviewCountStore.getSnapshot);
