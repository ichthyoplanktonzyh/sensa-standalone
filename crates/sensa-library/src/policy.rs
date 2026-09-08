//! Assignment/plan/commitment transactions share the library's CAS operation ledger.
use super::*;
use sensa_core::{
    planning::*,
    policies::Purposes,
    protocol::{RELEARNING_PROTOCOL, REVIEW_PROTOCOL},
};
use std::collections::BTreeMap;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyChoice {
    pub policy: PolicyRef,
    pub label: String,
    pub executable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub id: String,
    pub revision: u32,
    pub plan: LearningPlan,
    pub committed: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyView {
    pub default_policy: Option<PolicyRef>,
    pub choices: Vec<PolicyChoice>,
    pub selected: Option<PlanView>,
    pub source_key: Option<String>,
}
fn rule(_: String) -> Error {
    Error::Rule("invalid_learning_plan")
}
pub fn system_policy() -> PolicyRef {
    PolicyRef {
        profile_id: "lightweight".into(),
        profile_version: "v1".into(),
    }
}
fn profiles() -> Result<Vec<Profile>> {
    let mut web: Vec<Profile> = serde_json::from_str(include_str!("web-policy-profiles-v1.json"))?;
    web.retain(|p| p.profile_id != "lightweight");
    let g = crate::composition::native_graph();
    let bindings = &g.profiles[0].protocols;
    let spec = |binding: sensa_core::policies::Binding, version: &str| ProtocolSpec {
        protocol_id: version.into(),
        protocol_version: version.into(),
        binding,
        content_demands: vec![
            serde_json::json!({"contentDemandKey":"sensa-local-text-pack-v1","definitionVersion":"1"}),
        ],
    };
    web.insert(
        0,
        Profile {
            profile_id: "lightweight".into(),
            profile_version: "v1".into(),
            lifecycle: serde_json::json!({
                "schedulingPolicyId": SCHEDULING_POLICY,
                "migrationPolicy": "pin_existing_runs",
                "provisioningFallback": {"behavior": "blocked"},
                "evidencePolicyId": "non_evidentiary"
            }),
            protocols: Purposes {
                initial_learning: spec(bindings.initial_learning.clone(), PROTOCOL),
                retention_review: spec(bindings.retention_review.clone(), REVIEW_PROTOCOL),
                relearning: spec(bindings.relearning.clone(), RELEARNING_PROTOCOL),
            },
        },
    );
    Ok(web)
}
fn profile(policy: &PolicyRef) -> Result<Profile> {
    profiles()?
        .into_iter()
        .find(|p| p.profile_id == policy.profile_id && p.profile_version == policy.profile_version)
        .ok_or(Error::Rule("unsupported_learning_policy"))
}
fn assignment(db: &Connection, scope: &str, key: &str) -> Result<Option<Assignment>> {
    let row:Option<(String,u32,Option<String>,Option<String>)>=db.query_row("SELECT id,revision,profile_id,profile_version FROM policy_assignments WHERE scope_kind=?1 AND scope_key=?2 ORDER BY revision DESC LIMIT 1",params![scope,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    Ok(row.and_then(|(id, revision, p, v)| {
        p.zip(v).map(|(profile_id, profile_version)| Assignment {
            assignment_id: id,
            revision,
            policy: PolicyRef {
                profile_id,
                profile_version,
            },
        })
    }))
}
fn library_id(db: &Connection) -> Result<String> {
    Ok(db.query_row("SELECT id FROM library", [], |r| r.get(0))?)
}
fn append_assignment(
    db: &Connection,
    scope: &str,
    key: &str,
    policy: Option<&PolicyRef>,
    now: i64,
) -> Result<()> {
    if let Some(p) = policy {
        profile(p)?;
    }
    let revision:u32=db.query_row("SELECT COALESCE(max(revision),0)+1 FROM policy_assignments WHERE scope_kind=?1 AND scope_key=?2",params![scope,key],|r|r.get(0))?;
    db.execute(
        "INSERT INTO policy_assignments VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            id(),
            scope,
            key,
            revision,
            policy.map(|p| &p.profile_id),
            policy.map(|p| &p.profile_version),
            now
        ],
    )?;
    Ok(())
}
pub(super) fn register_pack(db: &Connection, pack: &pack::LearningPack) -> Result<()> {
    let source = serde_json::to_string(&(&pack.id, &pack.version))?;
    for m in &pack.materials {
        db.execute(
            "INSERT INTO material_policy_sources VALUES(?1,?2) ON CONFLICT DO NOTHING",
            params![m.id, source],
        )?;
    }
    Ok(())
}
pub(super) fn enroll(db: &Connection, target: &str) -> Result<()> {
    db.execute("INSERT INTO target_policy_sources(target_id,source_key) SELECT t.id,(SELECT source_key FROM material_policy_sources WHERE material_id=t.material_id ORDER BY rowid LIMIT 1) FROM targets t WHERE t.id=?1 ON CONFLICT(target_id) DO NOTHING",[target])?;
    refresh_target(db, target)?;
    Ok(())
}
fn source(db: &Connection, target: &str) -> Result<Option<String>> {
    Ok(db.query_row(
        "SELECT source_key FROM target_policy_sources WHERE target_id=?1",
        [target],
        |r| r.get(0),
    )?)
}
fn effective(db: &Connection, target: &str) -> Result<EffectivePolicy> {
    resolve_policy(&ResolutionInput {
        committed: None,
        target: assignment(db, "target", target)?,
        curriculum: source(db, target)?
            .map(|key| assignment(db, "curriculum", &key))
            .transpose()?
            .flatten(),
        learner: assignment(db, "learner", &library_id(db)?)?,
        system: system_policy(),
    })
    .map_err(rule)
}
fn plan_by_id(db: &Connection, id: &str, committed: bool) -> Result<PlanView> {
    let (revision, content): (u32, String) = db.query_row(
        "SELECT revision,content FROM target_plans WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(PlanView {
        id: id.into(),
        revision,
        plan: serde_json::from_str(&content)?,
        committed,
    })
}
fn committed_id(db: &Connection, target: &str) -> Result<Option<String>> {
    Ok(db
        .query_row(
            "SELECT plan_id FROM policy_commitments WHERE target_id=?1",
            [target],
            |r| r.get(0),
        )
        .optional()?)
}
fn refresh_target(db: &Connection, target: &str) -> Result<PlanView> {
    if let Some(id) = committed_id(db, target)? {
        return plan_by_id(db, &id, true);
    }
    let effective = effective(db, target)?;
    let profile = profile(&effective.policy)?;
    let (material,digest,content):(String,String,String)=db.query_row("SELECT m.id,m.digest,m.content FROM targets t JOIN materials m ON m.id=t.material_id WHERE t.id=?1",[target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let valid = format!("{:x}", Sha256::digest(content.as_bytes())) == digest;
    let mut provider = BTreeMap::new();
    for (_, spec) in profile.protocols.entries() {
        for requirement in &spec.binding.content_requirement {
            let available = requirement == "recall-reveal-text" && valid;
            provider.insert(
                requirement.clone(),
                Capability {
                    view: ReadinessView {
                        status: if available {
                            Readiness::Ready
                        } else {
                            Readiness::Blocked
                        },
                        label: if available {
                            "材料已就绪"
                        } else {
                            "缺少所需学习材料"
                        }
                        .into(),
                        detail: if available {
                            "文本材料已保存在本机。"
                        } else {
                            "当前文本包不满足所选学习方式的内容要求。"
                        }
                        .into(),
                    },
                    provisioned: available,
                    materialization_id: available.then(|| format!("{material}@{digest}")),
                },
            );
        }
    }
    let plan = resolve_plan(
        effective,
        &profile,
        &provider,
        &["native-consumer-v1".into()],
    )
    .map_err(rule)?;
    let encoded = serde_json::to_string(&plan)?;
    let old:Option<(String,u32,String)>=db.query_row("SELECT id,revision,content FROM target_plans WHERE target_id=?1 ORDER BY revision DESC LIMIT 1",[target],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    if let Some((id, _, content)) = &old
        && content == &encoded
    {
        return plan_by_id(db, id, false);
    }
    let revision = old.map_or(1, |(_, r, _)| r + 1);
    let id = id();
    db.execute(
        "INSERT INTO target_plans VALUES(?1,?2,?3,?4)",
        params![id, target, revision, encoded],
    )?;
    db.execute(
        "UPDATE targets SET policy_id=?2,policy_version=?3 WHERE id=?1",
        params![
            target,
            plan.effective.policy.profile_id,
            plan.effective.policy.profile_version
        ],
    )?;
    Ok(PlanView {
        id,
        revision,
        plan,
        committed: false,
    })
}
pub(super) fn refresh(db: &Connection) -> Result<()> {
    let mut q = db.prepare(
        "SELECT id FROM targets WHERE id NOT IN (SELECT target_id FROM policy_commitments)",
    )?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    for id in ids {
        refresh_target(db, &id)?;
    }
    Ok(())
}
pub(super) fn set(
    db: &Connection,
    scope: &AssignmentScope,
    policy: Option<&PolicyRef>,
    now: i64,
) -> Result<()> {
    let (kind, key) = match scope {
        AssignmentScope::Learner => ("learner", library_id(db)?),
        AssignmentScope::Target => {
            let target:String=db.query_row("SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",[],|r|r.get(0)).optional()?.ok_or(Error::Rule("no_targets"))?;
            if committed_id(db, &target)?.is_some() {
                return Err(Error::Rule("policy_committed"));
            }
            ("target", target)
        }
        AssignmentScope::Curriculum => {
            let target:String=db.query_row("SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",[],|r|r.get(0)).optional()?.ok_or(Error::Rule("no_targets"))?;
            (
                "curriculum",
                source(db, &target)?.ok_or(Error::Rule("policy_source_unavailable"))?,
            )
        }
        AssignmentScope::System => return Err(Error::Rule("invalid_policy_scope")),
    };
    append_assignment(db, kind, &key, policy, now)?;
    refresh(db)
}
pub(super) fn view(db: &Connection) -> Result<PolicyView> {
    let default_policy = assignment(db, "learner", &library_id(db)?)?
        .map(|a| a.policy)
        .unwrap_or_else(system_policy);
    let target: Option<String> = db
        .query_row(
            "SELECT id FROM targets WHERE material_id=(SELECT selected_material_id FROM library)",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let (selected, source_key) = if let Some(target) = target {
        let committed = committed_id(db, &target)?;
        let id = if let Some(id) = &committed {
            id.clone()
        } else {
            db.query_row(
                "SELECT id FROM target_plans WHERE target_id=?1 ORDER BY revision DESC LIMIT 1",
                [&target],
                |r| r.get(0),
            )?
        };
        (
            Some(plan_by_id(db, &id, committed.is_some())?),
            source(db, &target)?,
        )
    } else {
        (None, None)
    };
    let choices = profiles()?
        .into_iter()
        .map(|p| PolicyChoice {
            label: match p.profile_id.as_str() {
                "lightweight" => "轻量学习",
                "high_assurance" => "高保证学习",
                "interleaved_four_stage" => "交错四阶段学习",
                _ => p.profile_id.as_str(),
            }
            .into(),
            executable: p.profile_id == "lightweight",
            policy: PolicyRef {
                profile_id: p.profile_id,
                profile_version: p.profile_version,
            },
        })
        .collect();
    Ok(PolicyView {
        default_policy: Some(default_policy),
        choices,
        selected,
        source_key,
    })
}
pub(super) fn commit_initial(db: &Connection, target: &str, run: &str, now: i64) -> Result<()> {
    if committed_id(db, target)?.is_some() {
        return Err(Error::Rule("policy_committed"));
    }
    let view = refresh_target(db, target)?;
    let plan = &view.plan.purposes.initial_learning;
    if plan.readiness.status != Readiness::Ready || !plan.provisioned {
        return Err(Error::Rule("learning_plan_blocked"));
    }
    if plan.binding.protocol_version != PROTOCOL {
        return Err(Error::Rule("unsupported_protocol"));
    }
    db.execute(
        "INSERT INTO policy_commitments VALUES(?1,?2,?3,?4,'first_run')",
        params![target, run, view.id, now],
    )?;
    db.execute(
        "INSERT INTO initial_run_policies VALUES(?1,?2)",
        params![run, view.id],
    )?;
    Ok(())
}
pub(super) fn pin_retention(
    db: &Connection,
    target: &str,
    run: &str,
    protocol: &str,
) -> Result<()> {
    let plan = committed_id(db, target)?.ok_or(Error::Rule("policy_commitment_missing"))?;
    db.execute(
        "INSERT INTO retention_run_policies VALUES(?1,?2)",
        params![run, plan],
    )?;
    validate_run(db, run, protocol, true)
}
pub(super) fn validate_run(
    db: &Connection,
    run: &str,
    protocol: &str,
    retention: bool,
) -> Result<()> {
    let sql = if retention {
        "SELECT plan_id FROM retention_run_policies WHERE run_id=?1"
    } else {
        "SELECT plan_id FROM initial_run_policies WHERE run_id=?1"
    };
    let id: String = db.query_row(sql, [run], |r| r.get(0))?;
    let plan = plan_by_id(db, &id, true)?.plan;
    let p = match protocol {
        PROTOCOL => &plan.purposes.initial_learning,
        REVIEW_PROTOCOL => &plan.purposes.retention_review,
        RELEARNING_PROTOCOL => &plan.purposes.relearning,
        _ => return Err(Error::Rule("unsupported_protocol")),
    };
    if p.binding.protocol_version != protocol
        || p.readiness.status != Readiness::Ready
        || !p.provisioned
    {
        return Err(Error::Rule("policy_pin_mismatch"));
    }
    Ok(())
}
pub(super) fn migrate_legacy(db: &Connection) -> Result<()> {
    let mut q = db.prepare("SELECT content FROM imported_packs ORDER BY rowid")?;
    let packs = q
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    for encoded in packs {
        register_pack(db, &serde_json::from_str(&encoded)?)?;
    }
    let mut q = db.prepare("SELECT id,policy_id,policy_version FROM targets ORDER BY rowid")?;
    let targets = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(q);
    for (target, profile_id, profile_version) in targets {
        append_assignment(
            db,
            "target",
            &target,
            Some(&PolicyRef {
                profile_id,
                profile_version,
            }),
            0,
        )?;
        enroll(db, &target)?;
        let run: Option<(String, i64)> = db
            .query_row(
                "SELECT id,started_at_ms FROM runs WHERE target_id=?1",
                [&target],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((run, time)) = run {
            let plan = refresh_target(db, &target)?;
            db.execute(
                "INSERT INTO policy_commitments VALUES(?1,?2,?3,?4,'legacy_run_v3')",
                params![target, run, plan.id, time],
            )?;
            db.execute(
                "INSERT INTO initial_run_policies VALUES(?1,?2)",
                params![run, plan.id],
            )?;
            db.execute("INSERT INTO retention_run_policies SELECT id,?2 FROM retention_runs WHERE target_id=?1",params![target,plan.id])?;
        }
    }
    Ok(())
}
