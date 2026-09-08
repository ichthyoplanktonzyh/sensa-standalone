//! Fixed-task resource projection and answer evaluation for assurance adapters.
//! This consumes an admitted release; it does not replace release validation.
use crate::assurance::Capability;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
type Result<T> = std::result::Result<T, String>;
fn rows<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    v[key]
        .as_array()
        .ok_or_else(|| format!("Missing material collection: {key}"))
}
fn find<'a>(v: &'a Value, key: &str, field: &str, id: &str) -> Result<&'a Value> {
    rows(v, key)?
        .iter()
        .find(|v| v[field] == id)
        .ok_or_else(|| format!("Missing material {key}/{id}"))
}
pub fn kind(c: Capability) -> &'static str {
    match c {
        Capability::ContextualRecognition => "context_recognition",
        Capability::MeaningToFormRecall => "meaning_to_form_recall",
        Capability::NovelContextTransfer => "novel_context_transfer",
        Capability::BoundaryDiscrimination => "boundary_contrast",
    }
}
fn example(release: &Value, p: &Value, key: &str) -> Result<Value> {
    let e = find(p, "examples", "exampleKey", key)?;
    let media = rows(e, "renders")?
        .iter()
        .find(|r| r["kind"] == "static_audio")
        .and_then(|r| r["mediaKey"].as_str())
        .and_then(|k| find(release, "media", "mediaKey", k).ok())
        .filter(|m| m["kind"] == "audio");
    let audio = media
        .and_then(|m| m["uri"].as_str())
        .and_then(|s| s.strip_prefix("content://sha256/"))
        .map(|s| format!("/golden-audio/{s}.mp3"));
    Ok(
        json!({"exampleKey":e["exampleKey"],"textL2":e["textL2"],"textL1":e["textL1"],"targetSurface":e["target"]["surface"],"targetStart":e["target"]["start"],"targetEnd":e["target"]["end"],"audioUrl":audio}),
    )
}
fn options(task: &Value, transfer: bool) -> Result<Value> {
    Ok(Value::Array(rows(task,"options")?.iter().map(|o|{let mut v=json!({"id":o["optionKey"],"detailL1":o["detailL1"],"isCorrect":o["isCorrect"],"feedbackTitleL1":o["feedbackTitleL1"],"feedbackBodyL1":o["feedbackBodyL1"]});v[if transfer{"labelL1"}else{"textL1"}]=o["labelL1"].clone();v}).collect()))
}
fn lexeme<'a>(release: &'a Value, p: &Value) -> Result<&'a Value> {
    rows(release, "lexemes")?
        .iter()
        .find(|l| {
            l["lexemeKey"] == p["identity"]["lexemeKey"]
                && l["version"] == p["identity"]["lexemeVersion"]
        })
        .ok_or("Missing pinned Lexeme.".into())
}
/// Resolves the exact selected task; no first-task fallback. Presentation package
/// and sense identities must agree with the immutable package binding.
pub fn resolve(
    release: &Value,
    package: &str,
    sense: &str,
    task: &str,
    capability: Capability,
) -> Result<Value> {
    if task.is_empty() {
        return Err("An assessment Action must carry a non-null taskKey.".into());
    }
    let p = rows(release, "packages")?
        .iter()
        .find(|p| p["identity"]["packageKey"] == package && p["identity"]["senseKey"] == sense)
        .ok_or("Assessment Package identity mismatch.".to_owned())?;
    let family = match capability {
        Capability::ContextualRecognition => "contextualRecognition",
        Capability::MeaningToFormRecall => "meaningToFormRecall",
        Capability::NovelContextTransfer => "novelContextTransfer",
        Capability::BoundaryDiscrimination => "boundaryContrast",
    };
    let t = find(&p["assessmentInventory"], family, "taskKey", task)?;
    let expected = if capability == Capability::BoundaryDiscrimination {
        "boundary_contrast"
    } else {
        capability.key()
    };
    if t["kind"] != expected {
        return Err("Assessment task kind mismatch.".into());
    }
    let mut v = json!({"kind":kind(capability),"packageKey":package,"senseKey":sense,"taskKey":task,"instructionL1":t["promptL1"]});
    match capability {
        Capability::ContextualRecognition => {
            v["example"] = example(
                release,
                p,
                t["exampleKey"].as_str().ok_or("Missing example key.")?,
            )?;
            v["contextLabelL1"] = json!("新语境");
            v["questionL1"] = t["questionL1"].clone();
            v["options"] = options(t, false)?;
            let correct = rows(t, "options")?
                .iter()
                .find(|o| o["isCorrect"] == true)
                .ok_or("Recognition task has no correct option.")?;
            v["successTitleL1"] = correct["feedbackTitleL1"].clone();
            v["successBodyL1"] = correct["feedbackBodyL1"].clone();
            v["featureLabelsL1"] = t["featureLabelsL1"].clone();
        }
        Capability::MeaningToFormRecall => {
            let l = lexeme(release, p)?;
            v["cueL1"] = t["cue"]["bodyL1"].clone();
            v["cueFeatureLabelsL1"] = t["cue"]["featureLabelsL1"].clone();
            v["primaryForm"] = l["lemma"].clone();
            v["acceptedForms"] = l["forms"].clone();
            v["choiceOptions"]=json!(rows(&t["supportInventory"],"formChoices")?.iter().map(|o|json!({"id":o["optionKey"],"textL2":o["formL2"],"isTarget":o["isTargetLexeme"]})).collect::<Vec<_>>());
            for key in [
                "independentSuccessTitleL1",
                "independentSuccessBodyL1",
                "supportedSuccessTitleL1",
                "supportedSuccessBodyL1",
                "choiceSuccessTitleL1",
                "choiceSuccessBodyL1",
                "repairTitleL1",
                "repairBodyL1",
            ] {
                v[key] = t["feedback"][key].clone();
            }
        }
        Capability::NovelContextTransfer => {
            let mut s = t["scene"].clone();
            s["id"] = t["taskKey"].clone();
            s["exampleKey"] = t["exampleKey"].clone();
            for key in ["questionL1", "successTitleL1", "successBodyL1"] {
                s[key] = t[key].clone();
            }
            s["options"] = options(t, true)?;
            s["sourceObjectL1"] = t["connectionSummary"]["fromLabelL1"].clone();
            s["targetObjectL1"] = t["connectionSummary"]["toLabelL1"].clone();
            s["invariantLabelsL1"] = t["connectionSummary"]["invariantLabelsL1"].clone();
            s["revealExample"] = example(
                release,
                p,
                t["exampleKey"].as_str().ok_or("Missing example key.")?,
            )?;
            v["scenario"] = s;
        }
        Capability::BoundaryDiscrimination => {
            let r = find(
                release,
                "relations",
                "relationKey",
                t["relationKey"].as_str().ok_or("Missing relation key.")?,
            )?;
            let related = if r["sourceSenseKey"] == sense {
                &r["targetSenseKey"]
            } else if r["targetSenseKey"] == sense {
                &r["sourceSenseKey"]
            } else {
                return Err("Boundary relation does not include this Sense.".into());
            };
            let other = rows(release, "packages")?
                .iter()
                .find(|p| p["identity"]["senseKey"] == *related)
                .ok_or("Missing related Package.")?;
            let l = lexeme(release, other)?;
            v["relationKey"] = t["relationKey"].clone();
            v["contrastSenseL1"] = json!(format!(
                "{} · {}",
                l["lemma"].as_str().ok_or("Missing lemma.")?,
                other["sense"]["guideLabelL1"]
                    .as_str()
                    .ok_or("Missing Sense label.")?
            ));
            v["relationLabelL1"] = json!(if r["relationType"] == "viewpoint_contrast" {
                "同一临时转移 · 不同动作视角"
            } else {
                "真实混淆边界"
            });
            v["example"] = example(
                release,
                p,
                t["exampleKey"].as_str().ok_or("Missing example key.")?,
            )?;
            v["questionL1"] = t["questionL1"].clone();
            v["options"] = options(t, false)?;
        }
    };
    Ok(v)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Support {
    Independent,
    FirstLetter,
    Choice,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Answer {
    pub text: Option<String>,
    pub option_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evaluation {
    pub outcome: Option<String>,
    pub next_support: Support,
    pub response_id: String,
}
fn normalize(s: &str) -> String {
    s.trim_matches(|c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
        .to_lowercase()
}
/// The stored encounter supplies support and review status. UI submits only text
/// or an option identity; it cannot grant independent evidence after assistance.
pub fn evaluate(
    resource: &Value,
    support: Support,
    reviewing: bool,
    answer: &Answer,
) -> Result<Evaluation> {
    let recall = resource["kind"] == "meaning_to_form_recall";
    if recall && support != Support::Choice {
        let response = normalize(answer.text.as_deref().ok_or("Missing answer text.")?);
        if response.is_empty() {
            return Err("Empty answer.".into());
        }
        let accepted = rows(resource, "acceptedForms")?
            .iter()
            .any(|f| f.as_str().is_some_and(|f| normalize(f) == response));
        let outcome = if accepted {
            Some(
                if support == Support::Independent {
                    "independent"
                } else {
                    "first_letter"
                }
                .into(),
            )
        } else if reviewing {
            Some("miss".into())
        } else {
            None
        };
        return Ok(Evaluation {
            outcome,
            next_support: if accepted || reviewing {
                support
            } else if support == Support::Independent {
                Support::FirstLetter
            } else {
                Support::Choice
            },
            response_id: response,
        });
    }
    let options = if recall {
        rows(resource, "choiceOptions")?
    } else if resource["kind"] == "novel_context_transfer" {
        rows(&resource["scenario"], "options")?
    } else {
        rows(resource, "options")?
    };
    let id = answer
        .option_id
        .as_deref()
        .ok_or("Missing option identity.")?;
    let selected = options
        .iter()
        .find(|o| o["id"] == id)
        .ok_or("Unknown answer option.")?;
    let correct = selected[if recall { "isTarget" } else { "isCorrect" }]
        .as_bool()
        .ok_or("Invalid option result.")?;
    Ok(Evaluation {
        outcome: Some(
            if !correct {
                "miss"
            } else if recall {
                "choice"
            } else {
                "success"
            }
            .into(),
        ),
        next_support: support,
        response_id: id.into(),
    })
}
/// Install-time task inventory follows the Web catalog projection. No schedule or
/// learner identity is synthesized from a task or capability.
pub fn inventory(p: &Value) -> Result<crate::assurance::Inventory> {
    let package = p["identity"]["packageKey"]
        .as_str()
        .ok_or("Missing package identity.")?;
    let map_cap = |v: &Value| -> Result<Capability> {
        let s = v.as_str().ok_or("Missing capability.")?;
        serde_json::from_value(json!(if s == "boundary_contrast" {
            "boundary_discrimination"
        } else {
            s
        }))
        .map_err(|_| "Unknown capability.".into())
    };
    let required = rows(&p["acquisitionProfile"], "requiredCapabilities")?
        .iter()
        .map(|c| map_cap(&c["kind"]))
        .collect::<Result<Vec<_>>>()?;
    let mut actions = vec![
        json!({"actionKey":format!("{package}.introduction"),"capability":null,"taskKey":null,"kind":"introduction","intent":"instruction"}),
    ];
    let mut reviews = vec![];
    for family in [
        "contextualRecognition",
        "meaningToFormRecall",
        "novelContextTransfer",
        "boundaryContrast",
    ] {
        for t in rows(&p["assessmentInventory"], family)? {
            let c = map_cap(&t["kind"])?;
            let key = t["taskKey"].as_str().ok_or("Missing task key.")?;
            let purposes = rows(t, "eligiblePurposes")?;
            if purposes.contains(&json!("acquisition_gate")) {
                actions.push(
                    json!({"actionKey":key,"capability":c,"taskKey":key,"kind":"acquisition_gate"}),
                );
            }
            for (purpose, suffix) in [
                ("retention_review", "retention"),
                ("relearning_gate", "relearning"),
            ] {
                if purposes.contains(&json!(purpose)) {
                    reviews.push(json!({"actionKey":format!("{key}.{suffix}"),"capability":c,"taskKey":key,"kind":purpose}));
                }
            }
        }
    }
    let mut repairs = vec![];
    let mut seen = std::collections::BTreeSet::new();
    for c in &required {
        if !seen.insert(*c) {
            continue;
        }
        let base = actions
            .iter()
            .find(|a| a["capability"] == c.key() && a["kind"] == "acquisition_gate");
        let binding = rows(p, "repairBindings")?
            .iter()
            .find(|b| b["capability"] == c.key());
        let declared = binding
            .and_then(|b| b["resourceRefs"].as_array())
            .and_then(|rs| {
                rs.iter().find(|r| {
                    matches!(
                        r["kind"].as_str(),
                        Some(
                            "experience_recap"
                                | "l1_bridge"
                                | "learning_example"
                                | "sense_relation"
                        )
                    )
                })
            });
        let (role, key) = if let Some(r) = declared {
            match r["kind"].as_str().unwrap() {
                "experience_recap" => ("experience_recap", r["recapKey"].clone()),
                "l1_bridge" => ("l1_bridge", r["assetKey"].clone()),
                "learning_example" => ("learning_example", r["exampleKey"].clone()),
                _ => ("sense_features", r["relationKey"].clone()),
            }
        } else if *c == Capability::MeaningToFormRecall {
            ("l1_bridge", p["l1Bridge"]["assetKey"].clone())
        } else if let Some(e) = rows(p, "examples")?.iter().find(|e| {
            matches!(
                c,
                Capability::NovelContextTransfer | Capability::BoundaryDiscrimination
            ) && e["visibility"] == "learning_only"
                && e["roles"]
                    .as_array()
                    .is_some_and(|rs| rs.contains(&json!("retrieval_repair")))
        }) {
            ("learning_example", e["exampleKey"].clone())
        } else {
            (
                "experience_recap",
                p["experience"]["recap"]["recapKey"].clone(),
            )
        };
        let mut a = json!({"actionKey":base.map(|a|a["actionKey"].clone()).unwrap_or(json!(format!("{package}.{}",c.key()))),"capability":c,"taskKey":null,"kind":"acquisition_gate","intent":"repair","repairResourceRef":{"role":role,"key":key,"source":"package_declared"}});
        if let Some(base) = base {
            a["repairForActionKey"] = base["actionKey"].clone();
        }
        repairs.push(a);
    }
    Ok(crate::assurance::Inventory {
        required_capabilities: required,
        actions,
        review_actions: reviews,
        repair_actions: repairs,
    })
}
/// Teaching projection excludes protected assessment examples and answer keys.
/// The release owns render plans, recap, usage and pronunciation references.
pub fn teaching(release: &Value, package: &str) -> Result<Value> {
    let p = rows(release, "packages")?
        .iter()
        .find(|p| p["identity"]["packageKey"] == package)
        .ok_or("Missing package.")?;
    let l = lexeme(release, p)?;
    let learning = rows(p, "examples")?
        .iter()
        .filter(|e| e["visibility"] == "learning_only")
        .map(|e| {
            example(
                release,
                p,
                e["exampleKey"].as_str().ok_or("Missing example key.")?,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    let study = rows(p, "examples")?
        .iter()
        .find(|e| {
            e["roles"]
                .as_array()
                .is_some_and(|r| r.contains(&json!("study_binding")))
        })
        .ok_or("Missing study example.")?;
    Ok(
        json!({"packageKey":package,"senseKey":p["identity"]["senseKey"],"lemma":l["lemma"],"syllables":l["syllables"],"pronunciations":l["pronunciations"],"partOfSpeech":p["sense"]["partOfSpeech"],"guideLabelL1":p["sense"]["guideLabelL1"],"definitionL2":p["sense"]["definitionL2"],"l1Bridge":p["l1Bridge"]["bodyL1"],"experience":p["experience"],"studyExample":example(release,p,study["exampleKey"].as_str().ok_or("Missing study example identity.")?)?,"learningExamples":learning,"usagePatterns":p["usagePatterns"],"senseFeatures":p["sense"]["coreFeatures"]}),
    )
}

/// Package-declared repair keeps the exact resource chosen by orchestration.
/// Mirrors the existing Web repair-content materializer, including its fail-closed binding.
pub fn repair_teaching(release: &Value, package: &str, reference: &Value) -> Result<Value> {
    if reference["source"] != "package_declared" {
        return Err("Missing package-owned repair binding.".into());
    }
    let key = reference["key"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing repair key.")?;
    let p = rows(release, "packages")?
        .iter()
        .find(|p| p["identity"]["packageKey"] == package)
        .ok_or("Missing package.")?;
    let mut value = teaching(release, package)?;
    match reference["role"].as_str() {
        Some("experience_recap") if p["experience"]["recap"]["recapKey"] == key => {
            value["repairRecap"] = p["experience"]["recap"].clone();
        }
        Some("l1_bridge") if p["l1Bridge"]["assetKey"] == key => {}
        Some("learning_example") => {
            let e = rows(p, "examples")?
                .iter()
                .find(|e| e["exampleKey"] == key && e["visibility"] == "learning_only")
                .ok_or("Invalid repair example.")?;
            value["studyExample"] = example(
                release,
                p,
                e["exampleKey"].as_str().ok_or("Missing example key.")?,
            )?;
        }
        Some("sense_features") => {
            find(release, "relations", "relationKey", key)?;
            let tasks = rows(&p["assessmentInventory"], "boundaryContrast")?;
            if tasks.len() != 1 || tasks[0]["relationKey"] != key {
                return Err("Mismatched boundary repair.".into());
            }
            value["studyExample"] = example(
                release,
                p,
                tasks[0]["exampleKey"]
                    .as_str()
                    .ok_or("Missing boundary example.")?,
            )?;
        }
        _ => return Err("Invalid repair resource binding.".into()),
    }
    value["repairResourceRef"] = reference.clone();
    Ok(value)
}
