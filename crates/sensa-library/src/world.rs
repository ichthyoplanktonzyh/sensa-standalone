//! Learner-owned draft/context/branch transactions; never runs formal planning.
use super::*;
use serde_json::{Value, json};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    Text { id: String, text: String },
    Image { id: String, digest: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub blocks: Vec<Block>,
    pub familiar_expression: String,
    pub starting_point: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Source {
    Material { id: String },
    Meaning { id: String, revision: u32 },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Save {
        id: String,
        expected_revision: u32,
        draft: Draft,
        submit: bool,
    },
    Membership {
        id: String,
        expected_revision: u32,
        active: bool,
    },
    MeaningMembership {
        meaning_id: String,
        expected_revision: u32,
        active: bool,
    },
    Resolve {
        id: String,
        expected_revision: u32,
        source: Source,
        consent: String,
    },
    Bind {
        meaning_id: String,
        expected_revision: u32,
        surface: String,
        expression_type: String,
        relation: String,
        coverage: String,
        consent: String,
    },
}
fn rule(ok: bool, code: &'static str) -> Result<()> {
    if ok { Ok(()) } else { Err(Error::Rule(code)) }
}
fn uuid(s: &str) -> Result<()> {
    rule(Uuid::parse_str(s).is_ok(), "invalid_world_identity")
}
fn bounded(s: &str, n: usize) -> bool {
    s.chars().count() <= n
}
pub(super) fn read_draft(db: &Connection, id: &str, revision: u32) -> Result<(Draft, String)> {
    let (r, status, raw): (u32, String, String) = db
        .query_row(
            "SELECT revision,status,content FROM world_drafts WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(Error::Rule("draft_missing"))?;
    rule(r == revision, "draft_conflict")?;
    rule(status != "removed", "draft_removed")?;
    Ok((serde_json::from_str(&raw)?, status))
}
pub(super) fn validate(db: &Connection, d: &Draft, complete: bool) -> Result<()> {
    rule(
        d.blocks.len() <= 30 && bounded(&d.familiar_expression, 4000),
        "invalid_world_draft",
    )?;
    rule(
        d.starting_point.as_ref().is_none_or(|s| {
            ["from_experience", "from_expression", "from_sense"].contains(&s.as_str())
        }),
        "invalid_starting_point",
    )?;
    let mut ids = std::collections::BTreeSet::new();
    let mut nonempty = !d.familiar_expression.trim().is_empty();
    for b in &d.blocks {
        let id = match b {
            Block::Text { id, text } => {
                rule(bounded(text, 16000), "world_text_too_long")?;
                nonempty |= !text.trim().is_empty();
                id
            }
            Block::Image { id, digest } => {
                rule(
                    db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM world_media WHERE digest=?1)",
                        [digest],
                        |r| r.get::<_, bool>(0),
                    )?,
                    "world_media_missing",
                )?;
                nonempty = true;
                id
            }
        };
        uuid(id)?;
        rule(ids.insert(id), "duplicate_world_block")?;
    }
    rule(!complete || nonempty, "empty_world_context")?;
    rule(
        serde_json::to_vec(d)?.len() <= 256 * 1024,
        "world_draft_too_large",
    )
}
pub fn put_media(path: &Path, bytes: &[u8]) -> Result<String> {
    rule(
        !bytes.is_empty() && bytes.len() <= 4 * 1024 * 1024,
        "world_image_too_large",
    )?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| Error::Rule("invalid_world_image"))?;
    let format = reader.format().ok_or(Error::Rule("invalid_world_image"))?;
    rule(
        matches!(
            format,
            image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP
        ),
        "unsupported_world_image",
    )?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| Error::Rule("invalid_world_image"))?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    let db = connection(path)?;
    db.execute(
        "INSERT INTO world_media VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
        params![digest, format.to_mime_type(), bytes],
    )?;
    Ok(digest)
}
pub fn media(path: &Path, digest: &str) -> Result<Vec<u8>> {
    let db = connection(path)?;
    let bytes: Vec<u8> = db
        .query_row(
            "SELECT bytes FROM world_media WHERE digest=?1",
            [digest],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("world_media_missing"))?;
    rule(
        format!("{:x}", Sha256::digest(&bytes)) == digest,
        "world_media_corrupt",
    )?;
    Ok(bytes)
}
fn source(db: &Connection, s: &Source) -> Result<Value> {
    match s {
        Source::Meaning { id, revision } => personal::read_meaning(db, id, *revision),
        Source::Material { id } => {
            let (raw, digest): (String, String) = db
                .query_row(
                    "SELECT content,digest FROM materials WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .ok_or(Error::Rule("material_unavailable"))?;
            rule(
                format!("{:x}", Sha256::digest(raw.as_bytes())) == digest,
                "material_mismatch",
            )?;
            let m: Material = serde_json::from_str(&raw)?;
            Ok(
                json!({"materialId":m.id,"materialDigest":digest,"senseVersionId":m.sense_version_id,"bindingVersionId":m.binding_version_id,"sense":m.sense,"expression":m.expression,"materialSource":m.source}),
            )
        }
    }
}
pub(super) fn insert_meaning(
    db: &Connection,
    mut m: Value,
    identity: String,
    op: &str,
    now: i64,
) -> Result<()> {
    let same: Option<bool> = db.query_row("SELECT removed FROM personal_meanings WHERE json_extract(content,'$.contextAnchorId')=?1 AND json_extract(content,'$.senseVersionId')=?2 AND json_extract(content,'$.bindingVersionId')=?3", params![m["contextAnchorId"].as_str(),m["senseVersionId"].as_str(),m["bindingVersionId"].as_str()], |r|r.get(0)).optional()?;
    if let Some(removed) = same {
        return rule(!removed, "meaning_removed");
    }
    let existing: Option<bool> = db
        .query_row(
            "SELECT removed FROM personal_meanings WHERE identity_digest=?1",
            [&identity],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(removed) = existing {
        return rule(!removed, "meaning_removed");
    }
    rule(
        db.query_row("SELECT count(*)<500 FROM personal_meanings", [], |r| {
            r.get(0)
        })?,
        "personal_limit",
    )?;
    let mid = id();
    m["id"] = json!(mid);
    m["acceptanceId"] = json!(id());
    m["alignmentId"] = json!(id());
    m["expressionAnchorId"] = json!(id());
    m["acceptedAtMs"] = json!(now);
    m["acceptanceKind"] = json!("direct");
    // Projection-only fields never become facts in a new meaning.
    if let Some(o) = m.as_object_mut() {
        for k in ["revision", "status", "learningTargetId", "enrolled"] {
            o.remove(k);
        }
    }
    db.execute("INSERT INTO personal_meanings(id,identity_digest,content,accepted_at_ms,operation_id) VALUES(?1,?2,?3,?4,?5)",params![mid,identity,m.to_string(),now,op])?;
    Ok(())
}
pub(super) fn apply(db: &Connection, a: &Action, command: &Command, now: i64) -> Result<()> {
    let op = &command.operation_id;
    match a {
        Action::MeaningMembership {
            meaning_id,
            expected_revision,
            active,
        } => personal::apply(
            db,
            &personal::Action::SetMembership {
                entity: personal::Entity::Meaning,
                id: meaning_id.clone(),
                expected_revision: *expected_revision,
                active: *active,
            },
            command,
            DateTime::from_timestamp_millis(now).unwrap(),
        )?,
        Action::Save {
            id,
            expected_revision,
            draft,
            submit,
        } => {
            uuid(id)?;
            validate(db, draft, *submit)?;
            let old: Option<(u32, String)> = db
                .query_row(
                    "SELECT revision,status FROM world_drafts WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((r, status)) = old {
                rule(r == *expected_revision, "draft_conflict")?;
                rule(status == "editing" || status == "inbox", "draft_frozen")?;
                db.execute("UPDATE world_drafts SET content=?2,revision=revision+1,status=?3,updated_at_ms=?4 WHERE id=?1",params![id,serde_json::to_string(draft)?,if *submit{"inbox"}else{"editing"},now])?;
            } else {
                rule(*expected_revision == 0, "draft_missing")?;
                rule(
                    db.query_row("SELECT count(*)<500 FROM world_drafts", [], |r| r.get(0))?,
                    "draft_limit",
                )?;
                db.execute(
                    "INSERT INTO world_drafts VALUES(?1,1,?2,?3,?4)",
                    params![
                        id,
                        if *submit { "inbox" } else { "editing" },
                        serde_json::to_string(draft)?,
                        now
                    ],
                )?;
            }
        }
        Action::Membership {
            id,
            expected_revision,
            active,
        } => {
            let (r, status): (u32, String) = db
                .query_row(
                    "SELECT revision,status FROM world_drafts WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .ok_or(Error::Rule("draft_missing"))?;
            rule(r == *expected_revision, "draft_conflict")?;
            let accepted:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM personal_meanings WHERE json_extract(content,'$.worldContext.id')=?1)",[id],|r|r.get(0))?;
            let next = if *active {
                if accepted { "accepted" } else { "inbox" }
            } else {
                "removed"
            };
            if next != status {
                db.execute(
                    "UPDATE world_drafts SET status=?2 WHERE id=?1",
                    params![id, next],
                )?;
            }
        }
        Action::Resolve {
            id,
            expected_revision,
            source: s,
            consent,
        } => {
            rule(
                consent == "accept_context_expression_sense",
                "semantic_acceptance_required",
            )?;
            let (d, _) = read_draft(db, id, *expected_revision)?;
            validate(db, &d, true)?;
            let mut m = source(db, s)?;
            let text = d
                .blocks
                .iter()
                .filter_map(|b| {
                    if let Block::Text { text, .. } = b {
                        Some(text.as_str())
                    } else {
                        None
                    }
                })
                .chain(if d.familiar_expression.is_empty() {
                    None
                } else {
                    Some(d.familiar_expression.as_str())
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            m["snapshot"] = json!({"sentence":text,"language":"und","expression":null,"source":{"url":null,"title":"个人图文材料","capturedAt":DateTime::from_timestamp_millis(now).unwrap().to_rfc3339()}});
            m["worldContext"] = json!({"id":id,"revision":expected_revision,"draft":d});
            m["contextAnchorId"] = json!(format!("world:{id}:{expected_revision}"));
            m["focus"] = Value::Null;
            m["meaningFocus"] = Value::Null;
            m["sourceLink"] = Value::Null;
            m["expressionLocator"] =
                json!({"kind":"context","contextId":id,"contextRevision":expected_revision});
            m["resolutionProvenance"] = json!({"kind":"learner_context_alignment","source":s});
            let identity = semantic::hash(
                &json!({"context":id,"revision":expected_revision,"senseVersionId":m["senseVersionId"],"bindingVersionId":m["bindingVersionId"]}),
            )?;
            insert_meaning(db, m, identity, op, now)?;
            db.execute(
                "UPDATE world_drafts SET status='accepted' WHERE id=?1",
                [id],
            )?;
        }
        Action::Bind {
            meaning_id,
            expected_revision,
            surface,
            expression_type,
            relation,
            coverage,
            consent,
        } => {
            rule(
                consent == "confirm_expression_binding",
                "semantic_acceptance_required",
            )?;
            rule(
                !surface.trim().is_empty() && bounded(surface, 2000),
                "invalid_binding",
            )?;
            rule(
                [
                    "word",
                    "phrase",
                    "construction",
                    "sentence",
                    "utterance_strategy",
                ]
                .contains(&expression_type.as_str())
                    && ["realizes", "approximates", "evokes"].contains(&relation.as_str())
                    && ["exact", "broader", "narrower", "overlapping"].contains(&coverage.as_str()),
                "invalid_binding",
            )?;
            let mut m = personal::read_meaning(db, meaning_id, *expected_revision)?;
            // Legacy compact materials do not contain a full semanticSpec for a new binding.
            rule(m["proposal"].is_object(), "binding_spec_unavailable")?;
            let mut proposal = m["proposal"].clone();
            proposal["expression"] =
                json!({"surface":surface.trim(),"type":expression_type,"language":"en"});
            let proposal = semantic::validate_proposal(proposal)?;
            let expression = json!({"surface":surface.trim(),"type":expression_type,"language":"en","relation":relation,"semanticCoverage":coverage});
            let current_expression = m["bindingMetadata"].as_object().map(|_| m["bindingMetadata"].clone()).unwrap_or_else(|| json!({"surface":m["proposal"]["expression"]["surface"],"type":m["proposal"]["expression"]["type"],"language":"en","relation":"realizes","semanticCoverage":"exact"}));
            if current_expression == expression {
                return Ok(());
            }
            let key = semantic::hash(
                &json!({"senseVersionId":m["senseVersionId"],"expression":expression}),
            )?;
            let old: Option<String> = db
                .query_row(
                    "SELECT content FROM world_bindings WHERE identity=?1",
                    [&key],
                    |r| r.get(0),
                )
                .optional()?;
            let old = if old.is_none() && relation == "realizes" && coverage == "exact" {
                db.query_row("SELECT content FROM semantic_identities WHERE json_extract(content,'$.senseVersionId')=?1 AND json_extract(content,'$.expression.surface')=?2 AND json_extract(content,'$.expression.type')=?3",params![m["senseVersionId"].as_str(),surface.trim(),expression_type],|r|r.get::<_,String>(0)).optional()?
            } else {
                old
            };
            let binding = if let Some(raw) = old {
                serde_json::from_str::<Value>(&raw)?
            } else {
                let b = json!({"bindingId":id(),"bindingVersionId":id(),"expression":expression});
                db.execute(
                    "INSERT INTO world_bindings VALUES(?1,?2)",
                    params![key, b.to_string()],
                )?;
                b
            };
            m["bindingId"] = binding["bindingId"].clone();
            m["bindingVersionId"] = binding["bindingVersionId"].clone();
            m["bindingMetadata"] = expression;
            m["expression"] = json!(surface.trim());
            m["proposal"] = proposal;
            m["materialId"] = Value::Null;
            m["materialDigest"] = Value::Null;
            m["parentMeaningId"] = json!(meaning_id);
            m["expressionLocator"] = json!({"kind":"context","contextAnchorId":m["contextAnchorId"],"parentMeaningId":meaning_id});
            m["resolutionProvenance"] = json!({"kind":"learner_expression_binding","parentMeaningId":meaning_id,"parentRevision":expected_revision});
            let identity = semantic::hash(
                &json!({"contextAnchorId":m["contextAnchorId"],"senseVersionId":m["senseVersionId"],"bindingVersionId":m["bindingVersionId"]}),
            )?;
            insert_meaning(db, m, identity, op, now)?;
        }
    }
    Ok(())
}
pub fn query(path: &Path) -> Result<Value> {
    let db = connection(path)?;
    let tx = db.unchecked_transaction()?;
    let s = read(&tx)?;
    let mut q=tx.prepare("SELECT id,revision,status,content,updated_at_ms FROM world_drafts ORDER BY updated_at_ms DESC,id")?;
    let drafts=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u32>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?)))?.map(|r|{let(id,revision,status,raw,updated)=r?;Ok(json!({"id":id,"revision":revision,"status":status,"draft":serde_json::from_str::<Value>(&raw)?,"updatedAtMs":updated}))}).collect::<Result<Vec<_>>>()?;
    Ok(
        json!({"libraryId":s.library_id,"revision":s.revision,"drafts":drafts,"meanings":s.personal["meanings"],"materials":s.catalog}),
    )
}

/// Commit a teacher proposal only under the learner's explicit acceptance.
pub(super) fn accept_agent(
    db: &Connection,
    draft_id: &str,
    revision: u32,
    proposal: Value,
    provenance: Value,
    command: &Command,
    now: i64,
) -> Result<()> {
    let (draft, _) = read_draft(db, draft_id, revision)?;
    validate(db, &draft, true)?;
    let proposal = semantic::validate_proposal(proposal)?;
    let digest = semantic::hash(
        &json!({"semanticSpec":proposal["semanticSpec"],"expression":proposal["expression"]}),
    )?;
    let raw: Option<String> = db
        .query_row(
            "SELECT content FROM semantic_identities WHERE digest=?1",
            [&digest],
            |r| r.get(0),
        )
        .optional()?;
    let identity = if let Some(raw) = raw {
        serde_json::from_str::<Value>(&raw)?
    } else {
        let value = json!({"senseId":id(),"senseVersionId":id(),"bindingId":id(),"bindingVersionId":id(),"semanticSpec":proposal["semanticSpec"],"expression":proposal["expression"]});
        db.execute(
            "INSERT INTO semantic_identities VALUES(?1,?2)",
            params![digest, value.to_string()],
        )?;
        value
    };
    let text = draft
        .blocks
        .iter()
        .filter_map(|b| {
            if let Block::Text { text, .. } = b {
                Some(text.as_str())
            } else {
                None
            }
        })
        .chain(Some(draft.familiar_expression.as_str()))
        .collect::<Vec<_>>()
        .join("\n\n");
    let context = format!("world:{draft_id}:{revision}");
    let mut m = identity;
    m["snapshot"] = json!({"sentence":text,"language":"und","expression":null,"source":{"url":null,"title":"语言老师对话材料","capturedAt":DateTime::from_timestamp_millis(now).unwrap().to_rfc3339()}});
    m["worldContext"] = json!({"id":draft_id,"revision":revision,"draft":draft});
    m["contextAnchorId"] = json!(context);
    m["focus"] = Value::Null;
    m["sourceLink"] = Value::Null;
    m["expressionLocator"] =
        json!({"kind":"context","contextId":draft_id,"contextRevision":revision});
    m["sense"] = proposal["semanticSpec"]["coreMeaningFocus"].clone();
    m["expression"] = proposal["expression"]["surface"].clone();
    m["proposal"] = proposal;
    m["materialId"] = Value::Null;
    m["materialDigest"] = Value::Null;
    m["materialSource"] = json!("语言老师建议，经本人确认");
    m["resolutionProvenance"] = provenance;
    let key = semantic::hash(
        &json!({"contextAnchorId":context,"senseVersionId":m["senseVersionId"],"bindingVersionId":m["bindingVersionId"]}),
    )?;
    insert_meaning(db, m, key, &command.operation_id, now)?;
    db.execute(
        "UPDATE world_drafts SET status='accepted' WHERE id=?1",
        [draft_id],
    )?;
    Ok(())
}
