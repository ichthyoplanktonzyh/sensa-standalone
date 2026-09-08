//! Invalid persisted state must fail before a local transaction writes facts.
use sensa_core::scheduling::{
    CardState, ReviewHistoryEvent, ScheduleState, SchedulerConfig, compute_review_schedule,
    rebuild_schedule,
};
#[test]
fn rejects_corrupt_state_and_reversed_history() {
    let config = SchedulerConfig::default();
    let at = "2026-09-08T08:00:00Z".parse().unwrap();
    let mut state = ScheduleState::empty("target".into());
    assert_eq!(
        compute_review_schedule(&state, &config, 4, at).unwrap_err(),
        "invalid_rating"
    );
    state.fsrs_card_state = CardState::Review;
    assert_eq!(
        compute_review_schedule(&state, &config, 2, at).unwrap_err(),
        "invalid_memory"
    );
    let schedule =
        compute_review_schedule(&ScheduleState::empty("target".into()), &config, 3, at).unwrap();
    let valid = ScheduleState::with_schedule("target".into(), &schedule);
    for corrupt in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
        let mut state = valid.clone();
        state.fsrs_stability = Some(corrupt);
        assert_eq!(
            compute_review_schedule(&state, &config, 2, at).unwrap_err(),
            "invalid_memory"
        );
    }
    let mut invalid = valid.clone();
    invalid.fsrs_step_index = Some(0);
    assert_eq!(
        compute_review_schedule(&invalid, &config, 2, at).unwrap_err(),
        "invalid_memory"
    );
    let mut invalid = valid.clone();
    invalid.reps = u32::MAX;
    assert_eq!(
        compute_review_schedule(&invalid, &config, 2, at).unwrap_err(),
        "counter_overflow"
    );
    let events = [
        ReviewHistoryEvent {
            rating: 2,
            reviewed_at: at,
        },
        ReviewHistoryEvent {
            rating: 2,
            reviewed_at: at - chrono::Duration::seconds(1),
        },
    ];
    assert_eq!(
        rebuild_schedule("target", &config, &events).unwrap_err(),
        "clock_untrusted"
    );
    let (state, due) = rebuild_schedule("target", &config, &[]).unwrap();
    assert_eq!(state.fsrs_card_state, CardState::New);
    assert!(due.is_none());
}
