//! Offline runtime-release admission, based on the existing TypeScript release
//! contract and cross-reference validator. Publishing governance remains upstream.
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::OnceLock;
fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn has(v: &Value, s: &str) -> bool {
    array(v).iter().any(|v| v == s)
}
fn lookup<'a>(v: &'a Value, field: &str, key: &Value) -> Option<&'a Value> {
    array(v).iter().find(|v| v[field] == *key)
}
fn unique(v: impl Iterator<Item = String>) -> bool {
    let mut s = BTreeSet::new();
    v.into_iter().all(|v| s.insert(v))
}
fn dup(out: &mut BTreeSet<String>, v: &Value, key: Option<&str>) {
    if !unique(
        array(v)
            .iter()
            .map(|v| text(key.map_or(v, |k| &v[k])).to_owned()),
    ) {
        out.insert("identity.duplicate".into());
    }
}
fn check(out: &mut BTreeSet<String>, valid: bool, code: &str) {
    if !valid {
        out.insert(code.into());
    }
}
fn flatten(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(flatten).collect::<Vec<_>>().join(" "),
        Value::Object(o) => o.values().map(flatten).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}
fn leaks(s: &str, forms: &Value) -> bool {
    array(forms).iter().any(|f| {
        let f = text(f).trim();
        if f.is_empty() {
            return false;
        }
        let Ok(re) = regex::RegexBuilder::new(&regex::escape(f))
            .case_insensitive(true)
            .build()
        else {
            return false;
        };
        re.find_iter(s).any(|m| {
            !s[..m.start()]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphabetic())
                && !s[m.end()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic())
        })
    })
}
fn lower(v: &Value) -> String {
    text(v).to_lowercase()
}
fn span(s: &Value, start: &Value, end: &Value) -> String {
    let s = text(s).encode_utf16().collect::<Vec<_>>();
    let a = start.as_u64().unwrap_or(0) as usize;
    let b = end.as_u64().unwrap_or(0) as usize;
    String::from_utf16_lossy(s.get(a.min(s.len())..b.min(s.len())).unwrap_or(&[]))
}
fn relation(out: &mut BTreeSet<String>, release: &Value, key: &Value, sense: &Value) {
    match lookup(&release["relations"], "relationKey", key) {
        None => {
            out.insert("reference.relation_missing".into());
        }
        Some(r) => check(
            out,
            r["sourceSenseKey"] == *sense || r["targetSenseKey"] == *sense,
            "reference.relation_target_mismatch",
        ),
    }
}
fn media<'a>(
    out: &mut BTreeSet<String>,
    release: &'a Value,
    key: &Value,
    kind: &str,
) -> Option<&'a Value> {
    let m = lookup(&release["media"], "mediaKey", key);
    if let Some(m) = m {
        check(out, m["kind"] == kind, "reference.media_kind_mismatch");
    } else {
        out.insert("reference.media_missing".into());
    }
    m
}
// The source contract's string minLength nodes are its nonEmpty =
// z.string().trim().min(1). JSON Schema cannot encode that input normalization.
fn normalize(value: &mut Value, schema: &Value) {
    if schema["type"] == "string"
        && schema["minLength"] == 1
        && let Some(s) = value.as_str()
    {
        *value = Value::String(
            s.trim_matches(|c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
                .into(),
        );
    }
    if let Some(properties) = schema["properties"].as_object() {
        for (key, child) in properties {
            if let Some(v) = value.get_mut(key) {
                normalize(v, child);
            }
        }
    }
    if let Some(items) = schema.get("items")
        && let Some(values) = value.as_array_mut()
    {
        for v in values {
            normalize(v, items);
        }
    }
    for key in ["anyOf", "oneOf", "allOf"] {
        for child in array(&schema[key]) {
            normalize(value, child);
        }
    }
}
/// Returns the admitted, normalized immutable artifact for storage and hashing.
pub fn admit(input: &Value) -> std::result::Result<Value, Vec<String>> {
    let schema: Value =
        serde_json::from_str(include_str!("../schema/runtime-learning-release-v1.json"))
            .expect("bundled schema");
    let mut normalized = input.clone();
    normalize(&mut normalized, &schema);
    validate(&normalized)?;
    Ok(normalized)
}
/// Returns stable error codes. The Rust adapter intentionally does not expose
/// validator implementation prose as product copy. No remote schema resolution.
pub fn validate(v: &Value) -> std::result::Result<(), Vec<String>> {
    let contract: Value =
        serde_json::from_str(include_str!("../schema/runtime-learning-release-v1.json"))
            .expect("bundled schema");
    let mut normalized = v.clone();
    normalize(&mut normalized, &contract);
    let v = &normalized;
    static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
    let schema = SCHEMA.get_or_init(|| {
        let value: Value =
            serde_json::from_str(include_str!("../schema/runtime-learning-release-v1.json"))
                .expect("bundled schema");
        jsonschema::options()
            .should_validate_formats(true)
            .build(&value)
            .expect("bundled schema compiles")
    });
    if !schema.is_valid(v) {
        return Err(vec!["schema.invalid".into()]);
    }
    let mut out = BTreeSet::new();
    let o = &mut out;
    check(
        o,
        v["release"]["deliveryProfileVersion"] == "sensa-web-prototype-acquisition-v1",
        "release.delivery_profile_unsupported",
    );
    check(
        o,
        v["release"]["validatorVersion"] == "sensa-runtime-learning-release-validator-v1",
        "release.validator_version_mismatch",
    );
    check(
        o,
        v["release"]["capabilityResolverVersion"]
            == "sensa-executable-learning-capability-resolver-v1",
        "release.capability_resolver_unsupported",
    );
    for (field, key) in [
        ("media", "mediaKey"),
        ("lexemes", "lexemeKey"),
        ("relations", "relationKey"),
    ] {
        dup(o, &v[field], Some(key));
    }
    for m in array(&v["media"]) {
        let uri = text(&m["uri"]);
        let digest = uri.strip_prefix("content://sha256/").filter(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
        check(o, digest.is_some(), "media.uri_not_packaged");
        if let Some(d) = digest {
            check(
                o,
                m["sha256"] == format!("sha256:{d}"),
                "media.digest_mismatch",
            );
        }
        check(
            o,
            text(&m["mimeType"])
                .to_lowercase()
                .starts_with(if m["kind"] == "audio" {
                    "audio/"
                } else {
                    "image/"
                }),
            "media.mime_kind_mismatch",
        );
        if m["kind"] == "audio" {
            check(
                o,
                !m["sourceTextDigest"].is_null(),
                "media.source_text_digest_missing",
            );
        }
    }
    for l in array(&v["lexemes"]) {
        check(
            o,
            unique(array(&l["forms"]).iter().map(lower)),
            "identity.duplicate",
        );
        dup(o, &l["pronunciations"], Some("pronunciationKey"));
        for p in array(&l["pronunciations"]) {
            if !p["mediaKey"].is_null() {
                media(o, v, &p["mediaKey"], "audio");
            }
        }
    }
    check(
        o,
        unique(
            array(&v["packages"])
                .iter()
                .map(|p| text(&p["identity"]["packageKey"]).into()),
        ),
        "identity.duplicate",
    );
    check(
        o,
        unique(
            array(&v["packages"])
                .iter()
                .map(|p| text(&p["identity"]["senseKey"]).into()),
        ),
        "identity.duplicate",
    );
    for r in array(&v["relations"]) {
        check(
            o,
            r["sourceSenseKey"] != r["targetSenseKey"],
            "relation.self_reference",
        );
        let src = array(&v["packages"])
            .iter()
            .find(|p| p["identity"]["senseKey"] == r["sourceSenseKey"]);
        let dst = array(&v["packages"])
            .iter()
            .find(|p| p["identity"]["senseKey"] == r["targetSenseKey"]);
        if let (Some(s), Some(t)) = (src, dst) {
            check(
                o,
                if r["scope"] == "intra_word" {
                    s["identity"]["lexemeKey"] == t["identity"]["lexemeKey"]
                } else {
                    s["identity"]["lexemeKey"] != t["identity"]["lexemeKey"]
                },
                "relation.scope_mismatch",
            );
        } else {
            o.insert("reference.relation_sense_missing".into());
        }
    }
    for p in array(&v["packages"]) {
        package(o, v, p);
    }
    if out.is_empty() {
        Ok(())
    } else {
        Err(out.into_iter().collect())
    }
}
fn package(o: &mut BTreeSet<String>, v: &Value, p: &Value) {
    let identity = &p["identity"];
    check(
        o,
        identity["targetLanguage"] == v["release"]["targetLanguage"],
        "identity.language_mismatch",
    );
    check(
        o,
        identity["learnerLocale"] == v["release"]["learnerLocale"],
        "identity.locale_mismatch",
    );
    let Some(l) = array(&v["lexemes"]).iter().find(|l| {
        l["lexemeKey"] == identity["lexemeKey"] && l["version"] == identity["lexemeVersion"]
    }) else {
        o.insert("reference.lexeme_missing".into());
        return;
    };
    check(
        o,
        l["languageTag"] == identity["targetLanguage"]
            && l["languageTag"] == v["release"]["targetLanguage"],
        "identity.language_mismatch",
    );
    let forms = &l["forms"];
    let renders = &p["experience"]["renders"];
    dup(o, renders, Some("renderKey"));
    for r in array(renders) {
        check(
            o,
            array(&r["supportedDeliveryProfiles"])
                .contains(&v["release"]["deliveryProfileVersion"]),
            "render.delivery_profile_missing",
        );
        let scene = match text(&r["kind"]) {
            "image" => {
                media(o, v, &r["mediaKey"], "image");
                text(&r["altTextL1"]).into()
            }
            "interaction" => {
                let pres = &r["payload"]["runtimePresentation"];
                let stage = match text(&pres["variant"]) {
                    "physical_threshold" => "physical",
                    "continuation_timeline" => "process",
                    "receiver_transfer" => "borrow",
                    "provider_transfer" => "lend",
                    _ => "",
                };
                check(
                    o,
                    pres["stageClassName"] == stage,
                    "render.runtime_stage_class_invalid",
                );
                check(
                    o,
                    r["rendererKey"] == "state_change_v1",
                    "render.renderer_unsupported",
                );
                r["payload"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(k, _)| k.as_str() != "runtimePresentation")
                    .map(|(_, v)| flatten(v))
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            "text" => text(&r["sceneL1"]).into(),
            _ => array(&r["steps"])
                .iter()
                .map(|s| format!("{} {}", text(&s["label"]), text(&s["description"])))
                .collect::<Vec<_>>()
                .join(" "),
        };
        check(o, !leaks(&scene, forms), "experience.target_form_leak");
    }
    let selections = &p["experience"]["renderPlan"]["selections"];
    dup(o, selections, Some("renderKey"));
    for s in array(selections) {
        check(
            o,
            lookup(renders, "renderKey", &s["renderKey"]).is_some(),
            "reference.render_missing",
        );
    }
    let preferred = array(selections)
        .iter()
        .filter(|s| s["role"] == "preferred")
        .collect::<Vec<_>>();
    check(o, preferred.len() == 1, "render.preferred_count_invalid");
    if preferred.len() == 1
        && lookup(renders, "renderKey", &preferred[0]["renderKey"])
            .is_some_and(|r| r["kind"] != "text")
    {
        check(
            o,
            array(selections).iter().any(|s| {
                s["role"] == "fallback"
                    && lookup(renders, "renderKey", &s["renderKey"])
                        .is_some_and(|r| r["kind"] == "text")
            }),
            "render.text_scene_fallback_missing",
        );
    }
    let examples = &p["examples"];
    dup(o, examples, Some("exampleKey"));
    for e in array(examples) {
        dup(o, &e["roles"], None);
        check(
            o,
            array(forms)
                .iter()
                .any(|f| lower(f) == lower(&e["target"]["surface"])),
            "example.target_form_unknown",
        );
        check(
            o,
            e["target"]["end"].as_u64().unwrap()
                <= text(&e["textL2"]).encode_utf16().count() as u64
                && e["target"]["start"].as_u64() < e["target"]["end"].as_u64()
                && span(&e["textL2"], &e["target"]["start"], &e["target"]["end"])
                    == text(&e["target"]["surface"]),
            "example.target_span_invalid",
        );
        let assessment = [
            "recognition_assessment",
            "retention_assessment",
            "transfer_assessment",
        ]
        .iter()
        .any(|r| has(&e["roles"], r));
        let teaching = [
            "study_binding",
            "retrieval_repair",
            "usage_illustration",
            "free_practice",
        ]
        .iter()
        .any(|r| has(&e["roles"], r));
        check(
            o,
            !(e["visibility"] == "assessment_only" && teaching
                || e["visibility"] == "learning_only" && assessment),
            "example.visibility_role_conflict",
        );
        for (role, visibility, code) in [
            (
                "transfer_assessment",
                "assessment_only",
                "example.transfer_not_protected",
            ),
            (
                "study_binding",
                "learning_only",
                "example.study_not_learning_only",
            ),
            (
                "usage_illustration",
                "learning_only",
                "example.usage_not_learning_only",
            ),
        ] {
            if has(&e["roles"], role) {
                check(o, e["visibility"] == visibility, code);
            }
        }
        dup(o, &e["renders"], Some("renderKey"));
        for r in array(&e["renders"]) {
            if r["kind"] == "static_audio"
                && let Some(m) = media(o, v, &r["mediaKey"], "audio")
                && m["kind"] == "audio"
                && !m["sourceTextDigest"].is_null()
            {
                check(
                    o,
                    m["sourceTextDigest"] == r["sourceTextDigest"],
                    "media.source_text_digest_mismatch",
                );
            }
        }
    }
    let tasks = [
        "contextualRecognition",
        "meaningToFormRecall",
        "novelContextTransfer",
        "boundaryContrast",
    ]
    .iter()
    .flat_map(|k| array(&p["assessmentInventory"][k]))
    .collect::<Vec<_>>();
    check(
        o,
        unique(tasks.iter().map(|t| text(&t["taskKey"]).into())),
        "identity.duplicate",
    );
    for t in &tasks {
        dup(o, &t["eligiblePurposes"], None);
        if let Some(key) = t.get("exampleKey") {
            if let Some(e) = lookup(examples, "exampleKey", key) {
                let valid = match text(&t["kind"]) {
                    "novel_context_transfer" => {
                        e["visibility"] == "assessment_only"
                            && has(&e["roles"], "transfer_assessment")
                    }
                    "contextual_recognition" => {
                        has(&e["roles"], "recognition_assessment")
                            || has(&e["roles"], "retention_assessment")
                    }
                    _ => {
                        e["visibility"] == "assessment_only"
                            && [
                                "recognition_assessment",
                                "retention_assessment",
                                "transfer_assessment",
                            ]
                            .iter()
                            .any(|r| has(&e["roles"], r))
                    }
                };
                check(
                    o,
                    valid,
                    match text(&t["kind"]) {
                        "novel_context_transfer" => "assessment.transfer_example_invalid",
                        "contextual_recognition" => "assessment.recognition_example_invalid",
                        _ => "assessment.boundary_example_invalid",
                    },
                );
            } else {
                o.insert("reference.example_missing".into());
            }
        }
        if t["kind"] == "meaning_to_form_recall" {
            check(
                o,
                !leaks(
                    &format!(
                        "{} {} {}",
                        text(&t["promptL1"]),
                        text(&t["cue"]["bodyL1"]),
                        flatten(&t["cue"]["featureLabelsL1"])
                    ),
                    forms,
                ),
                "assessment.recall_target_form_leak",
            );
            let choices = &t["supportInventory"]["formChoices"];
            dup(o, choices, Some("optionKey"));
            check(
                o,
                array(choices)
                    .iter()
                    .filter(|c| c["isTargetLexeme"] == true)
                    .count()
                    == 1,
                "assessment.recall_target_count",
            );
            check(
                o,
                !array(choices).iter().any(|c| {
                    c["isTargetLexeme"] == true
                        && !array(forms).iter().any(|f| lower(f) == lower(&c["formL2"]))
                }),
                "assessment.recall_target_form_unknown",
            );
        } else {
            dup(o, &t["options"], Some("optionKey"));
            check(
                o,
                array(&t["options"])
                    .iter()
                    .filter(|c| c["isCorrect"] == true)
                    .count()
                    == 1,
                "assessment.correct_option_count",
            );
            if t["kind"] == "novel_context_transfer" {
                let scene = format!(
                    "{} {} {} {} {} {}",
                    text(&t["scene"]["sceneLabelL1"]),
                    text(&t["scene"]["setupL2"]),
                    text(&t["scene"]["setupL1"]),
                    text(&t["scene"]["visualAltL1"]),
                    text(&t["questionL1"]),
                    array(&t["options"])
                        .iter()
                        .map(|c| format!("{} {}", text(&c["labelL1"]), text(&c["detailL1"])))
                        .collect::<Vec<_>>()
                        .join(" ")
                );
                check(
                    o,
                    !leaks(&scene, forms),
                    "assessment.transfer_target_form_leak",
                );
            } else if t["kind"] == "boundary_contrast" {
                relation(o, v, &t["relationKey"], &identity["senseKey"]);
            }
        }
    }
    let transfers = tasks
        .iter()
        .filter(|t| {
            t["kind"] == "novel_context_transfer" && has(&t["eligiblePurposes"], "acquisition_gate")
        })
        .collect::<Vec<_>>();
    check(
        o,
        transfers.len() >= 5,
        "delivery.transfer_inventory_insufficient",
    );
    let families = transfers
        .iter()
        .filter_map(|t| lookup(examples, "exampleKey", &t["exampleKey"]))
        .map(|e| text(&e["scenarioFamily"]))
        .collect::<BTreeSet<_>>();
    check(
        o,
        families.len() >= 3,
        "delivery.transfer_diversity_insufficient",
    );
    for e in array(examples) {
        if has(&e["roles"], "transfer_assessment") {
            check(
                o,
                transfers.iter().any(|t| t["exampleKey"] == e["exampleKey"]),
                "assessment.transfer_task_missing",
            );
        }
    }
    resources(o, v, p, renders, examples);
    capabilities(o, v, p, l, &tasks);
}
fn resources(o: &mut BTreeSet<String>, v: &Value, p: &Value, renders: &Value, examples: &Value) {
    dup(o, &p["usagePatterns"], Some("patternKey"));
    for pattern in array(&p["usagePatterns"]) {
        dup(o, &pattern["collocations"], Some("collocationKey"));
        for c in array(&pattern["collocations"]) {
            dup(o, &c["exampleBindings"], Some("bindingKey"));
            check(
                o,
                array(&c["exampleBindings"])
                    .iter()
                    .any(|b| b["role"] == "primary"),
                "usage.primary_binding_missing",
            );
            for b in array(&c["exampleBindings"]) {
                if let Some(e) = lookup(examples, "exampleKey", &b["exampleKey"]) {
                    check(
                        o,
                        e["visibility"] == "learning_only"
                            && has(&e["roles"], "usage_illustration")
                            && span(&e["textL2"], &b["start"], &b["end"])
                                == text(&c["displayTextL2"]),
                        "usage.span_invalid",
                    );
                } else {
                    o.insert("reference.example_missing".into());
                }
            }
        }
    }
    dup(o, &p["repairBindings"], Some("bindingKey"));
    for b in array(&p["repairBindings"]) {
        for r in array(&b["resourceRefs"]) {
            match text(&r["kind"]) {
                "experience_recap" => check(
                    o,
                    r["recapKey"] == p["experience"]["recap"]["recapKey"],
                    "reference.recap_missing",
                ),
                "experience_render" => check(
                    o,
                    lookup(renders, "renderKey", &r["renderKey"]).is_some(),
                    "reference.render_missing",
                ),
                "l1_bridge" => check(
                    o,
                    r["assetKey"] == p["l1Bridge"]["assetKey"],
                    "reference.l1_bridge_missing",
                ),
                "learning_example" => {
                    if let Some(e) = lookup(examples, "exampleKey", &r["exampleKey"]) {
                        check(
                            o,
                            e["visibility"] == "learning_only"
                                && has(&e["roles"], "retrieval_repair"),
                            "repair.example_invalid",
                        );
                    } else {
                        o.insert("reference.example_missing".into());
                    }
                }
                "sense_relation" => relation(o, v, &r["relationKey"], &p["identity"]["senseKey"]),
                _ => {}
            }
        }
    }
    if let Some(m) = p.get("practiceManifest") {
        dup(o, &m["grants"], Some("taskFamily"));
        for g in array(&m["grants"]) {
            dup(o, &g["resourceKeys"], None);
            for key in array(&g["resourceKeys"]) {
                let e = lookup(examples, "exampleKey", key);
                check(
                    o,
                    e.is_some()
                        || lookup(renders, "renderKey", key).is_some()
                        || *key == p["l1Bridge"]["assetKey"],
                    "reference.practice_resource_missing",
                );
                if let Some(e) = e {
                    check(
                        o,
                        e["visibility"] != "assessment_only",
                        "practice.assessment_resource_exposed",
                    );
                }
            }
        }
    }
}
fn capabilities(o: &mut BTreeSet<String>, v: &Value, p: &Value, l: &Value, tasks: &[&Value]) {
    let a = &p["acquisitionProfile"];
    let required = &a["requiredCapabilities"];
    check(
        o,
        unique(array(required).iter().map(|c| {
            if c["kind"] == "boundary_discrimination" {
                format!("{}:{}", text(&c["kind"]), text(&c["relationKey"]))
            } else {
                text(&c["kind"]).into()
            }
        })),
        "identity.duplicate",
    );
    for field in ["requiredAssetCapabilities", "optionalAssetCapabilities"] {
        dup(o, &a[field], None);
    }
    for c in array(&a["requiredAssetCapabilities"]) {
        check(
            o,
            !array(&a["optionalAssetCapabilities"]).contains(c),
            "capability.required_optional_overlap",
        );
    }
    for baseline in [
        "contextual_recognition",
        "meaning_to_form_recall",
        "novel_context_transfer",
    ] {
        check(
            o,
            array(required).iter().any(|c| c["kind"] == baseline),
            "capability.baseline_missing",
        );
    }
    for c in array(&a["optionalCapabilities"]) {
        check(
            o,
            !array(required).iter().any(|r| r["kind"] == *c),
            "capability.required_optional_overlap",
        );
    }
    for c in array(required) {
        check(
            o,
            tasks.iter().any(|t| {
                has(&t["eligiblePurposes"], "acquisition_gate")
                    && if c["kind"] == "boundary_discrimination" {
                        t["kind"] == "boundary_contrast" && t["relationKey"] == c["relationKey"]
                    } else {
                        t["kind"] == c["kind"]
                    }
            }),
            "capability.task_missing",
        );
    }
    for t in array(&a["boundaryTargets"]) {
        relation(o, v, &t["relationKey"], &p["identity"]["senseKey"]);
    }
    let required_relations = array(required)
        .iter()
        .filter(|c| c["kind"] == "boundary_discrimination")
        .map(|c| text(&c["relationKey"]))
        .collect::<BTreeSet<_>>();
    let declared = array(&a["boundaryTargets"])
        .iter()
        .filter(|t| t["isRequired"] == true)
        .map(|t| text(&t["relationKey"]))
        .collect::<BTreeSet<_>>();
    check(
        o,
        required_relations.is_subset(&declared),
        "capability.boundary_target_missing",
    );
    check(
        o,
        declared.is_subset(&required_relations),
        "capability.boundary_capability_missing",
    );
    for asset in array(&a["requiredAssetCapabilities"]) {
        let renders = array(&p["experience"]["renders"]);
        let valid = match text(asset) {
            "meaning_grounding" => !renders.is_empty(),
            "l1_mediation" => !text(&p["l1Bridge"]["bodyL1"]).trim().is_empty(),
            "usage_pattern" => !array(&p["usagePatterns"]).is_empty(),
            "contextual_variation" => tasks.iter().any(|t| {
                t["kind"] == "novel_context_transfer"
                    && has(&t["eligiblePurposes"], "acquisition_gate")
            }),
            "pronunciation" => array(&l["pronunciations"]).iter().any(|p| {
                !p["mediaKey"].is_null()
                    && lookup(&v["media"], "mediaKey", &p["mediaKey"])
                        .is_some_and(|m| m["kind"] == "audio")
            }),
            "study_example_audio" => array(&p["examples"])
                .iter()
                .find(|e| has(&e["roles"], "study_binding"))
                .is_some_and(|e| {
                    array(&e["renders"])
                        .iter()
                        .any(|r| r["kind"] == "static_audio")
                }),
            "boundary_contrast" => tasks.iter().any(|t| {
                t["kind"] == "boundary_contrast" && has(&t["eligiblePurposes"], "acquisition_gate")
            }),
            "visual_grounding" => renders.iter().any(|r| r["kind"] == "image"),
            "causal_grounding" => renders.iter().any(|r| r["primitive"] == "causal_sequence"),
            "temporal_grounding" => renders
                .iter()
                .any(|r| r["primitive"] == "temporal_sequence"),
            "spatial_grounding" => renders.iter().any(|r| r["primitive"] == "spatial_relation"),
            "counterexample" | "extended_audio" => false,
            _ => true,
        };
        check(o, valid, "capability.asset_missing");
    }
}
