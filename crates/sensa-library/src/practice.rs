//! Isolated practice ledger. Never invokes formal learning commands or settlement.
use super::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "sourceId", rename_all = "snake_case", deny_unknown_fields)]
pub enum Selection {
    CurrentStudy,
    PersonalSemanticWorld {
        #[serde(rename = "targetIds")]
        target_ids: Vec<String>,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Select {
        selection: Selection,
    },
    Start {
        brief: String,
        provider_available: bool,
    },
    Turn {
        session_id: String,
        ordinal: u32,
        event: Event,
    },
    End {
        session_id: String,
        abandoned: bool,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Event {
    Navigate {
        index: usize,
    },
    Accent {
        accent: String,
    },
    Speed {
        rate: f64,
    },
    Play,
    Pause,
    Replay,
    Next,
    Previous,
    Provider {
        status: String,
        total: u32,
        caption: Option<String>,
        video: Option<String>,
        occurrence: Option<u32>,
        #[serde(default)]
        playing: Option<bool>,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub operation_id: String,
    pub library_id: String,
    pub expected_revision: u32,
    pub action: Action,
}
fn library_id(db: &Connection) -> Result<String> {
    Ok(db.query_row("SELECT id FROM library", [], |r| r.get(0))?)
}
fn rule(v: bool) -> Result<()> {
    if v {
        Ok(())
    } else {
        Err(Error::Rule("invalid_practice_command"))
    }
}
fn sources(db: &Connection) -> Result<(Vec<Value>, Vec<Value>)> {
    let (_, scope) = curriculum::current(db)?;
    let mut study = vec![];
    for target in scope["members"].as_array().unwrap() {
        if let Some(mid) = target["materialId"].as_str() {
            let raw: String =
                db.query_row("SELECT content FROM materials WHERE id=?1", [mid], |r| {
                    r.get(0)
                })?;
            let m: Material = serde_json::from_str(&raw)?;
            study.push(json!({"targetId":format!("catalog:{}",target["targetId"].as_str().unwrap()),"formalTargetId":target["targetId"],"expression":m.expression,"sense":m.sense,"context":m.scene,"senseVersionId":m.sense_version_id,"bindingVersionId":m.binding_version_id,"sourceId":"current_study","materialId":mid,"materialSource":m.source,"languageTag":"en"}));
        }
    }
    let mut q = db.prepare(
        "SELECT content FROM personal_meanings WHERE removed=0 ORDER BY accepted_at_ms DESC,id",
    )?;
    let mut personal = vec![];
    for row in q.query_map([], |r| r.get::<_, String>(0))? {
        let m: Value = serde_json::from_str(&row?)?;
        personal.push(json!({"targetId":format!("personal:{}:{}",m["alignmentId"].as_str().unwrap(),m["bindingVersionId"].as_str().unwrap()),"expression":m["expression"],"sense":m["sense"],"context":m["snapshot"]["sentence"],"senseVersionId":m["senseVersionId"],"bindingVersionId":m["bindingVersionId"],"sourceId":"personal_semantic_world","personalMeaningId":m["id"],"alignmentId":m["alignmentId"],"acceptanceId":m["acceptanceId"],"senseId":m["senseId"],"bindingId":m["bindingId"],"languageTag":m["snapshot"]["language"],"contextSnapshot":m["snapshot"],"worldContext":m["worldContext"],"bindingMetadata":m["bindingMetadata"],"expressionLocator":m["expressionLocator"],"sourceLink":m["sourceLink"],"resolutionProvenance":m["resolutionProvenance"]}));
    }
    Ok((study, personal))
}
// Conservative, versioned deny set for known English heteronyms. YouGlish's
// form-only search cannot constrain their pronunciation. This is not a claim
// that all other forms have been pronunciation-reviewed.
fn blocked_form(expression: &str) -> bool {
    const FORMS: &[&str] = &[
        "read", "lead", "bow", "bass", "live", "wind", "tear", "row", "close", "does", "dove",
        "wound", "sow", "sewer", "minute", "content", "record", "present", "object", "refuse",
        "produce", "desert", "invalid", "polish", "subject", "project", "conduct", "contract",
        "extract", "permit", "rebel", "reject", "resume", "entrance",
    ];
    expression
        .split(|c: char| !c.is_alphabetic())
        .any(|word| FORMS.contains(&word.to_lowercase().as_str()))
}
fn catalog(db: &Connection) -> Result<Value> {
    let (study, personal) = sources(db)?;
    let raw: String = db.query_row("SELECT selection FROM practice_state", [], |r| r.get(0))?;
    let selection: Selection = serde_json::from_str(&raw).unwrap_or(Selection::CurrentStudy);
    let mut chosen = vec![];
    let mut ids = vec![];
    let mut seen = BTreeSet::new();
    if let Selection::PersonalSemanticWorld { target_ids } = selection {
        for id in target_ids {
            if seen.insert(id.clone())
                && let Some(t) = personal.iter().find(|t| t["targetId"] == id)
            {
                ids.push(id);
                chosen.push(t.clone());
            }
        }
    }
    let selection = if chosen.is_empty() {
        Selection::CurrentStudy
    } else {
        Selection::PersonalSemanticWorld { target_ids: ids }
    };
    let current = if chosen.is_empty() {
        study.clone()
    } else {
        chosen
    };
    let blocked: Vec<_> = current
        .iter()
        .filter(|t| blocked_form(t["expression"].as_str().unwrap()))
        .cloned()
        .collect();
    let eligible: Vec<_> = current
        .iter()
        .filter(|t| !blocked_form(t["expression"].as_str().unwrap()))
        .cloned()
        .collect();
    Ok(
        json!({"selection":selection,"targets":eligible,"blockedTargets":blocked,"pronunciationGuardVersion":"known-english-heteronyms-v1","sources":[{"sourceId":"current_study","targets":study},{"sourceId":"personal_semantic_world","targets":personal}]}),
    )
}
fn project(db: &Connection) -> Result<Value> {
    let revision: u32 = db.query_row("SELECT revision FROM practice_state", [], |r| r.get(0))?;
    let c = catalog(db)?;
    let mut q=db.prepare("SELECT id,status,content,state,(SELECT count(*) FROM practice_turns t WHERE t.session_id=s.id) FROM practice_sessions s ORDER BY created_at_ms DESC,rowid DESC LIMIT 40")?;
    let sessions=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,u32>(4)?)))?.map(|r|{let(id,status,content,state,count)=r?;Ok(json!({"id":id,"status":status,"snapshot":serde_json::from_str::<Value>(&content)?,"state":serde_json::from_str::<Value>(&state)?,"turnCount":count}))}).collect::<Result<Vec<_>>>()?;
    let active = sessions.iter().find(|s| s["status"] == "active").cloned();
    Ok(
        json!({"libraryId":library_id(db)?,"revision":revision,"catalog":c,"session":active,"history":sessions,"profileVersion":"sensa-initial-free-practice-v2","inventoryVersion":"native-youglish-widget-v1"}),
    )
}
pub fn query(path: &Path) -> Result<Value> {
    let db = connection(path)?;
    let tx = db.unchecked_transaction()?;
    // Repair persisted selection in the practice ledger only, matching Web's
    // invalid-selection fallback. Never refresh or settle formal activity here.
    let normalized = catalog(&tx)?["selection"].to_string();
    tx.execute(
        "UPDATE practice_state SET selection=?1,revision=revision+1 WHERE selection<>?1",
        [&normalized],
    )?;
    let view = project(&tx)?;
    tx.commit()?;
    Ok(view)
}
pub fn execute(path: &Path, command: Command) -> Result<Value> {
    let mut db = connection(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if library_id(&tx)? != command.library_id {
        return Err(Error::Rule("wrong_library"));
    }
    rule(uuid::Uuid::parse_str(&command.operation_id).is_ok())?;
    let encoded = serde_json::to_string(&command)?;
    let old: Option<(String, String)> = tx
        .query_row(
            "SELECT command,result FROM practice_operations WHERE id=?1",
            [&command.operation_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((original, result)) = old {
        if original != encoded {
            return Err(Error::Rule("operation_conflict"));
        }
        return Ok(serde_json::from_str(&result)?);
    }
    let revision: u32 = tx.query_row("SELECT revision FROM practice_state", [], |r| r.get(0))?;
    if revision != command.expected_revision {
        return Err(Error::Rule("stale_practice_revision"));
    }
    let now = Utc::now().timestamp_millis();
    match &command.action {
        Action::Select { selection } => {
            if let Selection::PersonalSemanticWorld { target_ids } = selection {
                rule(target_ids.len() <= 500 && target_ids.iter().all(|s| s.len() <= 1000))?;
            }
            tx.execute(
                "UPDATE practice_state SET selection=?1",
                [serde_json::to_string(selection)?],
            )?;
            tx.execute(
                "UPDATE practice_state SET selection=?1",
                [catalog(&tx)?["selection"].to_string()],
            )?;
        }
        Action::Start {
            brief,
            provider_available,
        } => {
            rule(!brief.trim().is_empty() && brief.len() <= 2000)?;
            if !provider_available {
                return Err(Error::Rule("practice_provider_unavailable"));
            }
            if tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM practice_sessions WHERE status='active')",
                [],
                |r| r.get::<_, bool>(0),
            )? {
                return Err(Error::Rule("practice_session_active"));
            }
            let scope = catalog(&tx)?;
            let mut seen = BTreeSet::new();
            let expressions: Vec<_> = scope["targets"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|t| seen.insert(t["expression"].as_str().unwrap().trim().to_lowercase()))
                .cloned()
                .collect();
            if expressions.is_empty() {
                return Err(Error::Rule("practice_empty_scope"));
            }
            // Pin only the selected semantic scope, not every unselected catalog source.
            let scope = json!({"selection":scope["selection"],"targets":scope["targets"],"resolverVersion":"native-practice-scope-v1","pronunciationGuardVersion":scope["pronunciationGuardVersion"]});
            let snapshot = json!({"brief":brief,"primaryArea":"listening","activityId":"real_world_speech_variation","activityVersion":"real-world-speech-variation-v1","profileVersion":"sensa-initial-free-practice-v2","inventoryVersion":"native-youglish-widget-v1","provider":"YouGlish","providerApi":"https://youglish.com/public/emb/widget.js","scope":scope,"expressions":expressions});
            tx.execute("INSERT INTO practice_sessions VALUES(?1,'active',?2,?3,?4)",params![id(),snapshot.to_string(),json!({"ordinal":0,"index":0,"accent":"all","rate":1.0,"providerStatus":"loading","total":0,"caption":null,"video":null,"occurrence":null}).to_string(),now])?;
        }
        Action::Turn {
            session_id,
            ordinal,
            event,
        } => {
            let (status, raw, scope): (String, String, String) = tx
                .query_row(
                    "SELECT status,state,content FROM practice_sessions WHERE id=?1",
                    [session_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?
                .ok_or(Error::Rule("practice_session_missing"))?;
            let mut state: Value = serde_json::from_str(&raw)?;
            let snapshot: Value = serde_json::from_str(&scope)?;
            if status != "active" || state["ordinal"] != *ordinal {
                return Err(Error::Rule("stale_practice_turn"));
            }
            match event {
                Event::Navigate { index } => {
                    rule(*index < snapshot["expressions"].as_array().unwrap().len())?;
                    state["index"] = json!(index);
                    state["providerStatus"] = json!("loading");
                    state["caption"] = Value::Null;
                }
                Event::Accent { accent } => {
                    rule(["all", "us", "uk", "aus", "ca", "ie"].contains(&accent.as_str()))?;
                    state["accent"] = json!(accent);
                    state["providerStatus"] = json!("loading");
                    state["caption"] = Value::Null;
                }
                Event::Speed { rate } => {
                    rule([0.5, 0.75, 1.0, 1.25].contains(rate))?;
                    state["rate"] = json!(rate);
                }
                Event::Provider {
                    status,
                    total,
                    caption,
                    video,
                    occurrence,
                    playing,
                } => {
                    rule(
                        ["ready", "empty", "error", "loading"].contains(&status.as_str())
                            && (status != "ready" || *total > 0)
                            && *total <= 10000000
                            && caption.as_ref().is_none_or(|s| s.len() <= 16000)
                            && video.as_ref().is_none_or(|s| s.len() <= 2000),
                    )?;
                    state["providerStatus"] = json!(status);
                    state["total"] = json!(total);
                    state["caption"] = json!(caption);
                    state["video"] = json!(video);
                    state["occurrence"] = json!(occurrence);
                    state["playing"] = json!(playing);
                }
                Event::Pause => {}
                _ => {
                    if state["providerStatus"] != "ready" {
                        return Err(Error::Rule("practice_provider_unavailable"));
                    }
                }
            }
            state["ordinal"] = json!(ordinal + 1);
            tx.execute(
                "INSERT INTO practice_turns VALUES(?1,?2,?3,?4,?5)",
                params![
                    command.operation_id,
                    session_id,
                    ordinal + 1,
                    serde_json::to_string(event)?,
                    now
                ],
            )?;
            tx.execute(
                "UPDATE practice_sessions SET state=?2 WHERE id=?1",
                params![session_id, state.to_string()],
            )?;
        }
        Action::End {
            session_id,
            abandoned,
        } => {
            if tx.execute(
                "UPDATE practice_sessions SET status=?2 WHERE id=?1 AND status='active'",
                params![
                    session_id,
                    if *abandoned { "abandoned" } else { "completed" }
                ],
            )? != 1
            {
                return Err(Error::Rule("practice_session_missing"));
            }
        }
    }
    tx.execute("UPDATE practice_state SET revision=revision+1", [])?;
    let result = project(&tx)?;
    tx.execute(
        "INSERT INTO practice_operations VALUES(?1,?2,?3)",
        params![command.operation_id, encoded, result.to_string()],
    )?;
    tx.commit()?;
    Ok(result)
}
