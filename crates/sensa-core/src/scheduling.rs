//! FSRS-6 migration of Sensa's TS scheduling.ts. All inputs are explicit; no IO.
//! Algorithm settings belong to scheduling, not target identity or UI quantity.
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchedulerConfig {
    pub algorithm: String,
    pub desired_retention: f64,
    pub learning_steps_minutes: Vec<f64>,
    pub relearning_steps_minutes: Vec<f64>,
    pub maximum_interval_days: u32,
    pub enable_fuzz: bool,
}
impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            algorithm: "fsrs-6".into(),
            desired_retention: 0.9,
            learning_steps_minutes: vec![1.0, 10.0],
            relearning_steps_minutes: vec![10.0],
            maximum_interval_days: 36_500,
            enable_fuzz: true,
        }
    }
}
impl SchedulerConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.algorithm != "fsrs-6" {
            return Err("unsupported_scheduler");
        }
        if !self.desired_retention.is_finite()
            || self.desired_retention <= 0.0
            || self.desired_retention >= 1.0
            || self.maximum_interval_days == 0
            || self
                .learning_steps_minutes
                .iter()
                .chain(&self.relearning_steps_minutes)
                .any(|v| !v.is_finite() || *v <= 0.0 || *v > i32::MAX as f64)
        {
            return Err("invalid_scheduler_config");
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScheduleState {
    pub card_id: String,
    pub reps: u32,
    pub lapses: u32,
    pub fsrs_card_state: CardState,
    pub fsrs_step_index: Option<u32>,
    pub fsrs_stability: Option<f64>,
    pub fsrs_difficulty: Option<f64>,
    pub fsrs_last_reviewed_at: Option<DateTime<Utc>>,
    pub fsrs_scheduled_days: Option<u32>,
}
impl ScheduleState {
    pub fn empty(target_id: String) -> Self {
        Self {
            card_id: target_id,
            reps: 0,
            lapses: 0,
            fsrs_card_state: CardState::New,
            fsrs_step_index: None,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_reviewed_at: None,
            fsrs_scheduled_days: None,
        }
    }
    pub fn with_schedule(target_id: String, schedule: &ReviewSchedule) -> Self {
        Self {
            card_id: target_id,
            reps: schedule.reps,
            lapses: schedule.lapses,
            fsrs_card_state: schedule.fsrs_card_state,
            fsrs_step_index: schedule.fsrs_step_index,
            fsrs_stability: Some(schedule.fsrs_stability),
            fsrs_difficulty: Some(schedule.fsrs_difficulty),
            fsrs_last_reviewed_at: Some(schedule.fsrs_last_reviewed_at),
            fsrs_scheduled_days: Some(schedule.fsrs_scheduled_days),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSchedule {
    pub due_at: DateTime<Utc>,
    pub reps: u32,
    pub lapses: u32,
    pub fsrs_card_state: CardState,
    pub fsrs_step_index: Option<u32>,
    pub fsrs_stability: f64,
    pub fsrs_difficulty: f64,
    pub fsrs_last_reviewed_at: DateTime<Utc>,
    pub fsrs_scheduled_days: u32,
}
const W: [f64; 21] = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
// TS uses Number(value.toFixed(8)), including for negative intermediate values.
fn round8(v: f64) -> f64 {
    format!("{v:.8}").parse().expect("finite FSRS arithmetic")
}
fn factor() -> f64 {
    round8(((-W[20]).powi(-1) * 0.9_f64.ln()).exp() - 1.0)
}
fn initial_difficulty(grade: u8) -> f64 {
    round8(W[4] - ((grade as f64 - 1.0) * W[5]).exp() + 1.0)
}
fn difficulty(previous: f64, grade: u8) -> f64 {
    let delta = -W[6] * (grade as f64 - 3.0);
    let damped = round8(delta * (10.0 - previous) / 9.0);
    round8(W[7] * initial_difficulty(4) + (1.0 - W[7]) * (previous + damped)).clamp(1.0, 10.0)
}
fn short_weights(config: &SchedulerConfig) -> (f64, f64) {
    if config.relearning_steps_minutes.len() <= 1 {
        return (W[17], W[18]);
    }
    let value = -(W[11].ln() + (2.0_f64.powf(W[13]) - 1.0).ln() + W[14] * 0.3)
        / config.relearning_steps_minutes.len() as f64;
    let ceiling = round8(value).clamp(0.01, 2.0);
    (W[17].clamp(0.0, ceiling), W[18].clamp(0.0, ceiling))
}
#[derive(Clone, Copy)]
struct Memory {
    stability: f64,
    difficulty: f64,
}
fn next_memory(
    old: Memory,
    grade: u8,
    elapsed: f64,
    short: bool,
    config: &SchedulerConfig,
) -> Memory {
    let (w17, w18) = short_weights(config);
    let s = old.stability;
    let d = old.difficulty;
    let stability = if short {
        let sinc = s.powf(-W[19]) * (w17 * (grade as f64 - 3.0 + w18)).exp();
        round8((s * if grade >= 3 { sinc.max(1.0) } else { sinc }).clamp(0.001, 36_500.0))
    } else {
        let r = round8((1.0 + factor() * elapsed / s).powf(-W[20]));
        if grade == 1 {
            let failure = round8(
                (W[11]
                    * d.powf(-W[12])
                    * ((s + 1.0).powf(W[13]) - 1.0)
                    * ((1.0 - r) * W[14]).exp())
                .clamp(0.001, 36_500.0),
            );
            round8(s / (w17 * w18).exp()).max(0.001).min(failure)
        } else {
            round8(
                (s * (1.0
                    + W[8].exp()
                        * (11.0 - d)
                        * s.powf(-W[9])
                        * (((1.0 - r) * W[10]).exp() - 1.0)
                        * if grade == 2 { W[15] } else { 1.0 }
                        * if grade == 4 { W[16] } else { 1.0 }))
                .clamp(0.001, 36_500.0),
            )
        }
    };
    Memory {
        stability,
        difficulty: difficulty(d, grade),
    }
}

// One Alea value is sufficient for each interval. Preserve JS uint32 conversion
// and UTF-16 input so deterministic fuzz is shared with the existing TS core.
fn uint32(v: f64) -> u32 {
    v.trunc().rem_euclid(4_294_967_296.0) as u32
}
fn mash(n: &mut f64, data: &str) -> f64 {
    let mut next = *n;
    for ch in data.encode_utf16() {
        next += ch as f64;
        let mut h = 0.02519603282416938 * next;
        next = uint32(h) as f64;
        h -= next;
        h *= next;
        next = uint32(h) as f64;
        h -= next;
        next += h * 4_294_967_296.0;
    }
    *n = next;
    uint32(next) as f64 * 2.3283064365386963e-10
}
fn fuzz_value(seed: &str) -> f64 {
    let mut n = 0xefc8249du32 as f64;
    let mut states = [mash(&mut n, " "), mash(&mut n, " "), mash(&mut n, " ")];
    for state in &mut states {
        *state -= mash(&mut n, seed);
        if *state < 0.0 {
            *state += 1.0;
        }
    }
    let t = 2_091_639.0 * states[0] + 2.3283064365386963e-10;
    t - t.trunc()
}
fn interval(s: f64, elapsed: f64, config: &SchedulerConfig, seed: &str) -> u32 {
    let modifier = round8((config.desired_retention.powf(1.0 / -W[20]) - 1.0) / factor());
    let raw = (s * modifier)
        .round()
        .clamp(1.0, config.maximum_interval_days as f64);
    if !config.enable_fuzz || raw < 3.0 {
        return raw as u32;
    }
    let mut delta = 1.0;
    for (start, end, factor) in [
        (2.5, 7.0, 0.15),
        (7.0, 20.0, 0.1),
        (20.0, f64::INFINITY, 0.05),
    ] {
        delta += factor * (raw.min(end) - start).max(0.0);
    }
    let mut min = (raw - delta).round().max(2.0);
    let max = (raw + delta)
        .round()
        .min(config.maximum_interval_days as f64);
    if raw > elapsed {
        min = min.max(elapsed + 1.0);
    }
    min = min.min(max);
    (fuzz_value(seed) * (max - min + 1.0) + min).floor() as u32
}
fn persisted_memory(card: &ScheduleState) -> Result<Option<Memory>, &'static str> {
    if card.fsrs_card_state == CardState::New {
        if card.fsrs_stability.is_some()
            || card.fsrs_difficulty.is_some()
            || card.fsrs_last_reviewed_at.is_some()
            || card.fsrs_scheduled_days.is_some()
            || card.fsrs_step_index.is_some()
        {
            return Err("invalid_memory");
        }
        return Ok(None);
    }
    let s = card.fsrs_stability.ok_or("invalid_memory")?;
    let d = card.fsrs_difficulty.ok_or("invalid_memory")?;
    if !s.is_finite()
        || !(0.001..=36_500.0).contains(&s)
        || !d.is_finite()
        || !(1.0..=10.0).contains(&d)
        || card.fsrs_last_reviewed_at.is_none()
        || card.fsrs_scheduled_days.is_none()
        || (card.fsrs_card_state == CardState::Review) == card.fsrs_step_index.is_some()
    {
        return Err("invalid_memory");
    }
    Ok(Some(Memory {
        stability: s,
        difficulty: d,
    }))
}
/// Rating uses the existing TS scheduler encoding: 0=again, 1=hard, 2=good, 3=easy.
/// Policy adapters determine whether a protocol is eligible to call this function.
pub fn compute_review_schedule(
    card: &ScheduleState,
    config: &SchedulerConfig,
    rating: u8,
    now: DateTime<Utc>,
) -> Result<ReviewSchedule, &'static str> {
    config.validate()?;
    if rating > 3 {
        return Err("invalid_rating");
    }
    let old = persisted_memory(card)?;
    let elapsed = if let Some(last) = card.fsrs_last_reviewed_at {
        if now < last {
            return Err("clock_untrusted");
        }
        (now.date_naive() - last.date_naive()).num_days() as f64
    } else {
        0.0
    };
    let reps = card.reps.checked_add(1).ok_or("counter_overflow")?;
    let lapses = card
        .lapses
        .checked_add(u32::from(
            rating == 0 && card.fsrs_card_state == CardState::Review,
        ))
        .ok_or("counter_overflow")?;
    // Valid memory products lie in [0.001, 365000], so JS uses decimal
    // shortest-roundtrip notation; normalize integral formatting for JS String.
    let product = old.map_or(0.0, |v| v.stability * v.difficulty);
    let product_string = if product == product.trunc() {
        format!("{product:.0}")
    } else {
        product.to_string()
    };
    let seed = format!("{}_{}_{}", now.timestamp_millis(), reps, product_string);
    let grade = rating + 1;
    let next = match old {
        None => Memory {
            stability: W[rating as usize].max(0.1),
            difficulty: initial_difficulty(grade).clamp(1.0, 10.0),
        },
        Some(old) => next_memory(
            old,
            grade,
            elapsed,
            card.fsrs_card_state != CardState::Review,
            config,
        ),
    };
    let steps = if matches!(
        card.fsrs_card_state,
        CardState::Review | CardState::Relearning
    ) {
        &config.relearning_steps_minutes
    } else {
        &config.learning_steps_minutes
    };
    let mut state = CardState::Review;
    let mut step_index = None;
    let mut minutes = None;
    if (card.fsrs_card_state != CardState::Review || rating == 0) && !steps.is_empty() {
        let current = card.fsrs_step_index.unwrap_or(0);
        let strategy = if card.fsrs_card_state == CardState::Learning && grade >= 3 {
            current.checked_add(1).ok_or("counter_overflow")?
        } else {
            current
        };
        let step = if card.fsrs_card_state == CardState::Review || grade == 1 {
            Some((steps[0], 0))
        } else if grade == 2 {
            Some((
                if steps.len() == 1 {
                    (steps[0] * 1.5).round()
                } else {
                    ((steps[0] + steps[1]) / 2.0).round()
                },
                strategy,
            ))
        } else if grade == 4 {
            None
        } else {
            let index = strategy.checked_add(1).ok_or("counter_overflow")?;
            steps.get(index as usize).map(|v| (*v, index))
        };
        if let Some((value, index)) = step {
            minutes = Some(value.round() as i64);
            step_index = Some(index);
            state = if matches!(
                card.fsrs_card_state,
                CardState::Review | CardState::Relearning
            ) {
                CardState::Relearning
            } else {
                CardState::Learning
            };
        }
    }
    let days = if minutes.is_some() {
        0
    } else if card.fsrs_card_state == CardState::Review && rating > 0 {
        let old = old.ok_or("invalid_memory")?;
        let hard = interval(
            next_memory(old, 2, elapsed, false, config).stability,
            elapsed,
            config,
            &seed,
        );
        let good = interval(
            next_memory(old, 3, elapsed, false, config).stability,
            elapsed,
            config,
            &seed,
        );
        let hard = hard.min(good);
        let good = good.max(hard.checked_add(1).ok_or("counter_overflow")?);
        match rating {
            1 => hard,
            2 => good,
            _ => interval(next.stability, elapsed, config, &seed)
                .max(good.checked_add(1).ok_or("counter_overflow")?),
        }
    } else {
        interval(next.stability, elapsed, config, &seed)
    };
    let duration = if let Some(minutes) = minutes {
        Duration::minutes(minutes)
    } else {
        Duration::days(days as i64)
    };
    let due = now
        .checked_add_signed(duration)
        .ok_or("clock_out_of_range")?;
    Ok(ReviewSchedule {
        due_at: due,
        reps,
        lapses,
        fsrs_card_state: state,
        fsrs_step_index: step_index,
        fsrs_stability: next.stability,
        fsrs_difficulty: next.difficulty,
        fsrs_last_reviewed_at: now,
        fsrs_scheduled_days: days,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewHistoryEvent {
    pub rating: u8,
    pub reviewed_at: DateTime<Utc>,
}

/// Replay explicitly supplied history in its existing order, as in the TS core.
/// This is a pure migration/rebuild utility, not authorization to merge synced
/// histories or to turn protocol completions into additional review ratings.
pub fn rebuild_schedule(
    target_id: &str,
    config: &SchedulerConfig,
    events: &[ReviewHistoryEvent],
) -> Result<(ScheduleState, Option<DateTime<Utc>>), &'static str> {
    config.validate()?;
    let mut card = ScheduleState::empty(target_id.into());
    let mut due = None;
    for event in events {
        let schedule = compute_review_schedule(&card, config, event.rating, event.reviewed_at)?;
        due = Some(schedule.due_at);
        card = ScheduleState::with_schedule(target_id.into(), &schedule);
    }
    Ok((card, due))
}
