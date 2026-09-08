use sensa_core::{
    assurance_material,
    assurance_queue::{Event, Package, Queue, Recall},
};
use serde_json::Value;
use std::collections::BTreeMap;

#[test]
fn a_pinned_progression_binding_changes_actual_failure_behavior_and_survives_restore() {
    let release: Value = serde_json::from_str(include_str!(
        "../../../apps/web/src/experience/content/releases/golden-learning-release-v1.json"
    ))
    .unwrap();
    let p = &release["packages"][0];
    let package = Package {
        package_id: p["identity"]["packageKey"].as_str().unwrap().into(),
        sense_id: p["identity"]["senseKey"].as_str().unwrap().into(),
        retention_target_id: "target".into(),
        run_id: "run".into(),
        inventory: assurance_material::inventory(p).unwrap(),
    };
    let base = Queue::new(vec![package], 0, None, 0, vec!["target".into()]).unwrap();
    let run = base
        .clone()
        .with_progression_policies(BTreeMap::from([("target".into(), "run-reset-v1".into())]))
        .unwrap();
    let play = |mut q: Queue| {
        for e in [
            Event::Introduction,
            Event::Next,
            Event::Recognition { correct: true },
            Event::Next,
            Event::Recall {
                outcome: Recall::Miss,
            },
        ] {
            q.execute(e).unwrap();
        }
        let restored = Queue::restore(&serde_json::to_string(&q).unwrap()).unwrap();
        assert_eq!(restored.view(), q.view());
        q
    };
    let current = play(base);
    let run = play(run);
    let gate = |q: &Queue| {
        q.view()["states"][0]["protocolProgress"]["checkpointCredits"]["structured-acquisition:contextual_recognition"]["status"].clone()
    };
    assert_eq!(gate(&current), "credited");
    assert_ne!(gate(&run), "credited");
    assert!(run.with_progression_policies(BTreeMap::new()).is_err());
}
