//! Explicit source grants and append-only revocations. No provider key is persisted.
use super::*;
use serde_json::{Value, json};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Set {
        meaning_id: String,
        expected_revision: u32,
        enabled: bool,
        recipient: Option<String>,
    },
}
pub(super) fn current(db: &Connection, meaning: &str) -> Result<Option<Value>> {
    let content:Option<String> = db.query_row("SELECT content FROM personal_anchor_grants g WHERE meaning_id=?1 AND NOT EXISTS(SELECT 1 FROM personal_anchor_revocations r WHERE r.grant_id=g.id) ORDER BY g.rowid DESC LIMIT 1",[meaning],|r|r.get(0)).optional()?;
    content.map(|s| Ok(serde_json::from_str(&s)?)).transpose()
}
pub(super) fn revoke(
    db: &Connection,
    meaning: &str,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    if let Some(grant) = current(db, meaning)? {
        db.execute(
            "INSERT INTO personal_anchor_revocations VALUES(?1,?2,?3)",
            params![
                grant["grantId"].as_str(),
                command.operation_id,
                now.timestamp_millis()
            ],
        )?;
        provisioning::replace_anchor(db, meaning, None, now)?;
    }
    Ok(())
}
pub(super) fn apply(
    db: &Connection,
    action: &Action,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    let Action::Set {
        meaning_id,
        expected_revision,
        enabled,
        recipient,
    } = action;
    let meaning = personal::read_meaning(db, meaning_id, *expected_revision)?;
    if !meaning["materialId"].is_null() {
        return Err(Error::Rule("anchor_requires_personal_provisioning"));
    }
    let previous = current(db, meaning_id)?;
    if *enabled {
        let origin = recipient
            .as_deref()
            .ok_or(Error::Rule("anchor_recipient_required"))?;
        let url = url::Url::parse(origin).map_err(|_| Error::Rule("anchor_recipient_required"))?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || !(url.scheme() == "https"
                || url.scheme() == "http"
                    && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")))
        {
            return Err(Error::Rule("anchor_recipient_required"));
        }
        if previous.as_ref().is_some_and(|g| g["recipient"] == origin) {
            return Ok(());
        }
        revoke(db, meaning_id, command, now)?;
        let sentence = &meaning["snapshot"]["sentence"];
        let context_version =
            semantic::hash(&json!({"anchorId":meaning["contextAnchorId"],"sentence":sentence}))?;
        let grant = json!({"grantId":id(),"meaningId":meaning_id,"contextAnchorId":meaning["contextAnchorId"],"contextVersion":context_version,"sentence":sentence,"recipient":origin,"provider":"configured_model_service","purpose":"learning_content","policyVersion":"original-context-v1","grantedAtMs":now.timestamp_millis()});
        db.execute(
            "INSERT INTO personal_anchor_grants VALUES(?1,?2,?3,?4)",
            params![
                grant["grantId"].as_str(),
                meaning_id,
                grant.to_string(),
                command.operation_id
            ],
        )?;
        provisioning::replace_anchor(db, meaning_id, Some(grant), now)?;
    } else {
        revoke(db, meaning_id, command, now)?;
    }
    if *enabled || previous.is_some() {
        db.execute(
            "UPDATE personal_meanings SET revision=revision+1 WHERE id=?1",
            [meaning_id],
        )?;
    }
    Ok(())
}
pub(super) fn valid(db: &Connection, grant: &Value) -> Result<bool> {
    Ok(current(db, grant["meaningId"].as_str().unwrap_or(""))?.as_ref() == Some(grant))
}
