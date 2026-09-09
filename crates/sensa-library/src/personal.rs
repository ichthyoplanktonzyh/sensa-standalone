//! Port-neutral local intake and direct acceptance of already available Sense bindings.
//! Capture, semantic acceptance and Add-to-Learning are separate commands/facts.
use super::*;
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Occurrence {
    pub text: String,
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Video {
    pub platform: String,
    pub video_id: String,
    pub start_ms: u32,
    pub end_ms: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    #[serde(deserialize_with = "required_nullable")]
    pub url: Option<String>,
    pub title: String,
    pub captured_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<Video>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    pub sentence: String,
    pub language: String,
    pub source: Source,
    #[serde(deserialize_with = "required_nullable")]
    pub expression: Option<Occurrence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    SaveIntake {
        snapshot: Capture,
    },
    Accept {
        snapshot: Capture,
        material_id: String,
        intake_id: Option<String>,
        focus: Option<String>,
        consent: String,
    },
    SetMembership {
        entity: Entity,
        id: String,
        expected_revision: u32,
        active: bool,
    },
    AddToLearning {
        meaning_id: String,
        expected_revision: u32,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Entity {
    Intake,
    Meaning,
}
// Nullable is not optional in the shared Capture contract.
fn required_nullable<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
fn length(s: &str) -> usize {
    s.encode_utf16().count()
}
fn nonempty(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && length(s) <= max
}
impl Capture {
    pub fn validate(&self) -> Result<()> {
        if !nonempty(&self.sentence, 12000)
            || self.language != "en"
            || length(&self.source.title) > 1000
            || DateTime::parse_from_rfc3339(&self.source.captured_at).is_err()
        {
            return Err(Error::Rule("invalid_capture"));
        }
        if let Some(e) = &self.expression {
            let chars: Vec<char> = self.sentence.chars().collect();
            if e.text.is_empty()
                || length(&e.text) > 2000
                || e.start >= e.end
                || e.end > chars.len()
                || chars[e.start..e.end].iter().collect::<String>() != e.text
            {
                return Err(Error::Rule("invalid_occurrence"));
            }
        }
        let parsed = self
            .source
            .url
            .as_ref()
            .map(|s| url::Url::parse(s).map_err(|_| Error::Rule("invalid_source")))
            .transpose()?;
        if let Some(u) = &parsed
            && (self.source.url.as_ref().is_some_and(|s| length(s) > 4096)
                || !matches!(u.scheme(), "http" | "https")
                || u.host_str().is_none()
                || !u.username().is_empty()
                || u.password().is_some_and(|s| !s.is_empty()))
        {
            return Err(Error::Rule("invalid_source"));
        }
        if let Some(v) = &self.source.video {
            let u = parsed.as_ref().ok_or(Error::Rule("invalid_video_source"))?;
            let video_id = if u.path() == "/watch" {
                u.query_pairs()
                    .find(|(k, _)| k == "v")
                    .map(|(_, v)| v.into_owned())
            } else {
                u.path()
                    .strip_prefix("/shorts/")
                    .or_else(|| u.path().strip_prefix("/embed/"))
                    .filter(|s| !s.contains('/'))
                    .map(str::to_owned)
            };
            if v.platform != "youtube"
                || v.video_id.len() != 11
                || !v
                    .video_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                || v.end_ms < v.start_ms
                || v.end_ms > 86400000
                || !matches!(
                    u.host_str(),
                    Some(
                        "www.youtube.com"
                            | "youtube.com"
                            | "m.youtube.com"
                            | "www.youtube-nocookie.com"
                    )
                )
                || video_id.as_deref() != Some(&v.video_id)
            {
                return Err(Error::Rule("invalid_video_source"));
            }
        }
        Ok(())
    }
    /// Same identity as the TS consumer: changing title/capture time never duplicates content.
    pub fn identity(&self) -> Value {
        let mut v = json!({"sentence":self.sentence,"language":self.language,"url":self.source.url,"expression":self.expression});
        if let Some(video) = &self.source.video {
            v["video"] = json!(video);
        }
        v
    }
    pub fn source_link(&self) -> Option<String> {
        self.source
            .video
            .as_ref()
            .map(|v| {
                format!(
                    "https://www.youtube.com/watch?v={}&t={}s",
                    v.video_id,
                    v.start_ms / 1000
                )
            })
            .or_else(|| self.source.url.clone())
    }
}
pub(super) fn digest(c: &Capture) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&c.identity())?)
    ))
}
fn material(db: &Connection, id: &str) -> Result<(Material, String)> {
    let (content, digest): (String, String) = db
        .query_row(
            "SELECT content,digest FROM materials WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or(Error::Rule("material_unavailable"))?;
    if format!("{:x}", Sha256::digest(content.as_bytes())) != digest {
        return Err(Error::Rule("material_mismatch"));
    }
    Ok((serde_json::from_str(&content)?, digest))
}
pub(super) fn read_meaning(db: &Connection, id: &str, revision: u32) -> Result<Value> {
    let (content, actual, removed): (String, u32, bool) = db
        .query_row(
            "SELECT content,revision,removed FROM personal_meanings WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(Error::Rule("meaning_unavailable"))?;
    if actual != revision {
        return Err(Error::Rule("revision_conflict"));
    }
    if removed {
        return Err(Error::Rule("meaning_removed"));
    }
    Ok(serde_json::from_str(&content)?)
}
pub(super) fn apply(
    db: &Connection,
    action: &Action,
    command: &Command,
    now: DateTime<Utc>,
) -> Result<()> {
    match action {
        Action::SaveIntake { snapshot } => {
            snapshot.validate()?;
            let identity = digest(snapshot)?;
            db.execute("INSERT INTO personal_intakes(id,identity_digest,snapshot,saved_at_ms,meaning_id) VALUES(?1,?2,?3,?4,(SELECT id FROM personal_meanings WHERE identity_digest=?2)) ON CONFLICT(identity_digest) DO NOTHING",params![id(),identity,serde_json::to_string(snapshot)?,now.timestamp_millis()])?;
        }
        Action::Accept {
            snapshot,
            material_id,
            intake_id,
            focus,
            consent,
        } => {
            snapshot.validate()?;
            if consent != "accept_context_expression_sense" {
                return Err(Error::Rule("semantic_acceptance_required"));
            }
            let occurrence = snapshot
                .expression
                .as_ref()
                .ok_or(Error::Rule("expression_required"))?;
            if focus.as_ref().is_some_and(|s| !nonempty(s, 2000)) {
                return Err(Error::Rule("invalid_focus"));
            }
            let (m, material_digest) = material(db, material_id)?;
            // Choosing a local binding is explicit disambiguation, never automatic matching.
            if occurrence.text.trim().to_lowercase() != m.expression.trim().to_lowercase() {
                return Err(Error::Rule("expression_binding_mismatch"));
            }
            if let Some(intake) = intake_id {
                let (encoded, removed, meaning): (String, bool, Option<String>) = db
                    .query_row(
                        "SELECT snapshot,removed,meaning_id FROM personal_intakes WHERE id=?1",
                        [intake],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()?
                    .ok_or(Error::Rule("intake_mismatch"))?;
                let original: Capture = serde_json::from_str(&encoded)?;
                if removed {
                    return Err(Error::Rule("intake_removed"));
                }
                let mut resolved = original.clone();
                resolved.expression = snapshot.expression.clone();
                if &resolved != snapshot
                    || (original.expression.is_some() && original.expression != snapshot.expression)
                {
                    return Err(Error::Rule("intake_mismatch"));
                }
                if meaning.is_some() {
                    return Err(Error::Rule("intake_already_confirmed"));
                }
            }
            let identity = digest(snapshot)?;
            let removed_intake:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM personal_intakes WHERE identity_digest=?1 AND removed=1)",[&identity],|r|r.get(0))?;
            if removed_intake {
                return Err(Error::Rule("intake_removed"));
            }
            let existing: Option<(String, bool)> = db
                .query_row(
                    "SELECT id,removed FROM personal_meanings WHERE identity_digest=?1",
                    [&identity],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let mid = if let Some((mid, removed)) = existing {
                if removed {
                    return Err(Error::Rule("meaning_removed"));
                }
                mid
            } else {
                let mid = id();
                let content = json!({"id":mid,"snapshot":snapshot,"focus":focus,"materialId":m.id,"materialDigest":material_digest,"senseVersionId":m.sense_version_id,"bindingVersionId":m.binding_version_id,"sense":m.sense,"expression":m.expression,"materialSource":m.source,"contextAnchorId":id(),"expressionAnchorId":id(),"alignmentId":id(),"acceptanceId":id(),"acceptedAtMs":now.timestamp_millis(),"acceptanceKind":"direct","resolutionProvenance":{"kind":"local_material","materialId":material_id,"materialDigest":material_digest},"sourceLink":snapshot.source_link()});
                db.execute("INSERT INTO personal_meanings(id,identity_digest,content,accepted_at_ms,operation_id) VALUES(?1,?2,?3,?4,?5)",params![mid,identity,content.to_string(),now.timestamp_millis(),command.operation_id])?;
                mid
            };
            db.execute("UPDATE personal_intakes SET meaning_id=?1,revision=revision+1 WHERE (identity_digest=?2 OR id=?3) AND meaning_id IS NULL",params![mid,identity,intake_id])?;
        }
        Action::SetMembership {
            entity,
            id,
            expected_revision,
            active,
        } => {
            let table = match entity {
                Entity::Intake => "personal_intakes",
                Entity::Meaning => "personal_meanings",
            };
            let (revision, removed): (u32, bool) = db
                .query_row(
                    &format!("SELECT revision,removed FROM {table} WHERE id=?1"),
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .ok_or(Error::Rule("personal_item_unavailable"))?;
            if revision != *expected_revision {
                return Err(Error::Rule("revision_conflict"));
            }
            if matches!(entity, Entity::Intake) {
                let linked: bool = db.query_row(
                    "SELECT meaning_id IS NOT NULL FROM personal_intakes WHERE id=?1",
                    [id],
                    |r| r.get(0),
                )?;
                if linked {
                    return Err(Error::Rule("meaning_membership_required"));
                }
            }
            if removed == *active {
                db.execute(
                    &format!("UPDATE {table} SET removed=?2,revision=revision+1 WHERE id=?1"),
                    params![id, !active],
                )?;
            }
        }
        Action::AddToLearning {
            meaning_id,
            expected_revision,
        } => {
            let meaning = read_meaning(db, meaning_id, *expected_revision)?;
            let mid = meaning["materialId"]
                .as_str()
                .ok_or(Error::Rule("material_unavailable"))?;
            let (m, digest) = material(db, mid)?;
            if meaning["materialDigest"] != digest
                || meaning["senseVersionId"] != m.sense_version_id
                || meaning["bindingVersionId"] != m.binding_version_id
            {
                return Err(Error::Rule("material_mismatch"));
            }
            let quantity: Option<u32> =
                db.query_row("SELECT daily_new_limit FROM library", [], |r| r.get(0))?;
            if quantity.is_none() {
                return Err(Error::Rule("quantity_required"));
            }
            db.execute("INSERT INTO targets VALUES(?1,?2,?3,?4,'lightweight','v1') ON CONFLICT(sense_version_id,binding_version_id) DO NOTHING",params![id(),mid,m.sense_version_id,m.binding_version_id])?;
            let target: String = db.query_row(
                "SELECT id FROM targets WHERE sense_version_id=?1 AND binding_version_id=?2",
                params![m.sense_version_id, m.binding_version_id],
                |r| r.get(0),
            )?;
            policy::enroll(db, &target)?;
            db.execute("INSERT INTO personal_learning_links VALUES(?1,?2,?3,?4) ON CONFLICT(meaning_id,target_id) DO NOTHING",params![meaning_id,target,command.operation_id,now.timestamp_millis()])?;
        }
    }
    Ok(())
}
pub(super) fn project(db: &Connection) -> Result<Value> {
    let mut q=db.prepare("SELECT id,snapshot,revision,removed,meaning_id,saved_at_ms FROM personal_intakes ORDER BY saved_at_ms DESC,id")?;
    let intakes=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,u32>(2)?,r.get::<_,bool>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,i64>(5)?)))?.map(|r|{let(id,snapshot,revision,removed,meaning,time)=r?;let s:Capture=serde_json::from_str(&snapshot)?;Ok(json!({"id":id,"snapshot":s,"revision":revision,"status":if removed {"removed"}else if meaning.is_some(){"confirmed"}else{"inbox"},"meaningId":meaning,"savedAtMs":time,"sourceLink":s.source_link()}))}).collect::<Result<Vec<_>>>()?;
    let mut q = db.prepare(
        "SELECT content,revision,removed FROM personal_meanings ORDER BY accepted_at_ms DESC,id",
    )?;
    let meanings = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, bool>(2)?,
            ))
        })?
        .map(|r| {
            let (content, revision, removed) = r?;
            let mut v: Value = serde_json::from_str(&content)?;
            v["revision"] = json!(revision);
            v["status"] = json!(if removed { "removed" } else { "confirmed" });
            let linked: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM personal_learning_links WHERE meaning_id=?1)",
                [v["id"].as_str()],
                |r| r.get(0),
            )?;
            let task = provisioning::for_meaning(db, v["id"].as_str().unwrap_or(""))?;
            v["addedToLearning"] = json!(linked || task.is_some());
            v["preparation"] = json!(task);
            Ok(v)
        })
        .collect::<Result<Vec<_>>>()?;
    if intakes.len() > 500 || meanings.len() > 500 {
        return Err(Error::Rule("personal_snapshot_limit"));
    }
    Ok(
        json!({"intakes":intakes,"meanings":meanings,"lookups":semantic::project(db)?,"preparations":provisioning::project(db)?}),
    )
}
