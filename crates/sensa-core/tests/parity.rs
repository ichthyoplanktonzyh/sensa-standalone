use chrono::{DateTime, Utc};
use sensa_core::{Action, PROTOCOL, Phase, initial_schedule, transition};
#[test]
fn matches_ts_initial_settlement_vectors() {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/ts-initial-v1.json")).unwrap();
    for row in rows.as_array().unwrap() {
        let at: DateTime<Utc> = row["occurredAt"].as_str().unwrap().parse().unwrap();
        let rating: Action = serde_json::from_value(row["rating"].clone()).unwrap();
        assert_eq!(
            transition(PROTOCOL, Phase::Reveal, rating),
            Ok(Phase::Completed)
        );
        let mut actual = serde_json::to_value(initial_schedule(at).unwrap()).unwrap();
        // Chrono omits zero milliseconds; the TS wire keeps exactly three digits.
        for key in ["dueAt", "fsrsLastReviewedAt"] {
            let date: DateTime<Utc> = actual[key].as_str().unwrap().parse().unwrap();
            actual[key] = date
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                .into();
        }
        assert_eq!(actual, row["schedule"]);
    }
    assert_eq!(
        transition(PROTOCOL, Phase::Recall, Action::Reveal),
        Ok(Phase::Reveal)
    );
    assert_eq!(
        transition(PROTOCOL, Phase::Reveal, Action::Again),
        Ok(Phase::Recall)
    );
    assert_eq!(
        transition(PROTOCOL, Phase::Completed, Action::Good),
        Err("stale_step")
    );
    assert_eq!(
        transition("consumer-review-v1", Phase::Reveal, Action::Good),
        Err("unsupported_protocol")
    );
}
