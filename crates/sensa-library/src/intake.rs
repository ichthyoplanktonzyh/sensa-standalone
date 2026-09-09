//! Port-neutral, bounded intake with an atomic, destination-scoped durable receipt.
use super::*;
use serde_json::{Value, json};

pub const VERSION: &str = "sensa-intake-v1";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: String,
    pub library_id: String,
    pub client_id: String,
    pub operation_id: String,
    pub snapshot: personal::Capture,
    pub resolution: Option<Resolution>,
    pub acceptance: Option<Acceptance>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Resolution {
    Proposal { proposal: Value },
    LocalBinding { material_id: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acceptance {
    pub kind: String,
    pub consent: String,
    pub authorization: String,
}
fn check_library(db: &Connection, library: &str) -> Result<()> {
    let actual: String = db.query_row("SELECT id FROM library", [], |r| r.get(0))?;
    if actual != library {
        return Err(Error::Rule("library_mismatch"));
    }
    Ok(())
}
fn key(client: &str, operation: &str) -> Result<()> {
    for id in [client, operation] {
        Uuid::parse_str(id).map_err(|_| Error::Rule("invalid_intake_identity"))?;
    }
    Ok(())
}
fn old(db: &Connection, client: &str, operation: &str) -> Result<Option<(String, Value)>> {
    let value: Option<(String,String)> = db.query_row("SELECT request_digest,receipt FROM native_intake_receipts WHERE client_id=?1 AND operation_id=?2", params![client, operation], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
    value
        .map(|(digest, raw)| Ok((digest, serde_json::from_str(&raw)?)))
        .transpose()
}
pub fn receipt(path: &Path, library: &str, client: &str, operation: &str) -> Result<Option<Value>> {
    if !path.is_file() {
        return Err(Error::Rule("library_unavailable"));
    }
    key(client, operation)?;
    let db = connection(path)?;
    check_library(&db, library)?;
    Ok(old(&db, client, operation)?.map(|(_, r)| r))
}
pub fn submit(path: &Path, request: &Request) -> Result<Value> {
    if !path.is_file() {
        return Err(Error::Rule("library_unavailable"));
    }
    let mut db = connection(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let command = Command {
        operation_id: id(),
        library_id: request.library_id.clone(),
        expected_revision: tx.query_row("SELECT revision FROM library", [], |r| r.get(0))?,
        action: CommandAction::Intake {
            request: Box::new(request.clone()),
        },
    };
    let (receipt, changed) = apply(&tx, request, &command, Utc::now())?;
    if changed {
        tx.execute("UPDATE library SET revision=revision+1", [])?;
        tx.execute(
            "INSERT INTO operations VALUES(?1,?2,?3)",
            params![
                command.operation_id,
                serde_json::to_string(&command)?,
                serde_json::to_string(&read(&tx)?)?
            ],
        )?;
    }
    tx.commit()?;
    Ok(receipt)
}
pub(super) fn apply(
    db: &Connection,
    r: &Request,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<(Value, bool)> {
    check_library(db, &r.library_id)?;
    key(&r.client_id, &r.operation_id)?;
    let encoded = serde_json::to_vec(r)?;
    if r.version != VERSION || encoded.len() > 65536 {
        return Err(Error::Rule("invalid_intake_request"));
    }
    r.snapshot.validate()?;
    let digest = semantic::hash(&json!(r))?;
    if let Some((prior, receipt)) = old(db, &r.client_id, &r.operation_id)? {
        if prior != digest {
            return Err(Error::Rule("operation_conflict"));
        }
        return Ok((receipt, false));
    }
    if let Some(a) = &r.acceptance
        && (!matches!(a.kind.as_str(), "direct" | "delegated")
            || a.consent != "accept_context_expression_sense"
            || a.authorization.trim().is_empty()
            || a.authorization.encode_utf16().count() > 500
            || r.resolution.is_none())
    {
        return Err(Error::Rule("semantic_acceptance_required"));
    }
    let proposal = match &r.resolution {
        Some(Resolution::Proposal { proposal }) => {
            Some(semantic::validate_proposal(proposal.clone())?)
        }
        _ => None,
    };
    if r.resolution.is_some() && r.snapshot.expression.is_none() {
        return Err(Error::Rule("expression_required"));
    }
    if let Some(p) = &proposal
        && p["expression"]["surface"].as_str()
            != r.snapshot.expression.as_ref().map(|e| e.text.trim())
    {
        return Err(Error::Rule("expression_binding_mismatch"));
    }
    let identity = personal::digest(&r.snapshot)?;
    let removed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM personal_intakes WHERE identity_digest=?1 AND removed=1) OR EXISTS(SELECT 1 FROM personal_meanings WHERE identity_digest=?1 AND removed=1)",[&identity],|r|r.get(0))?;
    if removed {
        return Err(Error::Rule("intake_removed"));
    }
    let existing: Option<String> = db
        .query_row(
            "SELECT content FROM personal_meanings WHERE identity_digest=?1",
            [&identity],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(raw) = existing {
        let m: Value = serde_json::from_str(&raw)?;
        if r.resolution.is_some() {
            let same = match &r.resolution {
                Some(Resolution::Proposal { .. }) => proposal.as_ref().is_some_and(|p| {
                    m["proposal"]["semanticSpec"] == p["semanticSpec"]
                        && m["proposal"]["expression"] == p["expression"]
                }),
                Some(Resolution::LocalBinding { material_id }) => m["materialId"] == *material_id,
                None => false,
            };
            if !same {
                return Err(Error::Rule("capture_resolution_conflict"));
            }
        }
        return record(db, r, &digest, "confirmed", m["id"].clone(), now);
    }
    personal::apply(
        db,
        &personal::Action::SaveIntake {
            snapshot: r.snapshot.clone(),
        },
        command,
        now,
    )?;
    let intake_id: String = db.query_row(
        "SELECT id FROM personal_intakes WHERE identity_digest=?1",
        [&identity],
        |r| r.get(0),
    )?;
    let raw: String = db.query_row(
        "SELECT snapshot FROM personal_intakes WHERE id=?1",
        [&intake_id],
        |r| r.get(0),
    )?;
    let canonical_snapshot: personal::Capture = serde_json::from_str(&raw)?;
    if let Some(p) = proposal {
        // Reuse a matching pending proposal; never silently replace a different teacher result.
        let prior = semantic::project(db)?.into_iter().find(|v| {
            v["request"]["snapshot"] == json!(canonical_snapshot)
                && !matches!(v["status"].as_str(), Some("accepted" | "superseded"))
        });
        let lookup_id = if let Some(v) = prior {
            if v["proposal"] != p || v["status"] != "ready" {
                return Err(Error::Rule("capture_resolution_conflict"));
            }
            v["id"]
                .as_str()
                .ok_or(Error::Rule("invalid_local_data"))?
                .to_owned()
        } else {
            let lid = id();
            semantic::apply(
                db,
                &semantic::Action::Begin {
                    id: lid.clone(),
                    snapshot: Box::new(canonical_snapshot.clone()),
                    intake_id: Some(intake_id.clone()),
                    previous_id: None,
                    clarification: None,
                },
                command,
                now,
            )?;
            let request = semantic::read(db, &lid)?["request"].clone();
            semantic::apply(
                db,
                &semantic::Action::Finish {
                    result: json!({"version":"sensa-native-semantic-v1","id":lid,"inputDigest":request["inputDigest"],"status":"ready","proposal":p,"provenance":{"provider":"external_intake","model":"caller_supplied","policyVersion":"language-teacher-v1","outputDigest":semantic::hash(&p)?}}),
                },
                command,
                now,
            )?;
            lid
        };
        if r.acceptance.is_some() {
            semantic::apply(
                db,
                &semantic::Action::Accept {
                    id: lookup_id,
                    consent: "accept_context_expression_sense".into(),
                },
                command,
                now,
            )?;
        }
    } else if let Some(Resolution::LocalBinding { material_id }) = &r.resolution
        && r.acceptance.is_some()
    {
        personal::apply(
            db,
            &personal::Action::Accept {
                snapshot: canonical_snapshot.clone(),
                material_id: material_id.clone(),
                intake_id: Some(intake_id.clone()),
                focus: None,
                consent: "accept_context_expression_sense".into(),
            },
            command,
            now,
        )?;
    }
    if let Some(a) = &r.acceptance {
        let (mid, raw): (String, String) = db.query_row(
            "SELECT id,content FROM personal_meanings WHERE identity_digest=?1",
            [&identity],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut m: Value = serde_json::from_str(&raw)?;
        m["acceptanceKind"] = json!(a.kind);
        m["materialSource"] = json!("外部采集，经明确接受");
        m["intakeProvenance"] = json!({"clientId":r.client_id,"operationId":r.operation_id,"authorization":a.authorization});
        db.execute(
            "UPDATE personal_meanings SET content=?1 WHERE id=?2",
            params![m.to_string(), mid],
        )?;
        record(db, r, &digest, "confirmed", json!(mid), now)
    } else {
        record(db, r, &digest, "pending", json!(intake_id), now)
    }
}
fn record(
    db: &Connection,
    r: &Request,
    digest: &str,
    status: &str,
    entity: Value,
    now: DateTime<Utc>,
) -> Result<(Value, bool)> {
    let receipt = json!({"version":VERSION,"libraryId":r.library_id,"clientId":r.client_id,"operationId":r.operation_id,"requestDigest":digest,"status":status,"entityId":entity,"committedAt":now.to_rfc3339()});
    db.execute(
        "INSERT INTO native_intake_receipts VALUES(?1,?2,?3,?4)",
        params![r.client_id, r.operation_id, digest, receipt.to_string()],
    )?;
    Ok((receipt, true))
}
