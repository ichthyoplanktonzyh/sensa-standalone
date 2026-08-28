/**
 * Full FSRS scheduler with persisted Sense state and workspace-level settings.
 *
 * This is the standalone TypeScript implementation used by the Sensa runtime.
 * Keep the algorithm contract and vectors documented in this repository
 * aligned whenever scheduling behavior changes.
 *
 * Reference sources:
 * - official open-spaced-repetition ts-fsrs 5.2.3 scheduler flow mirrored here:
 *   https://github.com/open-spaced-repetition/ts-fsrs
 * - official FSRS algorithm notes:
 *   https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 * - product source of truth: docs/fsrs-scheduling-logic.md
 */
import type { WorkspaceSchedulerConfig } from "./workspaceConfig.js";

export type ReviewRating = 0 | 1 | 2 | 3;

export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export type ReviewableCardScheduleState = Readonly<{
  cardId: string;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | null;
  fsrsScheduledDays: number | null;
}>;

export type ReviewHistoryEvent = Readonly<{
  rating: ReviewRating;
  reviewedAt: Date;
}>;

export type ReviewSchedule = Readonly<{
  dueAt: Date;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number;
  fsrsDifficulty: number;
  fsrsLastReviewedAt: Date;
  fsrsScheduledDays: number;
}>;

export type RebuiltCardScheduleState = Readonly<{
  dueAt: Date | null;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | null;
  fsrsScheduledDays: number | null;
}>;

type FsrsMemoryState = Readonly<{
  difficulty: number;
  stability: number;
}>;

type FuzzRange = Readonly<{
  minInterval: number;
  maxInterval: number;
}>;

type LearningStepResult = Readonly<{
  scheduledMinutes: number | null;
  nextStepIndex: number;
}>;

const DEFAULT_W: ReadonlyArray<number> = Object.freeze([
  0.212,
  1.2931,
  2.3065,
  8.2956,
  6.4133,
  0.8334,
  3.0194,
  0.001,
  1.8722,
  0.1666,
  0.796,
  1.4835,
  0.0614,
  0.2629,
  1.6483,
  0.6014,
  1.8729,
  0.5425,
  0.0912,
  0.0658,
  0.1542,
]);
const S_MIN = 0.001;
const W17_W18_CEILING = 2;
const FUZZ_RANGES = Object.freeze([
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Number.POSITIVE_INFINITY, factor: 0.05 },
]);

const DECAY = -DEFAULT_W[20];
const FACTOR = Number.parseFloat(
  (Math.exp(Math.pow(DECAY, -1) * Math.log(0.9)) - 1).toFixed(8),
);

class Alea {
  private c: number;
  private s0: number;
  private s1: number;
  private s2: number;

  constructor(seed: string) {
    const mash = createMash();
    this.c = 1;
    this.s0 = mash(" ");
    this.s1 = mash(" ");
    this.s2 = mash(" ");

    this.s0 -= mash(seed);
    if (this.s0 < 0) {
      this.s0 += 1;
    }

    this.s1 -= mash(seed);
    if (this.s1 < 0) {
      this.s1 += 1;
    }

    this.s2 -= mash(seed);
    if (this.s2 < 0) {
      this.s2 += 1;
    }
  }

  next(): number {
    const t = 2_091_639 * this.s0 + this.c * 2.3283064365386963e-10;
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.c = t | 0;
    this.s2 = t - this.c;
    return this.s2;
  }
}

function createMash(): (data: string) => number {
  let n = 0xefc8249d;

  return (data: string): number => {
    let next = n;
    for (let index = 0; index < data.length; index += 1) {
      next += data.charCodeAt(index);
      let h = 0.02519603282416938 * next;
      next = h >>> 0;
      h -= next;
      h *= next;
      next = h >>> 0;
      h -= next;
      next += h * 0x1_0000_0000;
    }

    n = next;
    return (next >>> 0) * 2.3283064365386963e-10;
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo8(value: number): number {
  return Number.parseFloat(value.toFixed(8));
}

function dateDiffInDays(lastReviewedAt: Date, now: Date): number {
  if (now.getTime() < lastReviewedAt.getTime()) {
    throw new Error(
      `Review timestamp moved backwards: lastReviewedAt=${lastReviewedAt.toISOString()}, now=${now.toISOString()}`,
    );
  }

  const utcLast = Date.UTC(
    lastReviewedAt.getUTCFullYear(),
    lastReviewedAt.getUTCMonth(),
    lastReviewedAt.getUTCDate(),
  );
  const utcNow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return Math.floor((utcNow - utcLast) / 86_400_000);
}

function stateRequiresMemory(state: FsrsCardState): boolean {
  return state !== "new";
}

function getIntervalModifier(requestRetention: number): number {
  return roundTo8((Math.pow(requestRetention, 1 / DECAY) - 1) / FACTOR);
}

function formatSeedNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) {
    return "0";
  }

  return String(value);
}

function mapRatingToFsrsGrade(rating: ReviewRating): 1 | 2 | 3 | 4 {
  return (rating + 1) as 1 | 2 | 3 | 4;
}

function getStepsForState(
  settings: WorkspaceSchedulerConfig,
  state: FsrsCardState,
): ReadonlyArray<number> {
  return state === "relearning" || state === "review"
    ? settings.relearningStepsMinutes
    : settings.learningStepsMinutes;
}

function getCurrentStepIndex(card: ReviewableCardScheduleState): number {
  if (card.fsrsStepIndex === null) {
    return 0;
  }

  return card.fsrsStepIndex;
}

function getLearningStrategyStepIndex(
  card: ReviewableCardScheduleState,
  grade: 1 | 2 | 3 | 4,
): number {
  const currentStepIndex = getCurrentStepIndex(card);
  if (card.fsrsCardState === "learning" && grade !== 1 && grade !== 2) {
    return currentStepIndex + 1;
  }

  return currentStepIndex;
}

function getHardStepMinutes(steps: ReadonlyArray<number>): number {
  if (steps.length === 1) {
    return Math.round(steps[0] * 1.5);
  }

  return Math.round((steps[0] + steps[1]) / 2);
}

function getLearningStepResult(
  settings: WorkspaceSchedulerConfig,
  card: ReviewableCardScheduleState,
  grade: 1 | 2 | 3 | 4,
): LearningStepResult {
  const steps = getStepsForState(settings, card.fsrsCardState);
  const strategyStepIndex = getLearningStrategyStepIndex(card, grade);

  if (steps.length === 0) {
    throw new Error("Workspace scheduler steps must not be empty");
  }

  if (card.fsrsCardState === "review") {
    return {
      scheduledMinutes: steps[0],
      nextStepIndex: 0,
    };
  }

  if (grade === 1) {
    return {
      scheduledMinutes: steps[0],
      nextStepIndex: 0,
    };
  }

  if (grade === 2) {
    return {
      scheduledMinutes: getHardStepMinutes(steps),
      nextStepIndex: strategyStepIndex,
    };
  }

  if (grade === 4) {
    return {
      scheduledMinutes: null,
      nextStepIndex: 0,
    };
  }

  const nextStepIndex = strategyStepIndex + 1;
  const nextStepMinutes = steps[nextStepIndex];
  if (nextStepMinutes === undefined) {
    return {
      scheduledMinutes: null,
      nextStepIndex: 0,
    };
  }

  return {
    scheduledMinutes: nextStepMinutes,
    nextStepIndex,
  };
}

function initStability(grade: 1 | 2 | 3 | 4): number {
  return Math.max(DEFAULT_W[grade - 1], 0.1);
}

function initDifficulty(grade: 1 | 2 | 3 | 4): number {
  return roundTo8(DEFAULT_W[4] - Math.exp((grade - 1) * DEFAULT_W[5]) + 1);
}

function meanReversion(initialDifficulty: number, currentDifficulty: number): number {
  return roundTo8(DEFAULT_W[7] * initialDifficulty + (1 - DEFAULT_W[7]) * currentDifficulty);
}

function linearDamping(deltaDifficulty: number, difficulty: number): number {
  return roundTo8(deltaDifficulty * (10 - difficulty) / 9);
}

function nextDifficulty(difficulty: number, grade: 1 | 2 | 3 | 4): number {
  const deltaDifficulty = -DEFAULT_W[6] * (grade - 3);
  const nextDifficultyValue = difficulty + linearDamping(deltaDifficulty, difficulty);
  return clamp(
    meanReversion(initDifficulty(4), nextDifficultyValue),
    1,
    10,
  );
}

function forgettingCurve(elapsedDays: number, stability: number): number {
  return roundTo8(Math.pow(1 + FACTOR * elapsedDays / stability, DECAY));
}

function nextRecallStability(
  difficulty: number,
  stability: number,
  retrievability: number,
  grade: 1 | 2 | 3 | 4,
): number {
  const hardPenalty = grade === 2 ? DEFAULT_W[15] : 1;
  const easyBound = grade === 4 ? DEFAULT_W[16] : 1;
  return roundTo8(clamp(
    stability * (
      1
      + Math.exp(DEFAULT_W[8])
      * (11 - difficulty)
      * Math.pow(stability, -DEFAULT_W[9])
      * (Math.exp((1 - retrievability) * DEFAULT_W[10]) - 1)
      * hardPenalty
      * easyBound
    ),
    S_MIN,
    36_500,
  ));
}

function nextForgetStability(
  difficulty: number,
  stability: number,
  retrievability: number,
): number {
  return roundTo8(clamp(
    DEFAULT_W[11]
      * Math.pow(difficulty, -DEFAULT_W[12])
      * (Math.pow(stability + 1, DEFAULT_W[13]) - 1)
      * Math.exp((1 - retrievability) * DEFAULT_W[14]),
    S_MIN,
    36_500,
  ));
}

type ShortTermWeights = Readonly<{
  w17: number;
  w18: number;
}>;

function getShortTermWeights(settings: WorkspaceSchedulerConfig): ShortTermWeights {
  if (settings.relearningStepsMinutes.length <= 1) {
    return {
      w17: DEFAULT_W[17],
      w18: DEFAULT_W[18],
    };
  }

  const value = -(
    Math.log(DEFAULT_W[11])
    + Math.log(Math.pow(2, DEFAULT_W[13]) - 1)
    + DEFAULT_W[14] * 0.3
  ) / settings.relearningStepsMinutes.length;
  const ceiling = clamp(roundTo8(value), 0.01, W17_W18_CEILING);

  return {
    w17: clamp(DEFAULT_W[17], 0, ceiling),
    w18: clamp(DEFAULT_W[18], 0, ceiling),
  };
}

function nextShortTermStability(
  stability: number,
  grade: 1 | 2 | 3 | 4,
  settings: WorkspaceSchedulerConfig,
): number {
  const shortTermWeights = getShortTermWeights(settings);
  const sinc = (
    Math.pow(stability, -DEFAULT_W[19])
    * Math.exp(shortTermWeights.w17 * (grade - 3 + shortTermWeights.w18))
  );
  const maskedSinc = grade >= 3 ? Math.max(sinc, 1) : sinc;
  return roundTo8(clamp(stability * maskedSinc, S_MIN, 36_500));
}

// State-specific memory updates follow ts-fsrs:
// new -> initial memory, learning/relearning -> short-term update, review -> review formulas.
function createInitialMemoryState(grade: 1 | 2 | 3 | 4): FsrsMemoryState {
  return {
    stability: initStability(grade),
    difficulty: clamp(initDifficulty(grade), 1, 10),
  };
}

function computeNextShortTermMemoryState(
  memoryState: FsrsMemoryState,
  grade: 1 | 2 | 3 | 4,
  settings: WorkspaceSchedulerConfig,
): FsrsMemoryState {
  return {
    stability: nextShortTermStability(memoryState.stability, grade, settings),
    difficulty: nextDifficulty(memoryState.difficulty, grade),
  };
}

function computeNextReviewMemoryState(
  memoryState: FsrsMemoryState,
  elapsedDays: number,
  grade: 1 | 2 | 3 | 4,
  settings: WorkspaceSchedulerConfig,
): FsrsMemoryState {
  const retrievability = forgettingCurve(elapsedDays, memoryState.stability);
  const stabilityAfterSuccess = nextRecallStability(
    memoryState.difficulty,
    memoryState.stability,
    retrievability,
    grade,
  );
  const stabilityAfterFailure = nextForgetStability(
    memoryState.difficulty,
    memoryState.stability,
    retrievability,
  );

  let nextStability = stabilityAfterSuccess;
  if (grade === 1) {
    const shortTermWeights = getShortTermWeights(settings);
    const nextStabilityMin = memoryState.stability / Math.exp(shortTermWeights.w17 * shortTermWeights.w18);
    nextStability = clamp(roundTo8(nextStabilityMin), S_MIN, stabilityAfterFailure);
  }

  return {
    stability: nextStability,
    difficulty: nextDifficulty(memoryState.difficulty, grade),
  };
}

function getFuzzRange(
  interval: number,
  elapsedDays: number,
  maximumInterval: number,
): FuzzRange {
  let delta = 1;
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
  }

  const clampedInterval = Math.min(interval, maximumInterval);
  let minInterval = Math.max(2, Math.round(clampedInterval - delta));
  const maxInterval = Math.min(Math.round(clampedInterval + delta), maximumInterval);
  if (clampedInterval > elapsedDays) {
    minInterval = Math.max(minInterval, elapsedDays + 1);
  }

  minInterval = Math.min(minInterval, maxInterval);
  return {
    minInterval,
    maxInterval,
  };
}

function getIntervalSeed(
  now: Date,
  reps: number,
  memoryState: FsrsMemoryState | null,
): string {
  const memoryProduct = memoryState === null
    ? 0
    : memoryState.difficulty * memoryState.stability;
  return `${now.getTime()}_${reps}_${formatSeedNumber(memoryProduct)}`;
}

function nextInterval(
  stability: number,
  elapsedDays: number,
  settings: WorkspaceSchedulerConfig,
  intervalSeed: string,
): number {
  const intervalModifier = getIntervalModifier(settings.desiredRetention);
  const nextRawInterval = clamp(
    Math.round(stability * intervalModifier),
    1,
    settings.maximumIntervalDays,
  );

  if (!settings.enableFuzz || nextRawInterval < 3) {
    return nextRawInterval;
  }

  const prng = new Alea(intervalSeed);
  const fuzzFactor = prng.next();
  const fuzzRange = getFuzzRange(nextRawInterval, elapsedDays, settings.maximumIntervalDays);
  return Math.floor(
    fuzzFactor * (fuzzRange.maxInterval - fuzzRange.minInterval + 1) + fuzzRange.minInterval,
  );
}

function getMemoryState(card: ReviewableCardScheduleState): FsrsMemoryState | null {
  if (!stateRequiresMemory(card.fsrsCardState)) {
    if (
      card.fsrsStability !== null
      || card.fsrsDifficulty !== null
      || card.fsrsLastReviewedAt !== null
      || card.fsrsScheduledDays !== null
      || card.fsrsStepIndex !== null
    ) {
      throw new Error("New card must not have persisted FSRS state");
    }

    return null;
  }

  if (
    card.fsrsStability === null
    || card.fsrsDifficulty === null
    || card.fsrsLastReviewedAt === null
    || card.fsrsScheduledDays === null
  ) {
    throw new Error("Persisted FSRS card state is incomplete");
  }

  if (card.fsrsCardState === "review" && card.fsrsStepIndex !== null) {
    throw new Error("Review card must not persist fsrsStepIndex");
  }

  if ((card.fsrsCardState === "learning" || card.fsrsCardState === "relearning") && card.fsrsStepIndex === null) {
    throw new Error("Learning or relearning card is missing fsrsStepIndex");
  }

  return {
    stability: card.fsrsStability,
    difficulty: card.fsrsDifficulty,
  };
}

function buildShortTermSchedule(
  card: ReviewableCardScheduleState,
  nextMemoryState: FsrsMemoryState,
  rating: ReviewRating,
  now: Date,
  reps: number,
  lapses: number,
  settings: WorkspaceSchedulerConfig,
  nextState: Extract<FsrsCardState, "learning" | "relearning">,
  elapsedDays: number,
  intervalSeed: string,
): ReviewSchedule {
  const grade = mapRatingToFsrsGrade(rating);
  const learningStep = getLearningStepResult(settings, card, grade);
  if (learningStep.scheduledMinutes === null) {
    return buildGraduatedReviewSchedule(
      nextMemoryState,
      now,
      reps,
      lapses,
      settings,
      elapsedDays,
      intervalSeed,
    );
  }

  return {
    dueAt: addMinutes(now, Math.round(learningStep.scheduledMinutes)),
    reps,
    lapses,
    fsrsCardState: nextState,
    fsrsStepIndex: learningStep.nextStepIndex,
    fsrsStability: nextMemoryState.stability,
    fsrsDifficulty: nextMemoryState.difficulty,
    fsrsLastReviewedAt: now,
    fsrsScheduledDays: 0,
  };
}

function buildGraduatedReviewSchedule(
  nextMemoryState: FsrsMemoryState,
  now: Date,
  reps: number,
  lapses: number,
  settings: WorkspaceSchedulerConfig,
  elapsedDays: number,
  intervalSeed: string,
): ReviewSchedule {
  const scheduledDays = nextInterval(
    nextMemoryState.stability,
    elapsedDays,
    settings,
    intervalSeed,
  );

  return {
    dueAt: addDays(now, scheduledDays),
    reps,
    lapses,
    fsrsCardState: "review",
    fsrsStepIndex: null,
    fsrsStability: nextMemoryState.stability,
    fsrsDifficulty: nextMemoryState.difficulty,
    fsrsLastReviewedAt: now,
    fsrsScheduledDays: scheduledDays,
  };
}

function buildReviewSuccessSchedule(
  now: Date,
  reps: number,
  lapses: number,
  settings: WorkspaceSchedulerConfig,
  elapsedDays: number,
  hardMemoryState: FsrsMemoryState,
  goodMemoryState: FsrsMemoryState,
  easyMemoryState: FsrsMemoryState,
  rating: ReviewRating,
  intervalSeed: string,
): ReviewSchedule {
  let hardInterval = nextInterval(hardMemoryState.stability, elapsedDays, settings, intervalSeed);
  let goodInterval = nextInterval(goodMemoryState.stability, elapsedDays, settings, intervalSeed);
  hardInterval = Math.min(hardInterval, goodInterval);
  goodInterval = Math.max(goodInterval, hardInterval + 1);
  const easyInterval = Math.max(
    nextInterval(easyMemoryState.stability, elapsedDays, settings, intervalSeed),
    goodInterval + 1,
  );

  if (rating === 1) {
    return {
      dueAt: addDays(now, hardInterval),
      reps,
      lapses,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: hardMemoryState.stability,
      fsrsDifficulty: hardMemoryState.difficulty,
      fsrsLastReviewedAt: now,
      fsrsScheduledDays: hardInterval,
    };
  }

  if (rating === 2) {
    return {
      dueAt: addDays(now, goodInterval),
      reps,
      lapses,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: goodMemoryState.stability,
      fsrsDifficulty: goodMemoryState.difficulty,
      fsrsLastReviewedAt: now,
      fsrsScheduledDays: goodInterval,
    };
  }

  return {
    dueAt: addDays(now, easyInterval),
    reps,
    lapses,
    fsrsCardState: "review",
    fsrsStepIndex: null,
    fsrsStability: easyMemoryState.stability,
    fsrsDifficulty: easyMemoryState.difficulty,
    fsrsLastReviewedAt: now,
    fsrsScheduledDays: easyInterval,
  };
}

export function createEmptyReviewableCardScheduleState(cardId: string): ReviewableCardScheduleState {
  return {
    cardId,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
  };
}

export function computeReviewSchedule(
  card: ReviewableCardScheduleState,
  settings: WorkspaceSchedulerConfig,
  rating: ReviewRating,
  now: Date,
): ReviewSchedule {
  const memoryState = getMemoryState(card);
  const grade = mapRatingToFsrsGrade(rating);
  const elapsedDays = card.fsrsLastReviewedAt === null ? 0 : dateDiffInDays(card.fsrsLastReviewedAt, now);
  const reps = card.reps + 1;
  const lapses = rating === 0 && card.fsrsCardState === "review" ? card.lapses + 1 : card.lapses;
  const intervalSeed = getIntervalSeed(now, reps, memoryState);

  if (card.fsrsCardState === "new") {
    const nextMemoryState = createInitialMemoryState(grade);
    return buildShortTermSchedule(
      card,
      nextMemoryState,
      rating,
      now,
      reps,
      lapses,
      settings,
      "learning",
      0,
      intervalSeed,
    );
  }

  if (memoryState === null) {
    throw new Error("Persisted FSRS card state is incomplete");
  }

  if (card.fsrsCardState === "learning" || card.fsrsCardState === "relearning") {
    const nextMemoryState = computeNextShortTermMemoryState(memoryState, grade, settings);
    return buildShortTermSchedule(
      card,
      nextMemoryState,
      rating,
      now,
      reps,
      lapses,
      settings,
      card.fsrsCardState,
      elapsedDays,
      intervalSeed,
    );
  }

  const nextAgainMemoryState = computeNextReviewMemoryState(memoryState, elapsedDays, 1, settings);
  const nextHardMemoryState = computeNextReviewMemoryState(memoryState, elapsedDays, 2, settings);
  const nextGoodMemoryState = computeNextReviewMemoryState(memoryState, elapsedDays, 3, settings);
  const nextEasyMemoryState = computeNextReviewMemoryState(memoryState, elapsedDays, 4, settings);

  if (rating === 0) {
    return buildShortTermSchedule(
      card,
      nextAgainMemoryState,
      rating,
      now,
      reps,
      lapses,
      settings,
      "relearning",
      elapsedDays,
      intervalSeed,
    );
  }

  return buildReviewSuccessSchedule(
    now,
    reps,
    lapses,
    settings,
    elapsedDays,
    nextHardMemoryState,
    nextGoodMemoryState,
    nextEasyMemoryState,
    rating,
    intervalSeed,
  );
}

export function rebuildCardScheduleState(
  cardId: string,
  settings: WorkspaceSchedulerConfig,
  reviewEvents: ReadonlyArray<ReviewHistoryEvent>,
): RebuiltCardScheduleState {
  if (reviewEvents.length === 0) {
    return {
      dueAt: null,
      reps: 0,
      lapses: 0,
      fsrsCardState: "new",
      fsrsStepIndex: null,
      fsrsStability: null,
      fsrsDifficulty: null,
      fsrsLastReviewedAt: null,
      fsrsScheduledDays: null,
    };
  }

  let state = createEmptyReviewableCardScheduleState(cardId);
  let dueAt: Date | null = null;

  for (const reviewEvent of reviewEvents) {
    const nextState = computeReviewSchedule(
      state,
      settings,
      reviewEvent.rating,
      reviewEvent.reviewedAt,
    );
    state = {
      cardId: state.cardId,
      reps: nextState.reps,
      lapses: nextState.lapses,
      fsrsCardState: nextState.fsrsCardState,
      fsrsStepIndex: nextState.fsrsStepIndex,
      fsrsStability: nextState.fsrsStability,
      fsrsDifficulty: nextState.fsrsDifficulty,
      fsrsLastReviewedAt: nextState.fsrsLastReviewedAt,
      fsrsScheduledDays: nextState.fsrsScheduledDays,
    };
    dueAt = nextState.dueAt;
  }

  return {
    dueAt,
    reps: state.reps,
    lapses: state.lapses,
    fsrsCardState: state.fsrsCardState,
    fsrsStepIndex: state.fsrsStepIndex,
    fsrsStability: state.fsrsStability,
    fsrsDifficulty: state.fsrsDifficulty,
    fsrsLastReviewedAt: state.fsrsLastReviewedAt,
    fsrsScheduledDays: state.fsrsScheduledDays,
  };
}
