//! Formal source lifecycle. Membership never owns or deletes learning history.
use super::*;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Book {
    pub format: String,
    pub id: String,
    pub version: String,
    pub title: String,
    pub members: Vec<Member>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub material_id: String,
    #[serde(default)]
    pub section: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Range {
    All,
    Ordinals { start: usize, end: usize },
    Section { section: String },
    Selection { material_ids: Vec<String> },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    ImportBook {
        book_json: String,
    },
    Enroll {
        book_id: String,
        version: String,
        range: Range,
    },
    SetMode {
        enrollment_id: String,
        mode: String,
    },
    SetRange {
        enrollment_id: String,
        range: Range,
    },
    Supplemental {
        target_id: String,
        active: bool,
    },
    MoveSupplemental {
        target_id: String,
        before_target_id: Option<String>,
    },
    SelectSources {
        source_ids: Option<Vec<String>>,
    },
}
fn exists(db: &Connection) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='curriculum_settings')",
        [],
        |r| r.get(0),
    )?)
}
fn require(v: bool) -> Result<()> {
    if v {
        Ok(())
    } else {
        Err(Error::Rule("invalid_curriculum"))
    }
}
fn book(db: &Connection, id: &str, version: &str) -> Result<Book> {
    let s: String = db
        .query_row(
            "SELECT content FROM curriculum_books WHERE id=?1 AND version=?2",
            params![id, version],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::Rule("book_unavailable"))?;
    Ok(serde_json::from_str(&s)?)
}
pub(super) fn register(db: &Connection, b: &Book) -> Result<()> {
    require(
        b.format == "sensa-local-book-v1"
            && [&b.id, &b.version, &b.title]
                .iter()
                .all(|s| !s.trim().is_empty() && s.len() <= 500)
            && !b.members.is_empty()
            && b.members.len() <= 5000,
    )?;
    let mut seen = BTreeSet::new();
    for m in &b.members {
        require(
            seen.insert(&m.material_id)
                && m.section
                    .as_ref()
                    .is_none_or(|s| !s.trim().is_empty() && s.len() <= 500),
        )?;
        let content: String = db
            .query_row(
                "SELECT content FROM materials WHERE id=?1",
                [&m.material_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(Error::Rule("book_material_not_downloaded"))?;
        let material: Material = serde_json::from_str(&content)?;
        require(!material.source.starts_with("on-demand:"))?;
    }
    let encoded = serde_json::to_string(b)?;
    let old: Option<String> = db
        .query_row(
            "SELECT content FROM curriculum_books WHERE id=?1 AND version=?2",
            params![b.id, b.version],
            |r| r.get(0),
        )
        .optional()?;
    if old.is_some_and(|s| s != encoded) {
        return Err(Error::Rule("book_version_conflict"));
    }
    db.execute(
        "INSERT INTO curriculum_books VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
        params![b.id, b.version, encoded],
    )?;
    Ok(())
}
pub(super) fn register_packs(db: &Connection) -> Result<()> {
    let mut q = db.prepare("SELECT content FROM imported_packs")?;
    let packs = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for s in packs {
        let p: pack::LearningPack = serde_json::from_str(&s)?;
        register(
            db,
            &Book {
                format: "sensa-local-book-v1".into(),
                id: p.id,
                version: p.version,
                title: p.title,
                members: p
                    .materials
                    .into_iter()
                    .map(|m| Member {
                        material_id: m.id,
                        section: None,
                    })
                    .collect(),
            },
        )?;
    }
    Ok(())
}
fn resolve(b: &Book, range: &Range) -> Result<BTreeSet<String>> {
    let ids: Vec<_> = b.members.iter().map(|m| m.material_id.clone()).collect();
    let chosen = match range {
        Range::All => ids.clone(),
        Range::Ordinals { start, end } => {
            require(*start >= 1 && start <= end && *end <= ids.len())?;
            ids[start - 1..*end].to_vec()
        }
        Range::Section { section } => b
            .members
            .iter()
            .filter(|m| m.section.as_ref() == Some(section))
            .map(|m| m.material_id.clone())
            .collect(),
        Range::Selection { material_ids } => {
            require(
                material_ids.len() <= ids.len()
                    && material_ids.iter().all(|m| ids.contains(m))
                    && material_ids.iter().collect::<BTreeSet<_>>().len() == material_ids.len(),
            )?;
            material_ids.clone()
        }
    };
    require(!chosen.is_empty())?;
    Ok(chosen.into_iter().collect())
}
fn target(db: &Connection, mid: &str) -> Result<String> {
    let s: String = db.query_row("SELECT content FROM materials WHERE id=?1", [mid], |r| {
        r.get(0)
    })?;
    let m: Material = serde_json::from_str(&s)?;
    db.execute("INSERT INTO targets VALUES(?1,?2,?3,?4,'lightweight','v1') ON CONFLICT(sense_version_id,binding_version_id) DO NOTHING",params![id(),mid,m.sense_version_id,m.binding_version_id])?;
    let tid: String = db.query_row(
        "SELECT id FROM targets WHERE sense_version_id=?1 AND binding_version_id=?2",
        params![m.sense_version_id, m.binding_version_id],
        |r| r.get(0),
    )?;
    policy::enroll(db, &tid)?;
    Ok(tid)
}
fn set_range(db: &Connection, eid: &str, b: &Book, range: &Range) -> Result<()> {
    let chosen = resolve(b, range)?;
    for (index, m) in b.members.iter().enumerate() {
        let tid = target(db, &m.material_id)?;
        db.execute("INSERT INTO curriculum_members VALUES(?1,?2,?3,?4,?5,EXISTS(SELECT 1 FROM runs WHERE target_id=?2)) ON CONFLICT(source_id,target_id) DO UPDATE SET in_range=excluded.in_range",params![eid,tid,m.material_id,index as i64,chosen.contains(&m.material_id)])?;
    }
    db.execute(
        "UPDATE curriculum_enrollments SET range_json=?2 WHERE id=?1",
        params![eid, serde_json::to_string(range)?],
    )?;
    Ok(())
}
pub(super) fn supplement(db: &Connection, tid: &str) -> Result<()> {
    if !exists(db)? {
        return Ok(());
    }
    // Book coverage is independent of the temporary source filter. Admission must
    // not create a redundant membership for an already covered target.
    if db.query_row("SELECT EXISTS(SELECT 1 FROM curriculum_members m JOIN curriculum_enrollments e ON e.id=m.source_id WHERE m.target_id=?1 AND e.mode!='paused' AND (m.started=1 OR (e.mode='active' AND m.in_range=1)))", [tid], |r| r.get::<_,bool>(0))? {
        return Ok(());
    }
    db.execute("INSERT INTO curriculum_supplemental VALUES(?1,1,(SELECT coalesce(max(ordinal),0)+1 FROM curriculum_supplemental),'explicit_admission') ON CONFLICT(target_id) DO UPDATE SET active=1",[tid])?;
    Ok(())
}
pub(super) fn apply(db: &Connection, a: &Action) -> Result<()> {
    if db.query_row(
        "SELECT EXISTS(SELECT 1 FROM learning_activities WHERE status='active')",
        [],
        |r| r.get::<_, bool>(0),
    )? {
        return Err(Error::Rule("pause_activity_before_curriculum_change"));
    }
    match a {
        Action::ImportBook { book_json } => {
            require(book_json.len() <= 2_000_000)?;
            register(
                db,
                &serde_json::from_str(book_json).map_err(|_| Error::Rule("invalid_curriculum"))?,
            )?;
        }
        Action::Enroll {
            book_id,
            version,
            range,
        } => {
            let b = book(db, book_id, version)?;
            resolve(&b, range)?;
            db.execute(
                "UPDATE curriculum_enrollments SET mode='maintenance' WHERE mode='active'",
                [],
            )?;
            let eid: Option<String> = db
                .query_row(
                    "SELECT id FROM curriculum_enrollments WHERE book_id=?1 AND book_version=?2",
                    params![book_id, version],
                    |r| r.get(0),
                )
                .optional()?;
            let eid = eid.unwrap_or_else(id);
            db.execute("INSERT INTO curriculum_enrollments VALUES(?1,?2,?3,'active',?4) ON CONFLICT(id) DO UPDATE SET mode='active'",params![eid,book_id,version,serde_json::to_string(range)?])?;
            set_range(db, &eid, &b, range)?;
        }
        Action::SetMode {
            enrollment_id,
            mode,
        } => {
            require(["active", "maintenance", "paused"].contains(&mode.as_str()))?;
            require(db.query_row(
                "SELECT EXISTS(SELECT 1 FROM curriculum_enrollments WHERE id=?1)",
                [enrollment_id],
                |r| r.get(0),
            )?)?;
            if mode == "active" {
                db.execute(
                    "UPDATE curriculum_enrollments SET mode='maintenance' WHERE mode='active'",
                    [],
                )?;
            }
            db.execute(
                "UPDATE curriculum_enrollments SET mode=?2 WHERE id=?1",
                params![enrollment_id, mode],
            )?;
        }
        Action::SetRange {
            enrollment_id,
            range,
        } => {
            let (bid, version): (String, String) = db.query_row(
                "SELECT book_id,book_version FROM curriculum_enrollments WHERE id=?1",
                [enrollment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            set_range(db, enrollment_id, &book(db, &bid, &version)?, range)?;
        }
        Action::Supplemental { target_id, active } => {
            require(db.query_row(
                "SELECT EXISTS(SELECT 1 FROM curriculum_supplemental WHERE target_id=?1)",
                [target_id],
                |r| r.get(0),
            )?)?;
            db.execute(
                "UPDATE curriculum_supplemental SET active=?2 WHERE target_id=?1",
                params![target_id, active],
            )?;
        }
        Action::MoveSupplemental {
            target_id,
            before_target_id,
        } => {
            let mut q = db.prepare(
                "SELECT target_id FROM curriculum_supplemental ORDER BY ordinal,target_id",
            )?;
            let mut ids = q
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            require(
                ids.contains(target_id)
                    && before_target_id
                        .as_ref()
                        .is_none_or(|b| b != target_id && ids.contains(b)),
            )?;
            ids.retain(|t| t != target_id);
            let i = before_target_id
                .as_ref()
                .and_then(|b| ids.iter().position(|v| v == b))
                .unwrap_or(ids.len());
            ids.insert(i, target_id.clone());
            for (i, t) in ids.iter().enumerate() {
                db.execute(
                    "UPDATE curriculum_supplemental SET ordinal=?2 WHERE target_id=?1",
                    params![t, i as i64],
                )?;
            }
        }
        Action::SelectSources { source_ids } => {
            if let Some(ids) = source_ids {
                require(
                    ids.len() <= 1000 && ids.iter().collect::<BTreeSet<_>>().len() == ids.len(),
                )?;
                for sid in ids {
                    require(
                        sid == "supplemental"
                            || db.query_row(
                                "SELECT EXISTS(SELECT 1 FROM curriculum_enrollments WHERE id=?1)",
                                [sid],
                                |r| r.get(0),
                            )?,
                    )?;
                }
            }
            db.execute(
                "UPDATE curriculum_settings SET selection=?1",
                [serde_json::to_string(source_ids)?],
            )?;
        }
    }
    Ok(())
}
fn computed(db: &Connection) -> Result<Value> {
    let selection: String = db.query_row("SELECT selection FROM curriculum_settings", [], |r| {
        r.get(0)
    })?;
    let selection: Option<Vec<String>> = serde_json::from_str(&selection)?;
    let selected = |s: &str| {
        selection
            .as_ref()
            .is_none_or(|ids| ids.iter().any(|id| id == s))
    };
    let mut members: BTreeMap<String, Value> = BTreeMap::new();
    let mut add = |tid: String, source: String, new: bool, ordinal: i64| {
        let entry = members.entry(tid.clone()).or_insert_with(
            || json!({"targetId":tid,"newEligible":false,"ordinal":ordinal,"sources":[]}),
        );
        entry["newEligible"] = json!(entry["newEligible"] == true || new);
        entry["sources"].as_array_mut().unwrap().push(json!(source));
    };
    let mut q=db.prepare("SELECT m.target_id,m.source_id,m.in_range,m.started,m.ordinal,e.mode FROM curriculum_members m JOIN curriculum_enrollments e ON e.id=m.source_id ORDER BY CASE e.mode WHEN 'active' THEN 0 ELSE 1 END,m.source_id,m.ordinal")?;
    for row in q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, bool>(2)?,
            r.get::<_, bool>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
        ))
    })? {
        let (t, s, inside, started, o, mode) = row?;
        if selected(&s) && mode != "paused" && (started || (mode == "active" && inside)) {
            add(t, s, mode == "active" && inside, o);
        }
    }
    if selected("supplemental") {
        let mut q=db.prepare("SELECT target_id,ordinal FROM curriculum_supplemental WHERE active=1 ORDER BY ordinal,target_id")?;
        for row in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (t, o) = row?;
            add(t, "supplemental".into(), true, o);
        }
    }
    let mut values = vec![];
    for (_, mut member) in members {
        let tid = member["targetId"].as_str().unwrap();
        let material: Option<String> = db
            .query_row("SELECT material_id FROM targets WHERE id=?1", [tid], |r| {
                r.get(0)
            })
            .optional()?;
        let plan: Option<String> = db
            .query_row(
                "SELECT id FROM target_plans WHERE target_id=?1 ORDER BY revision DESC LIMIT 1",
                [tid],
                |r| r.get(0),
            )
            .optional()?;
        member["materialId"] = json!(material);
        member["planId"] = json!(plan);
        values.push(member);
    }
    values.sort_by_key(|v| {
        (
            v["ordinal"].as_i64().unwrap_or(0),
            v["targetId"].as_str().unwrap_or("").to_owned(),
        )
    });
    Ok(json!({"selection":selection,"members":values}))
}
pub(super) fn refresh(db: &Connection) -> Result<()> {
    if !exists(db)? {
        return Ok(());
    }
    let content = computed(db)?.to_string();
    let old: Option<String> = db
        .query_row(
            "SELECT content FROM curriculum_scopes ORDER BY revision DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if old.as_ref() != Some(&content) {
        db.execute("INSERT INTO curriculum_scopes SELECT coalesce(max(revision),0)+1,?1 FROM curriculum_scopes",[content])?;
    }
    Ok(())
}
pub(super) fn current(db: &Connection) -> Result<(i64, Value)> {
    let (r, s): (i64, String) = db.query_row(
        "SELECT revision,content FROM curriculum_scopes ORDER BY revision DESC LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((r, serde_json::from_str(&s)?))
}
pub(super) fn allows(db: &Connection, target: &str, initial: bool) -> Result<bool> {
    if !exists(db)? {
        return Ok(true);
    }
    let (_, scope) = current(db)?;
    let member = scope["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["targetId"] == target);
    let Some(member) = member else {
        return Ok(false);
    };
    if !initial || member["newEligible"] == true {
        return Ok(true);
    }
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM runs WHERE target_id=?1)",
        [target],
        |r| r.get(0),
    )?)
}
pub(super) fn freeze(db: &Connection, aid: &str) -> Result<()> {
    let (rev, scope) = current(db)?;
    db.execute(
        "UPDATE learning_activities SET scope_revision=?2 WHERE id=?1",
        params![aid, rev],
    )?;
    for m in scope["members"].as_array().unwrap() {
        if m["materialId"].is_null() {
            continue;
        }
        db.execute(
            "INSERT INTO activity_scope VALUES(?1,?2,?3,?4)",
            params![
                aid,
                m["targetId"].as_str(),
                m["materialId"].as_str(),
                m["newEligible"] == true
            ],
        )?;
        for s in m["sources"].as_array().unwrap() {
            db.execute(
                "INSERT INTO activity_scope_sources VALUES(?1,?2,?3)",
                params![aid, m["targetId"].as_str(), s.as_str()],
            )?;
        }
    }
    Ok(())
}
/// Attach source provenance only when a run/Introduction really exists, never fabricate progress.
pub(super) fn capture_started(
    db: &Connection,
    run_baseline: i64,
    introduction_baseline: i64,
) -> Result<()> {
    let (_, scope) = current(db)?;
    let mut q=db.prepare("SELECT id,target_id FROM runs WHERE rowid>?1 OR EXISTS(SELECT 1 FROM initial_introductions i WHERE i.target_id=runs.target_id AND i.rowid>?2)")?;
    for row in q.query_map(params![run_baseline, introduction_baseline], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (run, tid) = row?;
        let active: Option<String> = db
            .query_row(
                "SELECT id FROM learning_activities WHERE status='active'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let sources: Vec<String> = if let Some(a) = active {
            let mut s=db.prepare("SELECT source_id FROM activity_scope_sources WHERE activity_id=?1 AND target_id=?2")?;
            s.query_map(params![a, tid], |r| r.get(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            scope["members"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["targetId"] == tid)
                .map(|m| {
                    m["sources"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|s| s.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default()
        };
        for source in sources {
            db.execute(
                "UPDATE curriculum_members SET started=1 WHERE source_id=?1 AND target_id=?2",
                params![source, tid],
            )?;
            if db.query_row("SELECT EXISTS(SELECT 1 FROM initial_introductions WHERE target_id=?1 AND rowid>?2)",params![tid,introduction_baseline],|r|r.get::<_,bool>(0))?{db.execute("INSERT INTO curriculum_introduction_sources VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",params![tid,source,run])?;}
        }
    }
    Ok(())
}
pub(super) fn project(db: &Connection) -> Result<Value> {
    let mut books = vec![];
    let mut q = db.prepare("SELECT content FROM curriculum_books ORDER BY id,version")?;
    for s in q.query_map([], |r| r.get::<_, String>(0))? {
        let b: Book = serde_json::from_str(&s?)?;
        books.push(json!(b));
    }
    let mut q = db.prepare(
        "SELECT id,book_id,book_version,mode,range_json FROM curriculum_enrollments ORDER BY rowid",
    )?;
    let enrollments=q.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"bookId":r.get::<_,String>(1)?,"version":r.get::<_,String>(2)?,"mode":r.get::<_,String>(3)?,"range":serde_json::from_str::<Value>(&r.get::<_,String>(4)?).unwrap_or(Value::Null)})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut q = db.prepare(
        "SELECT s.target_id,s.active,s.ordinal,coalesce((SELECT json_extract(m.content,'$.expression') FROM targets t JOIN materials m ON m.id=t.material_id WHERE t.id=s.target_id),(SELECT json_extract(content,'$.target.proposal.expression.surface') FROM personal_learning_tasks WHERE id=s.target_id),'材料准备中') FROM curriculum_supplemental s ORDER BY s.ordinal,s.target_id",
    )?;
    let supplemental=q.query_map([],|r|Ok(json!({"targetId":r.get::<_,String>(0)?,"active":r.get::<_,bool>(1)?,"ordinal":r.get::<_,i64>(2)?,"expression":r.get::<_,String>(3)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let (revision, scope) = current(db)?;
    Ok(
        json!({"books":books,"enrollments":enrollments,"supplemental":supplemental,"scopeRevision":revision,"scope":scope}),
    )
}
