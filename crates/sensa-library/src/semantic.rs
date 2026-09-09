//! Online resolution is advisory. The local transaction owns candidate acceptance.
use super::*;
use personal::Capture;
use serde_json::{Value, json};
const VERSION: &str = "sensa-native-semantic-v1";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Begin {
        id: String,
        snapshot: Box<Capture>,
        intake_id: Option<String>,
        previous_id: Option<String>,
        clarification: Option<String>,
    },
    Finish {
        result: Value,
    },
    Fail {
        id: String,
        reason: String,
    },
    Accept {
        id: String,
        consent: String,
    },
}
pub fn hash(value: &Value) -> Result<String> {
    // serde_json::Value maps are ordered by Unicode scalar value, like consumer canonical JSON.
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
fn keys(v: &Value, expected: &[&str]) -> Result<()> {
    let o = v.as_object().ok_or(Error::Rule("invalid_proposal"))?;
    if o.len() != expected.len() || expected.iter().any(|k| !o.contains_key(*k)) {
        return Err(Error::Rule("invalid_proposal"));
    }
    Ok(())
}
fn text(v: &Value, max: usize) -> Result<&str> {
    v.as_str()
        .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max)
        .ok_or(Error::Rule("invalid_proposal"))
}
fn strings(v: &Value) -> Result<()> {
    for s in v.as_array().ok_or(Error::Rule("invalid_proposal"))? {
        text(s, 16000)?;
    }
    Ok(())
}
/// Shared consumer semanticProposal constraints; all semantic strings are normalized by Zod too.
pub fn validate_proposal(mut v: Value) -> Result<Value> {
    fn trim(v: &mut Value) {
        match v {
            Value::String(s) => *s = s.trim().to_owned(),
            Value::Array(a) => a.iter_mut().for_each(trim),
            Value::Object(o) => {
                for (k, value) in o {
                    if !matches!(k.as_str(), "type" | "language" | "schemaVersion") {
                        trim(value);
                    }
                }
            }
            _ => {}
        }
    }
    trim(&mut v);
    keys(&v, &["explanation", "semanticSpec", "expression"])?;
    text(&v["explanation"], 2000)?;
    let e = &v["expression"];
    keys(e, &["surface", "type", "language"])?;
    text(&e["surface"], 2000)?;
    if e["language"] != "en"
        || !matches!(
            e["type"].as_str(),
            Some("word" | "phrase" | "construction" | "sentence" | "utterance_strategy")
        )
    {
        return Err(Error::Rule("invalid_proposal"));
    }
    let s = &v["semanticSpec"];
    keys(
        s,
        &[
            "schemaVersion",
            "coreMeaningFocus",
            "prototypeScenes",
            "includedCases",
            "excludedCases",
            "neighborContrasts",
            "openQuestions",
        ],
    )?;
    if s["schemaVersion"] != "sensa-sense-semantic-spec-v1" || s["openQuestions"] != json!([]) {
        return Err(Error::Rule("invalid_proposal"));
    }
    text(&s["coreMeaningFocus"], 16000)?;
    strings(&s["includedCases"])?;
    strings(&s["excludedCases"])?;
    let scenes = s["prototypeScenes"]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or(Error::Rule("invalid_proposal"))?;
    for scene in scenes {
        keys(
            scene,
            &[
                "summary",
                "participantRoles",
                "states",
                "directionOrCausality",
            ],
        )?;
        text(&scene["summary"], 16000)?;
        strings(&scene["participantRoles"])?;
        strings(&scene["states"])?;
        if !scene["directionOrCausality"].is_null() {
            text(&scene["directionOrCausality"], 16000)?;
        }
    }
    for contrast in s["neighborContrasts"]
        .as_array()
        .ok_or(Error::Rule("invalid_proposal"))?
    {
        keys(contrast, &["label", "distinction"])?;
        text(&contrast["label"], 16000)?;
        text(&contrast["distinction"], 16000)?;
    }
    if v.to_string().encode_utf16().count() > 16000 {
        return Err(Error::Rule("invalid_proposal"));
    }
    Ok(v)
}
pub(super) fn read(db: &Connection, id: &str) -> Result<Value> {
    let encoded: String = db
        .query_row(
            "SELECT content FROM semantic_lookups WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("lookup_unavailable"))?;
    Ok(serde_json::from_str(&encoded)?)
}
fn write(db: &Connection, v: &Value) -> Result<()> {
    db.execute(
        "UPDATE semantic_lookups SET content=?2 WHERE id=?1",
        params![v["id"].as_str(), v.to_string()],
    )?;
    Ok(())
}
fn usable(v: &Value, now: DateTime<Utc>) -> Result<()> {
    if matches!(v["status"].as_str(), Some("superseded" | "accepted")) {
        return Err(Error::Rule("lookup_superseded"));
    }
    if v["expiresAtMs"].as_i64().unwrap_or(0) <= now.timestamp_millis() {
        return Err(Error::Rule("lookup_expired"));
    }
    Ok(())
}
pub(super) fn intake_guard(
    db: &Connection,
    snapshot: &Capture,
    intake: Option<&str>,
) -> Result<()> {
    if let Some(intake) = intake {
        let (encoded, removed, meaning): (String, bool, Option<String>) = db
            .query_row(
                "SELECT snapshot,removed,meaning_id FROM personal_intakes WHERE id=?1",
                [intake],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
            .ok_or(Error::Rule("intake_mismatch"))?;
        if removed {
            return Err(Error::Rule("intake_removed"));
        }
        if meaning.is_some() {
            return Err(Error::Rule("intake_already_confirmed"));
        }
        let original: Capture = serde_json::from_str(&encoded)?;
        let mut resolved = original.clone();
        resolved.expression = snapshot.expression.clone();
        if &resolved != snapshot
            || original.expression.is_some() && original.expression != snapshot.expression
        {
            return Err(Error::Rule("intake_mismatch"));
        }
    }
    let removed: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM personal_intakes WHERE identity_digest=?1 AND removed=1)",
        [personal::digest(snapshot)?],
        |r| r.get(0),
    )?;
    if removed {
        return Err(Error::Rule("intake_removed"));
    }
    Ok(())
}
pub(super) fn apply(
    db: &Connection,
    action: &Action,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    match action {
        Action::Begin {
            id,
            snapshot,
            intake_id,
            previous_id,
            clarification,
        } => {
            snapshot.validate()?;
            if snapshot.expression.is_none() {
                return Err(Error::Rule("expression_required"));
            }
            uuid::Uuid::parse_str(id).map_err(|_| Error::Rule("invalid_lookup_id"))?;
            intake_guard(db, snapshot, intake_id.as_deref())?;
            let identity = personal::digest(snapshot)?;
            let accepted: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM personal_meanings WHERE identity_digest=?1)",
                [identity],
                |r| r.get(0),
            )?;
            if accepted {
                return Err(Error::Rule("meaning_already_confirmed"));
            }
            let mut focus = Value::Null;
            if let Some(previous) = previous_id {
                let mut prior = read(db, previous)?;
                if matches!(prior["status"].as_str(), Some("superseded" | "accepted")) {
                    return Err(Error::Rule("lookup_superseded"));
                }
                if prior["request"]["snapshot"] != json!(snapshot)
                    || prior["intakeId"] != json!(intake_id)
                {
                    return Err(Error::Rule("lookup_input_mismatch"));
                }
                focus = prior["focus"].clone();
                if let Some(clarification) = clarification {
                    let trimmed = clarification.trim();
                    if trimmed.is_empty() || trimmed.encode_utf16().count() > 2000 {
                        return Err(Error::Rule("invalid_focus"));
                    }
                    focus = json!({"id":super::id(),"constructionId":focus["constructionId"].as_str().unwrap_or(previous),"previousLookupId":previous,"text":trimmed});
                }
                prior["status"] = json!("superseded");
                write(db, &prior)?;
            } else if clarification.is_some() {
                return Err(Error::Rule("clarification_previous_required"));
            }
            // Bound pending duplicate work for the same capture. Replacements must name their predecessor.
            let concurrent = project(db)?.iter().any(|v| {
                v["request"]["snapshot"] == json!(snapshot)
                    && !matches!(v["status"].as_str(), Some("superseded" | "accepted"))
            });
            if concurrent {
                return Err(Error::Rule("lookup_already_exists"));
            }
            let mut request =
                json!({"version":VERSION,"id":id,"snapshot":snapshot,"focus":focus["text"]});
            request["inputDigest"] = json!(hash(&request)?);
            let v = json!({"id":id,"request":request,"intakeId":intake_id,"focus":focus,"status":"running","proposal":null,"provenance":null,"reason":null,"createdAtMs":now.timestamp_millis(),"expiresAtMs":now.timestamp_millis()+86400000});
            db.execute(
                "INSERT INTO semantic_lookups VALUES(?1,?2,?3)",
                params![id, v.to_string(), now.timestamp_millis()],
            )?;
        }
        Action::Finish { result } => {
            keys(
                result,
                &[
                    "version",
                    "id",
                    "inputDigest",
                    "status",
                    "proposal",
                    "provenance",
                ],
            )?;
            let mut v = read(db, text(&result["id"], 100)?)?;
            usable(&v, now)?;
            if v["status"] != "running" {
                return Err(Error::Rule("lookup_not_running"));
            }
            if result["version"] != VERSION || result["inputDigest"] != v["request"]["inputDigest"]
            {
                return Err(Error::Rule("lookup_input_mismatch"));
            }
            let proposal = if result["status"] == "ready" {
                validate_proposal(result["proposal"].clone())?
            } else if result["status"] == "unresolved" && result["proposal"].is_null() {
                Value::Null
            } else {
                return Err(Error::Rule("invalid_proposal"));
            };
            if !proposal.is_null()
                && proposal["expression"]["surface"].as_str()
                    != v["request"]["snapshot"]["expression"]["text"]
                        .as_str()
                        .map(str::trim)
            {
                return Err(Error::Rule("expression_binding_mismatch"));
            }
            let p = &result["provenance"];
            keys(p, &["provider", "model", "policyVersion", "outputDigest"])?;
            text(&p["provider"], 200)?;
            text(&p["model"], 200)?;
            if !matches!(
                p["policyVersion"].as_str(),
                Some("consumer-semantic-v4" | "language-teacher-v1")
            ) || p["outputDigest"] != hash(&proposal)?
            {
                return Err(Error::Rule("invalid_provenance"));
            }
            v["proposal"] = proposal;
            v["provenance"] = p.clone();
            v["status"] = result["status"].clone();
            write(db, &v)?;
        }
        Action::Fail { id, reason } => {
            let mut v = read(db, id)?;
            usable(&v, now)?;
            if v["status"] != "running" {
                return Err(Error::Rule("lookup_not_running"));
            }
            if !matches!(
                reason.as_str(),
                "network_unavailable"
                    | "lookup_timeout"
                    | "access_required"
                    | "invalid_response"
                    | "provider_unavailable"
            ) {
                return Err(Error::Rule("invalid_lookup_reason"));
            }
            v["status"] = json!("failed");
            v["reason"] = json!(reason);
            write(db, &v)?;
        }
        Action::Accept { id, consent } => {
            if consent != "accept_context_expression_sense" {
                return Err(Error::Rule("semantic_acceptance_required"));
            }
            let mut v = read(db, id)?;
            usable(&v, now)?;
            if v["status"] != "ready" {
                return Err(Error::Rule("lookup_not_ready"));
            }
            let snapshot: Capture = serde_json::from_value(v["request"]["snapshot"].clone())?;
            intake_guard(db, &snapshot, v["intakeId"].as_str())?;
            let capture_digest = personal::digest(&snapshot)?;
            let existing: Option<(String, bool)> = db
                .query_row(
                    "SELECT id,removed FROM personal_meanings WHERE identity_digest=?1",
                    [&capture_digest],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let mid = if let Some((id, removed)) = existing {
                if removed {
                    return Err(Error::Rule("meaning_removed"));
                }
                id
            } else {
                let proposal = validate_proposal(v["proposal"].clone())?;
                let semantic_digest = hash(
                    &json!({"semanticSpec":proposal["semanticSpec"],"expression":proposal["expression"]}),
                )?;
                let existing: Option<String> = db
                    .query_row(
                        "SELECT content FROM semantic_identities WHERE digest=?1",
                        [&semantic_digest],
                        |r| r.get(0),
                    )
                    .optional()?;
                let identity = if let Some(encoded) = existing {
                    serde_json::from_str::<Value>(&encoded)?
                } else {
                    let ids = json!({"senseId":super::id(),"senseVersionId":super::id(),"bindingId":super::id(),"bindingVersionId":super::id(),"semanticSpec":proposal["semanticSpec"],"expression":proposal["expression"]});
                    db.execute(
                        "INSERT INTO semantic_identities VALUES(?1,?2)",
                        params![semantic_digest, ids.to_string()],
                    )?;
                    ids
                };
                let mid = super::id();
                let content = json!({"id":mid,"snapshot":snapshot,"focus":v["focus"]["text"],"meaningFocus":v["focus"],"materialId":null,"materialDigest":null,"senseId":identity["senseId"],"senseVersionId":identity["senseVersionId"],"bindingId":identity["bindingId"],"bindingVersionId":identity["bindingVersionId"],"sense":proposal["semanticSpec"]["coreMeaningFocus"],"expression":proposal["expression"]["surface"],"proposal":proposal,"materialSource":if v["provenance"]["provider"]=="external_intake" {"外部采集，经本人确认"} else {"在线解析，经本人确认"},"contextAnchorId":super::id(),"expressionAnchorId":super::id(),"alignmentId":super::id(),"acceptanceId":super::id(),"acceptedAtMs":now.timestamp_millis(),"acceptanceKind":"direct","resolutionProvenance":{"kind":if v["provenance"]["provider"]=="external_intake" {"external_intake"} else {"online_resolution"},"lookupId":id,"inputDigest":v["request"]["inputDigest"],"generator":v["provenance"]},"sourceLink":snapshot.source_link()});
                db.execute("INSERT INTO personal_meanings(id,identity_digest,content,accepted_at_ms,operation_id) VALUES(?1,?2,?3,?4,?5)",params![mid,capture_digest,content.to_string(),now.timestamp_millis(),command.operation_id])?;
                mid
            };
            db.execute("UPDATE personal_intakes SET meaning_id=?1,revision=revision+1 WHERE (identity_digest=?2 OR id=?3) AND meaning_id IS NULL",params![mid,capture_digest,v["intakeId"].as_str()])?;
            v["status"] = json!("accepted");
            v["meaningId"] = json!(mid);
            write(db, &v)?;
        }
    }
    Ok(())
}
pub(super) fn project(db: &Connection) -> Result<Vec<Value>> {
    let mut q =
        db.prepare("SELECT content FROM semantic_lookups ORDER BY created_at_ms DESC,id")?;
    let values = q
        .query_map([], |r| r.get::<_, String>(0))?
        .map(|r| Ok(serde_json::from_str(&r?)?))
        .collect::<Result<Vec<Value>>>()?;
    if values.len() > 500 {
        return Err(Error::Rule("personal_snapshot_limit"));
    }
    Ok(values)
}
